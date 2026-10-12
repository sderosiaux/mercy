// Contexte commun aux étapes : la fiche, le cache, les services (injectables pour les tests) et le compte rendu
// d'étape qui finit dans le résumé JSON de la CLI.
import { join } from 'node:path'
import type { ForgeStore, StageRecord, StepOutcome } from '../cache'
import type { CommandRunner } from '../gptimage'
import type { MeshyClient } from '../meshy/client'
import type { AssetSheet } from '../schema'

export type StageName = 'concept' | 'model' | 'rig' | 'anim' | 'post' | 'validate'
export const STAGES: readonly StageName[] = ['concept', 'model', 'rig', 'anim', 'post', 'validate']

export interface ForgeContext {
  readonly root: string
  readonly sheet: AssetSheet
  readonly store: ForgeStore
  readonly force: boolean
  readonly dryRun: boolean
  readonly now: () => Date
  readonly meshy: MeshyClient | null // null : MESHY_API_KEY absente
  readonly runImage: CommandRunner
  readonly log: (msg: string) => void
}

export type StageStatus = 'fait' | 'bloque' | 'refuse' | 'prevu' | 'erreur'

export interface StepLine {
  readonly cle: string
  readonly issue: StepOutcome | 'prevu'
  readonly tache?: string
  readonly credits?: number | null
  readonly creditsEstimes?: number
}

// Étape amont enregistrée qui ne correspond plus à la fiche (freshness.ts).
export interface StaleStep {
  readonly etape: StageName
  readonly cle: string
  readonly creditsEstimes: number | null // null : service qui ne rapporte pas son coût (GPT Image)
  readonly raison: string
}

export interface StageReport {
  readonly etape: StageName
  readonly statut: StageStatus
  readonly pas: readonly StepLine[]
  readonly detail?: string
  readonly sorties?: readonly string[]
  readonly perimees?: readonly StaleStep[] // étapes amont qui ne correspondent plus à la fiche
}

// Une étape qui ne peut pas tourner sans danger (clé absente, amont périmé) : bloquée, pas en erreur ; la chaîne
// s'arrête proprement et rien n'est payé.
export class StageBlocked extends Error {}

export const line = (record: StageRecord, issue: StepOutcome): StepLine => ({
  cle: record.key,
  issue,
  ...(record.taskId ? { tache: record.taskId } : {}),
  ...(record.credits !== undefined ? { credits: record.credits } : {}),
  ...(record.estimatedCredits !== undefined ? { creditsEstimes: record.estimatedCredits } : {}),
})

export const blocked = (etape: StageName, detail: string): StageReport => ({
  etape,
  statut: 'bloque',
  pas: [],
  detail,
})

export const assetDir = (sheet: AssetSheet): string => join('art', 'forge', sheet.id)
export const plancheFile = (sheet: AssetSheet): string => join(assetDir(sheet), 'planche-modele.png')
export const validationFile = (sheet: AssetSheet): string => join(assetDir(sheet), 'validation.json')
export const modelFile = (sheet: AssetSheet): string => join('public', 'models', `${sheet.id}.glb`)
// Assemblage brut (clips tels que Meshy les rend, avant post-traitements) : gros binaire, dans le cache.
export const assembledFile = (sheet: AssetSheet): string =>
  join('art', 'forge', '.cache', sheet.id, 'files', 'assemblage.glb')
export const postReportFile = (sheet: AssetSheet): string => join(assetDir(sheet), 'post-traitements.json')
export const MANIFEST_FILE = join('public', 'models', 'manifest.json')
