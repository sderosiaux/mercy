// Étape validation : mesure le GLB final contre sa fiche, écrit art/forge/<id>/validation.json et la recette de
// lecture dans le manifeste. Locale, sans service ; refaite seulement si le GLB, la fiche ou le validateur change.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runLocalStep } from '../cache'
import { sha256 } from '../fingerprint'
import { parseGlb } from '../gltf/glb'
import { VALIDATOR_VERSION, type ValidationReport, validate } from '../validate/checks'
import { loadRig } from '../validate/rig'
import { blocked, type ForgeContext, line, modelFile, type StageReport, validationFile } from './context'
import { updateManifest } from './manifest'

export const runValidate = async (ctx: ForgeContext): Promise<StageReport> => {
  const { sheet, store } = ctx
  const file = modelFile(sheet)
  if (!existsSync(join(ctx.root, file))) {
    return blocked('validate', `aucun modèle : ${file} absent (étapes model, rig, anim)`)
  }
  const bytes = store.get(file)
  const glbSha = sha256(bytes)
  if (ctx.dryRun) return { etape: 'validate', statut: 'prevu', pas: [{ cle: 'validation', issue: 'prevu' }] }
  const r = await runLocalStep({
    store,
    key: 'validation',
    inputs: { glb: glbSha, fiche: sheet, validateur: VALIDATOR_VERSION },
    force: ctx.force,
    now: ctx.now,
    produce: async () => {
      const glb = parseGlb(bytes)
      const rig = await loadRig(glb, { hauteurM: sheet.hauteurM, stripTextures: true })
      const report = validate(sheet, glb, rig)
      const out = store.put(
        validationFile(sheet),
        `${JSON.stringify({ ...report, glbSha256: glbSha }, null, 2)}\n`,
      )
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
