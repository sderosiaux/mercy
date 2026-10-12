// Rendu du gore (E1) : décalques de sang au sol (gerbes, traînées, flaques, traces de reptation) dessinés par un
// shader de forme, éclairés et mouillés (le sang frais brille, le sang ancien sèche) ; gouttelettes en vol ; morceaux
// de chair et d'os qui retombent et restent. Tout se lit dans GoreMemory, en fonction de l'horloge de rendu t.
import {
  Euler,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { Batch } from './batch'
import { ballistic, type DecalKind, decalScale, type GoreMemory, isFresh } from './gore'
import { instancedIdMaterial, ROLE } from './idpass'
import { decalColor } from './look'
import { PALETTE } from './palette'
import { NOISE_GLSL } from './shaders'

const KIND_CODE: Record<DecalKind, number> = { eclat: 0, trainee: 1, flaque: 2, trace: 3 }

// Forme d'un décalque dans le quad (p ∈ [−1, 1]², x le long de la direction), alpha en sortie.
const DECAL_SHAPE = /* glsl */ `
${NOISE_GLSL}
float e1Disc( vec2 q, vec2 c, float r ) { return 1.0 - smoothstep( r * 0.7, r, length( q - c ) ); }
float e1DecalAlpha( vec2 p, float kind, float seed, float len ) {
  float a = 0.0;
  if ( kind < 0.5 ) {
    float r = length( p );
    float ang = atan( p.y, p.x );
    float edge = 0.5 + 0.16 * e1Noise( vec2( ang * 2.0, seed ) ) + 0.1 * e1Noise( vec2( ang * 7.0, seed + 3.0 ) );
    a = 1.0 - smoothstep( edge - 0.06, edge, r );
    for ( int i = 0; i < 7; i ++ ) {
      float fi = float( i );
      float an = e1Hash( vec2( seed, fi ) ) * 6.2832;
      float rr = 0.62 + 0.32 * e1Hash( vec2( fi, seed ) );
      a = max( a, e1Disc( p, vec2( cos( an ), sin( an ) ) * rr, 0.04 + 0.06 * e1Hash( vec2( fi + 9.0, seed ) ) ) );
    }
  } else if ( kind < 1.5 ) {
    vec2 q = vec2( p.x * len, p.y );
    float u = ( p.x + 1.0 ) * 0.5;
    float w = mix( 0.75, 0.12, u ) * ( 0.75 + 0.5 * e1Noise( vec2( p.x * 5.0, seed ) ) );
    a = ( 1.0 - smoothstep( w - 0.1, w, abs( p.y ) ) ) * smoothstep( -1.0, -0.85, p.x ) * ( 1.0 - smoothstep( 0.55, 0.8, p.x ) );
    for ( int i = 0; i < 6; i ++ ) {
      float fi = float( i );
      float x = 0.6 + 0.38 * e1Hash( vec2( seed, fi + 2.0 ) );
      float y = ( e1Hash( vec2( fi, seed + 5.0 ) ) - 0.5 ) * 0.8;
      a = max( a, e1Disc( q, vec2( x * len, y ), 0.05 + 0.07 * e1Hash( vec2( fi + 4.0, seed ) ) ) );
    }
  } else if ( kind < 2.5 ) {
    float r = length( p );
    float ang = atan( p.y, p.x );
    float edge = 0.78 + 0.12 * e1Noise( vec2( ang * 1.6, seed ) ) + 0.05 * e1Noise( vec2( ang * 6.0, seed + 1.0 ) );
    a = 1.0 - smoothstep( edge - 0.05, edge, r );
  } else {
    float streak = 0.55 + 0.45 * e1Noise( vec2( p.x * len * 2.5, p.y * 9.0 + seed ) );
    a = ( 1.0 - smoothstep( 0.3, 0.6, abs( p.y ) + 0.1 * e1Noise( vec2( p.x * 6.0, seed ) ) ) ) * streak;
    a *= smoothstep( -1.0, -0.7, p.x ) * ( 1.0 - smoothstep( 0.7, 1.0, p.x ) ) * 0.8;
  }
  return a;
}
`

// Passe d'identification d'un décalque (B2 I1) : même forme que la passe couleur, rôle « décalque » là où il y a du
// sang, rien ailleurs (le sol garde son rôle).
const decalIdMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: /* glsl */ `
attribute vec3 aId;
attribute vec4 aDecal;
varying vec3 vId;
varying vec4 vDecal;
varying vec2 vDecalUv;
void main() {
  vId = aId;
  vDecal = aDecal;
  vDecalUv = uv;
  #include <begin_vertex>
  #include <project_vertex>
}`,
    fragmentShader: /* glsl */ `
varying vec3 vId;
varying vec4 vDecal;
varying vec2 vDecalUv;
${DECAL_SHAPE}
void main() {
  if ( e1DecalAlpha( vDecalUv * 2.0 - 1.0, vDecal.x, vDecal.y, max( 1.0, vDecal.z ) ) < 0.03 ) discard;
  gl_FragColor = vec4( vId, 1.0 );
}`,
    depthWrite: false,
  })

const decalMaterial = (): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({
    color: PALETTE.technique.neutre,
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    envMapIntensity: 0.12,
  })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace(
      'void main() {',
      'attribute vec4 aDecal;\nvarying vec4 vDecal;\nvarying vec2 vDecalUv;\nvoid main() {\n  vDecal = aDecal;\n  vDecalUv = uv;',
    )
    s.fragmentShader = s.fragmentShader
      .replace('void main() {', `varying vec4 vDecal;\nvarying vec2 vDecalUv;\n${DECAL_SHAPE}\nvoid main() {`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec2 e1p = vDecalUv * 2.0 - 1.0;
  float e1a = e1DecalAlpha( e1p, vDecal.x, vDecal.y, max( 1.0, vDecal.z ) );
  if ( e1a < 0.03 ) discard;
  float e1age = vDecal.w;
  diffuseColor.a *= clamp( e1a * 1.15, 0.0, 1.0 ) * ( vDecal.x > 2.5 ? 0.85 : 0.97 );
  if ( vDecal.x > 1.5 && vDecal.x < 2.5 ) diffuseColor.rgb *= mix( 1.0, 0.55, 1.0 - smoothstep( 0.0, 0.7, length( e1p ) ) );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix( 0.42, 0.85, smoothstep( 1.0, 12.0, e1age ) );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * 0.12 * ( 1.0 - step( 2.0, e1age ) );`,
      )
  }
  m.customProgramCacheKey = () => 'e1-decal'
  return m
}

const tmp = new Matrix4()
const tmpQ = new Quaternion()
const tmpE = new Euler()
const tmpP = new Vector3()
const tmpS = new Vector3()

export class GoreLayer {
  private readonly decals: Batch
  private readonly drops: Batch
  private readonly chunks: Batch

  constructor(parent: Object3D) {
    this.decals = new Batch(parent, {
      geometry: () => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      material: decalMaterial(),
      idMaterial: decalIdMaterial(),
      capacity: 512,
      cast: false,
      receive: true,
      renderOrder: 1,
      extra: { name: 'aDecal', size: 4 },
    })
    this.drops = new Batch(parent, {
      geometry: () => new SphereGeometry(0.5, 6, 4),
      material: new MeshStandardMaterial({
        color: PALETTE.technique.neutre,
        roughness: 0.15,
        emissive: 0x000000,
      }),
      idMaterial: null,
      capacity: 256,
      cast: false,
      receive: false,
    })
    this.chunks = new Batch(parent, {
      geometry: () => new IcosahedronGeometry(0.5, 0),
      material: new MeshStandardMaterial({
        color: PALETTE.technique.neutre,
        roughness: 0.35,
        flatShading: true,
      }),
      idMaterial: instancedIdMaterial(),
      capacity: 256,
      cast: true,
      receive: true,
    })
  }

  update(gore: GoreMemory, t: number): void {
    this.decals.begin()
    for (const d of gore.decals) {
      if (d.born > t) continue
      const k = decalScale(d, t)
      tmpQ.setFromEuler(tmpE.set(0, -d.rot, 0))
      tmp.compose(tmpP.set(d.x, 0.004, d.z), tmpQ, tmpS.set(d.size * 2 * k * d.len, 1, d.size * 2 * k))
      const age = (t - d.born) / 60
      this.decals.push(tmp, decalColor(t - d.born), 0, ROLE.decalque, [
        KIND_CODE[d.kind],
        d.seed,
        d.len,
        Math.min(60, age),
      ])
    }
    this.decals.end()

    this.drops.begin()
    for (const p of gore.droplets) {
      const age = t - p.born
      if (age < 0) continue
      const b = ballistic(p, t)
      if (b.landed) continue
      const a = age / 60
      const vy = p.vy - 9.8 * a
      const v = tmpP.set(p.vx, vy, p.vz)
      const speed = v.length()
      tmpQ.setFromUnitVectors(new Vector3(0, 1, 0), v.normalize())
      tmp.compose(new Vector3(b.x, b.y, b.z), tmpQ, tmpS.set(p.size, p.size * (1 + speed * 0.5), p.size))
      this.drops.push(tmp, isFresh(p, t) ? PALETTE.rougeVif : PALETTE.rougeBrun.sangAncien, 0, ROLE.autre)
    }
    this.drops.end()

    this.chunks.begin()
    for (const c of gore.chunks) {
      if (c.born > t) continue
      const b = ballistic(c, t)
      const spin = b.landed ? c.seed * 6.28 : c.seed * 6.28 + ((t - c.born) / 60) * 9
      tmpQ.setFromEuler(tmpE.set(spin, c.seed * 3.1, spin * 0.7))
      tmp.compose(
        new Vector3(b.x, Math.max(c.size * 0.35, b.y), b.z),
        tmpQ,
        tmpS.set(c.size, c.size * 0.7, c.size * 1.2),
      )
      this.chunks.push(tmp, c.kind === 'os' ? PALETTE.gore.os : PALETTE.gore.chair, 0, ROLE.autre)
    }
    this.chunks.end()
  }

  dispose(): void {
    this.decals.dispose()
    this.drops.dispose()
    this.chunks.dispose()
  }
}
