// Fidélité de la passe d'identification (B2 §12 I1, arbitrage E4) : elle montre ce que montre l'image. Là où un
// télégraphe couvre un mort à l'écran, le pixel appartient au télégraphe, pas au corps.
// - Télégraphes : les pixels que leur retrait change dans l'image et ceux dont il change l'attribution doivent être
//   les mêmes. Le défaut visé : un pixel couvert par un télégraphe à l'écran et attribué au corps dessous.
// - Entités (télégraphes retirés) : masquer une entité ne change l'attribution d'aucun pixel hors de son masque ; on
//   rapporte la part de son masque dont la couleur ne change pas (un pixel noir peut rester noir sur un fond noir).
import { decodeId, type PixelImage, PLAYER_ID, type Renderer, ROLE } from '../render/index'

const idAt = (img: PixelImage, p: number): { id: number; role: number } =>
  decodeId(img.data[p * 4] ?? 0, img.data[p * 4 + 1] ?? 0, img.data[p * 4 + 2] ?? 0)

// Même couleur (image) ou même attribution (passe d'identification : id et rôle sur R, G, B).
const same = (a: PixelImage, b: PixelImage, p: number): boolean =>
  a.data[p * 4] === b.data[p * 4] &&
  a.data[p * 4 + 1] === b.data[p * 4 + 1] &&
  a.data[p * 4 + 2] === b.data[p * 4 + 2]
const sameColor = same
const sameId = same // id et rôle

export interface TelegraphFidelity {
  readonly shownPx: number // pixels que le retrait des télégraphes change dans l'image
  readonly labelledPx: number // pixels dont il change l'attribution
  readonly shownNotLabelled: number // vus sur l'image, attribués à autre chose
  readonly shownOnEntities: number // dont : attribués à une entité (le défaut de B2, drapeau 1)
  readonly shownOnEntityIds: Readonly<Record<number, number>>
  readonly labelledNotShown: number // attribués au télégraphe sans changement visible (noir sur noir)
}

export interface EntityFidelity {
  readonly id: number
  readonly maskPx: number
  readonly unchangedInMask: number // pixels du masque dont la couleur ne change pas quand on masque l'entité
  readonly relabelledOutside: number // pixels hors du masque qui gagnent ou perdent une entité : doit être 0
}

export interface I1Fidelity {
  readonly telegraphs: TelegraphFidelity
  readonly entities: readonly EntityFidelity[]
}

export const telegraphFidelity = (r: Renderer): TelegraphFidelity => {
  const c1 = r.debug.readPixels()
  const i1 = r.debug.idPass()
  r.debug.setTelegraphs(false)
  const c0 = r.debug.readPixels()
  const i0 = r.debug.idPass()
  r.debug.setTelegraphs(true)
  r.debug.readPixels()
  const n = c1.width * c1.height
  let shownPx = 0
  let labelledPx = 0
  let shownNotLabelled = 0
  let shownOnEntities = 0
  let labelledNotShown = 0
  const onIds: Record<number, number> = {}
  for (let p = 0; p < n; p++) {
    const shown = !sameColor(c1, c0, p)
    const labelled = !sameId(i1, i0, p)
    if (shown) shownPx++
    if (labelled) labelledPx++
    if (shown && !labelled) {
      shownNotLabelled++
      const { id, role } = idAt(i1, p)
      if (id !== 0 && role !== ROLE.sol && role !== ROLE.decalque) {
        shownOnEntities++
        onIds[id] = (onIds[id] ?? 0) + 1
      }
    }
    if (labelled && !shown) labelledNotShown++
  }
  return { shownPx, labelledPx, shownNotLabelled, shownOnEntities, shownOnEntityIds: onIds, labelledNotShown }
}

// Sans télégraphes : masquer un attaquant retire aussi son télégraphe, qui découvrirait les corps dessous (contrôlé
// à part, telegraphFidelity).
export const entityFidelity = (r: Renderer, minPx = 150): EntityFidelity[] => {
  r.debug.setTelegraphs(false)
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
      // Hors du masque, seul le décor peut changer de rôle (le télégraphe d'un attaquant masqué disparaît avec lui) ;
      // un pixel qui gagne ou perd une entité est une faute.
      if (idAt(i1, p).id !== idAt(i0, p).id) relabelledOutside++
    }
    out.push({ id, maskPx: mask.length, unchangedInMask, relabelledOutside })
  }
  r.debug.setTelegraphs(true)
  r.debug.readPixels()
  return out
}

export const i1Fidelity = (r: Renderer, minPx = 150): I1Fidelity => ({
  telegraphs: telegraphFidelity(r),
  entities: entityFidelity(r, minPx),
})
