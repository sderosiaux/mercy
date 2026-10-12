// B5 I9 : analyse de la banque dans le navigateur. Chaque fichier du manifeste est décodé par decodeAudioData à
// 48 000 Hz, puis mesuré avec l'offset et les points de boucle du manifeste (src/audio/o11.ts).
import { fetchFileBytes, fetchManifest } from './bank'
import { BENCH_RATE, N_MAX, NAPPE_OFF_S, nappeOffShape, SILENCE_DB } from './constants'
import { analyseFile, cryLevelRows, type O11Row, playedLooped, shapeOf } from './o11'

export interface BankAnalysis {
  readonly bankSha256: string
  readonly sampleRate: number
  readonly files: number
  readonly rows: readonly O11Row[] // critères du contrat (a) à (g)
  readonly extra: readonly O11Row[] // hors contrat : 'c-fixe', empreinte, fréquence, longueur
  readonly verdict: {
    readonly checks: number
    readonly pass: number
    readonly fail: number
    readonly failed: readonly O11Row[]
  }
}

const hex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export const analyseBank = async (baseUrl = '/audio/'): Promise<BankAnalysis> => {
  const m = await fetchManifest(baseUrl)
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: BENCH_RATE })
  const rows: O11Row[] = []
  const extra: O11Row[] = []
  const cries: { id: string; mf: number }[] = []
  for (const e of m.files) {
    const bytes = await fetchFileBytes(baseUrl, e.file)
    const digest = hex(await crypto.subtle.digest('SHA-256', bytes))
    extra.push({
      file: e.id,
      role: e.role,
      criterion: 'empreinte',
      measure: `empreinte sha256 du fichier servi = manifeste (${digest.slice(0, 12)}…)`,
      value: digest === e.sha256 ? 1 : 0,
      unit: 'bool',
      threshold: '= 1',
      pass: digest === e.sha256,
    })
    const buf = await ctx.decodeAudioData(bytes.slice(0))
    extra.push({
      file: e.id,
      role: e.role,
      criterion: 'decodage',
      measure: `tampon décodé : ${buf.sampleRate} Hz, ${buf.length} éch. (manifeste ${e.frames})`,
      value: buf.length,
      unit: 'éch.',
      threshold: `= ${e.frames} à ${BENCH_RATE} Hz`,
      pass: buf.sampleRate === BENCH_RATE && buf.length === e.frames,
    })
    const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
    const a = analyseFile(e.id, shapeOf(e), channels, buf.sampleRate)
    for (const r of a.rows) {
      if (r.criterion === 'c-fixe') extra.push(r)
      else rows.push(r)
    }
    if (e.role === 'cri') cries.push({ id: e.id, mf: a.mf })
    if (e.role === 'nappe') {
      // Hors contrat, mais conditionne B5.O7 (d) : à N = 1, le quantum le plus faible du fichier, atténué par la
      // courbe d'extinction à 1,9 s, doit rester au-dessus du silence (−80 dBFS).
      const lv = playedLooped(channels, shapeOf(e), 3)
      let min = Number.POSITIVE_INFINITY
      for (const l of lv) min = Math.min(min, l)
      const at19 = min + 20 * Math.log10(1 / N_MAX) + 20 * Math.log10(nappeOffShape(1.9 / NAPPE_OFF_S))
      extra.push({
        file: e.id,
        role: e.role,
        criterion: 'nappe-extinction',
        measure: `quantum le plus faible (${min.toFixed(1)} dBFS) à N = 1, à 1,9 s de l'extinction`,
        value: at19,
        unit: 'dBFS',
        threshold: `> ${SILENCE_DB}`,
        pass: at19 > SILENCE_DB,
      })
    }
  }
  rows.push(...cryLevelRows(cries))
  const failed = rows.filter((r) => !r.pass)
  return {
    bankSha256: m.bankSha256,
    sampleRate: BENCH_RATE,
    files: m.files.length,
    rows,
    extra,
    verdict: { checks: rows.length, pass: rows.length - failed.length, fail: failed.length, failed },
  }
}
