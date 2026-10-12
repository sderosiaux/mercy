// Génère la banque sonore de P0 avec l'API ElevenLabs (génération de sons, GAME_SPEC.md §27) et écrit le
// manifeste étendu de B5 I8 dans public/audio/manifest.json.
//
//   pnpm tsx scripts/generate-audio.ts                 génère les fichiers absents
//   pnpm tsx scripts/generate-audio.ts --only cri-03   un seul son (absent)
//   pnpm tsx scripts/generate-audio.ts --only cri-03 --force   régénère un son existant
//   pnpm tsx scripts/generate-audio.ts --reprocess --force     rejoue les retouches depuis les réponses brutes
//                                                              en cache, sans appel à l'API
//
// Un fichier existant n'est jamais réécrit sans --force. La clé est lue dans ELEVENLABS_API_KEY, jamais écrite.
// Après chaque génération, les contrôles de B5.O11 (src/audio/o11.ts, les mêmes que analyseBank) tournent sur les
// échantillons écrits ; un fichier qui échoue est régénéré, 2 fois au plus (3 générations).
// Retouches permises par B5 §7 (O11) et consignées dans le manifeste : passage en mono, rééchantillonnage à
// 48 kHz, offset de départ, point de boucle (fondu enchaîné de jonction), niveau, queue d'impact rognée.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BENCH_RATE, QUANTUM } from '../src/audio/constants'
import type { Manifest, ManifestEntry, Role } from '../src/audio/manifest'
import { analyseFile, nonSilentMedian, playedOnce } from '../src/audio/o11'
import { encodeWav, fromPcm16, quantize16 } from '../src/audio/wav'
import { TICK_HZ, TUNING } from '../src/sim/index'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'audio')
const manifestPath = path.join(outDir, 'manifest.json')
const rawDir = path.join(os.tmpdir(), 'mercy-audio-raw')
const API = 'https://api.elevenlabs.io/v1'
const MODEL = 'eleven_text_to_sound_v2'
const MAX_ATTEMPTS = 3

// Niveau visé du fichier : M_f (médiane des quanta non silencieux) ou crête pour les sons brefs.
// Ce ne sont pas des valeurs du spec (B5 §7, O10) : ce sont des choix de mixage, consignés ici et dans le manifeste.
type Level = { readonly mf: number } | { readonly peak: number }

interface Asset {
  readonly id: string
  readonly role: Role
  readonly prompt: string
  readonly seconds: number
  readonly apiLoop: boolean
  readonly loop: boolean // le lecteur boucle ce fichier
  readonly influence: number
  readonly level: Level
}

const DRY = 'completely dry close-up recording, no reverb, no echo, no music'

const CRY_VOICES = [
  'a grown man with a deep raw throat',
  'a young man with a high strained voice',
  'an old man with a cracked rasping voice',
  'a grown woman with a piercing shrill voice',
  'a young woman with a wavering tearful voice',
  'an old woman with a thin trembling voice',
  'a heavy-set man with a guttural bellowing voice',
  'a teenage boy whose voice cracks',
  'a woman with a low hoarse rough voice',
  'a man with a wet gurgling throat',
  'a woman with a keening ululating voice',
  'a sexless, strangely flat voice, an unnaturally steady inhuman shriek',
]
const BREATHERS = ['a wounded man', 'a wounded woman', 'a wounded old man', 'a wounded young woman']

const n2 = (i: number) => String(i + 1).padStart(2, '0')
const channelS = (ticks: number) => ticks / TICK_HZ

const ASSETS: readonly Asset[] = [
  ...CRY_VOICES.map(
    (v, i): Asset => ({
      id: `cri-${n2(i)}`,
      role: 'cri',
      prompt: `${v}, lying on the ground and screaming in agony: one single continuous sustained scream that never stops, no breaths, no pauses, no silence, steady loudness, raw and desperate, ${DRY}`,
      seconds: 6,
      apiLoop: true,
      loop: true,
      influence: 0.5,
      level: { mf: -24 },
    }),
  ),
  ...BREATHERS.map(
    (v, i): Asset => ({
      id: `halete-${n2(i)}`,
      role: 'halètement',
      prompt: `${v} who has just collapsed to the ground, panting in short, ragged, desperate breaths through clenched teeth, shaky and wet, starting immediately and continuing for the whole clip, ${DRY}`,
      seconds: 2.5,
      apiLoop: false,
      loop: false,
      influence: 0.5,
      level: { mf: -27 },
    }),
  ),
  ...BREATHERS.map(
    (v, i): Asset => ({
      id: `inspire-${n2(i)}`,
      role: 'inspiration',
      prompt: `${v} lying on the ground taking one single extremely long, slow, rasping inhalation through the mouth, a continuous strained gasp of air that starts immediately and lasts the whole clip without stopping, no exhale, ${DRY}`,
      seconds: 3,
      apiLoop: false,
      loop: true,
      influence: 0.5,
      level: { mf: -27 },
    }),
  ),
  ...['a man', 'a woman', 'an old man'].map(
    (v, i): Asset => ({
      id: `cri-etouffe-${n2(i)}`,
      role: 'cri-etouffe',
      prompt: `${v} screaming continuously from inside a thick wet leather sack, the scream heavily muffled, smothered and dull with no high frequencies, one unbroken sustained sound, no pauses, ${DRY}`,
      seconds: 6,
      apiLoop: true,
      loop: true,
      influence: 0.5,
      level: { mf: -32 },
    }),
  ),
  {
    id: 'gargouillis',
    role: 'gargouillis',
    prompt: `Wet viscous gurgling and bubbling inside a bloated sack of flesh, thick liquid churning and sloshing, continuous and steady, ${DRY}`,
    seconds: 5,
    apiLoop: true,
    loop: true,
    influence: 0.5,
    level: { mf: -26 },
  },
  {
    id: 'chant',
    role: 'chant',
    prompt: `A single hoarse male priest chanting a droning prayer in an unknown tongue, the voice rising steadily in pitch and intensity from a low murmur to a fervent cry, continuous from the first instant, ${DRY}, no choir`,
    seconds: channelS(TUNING.confesseur.prayerChannel) + 0.5,
    apiLoop: false,
    loop: false,
    influence: 0.5,
    level: { mf: -24 },
  },
  {
    id: 'etranglement',
    role: 'etranglement',
    prompt: `A chanting man's voice suddenly choking and strangling, a short wet gagging gurgle that trails off, ${DRY}`,
    seconds: 1,
    apiLoop: false,
    loop: false,
    influence: 0.6,
    level: { mf: -24 },
  },
  {
    id: 'scie',
    role: 'scie',
    prompt: `A surgical bone saw cutting through flesh and bone, starting slow and accelerating steadily faster until the end, continuous sawing from the first instant, ${DRY}`,
    seconds: channelS(TUNING.chirurgien.operation) + 0.5,
    apiLoop: false,
    loop: false,
    influence: 0.5,
    level: { mf: -24 },
  },
  {
    id: 'coutures',
    role: 'coutures',
    prompt: `Slow continuous creaking and squeaking of thick leather stitches and taut sutures stretching on a heavy swaying body, ${DRY}`,
    seconds: 5,
    apiLoop: true,
    loop: true,
    influence: 0.5,
    level: { mf: -28 },
  },
  {
    id: 'nappe',
    role: 'nappe',
    prompt:
      'A distant dark choir of many voices humming one single sustained low chord, a continuous drone with no rhythm, no melody, no percussion, no breaths, steady level, no instruments',
    seconds: 12,
    apiLoop: true,
    loop: true,
    influence: 0.5,
    level: { mf: -14 },
  },
  {
    id: 'vent',
    role: 'vent',
    prompt:
      'Cold steady wind blowing over an empty stone pit, continuous soft ambience, no gusts that drop to silence, no birds, no music',
    seconds: 12,
    apiLoop: true,
    loop: true,
    influence: 0.5,
    level: { mf: -38 },
  },
  {
    id: 'impact-tranchant',
    role: 'impact-tranchant',
    prompt: `A heavy butcher's cleaver chopping into flesh: one single short wet meaty slice impact, extremely short, ${DRY}, no tail`,
    seconds: 0.5,
    apiLoop: false,
    loop: false,
    influence: 0.7,
    level: { peak: -3 },
  },
  {
    id: 'impact-contondant',
    role: 'impact-contondant',
    prompt: `A heavy iron mace crushing bone: one single short dull thud with a bone crack, extremely short, ${DRY}, no tail`,
    seconds: 0.5,
    apiLoop: false,
    loop: false,
    influence: 0.7,
    level: { peak: -3 },
  },
  {
    id: 'clang',
    role: 'clang',
    prompt: `A steel blade striking a golden metal plate: one single short sharp metallic clang, ${DRY}`,
    seconds: 0.5,
    apiLoop: false,
    loop: false,
    influence: 0.7,
    level: { peak: -6 },
  },
  {
    id: 'mat',
    role: 'mat',
    prompt: `A single soft dull muted thump, like a palm tapping thick cloth, very short and quiet, ${DRY}`,
    seconds: 0.5,
    apiLoop: false,
    loop: false,
    influence: 0.7,
    level: { peak: -18 },
  },
]

// ---------------------------------------------------------------------------------------------------------

interface Args {
  readonly only: readonly string[] | null
  readonly force: boolean
  readonly reprocess: boolean
  readonly useAttempt: number | null // --reprocess : réponse brute d'une autre génération déjà faite
  readonly reason: string | null // consigné dans l'historique quand --force remplace un fichier accepté
}

const parseArgs = (argv: readonly string[]): Args => {
  const i = argv.indexOf('--only')
  const only = i >= 0 ? (argv[i + 1] ?? '').split(',').filter(Boolean) : null
  const ua = argv.indexOf('--use-attempt')
  const rs = argv.indexOf('--reason')
  return {
    only,
    force: argv.includes('--force'),
    reprocess: argv.includes('--reprocess'),
    useAttempt: ua >= 0 ? Number(argv[ua + 1]) : null,
    reason: rs >= 0 ? (argv[rs + 1] ?? null) : null,
  }
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

interface Raw {
  readonly bytes: Buffer
  readonly format: string
}

const rawPath = (id: string, attempt: number, format: string) =>
  path.join(rawDir, `${id}.a${attempt}.${format.startsWith('pcm') ? 'pcm' : 'mp3'}`)

const callApi = async (a: Asset, format: string): Promise<Response> =>
  fetch(`${API}/sound-generation?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: a.prompt,
      duration_seconds: a.seconds,
      prompt_influence: a.influence,
      loop: a.apiLoop,
      model_id: MODEL,
    }),
  })

// PCM 48 kHz d'abord (pas de délai de codec) ; MP3 si l'abonnement le refuse.
let preferredFormat = 'pcm_48000'
const generate = async (a: Asset, attempt: number): Promise<Raw> => {
  for (const format of [preferredFormat, 'mp3_44100_128']) {
    const res = await callApi(a, format)
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(rawPath(a.id, attempt, format), bytes)
      return { bytes, format }
    }
    const body = await res.text()
    if (format === 'pcm_48000' && (res.status === 403 || res.status === 422 || res.status === 400)) {
      console.warn(`${a.id}: ${format} refusé (${res.status} ${body.slice(0, 160)}), repli sur MP3`)
      preferredFormat = 'mp3_44100_128'
      continue
    }
    throw new Error(`${a.id}: API ${res.status} ${body.slice(0, 300)}`)
  }
  throw new Error(`${a.id}: aucun format accepté`)
}

const readCachedRaw = (id: string, attempt: number): Raw | null => {
  for (const format of ['pcm_48000', 'mp3_44100_128']) {
    const p = rawPath(id, attempt, format)
    if (fs.existsSync(p)) return { bytes: fs.readFileSync(p), format }
  }
  return null
}

// Décodage en flottants 48 kHz par ffmpeg. Le PCM brut de l'API est en s16le ; son nombre de canaux se déduit
// de la taille (durée demandée connue).
const decode = (raw: Raw, a: Asset): { channels: Float32Array[]; srcChannels: number; note: string } => {
  const tmpIn = path.join(rawDir, `${a.id}.in`)
  fs.writeFileSync(tmpIn, raw.bytes)
  let srcChannels: number
  let inputArgs: string[]
  if (raw.format.startsWith('pcm')) {
    const perChannel = BENCH_RATE * 2 * a.seconds
    srcChannels = raw.bytes.length > perChannel * 1.5 ? 2 : 1
    inputArgs = ['-f', 's16le', '-ar', String(BENCH_RATE), '-ac', String(srcChannels), '-i', tmpIn]
  } else {
    const probe = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=channels',
      '-of',
      'csv=p=0',
      tmpIn,
    ])
      .toString()
      .trim()
    srcChannels = Number(probe) || 1
    inputArgs = ['-i', tmpIn]
  }
  const out = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', ...inputArgs, '-ac', '1', '-ar', String(BENCH_RATE), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30 },
  )
  fs.rmSync(tmpIn, { force: true })
  const mono = new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length))
  const note = raw.format.startsWith('pcm')
    ? `PCM s16le ${srcChannels} canal(aux) 48 kHz`
    : `MP3 décodé par ffmpeg, rééchantillonné à 48 kHz`
  return { channels: [mono], srcChannels, note }
}

const peakDb = (x: Float32Array): number => {
  let m = 0
  for (const v of x) m = Math.max(m, Math.abs(v))
  return m > 0 ? 20 * Math.log10(m) : Number.NEGATIVE_INFINITY
}

// Région de boucle : la plus longue suite de quanta tenus à M_f − 20 dB ou plus (le seuil de l'attaque, O11 a).
const longestSustainedRegion = (
  levels: Float32Array,
  ref: number,
  fromQ: number,
  toQ: number,
): [number, number] => {
  let best: [number, number] = [fromQ, fromQ]
  let start = fromQ
  for (let q = fromQ; q <= toQ; q++) {
    if (q === toQ || (levels[q] as number) < ref - 20) {
      if (q - start > best[1] - best[0]) best = [start, q]
      start = q + 1
    }
  }
  return best
}

// Rôles où un trou par rapport au M_f du fichier compte comme échec (voix et nappe : une pause y ment).
const strictRole = (r: Role): boolean =>
  r === 'cri' || r === 'cri-etouffe' || r === 'inspiration' || r === 'nappe'

const FLAT_WIN_MS = 200
const FLAT_HOP_MS = 25

// Aplanit l'enveloppe d'énergie d'une boucle : gain lissé qui ramène chaque fenêtre de 400 ms à l'énergie médiane.
// Les fenêtres sont circulaires sur [loopStart, loopEnd) : la jonction reste continue.
const flattenLoop = (x: Float32Array, loopStart: number, loopEnd: number): Float32Array => {
  const len = loopEnd - loopStart
  const hop = Math.round((FLAT_HOP_MS / 1000) * BENCH_RATE)
  const win = Math.round((FLAT_WIN_MS / 1000) * BENCH_RATE)
  const at = (i: number) => x[loopStart + (((i % len) + len) % len)] as number
  const nHop = Math.ceil(len / hop)
  const energy = Array.from({ length: nHop }, (_, k) => {
    let e = 0
    for (let i = k * hop - win / 2; i < k * hop + win / 2; i++) e += at(i) ** 2
    return e / win
  })
  const ref = [...energy].sort((p, q) => p - q)[nHop >> 1] as number
  const g = energy.map((e) => Math.sqrt(ref / Math.max(e, 1e-12)))
  const y = x.slice()
  for (let i = 0; i < len; i++) {
    const k = Math.floor(i / hop)
    const f = (i - k * hop) / hop
    const g0 = g[k % nHop] as number
    const g1 = g[(k + 1) % nHop] as number
    y[loopStart + i] = (x[loopStart + i] as number) * (g0 + (g1 - g0) * f)
  }
  return y
}

interface Processed {
  readonly samples: Float32Array
  readonly loopStart: number
  readonly loopEnd: number
  readonly startOffset: number
  readonly retouches: string[]
}

const winDb = (x: Float32Array, from: number, to: number): number => {
  let e = 0
  for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) e += (x[i] as number) ** 2
  return 10 * Math.log10(e / Math.max(1, to - from) + 1e-20)
}

// Points de boucle choisis dans la région tenue [fromS, endQ) : un début où les 50 ms de part et d'autre ont le
// même niveau, puis une fin (seconde moitié de la région, boucle d'au moins 0,5 s) dont les 50 ms qui précèdent,
// après le fondu enchaîné, ont le niveau des 50 ms qui suivent le début. C'est le critère O11 (d) lui-même.
const bestLoop = (x: Float32Array, fromS: number, endQ: number, xf: number): [number, number] => {
  const w = Math.round(0.05 * BENCH_RATE)
  const midQ = Math.floor((fromS / QUANTUM + endQ) / 2)
  let ls = fromS
  let lsCost = Number.POSITIVE_INFINITY
  for (let q = Math.ceil(fromS / QUANTUM); q <= midQ; q++) {
    const s0 = q * QUANTUM
    const c = Math.abs(winDb(x, s0 - w, s0) - winDb(x, s0, s0 + w))
    if (c < lsCost) {
      lsCost = c
      ls = s0
    }
  }
  const after = winDb(x, ls, ls + w)
  const minEnd = ls + Math.round(0.5 * BENCH_RATE)
  let le = (endQ - 2) * QUANTUM
  let leCost = Number.POSITIVE_INFINITY
  for (let q = Math.max(Math.ceil(minEnd / QUANTUM), midQ); q <= endQ - 2; q++) {
    const e0 = q * QUANTUM
    let e = 0
    for (let i = e0 - w; i < e0; i++) {
      const j = i - (e0 - xf)
      const th = (Math.PI / 2) * ((j + 0.5) / xf)
      const v = (x[i] as number) * Math.cos(th) + (x[ls - xf + j] as number) * Math.sin(th)
      e += v * v
    }
    const c = Math.abs(10 * Math.log10(e / w + 1e-20) - after)
    if (c < leCost) {
      leCost = c
      le = e0
    }
  }
  return [ls, le]
}

// Fondu enchaîné de jonction : les X derniers échantillons de la boucle glissent vers ceux qui précèdent
// loopStart, si bien que x[loopEnd − 1] est suivi de sa vraie continuation x[loopStart].
const crossfadeSeam = (x: Float32Array, loopStart: number, loopEnd: number, xf: number): Float32Array => {
  const y = x.slice()
  for (let j = 0; j < xf; j++) {
    const th = (Math.PI / 2) * ((j + 0.5) / xf)
    const tail = x[loopEnd - xf + j] as number
    const head = x[loopStart - xf + j] as number
    y[loopEnd - xf + j] = tail * Math.cos(th) + head * Math.sin(th)
  }
  return y
}

const process1 = (a: Asset, mono: Float32Array, retouches: string[]): Processed => {
  let x = mono
  const levels = playedOnce([x], 0)
  const mf = nonSilentMedian(levels)
  const onsetQ = Math.max(
    0,
    levels.findIndex((l) => l >= mf - 20),
  )
  let startOffset = onsetQ * QUANTUM
  if (startOffset > 0)
    retouches.push(
      `offset de départ ${startOffset} éch. (${((startOffset / BENCH_RATE) * 1000).toFixed(1)} ms de silence de tête sauté)`,
    )
  let loopStart = 0
  let loopEnd = x.length

  // Queue d'impact (O11 f) : rognée seulement si le son généré la dépasse.
  if (a.role === 'impact-tranchant' || a.role === 'impact-contondant') {
    const f = analyseFile(
      a.id,
      { role: a.role, loop: false, loopStart: 0, loopEnd: x.length, startOffset },
      [x],
      BENCH_RATE,
    )
    const row = f.rows.find((r) => r.criterion === 'f')
    if (row && !row.pass) {
      const once = playedOnce([x], startOffset)
      let pq = 0
      once.forEach((l, i) => {
        if (l > (once[pq] as number)) pq = i
      })
      const peak = startOffset + pq * QUANTUM
      const fadeFrom = peak + Math.round(0.05 * BENCH_RATE)
      const fadeTo = peak + Math.round(0.09 * BENCH_RATE)
      const y = x.slice(0, Math.min(x.length, fadeTo))
      for (let i = fadeFrom; i < y.length; i++)
        y[i] = (y[i] as number) * ((fadeTo - i) / (fadeTo - fadeFrom)) ** 2
      x = y
      loopEnd = x.length
      retouches.push(
        `queue rognée : fondu de pic + 50 ms à pic + 90 ms (queue mesurée ${row.value.toFixed(1)} dB sous le pic)`,
      )
    }
  }

  if (a.loop) {
    const once = playedOnce([x], 0)
    const lastAudible = once.reduce((acc, l, i) => (l >= mf - 30 ? i : acc), onsetQ)
    const xf = Math.round(0.08 * BENCH_RATE)
    if (a.apiLoop) {
      // Boucle native de l'API : gardée telle quelle si la jonction passe les contrôles de O11.
      const check = analyseFile(
        a.id,
        { role: a.role, loop: true, loopStart: startOffset, loopEnd: x.length, startOffset },
        [x],
        BENCH_RATE,
      )
      const ok = check.rows
        .filter(
          (r) =>
            r.criterion === 'c' ||
            r.criterion.startsWith('d') ||
            (r.criterion === 'c-fixe' && strictRole(a.role)),
        )
        .every((r) => r.pass)
      if (ok) {
        loopStart = startOffset
        retouches.push(`boucle native de l'API, de ${loopStart} à ${loopEnd}`)
      } else {
        const [q0, q1] = longestSustainedRegion(once, mf, onsetQ, lastAudible)
        ;[loopStart, loopEnd] = bestLoop(x, q0 * QUANTUM + xf, q1, xf)
        x = crossfadeSeam(x, loopStart, loopEnd, xf)
        // La lecture commence au début de la région tenue : la partie qui précède (pauses) n'est jamais jouée.
        startOffset = loopStart - xf
        retouches.push(
          `point de boucle : région tenue ${loopStart}–${loopEnd}, départ ${startOffset}, jonction en fondu enchaîné de ${xf} éch. (boucle native refusée par les contrôles)`,
        )
      }
    } else {
      // Son non bouclé à l'origine (inspiration) : boucle dans la partie tenue, pour qu'une phase prolongée
      // (corps réservé par une Sentence ou une opération) ne finisse jamais sans cause.
      const [q0, q1] = longestSustainedRegion(once, mf, onsetQ, lastAudible)
      const span = q1 - q0
      ;[loopStart, loopEnd] = bestLoop(
        x,
        Math.max(startOffset + xf, (q0 + Math.floor(span * 0.4)) * QUANTUM),
        q1,
        xf,
      )
      x = crossfadeSeam(x, loopStart, loopEnd, xf)
      retouches.push(
        `point de boucle dans la partie tenue : ${loopStart}–${loopEnd}, jonction en fondu enchaîné de ${xf} éch.`,
      )
    }
  }

  // Nappe : enveloppe aplanie sur la boucle. Son niveau doit suivre N (§19, B5.O7 a) ; un chœur généré qui
  // respire de ±4 dB d'une seconde à l'autre inverserait l'ordre entre N et N + 1 (mesuré : ρ = 0,943 sur S-nappe).
  if (a.role === 'nappe') {
    x = flattenLoop(x, loopStart, loopEnd)
    retouches.push(
      `niveau : enveloppe aplanie sur la boucle (fenêtres circulaires de ${FLAT_WIN_MS} ms, pas de ${FLAT_HOP_MS} ms)`,
    )
  }

  // Niveau.
  const lv = playedOnce([x], startOffset)
  const curMf = nonSilentMedian(lv)
  const pk = peakDb(x)
  const want = 'mf' in a.level ? a.level.mf - curMf : a.level.peak - pk
  const gainDb = Math.min(want, -1 - pk)
  const g = 10 ** (gainDb / 20)
  x = x.map((v) => v * g)
  retouches.push(
    `niveau ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(2)} dB (${'mf' in a.level ? `M_f visé ${a.level.mf} dBFS` : `crête visée ${a.level.peak} dBFS`}${gainDb < want - 0.01 ? ', limité par la crête à −1 dBFS' : ''})`,
  )
  return { samples: quantize16(x), loopStart, loopEnd, startOffset, retouches }
}

interface Built {
  readonly entry: ManifestEntry
  readonly failures: string[]
}

const build = (a: Asset, raw: Raw, attempt: number, history: readonly string[]): Built => {
  const { channels, srcChannels, note } = decode(raw, a)
  const retouches: string[] = [note]
  if (srcChannels > 1) retouches.push(`passage en mono : moyenne de ${srcChannels} canaux`)
  const mono = channels[0] as Float32Array
  const p = process1(a, mono, retouches)
  const wav = encodeWav([p.samples], BENCH_RATE)
  const file = `${a.id}.wav`
  fs.writeFileSync(path.join(outDir, file), wav)
  const shape = {
    role: a.role,
    loop: a.loop,
    loopStart: p.loopStart,
    loopEnd: p.loopEnd,
    startOffset: p.startOffset,
  }
  const check = analyseFile(a.id, shape, [p.samples], BENCH_RATE)
  const strict = strictRole(a.role)
  const failures = check.rows
    .filter((r) => !r.pass && (r.criterion !== 'c-fixe' || strict))
    .map((r) => `${r.criterion}: ${r.measure} = ${r.value} (${r.threshold})`)
  if (a.loop && p.loopEnd - p.loopStart < 0.5 * BENCH_RATE)
    failures.push(`boucle trop courte : ${p.loopEnd - p.loopStart} éch. (< 0,5 s de contenu continu)`)
  const entry: ManifestEntry = {
    id: a.id,
    file,
    role: a.role,
    prompt: a.prompt,
    model: MODEL,
    apiOutputFormat: raw.format,
    promptInfluence: a.influence,
    requestedDurationS: a.seconds,
    apiLoop: a.apiLoop,
    durationMs: Math.round((p.samples.length / BENCH_RATE) * 1000),
    frames: p.samples.length,
    loop: a.loop,
    loopStart: p.loopStart,
    loopEnd: p.loopEnd,
    startOffset: p.startOffset,
    channels: 1,
    sampleRate: BENCH_RATE,
    format: 'wav-pcm16',
    sha256: sha256(wav),
    rawSha256: sha256(raw.bytes),
    retouches: [...history, ...p.retouches],
    generatedAt: new Date().toISOString(),
    attempt,
  }
  return { entry, failures }
}

const readManifest = (): Manifest | null =>
  fs.existsSync(manifestPath) ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest) : null

const writeManifest = (entries: readonly ManifestEntry[]): void => {
  const files = [...entries].sort((x, y) => (x.id < y.id ? -1 : 1))
  const bankSha256 = createHash('sha256')
    .update(files.map((f) => `${f.id}:${f.sha256}`).join('\n'))
    .digest('hex')
  const m: Manifest = {
    version: 1,
    generator: 'scripts/generate-audio.ts',
    sampleRate: BENCH_RATE,
    quantum: QUANTUM,
    bankSha256,
    files,
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`)
}

const runAsset = async (a: Asset, args: Args, prev: ManifestEntry | undefined): Promise<ManifestEntry> => {
  const out = path.join(outDir, `${a.id}.wav`)
  if (fs.existsSync(out) && !args.force) throw new Error(`${a.id}: existe déjà (--force pour le réécrire)`)
  if (args.reprocess) {
    const attempt = args.useAttempt ?? prev?.attempt ?? 1
    const raw = readCachedRaw(a.id, attempt)
    if (!raw) throw new Error(`${a.id}: pas de réponse brute en cache pour la génération ${attempt}`)
    const history = prev ? historyOf(prev) : []
    if (args.reason) history.push(`génération ${prev?.attempt ?? attempt} : ${args.reason}`)
    if (args.useAttempt !== null)
      history.push(`génération ${attempt} retenue parmi celles déjà faites (réponse brute en cache)`)
    const { entry, failures } = build(a, raw, attempt, history)
    console.log(
      `${a.id}: retraité depuis le cache (génération ${attempt}) ${failures.length ? `ÉCHECS ${failures.join(' | ')}` : 'contrôles O11 ok'}`,
    )
    return entry
  }
  const history: string[] = prev ? historyOf(prev) : []
  if (prev && args.reason) history.push(`génération ${prev.attempt} remplacée : ${args.reason}`)
  let attempt = prev ? prev.attempt + 1 : 1
  for (;;) {
    if (attempt > MAX_ATTEMPTS)
      throw new Error(`${a.id}: ${MAX_ATTEMPTS} générations déjà faites, plus de régénération`)
    const raw = await generate(a, attempt)
    const { entry, failures } = build(a, raw, attempt, history)
    if (failures.length === 0) {
      console.log(`${a.id}: génération ${attempt}, ${entry.durationMs} ms, contrôles O11 ok`)
      return entry
    }
    console.log(`${a.id}: génération ${attempt} ÉCHOUE ${failures.join(' | ')}`)
    history.push(`génération ${attempt} rejetée (${failures.join(' ; ')})`)
    if (attempt === MAX_ATTEMPTS) {
      console.log(`${a.id}: gardé après ${MAX_ATTEMPTS} générations, signalé`)
      return {
        ...entry,
        retouches: [...entry.retouches, `SIGNALÉ : échoue encore O11 après ${MAX_ATTEMPTS} générations`],
      }
    }
    attempt++
  }
}

const historyOf = (e: ManifestEntry): string[] => e.retouches.filter((r) => r.startsWith('génération '))

const pool = async <T, R>(items: readonly T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await f(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return results
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const known = new Set(ASSETS.map((a) => a.id))
  const unknown = (args.only ?? []).filter((id) => !known.has(id))
  if (unknown.length) throw new Error(`ids inconnus : ${unknown.join(', ')}`)
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(rawDir, { recursive: true })
  const prev = readManifest()
  const prevById = new Map((prev?.files ?? []).map((e) => [e.id, e]))
  const targets = ASSETS.filter((a) => {
    if (args.only) return args.only.includes(a.id)
    return args.force || !fs.existsSync(path.join(outDir, `${a.id}.wav`))
  })
  const skipped = ASSETS.filter(
    (a) => args.only?.includes(a.id) && fs.existsSync(path.join(outDir, `${a.id}.wav`)) && !args.force,
  )
  for (const a of skipped) console.log(`${a.id}: existe déjà, ignoré (--force pour le régénérer)`)
  const todo = targets.filter((a) => !skipped.includes(a))
  if (todo.length && !args.reprocess && !process.env.ELEVENLABS_API_KEY)
    throw new Error('ELEVENLABS_API_KEY absente')
  const done = await pool(todo, 3, (a) =>
    runAsset(a, args, prevById.get(a.id)).catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e))
      return null
    }),
  )
  const merged = new Map(prevById)
  for (const e of done) if (e) merged.set(e.id, e)
  // Seuls les fichiers présents sur disque restent au manifeste.
  const entries = [...merged.values()].filter(
    (e) => fs.existsSync(path.join(outDir, e.file)) && known.has(e.id),
  )
  writeManifest(entries)
  const failed = done.filter((e) => e === null).length
  console.log(
    `manifeste : ${entries.length}/${ASSETS.length} fichiers${failed ? `, ${failed} en erreur` : ''}`,
  )
  // Contrôle global O11 (g) sur les cris, mêmes fonctions que analyseBank.
  const cries = entries.filter((e) => e.role === 'cri')
  const mfs = cries.map((e) => {
    const buf = fs.readFileSync(path.join(outDir, e.file))
    const x = new Float32Array((buf.length - 44) / 2)
    for (let i = 0; i < x.length; i++) x[i] = fromPcm16(buf.readInt16LE(44 + 2 * i))
    return nonSilentMedian(playedOnce([x], e.startOffset))
  })
  if (mfs.length) console.log(`M_f des cris : ${mfs.map((m) => m.toFixed(2)).join(' ')}`)
  if (failed) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
