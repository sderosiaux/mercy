// B2 §12 I1 et arbitrage E4 : la passe d'identification montre ce que montre l'image. Chaque objet de la couche des
// signaux y est dessiné avec le même test de profondeur que dans la passe couleur : état matériel (profondeur de la
// couche, gabarit, faces) et test contre la profondeur de la scène (même fonction GLSL, même tolérance). Un télégraphe
// dessiné par-dessus un mort à l'écran l'est aussi dans la passe d'identification. Depuis E8, les morts sont dans la
// scène : ni leur matière couleur ni leur matière d'identification ne se testent contre la profondeur de la scène.
import {
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  ShaderLib,
  ShaderMaterial,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import { type Action, type Creature, FAMILIES, type World } from '../sim/index'
import { scene, withCreature } from '../sim/testing'
import { BodyLayer } from './bodies'
import { idMaterialFor } from './idpass'
import { makeRim } from './models/layer'
import {
  deadIdMaterial,
  deadMaterial,
  idMaterial,
  markMaterial,
  modelUniforms,
  setStencil,
} from './models/materials'
import { creatureBody, MATTERS, type Matter, type RigContext } from './rig'

// Fragment réellement compilé : source de la matière, puis ses retouches (onBeforeCompile).
const BASE: Record<string, keyof typeof ShaderLib> = {
  MeshBasicMaterial: 'basic',
  MeshStandardMaterial: 'standard',
}
const fragmentOf = (m: Material): string => {
  const lib = BASE[m.type]
  const src =
    m instanceof ShaderMaterial
      ? { vertexShader: m.vertexShader, fragmentShader: m.fragmentShader }
      : lib
        ? ShaderLib[lib]
        : null
  if (!src) throw new Error(`matière sans source connue : ${m.type}`)
  const s = { vertexShader: src.vertexShader, fragmentShader: src.fragmentShader, uniforms: {} }
  m.onBeforeCompile(s as never, undefined as never)
  return s.fragmentShader
}

// Test contre la profondeur de la scène : les appels présents dans le fragment (pas les définitions).
const SCENE_DEPTH_CALLS = [
  'e1DepthTest();',
  'e8TelegraphDepthTest();',
  'e2RimDepthTest();',
  'e2MarkDepthTest();',
] as const
const sceneDepth = (m: Material): string[] => SCENE_DEPTH_CALLS.filter((c) => fragmentOf(m).includes(c))

const depthState = (m: Material) => ({
  depthTest: m.depthTest,
  depthWrite: m.depthWrite,
  depthFunc: m.depthFunc,
  side: m.side,
  colorWrite: m.colorWrite,
  stencilWrite: m.stencilWrite,
  stencilFunc: m.stencilFunc,
  stencilRef: m.stencilRef,
  stencilFuncMask: m.stencilFuncMask,
  stencilWriteMask: m.stencilWriteMask,
  stencilFail: m.stencilFail,
  stencilZFail: m.stencilZFail,
  stencilZPass: m.stencilZPass,
  polygonOffset: m.polygonOffset,
  polygonOffsetFactor: m.polygonOffsetFactor,
  polygonOffsetUnits: m.polygonOffsetUnits,
})

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = []
  root.traverse((o) => {
    if (o instanceof Mesh && o.visible) out.push(o)
  })
  return out
}

const expectSameDepth = (o: Mesh, where: string): void => {
  const color = o.material as Material
  const id = idMaterialFor(o)
  expect(id, `${where} : objet absent de la passe d'identification`).not.toBeNull()
  if (!id) return
  expect(sceneDepth(id), `${where} : test contre la profondeur de la scène`).toEqual(sceneDepth(color))
  expect(depthState(id), `${where} : état de profondeur et de gabarit`).toEqual(depthState(color))
}

const ctx = (t: number): RigContext => ({
  t,
  groupPhase: 0,
  speed: 0,
  targeted: false,
  limbStage: 0,
  prayerColor: null,
})

// Un Recousu qui télégraphie son Marteau au-dessus d'un mort, un Abattu (liseré, sceau de Sentence), un Résistant
// (marques), un Confesseur qui prie (halo au sol).
const world = (): World => {
  let w = scene(
    [
      { family: 'recousu', pos: { x: 3, z: 1 }, facing: 0.7, state: 'hostile' },
      { family: 'souriant', pos: { x: 4, z: 1.5 }, state: 'mort' },
      { family: 'souriant', pos: { x: -2, z: 2 }, state: 'abattu' },
      { family: 'souriant', pos: { x: -3, z: -2 }, state: 'abattu', cicatrices: 3 },
      { family: 'confesseur', pos: { x: 0, z: -4 }, state: 'hostile' },
    ],
    { families: { recousu: FAMILIES.recousu, confesseur: FAMILIES.confesseur } },
  )
  const marteau: Action = {
    name: 'marteau',
    kind: 'attaque',
    start: 0,
    activeAt: 60,
    end: 100,
    target: null,
    limb: 'brasDroit',
  }
  const priere: Action = {
    name: 'priere',
    kind: 'canalisation',
    start: 0,
    activeAt: 300,
    end: 300,
    target: null,
    limb: null,
  }
  w = withCreature(w, 1, { action: marteau })
  w = withCreature(w, 5, { action: priere })
  return w
}

describe('passe d’identification : même profondeur que la passe couleur', () => {
  it('couche des signaux du jalon 1 : sol, télégraphes, liserés, marques ; morts dans la scène', () => {
    const groups = {
      scene: new Group(),
      ground: new Group(),
      tel: new Group(),
      signals: new Group(),
    }
    const matters = Object.fromEntries(
      MATTERS.map((m) => [m, new MeshStandardMaterial()]),
    ) as unknown as Record<Matter, Material>
    const layer = new BodyLayer(groups, matters, false)
    const w = world()
    const t = 50 // rouge vif : dernières 0,2 s du Marteau
    layer.begin()
    for (const c of w.creatures as Creature[]) {
      layer.push(creatureBody(c, c.pos, c.facing, ctx(t)), c.state.kind === 'mort', 0)
      layer.ground(c, c.pos, c.facing, t, w, 3)
    }
    layer.end()
    const overlays = { ground: groups.ground, tel: groups.tel, signals: groups.signals }
    for (const [name, g] of Object.entries(overlays)) {
      const ms = meshesOf(g)
      expect(ms.length, `${name} : couche vide, la scène de test ne l'exerce pas`).toBeGreaterThan(0)
      for (const o of ms) expectSameDepth(o, name)
    }
    // Le télégraphe passe par-dessus les morts dans les deux passes : un mort de la scène ne le cache pas.
    for (const o of meshesOf(groups.tel)) {
      expect(idMaterialFor(o)?.depthTest).toBe(false)
      expect(sceneDepth(o.material as Material)).toEqual(['e8TelegraphDepthTest();'])
    }
    // Les morts (scène) : rendus, sans test contre la profondeur de la scène, dans les deux passes.
    const dead = meshesOf(groups.scene).filter((o) =>
      (o.material as Material).customProgramCacheKey().startsWith('e8-mort'),
    )
    expect(dead.length, 'aucun mort dans la scène').toBeGreaterThan(0)
    for (const o of dead) expectSameDepth(o, 'morts (scène)')
  })

  it('modèles de la Forge : masque de silhouette et liseré (gabarit), marques, morts', () => {
    const u = modelUniforms(new Vector3())
    const build = (m: Material, id: Material): Mesh => {
      const o = new Mesh(undefined, m)
      o.userData.idMaterial = id
      return o
    }
    const rim = makeRim(u, build)
    setStencil(7, ...rim.materials)
    expectSameDepth(rim.mask, 'masque de silhouette')
    expectSameDepth(rim.hull, 'liseré')
    expectSameDepth(build(markMaterial(u), idMaterial(u, 'mark')), 'marques')
    expectSameDepth(build(deadMaterial(null, 0.5), deadIdMaterial()), 'morts')
  })
})
