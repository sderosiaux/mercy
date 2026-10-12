// Requête D-fix2 : une régénération ou un retraitement par scripts/generate-audio.ts ne défait pas les corrections
// prises au manifeste. Le gain de lecture (gainDb) garde le niveau auquel le fichier est joué ; l'offset de départ
// se choisit sur le fichier tel que joué (B5.O11 a). Entrées : les fichiers réels de la banque.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Manifest, ManifestEntry } from '../src/audio/manifest'
import { analyseFile, nonSilentMedian, playedLooped, playedOnce, shapeOf } from '../src/audio/o11'
import { fromPcm16 } from '../src/audio/wav'
import { ASSETS, type Asset, buildEntry, type Decoded } from './generate-audio'

const dir = path.resolve(__dirname, '../public/audio')
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest
const entryOf = (id: string): ManifestEntry => manifest.files.find((f) => f.id === id) as ManifestEntry
const assetOf = (id: string): Asset => ASSETS.find((a) => a.id === id) as Asset
const wavOf = (id: string): Float32Array => {
  const buf = fs.readFileSync(path.join(dir, entryOf(id).file))
  const x = new Float32Array((buf.length - 44) / 2)
  for (let i = 0; i < x.length; i++) x[i] = fromPcm16(buf.readInt16LE(44 + 2 * i))
  return x
}
const decodedOf = (x: Float32Array): Decoded => ({
  mono: x,
  srcChannels: 1,
  note: 'test',
  rawFormat: 'pcm_48000',
  rawSha256: 'test',
})
const samplesOf = (wav: Uint8Array): Float32Array => {
  const v = new DataView(wav.buffer, wav.byteOffset)
  const x = new Float32Array((wav.length - 44) / 2)
  for (let i = 0; i < x.length; i++) x[i] = fromPcm16(v.getInt16(44 + 2 * i, true))
  return x
}
// Entrée du manifeste avec un gain de lecture fixé par le test (indépendant des réglages courants du manifeste).
const withGain = (id: string, gainDb: number | undefined): ManifestEntry => {
  const { gainDb: _g, ...e } = entryOf(id)
  return gainDb === undefined ? e : { ...e, gainDb }
}
// Niveau joué : M_f du fichier tel que joué (offset, boucle sur trois tours), gain de lecture compris.
const playedMf = (
  e: Pick<ManifestEntry, 'loop' | 'loopStart' | 'loopEnd' | 'startOffset' | 'gainDb'>,
  x: Float32Array,
) => {
  const lv = e.loop ? playedLooped([x], e, 3) : playedOnce([x], e.startOffset)
  return nonSilentMedian(lv) + (e.gainDb ?? 0)
}

describe('generate-audio : les corrections du manifeste survivent à une régénération (requête D-fix2)', () => {
  it('cri-07 : le niveau joué corrigé par gainDb (−3,33 dB, D-fix2 : −24 dBFS) reste celui du fichier régénéré', () => {
    const prev = { entry: withGain('cri-07', -3.33), samples: wavOf('cri-07') }
    expect(playedMf(prev.entry, prev.samples)).toBeCloseTo(-24, 1)
    const { entry, wav } = buildEntry(assetOf('cri-07'), decodedOf(wavOf('cri-07')), 2, [], 'test', prev)
    expect(playedMf(entry, samplesOf(wav))).toBeCloseTo(-24, 1)
  })

  it('un gain de lecture décidé au manifeste (+6 dB sur cri-01, joué à −18 dBFS) est gardé', () => {
    const prev = { entry: withGain('cri-01', 6), samples: wavOf('cri-01') }
    expect(playedMf(prev.entry, prev.samples)).toBeCloseTo(-18, 1)
    const { entry, wav } = buildEntry(assetOf('cri-01'), decodedOf(wavOf('cri-01')), 1, [], 'test', prev)
    expect(playedMf(entry, samplesOf(wav))).toBeCloseTo(-18, 1)
  })

  it("inspire-04 : l'offset de départ se choisit sur le fichier tel que joué (attaque ≤ 17 ms)", () => {
    const prev = { entry: withGain('inspire-04', undefined), samples: wavOf('inspire-04') }
    const { entry, wav } = buildEntry(
      assetOf('inspire-04'),
      decodedOf(wavOf('inspire-04')),
      1,
      [],
      'test',
      prev,
    )
    const a = analyseFile(entry.id, shapeOf(entry), [samplesOf(wav)], 48_000).rows.find(
      (r) => r.criterion === 'a',
    )
    expect(a?.value).toBeLessThanOrEqual(17)
  })

  it("sans gain au manifeste, l'entrée régénérée n'en porte pas", () => {
    const prev = { entry: withGain('cri-02', undefined), samples: wavOf('cri-02') }
    const { entry } = buildEntry(assetOf('cri-02'), decodedOf(wavOf('cri-02')), 1, [], 'test', prev)
    expect(entry.gainDb).toBeUndefined()
  })
})
