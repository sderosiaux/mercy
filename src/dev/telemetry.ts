// Télémétrie d'une partie (B4 I7, B2 I6, B3 I11, B5 I2, B1 §12.6) : évènements bruts, série par tick, notes,
// commandes par tick et métadonnées, mesurés par le même code que le banc de bots (src/metrics : seriesLine,
// tickNotes, reduceRun, dans le même ordre que playRun de src/bots/harness.ts). Le fichier se rejoue hors du
// navigateur : monde initial recréé depuis (vague, graine, variante), puis un step par commande enregistrée.
// Aucune écriture dans le monde : l'enregistreur ne fait que lire les mondes que l'hôte lui passe.
import { rankBodies } from '../audio/alloc'
import { vocalising } from '../audio/ends'
import type { AudioLog, EventJournal, TickInfo } from '../audio/index'
import {
  isEngagement,
  type RunMetrics,
  reduceRun,
  type SeriesLine,
  seriesLine,
  type TickNote,
  tickNotes,
} from '../metrics/index'
import {
  createWorld,
  FAMILIES,
  type FamilyRegistry,
  hashWorld,
  IDLE_COMMANDS,
  type PlayerCommands,
  type SimEvent,
  step,
  type Variant,
  type WeaponId,
  type World,
} from '../sim/index'
import { waveById } from '../sim/waves'
import type { BlindLabel, Correspondence } from './blind'
import { decodeCommand, type EncodedCommand, encodeCommand } from './commands'
import type { FrameStats } from './frames'

// ---------------------------------------------------------------------------------------------------------------
// Journal par tick des corps qui vocalisent (B5 I2), même définition que le banc audio (src/audio/bench.ts) :
// `vocalising` et `rankBodies` de src/audio, auditeur = position du joueur (D9, main.ts). Stocké à plat pour tenir
// une partie de 300 s en mémoire : [id, distance, id, distance, …].

interface CompactTick {
  readonly tick: number
  readonly n: number
  readonly lx: number
  readonly lz: number
  readonly vocal: Float64Array
}

const compactTick = (w: World): CompactTick => {
  const byId = new Map(w.creatures.map((c) => [c.id, c]))
  const l = w.player.pos
  const ranked = rankBodies(
    w.creatures
      .filter((c) => vocalising(c, byId))
      .map((c) => ({ id: c.id, dist: Math.hypot(c.pos.x - l.x, c.pos.z - l.z) })),
  )
  const vocal = new Float64Array(ranked.length * 2)
  ranked.forEach((b, i) => {
    vocal[2 * i] = b.id
    vocal[2 * i + 1] = b.dist
  })
  let n = 0
  for (const c of w.creatures) if (c.state.kind !== 'mort') n++
  return { tick: w.tick, n, lx: l.x, lz: l.z, vocal }
}

const expandTick = (t: CompactTick): TickInfo => {
  const vocal: (readonly [number, number])[] = []
  for (let i = 0; i < t.vocal.length; i += 2) vocal.push([t.vocal[i] as number, t.vocal[i + 1] as number])
  return { tick: t.tick, n: t.n, listener: { x: t.lx, z: t.lz }, vocal }
}

// ---------------------------------------------------------------------------------------------------------------
// Enregistreur d'une partie.

export interface RunRecorder {
  readonly world0: World
  last(): World
  // Monde d'après le step et commandes appliquées à ce step, dans l'ordre des ticks.
  record(applied: PlayerCommands, after: World): void
  events(): readonly SimEvent[]
  series(): readonly SeriesLine[]
  notes(): readonly TickNote[]
  commands(): readonly EncodedCommand[]
  t0(): number | null
  journal(): EventJournal // B5 I2 : évènements depuis le début, N et corps qui vocalisent par tick
  metrics(): RunMetrics
  checkpoints(): readonly Checkpoint[]
}

// Hash du monde à intervalle fixe : situe le premier tick où un rejeu s'écarte de la partie enregistrée.
export const CHECKPOINT_EVERY = 60
export type Checkpoint = readonly [tick: number, hash: string]

export const createRunRecorder = (world0: World, opts: { readonly voices?: boolean } = {}): RunRecorder => {
  const voices = opts.voices ?? true
  const events: SimEvent[] = [...world0.events]
  const series: SeriesLine[] = [seriesLine(world0)]
  const notes: TickNote[] = tickNotes(world0, IDLE_COMMANDS, world0)
  const commands: EncodedCommand[] = []
  const ticks: CompactTick[] = voices ? [compactTick(world0)] : []
  let t0: number | null = events.find(isEngagement)?.tick ?? null
  let last = world0
  const checkpoints: Checkpoint[] = [[world0.tick, hashWorld(world0)]]
  return {
    world0,
    last: () => last,
    record: (applied, after) => {
      if (after.tick !== last.tick + 1)
        throw new Error(`step attendu au tick ${last.tick + 1}, reçu ${after.tick} : partie discontinue`)
      for (const e of after.events) events.push(e)
      series.push(seriesLine(after))
      for (const n of tickNotes(last, applied, after)) notes.push(n)
      commands.push(encodeCommand(applied))
      if (voices) ticks.push(compactTick(after))
      if (t0 === null && after.events.some(isEngagement)) t0 = after.tick
      if (after.tick % CHECKPOINT_EVERY === 0) checkpoints.push([after.tick, hashWorld(after)])
      last = after
    },
    events: () => events,
    series: () => series,
    notes: () => notes,
    commands: () => commands,
    t0: () => t0,
    journal: () => ({ events: [...events], ticks: ticks.map(expandTick) }),
    metrics: () => reduceRun(events, { weapon: world0.player.weapon, series, notes }),
    checkpoints: () => checkpoints,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Fichier exporté.

export const TELEMETRY_FORMAT = 'mercy-telemetrie'
export const TELEMETRY_VERSION = 1

export type Etape = 'libre' | 'echauffement' | 'bloc'

export interface TelemetryMeta {
  readonly testeur: number | null
  readonly etape: Etape
  readonly bloc: number | null
  readonly rang: number // rang de la partie dans la session (B3 I11), à partir de 1
  readonly etiquette: BlindLabel | null // étiquette affichée en mode aveugle (B4 I7)
  readonly aveugle: boolean
  readonly vague: string
  readonly graine: number
  readonly variante: Variant | null // null en mode aveugle : la variante est dans le fichier de correspondance
  readonly arme: WeaponId // arme en main au tick 0
  readonly changementsArme: number // évènements weapon-swap (le protocole B4 joue au Couperet seul)
  readonly politique: string | null // null : clavier et souris
  readonly debut: number // tick du monde initial (0)
  readonly fin: number // dernier tick enregistré
  readonly t0: number | null // B4 : premier engagement
  readonly finVague: number | null // tick de wave-end
  readonly horsDelai: boolean // B4 §11 : 300 s sans fin de vague (mode aveugle)
  readonly hashDepart: string
  readonly hashFinal: string
  readonly rejouable: boolean // faux si l'enregistrement n'a pas commencé au monde initial
  readonly remarque: string | null
}

export interface TelemetryFile {
  readonly format: typeof TELEMETRY_FORMAT
  readonly version: typeof TELEMETRY_VERSION
  readonly meta: TelemetryMeta
  readonly commands: readonly EncodedCommand[] // commandes appliquées, une par step : commands[i] mène au tick i + 1
  readonly events: readonly SimEvent[] // évènements du monde initial, puis de chaque step
  readonly series: readonly SeriesLine[] // B4 I4 : une ligne au tick 0, puis une par step
  readonly notes: readonly TickNote[]
  readonly metrics: RunMetrics // reduceRun, le même réducteur que les bots
  readonly checkpoints: readonly Checkpoint[] // hash du monde au tick 0 puis tous les CHECKPOINT_EVERY ticks
  readonly moteur: string | null // moteur JS qui a joué la partie (la simulation n'est exacte que dans un même moteur)
  readonly audio: AudioLog | null // B5 I1 : entrées du journal audio écrites pendant la partie
  readonly frames: FrameStats | null
}

export type MetaInput = Omit<
  TelemetryMeta,
  'debut' | 'fin' | 't0' | 'finVague' | 'hashDepart' | 'hashFinal' | 'arme' | 'changementsArme'
>

export const buildTelemetry = (
  rec: RunRecorder,
  meta: MetaInput,
  extras: {
    readonly audio?: AudioLog | null
    readonly frames?: FrameStats | null
    readonly moteur?: string | null
  } = {},
): TelemetryFile => {
  const last = rec.last()
  const events = rec.events()
  return {
    format: TELEMETRY_FORMAT,
    version: TELEMETRY_VERSION,
    meta: {
      ...meta,
      variante: meta.aveugle ? null : meta.variante,
      arme: rec.world0.player.weapon,
      changementsArme: events.filter((e) => e.type === 'weapon-swap').length,
      debut: rec.world0.tick,
      fin: last.tick,
      t0: rec.t0(),
      finVague: last.wave.endedAt,
      hashDepart: hashWorld(rec.world0),
      hashFinal: hashWorld(last),
    },
    commands: rec.commands(),
    events,
    series: rec.series(),
    notes: rec.notes(),
    metrics: rec.metrics(),
    checkpoints: rec.checkpoints(),
    moteur: extras.moteur ?? null,
    audio: extras.audio ?? null,
    frames: extras.frames ?? null,
  }
}

// JSON du fichier. Les nombres des commandes sont déjà encodés exactement ; le reste est rejoué, pas relu.
export const telemetryJson = (f: TelemetryFile): string => `${JSON.stringify(f)}\n`

// Nom de fichier : jamais la variante en mode aveugle, seulement l'étiquette affichée.
export const telemetryFileName = (m: TelemetryMeta): string => {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[^A-Za-z0-9]+/g, '')
      .toLowerCase()
  const parts = [
    'mercy',
    m.testeur === null ? null : `t${m.testeur}`,
    m.etape === 'bloc' ? `bloc${m.bloc}` : m.etape === 'echauffement' ? 'echauffement' : null,
    m.vague,
    `g${m.graine}`,
    m.aveugle ? (m.etiquette === null ? null : slug(m.etiquette)) : m.variante,
    m.politique === null ? null : m.politique.replace(/[^A-Za-z0-9=-]+/g, '_'),
    `r${m.rang}`,
    `f${m.fin}`, // un export en cours de partie et celui de la fin ne s'écrasent pas
  ]
  return `${parts.filter((p) => p !== null).join('-')}.json`
}

export const parseTelemetry = (input: string | unknown): TelemetryFile => {
  const v = (typeof input === 'string' ? JSON.parse(input) : input) as Partial<TelemetryFile> | null
  if (!v || v.format !== TELEMETRY_FORMAT)
    throw new Error(`fichier de télémétrie attendu (format ${TELEMETRY_FORMAT})`)
  if (v.version !== TELEMETRY_VERSION)
    throw new Error(`version de télémétrie non prise en charge : ${v.version}`)
  if (!v.meta || !Array.isArray(v.commands) || !Array.isArray(v.events) || !Array.isArray(v.series))
    throw new Error('fichier de télémétrie incomplet : meta, commands, events et series sont obligatoires')
  return v as TelemetryFile
}

// ---------------------------------------------------------------------------------------------------------------
// Rejeu hors navigateur.

export const variantOf = (f: TelemetryFile, corr?: Correspondence): Variant => {
  if (f.meta.variante !== null) return f.meta.variante
  if (!corr)
    throw new Error(
      "export à l'aveugle : la variante est dans le fichier de correspondance (--correspondance)",
    )
  if (corr.testeur !== f.meta.testeur)
    throw new Error(`correspondance du testeur ${corr.testeur}, export du testeur ${f.meta.testeur}`)
  if (f.meta.etiquette === null) throw new Error("export à l'aveugle sans étiquette")
  return corr.reglages[f.meta.etiquette]
}

// Description du moteur JS courant : navigateur ou Node.
export const moteurCourant = (): string => {
  const g = globalThis as {
    navigator?: { userAgent?: string }
    process?: { version?: string; versions?: { v8?: string } }
  }
  if (g.process?.versions?.v8 !== undefined) return `Node ${g.process.version} (V8 ${g.process.versions.v8})`
  return g.navigator?.userAgent ?? 'inconnu'
}

export const initialWorld = (
  s: { readonly vague: string; readonly graine: number; readonly variante: Variant },
  families: FamilyRegistry = FAMILIES,
): World => createWorld({ seed: s.graine, wave: waveById(s.vague), variant: s.variante, families })

export interface ReplayResult {
  readonly variante: Variant
  readonly ticks: number
  readonly fin: number
  readonly hashDepart: string
  readonly hashFinal: string
  readonly hashDepartIdentique: boolean
  readonly hashFinalIdentique: boolean
  readonly evenementsIdentiques: boolean
  readonly serieIdentique: boolean
  readonly notesIdentiques: boolean
  readonly metriquesIdentiques: boolean
  readonly premierEcart: { readonly champ: string; readonly index: number } | null
  // Points de contrôle (hash du monde tous les CHECKPOINT_EVERY ticks) dont le hash diffère.
  readonly pointsDeControleDivergents: readonly number[]
  readonly premierTickDivergent: number | null
  // Même monde initial, même hash final, mêmes évènements, série, notes et métriques.
  readonly memeHashFinalEtMemesMesures: boolean
  // Et, en plus, le même monde à chaque point de contrôle : rejeu identique au bit près.
  readonly identique: boolean
  readonly diagnostic: string | null
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const firstDiff = (a: readonly unknown[], b: readonly unknown[]): number => {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i
  return -1
}

export const replayTelemetry = (
  f: TelemetryFile,
  opts: { readonly correspondence?: Correspondence; readonly families?: FamilyRegistry } = {},
): ReplayResult => {
  if (!f.meta.rejouable)
    throw new Error(
      `partie marquée non rejouable : ${f.meta.remarque ?? 'enregistrement commencé en cours de partie'}`,
    )
  const variante = variantOf(f, opts.correspondence)
  const world0 = initialWorld({ vague: f.meta.vague, graine: f.meta.graine, variante }, opts.families)
  const rec = createRunRecorder(world0, { voices: false })
  let w = world0
  for (const e of f.commands) {
    const cmd = decodeCommand(e)
    w = step(w, cmd)
    rec.record(cmd, w)
  }
  const hashDepart = hashWorld(world0)
  const hashFinal = hashWorld(w)
  const recorded = new Map((f.checkpoints ?? []).map(([t, h]) => [t, h]))
  const pointsDeControleDivergents = rec
    .checkpoints()
    .filter(([t, h]) => recorded.has(t) && recorded.get(t) !== h)
    .map(([t]) => t)
  const premierTickDivergent =
    pointsDeControleDivergents[0] ?? (hashFinal !== f.meta.hashFinal ? f.meta.fin : null)
  const ev = same(rec.events(), f.events)
  const se = same(rec.series(), f.series)
  const no = same(rec.notes(), f.notes)
  const me = same(rec.metrics(), f.metrics)
  const premierEcart = !ev
    ? { champ: 'events', index: firstDiff(rec.events(), f.events) }
    : !se
      ? { champ: 'series', index: firstDiff(rec.series(), f.series) }
      : !no
        ? { champ: 'notes', index: firstDiff(rec.notes(), f.notes) }
        : null
  const diagnostic =
    hashDepart !== f.meta.hashDepart
      ? `monde initial différent : le moteur JS du rejeu (${moteurCourant()}) ne calcule pas comme celui de la partie (${f.moteur ?? 'inconnu'}) ; src/sim/vec.ts utilise Math.cos, sin, atan2 et hypot, qui ne sont pas exacts d'un moteur à l'autre`
      : premierTickDivergent !== null
        ? `monde différent aux ticks ${pointsDeControleDivergents.join(', ') || f.meta.fin} : ${
            moteurCourant() === f.moteur
              ? 'même moteur JS, donc journal altéré ou incomplet'
              : `journal altéré, ou écart de moteur JS (${moteurCourant()} contre ${f.moteur ?? 'inconnu'})`
          }`
        : null
  const result = {
    variante,
    ticks: f.commands.length,
    fin: w.tick,
    hashDepart,
    hashFinal,
    hashDepartIdentique: hashDepart === f.meta.hashDepart,
    hashFinalIdentique: hashFinal === f.meta.hashFinal,
    evenementsIdentiques: ev,
    serieIdentique: se,
    notesIdentiques: no,
    metriquesIdentiques: me,
    premierEcart,
    pointsDeControleDivergents,
    premierTickDivergent,
    diagnostic,
  }
  const memes =
    result.hashDepartIdentique && result.hashFinalIdentique && ev && se && no && me && w.tick === f.meta.fin
  return {
    ...result,
    memeHashFinalEtMemesMesures: memes,
    identique: memes && pointsDeControleDivergents.length === 0,
  }
}
