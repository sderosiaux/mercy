// Coût estimé d'un passage complet depuis zéro, d'après la fiche seule et la grille Meshy du 2026-10-11 (CLI à
// blanc et galerie). Le coût vrai est toujours consumed_credits, consigné par tâche.
import { type AssetSheet, producedClips } from './schema'

export const ESTIMATE = {
  model: { standard: 30, lite: 15, tex8k: 35 },
  rig: 5,
  perAction: 3,
  motion: { prime: 10, swift: 3 },
} as const

export const estimateAsset = (
  sheet: AssetSheet,
): { model: number; rig: number; anim: number; total: number } => {
  const model =
    sheet.modele.aiModel === 'meshy-6-lite'
      ? ESTIMATE.model.lite
      : sheet.modele.textureResolution === '8k'
        ? ESTIMATE.model.tex8k
        : ESTIMATE.model.standard
  const clips = producedClips(sheet)
  const lib = clips.filter((c) => c.source.kind === 'bibliotheque').length
  const motions = clips.flatMap((c) => (c.source.kind === 'mouvement' ? [c.source.mode] : []))
  const anim =
    lib * ESTIMATE.perAction + motions.reduce((s, m) => s + ESTIMATE.motion[m] + ESTIMATE.perAction, 0)
  return { model, rig: ESTIMATE.rig, anim, total: model + ESTIMATE.rig + anim }
}
