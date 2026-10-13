// Fidélité de la passe d'identification (B2 §12 I1, arbitrage E4) : elle montre ce que montre l'image. Masquer une
// entité ne change l'attribution d'aucun pixel hors de son masque ; on rapporte la part de son masque dont la couleur
// ne change pas (un pixel noir peut rester noir sur un fond noir). Les télégraphes au sol, que la passe devait suivre
// par-dessus les morts, ont disparu (décision du concepteur, 2026-10-12).
import { decodeId, type PixelImage, PLAYER_ID, type Renderer } from '../render/index'

const idAt = (img: PixelImage, p: number): { id: number; role: number } =>
  decodeId(img.data[p * 4] ?? 0, img.data[p * 4 + 1] ?? 0, img.data[p * 4 + 2] ?? 0)

// Même couleur (image) ou même attribution (passe d'identification : id et rôle sur R, G, B).
const same = (a: PixelImage, b: PixelImage, p: number): boolean =>
  a.data[p * 4] === b.data[p * 4] &&
  a.data[p * 4 + 1] === b.data[p * 4 + 1] &&
  a.data[p * 4 + 2] === b.data[p * 4 + 2]
const sameColor = same

export interface EntityFidelity {
  readonly id: number
  readonly maskPx: number
  readonly unchangedInMask: number // pixels du masque dont la couleur ne change pas quand on masque l'entité
  readonly relabelledOutside: number // pixels hors du masque qui gagnent ou perdent une entité : doit être 0
}

export interface I1Fidelity {
  readonly entities: readonly EntityFidelity[]
}

export const entityFidelity = (r: Renderer, minPx = 150): EntityFidelity[] => {
  const c1 = r.debug.readPixels()
  const i1 = r.debug.idPass()
  const n = c1.width * c1.height
  const masks = new Map<number, number[]>()
  for (let p = 0; p < n; p++) {
    const { id } = idAt(i1, p)
    if (id === 0) continue
    const m = masks.get(id) ?? []
    m.push(p)
    masks.set(id, m)
  }
  const out: EntityFidelity[] = []
  for (const [id, mask] of [...masks].sort((a, b) => a[0] - b[0])) {
    if (mask.length < minPx || id === PLAYER_ID) continue
    r.debug.hide([id])
    const c0 = r.debug.readPixels()
    const i0 = r.debug.idPass()
    r.debug.hide([])
    const inMask = new Set(mask)
    let unchangedInMask = 0
    let relabelledOutside = 0
    for (let p = 0; p < n; p++) {
      if (inMask.has(p)) {
        if (sameColor(c1, c0, p)) unchangedInMask++
        continue
      }
      // Hors du masque, seul le décor peut changer de rôle ; un pixel qui gagne ou perd une entité est une faute.
      if (idAt(i1, p).id !== idAt(i0, p).id) relabelledOutside++
    }
    out.push({ id, maskPx: mask.length, unchangedInMask, relabelledOutside })
  }
  r.debug.readPixels()
  return out
}

export const i1Fidelity = (r: Renderer, minPx = 150): I1Fidelity => ({
  entities: entityFidelity(r, minPx),
})
