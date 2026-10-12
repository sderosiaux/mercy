// Fraîcheur de l'amont. Avant de payer une étape Meshy, chaque étape amont enregistrée doit encore avoir
// l'empreinte que donnerait la fiche actuelle. Sinon (fiche modifiée après coup : budgets, hauteur, prompt de
// planche…), payer en aval, c'est payer sur un modèle ou un squelette périmés, qui seront repayés dès que l'amont
// sera refait (incident du 2026-10-12 : animations payées sur les squelettes périmés du Porteur, du Confesseur et
// du Chirurgien, puis repayées par --stage all). Le calcul est local : les descripteurs Meshy ne portent que les
// empreintes des images, les enregistrements suffisent.
import { stepFingerprint } from '../cache'
import { fingerprint } from '../fingerprint'
import { SHEET_VIEWS } from '../gptimage'
import { buildModelRequest, buildRigRequest, type ImageInput, type MeshyRequest } from '../meshy/requests'
import { plancheInputs, vuesInputs } from './concept'
import type { ForgeContext, StageName, StaleStep } from './context'

const UPSTREAM: Readonly<Record<'model' | 'rig' | 'anim', readonly StageName[]>> = {
  model: ['concept'],
  rig: ['concept', 'model'],
  anim: ['concept', 'model', 'rig'],
}

const tryFingerprint = (build: () => MeshyRequest): string | Error => {
  try {
    return stepFingerprint(build())
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e))
  }
}

// Étapes amont de `stage` dont l'enregistrement ne correspond plus à la fiche ; une étape en aval d'une étape
// périmée l'est aussi (elle a été faite sur l'ancienne).
export const staleUpstream = (ctx: ForgeContext, stage: 'model' | 'rig' | 'anim'): StaleStep[] => {
  const { store } = ctx
  const wanted = new Set(UPSTREAM[stage])
  const out: StaleStep[] = []
  let behind = false
  const mark = (s: StaleStep): void => {
    behind = true
    if (wanted.has(s.etape)) out.push(s)
  }

  const concept = store.read('concept')
  if (concept && concept.fingerprint !== fingerprint(plancheInputs(ctx))) {
    mark({ etape: 'concept', cle: 'concept', creditsEstimes: null, raison: 'la planche demandée a changé' })
  }
  const vues = store.read('vues')
  if (
    vues &&
    concept &&
    !behind &&
    vues.fingerprint !== fingerprint(vuesInputs(concept.outputs.planche?.sha256))
  ) {
    mark({ etape: 'concept', cle: 'vues', creditsEstimes: 0, raison: 'la découpe des vues a changé' })
  }

  const modele = store.read('modele')
  if (modele) {
    const views: ImageInput[] = (
      ctx.sheet.modele.source === 'multi-image' ? SHEET_VIEWS : SHEET_VIEWS.slice(0, 1)
    ).map((n) => ({ mime: 'image/png', data: new Uint8Array(0), sha256: vues?.outputs[n]?.sha256 ?? '' }))
    const fp = behind ? null : tryFingerprint(() => buildModelRequest(ctx.sheet, views))
    if (behind || fp instanceof Error || fp !== modele.fingerprint) {
      mark({
        etape: 'model',
        cle: 'modele',
        creditsEstimes: modele.estimatedCredits ?? null,
        raison: behind
          ? 'fait sur une planche périmée'
          : fp instanceof Error
            ? fp.message
            : 'la fiche ne donne plus la même requête (budgets, modèle, texture)',
      })
    }
  }

  const rig = store.read('rig')
  if (rig) {
    const fp =
      behind || !modele?.taskId
        ? null
        : tryFingerprint(() => buildRigRequest(ctx.sheet, modele.taskId as string))
    if (behind || fp instanceof Error || fp !== rig.fingerprint) {
      mark({
        etape: 'rig',
        cle: 'rig',
        creditsEstimes: rig.estimatedCredits ?? null,
        raison: behind
          ? 'fait sur un modèle périmé'
          : fp instanceof Error
            ? fp.message
            : 'la hauteur a changé',
      })
    }
  }
  return out
}

const cost = (steps: readonly StaleStep[]): string => {
  const known = steps.filter((s) => s.creditsEstimes !== null)
  const total = known.reduce((t, s) => t + (s.creditsEstimes ?? 0), 0)
  return `${total} crédits estimés${known.length < steps.length ? ' (plus la planche GPT Image)' : ''}`
}

export const staleMessage = (stage: StageName, steps: readonly StaleStep[]): string => {
  const first = steps[0]?.etape ?? stage
  const order: StageName[] = ['concept', 'model', 'rig', 'anim']
  const redo = order.slice(order.indexOf(first), order.indexOf(stage) + 1)
  return (
    `amont périmé : ${steps.map((s) => `${s.cle} (${s.raison})`).join(', ')}. ` +
    `Relancer --stage ${redo.join(', puis --stage ')} (refaire l'amont : ${cost(steps)}). Rien n'a été payé.`
  )
}
