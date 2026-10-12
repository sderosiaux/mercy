// Un clip vu comme une suite d'images à 60 i/s (la cadence de la simulation et de la validation) : valeurs
// locales (translation, rotation, échelle) de chaque nœud animé, lues par three exactement comme le jeu et la
// validation les liront. Les post-traitements transforment ces images ; l'écriture les remet dans le GLB en
// clés linéaires, une par image. Les clips sources ne sont jamais modifiés en place : chaque étape rend une copie.
import { AnimationMixer, LoopOnce, type Object3D } from 'three'
import { appendBytes, type Glb, type GltfAnimation } from '../gltf/glb'
import { FRAME_S, SIM_FPS } from '../playback'
import { type Pose, type Rig, readPose } from '../validate/rig'

export interface NodeTrack {
  readonly node: number // indice du nœud glTF
  readonly object: Object3D
  readonly t: Float64Array | null // 3 valeurs par image
  readonly r: Float64Array | null // 4 valeurs par image (x, y, z, w)
  readonly s: Float64Array | null // 3 valeurs par image
}

export interface ClipFrames {
  readonly index: number // indice de l'animation dans le GLB
  readonly name: string
  readonly times: Float64Array // 0, 1/60, 2/60… ; la dernière est la durée du clip
  readonly tracks: readonly NodeTrack[]
}

export const frameCount = (f: ClipFrames): number => f.times.length

// Instants d'un clip de `duration` s à 60 i/s. Une durée qui tombe sur la grille (à 1 ms près, cas des clips à
// 30 ou 60 i/s) finit sur la grille : deux clés à quelques nanosecondes d'écart seraient confondues en float32.
export const gridTimes = (duration: number): Float64Array => {
  const n = Math.round(duration * SIM_FPS)
  if (Math.abs(n * FRAME_S - duration) < 1e-3)
    return Float64Array.from({ length: n + 1 }, (_, k) => k * FRAME_S)
  const out: number[] = []
  for (let k = 0; k * FRAME_S < duration - 1e-6; k++) out.push(k * FRAME_S)
  out.push(duration)
  return Float64Array.from(out)
}

type Path = 'translation' | 'rotation' | 'scale'
const KEY: Readonly<Record<Path, 't' | 'r' | 's'>> = { translation: 't', rotation: 'r', scale: 's' }
const WIDTH: Readonly<Record<Path, number>> = { translation: 3, rotation: 4, scale: 3 }

// Valeurs de repos (celles du fichier) de chaque nœud de la scène : un nœud qu'un clip n'anime pas y revient.
const restOf = new WeakMap<Rig, Map<Object3D, number[]>>()
const rest = (rig: Rig): Map<Object3D, number[]> => {
  let m = restOf.get(rig)
  if (!m) {
    m = new Map()
    for (const o of rig.nodes.values())
      m.set(o, [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()])
    restOf.set(rig, m)
  }
  return m
}

const resetRest = (rig: Rig): void => {
  for (const [o, v] of rest(rig)) {
    o.position.fromArray(v, 0)
    o.quaternion.fromArray(v, 3)
    o.scale.fromArray(v, 7)
  }
}

// Lit un clip du GLB à 60 i/s. Les canaux visent des nœuds par indice ; three les a rattachés aux mêmes objets.
export const sampleFrames = (rig: Rig, glb: Glb, index: number): ClipFrames => {
  rest(rig) // mémorise le repos avant toute lecture
  const anim = glb.json.animations?.[index]
  if (!anim) throw new Error(`animation ${index} absente`)
  const clip = rig.clips[index]
  if (!clip || clip.name !== anim.name) throw new Error(`clip ${anim.name} : ordre des animations inattendu`)
  const paths = new Map<number, Set<Path>>()
  for (const c of anim.channels) {
    if (c.target.node === undefined) continue
    const p = c.target.path as Path
    if (!(p in KEY))
      throw new Error(`${anim.name} : canal ${c.target.path} non géré par les post-traitements`)
    const set = paths.get(c.target.node) ?? new Set<Path>()
    set.add(p)
    paths.set(c.target.node, set)
  }
  const times = gridTimes(clip.duration)
  const n = times.length
  const tracks: NodeTrack[] = [...paths].map(([node, set]) => {
    const object = rig.nodes.get(node)
    if (!object) throw new Error(`${anim.name} : nœud ${node} absent de la scène`)
    return {
      node,
      object,
      t: set.has('translation') ? new Float64Array(3 * n) : null,
      r: set.has('rotation') ? new Float64Array(4 * n) : null,
      s: set.has('scale') ? new Float64Array(3 * n) : null,
    }
  })
  resetRest(rig)
  const mixer = new AnimationMixer(rig.root)
  const action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  times.forEach((t, k) => {
    action.reset()
    mixer.setTime(t)
    for (const tr of tracks) {
      tr.t?.set(tr.object.position.toArray(), 3 * k)
      tr.r?.set(tr.object.quaternion.toArray(), 4 * k)
      tr.s?.set(tr.object.scale.toArray(), 3 * k)
    }
  })
  mixer.stopAllAction()
  mixer.uncacheRoot(rig.root)
  resetRest(rig)
  for (const tr of tracks) if (tr.r) hemisphere(tr.r)
  return { index, name: anim.name ?? '', times, tracks }
}

// q et −q sont la même rotation : on garde chaque clé dans l'hémisphère de la précédente, pour que les fondus et
// les écarts calculés entre images prennent le chemin court.
const hemisphere = (r: Float64Array): void => {
  for (let i = 4; i < r.length; i += 4) {
    let dot = 0
    for (let c = 0; c < 4; c++) dot += (r[i + c] as number) * (r[i - 4 + c] as number)
    if (dot < 0) for (let c = 0; c < 4; c++) r[i + c] = -(r[i + c] as number)
  }
}

// Pose la scène sur l'image k (valeurs locales ; repos pour les nœuds que le clip n'anime pas), sans mettre à
// jour les matrices.
export const setFrame = (rig: Rig, f: ClipFrames, k: number): void => {
  resetRest(rig)
  for (const tr of f.tracks) {
    if (tr.t) tr.object.position.fromArray(tr.t, 3 * k)
    if (tr.r) tr.object.quaternion.fromArray(tr.r, 4 * k)
    if (tr.s) tr.object.scale.fromArray(tr.s, 3 * k)
  }
}

// Poses de toutes les images (positions des os en mètres de jeu), comme la validation les mesure.
export const posesOf = (rig: Rig, f: ClipFrames): Pose[] => {
  resetRest(rig)
  const out: Pose[] = []
  for (let k = 0; k < f.times.length; k++) {
    setFrame(rig, f, k)
    out.push(readPose(rig))
  }
  resetRest(rig)
  rig.root.updateMatrixWorld(true)
  return out
}

// Copie profonde : un post-traitement rend toujours de nouvelles images.
export const cloneFrames = (f: ClipFrames, times: Float64Array = f.times.slice()): ClipFrames => ({
  ...f,
  times,
  tracks: f.tracks.map((tr) => ({
    ...tr,
    t: tr.t ? tr.t.slice() : null,
    r: tr.r ? tr.r.slice() : null,
    s: tr.s ? tr.s.slice() : null,
  })),
})

// Piste de rotation d'un nœud, créée depuis son repos si le clip ne l'animait pas.
export const rotationTrack = (
  rig: Rig,
  f: ClipFrames,
  object: Object3D,
): { f: ClipFrames; r: Float64Array } => {
  const found = f.tracks.find((tr) => tr.object === object)
  if (found?.r) return { f, r: found.r }
  const n = f.times.length
  const r = new Float64Array(4 * n)
  const q = rest(rig).get(object)?.slice(3, 7) ?? [0, 0, 0, 1]
  for (let k = 0; k < n; k++) r.set(q, 4 * k)
  const node = [...rig.nodes].find(([, o]) => o === object)?.[0]
  if (node === undefined) throw new Error(`os ${object.name} sans nœud glTF`)
  const tracks = found
    ? f.tracks.map((tr) => (tr === found ? { ...tr, r } : tr))
    : [...f.tracks, { node, object, t: null, r, s: null }]
  return { f: { ...f, tracks }, r }
}

// Réécrit l'animation `f.index` du GLB : une entrée de temps commune, une clé linéaire par image. Un canal
// constant garde deux clés (début, fin). Nom et étiquette (extras.mercy) sont conservés.
export const writeFrames = (glb: Glb, f: ClipFrames): Glb => {
  const anim = glb.json.animations?.[f.index]
  if (!anim) throw new Error(`animation ${f.index} absente`)
  let out = glb
  const accessors = [...(glb.json.accessors ?? [])]
  const push = (data: Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4', minMax: boolean): number => {
    const appended = appendBytes(out, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    out = appended.glb
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    accessors.push({
      bufferView: appended.view,
      componentType: 5126,
      count: data.length / n,
      type,
      ...(minMax ? { min: [data[0] as number], max: [data[data.length - 1] as number] } : {}),
    })
    return accessors.length - 1
  }
  const n = f.times.length
  const full = push(Float32Array.from(f.times), 'SCALAR', true)
  let ends: number | null = null
  const samplers: GltfAnimation['samplers'] = []
  const channels: GltfAnimation['channels'] = []
  for (const tr of f.tracks) {
    for (const path of ['translation', 'rotation', 'scale'] as const) {
      const values = tr[KEY[path]]
      if (!values) continue
      const w = WIDTH[path]
      const v32 = Float32Array.from(values)
      let constant = true
      for (let i = w; i < v32.length && constant; i++) if (v32[i] !== v32[i % w]) constant = false
      let input = full
      let output: Float32Array = v32
      if (constant && n > 2) {
        ends ??= push(Float32Array.from([f.times[0] as number, f.times[n - 1] as number]), 'SCALAR', true)
        input = ends
        output = Float32Array.from([...v32.subarray(0, w), ...v32.subarray(0, w)])
      }
      samplers.push({
        input,
        output: push(output, w === 4 ? 'VEC4' : 'VEC3', false),
        interpolation: 'LINEAR',
      })
      channels.push({ sampler: samplers.length - 1, target: { node: tr.node, path } })
    }
  }
  const replaced: GltfAnimation = { ...anim, samplers, channels }
  const animations = (out.json.animations ?? []).map((a, i) => (i === f.index ? replaced : a))
  return { json: { ...out.json, accessors, animations }, bin: out.bin }
}
