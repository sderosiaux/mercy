// Chargement des modèles de la Forge, en arrière-plan : manifeste, GLB, préparation (racine des clips neutralisée,
// boîtes des os, normales de contour, régions du corps, version allégée des morts, texture réduite en qualité basse).
// Le rendu reste synchrone : un personnage s'affiche en segments (E1) tant que son modèle n'est pas prêt.
import {
  type AnimationClip,
  type Bone,
  Box3,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  SRGBColorSpace,
  type Texture,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Catalog, ClipInfo } from '../anim/machine'
import { type ManifestEntry, parseManifest, playable } from '../anim/manifest'
import { headingOf, neutralizeRoot, rootClassOf } from '../anim/root'
import { type BoneBox, boneBoxes, dominantBones, lodGeometry, outlineNormals } from './geometry'
import { type BodyRegions, bodyRegions } from './regions'

export interface ModelAsset {
  readonly id: string
  readonly entry: ManifestEntry
  readonly template: Object3D
  readonly meshName: string
  readonly clips: ReadonlyMap<string, AnimationClip>
  readonly catalog: Catalog
  readonly scale: number // facteur qui donne la hauteur du manifeste
  readonly anchor: Vector3 // décalage (unités de la scène du GLB) : bassin au repos sur la position, pieds au sol
  readonly boneNames: readonly string[]
  readonly boxes: readonly BoneBox[]
  readonly lod: BufferGeometry // morts : version allégée, avec poids de peau (pose figée calculée sur le CPU)
  readonly lodShadow: BufferGeometry // ombre des morts : version plus grossière encore
  readonly map: Texture | null
  readonly meanLum: number // luminance moyenne (linéaire) de l'albédo
  readonly roughness: number
  readonly regions: BodyRegions
  readonly triangles: number
  readonly loadMs: number
  readonly bytes: number
}

export interface LoadReport {
  readonly id: string
  readonly ok: boolean
  readonly ms: number
  readonly bytes: number
  readonly error?: string
}

// Morts : un quart des triangles du modèle, entre 2 500 et 4 000 par corps (forme, E2 : 250 morts tiennent dans le
// budget du §24 ; en dessous, le regroupement de sommets troue les modèles les plus détaillés).
export const lodTriangles = (source: number): number => Math.min(4000, Math.max(2500, Math.round(source / 4)))
// Ombre portée d'un mort : environ 600 triangles (quatre passes d'ombre en haute qualité).
export const LOD_SHADOW_TRIANGLES = 600
// Qualité basse : textures des modèles réduites à 1024 px de côté au plus.
export const LOW_TEXTURE_PX = 1024

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

// Image d'une texture (ImageBitmap ou image HTML) réduite sur un canvas ; luminance moyenne au passage.
const reduce = (tex: Texture, maxPx: number | null): { map: Texture; meanLum: number } => {
  const img = tex.image as { width: number; height: number } & CanvasImageSource
  const probe = document.createElement('canvas')
  probe.width = 64
  probe.height = 64
  const pctx = probe.getContext('2d', { willReadFrequently: true })
  let meanLum = 0.18
  if (pctx) {
    pctx.drawImage(img, 0, 0, 64, 64)
    const d = pctx.getImageData(0, 0, 64, 64).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) {
      s +=
        0.2126 * srgbToLinear((d[i] ?? 0) / 255) +
        0.7152 * srgbToLinear((d[i + 1] ?? 0) / 255) +
        0.0722 * srgbToLinear((d[i + 2] ?? 0) / 255)
    }
    meanLum = s / (d.length / 4)
  }
  if (maxPx === null || Math.max(img.width, img.height) <= maxPx) return { map: tex, meanLum }
  const k = maxPx / Math.max(img.width, img.height)
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
  const small = new CanvasTexture(c)
  small.flipY = tex.flipY
  small.colorSpace = SRGBColorSpace
  small.wrapS = tex.wrapS
  small.wrapT = tex.wrapT
  small.anisotropy = 4
  tex.dispose()
  return { map: small, meanLum }
}

// Clips de chute : la chute d'un Abattu et la mort debout (E7, agonie), dont on lit l'instant où le corps touche
// le sol.
const FALLS = new Set(['chute', 'mort.debout'])

const catalogOf = (
  entry: ManifestEntry,
  clips: ReadonlyMap<string, AnimationClip>,
  hips: string,
): Catalog => {
  const out = new Map<string, ClipInfo>()
  for (const r of entry.clips) {
    const clip = clips.get(r.name)
    if (!clip) continue
    const track = clip.tracks.find((t) => t.name === `${hips}.position`)
    if (!FALLS.has(r.name) || !track) {
      out.set(r.name, { recipe: r, duration: clip.duration })
      continue
    }
    out.set(r.name, {
      recipe: r,
      duration: clip.duration,
      settleS: settleTime(track.times, track.values),
      descentS: descentTime(track.times, track.values),
    })
  }
  return out
}

// Instant où le bassin a fait 5 % de sa descente (le corps commence à tomber), d'après la même piste.
export const descentTime = (times: ArrayLike<number>, values: ArrayLike<number>): number => {
  const n = times.length
  if (n === 0) return 0
  const y0 = values[1] as number
  const y1 = values[(n - 1) * 3 + 1] as number
  const tol = Math.abs(y0 - y1) * 0.05
  for (let k = 0; k < n; k++)
    if (Math.abs((values[k * 3 + 1] as number) - y0) > tol) return times[k] as number
  return 0
}

// Instant où le bassin a fait 95 % de sa descente (fin de la chute au sol), d'après la piste de position du bassin.
export const settleTime = (times: ArrayLike<number>, values: ArrayLike<number>): number => {
  const n = times.length
  if (n === 0) return 0
  const y0 = values[1] as number
  const y1 = values[(n - 1) * 3 + 1] as number
  const tol = Math.abs(y0 - y1) * 0.05
  for (let k = 0; k < n; k++)
    if (Math.abs((values[k * 3 + 1] as number) - y1) <= tol) return times[k] as number
  return times[n - 1] as number
}

// Racine neutralisée (requête F2-1) sur les pistes du bassin de chaque clip.
const neutralize = (clip: AnimationClip, hips: Bone): AnimationClip => {
  const posName = `${hips.name}.position`
  const rotName = `${hips.name}.quaternion`
  const pt = clip.tracks.find((t) => t.name === posName)
  const qt = clip.tracks.find((t) => t.name === rotName)
  const fix = neutralizeRoot({
    cls: rootClassOf(clip.name),
    duration: clip.duration,
    bindX: hips.position.x,
    bindZ: hips.position.z,
    bindHeading: headingOf(hips.quaternion.y, hips.quaternion.w),
    positionTimes: pt?.times ?? null,
    positionValues: pt?.values ?? null,
    quaternionTimes: qt?.times ?? null,
    quaternionValues: qt?.values ?? null,
  })
  const tracks = clip.tracks.map((t) => {
    if (t === pt && fix.positions)
      return new VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(fix.positions))
    if (t === qt && fix.quaternions)
      return new QuaternionKeyframeTrack(t.name, Array.from(t.times), Array.from(fix.quaternions))
    return t
  })
  const out = clip.clone()
  out.tracks = tracks
  return out
}

const prepare = (
  id: string,
  entry: ManifestEntry & { hauteurM: number },
  gltf: { scene: Object3D; animations: AnimationClip[] },
  lowTextures: boolean,
  t0: number,
  bytes: number,
): ModelAsset => {
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  let mesh: SkinnedMesh | null = null
  scene.traverse((o) => {
    if (!mesh && o instanceof SkinnedMesh) mesh = o
  })
  if (!mesh) throw new Error(`${id} : aucun maillage à squelette`)
  const skinned = mesh as SkinnedMesh
  const geometry = skinned.geometry
  for (const [name, a] of Object.entries(geometry.attributes))
    if (!(a instanceof BufferAttribute))
      throw new Error(`${id} : attribut ${name} entrelacé, non pris en charge`)
  const bones = skinned.skeleton.bones
  const hips = bones.find((b) => b.name === 'Hips') ?? bones[0]
  if (!hips) throw new Error(`${id} : squelette vide`)
  const clips = new Map<string, AnimationClip>()
  for (const c of gltf.animations) clips.set(c.name, neutralize(c, hips))
  // Hauteur et ancrage : pose de repos, celle du GLB chargé (skeleton.pose() ignorerait l'échelle de l'Armature).
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene, true)
  const height = Math.max(1e-3, box.max.y - box.min.y)
  const scale = entry.hauteurM / height
  const hipsW = hips.getWorldPosition(new Vector3())
  const anchor = new Vector3(-hipsW.x, -box.min.y, -hipsW.z)
  // Attributs du corps.
  const dominant = dominantBones(geometry)
  geometry.setAttribute('aOutline', new BufferAttribute(outlineNormals(geometry), 3))
  // Positions au repos en mètres (peau appliquée), repère du modèle.
  const posAttr = geometry.getAttribute('position')
  const world = new Float32Array(posAttr.count * 3)
  const v = new Vector3()
  for (let i = 0; i < posAttr.count; i++) {
    skinned.getVertexPosition(i, v)
    v.applyMatrix4(skinned.matrixWorld)
    world[i * 3] = v.x
    world[i * 3 + 1] = v.y
    world[i * 3 + 2] = v.z
  }
  const joints = new Map(bones.map((b) => [b.name, b.getWorldPosition(new Vector3())]))
  const regions = bodyRegions(
    id,
    world,
    posAttr.array,
    dominant,
    bones.map((b) => b.name),
    joints,
  )
  geometry.setAttribute('aPart', new BufferAttribute(regions.part, 1))
  geometry.setAttribute('aMark', new BufferAttribute(regions.mark, 1))
  geometry.setAttribute('aSeams', new BufferAttribute(regions.seams, 3))
  // Positions au repos en mètres, pieds au sol, bassin sur l'axe (E7) : le sang se pose sur le corps par un bruit dans
  // ce repère (taches collées au corps, déterministes).
  const rest = new Float32Array(world.length)
  for (let i = 0; i < posAttr.count; i++) {
    rest[i * 3] = ((world[i * 3] as number) + anchor.x) * scale
    rest[i * 3 + 1] = ((world[i * 3 + 1] as number) + anchor.y) * scale
    rest[i * 3 + 2] = ((world[i * 3 + 2] as number) + anchor.z) * scale
  }
  geometry.setAttribute('aRest', new BufferAttribute(rest, 3))
  const boxes = boneBoxes(geometry, dominant, skinned.bindMatrix, skinned.skeleton.boneInverses)
  const sourceTris = (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3
  const lod = lodGeometry(geometry, lodTriangles(sourceTris))
  const lodShadow = lodGeometry(geometry, LOD_SHADOW_TRIANGLES)
  const src = skinned.material as Material | Material[]
  const mat = (Array.isArray(src) ? src[0] : src) as MeshStandardMaterial
  let map: Texture | null = mat.map ?? null
  let meanLum = 0.18
  if (map) {
    const r = reduce(map, lowTextures ? LOW_TEXTURE_PX : null)
    map = r.map
    meanLum = r.meanLum
  }
  const index = geometry.getIndex()
  return {
    id,
    entry,
    template: scene,
    meshName: skinned.name,
    clips,
    catalog: catalogOf(entry, clips, hips.name),
    scale,
    anchor,
    boneNames: bones.map((b) => b.name),
    boxes,
    lod,
    lodShadow,
    map,
    meanLum,
    roughness: mat.roughness ?? 0.55,
    regions,
    triangles: index ? index.count / 3 : geometry.getAttribute('position').count / 3,
    loadMs: performance.now() - t0,
    bytes,
  }
}

export interface ModelLoad {
  readonly assets: Map<string, ModelAsset>
  readonly reports: LoadReport[]
  readonly missing: string[] // personnages du manifeste sans GLB jouable
  readonly done: Promise<void>
  readonly enabled: boolean
  manifestError: string | null
  startedAt: number
  finishedAt: number | null
}

// Charge le manifeste puis chaque modèle jouable ; `onAsset` est appelé dès qu'un modèle est prêt.
export const loadModels = (
  base: string,
  lowTextures: boolean,
  onAsset: (a: ModelAsset) => void,
  enabled = true, // faux : aucun modèle (segments du jalon 1 partout, comparaisons avant / après)
  skip: readonly string[] = [],
): ModelLoad => {
  const state: ModelLoad = {
    assets: new Map(),
    reports: [],
    missing: [],
    done: Promise.resolve(),
    enabled,
    manifestError: null,
    startedAt: performance.now(),
    finishedAt: null,
  }
  const loader = new GLTFLoader()
  const run = async (): Promise<void> => {
    if (!enabled) {
      state.finishedAt = performance.now()
      return
    }
    let raw: unknown
    try {
      const res = await fetch(`${base}models/manifest.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      raw = await res.json()
    } catch (e) {
      state.manifestError = String(e)
      return
    }
    const { manifest, rejected } = parseManifest(raw)
    state.missing.push(...rejected)
    const jobs = Object.entries(manifest.assets).map(async ([id, entry]) => {
      // Instrument : `sansmodele=porteur,bourreau` fait comme si ces entrées manquaient (repli sur les segments).
      if (!playable(entry) || skip.includes(id)) {
        state.missing.push(id)
        return
      }
      const t0 = performance.now()
      try {
        const url = `${base}${entry.glb}`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = await res.arrayBuffer()
        const gltf = await loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1))
        const asset = prepare(id, entry, gltf, lowTextures, t0, buf.byteLength)
        state.assets.set(id, asset)
        state.reports.push({ id, ok: true, ms: asset.loadMs, bytes: buf.byteLength })
        onAsset(asset)
      } catch (e) {
        state.reports.push({ id, ok: false, ms: performance.now() - t0, bytes: 0, error: String(e) })
      }
    })
    await Promise.all(jobs)
    state.finishedAt = performance.now()
  }
  ;(state as { done: Promise<void> }).done = run()
  return state
}
