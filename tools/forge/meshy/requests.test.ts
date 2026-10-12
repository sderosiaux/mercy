import { describe, expect, it } from 'vitest'
import { bancSheetRaw } from '../banc'
import { parseAsset } from '../schema'
import {
  buildLibraryAnimRequest,
  buildModelRequest,
  buildMotionApplyRequest,
  buildMotionRequest,
  buildRigRequest,
  chunkActions,
  type ImageInput,
} from './requests'

const sheet = parseAsset(bancSheetRaw())
const img = (byte: number, sha: string): ImageInput => ({
  mime: 'image/png',
  data: Uint8Array.from([byte, 1, 2]),
  sha256: sha,
})
const views = [img(1, 'aaa'), img(2, 'bbb'), img(3, 'ccc')]

describe('requêtes Meshy', () => {
  it('Multi-Image to 3D : trois vues en data URI, face d’abord, PBR, A-pose, remaillage au budget, GLB seul', () => {
    const r = buildModelRequest(sheet, views)
    expect(r.endpoint).toBe('multi-image-to-3d')
    expect(r.body).toEqual({
      ai_model: 'meshy-7.1',
      should_texture: true,
      enable_pbr: true,
      texture_resolution: '2k',
      should_remesh: true,
      topology: 'triangle',
      target_polycount: 1000,
      pose_mode: 'a-pose',
      target_formats: ['glb'],
      image_urls: [
        `data:image/png;base64,${Buffer.from([1, 1, 2]).toString('base64')}`,
        `data:image/png;base64,${Buffer.from([2, 1, 2]).toString('base64')}`,
        `data:image/png;base64,${Buffer.from([3, 1, 2]).toString('base64')}`,
      ],
    })
    expect(r.descriptor.image_urls).toEqual(['sha256:aaa', 'sha256:bbb', 'sha256:ccc'])
    expect(r.estimatedCredits).toBe(30)
  })

  it('Image to 3D : une seule image, la face', () => {
    const one = parseAsset({
      ...bancSheetRaw(),
      modele: { source: 'image', aiModel: 'meshy-7.1', textureResolution: '2k', pbr: true },
    })
    const r = buildModelRequest(one, views)
    expect(r.endpoint).toBe('image-to-3d')
    expect(r.body.image_url).toBe(`data:image/png;base64,${Buffer.from([1, 1, 2]).toString('base64')}`)
    expect(r.body.image_urls).toBeUndefined()
  })

  it('refuse de construire un modèle sans budget de triangles (valeur demandée, jamais inventée)', () => {
    const noBudget = parseAsset({ ...bancSheetRaw(), budgets: { triangles: null, texturePx: null } })
    expect(() => buildModelRequest(noBudget, views)).toThrow(/budget de triangles absent/)
  })

  it('Rigging : la tâche du modèle et la hauteur de la fiche ; refuse sans hauteur', () => {
    expect(buildRigRequest(sheet, 'task-m').body).toEqual({ input_task_id: 'task-m', height_meters: 1.84 })
    const noHeight = parseAsset({ ...bancSheetRaw(), hauteurM: null })
    expect(() => buildRigRequest(noHeight, 'task-m')).toThrow(/hauteur absente/)
  })

  it('Animation : action_ids par paquets de 10 au plus, sans doublon, 3 crédits par action', () => {
    const ids = Array.from({ length: 23 }, (_, i) => i)
    expect(chunkActions(ids).map((c) => c.length)).toEqual([10, 10, 3])
    expect(() => chunkActions([1, 2, 1])).toThrow(/en double/)
    const r = buildLibraryAnimRequest('rig-1', [0, 178, 669])
    expect(r).toMatchObject({
      endpoint: 'animations',
      body: { rig_task_id: 'rig-1', action_ids: [0, 178, 669] },
    })
    expect(r.estimatedCredits).toBe(9)
    expect(() => buildLibraryAnimRequest('rig-1', ids.slice(0, 11))).toThrow(/1 à 10/)
  })

  it('Text to Motion puis application sur le squelette', () => {
    const m = buildMotionRequest({ kind: 'mouvement', prompt: 'bite', dureeS: 2.5, mode: 'prime' })
    expect(m).toMatchObject({
      endpoint: 'text-to-motion',
      body: { prompt: 'bite', duration: 2.5, mode: 'prime' },
    })
    expect(m.estimatedCredits).toBe(10)
    expect(
      buildMotionRequest({ kind: 'mouvement', prompt: 'x', dureeS: 2, mode: 'swift' }).estimatedCredits,
    ).toBe(3)
    expect(buildMotionApplyRequest('rig-1', 'mot-1').body).toEqual({
      rig_task_id: 'rig-1',
      motion_task_id: 'mot-1',
    })
  })
})
