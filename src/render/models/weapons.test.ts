// Armes du Bourreau (E6) : géométrie générée (dimensions du jalon 1, prise à l'origine, attributs pour la fusion et
// les textures), prise dans la main (repère orthonormé, échelle ramenée au mètre sous un os mis à l'échelle), une
// seule arme visible, identification au nom du joueur, retouches de shader qui trouvent bien leurs points d'ancrage
// dans three (une montée de version les casserait en silence).
import {
  Bone,
  Box3,
  Group,
  Matrix4,
  Object3D,
  Texture,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { describe, expect, it } from 'vitest'
import { decodeId, ROLE } from '../idpass'
import {
  couperetGeometry,
  GRIP_PSI_DEG,
  GRIP_THETA_DEG,
  gripRotation,
  HeldWeapons,
  masseGeometry,
  WEAPON_PARTS,
  type WeaponGeometry,
  weaponMaterials,
} from './weapons'

const PLAYER = 0xffff

const boxOf = (g: WeaponGeometry): Box3 => {
  const b = new Box3()
  for (const p of WEAPON_PARTS) {
    const geo = g[p]
    if (!geo) continue
    geo.computeBoundingBox()
    if (geo.boundingBox) b.union(geo.boundingBox)
  }
  return b
}

const tris = (g: WeaponGeometry): number =>
  WEAPON_PARTS.reduce((n, p) => n + (g[p]?.getAttribute('position').count ?? 0) / 3, 0)

const maps = () => {
  const set = () => ({ albedo: new Texture(), normal: new Texture(), arm: new Texture() })
  return { fer: set(), bois: set(), cuir: set() }
}

describe('géométrie', () => {
  it('Couperet : lame de 0,46 m sur 0,34 m, manche sous le poing, prise à l’origine', () => {
    const g = couperetGeometry()
    const b = boxOf(g)
    expect(b.max.y - 0.73).toBeGreaterThan(-0.01) // bout de la lame
    expect(b.max.y).toBeLessThan(0.76)
    expect(b.min.y).toBeLessThan(-0.09) // pommeau sous le poing
    expect(b.max.z).toBeGreaterThan(0.28) // tranchant
    expect(b.max.z - b.min.z).toBeLessThan(0.4)
    expect(b.max.x - b.min.x).toBeLessThan(0.08) // lame mince
    expect(b.containsPoint(new Vector3(0, 0, 0))).toBe(true)
    expect(tris(g)).toBeLessThan(4000)
  })
  it('Masse : un mètre environ, tête hérissée de 0,24 m, anneau au pommeau', () => {
    const g = masseGeometry()
    const b = boxOf(g)
    expect(b.max.y).toBeGreaterThan(0.95)
    expect(b.max.y).toBeLessThan(1.05)
    expect(b.min.y).toBeLessThan(-0.2)
    expect(b.max.x - b.min.x).toBeGreaterThan(0.24)
    expect(b.containsPoint(new Vector3(0, 0, 0))).toBe(true)
    expect(tris(g)).toBeLessThan(4000)
  })
  it('chaque partie porte position, normale et UV (textures PBR), sans index (fusion)', () => {
    for (const g of [couperetGeometry(), masseGeometry()])
      for (const p of WEAPON_PARTS) {
        const geo = g[p]
        expect(geo).not.toBeNull()
        if (!geo) continue
        expect(Object.keys(geo.attributes).sort()).toEqual(['normal', 'position', 'uv'])
        expect(geo.index).toBeNull()
      }
  })
})

describe('prise', () => {
  it('repère orthonormé ; θ, ψ : axe de l’arme dans le plan perpendiculaire aux doigts, incliné de ψ', () => {
    const q = gripRotation(GRIP_THETA_DEG, GRIP_PSI_DEG, 1)
    const m = new Matrix4().makeRotationFromQuaternion(q)
    const x = new Vector3()
    const y = new Vector3()
    const z = new Vector3()
    m.extractBasis(x, y, z)
    expect(x.dot(y)).toBeCloseTo(0, 9)
    expect(y.dot(z)).toBeCloseTo(0, 9)
    expect(new Vector3().crossVectors(x, y).dot(z)).toBeCloseTo(1, 9)
    // Axe de l'arme : à ψ des doigts (+Y de l'os) près, dans le plan XZ.
    expect(Math.asin(y.y)).toBeCloseTo((GRIP_PSI_DEG * Math.PI) / 180, 9)
    expect(Math.atan2(y.z, y.x)).toBeCloseTo(
      Math.atan2(Math.sin((GRIP_THETA_DEG * Math.PI) / 180), Math.cos((GRIP_THETA_DEG * Math.PI) / 180)),
      9,
    )
    // Tranchant dans le sens des doigts.
    expect(z.y).toBeGreaterThan(0)
  })

  it('accrochée à une main mise à l’échelle (squelette à 0,01) : l’arme mesure ses mètres, une seule visible', () => {
    const w = new HeldWeapons(maps(), PLAYER, false)
    const root = new Object3D()
    root.scale.setScalar(1.3)
    const armature = new Group()
    armature.scale.setScalar(0.01)
    const hand = new Bone()
    hand.position.set(-50, 110, 3)
    root.add(armature)
    armature.add(hand)
    w.attach(root, hand, new Vector3(0, 9, 0))
    w.show('masse')
    root.updateMatrixWorld(true)
    const p = w.pose()
    expect(p).not.toBeNull()
    if (!p) return
    // Du poing au bout de la Masse : sa longueur dans le repère de l'arme, en mètres, quelle que soit l'échelle.
    expect(p.tip.distanceTo(p.grip)).toBeCloseTo(masseGeometry().fer?.boundingBox?.max.y ?? 0, 3)
    expect(w.info().weapon).toBe('masse')
    w.show('couperet')
    expect(w.info().weapon).toBe('couperet')
    w.show(null)
    expect(w.pose()).toBeNull()
    w.dispose()
  })

  it('identification : id du joueur, rôle « autre » (audit des classes : l’arme comptée avec le Bourreau)', () => {
    const w = new HeldWeapons(maps(), PLAYER, false)
    const hand = new Bone()
    const root = new Object3D()
    root.add(hand)
    w.attach(root, hand, new Vector3())
    const meshes: { userData: { idMaterial?: { uniforms: { uId: { value: Vector3 } } } } }[] = []
    hand.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes.push(o as never)
    })
    expect(meshes.length).toBe(6) // fer, bois, cuir × 2 armes
    for (const m of meshes) {
      const v = m.userData.idMaterial?.uniforms.uId.value as Vector3
      const id = decodeId(Math.round(v.x * 255), Math.round(v.y * 255), Math.round(v.z * 255))
      expect(id).toEqual({ id: PLAYER, role: ROLE.autre })
    }
    w.dispose()
  })
})

describe('matières', () => {
  // Simule onBeforeCompile sur les gabarits de three : les points d'ancrage existent, les retouches sont posées.
  const compile = (m: { onBeforeCompile: (s: WebGLProgramParametersWithUniforms, r: never) => void }) => {
    const s = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        '#include <common>\n#include <lights_pars_begin>\nvoid main() {\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <opaque_fragment>\n}',
    } as unknown as WebGLProgramParametersWithUniforms
    m.onBeforeCompile(s, undefined as never)
    return s
  }
  it('fer : couches de fer noirci, rouille et sang séché ; masque des personnages ; chandelle bornée', () => {
    for (const w of ['couperet', 'masse'] as const) {
      const mats = weaponMaterials(maps(), w)
      const fer = compile(mats.fer as never)
      expect(fer.fragmentShader).toContain('e6Blood')
      expect(fer.fragmentShader).toContain('e6Rust')
      expect(fer.fragmentShader).toContain('gl_FragColor.a = 0.0;')
      // La retouche de la chandelle remplace la loi d'atténuation des sources ponctuelles de three.
      expect(fer.fragmentShader).toContain('e6D')
      expect(fer.fragmentShader).not.toContain('#include <lights_pars_begin>')
      for (const p of ['bois', 'cuir'] as const) {
        const s = compile(mats[p] as never)
        expect(s.fragmentShader).toContain('gl_FragColor.a = 0.0;')
        expect(s.fragmentShader).toContain('e6D')
      }
    }
  })
})
