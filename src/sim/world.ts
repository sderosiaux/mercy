// createWorld et step. Ordre des sous-pas d'un tick (déterministe) :
// joueur → créatures (par id) → L1 reptation et Membres errants → L2 cris → L7 proximité → L3 Relèvements
// → collisions et bornes → minuteries du joueur → L6 → tri par id, fin de vague.
import { memberTick } from './anatomy'
import { creaturesTick } from './creatures'
import { chairMaxFor, type Draft, emit, isStanding, type MCreature, radiusOf } from './draft'
import { MEMBRE } from './families/membre'
import { cryTick } from './laws/cry'
import { crawlTick } from './laws/flesh'
import { proximityTick } from './laws/indifference'
import { resetTick } from './laws/reset'
import { riseTick } from './laws/rise'
import { playerTick, playerTimersTick } from './player/bourreau'
import { nextFloat, seedRng } from './rng'
import { TUNING } from './tuning'
import type {
  Creature,
  CreatureState,
  FamilyRegistry,
  PlayerCommands,
  SimEvent,
  Variant,
  WaveDef,
  WeaponId,
  World,
} from './types'
import { add, dist, fromAngle, scale, sub, vec } from './vec'

export interface CreateWorldOptions {
  readonly seed: number
  readonly wave: WaveDef
  readonly variant: Variant
  readonly families: FamilyRegistry
  readonly weapon?: WeaponId // arme en main au départ (Couperet par défaut) ; le banc s'en sert pour jouer la Masse
}

export const createWorld = (opts: CreateWorldOptions): World => {
  const { wave, families } = opts
  let rng = seedRng(opts.seed)
  const draw = (): number => {
    const [v, next] = nextFloat(rng)
    rng = next
    return v
  }
  const events: SimEvent[] = []
  const creatures: Creature[] = wave.spawns.map((s, i) => {
    const id = i + 1
    const f = s.family === 'membre' ? MEMBRE : families[s.family]
    if (!f) throw new Error(`famille absente du registre : ${s.family}`)
    const state0 = s.state ?? 'rituel'
    if ((state0 === 'abattu' || state0 === 'mort') && !wave.test) {
      throw new Error(`état ${state0} réservé aux scènes de test (D12)`)
    }
    const angle = draw() * 2 * Math.PI
    const r = Math.sqrt(draw()) * wave.jitter.posM
    const pos = wave.jitter.posM > 0 ? add(s.pos, scale(fromAngle(angle), r)) : s.pos
    const ritualPhase = wave.jitter.ritualPhase ? draw() : 0
    const cicatrices = s.cicatrices ?? 0
    const resistant = cicatrices >= 3
    const chairMax = chairMaxFor(f.base.chair, cicatrices)
    const state: CreatureState =
      state0 === 'rituel'
        ? { kind: 'rituel' }
        : state0 === 'hostile'
          ? { kind: 'hostile', alertedAt: 0 }
          : state0 === 'abattu'
            ? {
                kind: 'abattu',
                since: 0,
                riseAt: resistant ? TUNING.relevementResistant : TUNING.relevementOrdinaire,
                cryAt: TUNING.criDelai,
                claimedBy: null,
              }
            : { kind: 'mort', at: 0 }
    if (state.kind === 'abattu') events.push({ type: 'fell', tick: 0, id })
    const facing = s.facing ?? 0
    return {
      id,
      family: s.family,
      size: f.size,
      pos,
      facing,
      chair: state.kind === 'abattu' || state.kind === 'mort' ? 0 : chairMax,
      chairMax,
      cicatrices,
      resistant,
      state,
      unionOf: null,
      limbs: f.base.limbs.map((l) => ({ id: l.id, hp: l.hp, hpMax: l.hp, state: 'ok' as const })),
      action: null,
      stunnedUntil: 0,
      spawn: { pos, facing, state: state0, cicatrices, group: s.group ?? null, ritualPhase },
      group: s.group ?? null,
      ritualPhase,
      familyData: {},
    }
  })
  return {
    tick: 0,
    seed: opts.seed,
    rng,
    variant: opts.variant,
    player: {
      pos: wave.playerStart,
      facing: 0,
      vie: TUNING.vieMax,
      ferveur: 0,
      lastFerveurGain: 0,
      weapon: opts.weapon ?? 'couperet',
      comboStep: 0,
      dodgeCharges: TUNING.dodge.charges,
      dodgeRechargeAt: null,
      invulnerableUntil: 0,
      action: null,
      buffer: null,
      deaths: 0,
      spawnPos: wave.playerStart,
    },
    creatures,
    nextId: creatures.length + 1,
    events,
    wave: { id: wave.id, test: wave.test, endedAt: null },
    families,
  }
}

const toDraft = (w: World): Draft => ({
  tick: w.tick + 1,
  seed: w.seed,
  rng: w.rng,
  variant: w.variant,
  player: { ...w.player },
  creatures: w.creatures.map((c) => ({ ...c })),
  nextId: w.nextId,
  events: [],
  wave: { ...w.wave },
  families: w.families,
})

const clamp = (p: { x: number; z: number }, r: number) => {
  const h = TUNING.arenaHalf - r
  return vec(Math.max(-h, Math.min(h, p.x)), Math.max(-h, Math.min(h, p.z)))
}

const collisionsTick = (d: Draft): void => {
  const standing = d.creatures.filter(isStanding)
  // Créatures entre elles : écartement symétrique, paires dans l'ordre des id.
  for (let i = 0; i < standing.length; i++) {
    for (let j = i + 1; j < standing.length; j++) {
      const a = standing[i] as MCreature
      const b = standing[j] as MCreature
      const min = radiusOf(a) + radiusOf(b)
      const dd = dist(a.pos, b.pos)
      if (dd >= min) continue
      const dir = dd < 1e-9 ? fromAngle((a.id * 2.399963) % (2 * Math.PI)) : scale(sub(b.pos, a.pos), 1 / dd)
      const push = (min - dd) / 2
      a.pos = sub(a.pos, scale(dir, push))
      b.pos = add(b.pos, scale(dir, push))
    }
  }
  // Le joueur ne traverse pas une créature debout, sauf pendant une Esquive ou une Charge.
  const p = d.player
  const passes = p.action?.kind === 'esquive' || p.action?.kind === 'charge'
  if (!passes) {
    for (const c of standing) {
      const min = radiusOf(c) + TUNING.playerRadius
      const dd = dist(p.pos, c.pos)
      if (dd >= min) continue
      const dir = dd < 1e-9 ? vec(-1, 0) : scale(sub(p.pos, c.pos), 1 / dd)
      p.pos = add(c.pos, scale(dir, min))
    }
  }
  p.pos = clamp(p.pos, TUNING.playerRadius)
  for (const c of d.creatures) if (c.state.kind !== 'absorbe') c.pos = clamp(c.pos, radiusOf(c))
}

const waveEndTick = (d: Draft): void => {
  if (d.wave.endedAt !== null || d.creatures.length === 0) return
  if (d.creatures.every((c) => c.state.kind === 'mort')) {
    d.wave.endedAt = d.tick
    emit(d, { type: 'wave-end', tick: d.tick })
  }
}

export const step = (world: World, cmds: PlayerCommands): World => {
  const d = toDraft(world)
  playerTick(d, cmds)
  creaturesTick(d)
  crawlTick(d)
  memberTick(d)
  cryTick(d)
  proximityTick(d)
  riseTick(d)
  collisionsTick(d)
  playerTimersTick(d)
  resetTick(d)
  d.creatures.sort((a, b) => a.id - b.id)
  waveEndTick(d)
  return d
}
