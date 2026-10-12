// Textures du moteur de présentation (E1) : télécharge les jeux PBR CC0 de Poly Haven listés ici (albédo, normale
// OpenGL, AO/rugosité/métal empaquetés), recopie les images 2D générées par GPT Image rangées dans art/textures/,
// et écrit public/textures/manifest.json : pour chaque fichier, la source, l'URL, la licence et la résolution.
// Usage : pnpm tsx scripts/fetch-textures.ts [--force]
// API Poly Haven : https://api.polyhaven.com (conditions : en-tête User-Agent propre au logiciel). Les fichiers
// téléchargés sont sous CC0 1.0 et servis par le jeu lui-même, sans appel à l'API à l'exécution.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..')
const OUT = join(ROOT, 'public', 'textures')
const ART = join(ROOT, 'art', 'textures')
const USER_AGENT = 'mercy-fetch-textures'
const RESOLUTION = '1k'
const FORCE = process.argv.includes('--force')

// Jeu de textures → actif Poly Haven. Le nom du jeu est celui que lit le rendu (src/render/materials.ts).
const SETS = {
  boue: 'brown_mud_03', // boue humide de la fosse
  terre: 'excavated_soil_wall', // murs de terre de l'ossuaire
  pierre: 'castle_wall_slates', // rebords, escalier
  bois: 'rough_wood', // pieux, gibet, planches
  fer: 'rust_coarse_01', // fer rouillé : cloche, braseros, masque, chaînes
  cuir: 'brown_leather', // tablier, sangles
  tissu: 'rough_linen', // robes, capuches, bannières
} as const

// Cartes demandées : nom dans l'API → suffixe du fichier écrit.
const MAPS = [
  { keys: ['Diffuse', 'diff'], name: 'albedo' },
  { keys: ['nor_gl'], name: 'normal' },
  { keys: ['arm'], name: 'arm' }, // R = occlusion, G = rugosité, B = métal
] as const

interface FileEntry {
  readonly file: string
  readonly set: string
  readonly map: string
  readonly source: string
  readonly asset: string
  readonly page: string
  readonly url: string
  readonly license: string
  readonly resolution: string
  readonly width: number
  readonly height: number
  readonly bytes: number
  readonly md5: string
  readonly authors?: readonly string[]
  readonly prompt?: string
  readonly processing?: string
}

const getJson = async (url: string): Promise<unknown> => {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`)
  return r.json()
}

const getBytes = async (url: string): Promise<Uint8Array> => {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

const md5 = (b: Uint8Array): string => createHash('md5').update(b).digest('hex')

// Dimensions lues dans l'en-tête (JPEG : marqueur SOF ; PNG : bloc IHDR).
const dimensions = (b: Uint8Array): { width: number; height: number } => {
  if (b[0] === 0x89 && b[1] === 0x50) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) throw new Error('JPEG illisible')
    const marker = b[i + 1] ?? 0
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0),
        width: ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0),
      }
    }
    i += 2 + len
  }
  throw new Error('JPEG sans SOF')
}

type ApiFiles = Record<string, Record<string, Record<string, { url: string; md5: string; size: number }>>>
type ApiInfo = { name: string; authors: Record<string, string> }

const fetchSet = async (set: string, asset: string): Promise<FileEntry[]> => {
  const files = (await getJson(`https://api.polyhaven.com/files/${asset}`)) as ApiFiles
  const info = (await getJson(`https://api.polyhaven.com/info/${asset}`)) as ApiInfo
  const out: FileEntry[] = []
  for (const m of MAPS) {
    const key = m.keys.find((k) => files[k]?.[RESOLUTION]?.jpg)
    const remote = key ? files[key]?.[RESOLUTION]?.jpg : undefined
    if (!remote) throw new Error(`${asset} : carte ${m.name} absente en ${RESOLUTION} jpg`)
    const rel = `textures/${set}/${set}_${m.name}.jpg`
    const path = join(ROOT, 'public', rel)
    let bytes: Uint8Array
    if (!FORCE && existsSync(path) && md5(readFileSync(path)) === remote.md5) bytes = readFileSync(path)
    else {
      bytes = await getBytes(remote.url)
      if (md5(bytes) !== remote.md5) throw new Error(`${remote.url} : md5 différent de celui de l'API`)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, bytes)
    }
    const { width, height } = dimensions(bytes)
    out.push({
      file: rel,
      set,
      map: m.name,
      source: 'Poly Haven',
      asset,
      page: `https://polyhaven.com/a/${asset}`,
      url: remote.url,
      license: 'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)',
      resolution: RESOLUTION,
      width,
      height,
      bytes: bytes.length,
      md5: md5(bytes),
      authors: Object.keys(info.authors),
    })
    console.log(`${set.padEnd(7)} ${m.name.padEnd(6)} ${width}×${height} ${bytes.length} o  ${remote.url}`)
  }
  return out
}

// Images 2D générées par GPT Image (bannières…) : décrites dans art/textures/generated.json, recopiées telles quelles.
interface Generated {
  readonly name: string
  readonly file: string // dans art/textures/
  readonly prompt: string
  readonly generator: string
  readonly processing?: string
}

const copyGenerated = (): FileEntry[] => {
  const listPath = join(ART, 'generated.json')
  if (!existsSync(listPath)) return []
  const list = JSON.parse(readFileSync(listPath, 'utf8')) as Generated[]
  return list.map((g) => {
    const bytes = new Uint8Array(readFileSync(join(ART, g.file)))
    const rel = `textures/gen/${g.file}`
    const path = join(ROOT, 'public', rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    const { width, height } = dimensions(bytes)
    console.log(`gen     ${g.name.padEnd(6)} ${width}×${height} ${bytes.length} o  art/textures/${g.file}`)
    return {
      file: rel,
      set: 'gen',
      map: g.name,
      source: g.generator,
      asset: `art/textures/${g.file}`,
      page: '',
      url: `art/textures/${g.file}`,
      license: 'Image générée pour MERCY (aucune œuvre tierce)',
      resolution: `${width}x${height}`,
      width,
      height,
      bytes: bytes.length,
      md5: md5(bytes),
      prompt: g.prompt,
      ...(g.processing ? { processing: g.processing } : {}),
    }
  })
}

const main = async (): Promise<void> => {
  mkdirSync(OUT, { recursive: true })
  const files: FileEntry[] = []
  for (const [set, asset] of Object.entries(SETS)) files.push(...(await fetchSet(set, asset)))
  files.push(...copyGenerated())
  const manifest = {
    note: 'Textures du jeu : source, URL, licence et résolution de chaque fichier. Écrit par scripts/fetch-textures.ts.',
    sets: SETS,
    files,
  }
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const total = files.reduce((n, f) => n + f.bytes, 0)
  console.log(`${files.length} fichiers, ${(total / 1e6).toFixed(1)} Mo → public/textures/manifest.json`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
