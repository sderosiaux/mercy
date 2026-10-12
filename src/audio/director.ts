// Directeur audio : à chaque tick, lit le monde et ses évènements et décide quoi jouer, couper, fondre.
// Fonction pure (état précédent, monde, auditeur, temps audio) → (état suivant, commandes). Les commandes sont
// appliquées au graphe Web Audio par graph.ts, qui écrit le journal I1 dans les mêmes appels.
import {
  type Creature,
  type EntityId,
  PORTEUR_STAGE_KEY,
  type SimEvent,
  TICK_HZ,
  type Tick,
  TUNING,
  type Vec2,
  voiceSeed,
  type World,
} from '../sim/index'
import { allocate, emptySlots, rankBodies, type Slot } from './alloc'
import { SOFT_FADE_S } from './constants'
import { DUCK_IDLE, type DuckCmd, type DuckState, duckStep } from './duck'
import {
  deathIdsOf,
  type EndCause,
  type EndMode,
  endModeFor,
  sourceEndCause,
  vocalising,
  voiceEndCause,
} from './ends'
import { pick } from './manifest'

export type Phase = 'halètement' | 'cri' | 'inspiration'
export type SourceKind = 'gargouillis' | 'chant' | 'scie' | 'coutures'
export type OneShotKind = 'impact-tranchant' | 'impact-contondant' | 'clang' | 'mat'

// Fichiers disponibles par rôle (ids du manifeste, triés).
export interface Pools {
  readonly cri: readonly string[]
  readonly halete: readonly string[]
  readonly inspire: readonly string[]
  readonly etouffe: readonly string[]
}

export type Cmd =
  | {
      readonly t: 'voice-start'
      readonly slot: number
      readonly id: EntityId
      readonly phase: Phase
      readonly muffled: boolean
      readonly file: string
      readonly pos: Vec2
    }
  | {
      readonly t: 'voice-phase'
      readonly slot: number
      readonly id: EntityId
      readonly phase: Phase
      readonly muffled: boolean
      readonly file: string
    }
  | {
      readonly t: 'voice-end'
      readonly slot: number
      readonly id: EntityId
      readonly mode: EndMode
      readonly cause: EndCause
    }
  | {
      readonly t: 'src-start'
      readonly key: string
      readonly id: EntityId
      readonly kind: SourceKind
      readonly rate: number
      readonly offsetS: number
      readonly pos: Vec2
    }
  | { readonly t: 'src-rate'; readonly key: string; readonly rate: number }
  | {
      readonly t: 'src-end'
      readonly key: string
      readonly id: EntityId
      readonly mode: EndMode
      readonly cause: EndCause
      readonly strangle: boolean // prière interrompue : le chant s'éteint sur un étranglement (§8.10)
    }
  | { readonly t: 'pos'; readonly slot: number | null; readonly key: string | null; readonly pos: Vec2 }
  | {
      readonly t: 'oneshot'
      readonly kind: OneShotKind
      readonly id: EntityId | null
      readonly pos: Vec2 | null
    }
  | { readonly t: 'nappe'; readonly n: number; readonly prev: number }
  | DuckCmd

interface VoiceRec {
  readonly slot: number
  readonly phase: Phase
  readonly muffled: boolean
  readonly file: string
}

interface SourceRec {
  readonly key: string // unique : `${id}:${kind}:${tick de début}`
  readonly id: EntityId
  readonly kind: SourceKind
  readonly rate: number
}

export interface DirectorState {
  readonly tick: Tick | null
  readonly slots: readonly Slot[]
  readonly voices: ReadonlyMap<EntityId, VoiceRec>
  readonly phases: ReadonlyMap<EntityId, Phase> // phase de chaque corps qui vocalise, voix ou non
  readonly sources: ReadonlyMap<string, SourceRec> // clé : `${id}:${kind}`
  readonly fadingSources: ReadonlyMap<string, { readonly id: EntityId; readonly until: Tick }>
  readonly duck: DuckState
  readonly nappeN: number
}

export const initialDirector = (): DirectorState => ({
  tick: null,
  slots: emptySlots(),
  voices: new Map(),
  phases: new Map(),
  sources: new Map(),
  fadingSources: new Map(),
  duck: DUCK_IDLE,
  nappeN: -1,
})

// Ticks pendant lesquels un emplacement en fondu reste occupé : le fondu, arrondi au tick supérieur.
export const FADE_TICKS = Math.ceil(SOFT_FADE_S * TICK_HZ)

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)

const initialPhase = (c: Creature, t: Tick): Phase => {
  const s = c.state
  if (
    s.kind === 'abattu' &&
    s.riseAt !== null &&
    s.claimedBy === null &&
    t >= s.riseAt - TUNING.relevementTelegraph
  )
    return 'inspiration'
  const cryAt = s.kind === 'abattu' || s.kind === 'absorbe' ? s.cryAt : null
  return cryAt !== null && t >= cryAt ? 'cri' : 'halètement'
}

export const voiceFile = (pools: Pools, seed: number, phase: Phase, muffled: boolean): string =>
  muffled
    ? pick(pools.etouffe, seed, 4)
    : phase === 'halètement'
      ? pick(pools.halete, seed, 1)
      : phase === 'cri'
        ? pick(pools.cri, seed, 2)
        : pick(pools.inspire, seed, 3)

// Sources hors voix voulues pour une créature (§19) : gargouillis du sac (un ton par stade), chant de prière,
// scie d'opération, coutures d'un Recousu debout.
const wantedSources = (c: Creature): { kind: SourceKind; rate: number }[] => {
  if (c.state.kind === 'mort') return []
  const out: { kind: SourceKind; rate: number }[] = []
  const stage = c.familyData[PORTEUR_STAGE_KEY] ?? 0
  if (c.family === 'porteur' && stage >= 1)
    out.push({ kind: 'gargouillis', rate: 2 ** ((2 * (stage - 1)) / 12) })
  if (c.action?.name === 'priere') out.push({ kind: 'chant', rate: 1 })
  if (c.action?.name === 'recoudre' || c.action?.name === 'assembler') out.push({ kind: 'scie', rate: 1 })
  if (c.family === 'recousu' && (c.state.kind === 'rituel' || c.state.kind === 'hostile'))
    out.push({ kind: 'coutures', rate: 1 })
  return out
}

const weaponImpact = (w: World): OneShotKind =>
  TUNING.weapons[w.player.weapon].type === 'tranchant' ? 'impact-tranchant' : 'impact-contondant'

const oneShots = (w: World, byId: ReadonlyMap<EntityId, Creature>, events: readonly SimEvent[]): Cmd[] => {
  const out: Cmd[] = []
  const impacted = new Set<EntityId>()
  const posOf = (id: EntityId): Vec2 | null => byId.get(id)?.pos ?? null
  for (const e of events) {
    if (e.type === 'hit' && e.by === 'player' && e.target !== 'player' && !impacted.has(e.target)) {
      if (e.damageType !== 'tranchant' && e.damageType !== 'contondant') continue
      impacted.add(e.target)
      out.push({
        t: 'oneshot',
        kind: e.damageType === 'tranchant' ? 'impact-tranchant' : 'impact-contondant',
        id: e.target,
        pos: posOf(e.target),
      })
    } else if (e.type === 'death' && e.by !== 'union' && !impacted.has(e.id)) {
      impacted.add(e.id)
      out.push({ t: 'oneshot', kind: weaponImpact(w), id: e.id, pos: posOf(e.id) })
    } else if (e.type === 'clang') {
      out.push({ t: 'oneshot', kind: 'clang', id: e.id, pos: posOf(e.id) })
    } else if (e.type === 'sentence-none') {
      out.push({ t: 'oneshot', kind: 'mat', id: null, pos: null })
    }
  }
  return out
}

export interface Directed {
  readonly state: DirectorState
  readonly cmds: readonly Cmd[]
  readonly ranked: readonly { readonly id: EntityId; readonly dist: number; readonly rank: number }[]
  readonly n: number
}

export const direct = (s: DirectorState, w: World, listener: Vec2, now: number, pools: Pools): Directed => {
  const t = w.tick
  const events = w.events
  const byId = new Map(w.creatures.map((c) => [c.id, c]))
  const deaths = deathIdsOf(events)
  const reset = events.some((e) => e.type === 'reset')
  const cmds: Cmd[] = []
  const slots: Slot[] = [...s.slots]
  const voices = new Map(s.voices)

  // Phases (B5 « Définitions communes ») : halètement depuis `fell`, cri depuis `cry-start`, inspiration depuis
  // `rise-telegraph`. Un `fell` d'expulsion recalcule la phase depuis l'état.
  const phases = new Map<EntityId, Phase>()
  for (const c of w.creatures) {
    if (!vocalising(c, byId)) continue
    let p = s.phases.get(c.id) ?? initialPhase(c, t)
    for (const e of events) {
      if (!('id' in e) || e.id !== c.id) continue
      if (e.type === 'cry-start') p = 'cri'
      else if (e.type === 'rise-telegraph') p = 'inspiration'
      else if (e.type === 'fell') p = initialPhase(c, t)
    }
    phases.set(c.id, p)
  }

  // Fins de voix.
  for (const [id, v] of s.voices) {
    const c = byId.get(id)
    const cause = voiceEndCause(id, c, events, byId)
    if (cause === undefined) {
      const phase = phases.get(id) ?? v.phase
      const muffled = c?.state.kind === 'absorbe'
      if (phase !== v.phase || muffled !== v.muffled) {
        const file = voiceFile(pools, voiceSeed(w, id), phase, muffled)
        voices.set(id, { slot: v.slot, phase, muffled, file })
        cmds.push({ t: 'voice-phase', slot: v.slot, id, phase, muffled, file })
      }
      continue
    }
    const mode = endModeFor(cause)
    cmds.push({ t: 'voice-end', slot: v.slot, id, mode, cause })
    voices.delete(id)
    // Un emplacement coupé est libre dès ce tick (B5.O1, O8 b) : une chute du même tick (Balayage qui tue et abat)
    // y prend sa voix tout de suite. Le graphe la démarre après la rampe de coupure (graph.ts, slotCutEnd).
    slots[v.slot] = { kind: 'ending', id, freeAt: mode === 'cut' ? t : t + FADE_TICKS }
  }
  // Une mort coupe aussi une voix déjà en fondu (volée, relevée…) : rien ne survit à la mort.
  slots.forEach((sl, i) => {
    if (
      sl.kind === 'ending' &&
      t < sl.freeAt &&
      deaths.has(sl.id) &&
      !cmds.some((c) => c.t === 'voice-end' && c.slot === i)
    ) {
      cmds.push({ t: 'voice-end', slot: i, id: sl.id, mode: 'cut', cause: 'mort' })
      slots[i] = { kind: 'ending', id: sl.id, freeAt: t }
    }
  })

  // Sources hors voix.
  const sources = new Map(s.sources)
  const fading = new Map([...s.fadingSources].filter(([, f]) => t < f.until))
  for (const [key, f] of fading) {
    if (deaths.has(f.id)) {
      cmds.push({ t: 'src-end', key, id: f.id, mode: 'cut', cause: 'mort', strangle: false })
      fading.delete(key)
    }
  }
  const wanted = new Map<string, { c: Creature; kind: SourceKind; rate: number }>()
  if (!reset) {
    for (const c of w.creatures) {
      if (deaths.has(c.id)) continue
      for (const ws of wantedSources(c)) wanted.set(`${c.id}:${ws.kind}`, { c, ...ws })
    }
  }
  for (const [slotKey, src] of s.sources) {
    const want = wanted.get(slotKey)
    if (want) {
      if (want.rate !== src.rate) {
        sources.set(slotKey, { ...src, rate: want.rate })
        cmds.push({ t: 'src-rate', key: src.key, rate: want.rate })
      }
      continue
    }
    const c = byId.get(src.id)
    const cause = sourceEndCause(src.id, c, events)
    const mode = endModeFor(cause)
    const strangle =
      src.kind === 'chant' &&
      mode === 'fade' &&
      events.some((e) => e.type === 'action-interrupted' && e.id === src.id && e.action === 'priere')
    cmds.push({ t: 'src-end', key: src.key, id: src.id, mode, cause, strangle })
    sources.delete(slotKey)
    if (mode === 'fade') fading.set(src.key, { id: src.id, until: t + FADE_TICKS + (strangle ? TICK_HZ : 0) })
  }
  for (const [slotKey, want] of wanted) {
    if (sources.has(slotKey)) continue
    const key = `${slotKey}:${t}`
    const a = want.c.action
    const offsetS =
      (want.kind === 'chant' || want.kind === 'scie') && a ? Math.max(0, t - a.start) / TICK_HZ : 0
    sources.set(slotKey, { key, id: want.c.id, kind: want.kind, rate: want.rate })
    cmds.push({
      t: 'src-start',
      key,
      id: want.c.id,
      kind: want.kind,
      rate: want.rate,
      offsetS,
      pos: want.c.pos,
    })
  }

  // Budget de 24 voix.
  const bodies = w.creatures
    .filter((c) => vocalising(c, byId))
    .map((c) => ({ id: c.id, dist: dist(c.pos, listener) }))
  const ranked = rankBodies(bodies)
  if (!reset) {
    const alloc = allocate(ranked, slots, t)
    for (const st of alloc.steal) {
      cmds.push({ t: 'voice-end', slot: st.slot, id: st.id, mode: 'fade', cause: 'vol' })
      voices.delete(st.id)
      slots[st.slot] = { kind: 'ending', id: st.id, freeAt: t + FADE_TICKS }
    }
    for (const as of alloc.assign) {
      const c = byId.get(as.id) as Creature
      const phase = phases.get(as.id) ?? initialPhase(c, t)
      const muffled = c.state.kind === 'absorbe'
      const file = voiceFile(pools, voiceSeed(w, as.id), phase, muffled)
      voices.set(as.id, { slot: as.slot, phase, muffled, file })
      slots[as.slot] = { kind: 'voice', id: as.id }
      cmds.push({ t: 'voice-start', slot: as.slot, id: as.id, phase, muffled, file, pos: c.pos })
    }
  }
  slots.forEach((sl, i) => {
    if (sl.kind === 'ending' && t >= sl.freeAt) slots[i] = { kind: 'free' }
  })

  // Positions des sources à chaque tick (B2 I5, B5 I1).
  for (const [id, v] of voices) {
    const c = byId.get(id)
    if (c) cmds.push({ t: 'pos', slot: v.slot, key: null, pos: c.pos })
  }
  for (const src of sources.values()) {
    const c = byId.get(src.id)
    if (c) cmds.push({ t: 'pos', slot: null, key: src.key, pos: c.pos })
  }

  cmds.push(...oneShots(w, byId, events))

  const d = duckStep(s.duck, deaths.size > 0, now)
  if (d.cmd) cmds.push(d.cmd)

  // Nappe : N créatures non mortes (§19, §26).
  const n = w.creatures.filter((c) => c.state.kind !== 'mort').length
  if (n !== s.nappeN) cmds.push({ t: 'nappe', n, prev: s.nappeN })

  return {
    state: { tick: t, slots, voices, phases, sources, fadingSources: fading, duck: d.state, nappeN: n },
    cmds,
    ranked,
    n,
  }
}
