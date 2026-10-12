// B5.O11 : mesures du contenu de chaque fichier tel que joué (tampon décodé, offset et points de boucle du
// manifeste). Fonctions pures sur des Float32Array : le navigateur (I9, analyseBank) et le script de
// génération les appellent sur les mêmes définitions.
import { AGONIE_END_S, AGONIE_S, AGONY_RATE_SPREAD, agonyEnvelopeDb, QUANTUM, SILENCE_DB } from './constants'
import { AGONY_ROLES, IMPACT_ROLES, type ManifestEntry, type Role, SPATIAL_ROLES } from './manifest'

// 'c-fixe' n'est pas un critère du contrat : même seuil que (c) (30 dB, 20 ms) mais rapporté au M_f du fichier
// au lieu de la médiane glissante. Une décroissance lente vers le silence passe (c) (la médiane suit) ; elle ne
// passe pas 'c-fixe'. Rapporté à part, jamais mêlé au verdict de O11.
export type Criterion =
  | 'a'
  | 'b'
  | 'c'
  | 'c-fixe'
  | 'd-saut'
  | 'd-niveau'
  | 'e'
  | 'f'
  | 'g'
  | 'empreinte'
  | 'decodage'
  | 'nappe-extinction'
  | 'h'
  // Hors contrat, rapportés à part : forme du râle tel qu'on l'entend (enveloppe du lecteur aux vitesses 0,94, 1 et
  // 1,06), d'après B5.O3 (b) à (d), que le générateur sert de contrôle d'acceptation ; et niveau de sa fenêtre de 20 ms
  // la plus forte.
  | 'agonie-forme'
  | 'agonie-niveau'

export interface O11Row {
  readonly file: string
  readonly role: Role
  readonly criterion: Criterion
  readonly measure: string
  readonly value: number
  readonly unit: string
  readonly threshold: string
  readonly pass: boolean
}

export interface FileShape {
  readonly role: Role
  readonly loop: boolean
  readonly loopStart: number
  readonly loopEnd: number
  readonly startOffset: number
  readonly gainDb?: number // gain de lecture du manifeste (0 si absent)
}

const db = (meanSquare: number): number =>
  meanSquare > 0 ? 10 * Math.log10(meanSquare) : Number.NEGATIVE_INFINITY

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

// Niveau RMS (dBFS) de chaque quantum d'une suite d'échantillons définie par un index → position dans le tampon.
// Énergie moyenne sur tous les canaux : c'est ce que rapporte aussi le mesureur du banc.
export const quantumLevels = (
  channels: readonly Float32Array[],
  length: number,
  at: (i: number) => number,
): Float32Array => {
  const n = Math.ceil(length / QUANTUM)
  const out = new Float32Array(n)
  for (let q = 0; q < n; q++) {
    let s = 0
    for (let k = 0; k < QUANTUM; k++) {
      const i = q * QUANTUM + k
      if (i >= length) break // au-delà de la fin : zéros
      const p = at(i)
      for (const ch of channels) {
        const v = ch[p] ?? 0
        s += v * v
      }
    }
    out[q] = db(s / (QUANTUM * channels.length))
  }
  return out
}

export const nonSilentMedian = (levels: ArrayLike<number>): number => {
  const xs: number[] = []
  for (let i = 0; i < levels.length; i++) if ((levels[i] as number) > SILENCE_DB) xs.push(levels[i] as number)
  return median(xs)
}

// Lecture sans boucle depuis l'offset de départ.
export const playedOnce = (channels: readonly Float32Array[], startOffset: number): Float32Array => {
  const len = Math.max(0, (channels[0]?.length ?? 0) - startOffset)
  return quantumLevels(channels, len, (i) => startOffset + i)
}

// Lecture en boucle, `turns` tours : de l'offset à loopEnd, puis loopStart → loopEnd.
export const playedLooped = (
  channels: readonly Float32Array[],
  s: Pick<FileShape, 'loopStart' | 'loopEnd' | 'startOffset'>,
  turns: number,
): Float32Array => {
  const head = s.loopEnd - s.startOffset
  const period = s.loopEnd - s.loopStart
  const len = head + (turns - 1) * period
  return quantumLevels(channels, len, (i) =>
    i < head ? s.startOffset + i : s.loopStart + ((i - head) % period),
  )
}

// B5.O6 (c) appliqué au fichier : passages d'au moins 20 ms (8 quanta) à M₂₀₀ − 30 dB ou moins.
// Passages d'au moins 8 quanta à `ref` − 30 dB ou moins, référence fixe.
export const fixedGaps = (levels: ArrayLike<number>, ref: number): { gaps: number; worstRunQ: number } => {
  let gaps = 0
  let run = 0
  let worst = 0
  for (let q = 0; q < levels.length; q++) {
    if ((levels[q] as number) <= ref - 30) {
      run++
      worst = Math.max(worst, run)
      if (run === 8) gaps++
    } else run = 0
  }
  return { gaps, worstRunQ: worst }
}

// Même mesure, à partir du quantum `from`, avec la médiane de l'historique disponible (au plus 200 ms) : sur une partie
// jouée plus courte que 200 ms d'historique (début d'un râle), rien n'échappe à la mesure.
export const continuityGapsFrom = (
  levels: ArrayLike<number>,
  from: number,
): { gaps: number; worstRunQ: number } => {
  const win = Math.round(0.2 / (QUANTUM / 48_000))
  let gaps = 0
  let run = 0
  let worst = 0
  for (let q = Math.max(1, from); q < levels.length; q++) {
    const prev: number[] = []
    for (let k = Math.max(0, q - win); k < q; k++) prev.push(levels[k] as number)
    if ((levels[q] as number) <= median(prev) - 30) {
      run++
      worst = Math.max(worst, run)
      if (run === 8) gaps++
    } else run = 0
  }
  return { gaps, worstRunQ: worst }
}

export const continuityGaps = (levels: ArrayLike<number>): { gaps: number; worstRunQ: number } => {
  const win = Math.round(0.2 / (QUANTUM / 48_000)) // 75 quanta
  const minRun = 8
  let gaps = 0
  let run = 0
  let worst = 0
  for (let q = win; q < levels.length; q++) {
    const prev: number[] = []
    for (let k = q - win; k < q; k++) prev.push(levels[k] as number)
    const m200 = median(prev)
    if ((levels[q] as number) <= m200 - 30) {
      run++
      worst = Math.max(worst, run)
      if (run === minRun) gaps++
    } else run = 0
  }
  return { gaps, worstRunQ: worst }
}

const percentile = (sorted: Float32Array, p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number

const pearson = (a: Float32Array, b: Float32Array): number => {
  const n = Math.min(a.length, b.length)
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i] as number
    mb += b[i] as number
  }
  ma /= n
  mb /= n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma
    const y = (b[i] as number) - mb
    sab += x * y
    saa += x * x
    sbb += y * y
  }
  return sab / Math.sqrt(saa * sbb + 1e-30)
}

const rmsDb = (channels: readonly Float32Array[], from: number, to: number): number => {
  let s = 0
  let n = 0
  for (const ch of channels) {
    for (let i = Math.max(0, from); i < Math.min(ch.length, to); i++) {
      const v = ch[i] as number
      s += v * v
    }
    n += to - from
  }
  return db(s / Math.max(1, n))
}

const MS_PER_Q = (QUANTUM / 48_000) * 1000

// Niveaux par quantum du râle tel qu'on l'entend : niveaux du fichier depuis l'offset, plus l'enveloppe du lecteur au
// milieu de chaque quantum, jusqu'à la fin programmée de l'agonie.
export const agonyHeard = (once: ArrayLike<number>, sampleRate: number): Float32Array => {
  const qs = Math.min(once.length, Math.ceil((AGONIE_END_S * sampleRate) / QUANTUM))
  const out = new Float32Array(qs)
  for (let q = 0; q < qs; q++)
    out[q] = (once[q] as number) + agonyEnvelopeDb(((q + 0.5) * QUANTUM) / sampleRate)
  return out
}

// Forme du râle tel qu'on l'entend à la vitesse `rate` (B5.O3 b, c, d, sur la seule piste d'agonie) : niveaux du fichier
// relus à cette vitesse, plus l'enveloppe du lecteur ; fenêtres W1 à W4 sur [T_d + 2 q ; T_a], T_a = T_d + A_g.
export interface AgonyWindows {
  readonly heard: readonly number[] // niveaux par quantum à partir de T_d
  readonly l: readonly [number, number, number, number] // L_1 à L_4
  readonly w: number // largeur d'une fenêtre, en quanta
}

export const agonyWindows = (once: ArrayLike<number>, rate: number, sampleRate: number): AgonyWindows => {
  const taQ = Math.round((AGONIE_S * sampleRate) / QUANTUM)
  const at = (u: number): number => {
    const i = Math.floor(u)
    const a = (once[i] as number | undefined) ?? Number.NEGATIVE_INFINITY
    const b = (once[i + 1] as number | undefined) ?? Number.NEGATIVE_INFINITY
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Math.min(a, b)
    return a + (b - a) * (u - i)
  }
  const heard = Array.from(
    { length: taQ + 8 },
    (_, q) => at((q + 0.5) * rate - 0.5) + agonyEnvelopeDb(((q + 0.5) * QUANTUM) / sampleRate),
  )
  const w = (taQ - 2) / 4
  const mean = (a: number, b: number): number => {
    let e = 0
    let n = 0
    for (let q = Math.round(a); q < Math.round(b); q++) {
      const l = heard[q] as number
      e += Number.isFinite(l) ? 10 ** (l / 10) : 0
      n++
    }
    return db(e / Math.max(1, n))
  }
  const l = [0, 1, 2, 3].map((k) => mean(2 + k * w, 2 + (k + 1) * w)) as [number, number, number, number]
  return { heard, l, w }
}

export const agonyForm = (
  once: ArrayLike<number>,
  rate: number,
  sampleRate: number,
): { pass: boolean; detail: string } => {
  const { heard, l, w } = agonyWindows(once, rate, sampleRate)
  const [l1, l2, l3, l4] = l
  const first10 = heard.findIndex((l) => l >= l1 - 10)
  let last30 = -1
  let lastNz = -1
  heard.forEach((l, q) => {
    if (l >= l1 - 30) last30 = q
    if (l > SILENCE_DB) lastNz = q
  })
  const b = first10 >= 0 && first10 < 6
  const c = l2 <= l1 + 1 && l3 <= l2 + 1 && l4 <= l3 + 1 && l4 <= l1 - 10
  const d = last30 >= 2 + 2 * w && (lastNz < 0 || (heard[lastNz] as number) <= l1 - 30)
  return {
    pass: b && c && d,
    detail: `×${rate} L1 ${l1.toFixed(1)} ΔL2 ${(l2 - l1).toFixed(1)} ΔL3 ${(l3 - l2).toFixed(1)} L4−L1 ${(l4 - l1).toFixed(1)} 1er à L1−10 : q${first10} dernier à L1−30 : q${last30}${b ? '' : ' (b)'}${c ? '' : ' (c)'}${d ? '' : ' (d)'}`,
  }
}

// Fenêtre de 20 ms (8 quanta) la plus forte, en énergie moyenne.
export const agonyPeakWindowDb = (heard: ArrayLike<number>): number => {
  let best = Number.NEGATIVE_INFINITY
  for (let q = 0; q + 8 <= heard.length; q++) {
    let e = 0
    for (let k = q; k < q + 8; k++) e += 10 ** ((heard[k] as number) / 10)
    best = Math.max(best, db(e / 8))
  }
  return best
}

export interface FileAnalysis {
  readonly rows: readonly O11Row[]
  readonly mf: number // M_f : médiane des quanta non silencieux du fichier tel que joué
}

// Gain de lecture appliqué au tampon décodé : ce que le lecteur joue réellement.
const withGain = (channels: readonly Float32Array[], gainDb: number): readonly Float32Array[] => {
  if (gainDb === 0) return channels
  const g = 10 ** (gainDb / 20)
  return channels.map((ch) => ch.map((v) => v * g))
}

// Le fichier tel que joué (B5 « Définitions communes ») : depuis l'offset de départ, avec les points de boucle et le
// gain de lecture du manifeste. Un fichier en boucle est lu trois tours, comme pour (c) : le contenu du tampon
// au-delà de loopEnd n'est jamais joué et n'entre pas dans M_f (drapeau 8 de B5 : l'ancien calcul allait de l'offset
// à la fin du tampon). (b) reste mesuré sans boucle, comme le contrat le demande.
export const analyseFile = (
  id: string,
  shape: FileShape,
  decoded: readonly Float32Array[],
  sampleRate: number,
): FileAnalysis => {
  const rows: O11Row[] = []
  const add = (r: Omit<O11Row, 'file' | 'role'>) => rows.push({ file: id, role: shape.role, ...r })
  const channels = withGain(decoded, shape.gainDb ?? 0)
  const once = playedOnce(channels, shape.startOffset)
  const played = shape.loop ? playedLooped(channels, shape, 3) : once
  const mf = nonSilentMedian(played)
  const role = shape.role

  if (
    role === 'halètement' ||
    role === 'cri' ||
    role === 'inspiration' ||
    role === 'cri-etouffe' ||
    AGONY_ROLES.has(role)
  ) {
    const q = played.findIndex((l) => l >= mf - 20)
    const ms = q < 0 ? Number.POSITIVE_INFINITY : q * MS_PER_Q
    add({
      criterion: 'a',
      measure: 'attaque depuis le départ',
      value: ms,
      unit: 'ms',
      threshold: '≤ 17',
      pass: ms <= 17,
    })
  }
  if (role === 'halètement' || role === 'inspiration') {
    const mfOnce = nonSilentMedian(once)
    let first = -1
    let last = -1
    once.forEach((l, i) => {
      if (l >= mfOnce - 30) {
        if (first < 0) first = i
        last = i
      }
    })
    const ms = first < 0 ? 0 : (last - first + 1) * MS_PER_Q
    const min = role === 'halètement' ? 500 : 1500
    add({
      criterion: 'b',
      measure: 'couverture sans boucle',
      value: ms,
      unit: 'ms',
      threshold: `≥ ${min}`,
      pass: ms >= min,
    })
  }
  if (role === 'cri' || role === 'inspiration' || role === 'nappe' || shape.loop) {
    const levels = played
    const { gaps, worstRunQ } = continuityGaps(levels)
    add({
      criterion: 'c',
      measure: `passages ≥ 20 ms à M₂₀₀ − 30 dB (${shape.loop ? '3 tours' : 'une lecture'}, plus long trou ${worstRunQ} q)`,
      value: gaps,
      unit: 'passages',
      threshold: '= 0',
      pass: gaps === 0,
    })
    const fx = fixedGaps(levels, mf)
    add({
      criterion: 'c-fixe',
      measure: `hors contrat : passages ≥ 20 ms à M_f − 30 dB (plus long trou ${fx.worstRunQ} q)`,
      value: fx.gaps,
      unit: 'passages',
      threshold: '= 0',
      pass: fx.gaps === 0,
    })
  }
  if (shape.loop) {
    let worst = 0
    let worstRatio = 0
    for (const ch of channels) {
      const steps = new Float32Array(ch.length - 1)
      for (let i = 1; i < ch.length; i++) steps[i - 1] = Math.abs((ch[i] as number) - (ch[i - 1] as number))
      steps.sort()
      const p999 = percentile(steps, 0.999)
      const jump = Math.abs((ch[shape.loopStart] as number) - (ch[shape.loopEnd - 1] as number))
      worst = Math.max(worst, jump)
      worstRatio = Math.max(worstRatio, jump / (p999 || 1e-12))
    }
    add({
      criterion: 'd-saut',
      measure: `saut à la jonction / 99,9e centile des pas (saut max ${worst.toExponential(2)})`,
      value: worstRatio,
      unit: 'ratio',
      threshold: '≤ 1',
      pass: worstRatio <= 1,
    })
    const w = Math.round(0.05 * sampleRate)
    const before = rmsDb(channels, shape.loopEnd - w, shape.loopEnd)
    const after = rmsDb(channels, shape.loopStart, shape.loopStart + w)
    const diff = Math.abs(before - after)
    add({
      criterion: 'd-niveau',
      measure: 'écart de niveau 50 ms avant / après la jonction',
      value: diff,
      unit: 'dB',
      threshold: '≤ 3',
      pass: diff <= 3,
    })
  }
  if (AGONY_ROLES.has(role)) {
    // B5.O11 (b) et (c) amendés (A15, P10), sur la partie jouée pendant l'agonie à la vitesse la plus haute.
    const need = AGONIE_S * (1 + AGONY_RATE_SPREAD)
    const needQ = Math.ceil((need * sampleRate) / QUANTUM)
    let cont = 0
    while (cont < once.length && (once[cont] as number) >= mf - 30) cont++
    add({
      criterion: 'b',
      measure: `contenu audible continu (M_f − 30 dB ou plus) depuis le départ, en temps de fichier`,
      value: cont * MS_PER_Q,
      unit: 'ms',
      threshold: `≥ ${(need * 1000).toFixed(1)}`,
      pass: cont >= needQ,
    })
    const part = once.subarray(0, Math.min(once.length, needQ))
    const { gaps, worstRunQ } = continuityGapsFrom(part, 1)
    add({
      criterion: 'c',
      measure: `passages ≥ 20 ms à M₂₀₀ − 30 dB sur les ${(need * 1000).toFixed(0)} ms jouées (historique disponible dès le 2e quantum, plus long trou ${worstRunQ} q)`,
      value: gaps,
      unit: 'passages',
      threshold: '= 0',
      pass: gaps === 0,
    })
    const forms = [1 - AGONY_RATE_SPREAD, 1, 1 + AGONY_RATE_SPREAD].map((r) => agonyForm(once, r, sampleRate))
    const bad = forms.filter((f) => !f.pass)
    add({
      criterion: 'agonie-forme',
      measure: `hors contrat : forme du râle tel qu'entendu (B5.O3 b, c, d) aux vitesses 0,94, 1 et 1,06 : ${forms.map((f) => f.detail).join(' ; ')}`,
      value: bad.length,
      unit: 'vitesses en échec',
      threshold: '= 0',
      pass: bad.length === 0,
    })
    const heard = agonyHeard(once, sampleRate)
    const pk = agonyPeakWindowDb(heard)
    add({
      criterion: 'agonie-niveau',
      measure: 'hors contrat : fenêtre de 20 ms la plus forte du râle tel qu’entendu',
      value: pk,
      unit: 'dBFS',
      threshold: 'rapporté',
      pass: true,
    })
  }
  if (SPATIAL_ROLES.has(role)) {
    if (channels.length === 1) {
      add({
        criterion: 'e',
        measure: 'canaux',
        value: 1,
        unit: 'canal',
        threshold: '1 canal ou r ≥ 0,99',
        pass: true,
      })
    } else {
      const r = pearson(channels[0] as Float32Array, channels[1] as Float32Array)
      add({
        criterion: 'e',
        measure: 'corrélation gauche-droite',
        value: r,
        unit: 'r',
        threshold: '≥ 0,99',
        pass: r >= 0.99,
      })
    }
  }
  if (IMPACT_ROLES.has(role)) {
    let pq = 0
    once.forEach((l, i) => {
      if (l > (once[pq] as number)) pq = i
    })
    const peakStart = shape.startOffset + pq * QUANTUM
    const from = peakStart + Math.round(0.1 * sampleRate)
    const to = peakStart + Math.round(0.4 * sampleRate)
    // Au-delà de la fin du fichier, le lecteur ne joue rien : zéros (rmsDb divise par la fenêtre entière).
    const tail = rmsDb(channels, from, to)
    const below = (once[pq] as number) - tail
    add({
      criterion: 'f',
      measure: 'queue [pic + 100 ms ; pic + 400 ms] sous le quantum de pic',
      value: below,
      unit: 'dB',
      threshold: '≥ 30',
      pass: below >= 30,
    })
  }
  return { rows, mf }
}

// B5.O11 (h) (amendement A15) : écart du M_f de chaque râle à la médiane des M_f des râles de même traitement.
export const raleLevelRows = (mfs: readonly { id: string; role: Role; mf: number }[]): O11Row[] =>
  (['rale', 'rale-etouffe'] as const).flatMap((role) => {
    const group = mfs.filter((x) => x.role === role)
    const m = median(group.map((x) => x.mf))
    return group.map(({ id, mf }) => {
      const d = mf - m
      return {
        file: id,
        role,
        criterion: 'h' as const,
        measure: `M_f ${mf.toFixed(2)} dBFS − médiane des ${role} ${m.toFixed(2)} dBFS`,
        value: d,
        unit: 'dB',
        threshold: '±3',
        pass: Math.abs(d) <= 3,
      }
    })
  })

// B5.O11 (g) : écart du M_f de chaque cri à la médiane des M_f des cris.
export const cryLevelRows = (mfs: readonly { id: string; mf: number }[]): O11Row[] => {
  const m = median(mfs.map((x) => x.mf))
  return mfs.map(({ id, mf }) => {
    const d = mf - m
    return {
      file: id,
      role: 'cri' as const,
      criterion: 'g' as const,
      measure: `M_f ${mf.toFixed(2)} dBFS − médiane des cris ${m.toFixed(2)} dBFS`,
      value: d,
      unit: 'dB',
      threshold: '±3',
      pass: Math.abs(d) <= 3,
    }
  })
}

export const shapeOf = (e: ManifestEntry): FileShape => ({
  role: e.role,
  loop: e.loop,
  loopStart: e.loopStart,
  loopEnd: e.loopEnd,
  startOffset: e.startOffset,
  gainDb: e.gainDb ?? 0,
})
