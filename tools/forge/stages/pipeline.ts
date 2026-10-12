// Enchaînement des étapes et résumé. Une étape bloquée (clé absente, entrée manquante, valeur demandée en
// requête, amont périmé) arrête la chaîne : les suivantes ne sont pas tentées.
import { spentCredits } from '../cache'
import { estimateAsset } from '../estimate'
import { MAX_ACTIONS_PER_REQUEST } from '../meshy/requests'
import { producedClips } from '../schema'
import { runAssemble } from './assemble'
import { runConcept } from './concept'
import {
  assembledFile,
  blocked,
  type ForgeContext,
  STAGES,
  StageBlocked,
  type StageName,
  type StageReport,
} from './context'
import { runAnimTasks, runModel, runRig } from './meshy'
import { runPost } from './post'
import { runValidate } from './validate'

export interface ForgeSummary {
  readonly id: string
  readonly etapes: readonly StageReport[]
  readonly creditsMeshy: { readonly total: number; readonly parCle: Readonly<Record<string, number>> }
  readonly estimation?: ReturnType<typeof estimateAsset> & { readonly requetesBibliotheque: number }
}

const runStage = async (ctx: ForgeContext, stage: StageName): Promise<StageReport> => {
  switch (stage) {
    case 'concept':
      return runConcept(ctx)
    case 'model':
      return runModel(ctx)
    case 'rig':
      return runRig(ctx)
    case 'anim': {
      const { report, records } = await runAnimTasks(ctx)
      if (!records) return report
      const rig = ctx.store.read('rig')
      if (!rig) return { ...report, statut: 'bloque', detail: 'rig absent' }
      const step = await runAssemble(ctx, { rig, ...records })
      return { ...report, pas: [...report.pas, step], sorties: [assembledFile(ctx.sheet)] }
    }
    case 'post':
      return runPost(ctx)
    case 'validate':
      return runValidate(ctx)
  }
}

export const runForge = async (ctx: ForgeContext, stages: readonly StageName[]): Promise<ForgeSummary> => {
  const etapes: StageReport[] = []
  for (const stage of STAGES.filter((s) => stages.includes(s))) {
    let report: StageReport
    try {
      report = await runStage(ctx, stage)
    } catch (e) {
      report =
        e instanceof StageBlocked
          ? blocked(stage, e.message)
          : { etape: stage, statut: 'erreur', pas: [], detail: e instanceof Error ? e.message : String(e) }
    }
    etapes.push(report)
    if (report.statut === 'bloque' || report.statut === 'erreur') break
  }
  const lib = producedClips(ctx.sheet).filter((c) => c.source.kind === 'bibliotheque').length
  return {
    id: ctx.sheet.id,
    etapes,
    creditsMeshy: spentCredits(ctx.store),
    ...(ctx.dryRun
      ? {
          estimation: {
            ...estimateAsset(ctx.sheet),
            requetesBibliotheque: Math.ceil(lib / MAX_ACTIONS_PER_REQUEST),
          },
        }
      : {}),
  }
}
