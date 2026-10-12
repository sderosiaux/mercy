// Étape post : post-traitements locaux de l'assemblage brut (tools/forge/post), sans aucun service. Sorties : le
// modèle du jeu (public/models/<id>.glb) et le compte rendu des traitements (art/forge/<id>/post-traitements.json,
// repris dans le rapport de validation). Refaite seulement si l'assemblage, la fiche, les post-traitements ou le
// validateur (dont ils lisent les mesures et les seuils) changent.
import { type OutputRef, runLocalStep } from '../cache'
import { parseGlb, writeGlb } from '../gltf/glb'
import { POST_VERSION, type PostReport, postProcess } from '../post/run'
import { VALIDATOR_VERSION } from '../validate/checks'
import { blocked, type ForgeContext, line, modelFile, postReportFile, type StageReport } from './context'
import { updateManifest } from './manifest'

// Compte rendu écrit sur disque : celui des post-traitements et l'assemblage dont ils sont partis.
export type PostFile = PostReport & { readonly source: OutputRef }

export const runPost = async (ctx: ForgeContext): Promise<StageReport> => {
  const { sheet, store } = ctx
  const assembled = store.read('assemblage')
  const source = assembled?.outputs.glb
  if (assembled?.status !== 'reussi' || !source || !store.intact(assembled)) {
    return blocked('post', "assemblage absent ou modifié : étape anim à faire d'abord")
  }
  if (ctx.dryRun) return { etape: 'post', statut: 'prevu', pas: [{ cle: 'post', issue: 'prevu' }] }
  const r = await runLocalStep({
    store,
    key: 'post',
    inputs: { version: POST_VERSION, validateur: VALIDATOR_VERSION, assemblage: source.sha256, fiche: sheet },
    force: ctx.force,
    now: ctx.now,
    produce: async () => {
      const { glb, report } = await postProcess(sheet, parseGlb(store.get(source.file)))
      const full: PostFile = { ...report, source }
      return {
        outputs: {
          glb: store.put(modelFile(sheet), writeGlb(glb)),
          rapport: store.put(postReportFile(sheet), `${JSON.stringify(full, null, 2)}\n`),
        },
        meta: {
          avant: report.avant.echec,
          apres: report.apres.echec,
          regressions: report.regressions.length,
        },
      }
    },
  })
  updateManifest(ctx, { glb: r.record.outputs.glb?.sha256 ?? null })
  const report = JSON.parse(new TextDecoder().decode(store.get(postReportFile(sheet)))) as PostFile
  const treated = report.clips.filter((c) => c.traitements.length > 0).length
  return {
    etape: 'post',
    statut: report.regressions.length > 0 ? 'refuse' : 'fait',
    pas: [line(r.record, r.outcome)],
    detail:
      `${treated} clip(s) traité(s) ; échecs mesurés ${report.avant.echec} → ${report.apres.echec}` +
      (report.regressions.length > 0 ? ` ; RÉGRESSIONS : ${report.regressions.join(', ')}` : '') +
      (report.nonCorriges.length > 0
        ? ` ; non corrigé : ${report.nonCorriges.map((n) => `${n.controle} ${n.etat} (${n.raison})`).join(' ; ')}`
        : ''),
    sorties: [modelFile(sheet), postReportFile(sheet)],
  }
}
