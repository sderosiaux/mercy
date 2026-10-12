// Lecture rapide d'une image du laboratoire selon les conventions de B2 §5 (Lab D65, C*, CIEDE2000, pixels
// étiquetés par la passe d'identification). Sert au constructeur pour régler le rendu ; la mesure qui fait foi
// reste celle des vérificateurs de la phase D.
import { chroma, decodeId, deltaE00, type Lab, type PixelImage, ROLE, srgbToLab } from '../render/index'
import type { World } from '../sim/index'

const labCache = new Map<number, Lab>()
const labAt = (img: PixelImage, i: number): Lab => {
  const d = img.data
  const key = ((d[i] ?? 0) << 16) | ((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0)
  let l = labCache.get(key)
  if (!l) {
    l = srgbToLab(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0)
    labCache.set(key, l)
  }
  return l
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}
const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] as number
}
const medianLab = (ls: Lab[]): Lab => ({
  L: median(ls.map((l) => l.L)),
  a: median(ls.map((l) => l.a)),
  b: median(ls.map((l) => l.b)),
})

interface Pix {
  readonly corps: number[]
  readonly lisere: number[]
  readonly marque: number[]
  readonly all: number[]
}

// Index des pixels de chaque entité, par rôle.
export const pixelsById = (ids: PixelImage): Map<number, Pix> => {
  const out = new Map<number, Pix>()
  const d = ids.data
  for (let i = 0; i < d.length; i += 4) {
    const { id, role } = decodeId(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0)
    if (id === 0) continue
    let p = out.get(id)
    if (!p) {
      p = { corps: [], lisere: [], marque: [], all: [] }
      out.set(id, p)
    }
    p.all.push(i)
    if (role === ROLE.corps) p.corps.push(i)
    else if (role === ROLE.lisere) p.lisere.push(i)
    else if (role === ROLE.marque) p.marque.push(i)
  }
  return out
}

// Anneau de 3 à 12 px hors du masque d'une entité, pixels sol ou décalque seulement (B2.O3).
const ringOf = (ids: PixelImage, mask: number[]): number[] => {
  const w = ids.width
  const h = ids.height
  let x0 = w
  let y0 = h
  let x1 = 0
  let y1 = 0
  const set = new Set<number>()
  for (const i of mask) {
    const p = i >> 2
    const x = p % w
    const y = (p - x) / w
    set.add(p)
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  const R = 12
  const bx0 = Math.max(0, x0 - R)
  const by0 = Math.max(0, y0 - R)
  const bx1 = Math.min(w - 1, x1 + R)
  const by1 = Math.min(h - 1, y1 + R)
  const bw = bx1 - bx0 + 1
  const bh = by1 - by0 + 1
  const INF = 1e9
  const dist = new Float64Array(bw * bh).fill(INF)
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) if (set.has((y + by0) * w + x + bx0)) dist[y * bw + x] = 0
  const D = 1
  const DD = Math.SQRT2
  const at = (x: number, y: number) => dist[y * bw + x] as number
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let v = at(x, y)
      if (x > 0) v = Math.min(v, at(x - 1, y) + D)
      if (y > 0) v = Math.min(v, at(x, y - 1) + D)
      if (x > 0 && y > 0) v = Math.min(v, at(x - 1, y - 1) + DD)
      if (x < bw - 1 && y > 0) v = Math.min(v, at(x + 1, y - 1) + DD)
      dist[y * bw + x] = v
    }
  for (let y = bh - 1; y >= 0; y--)
    for (let x = bw - 1; x >= 0; x--) {
      let v = at(x, y)
      if (x < bw - 1) v = Math.min(v, at(x + 1, y) + D)
      if (y < bh - 1) v = Math.min(v, at(x, y + 1) + D)
      if (x < bw - 1 && y < bh - 1) v = Math.min(v, at(x + 1, y + 1) + DD)
      if (x > 0 && y < bh - 1) v = Math.min(v, at(x - 1, y + 1) + DD)
      dist[y * bw + x] = v
    }
  const out: number[] = []
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const dv = at(x, y)
      if (dv < 3 || dv > 12) continue
      const i = ((y + by0) * w + x + bx0) * 4
      const role = ids.data[i + 2]
      if (role === ROLE.sol || role === ROLE.decalque) out.push(i)
    }
  return out
}

export interface EntityReading {
  readonly id: number
  readonly cls: 'debout' | 'abattu' | 'resistant' | 'mort' | 'autre'
  readonly pixels: number
  readonly corps: number
  readonly lisere: number
  readonly marque: number
  readonly corpsCmedian: number // O1 vivant
  readonly allCmedian: number // O1 mort
  readonly Lmedian: number // luminance médiane de tous les pixels (réglage de la lumière)
  readonly allCp90: number
  readonly signal: Lab | null // O2
  readonly dRefs: { readonly ivoire: number; readonly or: number; readonly gris: number } | null
  readonly ivoirePx: number // O3, O4
  readonly orPx: number
  readonly ringDE: number | null // O3 mort contre le sol
  readonly ringPx: number
  readonly rimL: number // O6.3 : L* moyen du liseré
}

export interface FrameReading {
  readonly refs: { readonly ivoire: Lab | null; readonly or: Lab | null; readonly gris: Lab | null }
  readonly refGaps: { readonly ivoireOr: number; readonly ivoireGris: number; readonly orGris: number } | null
  readonly entities: readonly EntityReading[]
}

const clsOf = (w: World, id: number): EntityReading['cls'] => {
  const c = w.creatures.find((x) => x.id === id)
  if (!c) return 'autre'
  if (c.state.kind === 'mort') return 'mort'
  if (c.state.kind === 'abattu') return c.resistant ? 'resistant' : 'abattu'
  if (c.state.kind === 'absorbe') return 'autre'
  return 'debout'
}

// Références de B2 (§5) : médianes Lab sur un ensemble d'images (S1a, images 0 à 179, 1440 × 900).
export const referenceAccumulator = () => {
  const iv: number[][] = [[], [], []]
  const au: number[][] = [[], [], []]
  const gr: number[][] = [[], [], []]
  const push = (acc: number[][], l: Lab) => {
    acc[0]?.push(l.L)
    acc[1]?.push(l.a)
    acc[2]?.push(l.b)
  }
  const m = (acc: number[][]): Lab | null =>
    acc[0]?.length ? { L: median(acc[0]), a: median(acc[1] ?? []), b: median(acc[2] ?? []) } : null
  return {
    add(color: PixelImage, ids: PixelImage, world: World): void {
      for (const [id, p] of pixelsById(ids)) {
        const cls = clsOf(world, id)
        if (cls === 'abattu') for (const i of p.lisere) push(iv, labAt(color, i))
        if (cls === 'resistant') for (const i of [...p.lisere, ...p.marque]) push(au, labAt(color, i))
        if (cls === 'mort') for (const i of p.all) push(gr, labAt(color, i))
      }
    },
    result: (): FrameReading['refs'] => ({ ivoire: m(iv), or: m(au), gris: m(gr) }),
  }
}

// Synthèse sur une suite d'images lues avec les mêmes références : pire valeur de chaque observable par entité.
export const summarize = (readings: readonly FrameReading[]) => {
  const out = new Map<number, Record<string, number | string>>()
  for (const r of readings) {
    for (const e of r.entities) {
      if (e.cls === 'autre') continue
      const s = out.get(e.id) ?? { cls: e.cls, frames: 0 }
      const lo = (k: string, v: number) => {
        if (Number.isFinite(v)) s[k] = Math.min((s[k] as number | undefined) ?? Number.POSITIVE_INFINITY, v)
      }
      const hi = (k: string, v: number) => {
        if (Number.isFinite(v)) s[k] = Math.max((s[k] as number | undefined) ?? Number.NEGATIVE_INFINITY, v)
      }
      s.frames = (s.frames as number) + 1
      lo('pixelsMin', e.pixels)
      if (e.cls === 'mort') {
        hi('C_median_max', e.allCmedian)
        hi('C_p90_max', e.allCp90)
        hi('ivoirePx_max', e.ivoirePx)
        hi('orPx_max', e.orPx)
        if (e.ringDE !== null) lo('ringDE_min', e.ringDE)
      } else {
        lo('Ccorps_min', e.corpsCmedian)
      }
      if (e.cls === 'abattu') {
        lo('ivoirePx_min', e.ivoirePx)
        hi('orPx_max', e.orPx)
        lo('rimL_min', e.rimL)
        hi('rimL_max', e.rimL)
      }
      if (e.cls === 'resistant') {
        lo('orPx_min', e.orPx)
        lo('rimL_min', e.rimL)
        hi('rimL_max', e.rimL)
      }
      if (e.dRefs && e.cls !== 'debout') {
        const own = e.cls === 'abattu' ? e.dRefs.ivoire : e.cls === 'resistant' ? e.dRefs.or : e.dRefs.gris
        const others =
          e.cls === 'abattu'
            ? Math.min(e.dRefs.or, e.dRefs.gris)
            : e.cls === 'resistant'
              ? Math.min(e.dRefs.ivoire, e.dRefs.gris)
              : Math.min(e.dRefs.ivoire, e.dRefs.or)
        lo('classMargin_min', others - own - 5) // B2.O2 : ≥ 0
      }
      out.set(e.id, s)
    }
  }
  return Object.fromEntries(
    [...out].map(([id, s]) => [
      id,
      Object.fromEntries(
        Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]),
      ),
    ]),
  )
}

// Références calculées sur l'image elle-même, sauf si on les donne.
export const readFrame = (
  color: PixelImage,
  ids: PixelImage,
  world: World,
  given?: FrameReading['refs'],
): FrameReading => {
  const byId = pixelsById(ids)
  const labs = (xs: number[]) => xs.map((i) => labAt(color, i))
  const rimIv: Lab[] = []
  const rimOr: Lab[] = []
  const dead: Lab[] = []
  for (const [id, p] of byId) {
    const cls = clsOf(world, id)
    if (cls === 'abattu') rimIv.push(...labs(p.lisere))
    if (cls === 'resistant') rimOr.push(...labs([...p.lisere, ...p.marque]))
    if (cls === 'mort') dead.push(...labs(p.all))
  }
  const refs = given ?? {
    ivoire: rimIv.length ? medianLab(rimIv) : null,
    or: rimOr.length ? medianLab(rimOr) : null,
    gris: dead.length ? medianLab(dead) : null,
  }
  const entities: EntityReading[] = []
  for (const [id, p] of byId) {
    const cls = clsOf(world, id)
    const all = labs(p.all)
    const sig =
      cls === 'abattu' ? labs(p.lisere) : cls === 'resistant' ? labs([...p.lisere, ...p.marque]) : all
    const signal = sig.length ? medianLab(sig) : null
    const dRefs =
      signal && refs.ivoire && refs.or && refs.gris
        ? {
            ivoire: deltaE00(signal, refs.ivoire),
            or: deltaE00(signal, refs.or),
            gris: deltaE00(signal, refs.gris),
          }
        : null
    const count = (ls: Lab[], ref: Lab | null) => (ref ? ls.filter((l) => deltaE00(l, ref) <= 10).length : 0)
    const sigPx =
      cls === 'abattu' ? labs(p.lisere) : cls === 'resistant' ? labs([...p.lisere, ...p.marque]) : all
    let ringDE: number | null = null
    let ringPx = 0
    if (cls === 'mort') {
      const ring = labs(ringOf(ids, p.all))
      ringPx = ring.length
      if (ring.length >= 40) ringDE = deltaE00(medianLab(all), medianLab(ring))
    }
    const rim = labs(p.lisere)
    entities.push({
      id,
      cls,
      pixels: p.all.length,
      corps: p.corps.length,
      lisere: p.lisere.length,
      marque: p.marque.length,
      corpsCmedian: median(labs(p.corps).map(chroma)),
      allCmedian: median(all.map(chroma)),
      Lmedian: median(all.map((l) => l.L)),
      allCp90: pct(all.map(chroma), 0.9),
      signal,
      dRefs,
      ivoirePx: cls === 'mort' ? count(all, refs.ivoire) : count(sigPx, refs.ivoire),
      orPx: cls === 'abattu' || cls === 'mort' ? count(all, refs.or) : count(sigPx, refs.or),
      ringDE,
      ringPx,
      rimL: rim.length ? rim.reduce((s, l) => s + l.L, 0) / rim.length : Number.NaN,
    })
  }
  entities.sort((a, b) => a.id - b.id)
  const refGaps =
    refs.ivoire && refs.or && refs.gris
      ? {
          ivoireOr: deltaE00(refs.ivoire, refs.or),
          ivoireGris: deltaE00(refs.ivoire, refs.gris),
          orGris: deltaE00(refs.or, refs.gris),
        }
      : null
  return { refs, refGaps, entities }
}
