// Figurine glTF construite en code : un squelette humanoïde de 15 os, un pavé skinné par os, et des clips décrits
// par une fonction du temps. Sert aux tests de la validation (aucun asset externe) et au banc d'essai de la galerie.
import { Euler, Matrix4, Quaternion } from 'three'
import type { Glb, GltfAccessor, GltfAnimation, GltfJson } from './glb'

export type BoneKey =
  | 'hips'
  | 'spine'
  | 'head'
  | 'upperArmL'
  | 'foreArmL'
  | 'handL'
  | 'upperArmR'
  | 'foreArmR'
  | 'handR'
  | 'thighL'
  | 'shinL'
  | 'footL'
  | 'thighR'
  | 'shinR'
  | 'footR'

type V3 = readonly [number, number, number]

interface BoneDef {
  readonly key: BoneKey
  readonly parent: BoneKey | null
  readonly offset: V3 // position locale au repos (figurine de référence, face à +Z, sa gauche vers +X)
  readonly box: V3 // dimensions du pavé
  readonly center: V3 // centre du pavé, relatif à l'articulation
  readonly name: string
}

const LAYOUT: readonly BoneDef[] = [
  {
    key: 'hips',
    parent: null,
    offset: [0, 0.95, 0],
    box: [0.3, 0.16, 0.18],
    center: [0, 0.04, 0],
    name: 'Hips',
  },
  {
    key: 'spine',
    parent: 'hips',
    offset: [0, 0.1, 0],
    box: [0.34, 0.5, 0.2],
    center: [0, 0.25, 0],
    name: 'Spine',
  },
  {
    key: 'head',
    parent: 'spine',
    offset: [0, 0.55, 0],
    box: [0.2, 0.24, 0.22],
    center: [0, 0.12, 0],
    name: 'Head',
  },
  {
    key: 'upperArmL',
    parent: 'spine',
    offset: [0.22, 0.45, 0],
    box: [0.09, 0.3, 0.09],
    center: [0, -0.15, 0],
    name: 'LeftArm',
  },
  {
    key: 'foreArmL',
    parent: 'upperArmL',
    offset: [0, -0.3, 0],
    box: [0.08, 0.27, 0.08],
    center: [0, -0.135, 0],
    name: 'LeftForeArm',
  },
  {
    key: 'handL',
    parent: 'foreArmL',
    offset: [0, -0.27, 0],
    box: [0.07, 0.12, 0.04],
    center: [0, -0.06, 0],
    name: 'LeftHand',
  },
  {
    key: 'upperArmR',
    parent: 'spine',
    offset: [-0.22, 0.45, 0],
    box: [0.09, 0.3, 0.09],
    center: [0, -0.15, 0],
    name: 'RightArm',
  },
  {
    key: 'foreArmR',
    parent: 'upperArmR',
    offset: [0, -0.3, 0],
    box: [0.08, 0.27, 0.08],
    center: [0, -0.135, 0],
    name: 'RightForeArm',
  },
  {
    key: 'handR',
    parent: 'foreArmR',
    offset: [0, -0.27, 0],
    box: [0.07, 0.12, 0.04],
    center: [0, -0.06, 0],
    name: 'RightHand',
  },
  {
    key: 'thighL',
    parent: 'hips',
    offset: [0.1, -0.03, 0],
    box: [0.13, 0.42, 0.13],
    center: [0, -0.21, 0],
    name: 'LeftUpLeg',
  },
  {
    key: 'shinL',
    parent: 'thighL',
    offset: [0, -0.42, 0],
    box: [0.1, 0.42, 0.1],
    center: [0, -0.21, 0],
    name: 'LeftLeg',
  },
  {
    key: 'footL',
    parent: 'shinL',
    offset: [0, -0.44, 0],
    box: [0.1, 0.06, 0.24],
    center: [0, -0.03, 0.06],
    name: 'LeftFoot',
  },
  {
    key: 'thighR',
    parent: 'hips',
    offset: [-0.1, -0.03, 0],
    box: [0.13, 0.42, 0.13],
    center: [0, -0.21, 0],
    name: 'RightUpLeg',
  },
  {
    key: 'shinR',
    parent: 'thighR',
    offset: [0, -0.42, 0],
    box: [0.1, 0.42, 0.1],
    center: [0, -0.21, 0],
    name: 'RightLeg',
  },
  {
    key: 'footR',
    parent: 'shinR',
    offset: [0, -0.44, 0],
    box: [0.1, 0.06, 0.24],
    center: [0, -0.03, 0.06],
    name: 'RightFoot',
  },
]
export const REFERENCE_HEIGHT_M = 1.84 // du dessous des pieds au sommet de la tête, au repos

export type PoseFrame = Partial<Record<BoneKey, { readonly rot?: V3; readonly move?: V3 }>>

export interface ClipDef {
  readonly name: string
  readonly duration: number
  readonly fps?: number
  readonly extras?: Readonly<Record<string, unknown>>
  readonly pose: (t: number) => PoseFrame
}

export interface BuildOptions {
  readonly heightM?: number
  readonly clips: readonly ClipDef[]
  readonly skinned?: boolean
  readonly boneNames?: Readonly<Partial<Record<BoneKey, string>>>
  readonly extraTriangles?: number
  readonly image?: { readonly mime: 'image/png' | 'image/jpeg'; readonly bytes: Uint8Array }
  readonly baseColor?: readonly [number, number, number, number]
}

class BinWriter {
  private parts: Uint8Array[] = []
  private length = 0
  readonly accessors: GltfAccessor[] = []
  readonly views: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] = []

  bytes(data: Uint8Array, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4
    if (pad) this.push(new Uint8Array(pad))
    this.views.push({
      buffer: 0,
      byteOffset: this.length,
      byteLength: data.byteLength,
      ...(target ? { target } : {}),
    })
    this.push(data)
    return this.views.length - 1
  }

  accessor(
    data: Float32Array | Uint16Array | Uint32Array | Uint8Array,
    type: GltfAccessor['type'],
    opts: { target?: number; minMax?: boolean } = {},
  ): number {
    const componentType =
      data instanceof Float32Array
        ? 5126
        : data instanceof Uint32Array
          ? 5125
          : data instanceof Uint16Array
            ? 5123
            : 5121
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[type]
    const view = this.bytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), opts.target)
    const acc: GltfAccessor = { bufferView: view, componentType, count: data.length / n, type }
    if (opts.minMax) {
      const min = Array.from({ length: n }, () => Number.POSITIVE_INFINITY)
      const max = Array.from({ length: n }, () => Number.NEGATIVE_INFINITY)
      for (let i = 0; i < data.length; i++) {
        const c = i % n
        min[c] = Math.min(min[c] as number, data[i] as number)
        max[c] = Math.max(max[c] as number, data[i] as number)
      }
      acc.min = min
      acc.max = max
    }
    this.accessors.push(acc)
    return this.accessors.length - 1
  }

  private push(p: Uint8Array): void {
    this.parts.push(p)
    this.length += p.byteLength
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length)
    let o = 0
    for (const p of this.parts) {
      out.set(p, o)
      o += p.byteLength
    }
    return out
  }
}

// 6 faces de 4 sommets, normales plates.
const FACES: readonly { n: V3; u: V3; v: V3 }[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
]

export const buildFigure = (opts: BuildOptions): Glb => {
  const k = (opts.heightM ?? REFERENCE_HEIGHT_M) / REFERENCE_HEIGHT_M
  const skinned = opts.skinned ?? true
  const world = new Map<BoneKey, V3>()
  for (const b of LAYOUT) {
    const p = b.parent ? (world.get(b.parent) as V3) : ([0, 0, 0] as V3)
    world.set(b.key, [p[0] + b.offset[0] * k, p[1] + b.offset[1] * k, p[2] + b.offset[2] * k])
  }

  const pos: number[] = []
  const nrm: number[] = []
  const joints: number[] = []
  const weights: number[] = []
  const idx: number[] = []
  const addBox = (center: V3, size: V3, joint: number): void => {
    for (const f of FACES) {
      const base = pos.length / 3
      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        for (let c = 0; c < 3; c++) {
          pos.push(
            (center[c] as number) +
              ((f.n[c] as number) * (size[c] as number)) / 2 +
              ((f.u[c] as number) * su * (size[c] as number)) / 2 +
              ((f.v[c] as number) * sv * (size[c] as number)) / 2,
          )
          nrm.push(f.n[c] as number)
        }
        joints.push(joint, 0, 0, 0)
        weights.push(1, 0, 0, 0)
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  LAYOUT.forEach((b, i) => {
    const w = world.get(b.key) as V3
    addBox(
      [w[0] + b.center[0] * k, w[1] + b.center[1] * k, w[2] + b.center[2] * k],
      [b.box[0] * k, b.box[1] * k, b.box[2] * k],
      i,
    )
  })
  // Bande de triangles supplémentaires (budgets) : une nappe plate sous le bassin, liée au bassin.
  const extra = opts.extraTriangles ?? 0
  for (let t = 0; t < extra; t++) {
    const base = pos.length / 3
    const x = (t % 100) * 0.001
    pos.push(x, 0.9 * k, 0, x + 0.001, 0.9 * k, 0, x, 0.901 * k, 0)
    for (let j = 0; j < 3; j++) {
      nrm.push(0, 0, 1)
      joints.push(0, 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
    idx.push(base, base + 1, base + 2)
  }

  const w = new BinWriter()
  const vertexCount = pos.length / 3
  const attributes: Record<string, number> = {
    POSITION: w.accessor(new Float32Array(pos), 'VEC3', { target: 34962, minMax: true }),
    NORMAL: w.accessor(new Float32Array(nrm), 'VEC3', { target: 34962 }),
  }
  if (skinned) {
    attributes.JOINTS_0 = w.accessor(new Uint8Array(joints), 'VEC4', { target: 34962 })
    attributes.WEIGHTS_0 = w.accessor(new Float32Array(weights), 'VEC4', { target: 34962 })
  }
  const indices = w.accessor(vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 'SCALAR', {
    target: 34963,
  })

  const nodes: GltfJson['nodes'] = [{ name: 'Figurine', children: [] }]
  const boneNode = new Map<BoneKey, number>()
  if (skinned) {
    for (const b of LAYOUT) {
      nodes.push({
        name: opts.boneNames?.[b.key] ?? b.name,
        translation: [b.offset[0] * k, b.offset[1] * k, b.offset[2] * k],
        children: [],
      })
      boneNode.set(b.key, nodes.length - 1)
    }
    for (const b of LAYOUT) {
      const self = boneNode.get(b.key) as number
      const parent = b.parent ? (boneNode.get(b.parent) as number) : 0
      nodes[parent]?.children?.push(self)
    }
  }
  nodes.push({ name: 'Corps', mesh: 0, ...(skinned ? { skin: 0 } : {}) })
  nodes[0]?.children?.push(nodes.length - 1)

  const material: Record<string, unknown> = {
    name: 'figurine',
    pbrMetallicRoughness: {
      baseColorFactor: [...(opts.baseColor ?? [0.5, 0.5, 0.5, 1])],
      metallicFactor: 0,
      roughnessFactor: 0.8,
    },
  }
  const json: GltfJson = {
    asset: { version: '2.0', generator: 'mercy-forge banc' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [{ name: 'Corps', primitives: [{ attributes, indices, material: 0 }] }],
    materials: [material],
  }
  if (opts.image) {
    const view = w.bytes(opts.image.bytes)
    json.images = [{ bufferView: view, mimeType: opts.image.mime, name: 'albedo' }]
    json.textures = [{ source: 0 }]
    ;(material.pbrMetallicRoughness as Record<string, unknown>).baseColorTexture = { index: 0 }
  }

  if (skinned) {
    const ibm = new Float32Array(LAYOUT.length * 16)
    LAYOUT.forEach((b, i) => {
      const p = world.get(b.key) as V3
      ibm.set(new Matrix4().makeTranslation(-p[0], -p[1], -p[2]).toArray(), i * 16)
    })
    json.skins = [
      {
        joints: LAYOUT.map((b) => boneNode.get(b.key) as number),
        inverseBindMatrices: w.accessor(ibm, 'MAT4'),
        skeleton: boneNode.get('hips') as number,
      },
    ]
    json.animations = opts.clips.map((clip) => buildClip(clip, w, boneNode, k))
  }
  json.accessors = w.accessors
  json.bufferViews = w.views
  const bin = w.concat()
  json.buffers = [{ byteLength: bin.byteLength }]
  return { json, bin }
}

const buildClip = (clip: ClipDef, w: BinWriter, boneNode: Map<BoneKey, number>, k: number): GltfAnimation => {
  const fps = clip.fps ?? 30
  const times: number[] = []
  for (let i = 0; i / fps < clip.duration - 1e-9; i++) times.push(i / fps)
  times.push(clip.duration)
  const frames = times.map((t) => clip.pose(t))
  const rotated = new Set<BoneKey>()
  const moved = new Set<BoneKey>()
  for (const f of frames) {
    for (const [key, v] of Object.entries(f) as [BoneKey, { rot?: V3; move?: V3 }][]) {
      if (v.rot) rotated.add(key)
      if (v.move) moved.add(key)
    }
  }
  const input = w.accessor(new Float32Array(times), 'SCALAR', { minMax: true })
  const samplers: GltfAnimation['samplers'] = []
  const channels: GltfAnimation['channels'] = []
  const q = new Quaternion()
  const e = new Euler()
  for (const key of rotated) {
    const out = new Float32Array(times.length * 4)
    frames.forEach((f, i) => {
      const r = f[key]?.rot ?? [0, 0, 0]
      q.setFromEuler(e.set(r[0], r[1], r[2], 'XYZ'))
      out.set([q.x, q.y, q.z, q.w], i * 4)
    })
    samplers.push({ input, output: w.accessor(out, 'VEC4'), interpolation: 'LINEAR' })
    channels.push({
      sampler: samplers.length - 1,
      target: { node: boneNode.get(key) as number, path: 'rotation' },
    })
  }
  for (const key of moved) {
    const def = LAYOUT.find((b) => b.key === key) as BoneDef
    const out = new Float32Array(times.length * 3)
    frames.forEach((f, i) => {
      const m = f[key]?.move ?? [0, 0, 0]
      out.set([(def.offset[0] + m[0]) * k, (def.offset[1] + m[1]) * k, (def.offset[2] + m[2]) * k], i * 3)
    })
    samplers.push({ input, output: w.accessor(out, 'VEC3'), interpolation: 'LINEAR' })
    channels.push({
      sampler: samplers.length - 1,
      target: { node: boneNode.get(key) as number, path: 'translation' },
    })
  }
  return { name: clip.name, samplers, channels, ...(clip.extras ? { extras: { ...clip.extras } } : {}) }
}
