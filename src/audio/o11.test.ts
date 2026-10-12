// B5.O11 et I9 : M_f se mesure sur le fichier tel que joué (offset de départ, points de boucle, gain de lecture du
// manifeste), jamais sur le contenu du tampon au-delà de loopEnd que le lecteur ne joue pas (drapeau 8 de B5).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { QUANTUM } from './constants'
import type { Manifest } from './manifest'
import { analyseFile, cryLevelRows, type FileShape, shapeOf } from './o11'
import { fromPcm16 } from './wav'

const SR = 48_000
const MS_PER_Q = (QUANTUM / SR) * 1000

// Signal de test : suite de paliers (niveau RMS en dBFS, durée en quanta), sinusoïde de 1 kHz à ce niveau.
const steps = (...parts: readonly (readonly [db: number, quanta: number])[]): Float32Array => {
  const n = parts.reduce((s, [, q]) => s + q * QUANTUM, 0)
  const x = new Float32Array(n)
  let i = 0
  for (const [db, q] of parts) {
    const a = Math.SQRT2 * 10 ** (db / 20)
    for (let k = 0; k < q * QUANTUM; k++, i++) x[i] = a * Math.sin((2 * Math.PI * 1000 * i) / SR)
  }
  return x
}

const row = (rows: readonly { criterion: string; value: number; pass: boolean }[], c: string) =>
  rows.find((r) => r.criterion === c)

describe('I9 : M_f du fichier tel que joué (drapeau 8 de B5)', () => {
  // Tête douce (20 quanta à −50 dBFS), boucle tenue à −20 dBFS, puis une longue queue à −45 dBFS jamais jouée.
  const x = steps([-50, 20], [-20, 200], [-45, 1000])
  const shape: FileShape = {
    role: 'inspiration',
    loop: true,
    loopStart: 20 * QUANTUM,
    loopEnd: 220 * QUANTUM,
    startOffset: 0,
  }

  it("l'attaque se mesure contre le M_f joué : la tête douce de 53 ms échoue (≤ 17 ms)", () => {
    const a = analyseFile('test', shape, [x], SR)
    expect(a.mf).toBeCloseTo(-20, 0) // RMS par quantum d'une sinusoïde de 1 kHz : ±0,1 dB
    const att = row(a.rows, 'a')
    expect(att?.value).toBeCloseTo(20 * MS_PER_Q, 6)
    expect(att?.pass).toBe(false)
  })

  it("le contenu au-delà de loopEnd ne compte pas : avancer l'offset au début du contenu fort fait passer l'attaque", () => {
    const a = analyseFile('test', { ...shape, startOffset: 20 * QUANTUM }, [x], SR)
    expect(row(a.rows, 'a')?.value).toBe(0)
    expect(row(a.rows, 'a')?.pass).toBe(true)
  })

  it('le gain de lecture du manifeste fait partie du fichier tel que joué (O11 g)', () => {
    const loud = analyseFile('fort', { ...shape, role: 'cri', gainDb: 0 }, [x], SR)
    const fixed = analyseFile('corrige', { ...shape, role: 'cri', gainDb: -4 }, [x], SR)
    expect(fixed.mf).toBeCloseTo(loud.mf - 4, 6)
    const g = cryLevelRows([
      { id: 'a', mf: -24 },
      { id: 'b', mf: -24 },
      { id: 'fort', mf: loud.mf },
    ])
    expect(g.find((r) => r.file === 'fort')?.pass).toBe(false)
  })
})

// Décodage PCM 16 bits des WAV de la banque (même format que le navigateur décode sans codec).
const readWav = (file: string): Float32Array => {
  const b = fs.readFileSync(file)
  let p = 12
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4)
    const size = b.readUInt32LE(p + 4)
    if (id === 'data')
      return Float32Array.from({ length: size / 2 }, (_, i) => fromPcm16(b.readInt16LE(p + 8 + 2 * i)))
    p += 8 + size + (size % 2)
  }
  throw new Error(`${file} : pas de bloc data`)
}

describe('banque livrée, fichiers tels que joués (B5.O11 a et g)', () => {
  const dir = path.resolve(__dirname, '../../public/audio')
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest
  const analyses = manifest.files
    .filter((e) => ['halètement', 'cri', 'inspiration', 'cri-etouffe'].includes(e.role))
    .map((e) => ({ e, a: analyseFile(e.id, shapeOf(e), [readWav(path.join(dir, e.file))], e.sampleRate) }))

  it('attaque ≤ 17 ms pour chaque voix (inspire-04 : 53,3 ms avant correction)', () => {
    const bad = analyses.flatMap(({ e, a }) => {
      const r = row(a.rows, 'a')
      return r && !r.pass ? [`${e.id} ${r.value.toFixed(1)} ms`] : []
    })
    expect(bad).toEqual([])
  })

  it('niveau des cris à ±3 dB de la médiane (cri-07 : +3,33 dB avant correction)', () => {
    const g = cryLevelRows(
      analyses.filter(({ e }) => e.role === 'cri').map(({ e, a }) => ({ id: e.id, mf: a.mf })),
    )
    expect(g.filter((r) => !r.pass).map((r) => `${r.file} ${r.value.toFixed(2)} dB`)).toEqual([])
  })
})
