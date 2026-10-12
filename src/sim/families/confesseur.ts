// Confesseur (§8.10, L7, D1, D2, D3, D6) : petit support qui garde 7 à 10 m du joueur, frappe du Bâton au
// contact, et canalise une Prière qui relève d'un coup les Abattus ordinaires autour de lui, y compris lui-même
// s'il prie à terre.
import { actionEnded, freeToDecide, raisableByPrayer } from '../predicates'
import { TUNING } from '../tuning'
import type { Creature, Effect, FamilyModule, Intent, Vec2, World } from '../types'
import { add, angleOf, dist, fromAngle, len, scale, sub } from '../vec'

const C = TUNING.confesseur
const B = C.baton

export const PRIERE = 'priere'
const BATON = 'baton'
const CAN_ACT_WHILE_DOWN = true // il prie à terre (§8.10)

// Clés de familyData.
const READY = 'priereDes' // tick à partir duquel une nouvelle prière peut commencer (recharge, D1)
const SINCE = 'priereDebut' // tick de début de la prière suivie, -1 si aucune
const BARKED = 'invective' // 1 une fois l'invective lancée

// Un corps au sens de la prière : un Abattu qui n'est pas un Membre errant (B4 : ils se recousent, ils ne se
// relèvent pas). Tranché par l'orchestrateur (requête C3 R2) ; le cœur les exclut aussi de `raise`.
const isBody = (c: Creature): boolean => c.state.kind === 'abattu' && c.family !== 'membre'

const inPrayerRadius = (self: Creature, c: Creature): boolean => dist(self.pos, c.pos) <= C.prayerRadius

// D2 : lui-même compris s'il est à terre (sa distance à lui-même est nulle). Les Résistants comptent.
const bodiesNear = (w: World, self: Creature): number =>
  w.creatures.filter((c) => isBody(c) && inPrayerRadius(self, c)).length

const ready = (w: World, data: Creature['familyData']): boolean => (data[READY] ?? 0) <= w.tick

const wantsPrayer = (w: World, self: Creature, data: Creature['familyData']): boolean =>
  ready(w, data) && bodiesNear(w, self) >= C.prayerTrigger

// D3 : à la fin, tous les Abattus ordinaires à moins de 8 m, sauf ceux réservés par une Sentence ou une
// opération : le prédicat de l'effet `raise` du cœur.
const raisable = (w: World, self: Creature): number[] =>
  w.creatures.filter((c) => raisableByPrayer(c) && inPrayerRadius(self, c)).map((c) => c.id)

// Point à `radius` du joueur, sur la droite joueur → Confesseur.
const ringPoint = (self: Creature, player: Vec2, radius: number): Vec2 => {
  const away = sub(self.pos, player)
  const l = len(away)
  const dir = l < 1e-9 ? fromAngle(self.facing + Math.PI) : scale(away, 1 / l)
  return add(player, scale(dir, radius))
}

const decide = (w: World, self: Creature): Intent => {
  if (wantsPrayer(w, self, self.familyData)) return { kind: 'act', action: PRIERE }
  if (self.state.kind === 'abattu') return { kind: 'idle' }
  const p = w.player.pos
  const d = dist(self.pos, p)
  if (d <= B.reach + TUNING.playerRadius) return { kind: 'act', action: BATON, target: p }
  // Recule face au joueur pour rester à keepMin, revient à keepMax s'il s'éloigne.
  if (d < C.keepMin)
    return { kind: 'moveTo', target: ringPoint(self, p, C.keepMin), keepFacing: angleOf(self.pos, p) }
  if (d > C.keepMax) return { kind: 'moveTo', target: ringPoint(self, p, C.keepMax) }
  return { kind: 'idle' }
}

// Le cœur appellera-t-il decide() pour cette créature à ce tick ? Les prédicats de creatures.ts : aucune action
// après progressAction (une attaque qui finit sans impact à ce tick libère la créature ; une prière qui se résout
// à ce tick pose sa recharge dans resolve, d'où l'exclusion de activeAt), puis libre de décider.
const decidesThisTick = (w: World, self: Creature): boolean => {
  const a = self.action
  const idle = a === null || (actionEnded(a, w.tick) && w.tick !== a.activeAt)
  return idle && freeToDecide(self, w.tick, CAN_ACT_WHILE_DOWN)
}

const setData = (key: string, value: number): Effect => ({ kind: 'setData', key, value })

// D1 : la recharge part à la fin de la prière, achevée (resolve) ou interrompue (observée ici). Le hook tourne
// avant progressAction et decide : il note le début d'une prière au tick même où decide la lance, si bien
// qu'aucune interruption, même au tick suivant, ne lui échappe. Limite : une interruption portée au tick t par
// une créature d'id plus grand (éclatement) n'est vue qu'au tick t + 1, la recharge part alors un tick plus tard.
const tick = (w: World, self: Creature): readonly Effect[] => {
  const out: Effect[] = []
  if (self.state.kind === 'hostile' && !self.familyData[BARKED]) {
    out.push({ kind: 'alert', center: self.pos, radius: TUNING.alertBark, cause: 'bark' }, setData(BARKED, 1))
  }
  const a = self.action
  const running = a !== null && a.name === PRIERE
  let data = self.familyData
  const since = data[SINCE] ?? -1
  if (since >= 0 && !(running && a.start === since)) {
    // Arrêtée sans s'achever (l'achèvement remet SINCE à -1) : coup, éclatement, chute.
    // Un Relèvement ne la coupe pas : commencée à terre, elle continue debout.
    data = { ...data, [READY]: w.tick + C.prayerCooldown, [SINCE]: -1 }
    out.push(setData(READY, w.tick + C.prayerCooldown), setData(SINCE, -1))
  }
  if (running && (data[SINCE] ?? -1) < 0) out.push(setData(SINCE, a.start))
  else if (!running && decidesThisTick(w, self) && wantsPrayer(w, self, data))
    out.push(setData(SINCE, w.tick))
  return out
}

const resolve = (w: World, self: Creature, action: { readonly name: string }): readonly Effect[] => {
  if (action.name === PRIERE) {
    return [
      { kind: 'raise', ids: raisable(w, self) },
      setData(READY, w.tick + C.prayerCooldown),
      setData(SINCE, -1),
    ]
  }
  return [
    {
      kind: 'damage',
      area: { kind: 'cone', origin: self.pos, facing: self.facing, reach: B.reach, arcDeg: B.arcDeg },
      amount: B.damage,
      source: 'creature',
      abatSmall: false,
      staggerLarge: 0,
      hitsCreatures: false,
    },
  ]
}

export const confesseur: FamilyModule = {
  kind: 'confesseur',
  size: 'small',
  isSupport: true,
  canActWhileDown: CAN_ACT_WHILE_DOWN,
  base: { chair: C.chair, speed: C.speed, limbs: [] },
  actions: {
    [BATON]: {
      kind: 'attaque',
      telegraphTicks: B.telegraph,
      recoverTicks: B.recover,
      reach: B.reach,
      arcDeg: B.arcDeg,
    },
    [PRIERE]: {
      kind: 'canalisation',
      telegraphTicks: 0,
      recoverTicks: 0,
      channelTicks: C.prayerChannel,
      reach: C.prayerRadius,
    },
  },
  decide,
  resolve,
  tick,
}
