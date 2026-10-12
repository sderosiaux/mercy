import { describe, expect, it } from 'vitest'
import { bancSheetRaw } from '../banc'
import {
  buildImageCommand,
  GENERATE_IMAGE_SCRIPT,
  imageDescriptor,
  SHEET_TEMPLATE,
  sheetPrompt,
} from '../gptimage'
import { parseAsset } from '../schema'
import { decodePng, encodePng, type Raster } from './png'
import { findPanels, splitViews } from './split'
import { syntheticSheet } from './synthetic'

describe('PNG', () => {
  it('encode puis décode à l’identique (RVB et RVBA)', () => {
    const rgb = syntheticSheet(40, 20, [[5, 10]])
    expect(decodePng(encodePng(rgb))).toEqual(rgb)
    const rgba: Raster = {
      width: 3,
      height: 2,
      channels: 4,
      data: Uint8Array.from({ length: 24 }, (_, i) => (i * 37) % 256),
    }
    expect(decodePng(encodePng(rgba))).toEqual(rgba)
  })
})

describe('découpe de la planche en vues', () => {
  it('trouve les trois vues séparées par le fond, bras détachés compris, dans l’ordre face, profil, dos', () => {
    const panels = findPanels(syntheticSheet())
    expect(panels).toHaveLength(3)
    expect(panels.map((p) => p.x)).toEqual([...panels.map((p) => p.x)].sort((a, b) => a - b))
    const [face] = panels
    expect(face && face.x <= 24 && face.x + face.width - 1 >= 76).toBe(true) // bras à 24 et 76 inclus
    expect(face && face.y <= 20 && face.y + face.height - 1 >= 140).toBe(true)
  })

  it('échoue si la planche n’a pas le nombre de vues attendu (planche à refaire, pas à deviner)', () => {
    expect(() =>
      splitViews(
        syntheticSheet(300, 160, [
          [30, 70],
          [100, 270],
        ]),
        3,
      ),
    ).toThrow(/2 vue\(s\)/)
    // Marge de 2 % de la largeur (6 px) autour de la silhouette (lignes 20 à 140) : 14 à 146.
    expect(splitViews(syntheticSheet(), 3).map((v) => v.height)).toEqual([133, 133, 133])
  })
})

describe('requête GPT Image', () => {
  const sheet = parseAsset(bancSheetRaw())
  it('appelle le seul script autorisé avec le gabarit de planche et les réglages de la fiche', () => {
    const cmd = buildImageCommand(sheet, '/tmp/out.png')
    expect(cmd.command).toBe('python3')
    expect(cmd.args).toEqual([
      GENERATE_IMAGE_SCRIPT,
      SHEET_TEMPLATE.replace('{description}', 'test figurine'),
      '/tmp/out.png',
      '--size',
      '1536x1024',
      '--model',
      'flare',
      '--quality',
      'low',
    ])
    expect(GENERATE_IMAGE_SCRIPT.endsWith('/.claude/scripts/generate_image.py')).toBe(true)
  })

  it('demande trois vues séparées, A-pose, fond uni, mains vides, sans texte', () => {
    const p = sheetPrompt(sheet)
    for (const s of [
      'front view',
      'side profile view',
      'back view',
      'A-pose',
      'uniform medium grey',
      'hands open and empty',
      'no text',
    ]) {
      expect(p).toContain(s)
    }
  })

  it('l’empreinte de la planche ne dépend pas du chemin de sortie', () => {
    expect(imageDescriptor(sheet)).not.toHaveProperty('out')
    expect(JSON.stringify(imageDescriptor(sheet))).not.toContain('/tmp')
  })
})
