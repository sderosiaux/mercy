// Préparation des maillages de la Forge au chargement (une fois par personnage). Pur : tableaux et matrices three,
// aucun WebGL, testable sous Node.
// - os dominant de chaque sommet (le poids le plus fort) ;
// - normales de contour : moyenne des normales des sommets confondus, pour que le liseré (coque inversée gonflée le
//   long des normales) ne se fende pas aux coutures d'UV ;
// - boîte de chaque os dans son repère (B2 I4 : les « segments » d'un corps à squelette sont ses os) ;
// - version allégée pour les morts (regroupement des sommets sur une grille), qui garde les attributs d'un vrai sommet
//   de chaque cellule (uv, poids de peau).
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'

export const dominantBones = (geometry: BufferGeometry): Uint16Array => {
  const si = geometry.getAttribute('skinIndex')
  const sw = geometry.getAttribute('skinWeight')
  const n = geometry.getAttribute('position').count
  const out = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    let best = 0
    let bw = -1
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k)
      if (w > bw) {
        bw = w
        best = si.getComponent(i, k)
      }
    }
    out[i] = best
  }
  return out
}

const keyOf = (x: number, y: number, z: number, q: number): string =>
  `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`

export const outlineNormals = (geometry: BufferGeometry): Float32Array => {
  const pos = geometry.getAttribute('position')
  const nor = geometry.getAttribute('normal')
  const n = pos.count
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const diag = bb ? bb.max.distanceTo(bb.min) : 1
  const q = diag * 1e-5
  const acc = new Map<string, [number, number, number]>()
  const keys: string[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const k = keyOf(pos.getX(i), pos.getY(i), pos.getZ(i), q)
    keys[i] = k
    const a = acc.get(k) ?? [0, 0, 0]
    a[0] += nor.getX(i)
    a[1] += nor.getY(i)
    a[2] += nor.getZ(i)
    acc.set(k, a)
  }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const a = acc.get(keys[i] as string) as [number, number, number]
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    out[i * 3] = a[0] / l
    out[i * 3 + 1] = a[1] / l
    out[i * 3 + 2] = a[2] / l
  }
  return out
}

export interface BoneBox {
  readonly bone: number
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

// Boîte, dans le repère de chaque os au repos, des sommets dont il est l'os dominant.
export const boneBoxes = (
  geometry: BufferGeometry,
  dominant: Uint16Array,
  bindMatrix: Matrix4,
  boneInverses: readonly Matrix4[],
): BoneBox[] => {
  const pos = geometry.getAttribute('position')
  const v = new Vector3()
  const m = new Matrix4()
  const boxes = new Map<number, { min: number[]; max: number[] }>()
  for (let i = 0; i < pos.count; i++) {
    const b = dominant[i] as number
    const inv = boneInverses[b]
    if (!inv) continue
    m.multiplyMatrices(inv, bindMatrix)
    v.fromBufferAttribute(pos, i).applyMatrix4(m)
    const box = boxes.get(b) ?? {
      min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    }
    const c = [v.x, v.y, v.z]
    for (let k = 0; k < 3; k++) {
      box.min[k] = Math.min(box.min[k] as number, c[k] as number)
      box.max[k] = Math.max(box.max[k] as number, c[k] as number)
    }
    boxes.set(b, box)
  }
  return [...boxes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bone, b]) => ({
      bone,
      min: b.min as unknown as readonly [number, number, number],
      max: b.max as unknown as readonly [number, number, number],
    }))
}

// Version allégée par regroupement de sommets : grille de pas `cell` ; chaque cellule garde le sommet d'origine le
// plus proche du centre de ses sommets ; les triangles dégénérés ou en double disparaissent.
// Îlots de la géométrie : composantes connexes du graphe des indices. Un GLB coupe ses sommets aux coutures d'UV,
// donc deux îlots ne partagent aucun sommet ; on ne regroupe jamais deux sommets de deux îlots (la texture du mort
// resterait à sa place).
export const islands = (n: number, index: ArrayLike<number>): Int32Array => {
  const parent = Int32Array.from({ length: n }, (_, i) => i)
  const find = (a: number): number => {
    let r = a
    while (parent[r] !== r) r = parent[r] as number
    let x = a
    while (parent[x] !== r) {
      const next = parent[x] as number
      parent[x] = r
      x = next
    }
    return r
  }
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = find(index[t] as number)
    const b = find(index[t + 1] as number)
    const c = find(index[t + 2] as number)
    if (a !== b) parent[b] = a
    if (find(c) !== a) parent[find(c)] = a
  }
  const out = new Int32Array(n)
  for (let i = 0; i < n; i++) out[i] = find(i)
  return out
}

export const clusterIndices = (
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  cell: number,
  island?: Int32Array,
): { index: Uint32Array; kept: Uint32Array } => {
  const n = positions.length / 3
  const cellOf = new Int32Array(n)
  const cells = new Map<string, number>()
  const sums: number[][] = []
  const members: number[][] = []
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] as number
    const y = positions[i * 3 + 1] as number
    const z = positions[i * 3 + 2] as number
    const k = `${island ? island[i] : 0}:${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
    let c = cells.get(k)
    if (c === undefined) {
      c = sums.length
      cells.set(k, c)
      sums.push([0, 0, 0])
      members.push([])
    }
    cellOf[i] = c
    const s = sums[c] as number[]
    s[0] = (s[0] as number) + x
    s[1] = (s[1] as number) + y
    s[2] = (s[2] as number) + z
    ;(members[c] as number[]).push(i)
  }
  const rep = new Int32Array(sums.length)
  for (let c = 0; c < sums.length; c++) {
    const list = members[c] as number[]
    const s = sums[c] as number[]
    const cx = (s[0] as number) / list.length
    const cy = (s[1] as number) / list.length
    const cz = (s[2] as number) / list.length
    let best = list[0] as number
    let bd = Number.POSITIVE_INFINITY
    for (const i of list) {
      const d =
        ((positions[i * 3] as number) - cx) ** 2 +
        ((positions[i * 3 + 1] as number) - cy) ** 2 +
        ((positions[i * 3 + 2] as number) - cz) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    rep[c] = best
  }
  const tris: number[] = []
  const seen = new Set<string>()
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = rep[cellOf[index[t] as number] as number] as number
    const b = rep[cellOf[index[t + 1] as number] as number] as number
    const c = rep[cellOf[index[t + 2] as number] as number] as number
    if (a === b || b === c || a === c) continue
    const k = [a, b, c].sort((p, q) => p - q).join(',')
    if (seen.has(k)) continue
    seen.add(k)
    tris.push(a, b, c)
  }
  const keptSet = [...new Set(tris)].sort((p, q) => p - q)
  const remap = new Map<number, number>()
  keptSet.forEach((v, i) => {
    remap.set(v, i)
  })
  return { index: Uint32Array.from(tris.map((v) => remap.get(v) as number)), kept: Uint32Array.from(keptSet) }
}

// Géométrie allégée à environ `targetTris` triangles (recherche du pas de grille par dichotomie).
export const lodGeometry = (geometry: BufferGeometry, targetTris: number): BufferGeometry => {
  const pos = geometry.getAttribute('position')
  const idx = geometry.getIndex()
  const index: ArrayLike<number> = idx ? idx.array : Uint32Array.from({ length: pos.count }, (_, i) => i)
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const diag = bb ? bb.max.distanceTo(bb.min) : 1
  let lo = diag / 400
  let hi = diag / 8
  const isl = islands(pos.count, index)
  let best = clusterIndices(pos.array, index, hi, isl)
  for (let k = 0; k < 14; k++) {
    const mid = Math.sqrt(lo * hi)
    const r = clusterIndices(pos.array, index, mid, isl)
    if (r.index.length / 3 > targetTris) lo = mid
    else {
      hi = mid
      best = r
    }
  }
  const out = new BufferGeometry()
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const a = attr as BufferAttribute
    const size = a.itemSize
    const Ctor = a.array.constructor as new (n: number) => Float32Array | Uint16Array | Uint8Array
    const arr = new Ctor(best.kept.length * size)
    for (let i = 0; i < best.kept.length; i++) {
      const src = best.kept[i] as number
      for (let k = 0; k < size; k++) arr[i * size + k] = a.array[src * size + k] as number
    }
    out.setAttribute(name, new BufferAttribute(arr, size, a.normalized))
  }
  out.setIndex(new BufferAttribute(best.index, 1))
  return out
}
