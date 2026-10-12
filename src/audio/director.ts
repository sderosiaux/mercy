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
import {
  AGONIE_TICKS,
  AGONY_LANES,
  AGONY_RATE_SPREAD,
  DUCK_HOLD_AFTER_DEATH_S,
  FADE_TICKS,
  VOICE_DUCK_HOLD_S,
  VOICE_DUCK_RELEASE_S,
  VOICE_SLOTS,
} from './constants'
import { DUCK_IDLE, type DuckCmd, type DuckState, duckStep } from './duck'
import {
  deathIdsOf,
  type EndCause,
  type EndMode,
  endModeFor,
  hasVoice,
  sourceEndCause,
  vocalising,
  voiceEndCause,
} from './ends'
import { mix, pick } from './manifest'

export { FADE_TICKS } from './constants'

export type Phase = 'halètement' | 'cri' | 'inspiration'
// Phase d'agonie d'une voix, de l'image du coup fatal à la fin de l'agonie (L4, §19).
export type AgonyPhase = 'râle'
export type SourceKind = 'gargouillis' | 'chant' | 'scie' | 'coutures'
export type OneShotKind = 'impact-tranchant' | 'impact-contondant' | 'clang' | 'mat'

// Fichiers disponibles par rôle (ids du manifeste, triés).
export interface Pools {
  readonly cri: readonly string[]
  readonly halete: readonly string[]
  readonly inspire: readonly string[]
  readonly etouffe: readonly string[]
  // Fichier de voix → fichier d'agonie qui le prolonge (champ `follows` du manifeste) : râle du même timbre.
  readonly agony: ReadonlyMap<string, string>
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
  // Mort (L4, §19, B5 A19) : `slot`, l'emplacement de la voix que le mort tenait (couche vivante), qui s'éteint en
  // STRANGLE_S dans son emplacement ; null s'il n'en tenait pas (debout, en attente, voix en fondu). `lane` et `file` :
  // le râle d'une mort qui râle, sur sa piste d'agonie, hors des 24 emplacements ; null pour une mort sans râle (rang
  // > 24, exécution silencieuse après une Sentence précoce) : la couche vivante s'éteint alors sans baisse de hauteur.
  | {
      readonly t: 'voice-agony'
      readonly slot: number | null
      readonly lane: number | null
      readonly id: EntityId
      readonly rank: number
      readonly file: string | null
      readonly rate: number
      readonly muffled: boolean
      readonly pos: Vec2
    }
  // Mort d'une créature : tout ce qui finit encore d'elle (fondu, étranglement) se tait au plus tard à la fin de
  // l'agonie.
  | { readonly t: 'death'; readonly id: EntityId }
  // Mort d'une créature d'une famille qui a une voix, sans râle : inaudible (rang > 24 sans voix tenue), exécution
  // silencieuse (Sentence avant le cri), ou, en principe jamais, aucune piste d'agonie libre.
  | { readonly t: 'agony-denied'; readonly id: EntityId; readonly reason: 'rang' | 'muet' | 'piste' }
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
  // Ducking des autres voix (D-fix3) : même grappe de morts que l'ambiance, tenue et remontée propres.
  | { readonly t: 'voice-duck-down'; readonly at: number; readonly releaseAt: number }
  | { readonly t: 'voice-duck-extend'; readonly releaseAt: number }

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
  readonly voiceDuck: DuckState
  readonly nappeN: number
  readonly absorbed: ReadonlySet<EntityId> // corps qui vocalisent dans un sac (voix étouffée), au tick précédent
  readonly lanes: readonly Tick[] // pistes d'agonie : tick où chacune se libère (libre si ≤ tick courant)
}

export const initialDirector = (): DirectorState => ({
  tick: null,
  slots: emptySlots(),
  voices: new Map(),
  phases: new Map(),
  sources: new Map(),
  fadingSources: new Map(),
  duck: DUCK_IDLE,
  voiceDuck: DUCK_IDLE,
  nappeN: -1,
  absorbed: new Set(),
  lanes: Array.from({ length: AGONY_LANES }, () => 0),
})

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

// Râle d'un mort : celui qui suit le cri que sa graine lui donne (même timbre), ou son cri étouffé s'il était dans un
// sac. Le même corps a donc toujours le même râle, quelle que soit sa phase à la mort.
export const agonyFile = (pools: Pools, seed: number, muffled: boolean): string => {
  const voice = muffled ? pick(pools.etouffe, seed, 4) : pick(pools.cri, seed, 2)
  const f = pools.agony.get(voice)
  if (f === undefined) throw new Error(`aucun fichier d'agonie ne suit ${voice} au manifeste`)
  return f
}

// Vitesse de lecture du râle, tirée de la graine du corps (B5 I3), arrondie au dix-millième.
export const agonyRate = (seed: number): number =>
  Math.round((1 + AGONY_RATE_SPREAD * ((2 * mix(seed, 5)) / 2 ** 32 - 1)) * 10_000) / 10_000

const weaponImpact = (w: World): OneShotKind =>
  TUNING.weapons[w.player.weapon].type === 'tranchant' ? 'impact-tranchant' : 'impact-contondant'

// Sons ponctuels d'un tick. Ils ne sont pas spatialisés (bus des impacts) : un coup qui touche N cibles jouerait N
// copies du même fichier au même échantillon, qui s'additionnent en phase (+20 log N dB : +15,6 dB pour 6 cibles,
// crêtes du master jusqu'à +26 dBFS au banc de B5) sans rien apprendre de plus au joueur. Une lecture par type et
// par tick ; le journal garde l'id de la première cible.
const oneShots = (w: World, byId: ReadonlyMap<EntityId, Creature>, events: readonly SimEvent[]): Cmd[] => {
  const out: Cmd[] = []
  const impacted = new Set<EntityId>()
  const played = new Set<OneShotKind>()
  const posOf = (id: EntityId): Vec2 | null => byId.get(id)?.pos ?? null
  const shot = (kind: OneShotKind, id: EntityId | null, pos: Vec2 | null): void => {
    if (played.has(kind)) return
    played.add(kind)
    out.push({ t: 'oneshot', kind, id, pos })
  }
  for (const e of events) {
    if (e.type === 'hit' && e.by === 'player' && e.target !== 'player' && !impacted.has(e.target)) {
      if (e.damageType !== 'tranchant' && e.damageType !== 'contondant') continue
      impacted.add(e.target)
      shot(e.damageType === 'tranchant' ? 'impact-tranchant' : 'impact-contondant', e.target, posOf(e.target))
    } else if (e.type === 'death' && e.by !== 'union' && !impacted.has(e.id)) {
      impacted.add(e.id)
      shot(weaponImpact(w), e.id, posOf(e.id))
    } else if (e.type === 'clang') {
      shot('clang', e.id, posOf(e.id))
    } else if (e.type === 'sentence-none') {
      shot('mat', null, null)
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

  // Morts du tick : tout ce qui finit encore d'elles (fondu d'une voix volée, étranglement d'une prière) se tait au plus
  // tard à la fin de l'agonie (graph.ts). Rien de la créature ne sonne après.
  for (const id of deaths) cmds.push({ t: 'death', id })

  // Fins de voix. La couche vivante d'un mort s'éteint en STRANGLE_S dans son emplacement, qui est attribuable dès ce
  // tick (une chute du même tick y prend sa voix, que le graphe démarre à la fin de l'extinction) ; le râle est
  // attribué plus bas, sur une piste d'agonie.
  const heldDying = new Map<EntityId, VoiceRec>()
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
    voices.delete(id)
    if (endModeFor(cause) === 'agonie') {
      heldDying.set(id, v)
      slots[v.slot] = { kind: 'ending', id, freeAt: t }
      continue
    }
    cmds.push({ t: 'voice-end', slot: v.slot, id, mode: 'fade', cause })
    slots[v.slot] = { kind: 'ending', id, freeAt: t + FADE_TICKS }
  }

  // Sources hors voix.
  const sources = new Map(s.sources)
  const fading = new Map([...s.fadingSources].filter(([, f]) => t < f.until))
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

  // Râles (L4, §19 ; option 2 de l'orchestrateur) : toute mort audible d'une créature d'une famille qui a une voix reçoit
  // un râle, debout ou à terre, sur une piste d'agonie à elle, pendant l'agonie. Audible : le mort tenait une voix, ou
  // il est au rang 24 au plus par distance parmi les corps qui vocalisent et les morts de ce tick. Au-delà, seule la
  // nappe baisse. Les pistes ne prennent rien aux 24 emplacements : une chute du même tick a toujours sa voix.
  // Exception (orchestrateur, 2026-10-12 ; L7 et précision de phase B) : un Abattu achevé par une Sentence avant son
  // cri reste muet, il ne râle pas ; la voix qu'il tenait (halètement) s'éteint pendant l'agonie, sur sa piste.
  const sentenced = new Set(events.flatMap((e) => (e.type === 'death' && e.by === 'sentence' ? [e.id] : [])))
  const lanes = [...s.lanes]
  const dyingIds = new Set([...deaths, ...heldDying.keys()])
  const dying = [...dyingIds]
    .map((id) => byId.get(id))
    .filter((c): c is Creature => c !== undefined && hasVoice(c.family))
  if (dying.length > 0) {
    // Rang de mort : parmi les corps qui vocalisent et les morts du tick, par distance puis id (B5, A19).
    const all = rankBodies([
      ...bodies,
      ...dying.map((c) => ({ id: c.id, dist: dist(c.pos, listener) })),
    ]).filter((b) => dyingIds.has(b.id))
    for (const b of all) {
      const held = heldDying.get(b.id)
      const mute = sentenced.has(b.id) && s.phases.get(b.id) === 'halètement'
      let lane: number | null = null
      if (b.rank > VOICE_SLOTS) cmds.push({ t: 'agony-denied', id: b.id, reason: 'rang' })
      else if (mute) cmds.push({ t: 'agony-denied', id: b.id, reason: 'muet' })
      else {
        // Piste libre depuis le plus longtemps : une piste n'est pas réouverte au tick même où elle se tait.
        let best = -1
        lanes.forEach((f, i) => {
          if (f <= t && (best < 0 || f < (lanes[best] as number))) best = i
        })
        if (best < 0) cmds.push({ t: 'agony-denied', id: b.id, reason: 'piste' })
        else lane = best
      }
      if (lane === null && held === undefined) continue
      if (lane !== null) lanes[lane] = t + AGONIE_TICKS
      const c = byId.get(b.id) as Creature
      const seed = voiceSeed(w, b.id)
      const muffled = held?.muffled ?? s.absorbed.has(b.id)
      cmds.push({
        t: 'voice-agony',
        slot: held?.slot ?? null,
        lane,
        id: b.id,
        rank: b.rank,
        file: lane === null ? null : agonyFile(pools, seed, muffled),
        rate: agonyRate(seed),
        muffled,
        pos: c.pos,
      })
    }
  }

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

  // Ducking d'une mise à mort : de la mort jusqu'à 0,4 s après la fin du râle (§8.2).
  const d = duckStep(s.duck, deaths.size > 0, now, DUCK_HOLD_AFTER_DEATH_S)
  if (d.cmd) cmds.push(d.cmd)
  const vd = duckStep(s.voiceDuck, deaths.size > 0, now, VOICE_DUCK_HOLD_S, VOICE_DUCK_RELEASE_S)
  if (vd.cmd)
    cmds.push(
      vd.cmd.t === 'duck-down'
        ? { t: 'voice-duck-down', at: vd.cmd.at, releaseAt: vd.cmd.releaseAt }
        : { t: 'voice-duck-extend', releaseAt: vd.cmd.releaseAt },
    )

  // Nappe : N créatures non mortes (§19, §26).
  const n = w.creatures.filter((c) => c.state.kind !== 'mort').length
  if (n !== s.nappeN) cmds.push({ t: 'nappe', n, prev: s.nappeN })

  return {
    state: {
      tick: t,
      slots,
      voices,
      phases,
      sources,
      fadingSources: fading,
      duck: d.state,
      voiceDuck: vd.state,
      nappeN: n,
      absorbed: new Set(
        w.creatures.filter((c) => c.state.kind === 'absorbe' && vocalising(c, byId)).map((c) => c.id),
      ),
      lanes,
    },
    cmds,
    ranked,
    n,
  }
}
