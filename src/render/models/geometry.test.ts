// Préparation des maillages : normales de contour soudées, os dominant, version allégée qui garde les attributs
// d'un vrai sommet de chaque cellule.
import { BufferAttribute, type BufferGeometry, Matrix4, SphereGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { boneBoxes, clusterIndices, dominantBones, lodGeometry, outlineNormals } from './geometry'

const skinned = (): BufferGeometry => {
  const g = new SphereGeometry(1, 48, 32)
  const n = g.getAttribute('position').count
  const si = new Uint16Array(n * 4)
  const sw = new Float32Array(n * 4)
  const pos = g.getAttribute('position')
  for (let i = 0; i < n; i++) {
    // Os 0 en bas, os 1 en haut ; poids selon la hauteur.
    const y = pos.getY(i)
    si.set([0, 1, 0, 0], i * 4)
    const w1 = (y + 1) / 2
    sw.set([1 - w1, w1, 0, 0], i * 4)
  }
  g.setAttribute('skinIndex', new BufferAttribute(si, 4))
  g.setAttribute('skinWeight', new BufferAttribute(sw, 4))
  return g
}

describe('os dominant', () => {
  it('prend le poids le plus fort', () => {
    const g = skinned()
    const d = dominantBones(g)
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0.05) expect(d[i]).toBe(1)
      if (pos.getY(i) < -0.05) expect(d[i]).toBe(0)
    }
  })
})

describe('normales de contour', () => {
  it('sont soudées aux coutures (même position, même normale)', () => {
    const g = new SphereGeometry(1, 16, 8) // la couture en longitude double des sommets
    const out = outlineNormals(g)
    const pos = g.getAttribute('position')
    const seen = new Map<string, number[]>()
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
      const n = [out[i * 3] as number, out[i * 3 + 1] as number, out[i * 3 + 2] as number]
      const prev = seen.get(k)
      if (prev) for (let c = 0; c < 3; c++) expect(n[c]).toBeCloseTo(prev[c] as number, 5)
      else seen.set(k, n)
      expect(Math.hypot(n[0] as number, n[1] as number, n[2] as number)).toBeCloseTo(1, 5)
    }
  })
})

describe('boîtes des os', () => {
  it('enferment les sommets dominés, dans le repère de l’os', () => {
    const g = skinned()
    const d = dominantBones(g)
    const inv = [new Matrix4().makeTranslation(0, 0.5, 0), new Matrix4().makeTranslation(0, -0.5, 0)]
    const boxes = boneBoxes(g, d, new Matrix4(), inv)
    expect(boxes.map((b) => b.bone)).toEqual([0, 1])
    const top = boxes[1]
    expect(top?.max[1]).toBeCloseTo(0.5, 5) // sommet y = 1, translaté de −0,5
  })
})

describe('version allégée', () => {
  it('approche la cible de triangles', () => {
    const g = skinned()
    const tris = (g.getIndex()?.count ?? 0) / 3
    const lod = lodGeometry(g, 400)
    const n = (lod.getIndex()?.count ?? 0) / 3
    expect(n).toBeLessThanOrEqual(400)
    expect(n).toBeGreaterThan(200)
    expect(n).toBeLessThan(tris)
  })
  it('garde, pour chaque sommet, les attributs d’un sommet d’origine', () => {
    const g = skinned()
    const lod = lodGeometry(g, 300)
    const src = g.getAttribute('position')
    const pos = lod.getAttribute('position')
    const sw = lod.getAttribute('skinWeight')
    const srcW = g.getAttribute('skinWeight')
    for (let i = 0; i < pos.count; i++) {
      let found = -1
      for (let j = 0; j < src.count && found < 0; j++)
        if (src.getX(j) === pos.getX(i) && src.getY(j) === pos.getY(i) && src.getZ(j) === pos.getZ(i))
          found = j
      expect(found).toBeGreaterThanOrEqual(0)
      expect(sw.getX(i)).toBe(srcW.getX(found))
      expect(sw.getY(i)).toBe(srcW.getY(found))
    }
  })
  it('ne garde aucun triangle dégénéré ni en double', () => {
    const g = skinned()
    const r = clusterIndices(g.getAttribute('position').array, (g.getIndex() as BufferAttribute).array, 0.2)
    const seen = new Set<string>()
    for (let t = 0; t < r.index.length; t += 3) {
      const tri = [r.index[t], r.index[t + 1], r.index[t + 2]] as number[]
      expect(new Set(tri).size).toBe(3)
      const k = [...tri].sort((a, b) => a - b).join(',')
      expect(seen.has(k)).toBe(false)
      seen.add(k)
    }
  })
})
