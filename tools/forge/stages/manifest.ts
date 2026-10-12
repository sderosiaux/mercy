// Manifeste des modèles (public/models/manifest.json) : ce que l'intégration lira. Par personnage : fichier et
// empreinte du GLB, recette de lecture de chaque clip (début, vitesse, repère d'impact), recette commune
// (interruption, mort), verdict de validation, crédits Meshy consommés.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ClipRecipe } from '../../../src/render/anim/playback'
import { spentCredits } from '../cache'
import type { ValidationReport } from '../validate/checks'
import { type ForgeContext, MANIFEST_FILE, validationFile } from './context'

export interface ManifestEntry {
  readonly id: string
  readonly nom: string
  readonly famille: string
  readonly glb: string | null
  readonly sha256: string | null
  readonly hauteurM: number | null
  readonly clips: readonly ClipRecipe[]
  readonly recetteGlobale: ValidationReport['recetteGlobale'] | null
  readonly validation: {
    readonly verdict: string
    readonly rapport: string
    readonly glbSha256: string
  } | null
  readonly credits: { readonly meshy: number; readonly parCle: Readonly<Record<string, number>> }
  readonly majLe: string
}

export interface Manifest {
  readonly version: 1
  readonly assets: Readonly<Record<string, ManifestEntry>>
}

export const readManifest = (root: string): Manifest => {
  const p = join(root, MANIFEST_FILE)
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Manifest) : { version: 1, assets: {} }
}

export const updateManifest = (
  ctx: ForgeContext,
  patch: {
    readonly glb?: string | null
    readonly validation?: { report: ValidationReport; glbSha256: string }
  },
): void => {
  const m = readManifest(ctx.root)
  const prev = m.assets[ctx.sheet.id]
  const sha = patch.glb !== undefined ? patch.glb : (prev?.sha256 ?? null)
  const v = patch.validation
  // Une validation ne vaut que pour le GLB qu'elle a mesuré.
  const keepValidation = v === undefined && prev?.validation && prev.validation.glbSha256 === sha
  const entry: ManifestEntry = {
    id: ctx.sheet.id,
    nom: ctx.sheet.nom,
    famille: ctx.sheet.famille,
    glb: sha ? `models/${ctx.sheet.id}.glb` : null,
    sha256: sha,
    hauteurM: ctx.sheet.hauteurM,
    clips: v ? v.report.clips.map((c) => c.recette) : keepValidation ? (prev?.clips ?? []) : [],
    recetteGlobale: v ? v.report.recetteGlobale : keepValidation ? (prev?.recetteGlobale ?? null) : null,
    validation: v
      ? { verdict: v.report.bilan.verdict, rapport: validationFile(ctx.sheet), glbSha256: v.glbSha256 }
      : keepValidation
        ? (prev?.validation ?? null)
        : null,
    credits: (() => {
      const s = spentCredits(ctx.store)
      return { meshy: s.total, parCle: s.parCle }
    })(),
    majLe: ctx.now().toISOString(),
  }
  const next: Manifest = { version: 1, assets: { ...m.assets, [ctx.sheet.id]: entry } }
  const p = join(ctx.root, MANIFEST_FILE)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`)
}
