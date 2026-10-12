// Données de la galerie, lues telles que la Forge les laisse : fiches, planches de modèle, rapports de validation
// (art/forge/<id>/), manifeste et GLB (public/models/). Rien n'est calculé ici qui ne soit déjà sur disque.

import { type AssetSheet, parseAsset, SchemaError } from '../schema'
import type { Manifest, ManifestEntry } from '../stages/manifest'
import type { ValidationReport } from '../validate/checks'

const fiches = import.meta.glob<unknown>('/art/forge/*/asset.json', { eager: true, import: 'default' })
const planches = import.meta.glob<string>('/art/forge/*/planche-modele.png', {
  eager: true,
  query: '?url',
  import: 'default',
})
const rapports = import.meta.glob<ValidationReport & { glbSha256: string }>('/art/forge/*/validation.json', {
  eager: true,
  import: 'default',
})
const concepts = import.meta.glob<string>('/art/concepts/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const P0_ORDER = ['bourreau', 'souriant', 'recousu', 'porteur', 'confesseur', 'chirurgien']

export interface GalleryAsset {
  readonly id: string
  readonly sheet: AssetSheet | null
  readonly erreur: string | null
  readonly planche: string | null
  readonly reference: string | null
  readonly rapport: (ValidationReport & { glbSha256: string }) | null
  readonly manifeste: ManifestEntry | null
}

const idOf = (path: string): string => path.split('/')[3] ?? path

export const loadAssets = async (): Promise<GalleryAsset[]> => {
  let manifest: Manifest = { version: 1, assets: {} }
  try {
    const res = await fetch('/models/manifest.json', { cache: 'no-store' })
    if (res.ok) manifest = (await res.json()) as Manifest
  } catch {
    // pas encore de manifeste : aucun modèle produit
  }
  const out: GalleryAsset[] = Object.entries(fiches).map(([path, raw]) => {
    const id = idOf(path)
    let sheet: AssetSheet | null = null
    let erreur: string | null = null
    try {
      sheet = parseAsset(raw)
    } catch (e) {
      erreur = e instanceof SchemaError ? e.issues.join(' ; ') : String(e)
    }
    return {
      id,
      sheet,
      erreur,
      planche: planches[`/art/forge/${id}/planche-modele.png`] ?? null,
      reference: sheet ? (concepts[`/${sheet.reference.planche}`] ?? null) : null,
      rapport: rapports[`/art/forge/${id}/validation.json`] ?? null,
      manifeste: manifest.assets[id] ?? null,
    }
  })
  const rank = (id: string): number => {
    const i = P0_ORDER.indexOf(id)
    return i < 0 ? P0_ORDER.length : i
  }
  return out.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
}
