// Graphe Web Audio et journal I1. Chaque commande du directeur est appliquée ici, et le journal est écrit par
// ces mêmes fonctions, au moment où elles programment le graphe (B5 I1) : il n'existe pas de modèle parallèle.
//
//   voix k : fichiers → fondu (fins douces) → coupure (mort) → panoramique → bus des créatures → master
//                                             └→ prise de l'emplacement k (avant spatialisation)
//   source : fichiers → fondu → coupure → panoramique → bus des créatures ; coupure → prise « autres sources »
//   nappe → bus de nappe ─┐
//   vent ─────────────────┴→ ambiance avant atténuation → étage d'atténuation → master
//   impacts, clang, son mat → bus des impacts → master (hors bus des créatures, B5 I3)
import type { EntityId, FamilyKind, Tick, Vec2 } from '../sim/index'
import {
  CUT_RAMP_S,
  DUCK_DB,
  dbToGain,
  N_MAX,
  NAPPE_OFF_S,
  nappeOffShape,
  SOFT_END_MIN_S,
  SOFT_FADE_FLOOR_DB,
  SOFT_FADE_S,
  VOICE_SLOTS,
  XFADE_S,
} from './constants'
import type { Cmd, Phase, SourceKind } from './director'
import { DUCK_RAMP_S } from './duck'
import type { EndCause, EndMode } from './ends'
import type { Manifest, ManifestEntry } from './manifest'

export interface Bank {
  readonly manifest: Manifest
  readonly buffers: ReadonlyMap<string, AudioBuffer>
}

export interface LogPhase {
  readonly tick: Tick
  readonly time: number
  readonly phase: Phase | null
  readonly file: string
  readonly muffled: boolean
}

export interface LogSource {
  readonly uid: number
  readonly id: EntityId
  readonly family: FamilyKind | null
  readonly kind: 'voix' | SourceKind
  readonly slot: number | null
  readonly startTick: Tick
  readonly startTime: number
  readonly phases: LogPhase[]
  endTick: Tick | null
  endTime: number | null
  endMode: EndMode | null
  endCause: EndCause | null
  endDurationS: number | null // durée de fin programmée : rampe de coupure ou fondu
  strangle: boolean
  // Une mort qui survient pendant une fin douce coupe la fin en cours.
  cutDuringFade: { tick: Tick; time: number } | null
}

export interface LogFrame {
  readonly tick: Tick
  readonly time: number
  readonly listener: Vec2
  readonly voices: readonly (readonly [slot: number, id: EntityId, x: number, z: number])[]
  readonly sources: readonly (readonly [uid: number, id: EntityId, x: number, z: number])[]
}

export interface LogOneShot {
  readonly tick: Tick
  readonly time: number
  readonly kind: string
  readonly file: string
  readonly id: EntityId | null
  readonly pos: Vec2 | null
}

export interface AudioLog {
  readonly sources: LogSource[]
  readonly frames: LogFrame[]
  readonly oneshots: LogOneShot[]
  readonly ducks: { tick: Tick; time: number; t: 'duck-down' | 'duck-extend'; releaseAt: number }[]
  readonly nappe: { tick: Tick; time: number; n: number; prev: number; gain: number; rampS: number }[]
  readonly warnings: string[]
}

export interface Taps {
  readonly slots: readonly GainNode[]
  readonly others: GainNode
  readonly creatures: GainNode
  readonly nappe: GainNode
  readonly ambPre: GainNode
  readonly ambPost: GainNode
  readonly master: GainNode
  readonly impacts: GainNode
}

interface Part {
  readonly src: AudioBufferSourceNode
  readonly gain: GainNode
}

interface Chain {
  readonly log: LogSource
  readonly fade: GainNode
  readonly cut: GainNode
  readonly pan: PannerNode
  parts: Part[]
  stopAt: number | null
  pos: Vec2 // dernière position programmée sur le panoramique
}

const curve = (n: number, f: (x: number) => number): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => f(i / (n - 1)))
const FADE_IN = curve(64, (x) => Math.sin((x * Math.PI) / 2))
const FADE_OUT = curve(64, (x) => Math.cos((x * Math.PI) / 2))
const DUCK_GAIN = dbToGain(DUCK_DB)
const NAPPE_OFF_CURVE = curve(512, nappeOffShape)

// Valeur d'une rampe linéaire programmée (v0 à t0 → v1 à t1) à l'instant t : pour repartir du niveau réel.
interface Ramp {
  readonly v0: number
  readonly t0: number
  readonly v1: number
  readonly t1: number
}
const rampAt = (r: Ramp, t: number): number =>
  t <= r.t0 ? r.v0 : t >= r.t1 ? r.v1 : r.v0 + ((r.v1 - r.v0) * (t - r.t0)) / (r.t1 - r.t0)

export interface Graph {
  readonly taps: Taps
  readonly log: AudioLog
  apply(cmds: readonly Cmd[], tick: Tick, now: number, familyOf: (id: EntityId) => FamilyKind | null): void
  frame(tick: Tick, now: number, listener: Vec2): void
  dispose(): void
}

export const createGraph = (ctx: BaseAudioContext, bank: Bank): Graph => {
  const entries = new Map(bank.manifest.files.map((e) => [e.id, e]))
  const entry = (id: string): ManifestEntry => {
    const e = entries.get(id)
    if (!e) throw new Error(`fichier absent du manifeste : ${id}`)
    return e
  }
  const firstOfRole = (role: string): string => {
    const e = bank.manifest.files.find((f) => f.role === role)
    if (!e) throw new Error(`aucun fichier de rôle ${role}`)
    return e.id
  }
  const roleFile = {
    gargouillis: firstOfRole('gargouillis'),
    chant: firstOfRole('chant'),
    scie: firstOfRole('scie'),
    coutures: firstOfRole('coutures'),
    etranglement: firstOfRole('etranglement'),
    nappe: firstOfRole('nappe'),
    vent: firstOfRole('vent'),
    'impact-tranchant': firstOfRole('impact-tranchant'),
    'impact-contondant': firstOfRole('impact-contondant'),
    clang: firstOfRole('clang'),
    mat: firstOfRole('mat'),
  } as const

  const gain = (v = 1): GainNode => new GainNode(ctx, { gain: v })
  // Master en stéréo explicite : les mesures gauche et droite existent même quand seule l'ambiance (mono) sonne.
  const master = new GainNode(ctx, { gain: 1, channelCount: 2, channelCountMode: 'explicit' })
  master.connect(ctx.destination)
  const creatures = gain()
  creatures.connect(master)
  const impacts = gain()
  impacts.connect(master)
  const ambPre = gain()
  const ambPost = gain()
  ambPre.connect(ambPost)
  ambPost.connect(master)
  const nappe = gain(0)
  nappe.connect(ambPre)
  const slotTaps = Array.from({ length: VOICE_SLOTS }, () => gain())
  const others = gain()

  // Lecture d'un fichier tel que le manifeste le décrit : offset de départ, points de boucle.
  const play = (
    fileId: string,
    at: number,
    dest: AudioNode,
    opts: { gain?: number; rate?: number; offsetS?: number } = {},
  ): Part => {
    const e = entry(fileId)
    const buffer = bank.buffers.get(fileId)
    if (!buffer) throw new Error(`tampon non décodé : ${fileId}`)
    const src = new AudioBufferSourceNode(ctx, {
      buffer,
      loop: e.loop,
      loopStart: e.loopStart / e.sampleRate,
      loopEnd: e.loopEnd / e.sampleRate,
      playbackRate: opts.rate ?? 1,
    })
    const g = gain(opts.gain ?? 1)
    src.connect(g)
    g.connect(dest)
    let offset = e.startOffset / e.sampleRate + (opts.offsetS ?? 0)
    if (e.loop && offset >= e.loopEnd / e.sampleRate) {
      const period = (e.loopEnd - e.loopStart) / e.sampleRate
      offset = e.loopStart / e.sampleRate + ((offset - e.loopEnd / e.sampleRate) % period)
    }
    src.start(at, offset)
    return { src, gain: g }
  }

  // Ambiance permanente.
  play(roleFile.vent, ctx.currentTime, ambPre)
  play(roleFile.nappe, ctx.currentTime, nappe)

  const log: AudioLog = { sources: [], frames: [], oneshots: [], ducks: [], nappe: [], warnings: [] }
  let uid = 0
  const voiceChains = new Map<number, Chain>() // emplacement → voix tenue
  const srcChains = new Map<string, Chain>() // clé de source → chaîne
  const endingChains: Chain[] = [] // fins en cours (fondu) : une mort les coupe encore
  const retired: Chain[] = []
  let nappeRamp: Ramp = { v0: 0, t0: 0, v1: 0, t1: 0 }
  let duckRamps: Ramp[] = []

  const newChain = (
    kind: 'voix' | SourceKind,
    id: EntityId,
    slot: number | null,
    tick: Tick,
    now: number,
    pos: Vec2,
    family: FamilyKind | null,
    tap: AudioNode,
  ): Chain => {
    const fade = gain()
    const cut = gain()
    const pan = new PannerNode(ctx, { positionX: pos.x, positionY: 0, positionZ: pos.z })
    fade.connect(cut)
    cut.connect(pan)
    pan.connect(creatures)
    cut.connect(tap)
    const entryLog: LogSource = {
      uid: uid++,
      id,
      family,
      kind,
      slot,
      startTick: tick,
      startTime: now,
      phases: [],
      endTick: null,
      endTime: null,
      endMode: null,
      endCause: null,
      endDurationS: null,
      strangle: false,
      cutDuringFade: null,
    }
    log.sources.push(entryLog)
    return { log: entryLog, fade, cut, pan, parts: [], stopAt: null, pos }
  }

  const cutChain = (ch: Chain, now: number): void => {
    ch.cut.gain.setValueAtTime(1, now)
    ch.cut.gain.linearRampToValueAtTime(0, now + CUT_RAMP_S)
    for (const p of ch.parts) p.src.stop(now + CUT_RAMP_S)
    ch.stopAt = now + CUT_RAMP_S
  }

  const endChain = (
    ch: Chain,
    mode: EndMode,
    cause: EndCause,
    tick: Tick,
    now: number,
    strangle: boolean,
  ): void => {
    ch.log.endTick = tick
    ch.log.endTime = now
    ch.log.endMode = mode
    ch.log.endCause = cause
    if (mode === 'cut') {
      cutChain(ch, now)
      ch.log.endDurationS = CUT_RAMP_S
      retired.push(ch)
      return
    }
    const end = now + SOFT_FADE_S
    ch.fade.gain.setValueAtTime(1, now)
    ch.fade.gain.exponentialRampToValueAtTime(dbToGain(SOFT_FADE_FLOOR_DB), end)
    ch.fade.gain.setValueAtTime(0, end)
    for (const p of ch.parts) p.src.stop(end + CUT_RAMP_S)
    ch.stopAt = end + CUT_RAMP_S
    ch.log.endDurationS = SOFT_FADE_S
    if (strangle) {
      // §8.10 : le chant s'éteint en fondu sur un étranglement, hors de l'étage de fondu, coupé si la mort suit.
      const p = play(roleFile.etranglement, now, ch.cut)
      ch.parts.push(p)
      const len =
        (p.src.buffer?.duration ?? 0) -
        entry(roleFile.etranglement).startOffset / entry(roleFile.etranglement).sampleRate
      ch.stopAt = Math.max(ch.stopAt, now + len)
      ch.log.strangle = true
    }
    endingChains.push(ch)
  }

  const deathCutFading = (id: EntityId, tick: Tick, now: number): void => {
    for (let i = endingChains.length - 1; i >= 0; i--) {
      const ch = endingChains[i] as Chain
      if (ch.log.id !== id || (ch.stopAt !== null && now >= ch.stopAt)) continue
      cutChain(ch, now)
      ch.log.cutDuringFade = { tick, time: now }
      endingChains.splice(i, 1)
      retired.push(ch)
    }
  }

  const setPos = (ch: Chain, p: Vec2, now: number): void => {
    ch.pan.positionX.setValueAtTime(p.x, now)
    ch.pan.positionZ.setValueAtTime(p.z, now)
    ch.pos = p
  }

  // Niveau courant de la nappe, d'après l'automatisation programmée (rampe linéaire ou extinction).
  let nappeOff: { readonly v0: number; readonly t0: number } | null = null
  const nappeAt = (t: number): number =>
    nappeOff
      ? nappeOff.v0 * nappeOffShape(Math.min(1, Math.max(0, (t - nappeOff.t0) / NAPPE_OFF_S)))
      : rampAt(nappeRamp, t)

  const nappeTo = (target: number, now: number, rampS: number): void => {
    const from = nappeAt(now)
    nappe.gain.cancelScheduledValues(now)
    nappe.gain.setValueAtTime(from, now)
    nappeOff = null
    if (target === 0 && rampS > 0) {
      // Extinction (§26) : courbe 1 − u⁸ sur 2 s. La nappe garde l'essentiel de son niveau puis s'éteint ; aucun
      // quantum ne passe sous −80 dBFS avant la fin de la courbe tant que le quantum le plus faible du fichier
      // reste au-dessus de −80 dBFS + 15 dB à N = 1 (B5.O7 d : premier quantum silencieux dans [1,9 ; 2,1] s).
      nappe.gain.setValueCurveAtTime(
        NAPPE_OFF_CURVE.map((k) => k * from),
        now,
        rampS,
      )
      nappeOff = { v0: from, t0: now }
      nappeRamp = { v0: 0, t0: now + rampS, v1: 0, t1: now + rampS }
      return
    }
    if (rampS > 0) nappe.gain.linearRampToValueAtTime(target, now + rampS)
    else nappe.gain.setValueAtTime(target, now)
    nappeRamp = { v0: from, t0: now, v1: target, t1: now + rampS }
  }

  const duckAt = (t: number): number => {
    let v = 1
    for (const r of duckRamps) if (t >= r.t0) v = rampAt(r, t)
    return v
  }

  const apply: Graph['apply'] = (cmds, tick, now, familyOf) => {
    for (const c of cmds) {
      switch (c.t) {
        case 'voice-end': {
          const ch = voiceChains.get(c.slot)
          if (ch && ch.log.id === c.id && ch.log.endTick === null) {
            voiceChains.delete(c.slot)
            endChain(ch, c.mode, c.cause, tick, now, false)
          }
          // Une mort coupe aussi toute fin douce encore audible de la même créature.
          if (c.mode === 'cut') deathCutFading(c.id, tick, now)
          break
        }
        case 'src-end': {
          const ch = srcChains.get(c.key)
          if (ch && ch.log.endTick === null) {
            srcChains.delete(c.key)
            endChain(ch, c.mode, c.cause, tick, now, c.strangle)
          }
          if (c.mode === 'cut') deathCutFading(c.id, tick, now)
          break
        }
        case 'voice-start': {
          const ch = newChain(
            'voix',
            c.id,
            c.slot,
            tick,
            now,
            c.pos,
            familyOf(c.id),
            slotTaps[c.slot] as GainNode,
          )
          ch.parts.push(play(c.file, now, ch.fade))
          ch.log.phases.push({ tick, time: now, phase: c.phase, file: c.file, muffled: c.muffled })
          voiceChains.set(c.slot, ch)
          break
        }
        case 'voice-phase': {
          const ch = voiceChains.get(c.slot)
          if (!ch) break
          const last = ch.log.phases[ch.log.phases.length - 1]
          ch.log.phases.push({ tick, time: now, phase: c.phase, file: c.file, muffled: c.muffled })
          if (last && last.file === c.file) break
          // Fondu enchaîné à puissance constante : le cri ne s'interrompt jamais d'une phase à l'autre.
          for (const p of ch.parts) {
            p.gain.gain.setValueCurveAtTime(FADE_OUT, now, XFADE_S)
            p.src.stop(now + XFADE_S)
          }
          const np = play(c.file, now, ch.fade, { gain: 0 })
          np.gain.gain.setValueCurveAtTime(FADE_IN, now, XFADE_S)
          ch.parts = [np]
          break
        }
        case 'src-start': {
          const ch = newChain(c.kind, c.id, null, tick, now, c.pos, familyOf(c.id), others)
          ch.parts.push(play(roleFile[c.kind], now, ch.fade, { rate: c.rate, offsetS: c.offsetS }))
          ch.log.phases.push({ tick, time: now, phase: null, file: roleFile[c.kind], muffled: false })
          srcChains.set(c.key, ch)
          break
        }
        case 'src-rate': {
          const ch = srcChains.get(c.key)
          if (ch) for (const p of ch.parts) p.src.playbackRate.setValueAtTime(c.rate, now)
          break
        }
        case 'pos': {
          const ch =
            c.slot !== null ? voiceChains.get(c.slot) : c.key !== null ? srcChains.get(c.key) : undefined
          if (ch) setPos(ch, c.pos, now)
          break
        }
        case 'oneshot': {
          const file = roleFile[c.kind]
          play(file, now, impacts)
          log.oneshots.push({ tick, time: now, kind: c.kind, file, id: c.id, pos: c.pos })
          break
        }
        case 'nappe': {
          // Niveau proportionnel à N (§19), plein à 40 (§24) ; extinction en 2 s quand N tombe à 0 (§26).
          const target = c.n / N_MAX
          const rampS = c.prev < 0 ? 0 : c.n === 0 ? NAPPE_OFF_S : SOFT_END_MIN_S
          nappeTo(target, now, rampS)
          log.nappe.push({ tick, time: now, n: c.n, prev: c.prev, gain: target, rampS })
          break
        }
        case 'duck-down': {
          const from = duckAt(c.at)
          ambPost.gain.cancelScheduledValues(c.at)
          ambPost.gain.setValueAtTime(from, c.at)
          ambPost.gain.linearRampToValueAtTime(DUCK_GAIN, c.at + DUCK_RAMP_S)
          ambPost.gain.setValueAtTime(DUCK_GAIN, c.releaseAt)
          ambPost.gain.linearRampToValueAtTime(1, c.releaseAt + DUCK_RAMP_S)
          duckRamps = [
            { v0: from, t0: c.at, v1: DUCK_GAIN, t1: c.at + DUCK_RAMP_S },
            { v0: DUCK_GAIN, t0: c.releaseAt, v1: 1, t1: c.releaseAt + DUCK_RAMP_S },
          ]
          log.ducks.push({ tick, time: now, t: c.t, releaseAt: c.releaseAt })
          break
        }
        case 'duck-extend': {
          ambPost.gain.cancelScheduledValues(now)
          ambPost.gain.setValueAtTime(DUCK_GAIN, c.releaseAt)
          ambPost.gain.linearRampToValueAtTime(1, c.releaseAt + DUCK_RAMP_S)
          duckRamps = [
            ...duckRamps.slice(0, 1),
            { v0: DUCK_GAIN, t0: c.releaseAt, v1: 1, t1: c.releaseAt + DUCK_RAMP_S },
          ]
          log.ducks.push({ tick, time: now, t: c.t, releaseAt: c.releaseAt })
          break
        }
      }
    }
    // Ménage : chaînes arrêtées depuis plus d'une seconde.
    for (let i = endingChains.length - 1; i >= 0; i--) {
      const ch = endingChains[i] as Chain
      if (ch.stopAt !== null && now > ch.stopAt) {
        endingChains.splice(i, 1)
        retired.push(ch)
      }
    }
    for (let i = retired.length - 1; i >= 0; i--) {
      const ch = retired[i] as Chain
      if (ch.stopAt !== null && now > ch.stopAt + 1) {
        for (const p of ch.parts) {
          p.src.disconnect()
          p.gain.disconnect()
        }
        ch.fade.disconnect()
        ch.cut.disconnect()
        ch.pan.disconnect()
        retired.splice(i, 1)
      }
    }
  }

  const frame: Graph['frame'] = (tick, now, listener) => {
    const l = ctx.listener
    if (l.positionX) {
      l.positionX.setValueAtTime(listener.x, now)
      l.positionZ.setValueAtTime(listener.z, now)
    } else l.setPosition(listener.x, 0, listener.z)
    const voices: [number, EntityId, number, number][] = []
    for (const [slot, ch] of voiceChains) voices.push([slot, ch.log.id, ch.pos.x, ch.pos.z])
    const sources: [number, EntityId, number, number][] = []
    for (const ch of srcChains.values()) sources.push([ch.log.uid, ch.log.id, ch.pos.x, ch.pos.z])
    log.frames.push({ tick, time: now, listener, voices, sources })
  }

  const dispose = (): void => {
    master.disconnect()
  }

  return {
    taps: { slots: slotTaps, others, creatures, nappe, ambPre, ambPost, master, impacts },
    log,
    apply,
    frame,
    dispose,
  }
}
