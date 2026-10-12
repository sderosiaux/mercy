// Les armes du Bourreau en main (E6, §6) : le Couperet et la Masse, en géométrie générée par code (aucun crédit
// Meshy pour un modèle), habillées des matières PBR CC0 de public/textures (fer, bois, cuir). Le modèle du Bourreau
// de la Forge n'a pas d'arme : l'arme courante est tenue dans la main droite, celle qui frappe dans tous les clips de
// la Forge (effecteur « mainDroite » de art/forge/bourreau/asset.json), et suit donc la marche, les Frappes, le
// Balayage, la Charge, l'Esquive et la Sentence. Elle change au tick du changement d'arme (`weapon-swap`).
//
// Esprit : planche bourreau-sheet (Couperet à large lame rectangulaire, Masse à long manche, tête cylindrique cerclée
// et hérissée de pointes, anneau au pommeau) ; fer noirci et rouillé, sang séché. Dimensions : celles des armes en
// segments du jalon 1 (rig-bourreau.ts), le Couperet un peu affiné (une lame de 4 cm d'épaisseur n'est pas un
// couperet). Couleurs : PALETTE.bourreau (acier, manche, cuir), loin du gris des morts, de l'ivoire et de l'or (audit
// des classes réservées) ; sang séché : PALETTE.rougeBrun.sangAncien, le sens du rouge brun (§17).
//
// Repère d'une arme : origine au centre de la prise (le poing), +Y vers la lame ou la tête, +Z vers le tranchant du
// Couperet (le côté qui mène le coup), X normale au plat de la lame. En mètres.
import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  Object3D,
  Quaternion,
  ShaderChunk,
  type ShaderMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { WeaponId } from '../../sim/index'
import { ROLE, uniformIdMaterial } from '../idpass'
import { RELIQUAIRE_HEIGHT_M } from '../lights'
import { fixedLightUniforms, pbr, type SetMaps } from '../materials'
import { PALETTE } from '../palette'
import { urlParam } from '../quality'
import { NOISE_GLSL } from '../shaders'

export type WeaponPart = 'fer' | 'bois' | 'cuir'
export const WEAPON_PARTS: readonly WeaponPart[] = ['fer', 'bois', 'cuir']

// Densité des textures : une répétition de la carte tous les 0,5 m.
const UV_PER_M = 2

const TAU = Math.PI * 2

// ---------------------------------------------------------------------------------------------------------
// Géométrie (pure : aucune texture, aucun DOM)

const finish = (g: BufferGeometry): BufferGeometry => {
  const out = g.index ? g.toNonIndexed() : g
  for (const name of Object.keys(out.attributes))
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name)
  return out
}

// Révolution d'un profil (rayon, hauteur) autour de +Y ; UV : tour × hauteur, en mètres.
const lathe = (profile: readonly (readonly [number, number])[], segments: number): BufferGeometry => {
  const g = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  )
  const uv = g.getAttribute('uv')
  const r = Math.max(...profile.map(([x]) => x))
  const y0 = profile[0]?.[1] ?? 0
  const y1 = profile[profile.length - 1]?.[1] ?? 1
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * TAU * r * UV_PER_M, (y0 + uv.getY(i) * (y1 - y0)) * UV_PER_M)
  return finish(g)
}

const scaleUv = (g: BufferGeometry, k: number): BufferGeometry => {
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k)
  return g
}

// Cône (pointe) posé à `at`, pointe dans la direction `dir`.
const spike = (at: Vector3, dir: Vector3, length: number, radius: number): BufferGeometry => {
  const g = new ConeGeometry(radius, length, 7, 1)
  g.translate(0, length / 2, 0)
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()))
  g.translate(at.x, at.y, at.z)
  return scaleUv(finish(g), length * UV_PER_M)
}

const ring = (y: number, radius: number, height: number, segments: number): BufferGeometry => {
  const g = new CylinderGeometry(radius, radius, height, segments, 1, false)
  g.translate(0, y, 0)
  return scaleUv(finish(g), Math.max(radius * TAU, height) * UV_PER_M)
}

const merge = (parts: BufferGeometry[]): BufferGeometry => {
  const g = mergeGeometries(parts, false)
  if (!g) throw new Error('armes : fusion de géométries impossible (attributs incompatibles)')
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

// Rivet bombé, aplati contre la lame.
const rivet = (at: Vector3): BufferGeometry => {
  const g = new SphereGeometry(0.011, 8, 6)
  g.scale(1.6, 1, 1)
  g.translate(at.x, at.y, at.z)
  return scaleUv(finish(g), UV_PER_M)
}

export type WeaponGeometry = Readonly<Record<WeaponPart, BufferGeometry | null>>

// Couperet (planche) : lame large et rectangulaire, dos droit dans l'axe du manche, tranchant légèrement bombé, coin
// supérieur arrondi, trou de suspension ; lame en coin (plus mince vers le tranchant) ; manche de bois, poignée de cuir
// sous le poing, virole et calotte de fer. Lame de 0,46 × 0,34 m, manche de 0,42 m (jalon 1).
export const couperetGeometry = (): WeaponGeometry => {
  const BLADE_Y0 = 0.27 // talon de la lame
  const BLADE_Y1 = 0.73 // bout
  const SPINE_Z = -0.035 // dos, dans l'axe du manche
  const EDGE_Z = 0.3 // tranchant
  const THICK = 0.014 // épaisseur au dos
  const s = new Shape()
  s.moveTo(SPINE_Z, BLADE_Y0)
  s.lineTo(EDGE_Z - 0.04, BLADE_Y0 - 0.005)
  s.quadraticCurveTo(EDGE_Z + 0.012, (BLADE_Y0 + BLADE_Y1) / 2, EDGE_Z - 0.01, BLADE_Y1 - 0.02)
  s.quadraticCurveTo(EDGE_Z - 0.03, BLADE_Y1 + 0.012, EDGE_Z - 0.09, BLADE_Y1)
  s.lineTo(SPINE_Z + 0.02, BLADE_Y1)
  s.quadraticCurveTo(SPINE_Z, BLADE_Y1, SPINE_Z, BLADE_Y1 - 0.02)
  s.lineTo(SPINE_Z, BLADE_Y0)
  const hole = new Shape()
  hole.absarc(0.02, BLADE_Y1 - 0.06, 0.022, 0, TAU, true)
  s.holes.push(hole)
  const blade = new ExtrudeGeometry(s, {
    depth: THICK,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
    curveSegments: 10,
  })
  // Forme dans le plan (Z, Y) de l'arme, épaisseur selon X, centrée.
  blade.translate(0, 0, -THICK / 2)
  blade.applyMatrix4(new Matrix4().makeRotationY(-Math.PI / 2))
  // Lame en coin : l'épaisseur tombe vers le tranchant.
  const p = blade.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i)
    const k = 1 - 0.8 * Math.min(1, Math.max(0, (z - 0.05) / (EDGE_Z - 0.05)))
    p.setX(i, p.getX(i) * k)
  }
  blade.computeVertexNormals()
  const bladeG = scaleUv(finish(blade), UV_PER_M)
  const fer = merge([
    bladeG,
    // Virole sous la lame, calotte au bout du manche, deux rivets de la soie à travers la lame.
    lathe(
      [
        [0.001, 0.255],
        [0.03, 0.258],
        [0.032, 0.275],
        [0.026, 0.29],
        [0.001, 0.292],
      ],
      14,
    ),
    lathe(
      [
        [0.001, -0.135],
        [0.022, -0.132],
        [0.03, -0.118],
        [0.028, -0.1],
        [0.001, -0.098],
      ],
      14,
    ),
    rivet(new Vector3(0, BLADE_Y0 + 0.05, 0.0)),
    rivet(new Vector3(0, BLADE_Y0 + 0.12, 0.0)),
  ])
  // Manche : légèrement renflé, du pommeau au talon de la lame.
  const bois = lathe(
    [
      [0.001, -0.1],
      [0.021, -0.1],
      [0.025, -0.06],
      [0.026, 0.05],
      [0.024, 0.18],
      [0.022, 0.26],
      [0.001, 0.26],
    ],
    14,
  )
  // Poignée de cuir sous le poing : quatre spires de lanière.
  const spires: BufferGeometry[] = []
  for (let k = 0; k < 4; k++) {
    const y = -0.07 + k * 0.045
    spires.push(
      lathe(
        [
          [0.0255, y],
          [0.0285, y + 0.008],
          [0.029, y + 0.03],
          [0.0255, y + 0.04],
        ],
        14,
      ),
    )
  }
  return { fer, bois, cuir: merge(spires) }
}

// Masse à pointes (planche) : long manche de bois cerclé de fer, poignée de cuir, pommeau et anneau de fer ; tête
// cylindrique cerclée de deux collerettes, hérissée de trois rangées de six pointes décalées et d'une pointe au
// sommet. Longueur 1 m environ, tête de 0,24 m de diamètre (jalon 1).
export const masseGeometry = (): WeaponGeometry => {
  const HEAD_Y0 = 0.58
  const HEAD_Y1 = 0.86
  const R = 0.1
  const parts: BufferGeometry[] = [
    lathe(
      [
        [0.001, HEAD_Y0 - 0.03],
        [0.04, HEAD_Y0 - 0.025],
        [R - 0.01, HEAD_Y0],
        [R, HEAD_Y0 + 0.02],
        [R, HEAD_Y1 - 0.02],
        [R - 0.015, HEAD_Y1],
        [0.04, HEAD_Y1 + 0.02],
        [0.001, HEAD_Y1 + 0.025],
      ],
      16,
    ),
    ring(HEAD_Y0 + 0.035, R + 0.018, 0.026, 16),
    ring(HEAD_Y1 - 0.035, R + 0.018, 0.026, 16),
    // Cercles du manche.
    ring(0.32, 0.031, 0.02, 12),
    ring(0.47, 0.031, 0.02, 12),
    // Pommeau et anneau.
    lathe(
      [
        [0.001, -0.165],
        [0.024, -0.16],
        [0.036, -0.14],
        [0.032, -0.115],
        [0.026, -0.105],
        [0.001, -0.103],
      ],
      12,
    ),
  ]
  const torus = new TorusGeometry(0.035, 0.008, 6, 16)
  torus.translate(0, -0.2, 0)
  parts.push(scaleUv(finish(torus), UV_PER_M))
  for (let row = 0; row < 3; row++) {
    const y = HEAD_Y0 + 0.075 + row * 0.065
    for (let k = 0; k < 6; k++) {
      const a = ((k + (row % 2) * 0.5) / 6) * TAU
      const dir = new Vector3(Math.cos(a), 0.12 * (row - 1), Math.sin(a))
      parts.push(spike(new Vector3(Math.cos(a) * (R - 0.01), y, Math.sin(a) * (R - 0.01)), dir, 0.12, 0.022))
    }
  }
  parts.push(spike(new Vector3(0, HEAD_Y1 + 0.015, 0), new Vector3(0, 1, 0), 0.13, 0.024))
  const bois = lathe(
    [
      [0.001, -0.105],
      [0.026, -0.105],
      [0.028, 0.1],
      [0.026, 0.4],
      [0.024, HEAD_Y0 - 0.02],
      [0.001, HEAD_Y0 - 0.02],
    ],
    12,
  )
  const spires: BufferGeometry[] = []
  for (let k = 0; k < 5; k++) {
    const y = -0.09 + k * 0.045
    spires.push(
      lathe(
        [
          [0.027, y],
          [0.0305, y + 0.008],
          [0.031, y + 0.03],
          [0.027, y + 0.04],
        ],
        12,
      ),
    )
  }
  return { fer: merge(parts), bois, cuir: merge(spires) }
}

export const weaponGeometry = (w: WeaponId): WeaponGeometry =>
  w === 'couperet' ? couperetGeometry() : masseGeometry()

// ---------------------------------------------------------------------------------------------------------
// Matières

// Fer noirci et rouillé, sang séché (planche bourreau-sheet). Trois couches, dessinées par un bruit dans le repère de
// l'arme (collées à l'arme, déterministes) :
// - fer noirci : métal (il accroche la lumière, ART_DIRECTION « son arme accroche la lumière »), couleur acier du
//   Bourreau (PALETTE.bourreau.acier), détail de luminance de la carte fer (rust_coarse_01) ; le fil du Couperet est
//   plus lisse (il brille) mais garde la même couleur (aucun gris clair : loin du gris des morts) ;
// - rouille : la carte fer telle quelle, teinte du fer rouillé du décor (PALETTE.matiere.fer), mate, sans métal ;
// - sang séché : rouge brun (sang ancien, §17), près du tranchant et en coulures sur le Couperet, sur la tête et les
//   pointes de la Masse ; plus lisse que la rouille, sans métal.
// Masque des personnages (E3) : alpha 0, comme le corps du Bourreau qui la tient (l'étalonnage traite l'arme comme sa
// main).
// Luminance moyenne (linéaire) de public/textures/fer/fer_albedo.jpg, mesurée (E6) : elle normalise le détail du fer
// noirci, borné à [0,5 ; 1,5] (une autre carte ne change que le grain).
const FER_MEAN_LUM = 0.057
// Réglage (forme, E6), contre l'audit des classes réservées sur la scène `armes` : levée sous la chandelle du
// reliquaire (source à 2,8 m au-dessus du Bourreau), une lame lisse brûlait en reflets jaune pâle (ivoire), le sang
// séché et la rouille saturée, puis les reflets du fer (teintés d'acier), viraient au rouge vif. Rouille désaturée de
// 40 %, fer moins métallique et moins lisse (fil compris), sang séché à 50 % de la teinte du sang ancien (plus
// sombre). Avec la règle de la chandelle (NEAR_LIGHT) : 0 pixel de classe réservée sur toute la scène `armes`, aux deux
// caméras et aux deux viewports (rapport E6).
const RUST_SATURATION = 0.6
const STEEL_ROUGHNESS = 0.5
const EDGE_ROUGHNESS = 0.38
const STEEL_METALNESS = 0.6
const DRIED_BLOOD = 0.5
const IRON_PATCH = (w: WeaponId) => (s: WebGLProgramParametersWithUniforms) => {
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vE6Local;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vE6Local = position;')
  const bloodZone =
    w === 'couperet'
      ? 'smoothstep( 0.06, 0.27, p.z ) * 0.8 + 0.25 * smoothstep( 0.55, 0.3, p.y )'
      : 'smoothstep( 0.5, 0.62, p.y )'
  const edge = w === 'couperet' ? 'smoothstep( 0.25, 0.28, vE6Local.z ) * step( 0.27, vE6Local.y )' : '0.0'
  s.fragmentShader = s.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vE6Local;
${NOISE_GLSL}
float e6Blood( vec3 p ) {
  float n = e1Fbm( vec2( p.z * 11.0 + p.x * 7.0, p.y * 7.0 ) ) * 0.7 + e1Fbm( vec2( p.x * 23.0 - p.z * 5.0, p.y * 31.0 + 4.1 ) ) * 0.3;
  return smoothstep( 0.42, 0.5, n * ( 0.55 + 0.6 * ( ${bloodZone} ) ) );
}
float e6Rust( vec3 p ) {
  float n = e1Fbm( vec2( p.y * 9.0 + p.x * 13.0 + 7.3, p.z * 9.0 - p.x * 5.0 ) );
  return smoothstep( 0.5, 0.62, n );
}`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  float e6Lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float e6R = e6Rust( vE6Local );
  float e6E = ${edge} * ( 1.0 - e6R );
  float e6B = e6Blood( vE6Local );
  vec3 e6Steel = ${glsl(PALETTE.bourreau.acier)} * clamp( e6Lum / ${FER_MEAN_LUM.toFixed(4)}, 0.5, 1.5 );
  vec3 e6RustC = mix( vec3( e6Lum ), diffuseColor.rgb, ${RUST_SATURATION.toFixed(2)} ) * ${glsl(PALETTE.matiere.fer)};
  diffuseColor.rgb = mix( e6Steel, e6RustC, e6R );
  diffuseColor.rgb = mix( diffuseColor.rgb, ${glsl(PALETTE.rougeBrun.sangAncien)} * ${DRIED_BLOOD.toFixed(2)}, e6B * 0.9 );`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  roughnessFactor = mix( mix( mix( ${STEEL_ROUGHNESS.toFixed(2)}, ${EDGE_ROUGHNESS.toFixed(2)}, e6E ), roughnessFactor, e6R ), 0.5, e6B );`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
  metalnessFactor = mix( ${STEEL_METALNESS.toFixed(2)}, 0.0, max( e6R, e6B ) );`,
    )
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  gl_FragColor.a = 0.0;')
}

const CHARACTER_MASK = (s: WebGLProgramParametersWithUniforms) => {
  s.fragmentShader = s.fragmentShader.replace(
    '#include <opaque_fragment>',
    '#include <opaque_fragment>\n  gl_FragColor.a = 0.0;',
  )
}

// La chandelle du reliquaire (E6) : sa source est placée à RELIQUAIRE_HEIGHT_M au-dessus du Bourreau, pour éclairer
// le sol autour de lui à la manière de Diablo (lights.ts) ; ce n'est pas la flamme de la planche, qui pend à sa
// ceinture. Une arme levée au-dessus de la tête s'approchait de cette source virtuelle à quelques centimètres et
// blanchissait (ivoire : jusqu'à 267 pixels mesurés). Règle : l'arme ne reçoit jamais de la chandelle plus que le sol
// juste sous elle (distance comptée au moins RELIQUAIRE_HEIGHT_M). Les autres sources (torches, braseros) gardent
// leur loi. La source est reconnue par sa position (uniforme uLantern de la lumière fixe, en monde ; le vacillement
// la déplace de 3 cm au plus).
const POINT_FALLOFF =
  'light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );'
const NEAR_LIGHT = (s: WebGLProgramParametersWithUniforms) => {
  if (!ShaderChunk.lights_pars_begin.includes(POINT_FALLOFF))
    throw new Error('armes : atténuation des lumières ponctuelles de three introuvable (montée de version ?)')
  s.uniforms.uLantern = fixedLightUniforms.uLantern
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec4 uLantern;')
    .replace(
      '#include <lights_pars_begin>',
      ShaderChunk.lights_pars_begin.replace(
        POINT_FALLOFF,
        `float e6D = length( pointLight.position - ( viewMatrix * vec4( uLantern.xyz, 1.0 ) ).xyz ) < 0.25
      ? max( lightDistance, ${RELIQUAIRE_HEIGHT_M.toFixed(2)} ) : lightDistance;
    light.color *= getDistanceAttenuation( e6D, pointLight.distance, pointLight.decay );`,
      ),
    )
}

const glsl = (hex: number): string => {
  const r = ((hex >> 16) & 255) / 255
  const g = ((hex >> 8) & 255) / 255
  const b = (hex & 255) / 255
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return `vec3( ${lin(r).toFixed(5)}, ${lin(g).toFixed(5)}, ${lin(b).toFixed(5)} )`
}

export interface WeaponMaps {
  readonly fer: SetMaps
  readonly bois: SetMaps
  readonly cuir: SetMaps
}

export const weaponMaterials = (maps: WeaponMaps, w: WeaponId): Record<WeaponPart, MeshStandardMaterial> => {
  // Fer noirci et rouillé : couleurs, métal et rugosité posés dans le shader (IRON_PATCH) ; la matière lit la carte fer
  // (rust_coarse_01) sans teinte, pour son détail, sa rouille, sa normale et sa rugosité.
  const fer = pbr(maps.fer, {
    tint: PALETTE.technique.neutre,
    normalScale: 1,
    envIntensity: 0.5,
  })
  const iron = IRON_PATCH(w)
  fer.onBeforeCompile = (s) => {
    iron(s)
    NEAR_LIGHT(s)
  }
  fer.customProgramCacheKey = () => `e6-fer-${w}`
  const bois = pbr(maps.bois, { tint: PALETTE.bourreau.manche, normalScale: 1, roughness: 0.9 })
  bois.onBeforeCompile = (s) => {
    CHARACTER_MASK(s)
    NEAR_LIGHT(s)
  }
  bois.customProgramCacheKey = () => 'e6-bois'
  const cuir = pbr(maps.cuir, {
    tint: PALETTE.bourreau.cuir,
    normalScale: 1,
    roughness: 0.8,
    envIntensity: 0.3,
  })
  cuir.onBeforeCompile = (s) => {
    CHARACTER_MASK(s)
    NEAR_LIGHT(s)
  }
  cuir.customProgramCacheKey = () => 'e6-cuir'
  return { fer, bois, cuir }
}

// ---------------------------------------------------------------------------------------------------------
// Prise en main

// Prise : orientation de l'arme dans le repère de l'os RightHand du modèle. +Y de l'os suit la main du poignet vers
// les doigts. Un poing serre un manche perpendiculaire aux doigts : l'axe de l'arme est dans le plan XZ de l'os
// (angle θ depuis +X vers +Z), incliné de ψ vers les doigts (le poignet cassé) ; le tranchant du Couperet (+Z de
// l'arme) va dans le sens des doigts. Le squelette de la Forge n'a pas de doigts et ses clips viennent d'une
// bibliothèque générique : aucune prise n'y est inscrite. θ et ψ ont donc été ajustés sur les clips eux-mêmes
// (scène `armes` du laboratoire, rapport E6) : pendant un geste, une arme tenue pointe à l'opposé du centre de
// rotation (les épaules), et au repos elle pend. Meilleur accord : θ = 335°, ψ = 45° (l'arme prolonge l'avant-bras,
// comme une épée). Instrument : `prise=<θ>,<ψ>,<±1>`.
export const GRIP_THETA_DEG = 335
export const GRIP_PSI_DEG = 45
export const gripRotation = (thetaDeg: number, psiDeg: number, edgeSign: 1 | -1): Quaternion => {
  const th = (thetaDeg * Math.PI) / 180
  const ps = (psiDeg * Math.PI) / 180
  const y = new Vector3(Math.cos(th) * Math.cos(ps), Math.sin(ps), Math.sin(th) * Math.cos(ps))
  const z = new Vector3(0, edgeSign, 0).addScaledVector(y, -edgeSign * y.y).normalize()
  const x = new Vector3().crossVectors(y, z)
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
}
const PRISE = (urlParam('prise') ?? '').split(',').map(Number)
export const GRIP_ROTATION =
  PRISE.length === 3 && PRISE.every(Number.isFinite)
    ? gripRotation(PRISE[0] as number, PRISE[1] as number, (PRISE[2] as number) < 0 ? -1 : 1)
    : gripRotation(GRIP_THETA_DEG, GRIP_PSI_DEG, 1)
export const HAND_BONE = 'RightHand'

interface WeaponModel {
  readonly group: Group
  readonly meshes: readonly Mesh[]
}

export interface HeldWeaponsInfo {
  readonly attached: boolean
  readonly weapon: WeaponId | null
  readonly triangles: Readonly<Record<WeaponId, number>>
}

// Les deux armes, accrochées à la main d'une instance du Bourreau ; une seule visible. Chaque maillage porte sa matière
// d'identification (id du joueur, rôle « autre » : l'audit des classes compte l'arme avec le Bourreau, à part).
export class HeldWeapons {
  private readonly holder = new Object3D()
  private readonly models: Record<WeaponId, WeaponModel>
  private hand: Object3D | null = null
  private current: WeaponId | null = null
  private readonly idMaterial: ShaderMaterial
  readonly materials: MeshStandardMaterial[] = [] // fer, bois, cuir des deux armes (reflets : layer.ts)
  private readonly geometries: BufferGeometry[] = []

  constructor(maps: WeaponMaps, playerId: number, shadows: boolean) {
    this.idMaterial = uniformIdMaterial(playerId, ROLE.autre)
    const build = (w: WeaponId): WeaponModel => {
      const geo = weaponGeometry(w)
      const mats = weaponMaterials(maps, w)
      const group = new Group()
      const meshes: Mesh[] = []
      for (const part of WEAPON_PARTS) {
        const g = geo[part]
        if (!g) continue
        const m = new Mesh(g, mats[part])
        m.castShadow = shadows
        m.receiveShadow = shadows
        m.frustumCulled = false
        m.userData.idMaterial = this.idMaterial
        group.add(m)
        meshes.push(m)
        this.geometries.push(g)
      }
      this.materials.push(...Object.values(mats))
      group.visible = false
      this.holder.add(group)
      return { group, meshes }
    }
    this.models = { couperet: build('couperet'), masse: build('masse') }
    this.holder.quaternion.copy(GRIP_ROTATION)
  }

  // Accroche les armes à la main de l'instance (après `place`) : centre de la prise au centre des sommets de la main
  // (boîte de l'os, repère de l'os au repos), échelle ramenée au mètre (l'os hérite de l'échelle du modèle).
  attach(root: Object3D, hand: Object3D, gripCenter: Vector3): void {
    if (this.hand !== hand) {
      this.hand?.remove(this.holder)
      hand.add(this.holder)
      this.hand = hand
    }
    this.holder.position.copy(gripCenter)
    root.updateMatrixWorld(true)
    const s = new Vector3()
    hand.matrixWorld.decompose(new Vector3(), new Quaternion(), s)
    this.holder.scale.setScalar(1 / Math.max(1e-9, (s.x + s.y + s.z) / 3))
  }

  get attached(): boolean {
    return this.hand !== null
  }

  show(w: WeaponId | null): void {
    this.current = w
    for (const k of ['couperet', 'masse'] as const) this.models[k].group.visible = k === w
  }

  info(): HeldWeaponsInfo {
    const tris = (k: WeaponId): number =>
      this.models[k].meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0)
    return {
      attached: this.attached,
      weapon: this.current,
      triangles: { couperet: tris('couperet'), masse: tris('masse') },
    }
  }

  // Position monde du bout de l'arme visible (instrument : séquences image par image, cadrage).
  // Repère monde de l'arme visible : prise, bout (tête ou lame) et tranchant (+Z de l'arme). Instrument (E6) : vérifier
  // par le calcul que l'arme suit la main dans les clips (tête devant et en bas à l'impact d'un coup, levée à l'armé).
  pose(): { grip: Vector3; tip: Vector3; edge: Vector3 } | null {
    if (!this.current || !this.hand) return null
    const g = this.models[this.current].group
    const box = this.models[this.current].meshes[0]?.geometry.boundingBox
    if (!box) return null
    return {
      grip: new Vector3(0, 0, 0).applyMatrix4(g.matrixWorld),
      tip: new Vector3(0, box.max.y, 0).applyMatrix4(g.matrixWorld),
      edge: new Vector3(0, 0, 0.3).applyMatrix4(g.matrixWorld),
    }
  }

  dispose(): void {
    this.hand?.remove(this.holder)
    for (const m of this.materials) m.dispose()
    for (const g of this.geometries) g.dispose()
    this.idMaterial.dispose()
  }
}
