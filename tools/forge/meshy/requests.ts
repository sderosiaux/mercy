// Construction des requêtes Meshy, sans réseau. Chaque requête a un descripteur (le corps où chaque image est
// remplacée par son empreinte) : c'est lui qui fait l'empreinte de l'étape, pas les mégaoctets de base64.
// Paramètres d'après docs.meshy.ai (llms-full.txt relu le 2026-10-11) : Multi-Image to 3D, Image to 3D,
// Rigging, Animation (action_ids : 1 à 10 actions uniques, un fichier avec un clip par action), Text to Motion.
import { ESTIMATE } from '../estimate'
import type { AssetSheet, ClipSource } from '../schema'

export const MESHY_BASE = 'https://api.meshy.ai/openapi/v1'
export type MeshyEndpoint = 'multi-image-to-3d' | 'image-to-3d' | 'rigging' | 'animations' | 'text-to-motion'

export const MAX_ACTIONS_PER_REQUEST = 10 // Animation API : action_ids accepte 1 à 10 ids

export interface ImageInput {
  readonly mime: 'image/png' | 'image/jpeg'
  readonly data: Uint8Array
  readonly sha256: string
}

export interface MeshyRequest {
  readonly endpoint: MeshyEndpoint
  readonly body: Readonly<Record<string, unknown>>
  readonly descriptor: Readonly<Record<string, unknown>> // corps sans données d'image : base de l'empreinte
  readonly estimatedCredits: number
}

const dataUri = (img: ImageInput): string =>
  `data:${img.mime};base64,${Buffer.from(img.data).toString('base64')}`
const imageRef = (img: ImageInput): string => `sha256:${img.sha256}`

// Estimation affichée avant de payer (grille de estimate.ts) ; le coût enregistré est `consumed_credits`.
// meshy-6-lite ne texture qu'en 2k (doc Multi-Image to 3D) : null = combinaison refusée.
const modelCredits = (ai: AssetSheet['modele']['aiModel'], res: '2k' | '4k' | '8k'): number | null =>
  ai === 'meshy-6-lite'
    ? res === '2k'
      ? ESTIMATE.model.lite
      : null
    : res === '8k'
      ? ESTIMATE.model.tex8k
      : ESTIMATE.model.standard
export const CREDITS = { rig: ESTIMATE.rig, perAction: ESTIMATE.perAction, motion: ESTIMATE.motion } as const

export const buildModelRequest = (sheet: AssetSheet, views: readonly ImageInput[]): MeshyRequest => {
  const triangles = sheet.budgets.triangles
  if (triangles === null) {
    throw new Error(`${sheet.id} : budget de triangles absent (requête F1) : target_polycount inconnu`)
  }
  const credits = modelCredits(sheet.modele.aiModel, sheet.modele.textureResolution)
  if (credits === null) {
    throw new Error(
      `${sheet.id} : ${sheet.modele.aiModel} ne produit pas de texture ${sheet.modele.textureResolution}`,
    )
  }
  if (views.length === 0) throw new Error(`${sheet.id} : aucune vue pour le modèle`)
  const common: Record<string, unknown> = {
    ai_model: sheet.modele.aiModel,
    should_texture: true,
    enable_pbr: sheet.modele.pbr,
    texture_resolution: sheet.modele.textureResolution,
    should_remesh: true,
    topology: 'triangle',
    target_polycount: triangles,
    pose_mode: 'a-pose',
    target_formats: ['glb'],
    ...(sheet.modele.texturePrompt ? { texture_prompt: sheet.modele.texturePrompt } : {}),
  }
  if (sheet.modele.source === 'multi-image') {
    if (views.length > 4) throw new Error(`${sheet.id} : Multi-Image to 3D accepte 1 à 4 images`)
    return {
      endpoint: 'multi-image-to-3d',
      body: { ...common, image_urls: views.map(dataUri) },
      descriptor: { ...common, image_urls: views.map(imageRef) },
      estimatedCredits: credits,
    }
  }
  const front = views[0] as ImageInput
  return {
    endpoint: 'image-to-3d',
    body: { ...common, image_url: dataUri(front) },
    descriptor: { ...common, image_url: imageRef(front) },
    estimatedCredits: credits,
  }
}

export const buildRigRequest = (sheet: AssetSheet, modelTaskId: string): MeshyRequest => {
  if (sheet.hauteurM === null) {
    throw new Error(`${sheet.id} : hauteur absente (requête F1) : le rigging la demande pour l'échelle`)
  }
  const body = { input_task_id: modelTaskId, height_meters: sheet.hauteurM }
  return { endpoint: 'rigging', body, descriptor: body, estimatedCredits: CREDITS.rig }
}

export const chunkActions = (ids: readonly number[]): number[][] => {
  if (new Set(ids).size !== ids.length) throw new Error('action_ids en double : Meshy les refuse')
  const out: number[][] = []
  for (let i = 0; i < ids.length; i += MAX_ACTIONS_PER_REQUEST)
    out.push(ids.slice(i, i + MAX_ACTIONS_PER_REQUEST))
  return out
}

export const buildLibraryAnimRequest = (rigTaskId: string, actionIds: readonly number[]): MeshyRequest => {
  if (actionIds.length < 1 || actionIds.length > MAX_ACTIONS_PER_REQUEST) {
    throw new Error(`action_ids : 1 à ${MAX_ACTIONS_PER_REQUEST} ids par requête, reçu ${actionIds.length}`)
  }
  const body = { rig_task_id: rigTaskId, action_ids: [...actionIds] }
  return {
    endpoint: 'animations',
    body,
    descriptor: body,
    estimatedCredits: CREDITS.perAction * actionIds.length,
  }
}

export const buildMotionRequest = (source: Extract<ClipSource, { kind: 'mouvement' }>): MeshyRequest => {
  const body = { prompt: source.prompt, duration: source.dureeS, mode: source.mode }
  return { endpoint: 'text-to-motion', body, descriptor: body, estimatedCredits: CREDITS.motion[source.mode] }
}

// Coût d'application d'un mouvement : la grille ne le nomme pas à part ; on l'estime comme une action (3).
export const buildMotionApplyRequest = (rigTaskId: string, motionTaskId: string): MeshyRequest => {
  const body = { rig_task_id: rigTaskId, motion_task_id: motionTaskId }
  return { endpoint: 'animations', body, descriptor: body, estimatedCredits: CREDITS.perAction }
}
