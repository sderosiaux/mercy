// Lecture et écriture de GLB (glTF 2.0 binaire) au niveau du JSON et du tampon binaire, sans three ni Node :
// le même code sert à la CLI et à la galerie.

export interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  normalized?: boolean
  count: number
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4'
  min?: number[]
  max?: number[]
  sparse?: unknown
}
export interface GltfBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
  target?: number
}
export interface GltfNode {
  name?: string
  children?: number[]
  mesh?: number
  skin?: number
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  matrix?: number[]
}
export interface GltfChannel {
  sampler: number
  target: { node?: number; path: string }
}
export interface GltfSampler {
  input: number
  output: number
  interpolation?: string
}
export interface GltfAnimation {
  name?: string
  channels: GltfChannel[]
  samplers: GltfSampler[]
  extras?: Record<string, unknown>
}
export interface GltfPrimitive {
  attributes: Record<string, number>
  indices?: number
  mode?: number
  material?: number
}
export interface GltfImage {
  bufferView?: number
  mimeType?: string
  uri?: string
  name?: string
}
export interface GltfJson {
  asset: { version: string; generator?: string }
  scene?: number
  scenes?: { nodes?: number[]; name?: string }[]
  nodes?: GltfNode[]
  meshes?: { name?: string; primitives: GltfPrimitive[] }[]
  skins?: { joints: number[]; inverseBindMatrices?: number; skeleton?: number; name?: string }[]
  animations?: GltfAnimation[]
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
  buffers?: { byteLength: number; uri?: string }[]
  materials?: Record<string, unknown>[]
  textures?: Record<string, unknown>[]
  images?: GltfImage[]
  samplers?: Record<string, unknown>[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  [key: string]: unknown
}

export interface Glb {
  readonly json: GltfJson
  readonly bin: Uint8Array
}

const MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

export const parseGlb = (bytes: Uint8Array): Glb => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || v.getUint32(0, true) !== MAGIC)
    throw new Error('pas un GLB (en-tête glTF absent)')
  if (v.getUint32(4, true) !== 2) throw new Error(`GLB version ${v.getUint32(4, true)}, 2 attendue`)
  const total = Math.min(v.getUint32(8, true), bytes.byteLength)
  let pos = 12
  let json: GltfJson | null = null
  let bin = new Uint8Array(0)
  while (pos + 8 <= total) {
    const len = v.getUint32(pos, true)
    const type = v.getUint32(pos + 4, true)
    const body = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson
    else if (type === CHUNK_BIN) bin = body.slice()
    pos += 8 + len
  }
  if (!json) throw new Error('GLB sans bloc JSON')
  return { json, bin }
}

const pad4 = (n: number): number => (n + 3) & ~3

export const writeGlb = (glb: Glb): Uint8Array => {
  const json = { ...glb.json }
  if (glb.bin.byteLength > 0) json.buffers = [{ byteLength: glb.bin.byteLength }]
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonLen = pad4(jsonBytes.byteLength)
  const binLen = pad4(glb.bin.byteLength)
  const total = 12 + 8 + jsonLen + (glb.bin.byteLength > 0 ? 8 + binLen : 0)
  const out = new Uint8Array(total)
  const v = new DataView(out.buffer)
  v.setUint32(0, MAGIC, true)
  v.setUint32(4, 2, true)
  v.setUint32(8, total, true)
  v.setUint32(12, jsonLen, true)
  v.setUint32(16, CHUNK_JSON, true)
  out.set(jsonBytes, 20)
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen)
  if (glb.bin.byteLength > 0) {
    const at = 20 + jsonLen
    v.setUint32(at, binLen, true)
    v.setUint32(at + 4, CHUNK_BIN, true)
    out.set(glb.bin, at + 8)
  }
  return out
}

export const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
}
export const TYPE_COUNT: Readonly<Record<GltfAccessor['type'], number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

// Octets d'un accesseur, compactés (sans le pas de la vue).
export const accessorBytes = (glb: Glb, index: number): Uint8Array => {
  const acc = glb.json.accessors?.[index]
  if (!acc) throw new Error(`accesseur ${index} absent`)
  if (acc.sparse) throw new Error(`accesseur ${index} creux (sparse) non géré`)
  const elem = (COMPONENT_BYTES[acc.componentType] ?? 0) * TYPE_COUNT[acc.type]
  if (elem === 0) throw new Error(`accesseur ${index} : type de composante ${acc.componentType} inconnu`)
  if (acc.bufferView === undefined) return new Uint8Array(elem * acc.count)
  const view = glb.json.bufferViews?.[acc.bufferView]
  if (!view) throw new Error(`vue ${acc.bufferView} absente`)
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = view.byteStride ?? elem
  if (stride === elem) return glb.bin.slice(start, start + elem * acc.count)
  const out = new Uint8Array(elem * acc.count)
  for (let i = 0; i < acc.count; i++)
    out.set(glb.bin.subarray(start + i * stride, start + i * stride + elem), i * elem)
  return out
}

// Ajoute des octets au tampon (alignés sur 4) et renvoie la nouvelle vue ; ne modifie pas l'entrée.
export const appendBytes = (glb: Glb, data: Uint8Array): { glb: Glb; view: number } => {
  const offset = pad4(glb.bin.byteLength)
  const bin = new Uint8Array(offset + data.byteLength)
  bin.set(glb.bin, 0)
  bin.set(data, offset)
  const bufferViews = [
    ...(glb.json.bufferViews ?? []),
    { buffer: 0, byteOffset: offset, byteLength: data.byteLength },
  ]
  return { glb: { json: { ...glb.json, bufferViews }, bin }, view: bufferViews.length - 1 }
}
