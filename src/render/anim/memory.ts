// Mémoire d'animation : ce que l'état d'un seul monde ne dit pas, tiré des mondes observés tick après tick
// (renderer.observe, appelé après chaque step). Pour chaque corps : la suite des états de base (« segments »,
// avec le tick où chacun commence), les coups reçus, le chemin parcouru (odomètre, qui fait avancer les clips de
// locomotion au rythme réel des pas). La pose d'une image est ensuite une fonction pure de cette mémoire et de
// l'horloge de rendu (machine.ts) : rendre deux fois la même paire de mondes donne la même image (B2 I2).
//
// Rien ici ne dépend des clips : les durées sont résolues au rendu, avec le catalogue du modèle.
import {
  type Creature,
  type Player,
  PORTEUR_STAGE_KEY,
  type SimEvent,
  TUNING,
  type World,
} from '../../sim/index'
import { INTERRUPT_FADE_FRAMES } from './playback'

// Fondu entre deux états de base qui ne viennent pas d'un coup (forme, E2) : 6 ticks (0,1 s).
export const BASE_FADE_TICKS = 6

export type BaseKey =
  | { readonly kind: 'rituel' }
  | { readonly kind: 'loco'; readonly variant: 'normal' | 'stade3' | 'recul' }
  | {
      readonly kind: 'attack'
      readonly name: string
      readonly start: number
      readonly activeAt: number
      readonly end: number
    }
  | { readonly kind: 'channel'; readonly name: string; readonly start: number; readonly down: boolean }
  | { readonly kind: 'stun'; readonly from: number; readonly until: number }
  | {
      readonly kind: 'down'
      readonly since: number
      readonly placed: boolean
      readonly mode: 'twist' | 'crawl'
    }
  | { readonly kind: 'rise'; readonly from: number; readonly at: number }
  | { readonly kind: 'absorb'; readonly at: number }
  // Joueur (Bourreau)
  | { readonly kind: 'player-idle'; readonly moving: boolean }
  | {
      readonly kind: 'player-action'
      readonly action: 'frappe' | 'esquive' | 'balayage' | 'charge' | 'sentence'
      readonly start: number
      readonly activeAt: number | null // Frappe, Balayage : tick d'impact de la simulation (après l'anticipation)
      readonly end: number
      readonly comboStep: number
      readonly weapon: string
      readonly targetSize: 'small' | 'large'
    }

export interface Segment {
  readonly key: BaseKey
  readonly sig: string
  readonly from: number // tick où le segment devient actif (poids 0 à ce tick, puis fondu)
  readonly fade: number // ticks
}

export interface Hit {
  readonly tick: number
  readonly interrupting: boolean // coupe l'action en cours (petite créature, ou interruption de la simulation)
  readonly standing: boolean // reçu debout (réaction) ; à terre : soubresaut
}

export interface Track {
  readonly segments: Segment[] // les derniers, du plus ancien au plus récent
  readonly hits: Hit[]
  readonly odo: { tick: number; value: number }[] // odomètre (m) aux derniers ticks observés
  lastPos: { x: number; z: number } | null
  stunFrom: number
  deathTick: number | null
  lastAbsorb: number
}

const MAX_SEGMENTS = 4
const MAX_HITS = 4

const sigOf = (k: BaseKey): string => {
  switch (k.kind) {
    case 'rituel':
      return 'rituel'
    case 'loco':
      return `loco:${k.variant}`
    case 'attack':
      return `attack:${k.name}:${k.start}:${k.activeAt}`
    case 'channel':
      return `channel:${k.name}:${k.start}:${k.down ? 1 : 0}`
    case 'stun':
      return `stun:${k.from}`
    case 'down':
      return `down:${k.since}:${k.mode}`
    case 'rise':
      return `rise:${k.from}`
    case 'absorb':
      return `absorb:${k.at}`
    case 'player-idle':
      return `player-idle:${k.moving ? 1 : 0}`
    case 'player-action':
      return `player:${k.action}:${k.start}`
  }
}

const newTrack = (): Track => ({
  segments: [],
  hits: [],
  odo: [],
  lastPos: null,
  stunFrom: -1,
  deathTick: null,
  lastAbsorb: Number.NEGATIVE_INFINITY,
})

// Un Abattu placé par une scène de test (D12) n'a pas eu de chute à l'écran (même règle que le rig du jalon 1).
export const isPlaced = (c: Creature): boolean =>
  c.state.kind === 'abattu' && c.spawn?.state === 'abattu' && c.cicatrices === c.spawn.cicatrices

export const STEP_EPS = 1e-4 // m par tick : en dessous, le corps ne s'est pas déplacé

// État de base d'une créature au tick T (catalogue non requis). `step` : pas fait pendant ce tick (m).
export const creatureKey = (c: Creature, T: number, track: Track, step: number): BaseKey | null => {
  const st = c.state
  if (st.kind === 'mort' || st.kind === 'absorbe') return null
  const a = c.action
  if (st.kind === 'abattu') {
    if (a && a.kind === 'canalisation' && T < a.end)
      return { kind: 'channel', name: a.name, start: a.start, down: true }
    if (st.riseAt !== null && T >= st.riseAt - TUNING.relevementTelegraph)
      return { kind: 'rise', from: st.riseAt - TUNING.relevementTelegraph, at: st.riseAt }
    return { kind: 'down', since: st.since, placed: isPlaced(c), mode: step > STEP_EPS ? 'crawl' : 'twist' }
  }
  if (st.kind === 'rituel') return { kind: 'rituel' }
  if (c.stunnedUntil > T)
    return { kind: 'stun', from: track.stunFrom >= 0 ? track.stunFrom : T, until: c.stunnedUntil }
  if (a && T < a.end) {
    if (a.kind === 'attaque')
      return { kind: 'attack', name: a.name, start: a.start, activeAt: a.activeAt, end: a.end }
    if (a.kind === 'canalisation') return { kind: 'channel', name: a.name, start: a.start, down: false }
  }
  if (step <= STEP_EPS && T - track.lastAbsorb < TUNING.porteur.absorbEvery)
    return { kind: 'absorb', at: track.lastAbsorb }
  if (c.family === 'porteur' && (c.familyData[PORTEUR_STAGE_KEY] ?? 0) >= TUNING.porteur.maxStage)
    return { kind: 'loco', variant: 'stade3' }
  return { kind: 'loco', variant: 'normal' }
}

export const playerKey = (w: World, T: number, step: number): BaseKey => {
  const p: Player = w.player
  const a = p.action
  if (a && T < a.end) {
    const target = a.target === undefined ? undefined : w.creatures.find((c) => c.id === a.target)
    return {
      kind: 'player-action',
      action: a.kind,
      start: a.start,
      activeAt: a.activeAt ?? null,
      end: a.end,
      comboStep: a.comboStep ?? 0,
      weapon: p.weapon,
      targetSize: target?.size ?? 'small',
    }
  }
  return { kind: 'player-idle', moving: step > STEP_EPS }
}

// Recul du Confesseur : il se déplace à l'opposé de son orientation (il garde le joueur en face).
const backward = (c: Creature, dx: number, dz: number): boolean =>
  dx * Math.cos(c.facing) + dz * Math.sin(c.facing) < -STEP_EPS

// Clé de la piste du joueur (hors de l'espace des ids de créatures).
export const PLAYER_TRACK = -1

// Un geste du Bourreau (Frappe, Balayage) encore dans son anticipation au tick T : ce qui le remplace à T le coupe
// avant l'impact (la simulation n'a pas frappé).
export const cutsWindup = (k: BaseKey, T: number): boolean =>
  k.kind === 'player-action' && k.activeAt !== null && T < k.activeAt && T < k.end

const struckId = (e: SimEvent): number | null => {
  if (e.type === 'hit') return e.target === 'player' ? null : e.target
  if (e.type === 'action-interrupted' || e.type === 'fell' || e.type === 'clang') return e.id
  return null
}

export class AnimMemory {
  readonly tracks = new Map<number, Track>()
  lastTick = Number.NEGATIVE_INFINITY
  private lastWorld: World | null = null

  clear(): void {
    this.tracks.clear()
    this.lastTick = Number.NEGATIVE_INFINITY
    this.lastWorld = null
  }

  track(id: number): Track | undefined {
    return this.tracks.get(id)
  }

  private ensure(id: number): Track {
    let t = this.tracks.get(id)
    if (!t) {
      t = newTrack()
      this.tracks.set(id, t)
    }
    return t
  }

  private push(track: Track, key: BaseKey, T: number, fade: number): void {
    const sig = sigOf(key)
    const last = track.segments[track.segments.length - 1]
    if (last && last.sig === sig) return
    track.segments.push({ key, sig, from: T, fade })
    if (track.segments.length > MAX_SEGMENTS) track.segments.shift()
  }

  // Avance l'odomètre au tick T ; renvoie le pas (m) fait depuis le tick observé précédent.
  private odometer(track: Track, T: number, x: number, z: number): number {
    const prev = track.lastPos
    const d = prev ? Math.hypot(x - prev.x, z - prev.z) : 0
    // Un saut (réinitialisation, projection d'éclatement) n'est pas une foulée.
    const step = d > 1 ? 0 : d
    const last = track.odo[track.odo.length - 1]
    track.odo.push({ tick: T, value: (last?.value ?? 0) + step })
    if (track.odo.length > 3) track.odo.shift()
    track.lastPos = { x, z }
    return step
  }

  // Un monde de plus. Un tick qui recule (nouvelle partie, laboratoire qui rembobine) efface tout.
  observe(w: World): void {
    if (w === this.lastWorld) return
    if (w.tick <= this.lastTick) this.clear()
    if (w.events.some((e) => e.type === 'reset')) {
      // L6 : tout ce qui n'est pas mort revient à son état d'origine ; les corps morts gardent leur pose.
      for (const [id, tr] of this.tracks) if (tr.deathTick === null) this.tracks.delete(id)
    }
    const T = w.tick
    const byId = new Map<number, SimEvent[]>()
    for (const e of w.events) {
      const id = struckId(e)
      if (id === null) continue
      const list = byId.get(id) ?? []
      list.push(e)
      byId.set(id, list)
    }
    const present = new Set<number>()
    for (const c of w.creatures) {
      present.add(c.id)
      const tr = this.ensure(c.id)
      const before = tr.lastPos
      const step = this.odometer(tr, T, c.pos.x, c.pos.z)
      if (c.state.kind === 'mort') {
        if (tr.deathTick === null) tr.deathTick = c.state.at
        continue
      }
      tr.deathTick = null
      if (c.stunnedUntil > T) {
        if (tr.stunFrom < 0) tr.stunFrom = T
      } else tr.stunFrom = -1
      if (w.events.some((e) => e.type === 'absorb' && e.id === c.id)) tr.lastAbsorb = T
      const evs = byId.get(c.id) ?? []
      const standing = c.state.kind === 'rituel' || c.state.kind === 'hostile'
      if (evs.some((e) => e.type === 'hit' || e.type === 'clang')) {
        const interrupting = c.size === 'small' || evs.some((e) => e.type === 'action-interrupted')
        tr.hits.push({ tick: T, interrupting, standing })
        if (tr.hits.length > MAX_HITS) tr.hits.shift()
      }
      let key = creatureKey(c, T, tr, step)
      if (
        key?.kind === 'loco' &&
        c.family === 'confesseur' &&
        before &&
        backward(c, c.pos.x - before.x, c.pos.z - before.z)
      )
        key = { kind: 'loco', variant: 'recul' }
      if (!key) continue
      const fromHit = evs.some((e) => e.type === 'fell' || e.type === 'action-interrupted')
      this.push(tr, key, T, fromHit ? INTERRUPT_FADE_FRAMES : BASE_FADE_TICKS)
    }
    // Le joueur : mêmes segments, sans coups.
    const ptr = this.ensure(PLAYER_TRACK)
    const pstep = this.odometer(ptr, T, w.player.pos.x, w.player.pos.z)
    const pk = playerKey(w, T, pstep)
    // Une action du Bourreau part dès l'image de la commande (anticipation d'une Frappe ou d'un Balayage, ou geste
    // sans impact). Une action qui coupe un geste avant son impact (Esquive pendant l'anticipation) l'interrompt
    // comme une réaction : fondu de la recette d'interruption, le geste coupé figé (machine.ts, sans impact).
    const prev = ptr.segments[ptr.segments.length - 1]
    const cut = prev !== undefined && cutsWindup(prev.key, T)
    this.push(ptr, pk, T, cut ? INTERRUPT_FADE_FRAMES : pk.kind === 'player-action' ? 0 : BASE_FADE_TICKS)
    for (const id of [...this.tracks.keys()])
      if (id !== PLAYER_TRACK && !present.has(id)) this.tracks.delete(id)
    this.lastTick = T
    this.lastWorld = w
  }
}

// Odomètre interpolé à l'horloge de rendu t (ticks) : linéaire entre les deux derniers ticks observés.
export const odometerAt = (track: Track, t: number): number => {
  const o = track.odo
  if (o.length === 0) return 0
  const last = o[o.length - 1] as { tick: number; value: number }
  if (t >= last.tick || o.length === 1) return last.value
  for (let i = o.length - 1; i > 0; i--) {
    const b = o[i] as { tick: number; value: number }
    const a = o[i - 1] as { tick: number; value: number }
    if (t >= a.tick) return a.value + ((b.value - a.value) * (t - a.tick)) / Math.max(1, b.tick - a.tick)
  }
  return (o[0] as { value: number }).value
}
