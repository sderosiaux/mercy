// Étapes Meshy : modèle (Multi-Image ou Image to 3D), rigging, animations (bibliothèque par paquets de 10, Text to
// Motion puis application). Chaque tâche passe par runMeshyStep : jamais payée deux fois pour la même empreinte.

import { cacheFile, type OutputRef, runMeshyStep, type StageRecord, stepFingerprint } from '../cache'
import { SHEET_VIEWS } from '../gptimage'
import type { LibraryEntry, MeshyTask } from '../meshy/client'
import {
  buildLibraryAnimRequest,
  buildModelRequest,
  buildMotionApplyRequest,
  buildMotionRequest,
  buildRigRequest,
  chunkActions,
  type ImageInput,
  type MeshyRequest,
} from '../meshy/requests'
import { producedClips } from '../schema'
import { blocked, type ForgeContext, line, type StageName, type StageReport, type StepLine } from './context'

export const NO_KEY = 'MESHY_API_KEY absente : appel Meshy non fait (non vérifié)'

const needRecord = (ctx: ForgeContext, key: string, stage: string): StageRecord | string => {
  const rec = ctx.store.read(key)
  if (rec?.status !== 'reussi' || !ctx.store.intact(rec))
    return `étape ${stage} à faire d'abord (${key} absent)`
  return rec
}

const planOrRun = async (
  ctx: ForgeContext,
  key: string,
  request: MeshyRequest,
  collect: (task: MeshyTask) => Promise<Readonly<Record<string, OutputRef>>>,
): Promise<{ step: StepLine; record: StageRecord | null }> => {
  if (ctx.dryRun) {
    const rec = ctx.store.read(key)
    const cached =
      !ctx.force &&
      rec?.fingerprint === stepFingerprint(request) &&
      (rec.status === 'reussi' || rec.status === 'cree')
    return {
      step: {
        cle: key,
        issue: cached ? 'cache' : 'prevu',
        creditsEstimes: cached ? 0 : request.estimatedCredits,
      },
      record: null,
    }
  }
  if (!ctx.meshy) throw new Error(NO_KEY)
  const r = await runMeshyStep({
    store: ctx.store,
    client: ctx.meshy,
    key,
    request,
    force: ctx.force,
    now: ctx.now,
    collect,
  })
  return { step: line(r.record, r.outcome), record: r.record }
}

const downloadTo = async (ctx: ForgeContext, url: unknown, name: string): Promise<OutputRef> => {
  if (typeof url !== 'string' || url === '') throw new Error(`${name} : URL absente de la tâche réussie`)
  if (!ctx.meshy) throw new Error(NO_KEY)
  const bytes = await ctx.meshy.download(url)
  return ctx.store.put(cacheFile(ctx.sheet.id, name), bytes)
}

const guard = (ctx: ForgeContext, etape: StageName): StageReport | null =>
  !ctx.meshy && !ctx.dryRun ? blocked(etape, NO_KEY) : null

export const runModel = async (ctx: ForgeContext): Promise<StageReport> => {
  const g = guard(ctx, 'model')
  if (g) return g
  const vues = needRecord(ctx, 'vues', 'concept')
  if (typeof vues === 'string') return blocked('model', vues)
  const names = ctx.sheet.modele.source === 'multi-image' ? SHEET_VIEWS : SHEET_VIEWS.slice(0, 1)
  const views: ImageInput[] = names.map((n) => {
    const o = vues.outputs[n]
    if (!o) throw new Error(`vue ${n} absente`)
    return { mime: 'image/png', data: ctx.store.get(o.file), sha256: o.sha256 }
  })
  let request: MeshyRequest
  try {
    request = buildModelRequest(ctx.sheet, views)
  } catch (e) {
    return blocked('model', (e as Error).message)
  }
  const r = await planOrRun(ctx, 'modele', request, async (task) => ({
    glb: await downloadTo(ctx, task.model_urls?.glb, 'modele.glb'),
  }))
  return { etape: 'model', statut: ctx.dryRun ? 'prevu' : 'fait', pas: [r.step] }
}

export const runRig = async (ctx: ForgeContext): Promise<StageReport> => {
  const g = guard(ctx, 'rig')
  if (g) return g
  const model = needRecord(ctx, 'modele', 'model')
  if (typeof model === 'string') return blocked('rig', model)
  let request: MeshyRequest
  try {
    request = buildRigRequest(ctx.sheet, model.taskId as string)
  } catch (e) {
    return blocked('rig', (e as Error).message)
  }
  const r = await planOrRun(ctx, 'rig', request, async (task) => ({
    glb: await downloadTo(ctx, task.result?.rigged_character_glb_url, 'rig.glb'),
  }))
  return { etape: 'rig', statut: ctx.dryRun ? 'prevu' : 'fait', pas: [r.step] }
}

export interface AnimRecords {
  readonly bibliotheque: readonly StageRecord[]
  readonly applications: ReadonlyMap<string, StageRecord> // état → application du mouvement
}

export const libraryKeys = (ctx: ForgeContext): { key: string; ids: number[] }[] => {
  const ids = producedClips(ctx.sheet).flatMap((c) =>
    c.source.kind === 'bibliotheque' ? [c.source.actionId] : [],
  )
  return chunkActions(ids).map((chunk, i) => ({ key: `anim-bib-${i}`, ids: chunk }))
}

// Avant de payer : chaque action_id porte-t-il encore le nom que la fiche attend ? (lecture gratuite)
const checkLibrary = async (ctx: ForgeContext): Promise<string | null> => {
  if (!ctx.meshy) return null
  const wanted = producedClips(ctx.sheet).flatMap((c) => (c.source.kind === 'bibliotheque' ? [c.source] : []))
  if (wanted.length === 0) return null
  const live = await ctx.meshy.library(wanted.map((w) => w.actionId))
  const wrong = libraryMismatches(wanted, live)
  const byId = new Map(live.map((l) => [l.action_id, l]))
  return wrong.length === 0
    ? null
    : `bibliothèque Meshy : ${wrong.map((w) => `${w.actionId} = ${byId.get(w.actionId)?.key ?? byId.get(w.actionId)?.name ?? 'absent'} (fiche : ${w.nom})`).join(', ')}`
}

// Une action de la fiche correspond si son nom est la clé (« Hit_Reaction ») ou le libellé (« Hit Reaction ») de l'id.
export const libraryMismatches = <W extends { readonly actionId: number; readonly nom: string }>(
  wanted: readonly W[],
  live: readonly LibraryEntry[],
): W[] => {
  const byId = new Map(live.map((l) => [l.action_id, l]))
  return wanted.filter((w) => {
    const e = byId.get(w.actionId)
    return !e || (e.key !== w.nom && e.name !== w.nom)
  })
}

export const runAnimTasks = async (
  ctx: ForgeContext,
): Promise<{ report: StageReport; records: AnimRecords | null }> => {
  const g = guard(ctx, 'anim')
  if (g) return { report: g, records: null }
  const rig = needRecord(ctx, 'rig', 'rig')
  if (typeof rig === 'string') return { report: blocked('anim', rig), records: null }
  const rigTask = rig.taskId as string
  const libraryToPay = libraryKeys(ctx).some(({ key, ids }) => {
    const rec = ctx.store.read(key)
    const fp = stepFingerprint(buildLibraryAnimRequest(rigTask, ids))
    return (
      ctx.force || !rec || rec.fingerprint !== fp || rec.status === 'echoue' || rec.status === 'incertain'
    )
  })
  if (!ctx.dryRun && libraryToPay) {
    const mismatch = await checkLibrary(ctx)
    if (mismatch) return { report: blocked('anim', mismatch), records: null }
  }
  const steps: StepLine[] = []
  const bibliotheque: StageRecord[] = []
  for (const { key, ids } of libraryKeys(ctx)) {
    const r = await planOrRun(ctx, key, buildLibraryAnimRequest(rigTask, ids), async (task) => ({
      glb: await downloadTo(ctx, task.result?.animation_glb_url, `${key}.glb`),
    }))
    steps.push(r.step)
    if (r.record) bibliotheque.push(r.record)
  }
  const applications = new Map<string, StageRecord>()
  for (const clip of producedClips(ctx.sheet)) {
    if (clip.source.kind !== 'mouvement') continue
    const motion = await planOrRun(
      ctx,
      `mouvement-${clip.etat}`,
      buildMotionRequest(clip.source),
      async () => ({}),
    )
    steps.push(motion.step)
    if (ctx.dryRun) {
      steps.push({ cle: `applique-${clip.etat}`, issue: 'prevu', creditsEstimes: 3 })
      continue
    }
    const motionTask = motion.record?.taskId as string
    const apply = await planOrRun(
      ctx,
      `applique-${clip.etat}`,
      buildMotionApplyRequest(rigTask, motionTask),
      async (task) => ({
        glb: await downloadTo(ctx, task.result?.animation_glb_url, `applique-${clip.etat}.glb`),
      }),
    )
    steps.push(apply.step)
    if (apply.record) applications.set(clip.etat, apply.record)
  }
  return {
    report: { etape: 'anim', statut: ctx.dryRun ? 'prevu' : 'fait', pas: steps },
    records: ctx.dryRun ? null : { bibliotheque, applications },
  }
}
