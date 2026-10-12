// Compactage d'un GLB : retire les accesseurs et les vues que plus rien ne référence (clips remplacés par les
// post-traitements, sorties intermédiaires de l'assemblage) et reconstruit le tampon. Seules les références du
// cœur glTF 2.0 sont suivies ; un fichier qui déclare une extension (qui pourrait viser une vue) est rendu tel
// quel plutôt que risqué.
import type { Glb, GltfAccessor, GltfBufferView } from './glb'

const pad4 = (n: number): number => (n + 3) & ~3

interface Sparse {
  indices?: { bufferView: number; byteOffset?: number }
  values?: { bufferView: number; byteOffset?: number }
}

export const compactGlb = (glb: Glb): Glb => {
  const j = glb.json
  if ((j.extensionsUsed ?? []).length > 0 || (j.buffers ?? []).length > 1) return glb
  const usedAcc = new Set<number>()
  for (const m of j.meshes ?? []) {
    for (const p of m.primitives) {
      for (const a of Object.values(p.attributes)) usedAcc.add(a)
      if (p.indices !== undefined) usedAcc.add(p.indices)
      for (const t of ((p as { targets?: Record<string, number>[] }).targets ?? []) as Record<
        string,
        number
      >[])
        for (const a of Object.values(t)) usedAcc.add(a)
    }
  }
  for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices)
  for (const a of j.animations ?? [])
    for (const s of a.samplers) {
      usedAcc.add(s.input)
      usedAcc.add(s.output)
    }
  const accessors = j.accessors ?? []
  const accOrder = [...usedAcc].sort((a, b) => a - b)
  const accMap = new Map(accOrder.map((old, i) => [old, i]))

  const usedView = new Set<number>()
  for (const i of accOrder) {
    const acc = accessors[i] as GltfAccessor
    if (acc.bufferView !== undefined) usedView.add(acc.bufferView)
    const sp = acc.sparse as Sparse | undefined
    if (sp?.indices) usedView.add(sp.indices.bufferView)
    if (sp?.values) usedView.add(sp.values.bufferView)
  }
  for (const img of j.images ?? []) if (img.bufferView !== undefined) usedView.add(img.bufferView)
  const views = j.bufferViews ?? []
  const viewOrder = [...usedView].sort((a, b) => a - b)
  const viewMap = new Map<number, number>()
  const newViews: GltfBufferView[] = []
  let size = 0
  for (const old of viewOrder) {
    const v = views[old] as GltfBufferView
    size = pad4(size)
    viewMap.set(old, newViews.length)
    newViews.push({ ...v, byteOffset: size })
    size += v.byteLength
  }
  const bin = new Uint8Array(pad4(size))
  viewOrder.forEach((old) => {
    const v = views[old] as GltfBufferView
    const start = v.byteOffset ?? 0
    bin.set(
      glb.bin.subarray(start, start + v.byteLength),
      (newViews[viewMap.get(old) as number] as GltfBufferView).byteOffset ?? 0,
    )
  })

  const remapAcc = (i: number): number => {
    const k = accMap.get(i)
    if (k === undefined) throw new Error(`compactage : accesseur ${i} non suivi`)
    return k
  }
  const remapView = (i: number): number => {
    const k = viewMap.get(i)
    if (k === undefined) throw new Error(`compactage : vue ${i} non suivie`)
    return k
  }
  const newAccessors = accOrder.map((i) => {
    const acc = accessors[i] as GltfAccessor
    const sp = acc.sparse as Sparse | undefined
    return {
      ...acc,
      ...(acc.bufferView !== undefined ? { bufferView: remapView(acc.bufferView) } : {}),
      ...(sp
        ? {
            sparse: {
              ...sp,
              ...(sp.indices
                ? { indices: { ...sp.indices, bufferView: remapView(sp.indices.bufferView) } }
                : {}),
              ...(sp.values ? { values: { ...sp.values, bufferView: remapView(sp.values.bufferView) } } : {}),
            },
          }
        : {}),
    }
  })
  const json = {
    ...j,
    accessors: newAccessors,
    bufferViews: newViews,
    buffers: [{ byteLength: bin.byteLength }],
    meshes: (j.meshes ?? []).map((m) => ({
      ...m,
      primitives: m.primitives.map((p) => {
        const targets = (p as { targets?: Record<string, number>[] }).targets
        return {
          ...p,
          attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, remapAcc(v)])),
          ...(p.indices !== undefined ? { indices: remapAcc(p.indices) } : {}),
          ...(targets
            ? {
                targets: targets.map((t) =>
                  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, remapAcc(v)])),
                ),
              }
            : {}),
        }
      }),
    })),
    skins: (j.skins ?? []).map((s) => ({
      ...s,
      ...(s.inverseBindMatrices !== undefined
        ? { inverseBindMatrices: remapAcc(s.inverseBindMatrices) }
        : {}),
    })),
    animations: (j.animations ?? []).map((a) => ({
      ...a,
      samplers: a.samplers.map((s) => ({ ...s, input: remapAcc(s.input), output: remapAcc(s.output) })),
    })),
    images: (j.images ?? []).map((img) =>
      img.bufferView !== undefined ? { ...img, bufferView: remapView(img.bufferView) } : img,
    ),
  }
  if (!j.meshes) delete (json as Partial<typeof json>).meshes
  if (!j.skins) delete (json as Partial<typeof json>).skins
  if (!j.animations) delete (json as Partial<typeof json>).animations
  if (!j.images) delete (json as Partial<typeof json>).images
  return { json, bin }
}
