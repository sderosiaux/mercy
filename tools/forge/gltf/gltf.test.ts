import { describe, expect, it } from 'vitest'
import { encodePng } from '../image/png'
import { loadRig, sampleClip } from '../validate/rig'
import { buildFigure } from './build'
import { idle, strike, walkInPlace, walkWithRootMotion } from './fixtures'
import { type Glb, parseGlb, writeGlb } from './glb'
import { imageDimensions, stripTextures, textureSizes, triangleCount } from './inspect'
import { appendAnimation, retagAnimations, stripRootDrift } from './merge'

// Même fichier avec un nœud de plus en tête : tous les indices de nœuds changent, les noms restent.
const shiftNodes = (g: Glb): Glb => {
  const s = (i: number): number => i + 1
  const j = g.json
  return {
    bin: g.bin,
    json: {
      ...j,
      nodes: [
        { name: 'Extra' },
        ...(j.nodes ?? []).map((n) => (n.children ? { ...n, children: n.children.map(s) } : n)),
      ],
      scenes: j.scenes?.map((sc) => ({ ...sc, nodes: sc.nodes?.map(s) })),
      skins: j.skins?.map((sk) => ({
        ...sk,
        joints: sk.joints.map(s),
        ...(sk.skeleton === undefined ? {} : { skeleton: s(sk.skeleton) }),
      })),
      animations: j.animations?.map((a) => ({
        ...a,
        channels: a.channels.map((c) => ({
          ...c,
          target: { ...c.target, node: s(c.target.node as number) },
        })),
      })),
    },
  }
}

const solidPng = (w: number, h: number) =>
  encodePng({ width: w, height: h, channels: 3, data: new Uint8Array(w * h * 3).fill(90) })

describe('GLB', () => {
  it('s’écrit et se relit à l’identique', () => {
    const glb = buildFigure({ clips: [idle()] })
    const back = parseGlb(writeGlb(glb))
    expect(back.json).toEqual({ ...glb.json, buffers: [{ byteLength: glb.bin.byteLength }] })
    expect([...back.bin.subarray(0, glb.bin.byteLength)]).toEqual([...glb.bin])
  })

  it('refuse ce qui n’est pas un GLB', () => {
    expect(() =>
      parseGlb(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])),
    ).toThrow(/pas un GLB/)
  })
})

describe('mesures lues dans le fichier', () => {
  it('compte les triangles dessinés (15 pavés de 12 triangles, plus la bande ajoutée)', () => {
    expect(triangleCount(buildFigure({ clips: [] }))).toBe(180)
    expect(triangleCount(buildFigure({ clips: [], extraTriangles: 500 }))).toBe(680)
  })

  it('lit la taille des textures dans leurs en-têtes PNG, JPEG et WebP', () => {
    const glb = buildFigure({ clips: [], image: { mime: 'image/png', bytes: solidPng(64, 32) } })
    expect(textureSizes(glb).sizes).toEqual([
      { index: 0, name: 'albedo', mime: 'image/png', width: 64, height: 32 },
    ])
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x02, 0x00, 0x04, 0x00, 3, 0, 0,
    ])
    expect(imageDimensions(jpeg)).toEqual({ width: 1024, height: 512, mime: 'image/jpeg' })
    const webp = new Uint8Array(30)
    webp.set(
      [...'RIFF'].map((c) => c.charCodeAt(0)),
      0,
    )
    webp.set(
      [...'WEBPVP8X'].map((c) => c.charCodeAt(0)),
      8,
    )
    webp.set([0xff, 0x07, 0x00, 0xff, 0x03, 0x00], 24) // 2048 × 1024 (moins un, sur 24 bits)
    expect(imageDimensions(webp)).toEqual({ width: 2048, height: 1024, mime: 'image/webp' })
  })

  it('retire les textures pour la mesure sous Node sans toucher au squelette ni aux clips', () => {
    const glb = buildFigure({ clips: [idle()], image: { mime: 'image/png', bytes: solidPng(8, 8) } })
    const s = stripTextures(glb)
    expect(s.json.images).toBeUndefined()
    expect(s.json.textures).toBeUndefined()
    expect(s.json.skins).toEqual(glb.json.skins)
    expect(s.json.animations).toEqual(glb.json.animations)
  })
})

describe('assemblage des clips', () => {
  it('ajoute un clip venu d’un autre fichier en rattachant ses canaux aux os par leur nom', async () => {
    const base = retagAnimations(buildFigure({ clips: [idle('Idle')] }), (name) =>
      name === 'Idle'
        ? { name: 'rituel', extras: { mercy: { etat: 'rituel', type: 'boucle', boucle: true } } }
        : null,
    )
    // Fichier source : même squelette, nœuds dans un autre ordre (un os de plus en tête).
    const src = buildFigure({ clips: [strike('Armature|clip0')] })
    const shifted = shiftNodes(src)
    expect(shifted.json.animations?.[0]?.channels[0]?.target.node).not.toBe(
      src.json.animations?.[0]?.channels[0]?.target.node,
    )
    const merged = appendAnimation(base, shifted, 0, {
      name: 'attaque',
      extras: { mercy: { etat: 'attaque', type: 'attaque', boucle: false, impactS: 0.55 } },
    })
    expect(merged.json.animations?.map((a) => a.name)).toEqual(['rituel', 'attaque'])
    const rig = await loadRig(merged, { hauteurM: null, stripTextures: true })
    const clip = rig.clips.find((c) => c.name === 'attaque')
    expect(clip?.userData.mercy).toEqual({ etat: 'attaque', type: 'attaque', boucle: false, impactS: 0.55 })
    // Même pose que le clip d'origine joué sur son propre fichier.
    const ref = await loadRig(src, { hauteurM: null, stripTextures: true })
    const a = sampleClip(rig, clip as never, [0.55])[0]
    const b = sampleClip(ref, ref.clips[0] as never, [0.55])[0]
    expect([...(a ?? [])].map((x) => x.toFixed(5))).toEqual([...(b ?? [])].map((x) => x.toFixed(5)))
  })

  it('refuse un canal qui vise un os absent du squelette de base', () => {
    const base = buildFigure({ clips: [] })
    const src = buildFigure({ clips: [strike('x')], boneNames: { upperArmR: 'mixamorig:RightArm' } })
    expect(() => appendAnimation(base, src, 0, { name: 'x', extras: {} })).toThrow(
      /mixamorig:RightArm absent/,
    )
  })

  it('retire la dérive du bassin et garde le reste du mouvement', async () => {
    const glb = buildFigure({ clips: [walkWithRootMotion('marche', 1.2), walkInPlace('ref')] })
    const before = await loadRig(glb, { hauteurM: null, stripTextures: true })
    const hips = before.bones.findIndex((b) => b.name === 'Hips')
    const drift = (rig: typeof before, name: string) => {
      const c = rig.clips.find((x) => x.name === name)
      const [p0, p1] = sampleClip(rig, c as never, [0, c?.duration ?? 0])
      return (p1?.[hips * 3 + 2] ?? 0) - (p0?.[hips * 3 + 2] ?? 0)
    }
    expect(drift(before, 'marche')).toBeCloseTo(1.2, 3)
    const after = await loadRig(stripRootDrift(glb, 'marche'), { hauteurM: null, stripTextures: true })
    expect(drift(after, 'marche')).toBeCloseTo(0, 5)
    const legs = (rig: typeof before, name: string) => {
      const c = rig.clips.find((x) => x.name === name)
      const knee = rig.bones.findIndex((b) => b.name === 'LeftLeg')
      const p = sampleClip(rig, c as never, [0.25])[0]
      return (p?.[knee * 3 + 1] ?? 0).toFixed(5)
    }
    expect(legs(after, 'marche')).toBe(legs(after, 'ref'))
  })
})
