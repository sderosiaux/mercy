// Étape validation : mesure le GLB final contre sa fiche, écrit art/forge/<id>/validation.json et la recette de
// lecture dans le manifeste. Locale, sans service ; refaite seulement si le GLB, la fiche, le validateur ou le
// compte rendu des post-traitements change. Le rapport reprend ce compte rendu (traitements, mesures avant et
// après) quand il porte sur ce GLB.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runLocalStep } from '../cache'
import { sha256 } from '../fingerprint'
import { parseGlb } from '../gltf/glb'
import { VALIDATOR_VERSION, type ValidationReport, validate } from '../validate/checks'
import { loadRig } from '../validate/rig'
import {
  blocked,
  type ForgeContext,
  line,
  modelFile,
  postReportFile,
  type StageReport,
  validationFile,
} from './context'
import { updateManifest } from './manifest'
import type { PostFile } from './post'

export type ValidationFile = ValidationReport & {
  readonly glbSha256: string
  readonly postTraitements: PostFile | null
}

// Compte rendu des post-traitements qui ont produit ce GLB, s'il existe.
const postFor = (ctx: ForgeContext, glbSha: string): { report: PostFile; sha: string } | null => {
  const rec = ctx.store.read('post')
  if (rec?.status !== 'reussi' || rec.outputs.glb?.sha256 !== glbSha || !ctx.store.intact(rec)) return null
  const file = postReportFile(ctx.sheet)
  if (!existsSync(join(ctx.root, file))) return null
  const bytes = ctx.store.get(file)
  return { report: JSON.parse(new TextDecoder().decode(bytes)) as PostFile, sha: sha256(bytes) }
}

export const runValidate = async (ctx: ForgeContext): Promise<StageReport> => {
  const { sheet, store } = ctx
  const file = modelFile(sheet)
  if (!existsSync(join(ctx.root, file))) {
    return blocked('validate', `aucun modèle : ${file} absent (étapes model, rig, anim, post)`)
  }
  const bytes = store.get(file)
  const glbSha = sha256(bytes)
  if (ctx.dryRun) return { etape: 'validate', statut: 'prevu', pas: [{ cle: 'validation', issue: 'prevu' }] }
  const post = postFor(ctx, glbSha)
  const r = await runLocalStep({
    store,
    key: 'validation',
    inputs: { glb: glbSha, fiche: sheet, validateur: VALIDATOR_VERSION, post: post?.sha ?? null },
    force: ctx.force,
    now: ctx.now,
    produce: async () => {
      const glb = parseGlb(bytes)
      const rig = await loadRig(glb, { hauteurM: sheet.hauteurM, stripTextures: true })
      const report = validate(sheet, glb, rig)
      const full: ValidationFile = { ...report, glbSha256: glbSha, postTraitements: post?.report ?? null }
      const out = store.put(validationFile(sheet), `${JSON.stringify(full, null, 2)}\n`)
      return { outputs: { rapport: out }, meta: { verdict: report.bilan.verdict } }
    },
  })
  const report = JSON.parse(new TextDecoder().decode(store.get(validationFile(sheet)))) as ValidationReport
  updateManifest(ctx, { glb: glbSha, validation: { report, glbSha256: glbSha } })
  const { verdict, ok, echec, nonMesurable } = report.bilan
  return {
    etape: 'validate',
    statut: verdict === 'valide' ? 'fait' : 'refuse',
    pas: [line(r.record, r.outcome)],
    detail: `${verdict} : ${ok} ok, ${echec} échec(s), ${nonMesurable} non mesurable(s)`,
    sorties: [validationFile(sheet)],
  }
}
