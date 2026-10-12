// Mesures lues dans le JSON et le tampon du GLB, sans décoder d'image ni charger de scène : triangles réellement
// dessinés (maillage × nœuds qui l'instancient) et dimensions de chaque texture (en-têtes PNG, JPEG, WebP).
import type { Glb } from './glb'

export const triangleCount = (glb: Glb): number => {
  const uses = new Map<number, number>()
  for (const n of glb.json.nodes ?? [])
    if (n.mesh !== undefined) uses.set(n.mesh, (uses.get(n.mesh) ?? 0) + 1)
  let total = 0
  ;(glb.json.meshes ?? []).forEach((m, i) => {
    const instances = uses.get(i) ?? 0
    for (const p of m.primitives) {
      const mode = p.mode ?? 4
      const count =
        p.indices !== undefined
          ? (glb.json.accessors?.[p.indices]?.count ?? 0)
          : (glb.json.accessors?.[p.attributes.POSITION ?? -1]?.count ?? 0)
      const tris = mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0
      total += tris * instances
    }
  })
  return total
}

export interface ImageSize {
  readonly index: number
  readonly name: string
  readonly mime: string
  readonly width: number
  readonly height: number
}

const be16 = (b: Uint8Array, i: number): number => ((b[i] as number) << 8) | (b[i + 1] as number)
const le16 = (b: Uint8Array, i: number): number => (b[i] as number) | ((b[i + 1] as number) << 8)
const le24 = (b: Uint8Array, i: number): number => le16(b, i) | ((b[i + 2] as number) << 16)

export const imageDimensions = (b: Uint8Array): { width: number; height: number; mime: string } | null => {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { width: v.getUint32(16), height: v.getUint32(20), mime: 'image/png' }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1] as number
      const len = be16(b, i + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { height: be16(b, i + 5), width: be16(b, i + 7), mime: 'image/jpeg' }
      i += 2 + len
    }
    return null
  }
  const tag = (o: number): string => String.fromCharCode(...b.subarray(o, o + 4))
  if (b.length >= 30 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const kind = tag(12)
    if (kind === 'VP8X') return { width: le24(b, 24) + 1, height: le24(b, 27) + 1, mime: 'image/webp' }
    if (kind === 'VP8L') {
      const bits =
        (b[21] as number) | ((b[22] as number) << 8) | ((b[23] as number) << 16) | ((b[24] as number) << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mime: 'image/webp' }
    }
    if (kind === 'VP8 ')
      return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff, mime: 'image/webp' }
  }
  return null
}

export const textureSizes = (
  glb: Glb,
): { readonly sizes: readonly ImageSize[]; readonly unreadable: readonly string[] } => {
  const sizes: ImageSize[] = []
  const unreadable: string[] = []
  ;(glb.json.images ?? []).forEach((img, index) => {
    const name = img.name ?? `image ${index}`
    const view = img.bufferView === undefined ? undefined : glb.json.bufferViews?.[img.bufferView]
    if (!view) {
      unreadable.push(`${name} : image externe (${img.uri ?? 'sans uri'})`)
      return
    }
    const start = view.byteOffset ?? 0
    const dims = imageDimensions(glb.bin.subarray(start, start + view.byteLength))
    if (!dims) unreadable.push(`${name} : format d'image non reconnu`)
    else sizes.push({ index, name, ...dims, mime: img.mimeType ?? dims.mime })
  })
  return { sizes, unreadable }
}

// Extensions qui changent le décodage de la géométrie ou des textures : la mesure sous Node ne les gère pas.
const UNSUPPORTED_IN_NODE = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization']

export const blockingExtensions = (glb: Glb): readonly string[] =>
  (glb.json.extensionsRequired ?? []).filter((e) => UNSUPPORTED_IN_NODE.includes(e))

// Copie sans textures : sous Node, GLTFLoader ne sait pas décoder une image (pas de DOM). Les mesures de
// squelette et de mouvement n'en ont pas besoin ; les dimensions des textures sont lues à part (textureSizes).
export const stripTextures = (glb: Glb): Glb => {
  const materials = (glb.json.materials ?? []).map((m) => {
    const pbr = (m.pbrMetallicRoughness ?? {}) as Record<string, unknown>
    const { baseColorTexture: _b, metallicRoughnessTexture: _m, ...pbrRest } = pbr
    const { normalTexture: _n, occlusionTexture: _o, emissiveTexture: _e, extensions: _x, ...rest } = m
    return { ...rest, pbrMetallicRoughness: pbrRest }
  })
  const { images: _i, textures: _t, samplers: _s, ...json } = glb.json
  const drop = new Set([
    'KHR_texture_transform',
    'KHR_texture_basisu',
    'EXT_texture_webp',
    'KHR_materials_variants',
  ])
  const keep = (list?: string[]): string[] | undefined => list?.filter((e) => !drop.has(e))
  return {
    json: {
      ...json,
      materials,
      extensionsUsed: keep(json.extensionsUsed),
      extensionsRequired: keep(json.extensionsRequired),
    },
    bin: glb.bin,
  }
}
