// B4 « Faucher la horde », §6 du contrat gelé (.mercy/contracts/_frozen/B4.md) : politique `faucheur`, déclinée
// en `faucheur-couperet` et `faucheur-masse`, jouée à l'identique en A et en B. Transcription règle par règle :
// chaque règle R0 à R9 du pseudo-code est une fonction qui porte son identifiant. La latence de 12 ticks et la
// limite de 18 000 ticks après T0 sont des paramètres du lanceur (I3, I5), pas de la politique.
// La politique ne lit jamais la Chair d'une créature, ni `riseAt` avant que le télégraphe de Relèvement soit visible
// (R8 a ne le compare qu'à T_TEL).
import {
  actionPhase,
  type Creature,
  datan2,
  dcos,
  dhypot,
  dsin,
  type PlayerCommands,
  PORTEUR_STAGE_KEY,
  TUNING,
  type Vec2,
  type WeaponId,
  type World,
} from '../../sim/index'
import type { Policy } from '../policy'

// Constantes (tuning.ts et modules de familles). R et ARC sont ceux de l'arme de la politique (`arme`).
const R_BAL = TUNING.balayage.radius // 4 m
const C_BAL = TUNING.balayage.cost // 25
const L_CH = TUNING.charge.length // 7 m
const C_CH = TUNING.charge.cost // 35
const R_SEN = TUNING.sentence.range // 2,5 m
const T_TEL = TUNING.relevementTelegraph // 90 ticks

// Valeurs numériques de la politique (§6, table « Valeurs numériques de la politique »).
const R0_HOSTILE = 15 // R0 : aucune créature hostile à 15 m ou moins
const R2_VIE = 45 // R2 : sous 45, deux Marteaux de Recousu tuent
const R3_VIE = 30 // R3 : à 30 de Vie, cinq morsures tuent
const R3_SMALL = 2 // R3 : deux petites menaces
const R3_PORTEUR = 6 // R3 : rayon d'éclatement au stade 3 (5 m) plus 1 m
const R3_MARGE = 0.5 // menace(c) : portée de l'action + 0,5 m
const R5_MIN = 3 // R5 : sous 3 m, marcher suffit
const R6_N = 4 // R6 : 4 cibles à 4 m
const R7_VUE = 9 // R7 : moitié du champ horizontal de la caméra
const R8A_D = 8 // R8 a
const R8B_D = 4 // R8 b
const PORTEUR_STADE_3 = 3

// Notations du contrat.
interface Ctx {
  readonly w: World
  readonly cs: readonly Creature[] // W.creatures dans l'ordre des id croissants
  readonly P: Vec2
  readonly t: number
  readonly f: number
  readonly R: number
  readonly ARC: number // radians
}

const d = (x: Ctx, c: Creature): number => dhypot(c.pos.x - x.P.x, c.pos.z - x.P.z)
const ang = (v: Vec2): number => datan2(v.z, v.x)
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z })
// écart(a, b) = |a − b| ramené dans [0, π]
export const ecart = (a: number, b: number): number => {
  const m = Math.abs(a - b) % (2 * Math.PI)
  return m > Math.PI ? 2 * Math.PI - m : m
}
// unit(v) = v / |v| si |v| > 0, sinon (cos(f + π/2), sin(f + π/2))
const unit = (x: Ctx, v: Vec2): Vec2 => {
  const l = dhypot(v.x, v.z)
  return l > 0 ? { x: v.x / l, z: v.z / l } : { x: dcos(x.f + Math.PI / 2), z: dsin(x.f + Math.PI / 2) }
}
const hostile = (c: Creature): boolean => c.state.kind === 'hostile'
const rituel = (c: Creature): boolean => c.state.kind === 'rituel'
const abOrd = (c: Creature): boolean =>
  c.state.kind === 'abattu' && !c.resistant && c.state.claimedBy === null
const abRes = (c: Creature): boolean => c.state.kind === 'abattu' && c.resistant && c.state.claimedBy === null
const dansArc = (x: Ctx, c: Creature, theta: number): boolean =>
  d(x, c) <= x.R && ecart(ang(minus(c.pos, x.P)), theta) <= x.ARC / 2
// portéeAction(c) : la portée se lit dans le module de la famille (I2).
const porteeAction = (w: World, c: Creature): number => {
  const name = c.action?.name
  const def = name === undefined ? undefined : w.families[c.family]?.actions[name]
  if (!def) throw new Error(`faucheur : action « ${name} » absente du module ${c.family}`)
  return def.reach
}
const menace = (x: Ctx, c: Creature): boolean =>
  hostile(c) &&
  c.action !== null &&
  c.action.kind === 'attaque' &&
  actionPhase(c.action, x.t) === 'telegraphe' &&
  d(x, c) <= porteeAction(x.w, c) + R3_MARGE
const canal = (c: Creature): boolean =>
  c.action !== null &&
  c.action.kind === 'canalisation' &&
  (c.state.kind === 'hostile' || c.state.kind === 'abattu')
const stade = (c: Creature): number => c.familyData[PORTEUR_STAGE_KEY] ?? 0
const porteur3 = (c: Creature): boolean =>
  c.family === 'porteur' && hostile(c) && stade(c) === PORTEUR_STADE_3
// proche(S) = élément de S de d minimale ; égalité : id minimal. W.creatures est trié par id croissant.
const proche = (x: Ctx, S: readonly Creature[]): Creature | undefined => {
  let best: Creature | undefined
  for (const c of S) if (!best || d(x, c) < d(x, best) || (d(x, c) === d(x, best) && c.id < best.id)) best = c
  return best
}
const BASE = (x: Ctx): PlayerCommands => ({
  move: { x: 0, z: 0 },
  aim: { x: x.P.x + dcos(x.f), z: x.P.z + dsin(x.f) },
  strike: false,
  dodge: false,
  sentence: false,
  rite: null,
  swapWeapon: false,
})
// Toute itération sur W.creatures suit l'ordre des id croissants.
const all = (x: Ctx, pred: (c: Creature) => boolean): Creature[] => x.cs.filter(pred)

type Rule = (x: Ctx, arme: WeaponId) => PlayerCommands | null

// R0 arme
const r0 = (x: Ctx, arme: WeaponId): boolean =>
  x.w.player.weapon !== arme && !x.cs.some((c) => hostile(c) && d(x, c) <= R0_HOSTILE)

// R1 action en cours
const r1: Rule = (x) => {
  const a = x.w.player.action
  if (
    a !== null &&
    (a.kind === 'esquive' || a.kind === 'sentence' || a.kind === 'balayage' || a.kind === 'charge')
  )
    return BASE(x)
  return null
}

// R2 soin
const r2: Rule = (x) => {
  const S = all(x, (c) => abOrd(c) && d(x, c) <= R_SEN)
  const c = proche(x, S)
  if (x.w.player.vie <= R2_VIE && c) return { ...BASE(x), aim: c.pos, sentence: true }
  return null
}

// R3 esquive
const r3: Rule = (x) => {
  const M = all(x, (c) => menace(x, c))
  const Q = all(x, (c) => porteur3(c) && d(x, c) <= R3_PORTEUR)
  const p = x.w.player
  const declenche =
    M.some((c) => c.size === 'large') ||
    M.filter((c) => c.size === 'small').length >= R3_SMALL ||
    (p.vie <= R3_VIE && M.length > 0) ||
    Q.length > 0
  if (p.dodgeCharges >= 1 && declenche) {
    // Barycentre des positions de M ∪ Q (union d'ensembles : une créature n'y compte qu'une fois).
    const U = all(x, (c) => M.includes(c) || Q.includes(c))
    const bx = U.reduce((s, c) => s + c.pos.x, 0) / U.length
    const bz = U.reduce((s, c) => s + c.pos.z, 0) / U.length
    const v = unit(x, minus(x.P, { x: bx, z: bz }))
    return { ...BASE(x), move: v, aim: { x: x.P.x + v.x, z: x.P.z + v.z }, dodge: true }
  }
  return null
}

// R4 Résistant à terre
const r4: Rule = (x) => {
  const S = all(x, (c) => abRes(c) && d(x, c) <= R_SEN)
  const c = proche(x, S)
  return c ? { ...BASE(x), aim: c.pos, sentence: true } : null
}

// R5 canalisation
const r5: Rule = (x) => {
  const c = proche(x, all(x, canal))
  if (!c) return null
  if (d(x, c) <= x.R) return { ...BASE(x), aim: c.pos, strike: true }
  if (x.w.player.ferveur >= C_CH && R5_MIN <= d(x, c) && d(x, c) <= L_CH)
    return { ...BASE(x), aim: c.pos, rite: 'charge' }
  const theta = ang(minus(c.pos, x.P))
  return {
    ...BASE(x),
    move: unit(x, minus(c.pos, x.P)),
    aim: c.pos,
    strike: x.cs.some((y) => (hostile(y) || abOrd(y)) && dansArc(x, y, theta)),
  }
}

// R6 Balayage
const r6: Rule = (x) => {
  const n = all(x, (c) => (hostile(c) || abOrd(c)) && d(x, c) <= R_BAL).length
  return x.w.player.ferveur >= C_BAL && n >= R6_N ? { ...BASE(x), rite: 'balayage' } : null
}

// R7 frappe
const r7: Rule = (x) => {
  const E = all(x, (c) => (hostile(c) || abOrd(c)) && d(x, c) <= R7_VUE)
  const cible = (y: Creature): boolean => (E.length > 0 ? hostile(y) || abOrd(y) : rituel(y))
  const C = all(x, (c) => cible(c) && d(x, c) <= x.R)
  if (C.length === 0) return null
  const score = (c: Creature) => {
    const th = ang(minus(c.pos, x.P))
    return {
      total: all(x, (y) => cible(y) && dansArc(x, y, th)).length,
      corps: all(x, (y) => abOrd(y) && dansArc(x, y, th)).length,
    }
  }
  // c* maximise (total, puis corps) ; égalité : d minimale, puis id minimal.
  let best = C[0] as Creature
  let bs = score(best)
  for (const c of C.slice(1)) {
    const s = score(c)
    const better =
      s.total > bs.total ||
      (s.total === bs.total && s.corps > bs.corps) ||
      (s.total === bs.total && s.corps === bs.corps && d(x, c) < d(x, best)) ||
      (s.total === bs.total && s.corps === bs.corps && d(x, c) === d(x, best) && c.id < best.id)
    if (better) {
      best = c
      bs = s
    }
  }
  return { ...BASE(x), aim: best.pos, strike: true }
}

// R8 déplacement : première liste non vide, dans cet ordre.
const r8: Rule = (x) => {
  // a. riseAt − t ≤ T_TEL : le télégraphe de Relèvement est visible. riseAt null (Membre errant) : jamais.
  const riseAt = (c: Creature): number | null => (c.state.kind === 'abattu' ? c.state.riseAt : null)
  const visible = (c: Creature): boolean => {
    const r = riseAt(c)
    return r !== null && r - x.t <= T_TEL
  }
  const a = all(x, (c) => abOrd(c) && visible(c) && d(x, c) <= R8A_D)
  // choix : riseAt minimal, puis id minimal (a est déjà dans l'ordre des id).
  const choixA = a.reduce<Creature | undefined>(
    (best, c) => (!best || (riseAt(c) ?? 0) < (riseAt(best) ?? 0) ? c : best),
    undefined,
  )
  const choix: readonly (() => Creature | undefined)[] = [
    () => choixA, // a
    () =>
      proche(
        x,
        all(x, (c) => abOrd(c) && d(x, c) <= R8B_D),
      ), // b
    () => proche(x, all(x, hostile)), // c
    () => proche(x, all(x, abOrd)), // d
    () => proche(x, all(x, abRes)), // e
    () => proche(x, all(x, rituel)), // f
  ]
  for (const pick of choix) {
    const c = pick()
    if (c) return { ...BASE(x), move: unit(x, minus(c.pos, x.P)), aim: c.pos }
  }
  return null
}

// R9 rien à faire
const r9: Rule = (x) => BASE(x)

const RULES: readonly Rule[] = [r1, r2, r3, r4, r5, r6, r7, r8, r9]

const context = (arme: WeaponId, w: World): Ctx => {
  const weapon = TUNING.weapons[arme]
  return {
    w,
    cs: [...w.creatures].sort((a, b) => a.id - b.id),
    P: w.player.pos,
    t: w.tick,
    f: w.player.facing,
    R: weapon.reach,
    ARC: (weapon.arcDeg * Math.PI) / 180,
  }
}

// Règle retenue : la première de R1 à R9 qui s'applique (R9 s'applique toujours).
const first = (x: Ctx, arme: WeaponId): { readonly id: string; readonly out: PlayerCommands } => {
  for (const [i, rule] of RULES.entries()) {
    const out = rule(x, arme)
    if (out) return { id: `R${i + 1}`, out }
  }
  return { id: 'R9', out: BASE(x) }
}

// Sortie : la première règle de R1 à R9 qui s'applique, avec swapWeapon fixé par R0.
export const decideFaucheur = (arme: WeaponId, w: World): PlayerCommands => {
  const x = context(arme, w)
  return { ...first(x, arme).out, swapWeapon: r0(x, arme) }
}

// Identifiant de la règle retenue (tests, traces).
export const faucheurRule = (arme: WeaponId, w: World): string => first(context(arme, w), arme).id

export const faucheur = (arme: WeaponId): Policy<null> => ({
  name: `faucheur-${arme}`,
  init: () => null,
  decide: (w) => [decideFaucheur(arme, w), null],
})
