// Chargement de la banque : manifeste puis fichiers, décodés dans le contexte qui les jouera.
import type { Bank } from './graph'
import type { Manifest } from './manifest'

const bytesCache = new Map<string, Promise<ArrayBuffer>>()

const fetchBytes = (url: string): Promise<ArrayBuffer> => {
  let p = bytesCache.get(url)
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    bytesCache.set(url, p)
  }
  return p
}

export const fetchManifest = async (baseUrl = '/audio/'): Promise<Manifest> => {
  const r = await fetch(`${baseUrl}manifest.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`manifeste introuvable : HTTP ${r.status}`)
  return (await r.json()) as Manifest
}

export const fetchFileBytes = (baseUrl: string, file: string): Promise<ArrayBuffer> =>
  fetchBytes(`${baseUrl}${file}`)

// Banque décodée une fois par contexte et par adresse (drapeau 9 de B5 : la mesure en direct ne redécode plus la
// banque à chaque passage ; le jeu et la mesure en direct partagent le même contexte, donc la même banque).
const decodedBanks = new WeakMap<BaseAudioContext, Map<string, Promise<Bank>>>()
export const bankFor = (ctx: BaseAudioContext, baseUrl = '/audio/'): Promise<Bank> => {
  let byUrl = decodedBanks.get(ctx)
  if (!byUrl) {
    byUrl = new Map()
    decodedBanks.set(ctx, byUrl)
  }
  let p = byUrl.get(baseUrl)
  if (!p) {
    p = loadBank(ctx, baseUrl)
    byUrl.set(baseUrl, p)
    p.catch(() => byUrl?.delete(baseUrl)) // un échec de chargement n'est pas gardé
  }
  return p
}

export const loadBank = async (
  ctx: BaseAudioContext,
  baseUrl = '/audio/',
  manifest?: Manifest,
): Promise<Bank> => {
  const m = manifest ?? (await fetchManifest(baseUrl))
  const decoded = await Promise.all(
    m.files.map(async (e) => {
      const bytes = await fetchBytes(`${baseUrl}${e.file}`)
      // decodeAudioData détache le tampon : on lui passe une copie, le cache reste utilisable.
      const buf = await ctx.decodeAudioData(bytes.slice(0))
      return [e.id, buf] as const
    }),
  )
  return { manifest: m, buffers: new Map(decoded) }
}
