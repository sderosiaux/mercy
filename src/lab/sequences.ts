// Séquences image par image des modèles (E2), avec les vraies familles du jeu : une créature Hostile face au
// Bourreau frappe (l'impact du clip doit tomber au tick actif de la simulation), puis le Bourreau coupe sa deuxième
// attaque d'un coup (la réaction doit couper l'attaque en au plus 2 images), l'abat et l'achève (la mort doit se
// figer dans l'image du coup). Le Recousu, grande créature, n'est interrompu que par le sectionnement du bras qui
// attaque : son bras est préréglé fragile, le coup le tranche (Membre errant).
import {
  createWorld,
  FAMILIES,
  type FamilyKind,
  IDLE_COMMANDS,
  type PlayerCommands,
  TUNING,
  type Vec2,
  type World,
} from '../sim/index'
import { testWave, withCreature, withPlayer } from '../sim/testing'
import type { Policy } from './policies'

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.z)
  return l === 0 ? { x: 0, z: 0 } : { x: v.x / l, z: v.z / l }
}

// La créature (id 1) et le Bourreau face à face. Le Chirurgien fuit : on le met dans un coin (acculé, il frappe).
const SETUP: Readonly<Record<string, { at: Vec2; player: Vec2 }>> = {
  souriant: { at: { x: 1.3, z: 0 }, player: { x: 0, z: 0 } },
  recousu: { at: { x: 1.6, z: 0 }, player: { x: 0, z: 0 } },
  porteur: { at: { x: 1.2, z: 0 }, player: { x: 0, z: 0 } },
  confesseur: { at: { x: 1.4, z: 0 }, player: { x: 0, z: 0 } },
  chirurgien: { at: { x: 14.4, z: 14.4 }, player: { x: 13.4, z: 13.4 } },
}

// Chair réglée pour que le premier coup coupe sans abattre, le deuxième abatte, le troisième achève (Couperet 12).
const CHAIR_SEQ = 20

export const sequenceWorld = (family: FamilyKind): World => {
  const s = SETUP[family] ?? (SETUP.souriant as { at: Vec2; player: Vec2 })
  const facing = Math.atan2(s.player.z - s.at.z, s.player.x - s.at.x)
  let w = createWorld({
    seed: 7,
    variant: 'A',
    wave: testWave([{ family, pos: s.at, facing, state: 'hostile' }], s.player),
    families: FAMILIES,
  })
  const c = w.creatures[0]
  if (!c) return w
  w = withCreature(w, c.id, {
    chair: CHAIR_SEQ,
    // Bras fragiles : le coup qui touche le bras qui attaque le tranche (et interrompt la grande créature).
    limbs: c.limbs.map((l) => ({ ...l, hp: 8 })),
  })
  return w
}

// Bourreau scripté : laisse frapper une fois, coupe la deuxième attaque, puis abat et achève.
export const sequencePolicy = (): Policy => {
  const m = { firstEnd: -1, cutDone: false }
  return (w: World): PlayerCommands => {
    const c = w.creatures.find((x) => x.family !== 'membre')
    const p = w.player
    const idle = { ...IDLE_COMMANDS, aim: c ? c.pos : p.pos }
    if (!c || c.state.kind === 'mort') return idle
    const a = c.action
    if (m.firstEnd < 0) {
      if (a && a.kind === 'attaque') m.firstEnd = a.end
      return idle
    }
    if (w.tick < m.firstEnd) return idle
    const d = dist(p.pos, c.pos)
    const reach = TUNING.weapons.couperet.reach
    if (!m.cutDone) {
      // Coupe la deuxième attaque pendant son télégraphe.
      if (w.events.some((e) => e.type === 'hit' && e.target === c.id)) m.cutDone = true
      if (a && a.kind === 'attaque' && a.start >= m.firstEnd && w.tick < a.activeAt && d <= reach)
        return { ...idle, strike: true }
      if (d > reach - 0.3) return { ...idle, move: norm({ x: c.pos.x - p.pos.x, z: c.pos.z - p.pos.z }) }
      return idle
    }
    // Abat, puis achève (une instance de dégâts sur un Abattu ordinaire le tue, L4).
    if (d > reach - 0.3) return { ...idle, move: norm({ x: c.pos.x - p.pos.x, z: c.pos.z - p.pos.z }) }
    return { ...idle, strike: p.action === null }
  }
}

export const SEQUENCE_FAMILIES: readonly FamilyKind[] = [
  'souriant',
  'recousu',
  'porteur',
  'confesseur',
  'chirurgien',
]

// Séquence du Bourreau (E3) : ses gestes contre un Souriant en Rituel, très résistant (il reste debout). Une Frappe
// complète (anticipation, impact au tick d'impact de la simulation), une Frappe coupée par une Esquive pendant son
// anticipation (aucun impact), un Balayage. Ticks des commandes : la simulation lance le geste au tick suivant.
export const BOURREAU_SEQ = { frappe: 10, frappeCoupee: 60, esquive: 62, balayage: 120 } as const

export const bourreauSequenceWorld = (): World => {
  let w = createWorld({
    seed: 7,
    variant: 'A',
    wave: testWave([{ family: 'souriant', pos: { x: 1.4, z: 0 }, facing: Math.PI, state: 'rituel' }], {
      x: 0,
      z: 0,
    }),
    families: FAMILIES,
  })
  const c = w.creatures[0]
  if (c) w = withCreature(w, c.id, { chair: 1000 })
  return withPlayer(w, { ferveur: TUNING.balayage.cost })
}

export const bourreauSequencePolicy =
  (): Policy =>
  (w: World): PlayerCommands => {
    const c = w.creatures.find((x) => x.family !== 'membre')
    const aim = c ? c.pos : { x: 1.4, z: 0 }
    const S = BOURREAU_SEQ
    return {
      ...IDLE_COMMANDS,
      aim,
      strike: w.tick === S.frappe || w.tick === S.frappeCoupee,
      dodge: w.tick === S.esquive,
      rite: w.tick === S.balayage ? 'balayage' : null,
    }
  }

// Armes en main et orientation (E6) : le Bourreau enchaîne tous ses gestes avec ses deux armes, dans le vide (aucune
// créature Hostile : le changement d'arme reste permis), et deux Sentences sur des Abattus placés hors des cônes de
// frappe. Combinaison complète au Couperet (3 coups), Sentence tranchante, Masse, combinaison complète à la Masse,
// demi-tour au moment de frapper (le curseur passe derrière lui), Sentence contondante, retour au Couperet, Balayage,
// Charge, Esquive, marche au clavier en visant ailleurs, puis quart de tour du curseur à l'arrêt. Un Souriant en
// Rituel, loin, garde la vague ouverte. Ticks des commandes : la simulation lance le geste au tick suivant ; une
// Frappe maintenue enchaîne la combinaison (période de l'arme).
export const ARMES_SEQ = {
  comboCouperet: [10, 72],
  sentenceTranchante: 90,
  versMasse: 140,
  comboMasse: [150, 248],
  demiTour: 260,
  sentenceContondante: 300,
  versCouperet: 345,
  balayage: 360,
  charge: 420,
  esquive: 480,
  marche: [520, 570],
  quartDeTour: 580,
  fin: 620,
} as const

export const ARMES_ABATTUS: readonly Vec2[] = [
  { x: 0.4, z: -1.6 },
  { x: 0.16, z: 1.37 },
]

export const armesWorld = (): World => {
  const w = createWorld({
    seed: 7,
    variant: 'A',
    wave: testWave(
      [
        ...ARMES_ABATTUS.map((pos, k) => ({
          family: 'souriant' as const,
          pos,
          facing: 0.6 + k,
          state: 'abattu' as const,
        })),
        { family: 'souriant', pos: { x: 13, z: -13 }, facing: 2, state: 'rituel' },
      ],
      { x: 0, z: 0 },
    ),
    families: FAMILIES,
  })
  return withPlayer(w, { ferveur: TUNING.ferveur.max })
}

const within = (t: number, [a, b]: readonly [number, number]): boolean => t >= a && t <= b

export const armesPolicy =
  (): Policy =>
  (w: World): PlayerCommands => {
    const S = ARMES_SEQ
    const p = w.player.pos
    const t = w.tick
    let aim: Vec2 = { x: p.x + 3, z: p.z }
    if (t >= S.sentenceTranchante && t < S.versMasse) aim = ARMES_ABATTUS[0] as Vec2
    if (t >= S.demiTour && t < S.sentenceContondante) aim = { x: p.x - 3, z: p.z }
    if (t >= S.sentenceContondante && t < S.versCouperet) aim = ARMES_ABATTUS[1] as Vec2
    if ((t >= S.charge && t < S.esquive) || t >= S.quartDeTour) aim = { x: p.x, z: p.z + 3 }
    return {
      ...IDLE_COMMANDS,
      aim,
      move: within(t, S.marche) ? { x: -1, z: 0 } : t === S.esquive ? { x: 0, z: -1 } : { x: 0, z: 0 },
      strike: within(t, S.comboCouperet) || within(t, S.comboMasse) || t === S.demiTour,
      swapWeapon: t === S.versMasse || t === S.versCouperet,
      sentence: t === S.sentenceTranchante || t === S.sentenceContondante,
      dodge: t === S.esquive,
      rite: t === S.balayage ? 'balayage' : t === S.charge ? 'charge' : null,
    }
  }
