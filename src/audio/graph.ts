// Graphe Web Audio et journal I1. Chaque commande du directeur est appliquée ici, et le journal est écrit par
// ces mêmes fonctions, au moment où elles programment le graphe (B5 I1) : il n'existe pas de modèle parallèle.
//
//   voix k : fichiers → fondu (fins douces) → mort → panoramique → voix avant → étage des voix → bus des créatures
//                                           └→ prise de l'emplacement k (avant spatialisation)               → master
//   (étage des voix : ducking des autres voix après une mort, D-fix3 ; prises avant et après l'étage, B5 A18)
//   râle j : fichier d'agonie → fondu → mort → panoramique → bus des créatures (hors étage des voix : le râle n'est pas
//            baissé par la mise à mort qu'il signale) ; mort → prise de la piste d'agonie j (B5 A19)
//   source : fichiers → fondu → mort → panoramique → bus des créatures ; mort → prise « autres sources »
//   nappe → bus de nappe ─┐
//   vent ─────────────────┴→ ambiance avant atténuation → étage d'atténuation → master
//   impacts, clang, son mat → bus des impacts → master (hors bus des créatures, B5 I3)
import type { EntityId, FamilyKind, Tick, Vec2 } from '../sim/index'
import {
  AGONIE_END_S,
  AGONIE_TICKS,
  AGONY_ATTACK_S,
  AGONY_DECAY_FROM_S,
  AGONY_LANES,
  CUT_RAMP_S,
  DUCK_DB,
  dbToGain,
  MASTER_DB,
  N_MAX,
  NAPPE_OFF_S,
  nappeOffShape,
  SOFT_END_MIN_S,
  SOFT_FADE_FLOOR_DB,
  SOFT_FADE_S,
  STRANGLE_RATE,
  STRANGLE_S,
  VOICE_DUCK_ATTACK_S,
  VOICE_DUCK_DB,
  VOICE_DUCK_RELEASE_S,
  VOICE_SLOTS,
  XFADE_S,
} from './constants'
import type { AgonyPhase, Cmd, Phase, SourceKind } from './director'
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
  readonly phase: Phase | AgonyPhase | null
  readonly file: string
  readonly muffled: boolean
  // Rampe de vitesse programmée à partir de `time` (passage au râle : la couche vivante baisse de hauteur).
  readonly rateTo?: number
  readonly rampS?: number
  // Sources hors voix et râle : vitesse de lecture et offset de départ (s), pour retrouver le point de lecture du
  // fichier (B5 amendement A1, enveloppe de gain). Une entrée par changement de vitesse.
  readonly rate?: number
  readonly offsetS?: number
}

export interface LogSource {
  readonly uid: number
  readonly id: EntityId
  readonly family: FamilyKind | null
  readonly kind: 'voix' | 'râle' | SourceKind
  readonly slot: number | null
  readonly startTick: Tick
  readonly startTime: number
  readonly phases: LogPhase[]
  endTick: Tick | null
  endTime: number | null
  endMode: EndMode | null
  endCause: EndCause | null
  endDurationS: number | null // durée de fin programmée, depuis endTime : agonie ou fondu
  // Râle (B5 I1, A19) : piste d'agonie, rang de mort, et fin de l'agonie (tick t_d + A_g, instant de la fin programmée).
  lane: number | null
  rank: number | null
  agonyEnd: { tick: Tick; time: number } | null
  strangle: boolean
  // Une mort qui survient pendant une fin douce plus longue que l'agonie (étranglement d'une prière) la fait taire à
  // la fin de l'agonie ; endDurationS est alors compté jusqu'à cette nouvelle fin.
  diedDuringFade: { tick: Tick; time: number } | null
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
  // Atténuations programmées : ambiance (duck-*) et étage des voix (voice-duck-*, D-fix3), dans un même journal.
  readonly ducks: {
    tick: Tick
    time: number
    t: 'duck-down' | 'duck-extend' | 'voice-duck-down' | 'voice-duck-extend'
    releaseAt: number
  }[]
  readonly nappe: { tick: Tick; time: number; n: number; prev: number; gain: number; rampS: number }[]
  // Morts d'une famille qui a une voix, sans râle : inaudibles (rang > 24 sans voix tenue) ou sans piste d'agonie libre.
  readonly agonyDenied?: { tick: Tick; time: number; id: EntityId; reason: 'rang' | 'muet' | 'piste' }[]
  readonly warnings: string[]
}

export interface Taps {
  readonly slots: readonly GainNode[]
  readonly others: GainNode
  readonly creatures: GainNode
  readonly voicesPre: GainNode // voix vivantes avant l'étage des voix (B5 A18)
  readonly voices: GainNode // étage des voix (ducking des autres voix), entre les panoramiques et le bus des créatures
  readonly nappe: GainNode
  readonly ambPre: GainNode
  readonly ambPost: GainNode
  readonly master: GainNode
  readonly impacts: GainNode
  readonly agony: readonly GainNode[] // prises des pistes d'agonie (avant spatialisation)
}

// Lecture d'un fichier. Son gain propre ne porte que les fondus enchaînés (changement de fichier d'une voix) ; on
// garde la dernière courbe programmée pour connaître le gain réel à tout instant et en repartir (drapeau 1 de B5).
interface Part {
  readonly src: AudioBufferSourceNode
  readonly gain: GainNode
  readonly level: number // gain de lecture du fichier (manifeste, gainDb), linéaire
  readonly rate: number // vitesse de lecture au départ
  base: number // gain avant `curve`
  curve: { readonly t0: number; readonly dur: number; readonly values: Float32Array } | null
  stopAt: number | null
}

interface Chain {
  readonly log: LogSource
  readonly fade: GainNode
  readonly death: GainNode // extinction d'une source à la mort, et fin d'un fondu que la mort raccourcit
  readonly pan: PannerNode
  parts: Part[] // toutes les lectures de la chaîne, fondus enchaînés en cours compris
  live: Part | null // lecture du fichier courant
  stopAt: number | null
  pos: Vec2 // dernière position programmée sur le panoramique
}

// Journal I1 : complet (banc, mesure en direct), ou borné aux `ticks` derniers ticks (jeu : revue de code M5).
export type JournalMode = 'complet' | { readonly ticks: number }

// Gain d'une lecture à l'instant t, d'après sa dernière courbe (interpolation de la spécification Web Audio :
// k = ⌊(N − 1)(t − T₀)/T_D⌋, puis linéaire entre c_k et c_k+1).
const partGainAt = (p: Part, t: number): number => {
  const c = p.curve
  if (!c || t < c.t0) return p.base
  const n = c.values.length
  if (t >= c.t0 + c.dur) return c.values[n - 1] as number
  const v = ((n - 1) * (t - c.t0)) / c.dur
  const k = Math.floor(v)
  const a = c.values[k] as number
  const b = c.values[Math.min(n - 1, k + 1)] as number
  return a + (b - a) * (v - k)
}

// Arrêt d'une lecture : jamais plus tard qu'un arrêt déjà programmé (le dernier stop() l'emporte, spec Web Audio).
const stopPart = (p: Part, at: number): void => {
  if (p.stopAt !== null && p.stopAt <= at) return
  p.src.stop(at)
  p.stopAt = at
}

const curve = (n: number, f: (x: number) => number): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => f(i / (n - 1)))
const FADE_IN = curve(64, (x) => Math.sin((x * Math.PI) / 2))
const FADE_OUT = curve(64, (x) => Math.cos((x * Math.PI) / 2))
const FLOOR = dbToGain(SOFT_FADE_FLOOR_DB)
const DUCK_GAIN = dbToGain(DUCK_DB)
const VOICE_DUCK_GAIN = dbToGain(VOICE_DUCK_DB)
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

export const createGraph = (
  ctx: BaseAudioContext,
  bank: Bank,
  opts: { readonly journal?: JournalMode } = {},
): Graph => {
  const journal = opts.journal ?? 'complet'
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
  const master = new GainNode(ctx, {
    gain: dbToGain(MASTER_DB),
    channelCount: 2,
    channelCountMode: 'explicit',
  })
  master.connect(ctx.destination)
  const creatures = gain()
  creatures.connect(master)
  const voicesBus = gain()
  voicesBus.connect(creatures)
  const voicesPre = gain()
  voicesPre.connect(voicesBus)
  const impacts = gain()
  impacts.connect(master)
  const ambPre = gain()
  const ambPost = gain()
  ambPre.connect(ambPost)
  ambPost.connect(master)
  const nappe = gain(0)
  nappe.connect(ambPre)
  const slotTaps = Array.from({ length: VOICE_SLOTS }, () => gain())
  const agonyTaps = Array.from({ length: AGONY_LANES }, () => gain())
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
    // Gain de lecture du manifeste (B5 I8 : le lecteur lit ses réglages dans le manifeste, nulle part ailleurs).
    const level = dbToGain(e.gainDb ?? 0)
    const g = gain((opts.gain ?? 1) * level)
    src.connect(g)
    g.connect(dest)
    let offset = e.startOffset / e.sampleRate + (opts.offsetS ?? 0)
    if (e.loop && offset >= e.loopEnd / e.sampleRate) {
      const period = (e.loopEnd - e.loopStart) / e.sampleRate
      offset = e.loopStart / e.sampleRate + ((offset - e.loopEnd / e.sampleRate) % period)
    }
    src.start(at, offset)
    return {
      src,
      gain: g,
      level,
      rate: opts.rate ?? 1,
      base: (opts.gain ?? 1) * level,
      curve: null,
      stopAt: null,
    }
  }

  // Ambiance permanente.
  const ambient = [play(roleFile.vent, ctx.currentTime, ambPre), play(roleFile.nappe, ctx.currentTime, nappe)]
  // Sons ponctuels (impacts…) : gardés jusqu'à leur fin, pour que dispose() les arrête aussi.
  let oneshotParts: { readonly part: Part; readonly endAt: number }[] = []

  // Morts sans râle : champ facultatif du type (les tranches de télémétrie de src/dev ne le recopient pas encore),
  // toujours rempli ici.
  const agonyDenied: NonNullable<AudioLog['agonyDenied']>[number][] = []
  const log: AudioLog = {
    sources: [],
    frames: [],
    oneshots: [],
    ducks: [],
    nappe: [],
    agonyDenied,
    warnings: [],
  }
  let uid = 0
  const voiceChains = new Map<number, Chain>() // emplacement → voix tenue
  const srcChains = new Map<string, Chain>() // clé de source → chaîne
  const endingChains: Chain[] = [] // fins en cours (fondu) : une mort les borne à la fin de l'agonie
  const retired: Chain[] = []
  // Fin de la dernière fin (fondu d'une voix volée ou relevée, agonie) de chaque emplacement : la voix suivante n'y
  // démarre pas avant (B5.O8 a). Au banc, un fondu tient toujours dans ses 18 ticks (SOFT_FADE_S) et une agonie dans
  // ses 24 ; en direct, l'horloge des images peut rapprocher deux ticks de quelques millisecondes.
  const slotFadeEnd = new Map<number, number>()
  let nappeRamp: Ramp = { v0: 0, t0: 0, v1: 0, t1: 0 }
  let duckRamps: Ramp[] = []
  // Étage des voix : descente puis remontée programmées (rampes linéaires), pour repartir du gain réel.
  let voiceDuckRamps: Ramp[] = []

  const newChain = (
    kind: 'voix' | 'râle' | SourceKind,
    id: EntityId,
    slot: number | null,
    tick: Tick,
    now: number,
    pos: Vec2,
    family: FamilyKind | null,
    tap: AudioNode,
    bus: AudioNode = kind === 'voix' ? voicesPre : creatures,
  ): Chain => {
    const fade = gain()
    const death = gain()
    const pan = new PannerNode(ctx, { positionX: pos.x, positionY: 0, positionZ: pos.z })
    fade.connect(death)
    death.connect(pan)
    pan.connect(bus)
    death.connect(tap)
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
      lane: null,
      rank: null,
      agonyEnd: null,
      strangle: false,
      diedDuringFade: null,
    }
    log.sources.push(entryLog)
    return { log: entryLog, fade, death, pan, parts: [], live: null, stopAt: null, pos }
  }

  // Extinction sur l'étage de mort, de `now` à `end` : rampe exponentielle jusqu'à −60 dB, puis zéro et arrêt. Sert aux
  // sources d'un mort (gargouillis, chant, scie, coutures) et aux fins douces qu'une mort raccourcit.
  const dieOut = (ch: Chain, now: number, end: number): void => {
    ch.death.gain.setValueAtTime(1, now)
    ch.death.gain.exponentialRampToValueAtTime(FLOOR, end)
    ch.death.gain.setValueAtTime(0, end)
    for (const p of ch.parts) stopPart(p, end)
    ch.stopAt = end
  }

  // Fondu enchaîné, côté sortant : la lecture descend de son gain réel à `now` (elle peut être encore en train de
  // monter) jusqu'à 0 en `dur`, puis s'arrête. Toute automatisation encore programmée sur ce gain est annulée
  // d'abord : aucun chevauchement de courbes, quel que soit l'écart entre deux changements, même nul.
  const fadeOutPart = (p: Part, now: number, dur: number = XFADE_S): void => {
    const from = partGainAt(p, now)
    const values = FADE_OUT.map((k) => k * from)
    p.gain.gain.cancelScheduledValues(now)
    p.gain.gain.setValueCurveAtTime(values, now, dur)
    p.base = from
    p.curve = { t0: now, dur, values }
    stopPart(p, now + dur)
  }

  // Passage au râle, côté couche vivante (L4, §19, B5.O3 a) : dans l'image du coup, chaque lecture encore audible de la
  // voix du mort descend à zéro en STRANGLE_S depuis son gain réel, dans son emplacement ; si le mort râle, sa vitesse
  // tombe aussi de 5 demi-tons (le cri s'étrangle). L'emplacement est réattribuable dès ce tick : la voix suivante y
  // démarre à la fin de l'extinction (slotFadeEnd).
  const strangleVoice = (ch: Chain, pitch: boolean, tick: Tick, now: number): void => {
    ch.log.endTick = tick
    ch.log.endTime = now
    ch.log.endMode = 'agonie'
    ch.log.endCause = 'mort'
    ch.log.endDurationS = STRANGLE_S
    retired.push(ch)
    // Voix pas encore audible (en direct, emplacement encore en fin) : elle ne sonnera pas.
    if (ch.log.startTime > now) {
      for (const p of ch.parts) stopPart(p, ch.log.startTime)
      ch.stopAt = ch.log.startTime
      ch.log.endDurationS = 0
      return
    }
    for (const p of ch.parts) {
      if (p.stopAt !== null && p.stopAt <= now) continue
      if (pitch) {
        p.src.playbackRate.setValueAtTime(p.rate, now)
        p.src.playbackRate.linearRampToValueAtTime(p.rate * STRANGLE_RATE, now + STRANGLE_S)
      }
      // Une lecture déjà sortante (fondu enchaîné de phase en cours) finit son propre fondu, plus court.
      if (p.stopAt === null) fadeOutPart(p, now, STRANGLE_S)
    }
    ch.stopAt = Math.max(now, ...ch.parts.map((p) => p.stopAt ?? now))
    if (ch.log.slot !== null) slotFadeEnd.set(ch.log.slot, now + STRANGLE_S)
    const last = ch.log.phases[ch.log.phases.length - 1]
    if (last && pitch)
      ch.log.phases.push({
        tick,
        time: now,
        phase: last.phase,
        file: last.file,
        muffled: last.muffled,
        rate: 1,
        rateTo: STRANGLE_RATE,
        rampS: STRANGLE_S,
      })
  }

  // Râle (L4, §19, B5 A19) : sur sa piste d'agonie, hors des emplacements et de l'étage des voix. Il monte en
  // AGONY_ATTACK_S dans l'image du coup, tient, s'éteint, et s'est tu à la fin programmée de l'agonie.
  const startRale = (
    c: Extract<Cmd, { t: 'voice-agony' }> & { readonly lane: number; readonly file: string },
    tick: Tick,
    now: number,
    familyOf: (id: EntityId) => FamilyKind | null,
  ): void => {
    const end = now + AGONIE_END_S
    const tap = agonyTaps[c.lane] as GainNode
    const ch = newChain('râle', c.id, null, tick, now, c.pos, familyOf(c.id), tap, creatures)
    const p = play(c.file, now, ch.fade, { gain: 0, rate: c.rate })
    const attack = FADE_IN.map((k) => k * p.level)
    const g = p.gain.gain
    g.setValueCurveAtTime(attack, now, AGONY_ATTACK_S)
    g.setValueAtTime(p.level, now + AGONY_DECAY_FROM_S)
    g.exponentialRampToValueAtTime(p.level * FLOOR, end)
    g.setValueAtTime(0, end)
    p.curve = { t0: now, dur: AGONY_ATTACK_S, values: attack }
    stopPart(p, end)
    ch.parts.push(p)
    ch.live = p
    ch.stopAt = end
    ch.log.phases.push({
      tick,
      time: now,
      phase: 'râle',
      file: c.file,
      muffled: c.muffled,
      rate: c.rate,
      offsetS: 0,
    })
    ch.log.endTick = tick
    ch.log.endTime = now
    ch.log.endMode = 'agonie'
    ch.log.endCause = 'mort'
    ch.log.endDurationS = AGONIE_END_S
    ch.log.lane = c.lane
    ch.log.rank = c.rank
    ch.log.agonyEnd = { tick: tick + AGONIE_TICKS, time: end }
    retired.push(ch)
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
    if (mode === 'agonie') {
      // Source d'un mort (gargouillis, chant, scie, coutures) : elle s'éteint pendant l'agonie.
      dieOut(ch, now, now + AGONIE_END_S)
      ch.log.endDurationS = AGONIE_END_S
      retired.push(ch)
      return
    }
    const end = now + SOFT_FADE_S
    ch.fade.gain.setValueAtTime(1, now)
    ch.fade.gain.exponentialRampToValueAtTime(dbToGain(SOFT_FADE_FLOOR_DB), end)
    ch.fade.gain.setValueAtTime(0, end)
    for (const p of ch.parts) stopPart(p, end + CUT_RAMP_S)
    ch.stopAt = end + CUT_RAMP_S
    ch.log.endDurationS = SOFT_FADE_S
    if (ch.log.kind === 'voix' && ch.log.slot !== null) slotFadeEnd.set(ch.log.slot, end)
    if (strangle) {
      // §8.10 : le chant s'éteint en fondu sur un étranglement, hors de l'étage de fondu, éteint avec l'agonie si la mort suit.
      const p = play(roleFile.etranglement, now, ch.death)
      ch.parts.push(p)
      const len =
        (p.src.buffer?.duration ?? 0) -
        entry(roleFile.etranglement).startOffset / entry(roleFile.etranglement).sampleRate
      // La fin de l'étranglement est elle-même une fin sans mort : fondu programmé sur ses SOFT_FADE_S dernières
      // secondes, quel que soit le contenu généré (B5.O6, enveloppe de gain de l'amendement A1).
      const fadeFrom = now + Math.max(0, len - SOFT_FADE_S)
      p.gain.gain.setValueAtTime(p.level, fadeFrom)
      p.gain.gain.exponentialRampToValueAtTime(p.level * dbToGain(SOFT_FADE_FLOOR_DB), now + len)
      p.gain.gain.setValueAtTime(0, now + len)
      ch.stopAt = Math.max(ch.stopAt, now + len)
      ch.log.strangle = true
      // La fin dure jusqu'au bout de l'étranglement : le journal le dit (I1), sinon un mesureur croit le bus libre.
      ch.log.endDurationS = Math.max(SOFT_FADE_S, len)
    }
    endingChains.push(ch)
  }

  // Mort d'une créature : une fin douce encore en cours qui finirait après l'agonie (étranglement d'une prière) s'éteint
  // pour finir avec elle. Les fondus plus courts finissent d'eux-mêmes avant.
  const deathBound = (id: EntityId, tick: Tick, now: number): void => {
    const end = now + AGONIE_END_S
    for (let i = endingChains.length - 1; i >= 0; i--) {
      const ch = endingChains[i] as Chain
      if (ch.log.id !== id || (ch.stopAt !== null && ch.stopAt <= end)) continue
      dieOut(ch, now, end)
      ch.log.diedDuringFade = { tick, time: now }
      if (ch.log.endTime !== null) ch.log.endDurationS = end - ch.log.endTime
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
  const voiceDuckAt = (t: number): number => {
    let v = 1
    for (const r of voiceDuckRamps) if (t >= r.t0) v = rampAt(r, t)
    return v
  }

  const apply: Graph['apply'] = (cmds, tick, now, familyOf) => {
    for (const c of cmds) {
      switch (c.t) {
        case 'death':
          deathBound(c.id, tick, now)
          break
        case 'agony-denied':
          agonyDenied.push({ tick, time: now, id: c.id, reason: c.reason })
          break
        case 'voice-agony': {
          const held = c.slot === null ? undefined : voiceChains.get(c.slot)
          if (held && c.slot !== null && held.log.id === c.id && held.log.endTick === null) {
            voiceChains.delete(c.slot)
            strangleVoice(held, c.file !== null, tick, now)
          }
          if (c.lane !== null && c.file !== null)
            startRale({ ...c, lane: c.lane, file: c.file }, tick, now, familyOf)
          break
        }
        case 'voice-end': {
          const ch = voiceChains.get(c.slot)
          if (ch && ch.log.id === c.id && ch.log.endTick === null) {
            voiceChains.delete(c.slot)
            endChain(ch, c.mode, c.cause, tick, now, false)
          }
          break
        }
        case 'src-end': {
          const ch = srcChains.get(c.key)
          if (ch && ch.log.endTick === null) {
            srcChains.delete(c.key)
            endChain(ch, c.mode, c.cause, tick, now, c.strangle)
          }
          break
        }
        case 'voice-start': {
          const fadeEnd = slotFadeEnd.get(c.slot)
          const at = fadeEnd !== undefined && fadeEnd > now ? fadeEnd : now
          // L'étage des voix sans voix à traiter n'avance pas son automatisation (Chrome, mesuré au banc : après une
          // mort sans autre voix, la remontée restait figée à −7,4 dB jusqu'à la mort suivante). Le gain courant est
          // reposé quand une voix arrive : la rampe en cours, s'il y en a une, repart de ce point sans saut.
          voicesBus.gain.setValueAtTime(voiceDuckAt(now), now)
          const ch = newChain(
            'voix',
            c.id,
            c.slot,
            tick,
            at,
            c.pos,
            familyOf(c.id),
            slotTaps[c.slot] as GainNode,
          )
          const p = play(c.file, at, ch.fade)
          ch.parts.push(p)
          ch.live = p
          ch.log.phases.push({ tick, time: at, phase: c.phase, file: c.file, muffled: c.muffled })
          voiceChains.set(c.slot, ch)
          break
        }
        case 'voice-phase': {
          const ch = voiceChains.get(c.slot)
          if (!ch) break
          const last = ch.log.phases[ch.log.phases.length - 1]
          ch.log.phases.push({ tick, time: now, phase: c.phase, file: c.file, muffled: c.muffled })
          if (last && last.file === c.file) break
          // Fondu enchaîné à puissance constante : le cri ne s'interrompt jamais d'une phase à l'autre. La lecture
          // sortante part de son gain réel ; les lectures déjà sortantes finissent leur propre fondu.
          if (ch.live) fadeOutPart(ch.live, now)
          const np = play(c.file, now, ch.fade, { gain: 0 })
          const fadeIn = np.level === 1 ? FADE_IN : FADE_IN.map((k) => k * np.level)
          np.gain.gain.setValueCurveAtTime(fadeIn, now, XFADE_S)
          np.curve = { t0: now, dur: XFADE_S, values: fadeIn }
          ch.parts = [...ch.parts.filter((p) => p.stopAt === null || p.stopAt > now), np]
          ch.live = np
          break
        }
        case 'src-start': {
          const ch = newChain(c.kind, c.id, null, tick, now, c.pos, familyOf(c.id), others)
          ch.parts.push(play(roleFile[c.kind], now, ch.fade, { rate: c.rate, offsetS: c.offsetS }))
          ch.log.phases.push({
            tick,
            time: now,
            phase: null,
            file: roleFile[c.kind],
            muffled: false,
            rate: c.rate,
            offsetS: c.offsetS,
          })
          srcChains.set(c.key, ch)
          break
        }
        case 'src-rate': {
          const ch = srcChains.get(c.key)
          if (!ch) break
          for (const p of ch.parts) p.src.playbackRate.setValueAtTime(c.rate, now)
          const first = ch.log.phases[0]
          ch.log.phases.push({
            tick,
            time: now,
            phase: null,
            file: first?.file ?? '',
            muffled: false,
            rate: c.rate,
            offsetS: first?.offsetS ?? 0,
          })
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
          const part = play(file, now, impacts)
          oneshotParts.push({ part, endAt: now + (part.src.buffer?.duration ?? 0) })
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
        case 'voice-duck-down': {
          // Descente en VOICE_DUCK_ATTACK_S depuis le gain courant (repos ou remontée en cours), tenue, remontée.
          const from = voiceDuckAt(c.at)
          const down: Ramp = { v0: from, t0: c.at, v1: VOICE_DUCK_GAIN, t1: c.at + VOICE_DUCK_ATTACK_S }
          const up: Ramp = {
            v0: VOICE_DUCK_GAIN,
            t0: c.releaseAt,
            v1: 1,
            t1: c.releaseAt + VOICE_DUCK_RELEASE_S,
          }
          const g = voicesBus.gain
          g.cancelScheduledValues(c.at)
          g.setValueAtTime(from, c.at)
          g.linearRampToValueAtTime(down.v1, down.t1)
          g.setValueAtTime(up.v0, up.t0)
          g.linearRampToValueAtTime(up.v1, up.t1)
          voiceDuckRamps = [down, up]
          log.ducks.push({ tick, time: now, t: c.t, releaseAt: c.releaseAt })
          break
        }
        case 'voice-duck-extend': {
          // Même grappe : la descente en cours finit comme prévue, seule la remontée recule. Le gain est reposé à
          // sa valeur courante avant toute nouvelle rampe : aucune discontinuité, même au milieu de la descente.
          const down = voiceDuckRamps[0]
          const cur = voiceDuckAt(now)
          const up: Ramp = {
            v0: VOICE_DUCK_GAIN,
            t0: c.releaseAt,
            v1: 1,
            t1: c.releaseAt + VOICE_DUCK_RELEASE_S,
          }
          const g = voicesBus.gain
          g.cancelScheduledValues(now)
          g.setValueAtTime(cur, now)
          if (down && now < down.t1) g.linearRampToValueAtTime(down.v1, down.t1)
          g.setValueAtTime(up.v0, up.t0)
          g.linearRampToValueAtTime(up.v1, up.t1)
          voiceDuckRamps = down ? [down, up] : [up]
          log.ducks.push({ tick, time: now, t: c.t, releaseAt: c.releaseAt })
          break
        }
      }
    }
    // Ménage : sons ponctuels finis, chaînes arrêtées depuis plus d'une seconde.
    oneshotParts = oneshotParts.filter((o) => o.endAt > now)
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
        ch.death.disconnect()
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
    trimJournal(tick)
  }

  // Revue de code M5 : en jeu, le journal ne garde que les `journal.ticks` derniers ticks (entrées datées par tick,
  // sources finies avant l'horizon). Taillé tous les `journal.ticks` ticks : au plus deux horizons en mémoire.
  let trimmedAt = Number.NEGATIVE_INFINITY
  const trimJournal = (tick: Tick): void => {
    if (journal === 'complet' || tick - trimmedAt < journal.ticks) return
    trimmedAt = tick
    const from = tick - journal.ticks
    const dropBefore = <T extends { readonly tick: Tick }>(xs: T[], keepLast: boolean): void => {
      let i = 0
      while (i < xs.length && (xs[i] as T).tick < from) i++
      if (keepLast && i === xs.length) i = Math.max(0, xs.length - 1) // état courant (niveau de la nappe)
      xs.splice(0, i)
    }
    dropBefore(log.frames, false)
    dropBefore(log.oneshots, false)
    dropBefore(log.ducks, false)
    dropBefore(log.nappe, true)
    dropBefore(agonyDenied, false)
    let w = 0
    for (const s of log.sources) {
      const last = Math.max(s.endTick ?? Number.POSITIVE_INFINITY, s.diedDuringFade?.tick ?? -1)
      if (last >= from) log.sources[w++] = s
    }
    log.sources.length = w
    if (log.warnings.length > journal.ticks) log.warnings.splice(0, log.warnings.length - journal.ticks)
  }

  // Revue de code M6 : un graphe abandonné (nouvelle partie, fin d'une mesure en direct) arrête toutes ses lectures,
  // ambiances en boucle, voix, sources, fins en cours et sons ponctuels, puis se déconnecte.
  const dispose = (): void => {
    const now = ctx.currentTime
    const chains = [...voiceChains.values(), ...srcChains.values(), ...endingChains, ...retired]
    const parts = [...ambient, ...oneshotParts.map((o) => o.part), ...chains.flatMap((ch) => ch.parts)]
    for (const p of parts) {
      stopPart(p, now)
      p.src.disconnect()
      p.gain.disconnect()
    }
    for (const ch of chains) {
      ch.fade.disconnect()
      ch.death.disconnect()
      ch.pan.disconnect()
    }
    voiceChains.clear()
    srcChains.clear()
    endingChains.length = 0
    retired.length = 0
    oneshotParts = []
    for (const n of [
      master,
      creatures,
      voicesBus,
      voicesPre,
      impacts,
      ambPre,
      ambPost,
      nappe,
      others,
      ...slotTaps,
      ...agonyTaps,
    ])
      n.disconnect()
  }

  return {
    taps: {
      slots: slotTaps,
      others,
      creatures,
      voicesPre,
      voices: voicesBus,
      nappe,
      ambPre,
      ambPost,
      master,
      impacts,
      agony: agonyTaps,
    },
    log,
    apply,
    frame,
    dispose,
  }
}
