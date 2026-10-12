// Assemblage des clips : le fichier de base (personnage riggé et ses clips de bibliothèque) reçoit les clips
// d'autres fichiers produits sur le même squelette (Text to Motion appliqué). Les canaux sont rattachés aux nœuds
// par leur nom ; un os absent de la base est une erreur, jamais un canal perdu en silence.
import { accessorBytes, appendBytes, type Glb, type GltfAnimation } from './glb'

export interface ClipTag {
  readonly name: string
  readonly extras: Readonly<Record<string, unknown>>
}

const nodeIndexByName = (glb: Glb): Map<string, number> => {
  const out = new Map<string, number>()
  const dup = new Set<string>()
  ;(glb.json.nodes ?? []).forEach((n, i) => {
    if (!n.name) return
    if (out.has(n.name)) dup.add(n.name)
    out.set(n.name, i)
  })
  for (const d of dup) out.delete(d)
  return out
}

export const appendAnimation = (base: Glb, src: Glb, srcIndex: number, tag: ClipTag): Glb => {
  const anim = src.json.animations?.[srcIndex]
  if (!anim) throw new Error(`clip ${srcIndex} absent du fichier source`)
  const byName = nodeIndexByName(base)
  let out = base
  const accessors = [...(base.json.accessors ?? [])]
  const copied = new Map<number, number>()
  const copy = (srcAccessor: number): number => {
    const known = copied.get(srcAccessor)
    if (known !== undefined) return known
    const acc = src.json.accessors?.[srcAccessor]
    if (!acc) throw new Error(`accesseur ${srcAccessor} absent du fichier source`)
    const appended = appendBytes(out, accessorBytes(src, srcAccessor))
    out = appended.glb
    const { byteOffset: _o, bufferView: _v, ...rest } = acc
    accessors.push({ ...rest, bufferView: appended.view })
    copied.set(srcAccessor, accessors.length - 1)
    return accessors.length - 1
  }
  const samplers = anim.samplers.map((s) => ({ ...s, input: copy(s.input), output: copy(s.output) }))
  const channels = anim.channels.map((c) => {
    if (c.target.node === undefined) throw new Error('canal sans nœud cible')
    const name = src.json.nodes?.[c.target.node]?.name
    const target = name === undefined ? undefined : byName.get(name)
    if (target === undefined)
      throw new Error(`os ${name ?? `#${c.target.node}`} absent (ou ambigu) dans le squelette de base`)
    return { ...c, target: { ...c.target, node: target } }
  })
  const animation: GltfAnimation = { name: tag.name, channels, samplers, extras: { ...tag.extras } }
  return {
    json: { ...out.json, accessors, animations: [...(out.json.animations ?? []), animation] },
    bin: out.bin,
  }
}

const nameTokens = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

// Nœud du bassin : un os nommé hips/pelvis, sinon la racine du squelette.
export const hipsNode = (glb: Glb): number | null => {
  const skin = glb.json.skins?.[0]
  if (!skin) return null
  const named = skin.joints.find((j) => {
    const t = nameTokens(glb.json.nodes?.[j]?.name ?? '')
    return t.includes('hips') || t.includes('pelvis')
  })
  return named ?? skin.skeleton ?? skin.joints[0] ?? null
}

const floats = (glb: Glb, accessor: number): Float32Array => {
  const acc = glb.json.accessors?.[accessor]
  if (acc?.componentType !== 5126) throw new Error(`accesseur ${accessor} : flottants attendus`)
  const bytes = accessorBytes(glb, accessor)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

// Retire la dérive horizontale (x, z) du bassin dans un clip : x'(t) = x(t) − (x(fin) − x(début)) · t / durée.
// Le balancement est gardé ; seul l'avancement, que la simulation fait déjà, disparaît.
export const stripRootDrift = (base: Glb, animName: string): Glb => {
  const animIndex = (base.json.animations ?? []).findIndex((a) => a.name === animName)
  const anim = base.json.animations?.[animIndex]
  const hips = hipsNode(base)
  if (!anim || hips === null) throw new Error(`dérive : clip ${animName} ou bassin introuvable`)
  let out = base
  const accessors = [...(base.json.accessors ?? [])]
  const samplers = anim.samplers.map((s) => ({ ...s }))
  for (const ch of anim.channels) {
    if (ch.target.node !== hips || ch.target.path !== 'translation') continue
    const s = samplers[ch.sampler]
    if (!s) continue
    const times = floats(out, s.input)
    const values = Float32Array.from(floats(out, s.output))
    const n = times.length
    const t0 = times[0] as number
    const span = (times[n - 1] as number) - t0
    if (n < 2 || span <= 0) continue
    const dx = (values[(n - 1) * 3] as number) - (values[0] as number)
    const dz = (values[(n - 1) * 3 + 2] as number) - (values[2] as number)
    for (let i = 0; i < n; i++) {
      const u = ((times[i] as number) - t0) / span
      values[i * 3] = (values[i * 3] as number) - dx * u
      values[i * 3 + 2] = (values[i * 3 + 2] as number) - dz * u
    }
    const appended = appendBytes(out, new Uint8Array(values.buffer))
    out = appended.glb
    const src = accessors[s.output]
    if (!src) continue
    const { byteOffset: _o, min: _min, max: _max, ...rest } = src
    accessors.push({ ...rest, bufferView: appended.view })
    s.output = accessors.length - 1
  }
  const animations = (out.json.animations ?? []).map((a, i) => (i === animIndex ? { ...a, samplers } : a))
  return { json: { ...out.json, accessors, animations }, bin: out.bin }
}

// Renomme et étiquette les clips de la base ; un clip sans étiquette (null) est retiré.
export const retagAnimations = (base: Glb, tagOf: (name: string, index: number) => ClipTag | null): Glb => {
  const animations: GltfAnimation[] = []
  ;(base.json.animations ?? []).forEach((a, i) => {
    const tag = tagOf(a.name ?? '', i)
    if (tag) animations.push({ ...a, name: tag.name, extras: { ...(a.extras ?? {}), ...tag.extras } })
  })
  return { json: { ...base.json, animations }, bin: base.bin }
}
