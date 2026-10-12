// Manifeste de la Forge : le vrai fichier se lit ; une entrée sans GLB ou mal formée garde ses segments.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseManifest, playable } from './manifest'

describe('manifeste', () => {
  it('lit public/models/manifest.json : chaque personnage jouable a ses clips', () => {
    const raw = JSON.parse(readFileSync('public/models/manifest.json', 'utf8'))
    const { manifest, rejected } = parseManifest(raw)
    expect(rejected).toEqual([])
    for (const id of ['souriant', 'recousu', 'porteur', 'confesseur', 'chirurgien']) {
      const e = manifest.assets[id]
      expect(playable(e)).toBe(true)
      expect(e?.clips.some((c) => c.name === 'chute')).toBe(true)
    }
  })
  it('écarte une entrée mal formée et signale un personnage sans GLB', () => {
    const { manifest, rejected } = parseManifest({
      version: 1,
      assets: {
        bourreau: { id: 'bourreau', glb: null, hauteurM: 1.9, clips: [] },
        casse: { id: 'casse', glb: 'models/x.glb', hauteurM: 2, clips: [{ name: 'a', boucle: 'oui' }] },
      },
    })
    expect(rejected).toEqual(['casse'])
    expect(playable(manifest.assets.bourreau)).toBe(false)
    expect(playable(manifest.assets.inconnu)).toBe(false)
  })
})
