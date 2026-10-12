// Manifeste des modèles de la Forge (public/models/manifest.json) : ce que le rendu lit pour remplacer les créatures
// en segments. Un personnage n'est jouable que s'il a un GLB et des clips ; sinon il garde son rendu en segments (E1)
// et le rendu le signale une fois. Ajouter un personnage ne demande qu'une entrée ici (son `id` est la famille de la
// simulation, ou `bourreau` pour le joueur).
import type { ClipRecipe } from './playback'

export interface ManifestEntry {
  readonly id: string
  readonly nom: string
  readonly famille: string
  readonly glb: string | null
  readonly hauteurM: number | null
  readonly clips: readonly ClipRecipe[]
  readonly recetteGlobale: { readonly interruptionFadeS: number; readonly mort: string } | null
  readonly validation: { readonly verdict: string } | null
}

export interface Manifest {
  readonly version: number
  readonly assets: Readonly<Record<string, ManifestEntry>>
}

const isRecipe = (x: unknown): x is ClipRecipe => {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  return (
    typeof r.name === 'string' &&
    typeof r.boucle === 'boolean' &&
    typeof r.startS === 'number' &&
    typeof r.rate === 'number' &&
    Number.isFinite(r.rate) &&
    (r.impactS === null || typeof r.impactS === 'number')
  )
}

// Lecture défensive : une entrée mal formée est écartée (le personnage garde ses segments), jamais devinée.
export const parseManifest = (raw: unknown): { manifest: Manifest; rejected: readonly string[] } => {
  const rejected: string[] = []
  const assets: Record<string, ManifestEntry> = {}
  const root = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const src = (typeof root.assets === 'object' && root.assets !== null ? root.assets : {}) as Record<
    string,
    unknown
  >
  for (const [key, value] of Object.entries(src)) {
    const e = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
    const clips = Array.isArray(e.clips) ? e.clips : []
    const ok =
      typeof e.id === 'string' &&
      (e.glb === null || typeof e.glb === 'string') &&
      (e.hauteurM === null || typeof e.hauteurM === 'number') &&
      clips.every(isRecipe)
    if (!ok) {
      rejected.push(key)
      continue
    }
    const rg = e.recetteGlobale as ManifestEntry['recetteGlobale'] | undefined
    const v = e.validation as { verdict?: unknown } | null | undefined
    assets[key] = {
      id: e.id as string,
      nom: typeof e.nom === 'string' ? e.nom : key,
      famille: typeof e.famille === 'string' ? e.famille : key,
      glb: e.glb as string | null,
      hauteurM: e.hauteurM as number | null,
      clips: clips as ClipRecipe[],
      recetteGlobale: rg ?? null,
      validation: v && typeof v.verdict === 'string' ? { verdict: v.verdict } : null,
    }
  }
  return {
    manifest: { version: typeof root.version === 'number' ? root.version : 0, assets },
    rejected,
  }
}

// Un personnage jouable : un GLB, une hauteur et au moins un clip.
export const playable = (
  e: ManifestEntry | undefined,
): e is ManifestEntry & { glb: string; hauteurM: number } =>
  e !== undefined && e.glb !== null && e.hauteurM !== null && e.clips.length > 0
