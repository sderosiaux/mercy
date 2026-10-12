// Chirurgien (§8.10) : support qui transforme les corps laissés à terre en Recousus.
// Ordre de décision, quand il est Hostile et libre :
//   0. le joueur à moins de 4 m : il fuit ; acculé (le bord de l'arène l'empêche de s'éloigner), il donne du Scalpel ;
//   (a) recoudre un Membre errant de Recousu, ou relever un Recousu Abattu (+1 Cicatrice) ;
//   (b) assembler 2 ou 3 Abattus ordinaires à moins de 2 m les uns des autres en un Recousu ;
//   (c) garder ses distances : il attend.
// Une opération est une canalisation de 180 ticks posée au contact du corps visé, que le cœur réserve tant qu'elle dure.
// Deux Chirurgiens libres au même tick : le cœur les fait décider par id croissant et la réservation du premier est
// visible du second, qui écarte aussi les corps du groupe que le premier assemble. Le plus petit id l'emporte.
import { radiusOf } from '../draft'
import { TICK_HZ, TUNING } from '../tuning'
import type { Creature, EntityId, FamilyModule, Intent, Vec2, World } from '../types'
import { add, dist, fromAngle, norm, scale, sub } from '../vec'

const C = TUNING.chirurgien
const IDLE: Intent = { kind: 'idle' }

const byId = (world: World, id: EntityId): Creature | undefined => world.creatures.find((c) => c.id === id)

const freeFor = (c: Creature, op: EntityId): boolean =>
  c.state.kind === 'abattu' && (c.state.claimedBy === null || c.state.claimedBy === op)

// (a) Membre errant d'un Recousu non mort, ou Recousu Abattu.
const repairable = (world: World, c: Creature, op: EntityId): boolean => {
  if (!freeFor(c, op)) return false
  if (c.family === 'recousu') return true
  if (c.family !== 'membre' || c.unionOf === null) return false
  const owner = byId(world, c.unionOf)
  return owner !== undefined && owner.family === 'recousu' && owner.state.kind !== 'mort'
}

// (b) Abattu ordinaire. Membres errants et Recousus relèvent de (a), qui passe avant.
const assemblable = (c: Creature, op: EntityId): boolean =>
  freeFor(c, op) && !c.resistant && c.family !== 'membre' && c.family !== 'recousu'

const byDistanceFrom =
  (p: Vec2) =>
  (a: Creature, b: Creature): number =>
    dist(a.pos, p) - dist(b.pos, p) || a.id - b.id

const assemblableFor = (world: World, op: EntityId): Creature[] =>
  world.creatures.filter((c) => assemblable(c, op))

// Le corps d'ancrage, puis jusqu'à deux autres pris parmi `candidates`, tous à moins de 2 m les uns des autres, les
// plus proches de l'ancre d'abord. Recalculé à la fin de l'opération : un corps parti, achevé ou relevé entre-temps
// n'y est plus.
const groupAround = (anchor: Creature, candidates: readonly Creature[]): Creature[] => {
  const group = [anchor]
  const pool = candidates
    .filter((c) => c.id !== anchor.id && dist(c.pos, anchor.pos) <= C.assembleRadius)
    .sort(byDistanceFrom(anchor.pos))
  for (const c of pool) {
    if (group.length === 3) break
    if (group.every((g) => dist(g.pos, c.pos) <= C.assembleRadius)) group.push(c)
  }
  return group
}

// Corps déjà promis à l'assemblage d'un autre Chirurgien en cours d'opération.
const promisedToOthers = (world: World, self: Creature): Set<EntityId> => {
  const out = new Set<EntityId>()
  for (const o of world.creatures) {
    const a = o.action
    if (o.id === self.id || a?.name !== 'assembler' || typeof a.target !== 'number') continue
    const anchor = byId(world, a.target)
    if (!anchor || !assemblable(anchor, o.id)) continue
    for (const b of groupAround(anchor, assemblableFor(world, o.id))) out.add(b.id)
  }
  return out
}

// Au contact du corps (rayons sommés, comme la reptation de L1), il opère ; sinon il y va.
const operateOn = (self: Creature, body: Creature, action: 'recoudre' | 'assembler'): Intent =>
  dist(self.pos, body.pos) <= radiusOf(self) + radiusOf(body)
    ? { kind: 'act', action, target: body.id }
    : { kind: 'moveTo', target: body.pos }

const repairIntent = (world: World, self: Creature): Intent | null => {
  const body = world.creatures.filter((c) => repairable(world, c, self.id)).sort(byDistanceFrom(self.pos))[0]
  return body ? operateOn(self, body, 'recoudre') : null
}

const assembleIntent = (world: World, self: Creature): Intent | null => {
  const taken = promisedToOthers(world, self)
  const free = assemblableFor(world, self.id).filter((c) => !taken.has(c.id))
  const anchors = [...free].sort(byDistanceFrom(self.pos))
  for (const anchor of anchors) {
    if (groupAround(anchor, free).length >= 2) return operateOn(self, anchor, 'assembler')
  }
  return null
}

// Fuite : un pas de course droit à l'opposé du joueur, borné par l'arène comme le fait le cœur. S'il ne l'éloigne
// pas, le Chirurgien est acculé : il attend le joueur et le frappe dès qu'il est à portée de Scalpel.
const flee = (self: Creature, player: Vec2): Intent => {
  const d = dist(self.pos, player)
  const away = d < 1e-9 ? fromAngle(self.facing) : norm(sub(self.pos, player))
  const h = TUNING.arenaHalf - radiusOf(self)
  const next = add(self.pos, scale(away, C.speed / TICK_HZ))
  const to = { x: Math.max(-h, Math.min(h, next.x)), z: Math.max(-h, Math.min(h, next.z)) }
  if (dist(to, player) > d) return { kind: 'moveTo', target: to }
  if (d <= C.scalpel.reach + TUNING.playerRadius) return { kind: 'act', action: 'scalpel', target: player }
  return IDLE
}

export const chirurgien: FamilyModule = {
  kind: 'chirurgien',
  size: 'small',
  isSupport: true,
  base: { chair: C.chair, speed: C.speed, limbs: [] },
  actions: {
    scalpel: {
      kind: 'attaque',
      telegraphTicks: C.scalpel.telegraph,
      recoverTicks: C.scalpel.recover,
      reach: C.scalpel.reach,
      arcDeg: C.scalpel.arcDeg,
    },
    // Portée indicative : le contact avec un grand corps sans Cicatrice. La condition réelle est le contact
    // (somme des rayons), qui grandit avec les Cicatrices.
    recoudre: {
      kind: 'canalisation',
      telegraphTicks: 0,
      recoverTicks: 0,
      channelTicks: C.operation,
      reach: TUNING.radiusSmall + TUNING.radiusLarge,
    },
    assembler: {
      kind: 'canalisation',
      telegraphTicks: 0,
      recoverTicks: 0,
      channelTicks: C.operation,
      reach: TUNING.radiusSmall + TUNING.radiusLarge,
    },
  },
  decide: (world, self) => {
    const player = world.player.pos
    if (dist(self.pos, player) <= C.fleeRadius) return flee(self, player)
    return repairIntent(world, self) ?? assembleIntent(world, self) ?? IDLE
  },
  resolve: (world, self, action) => {
    if (action.name === 'scalpel') {
      return [
        {
          kind: 'damage',
          area: {
            kind: 'cone',
            origin: self.pos,
            facing: self.facing,
            reach: C.scalpel.reach,
            arcDeg: C.scalpel.arcDeg,
          },
          amount: C.scalpel.damage,
          source: 'creature',
          abatSmall: false,
          staggerLarge: 0,
          hitsCreatures: false,
        },
      ]
    }
    if (typeof action.target !== 'number') return []
    if (action.name === 'recoudre') return [{ kind: 'repair', id: action.target }]
    if (action.name !== 'assembler') return []
    const anchor = byId(world, action.target)
    if (!anchor || !assemblable(anchor, self.id)) return []
    const group = groupAround(anchor, assemblableFor(world, self.id))
    return group.length >= 2 ? [{ kind: 'assemble', ids: group.map((b) => b.id) }] : []
  },
}
