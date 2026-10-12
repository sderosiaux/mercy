// Étape concept : planche de modèle par GPT Image (payante, une fois par empreinte), puis découpe en vues
// (locale). La découpe a sa propre empreinte : si elle échoue, la planche payée reste en cache.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cacheFile, runLocalStep } from '../cache'
import { fingerprint } from '../fingerprint'
import { buildImageCommand, imageDescriptor, SHEET_TEMPLATE, SHEET_VIEWS } from '../gptimage'
import { decodePng, encodePng } from '../image/png'
import { BG_TOLERANCE, splitViews } from '../image/split'
import { type ForgeContext, line, plancheFile, type StageReport, type StepLine } from './context'

export const SPLIT_VERSION = 1

const plancheInputs = (ctx: ForgeContext) => ({ ...imageDescriptor(ctx.sheet), gabarit: SHEET_TEMPLATE })

export const runConcept = async (ctx: ForgeContext): Promise<StageReport> => {
  const { sheet, store } = ctx
  const out = plancheFile(sheet)
  if (ctx.dryRun) {
    const rec = store.read('concept')
    const cached =
      rec?.fingerprint === fingerprint(plancheInputs(ctx)) && rec.status === 'reussi' && store.intact(rec)
    return {
      etape: 'concept',
      statut: 'prevu',
      pas: [{ cle: 'concept', issue: cached && !ctx.force ? 'cache' : 'prevu' }],
      detail: cached
        ? 'planche en cache'
        : `GPT Image ${sheet.planche.taille}, ${sheet.planche.modele}, ${sheet.planche.qualite}`,
    }
  }
  const planche = await runLocalStep({
    store,
    key: 'concept',
    inputs: plancheInputs(ctx),
    force: ctx.force,
    now: ctx.now,
    paid: true,
    produce: async () => {
      mkdirSync(dirname(join(store.root, out)), { recursive: true })
      const cmd = buildImageCommand(sheet, join(store.root, out))
      ctx.log(`GPT Image : planche de ${sheet.id}`)
      const res = await ctx.runImage(cmd)
      if (res.code !== 0) {
        throw new Error(
          `generate_image.py a échoué (${res.code}) : ${(res.stdout + res.stderr).trim().slice(-400)}`,
        )
      }
      const bytes = store.get(out)
      return { outputs: { planche: store.put(out, bytes) }, meta: { modele: sheet.planche.modele } }
    },
  })
  const steps: StepLine[] = [line(planche.record, planche.outcome)]
  const plancheSha = planche.record.outputs.planche?.sha256 as string
  const vues = await runLocalStep({
    store,
    key: 'vues',
    inputs: { planche: plancheSha, decoupe: SPLIT_VERSION, tolerance: BG_TOLERANCE, vues: SHEET_VIEWS },
    force: ctx.force,
    now: ctx.now,
    produce: async () => {
      const raster = decodePng(store.get(out))
      const views = splitViews(raster, SHEET_VIEWS.length)
      const outputs: Record<string, ReturnType<typeof store.put>> = {}
      views.forEach((v, i) => {
        const name = SHEET_VIEWS[i] as string
        outputs[name] = store.put(cacheFile(sheet.id, `vue-${name}.png`), encodePng(v))
      })
      return { outputs, meta: { tailles: views.map((v) => `${v.width}x${v.height}`) } }
    },
  })
  steps.push(line(vues.record, vues.outcome))
  return {
    etape: 'concept',
    statut: 'fait',
    pas: steps,
    sorties: [out, ...Object.values(vues.record.outputs).map((o) => o.file)],
    detail: `vues ${JSON.stringify(vues.record.meta?.tailles ?? [])}`,
  }
}
