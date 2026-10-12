// Décor de La Fosse (E1, ART_DIRECTION « La Fosse », planche key-art-la-fosse) : fosse commune à ciel ouvert, la nuit.
// Sol de boue humide à flaques ; murs de terre où sont enchâssés crânes et os comme dans un ossuaire ; rebords de
// pierre portant chandelles et offrandes ; palissade de pieux qui borde l'aire de jeu ; torches sur poteaux et
// braseros sur pieux ; gibet et sa cloche rouillée ; bannières religieuses déchirées ; escalier de pierre le long du
// mur ; silhouettes encapuchonnées immobiles sur le bord. Toute la géométrie est générée par code et instanciée.
//
// Contrainte de la simulation : l'aire de jeu est le carré |x|, |z| ≤ TUNING.arenaHalf. Rien du décor n'y entre ;
// la palissade en marque le bord, le mur suit un carré arrondi qui le contient (forme d'une fosse ronde).
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TICK_HZ, TUNING } from '../sim/index'
import { ROLE, uniformIdMaterial } from './idpass'
import { type LightKind, type LightSource, source } from './lights'
import { cutMaterial, groundMaterial, pbr, type TextureBank } from './materials'
import { PALETTE } from './palette'
import type { QualitySpec } from './quality'

export const WALL_HALF = TUNING.arenaHalf + 3.5 // demi-côté du carré arrondi du mur
export const WALL_RADIUS = 7 // rayon des coins : le carré de jeu reste dedans (marge ≥ 0,293 × rayon)
export const PIT_DEPTH = 3.2 // hauteur du mur, du fond de la fosse au bord
const FENCE_OFFSET = 0.55 // palissade, hors de l'aire de jeu

export interface Flame {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly size: number
  readonly seed: number
}

export interface Decor {
  readonly group: Group
  readonly lights: readonly LightSource[]
  readonly flames: readonly Flame[]
  readonly groundMaterial: MeshStandardMaterial
  readonly materials: readonly Material[]
  update(t: number): void
  dispose(): void
}

// Générateur déterministe (aucun tirage du navigateur) : le décor est le même à chaque chargement.
const rnd = (i: number, k: number): number => {
  const s = Math.sin(i * 127.1 + k * 311.7 + 0.5) * 43758.5453
  return s - Math.floor(s)
}

// Contour du carré arrondi, échantillonné tous les `step` m : point, normale sortante, abscisse curviligne.
interface PathPoint {
  readonly x: number
  readonly z: number
  readonly nx: number
  readonly nz: number
  readonly s: number
}
export const roundedSquare = (half: number, radius: number, step: number): PathPoint[] => {
  const out: PathPoint[] = []
  const inner = half - radius
  const straight = 2 * inner
  const arc = (Math.PI / 2) * radius
  const side = straight + arc
  const total = 4 * side
  const n = Math.max(8, Math.round(total / step))
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total
    const k = Math.floor(s / side)
    const u = s - k * side
    // Côté k : on part du coin (k) et on longe le bord, puis l'arc vers le côté suivant.
    let lx: number
    let lz: number
    let nx: number
    let nz: number
    if (u < straight) {
      lx = -inner + u
      lz = -half
      nx = 0
      nz = -1
    } else {
      const a = -Math.PI / 2 + (u - straight) / radius
      lx = inner + Math.cos(a) * radius
      lz = -inner + Math.sin(a) * radius
      nx = Math.cos(a)
      nz = Math.sin(a)
    }
    // Rotation du côté k de k × 90°.
    const c = Math.cos((k * Math.PI) / 2)
    const sn = Math.sin((k * Math.PI) / 2)
    out.push({ x: lx * c - lz * sn, z: lx * sn + lz * c, nx: nx * c - nz * sn, nz: nx * sn + nz * c, s })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
// Géométries

// Bosses du mur de terre à l'abscisse s (m) et à la hauteur relative v (0 au pied, 1 au bord) : recul vers l'extérieur.
const wallBump = (s: number, v: number): number =>
  0.22 * Math.sin(s * 1.7 + v * 5.1) * Math.sin(s * 0.43 + 1.3) +
  0.12 * Math.sin(s * 4.3 + v * 9.7) +
  0.35 * v * v // évasement : le bord recule

// Mur de terre : bande verticale le long du contour, bosselée, un peu évasée vers le haut.
const wallGeometry = (path: readonly PathPoint[], height: number, rows: number): BufferGeometry => {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const n = path.length
  const total = (path[n - 1]?.s ?? 0) + ((path[1]?.s ?? 0) - (path[0]?.s ?? 0))
  for (let i = 0; i <= n; i++) {
    const p = path[i % n] as PathPoint
    const s = i === n ? total : p.s
    for (let r = 0; r <= rows; r++) {
      const v = r / rows
      const y = v * height
      const bump = wallBump(p.s, v)
      pos.push(p.x + p.nx * bump, y, p.z + p.nz * bump)
      uv.push(s / 3.2, y / 3.2)
    }
  }
  const cols = rows + 1
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < rows; r++) {
      const a = i * cols + r
      const b = (i + 1) * cols + r
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const g = new PlaneGeometry(1, 1)
  g.setIndex(idx)
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.deleteAttribute('normal')
  g.computeVertexNormals()
  // Les faces regardent vers l'intérieur de la fosse : on retourne les normales calculées si besoin.
  const nrm = g.getAttribute('normal')
  const p0 = path[0] as PathPoint
  if ((nrm.getX(0) ?? 0) * p0.nx + (nrm.getZ(0) ?? 0) * p0.nz > 0) {
    g.setIndex(idx.map((_, k) => idx[k - (k % 3) + (2 - (k % 3))] as number))
    g.computeVertexNormals()
  }
  return g
}

// Bord supérieur : bande horizontale qui part du haut du mur (mêmes bosses) et s'étend vers l'extérieur.
const rimGeometry = (path: readonly PathPoint[], height: number, width: number): BufferGeometry => {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const n = path.length
  for (let i = 0; i <= n; i++) {
    const p = path[i % n] as PathPoint
    const b = wallBump(p.s, 1) - 0.02
    for (const [k, d] of [
      [0, b],
      [1, b + 1.2],
      [2, b + width],
    ] as const) {
      const x = p.x + p.nx * d
      const z = p.z + p.nz * d
      pos.push(x, height + (k === 1 ? 0.05 : 0), z)
      uv.push(x / 3.2, z / 3.2)
    }
  }
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 2; r++) {
      const a = i * 3 + r
      const c = (i + 1) * 3 + r
      idx.push(a, c, a + 1, a + 1, c, c + 1)
    }
  }
  const g = new PlaneGeometry(1, 1)
  g.setIndex(idx)
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.deleteAttribute('normal')
  g.computeVertexNormals()
  const nrm = g.getAttribute('normal')
  if ((nrm.getY(0) ?? 0) < 0) {
    g.setIndex(idx.map((_, k) => idx[k - (k % 3) + (2 - (k % 3))] as number))
    g.computeVertexNormals()
  }
  return g
}

// Crâne : sphère déformée (orbites, cavité nasale, mâchoire), sombre dans les creux (couleurs de sommets).
const skullGeometry = (): BufferGeometry => {
  const g = new SphereGeometry(0.5, 14, 10)
  const p = g.getAttribute('position')
  const col: number[] = []
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i)
    const y = p.getY(i)
    let z = p.getZ(i)
    x *= 0.78
    z *= 1.05
    if (y < -0.1) {
      x *= 0.8
      z *= 0.92
    }
    let shade = 1
    if (z > 0.15) {
      for (const ex of [-0.17, 0.17]) {
        const d = Math.hypot(x - ex, y - 0.04)
        if (d < 0.14) {
          const k = 1 - d / 0.14
          z -= 0.16 * k
          shade = Math.min(shade, 1 - 0.85 * k)
        }
      }
      const dn = Math.hypot(x * 1.6, y + 0.16)
      if (dn < 0.08) {
        z -= 0.08
        shade = Math.min(shade, 0.25)
      }
      if (y < -0.28) shade = Math.min(shade, 0.7)
    }
    p.setXYZ(i, x, y, z)
    col.push(shade, shade, shade)
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

// Pieu : fût et pointe, un peu de travers.
const stakeGeometry = (): BufferGeometry => {
  const shaft = new CylinderGeometry(0.07, 0.085, 1, 7, 1)
  shaft.translate(0, 0.5, 0)
  const tip = new ConeGeometry(0.07, 0.28, 7, 1)
  tip.translate(0, 1.14, 0)
  const g = mergeGeometries([shaft.toNonIndexed(), tip.toNonIndexed()])
  return g ?? shaft
}

// Silhouette encapuchonnée : robe conique, capuche, épaules.
const watcherGeometry = (): BufferGeometry => {
  const robe = new ConeGeometry(0.42, 1.55, 10, 1, true)
  robe.translate(0, 0.78, 0)
  const shoulders = new SphereGeometry(0.26, 10, 6)
  shoulders.scale(1.25, 0.7, 0.85)
  shoulders.translate(0, 1.42, 0)
  const hood = new ConeGeometry(0.2, 0.5, 9, 1)
  hood.translate(0, 1.78, -0.02)
  const head = new SphereGeometry(0.17, 9, 7)
  head.translate(0, 1.62, 0.02)
  return (
    mergeGeometries([
      robe.toNonIndexed(),
      shoulders.toNonIndexed(),
      hood.toNonIndexed(),
      head.toNonIndexed(),
    ]) ?? robe
  )
}

// Cloche rouillée (profil de révolution).
const bellGeometry = (): BufferGeometry => {
  const pts: Vector2[] = []
  for (let i = 0; i <= 12; i++) {
    const v = i / 12
    const r = 0.12 + 0.3 * v ** 2.2 + (v > 0.9 ? 0.04 : 0)
    pts.push(new Vector2(r, 0.62 * (1 - v)))
  }
  return new LatheGeometry(pts, 18)
}

// Vasque du brasero.
const bowlGeometry = (): BufferGeometry => {
  const pts: Vector2[] = []
  for (let i = 0; i <= 8; i++) {
    const v = i / 8
    pts.push(new Vector2(0.08 + 0.42 * Math.sin((v * Math.PI) / 2), 0.32 * v))
  }
  return new LatheGeometry(pts, 14)
}

const compose = (
  x: number,
  y: number,
  z: number,
  ry: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  rz = 0,
): Matrix4 => {
  const q = new Quaternion().setFromEuler(new Object3D().rotation.set(rx, ry, rz))
  return new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(sx, sy, sz))
}

const instanced = (
  geo: BufferGeometry,
  mat: Material,
  mats: readonly Matrix4[],
  cast: boolean,
  receive: boolean,
): InstancedMesh => {
  const m = new InstancedMesh(geo, mat, Math.max(1, mats.length))
  for (let i = 0; i < mats.length; i++) m.setMatrixAt(i, mats[i] as Matrix4)
  m.count = mats.length
  m.castShadow = cast
  m.receiveShadow = receive
  m.instanceMatrix.needsUpdate = true
  m.computeBoundingSphere()
  m.userData.idMaterial = uniformIdMaterial(0, ROLE.autre, { cut: mat.userData.cut === true })
  return m
}

// ---------------------------------------------------------------------------------------------------------

export const buildDecor = (bank: TextureBank, q: QualitySpec): Decor => {
  const group = new Group()
  const materials: Material[] = []
  const lights: LightSource[] = []
  const flames: Flame[] = []
  const add = <T extends Object3D>(o: T): T => {
    group.add(o)
    return o
  }
  const mat = <T extends Material>(m: T): T => {
    materials.push(m)
    return m
  }
  const light = (
    kind: LightKind,
    key: string,
    x: number,
    y: number,
    z: number,
    patch: Partial<LightSource> = {},
  ) => {
    lights.push(source(kind, key, x, y, z, patch))
  }
  const flame = (x: number, y: number, z: number, size: number, key: string) => {
    for (let k = 0; k < q.flamesPerTorch; k++) {
      const a = rnd(flames.length, 3) * Math.PI * 2
      const r = k === 0 ? 0 : size * 0.18
      flames.push({
        x: x + Math.cos(a) * r,
        y: y + k * size * 0.08,
        z: z + Math.sin(a) * r,
        size: size * (1 - 0.22 * k),
        seed: rnd(flames.length, 9) * 100 + key.length,
      })
    }
  }

  const H = PIT_DEPTH
  const A = TUNING.arenaHalf

  // Sol de la fosse : boue humide, flaques.
  const groundSize = 2 * WALL_HALF + 4
  const groundMat = mat(
    groundMaterial(bank.repeated('boue', groundSize / 3.2, groundSize / 3.2), WALL_HALF, WALL_RADIUS),
  )
  const ground = add(
    new Mesh(new PlaneGeometry(groundSize, groundSize, 1, 1).rotateX(-Math.PI / 2), groundMat),
  )
  ground.receiveShadow = true
  ground.userData.idMaterial = uniformIdMaterial(0, ROLE.sol)

  // Mur de terre.
  const path = roundedSquare(WALL_HALF, WALL_RADIUS, 0.45)
  const terre = bank.set('terre')
  const wallMat = mat(
    cutMaterial(pbr(terre, { tint: PALETTE.matiere.terre, normalScale: 1.3, envIntensity: 0.1 }), 'mur'),
  )
  const wall = add(new Mesh(wallGeometry(path, H, 8), wallMat))
  wall.receiveShadow = true
  wall.castShadow = true
  wall.userData.idMaterial = uniformIdMaterial(0, ROLE.autre, { cut: wallMat.userData.cut === true })

  // Bord supérieur : terrain au niveau du bord, percé du carré arrondi.
  {
    const g = rimGeometry(path, H, 26)
    const topMat = mat(
      cutMaterial(pbr(terre, { tint: PALETTE.matiere.boue, normalScale: 1, envIntensity: 0.1 }), 'bord'),
    )
    const top = add(new Mesh(g, topMat))
    top.receiveShadow = true
    top.userData.idMaterial = uniformIdMaterial(0, ROLE.autre, { cut: topMat.userData.cut === true })
  }

  // Ossuaire : crânes et os enchâssés dans le mur, par travées.
  {
    const skulls: Matrix4[] = []
    const bones: Matrix4[] = []
    const density = q.level === 'haute' ? 1 : 0.55
    path.forEach((p, i) => {
      const bay = Math.floor(p.s / 7)
      if (rnd(bay, 1) < 0.28) return // travée de terre nue
      const yaw = Math.atan2(-p.nx, -p.nz)
      for (let r = 0; r < 9; r++) {
        if (rnd(i, r + 20) > 0.8 * density) continue
        const y = 0.35 + r * 0.29 + (rnd(i, r) - 0.5) * 0.06
        if (r % 3 === 2) {
          bones.push(
            compose(
              p.x - p.nx * 0.02,
              y,
              p.z - p.nz * 0.02,
              yaw + Math.PI / 2,
              0.05,
              0.5,
              0.05,
              0,
              Math.PI / 2 + (rnd(i, r + 7) - 0.5) * 0.2,
            ),
          )
          continue
        }
        const sz = 0.2 + rnd(i, r + 3) * 0.05
        const bump = wallBump(p.s, y / H)
        skulls.push(
          compose(
            p.x + p.nx * (bump - 0.07),
            y,
            p.z + p.nz * (bump - 0.07),
            yaw + (rnd(i, r + 5) - 0.5) * 0.5,
            sz,
            sz,
            sz,
            (rnd(i, r + 6) - 0.5) * 0.4,
            (rnd(i, r + 8) - 0.5) * 0.4,
          ),
        )
      }
    })
    const boneMat = mat(pbr(null, { tint: PALETTE.matiere.osSale, roughness: 0.8 }))
    boneMat.vertexColors = true
    add(instanced(skullGeometry(), boneMat, skulls, false, true))
    const longBoneMat = mat(pbr(null, { tint: PALETTE.matiere.osSale, roughness: 0.85 }))
    add(instanced(new CylinderGeometry(0.5, 0.5, 1, 6), longBoneMat, bones, false, true))
  }

  // Rebords de pierre au pied du mur, chandelles et offrandes dessus.
  const pierre = bank.set('pierre')
  const stoneMat = mat(
    cutMaterial(
      pbr(pierre, { tint: PALETTE.matiere.pierre, normalScale: 1.2, envIntensity: 0.15 }),
      'pierre',
    ),
  )
  const waxMat = mat(pbr(null, { tint: PALETTE.matiere.cire, roughness: 0.55 }))
  {
    const ledges: Matrix4[] = []
    const candles: Matrix4[] = []
    let cluster = 0
    path.forEach((p, i) => {
      const seg = Math.floor(p.s / 5.5)
      if (rnd(seg, 40) < 0.5 || i % 2) return
      const yaw = Math.atan2(-p.nx, -p.nz)
      ledges.push(compose(p.x - p.nx * 0.35, 0.55, p.z - p.nz * 0.35, yaw, 0.95, 1.1, 0.7))
      if (rnd(i, 41) < 0.55) {
        const n = 2 + Math.floor(rnd(i, 42) * 4)
        for (let k = 0; k < n; k++) {
          const ox = (rnd(i, 50 + k) - 0.5) * 0.7
          const oz = (rnd(i, 60 + k) - 0.5) * 0.3
          const h = 0.08 + rnd(i, 70 + k) * 0.16
          const cx = p.x - p.nx * 0.35 + Math.cos(yaw) * ox - p.nx * oz
          const cz = p.z - p.nz * 0.35 - Math.sin(yaw) * ox - p.nz * oz
          candles.push(compose(cx, 1.1 + h / 2, cz, 0, 0.035, h, 0.035))
          flames.push({ x: cx, y: 1.1 + h + 0.035, z: cz, size: 0.07, seed: rnd(i, 80 + k) * 100 })
        }
        light('chandelle', `chandelle:${cluster++}`, p.x - p.nx * 0.6, 1.4, p.z - p.nz * 0.6)
      }
    })
    // Chandelles et offrandes posées dans la boue (planche : chandelles au sol), loin du centre de l'arène : petites,
    // elles ne cachent personne, et chaque groupe est une source de lumière fixe.
    const offerings: Matrix4[] = []
    for (let g = 0; g < 7; g++) {
      const a = (g / 7) * Math.PI * 2 + 0.4
      const r = 9.5 + rnd(g, 120) * 3.5
      const gx = Math.cos(a) * r
      const gz = Math.sin(a) * r
      const n = 3 + Math.floor(rnd(g, 121) * 4)
      for (let k = 0; k < n; k++) {
        const ox = (rnd(g, 130 + k) - 0.5) * 0.7
        const oz = (rnd(g, 140 + k) - 0.5) * 0.7
        const h = 0.06 + rnd(g, 150 + k) * 0.14
        candles.push(compose(gx + ox, h / 2, gz + oz, 0, 0.03, h, 0.03))
        flames.push({ x: gx + ox, y: h + 0.03, z: gz + oz, size: 0.06, seed: rnd(g, 160 + k) * 100 })
      }
      offerings.push(compose(gx + 0.25, 0.04, gz - 0.2, rnd(g, 170) * 6, 0.22, 0.08, 0.16))
      light('chandelle', `chandelle-sol:${g}`, gx, 0.6, gz, { intensity: 3, range: 4 })
    }
    add(instanced(new BoxGeometry(1, 1, 1), stoneMat, ledges, true, true))
    add(instanced(new CylinderGeometry(1, 1, 1, 7), waxMat, candles, false, true))
    add(instanced(new BoxGeometry(1, 1, 1), waxMat, offerings, false, true))
  }

  // Ossements épars dans la boue : os longs et crânes couchés, loin du centre (ils ne cachent aucun corps des scènes
  // de mesure) ; os terni et sale, loin de l'ivoire du liseré.
  {
    const lying: Matrix4[] = []
    const heads: Matrix4[] = []
    for (let i = 0; i < 90; i++) {
      const a = rnd(i, 200) * Math.PI * 2
      const r = 8.5 + rnd(i, 201) * (TUNING.arenaHalf - 8.5)
      const x = Math.max(-A, Math.min(A, Math.cos(a) * r * 1.2))
      const z = Math.max(-A, Math.min(A, Math.sin(a) * r * 1.2))
      if (i % 4 === 0) heads.push(compose(x, 0.07, z, rnd(i, 202) * 6, 0.17, 0.17, 0.17, 0.4, rnd(i, 203)))
      else lying.push(compose(x, 0.03, z, rnd(i, 204) * 6, 0.04, 0.35 + rnd(i, 205) * 0.2, 0.04, Math.PI / 2))
    }
    const scatterMat = mat(pbr(null, { tint: PALETTE.matiere.osSale, roughness: 0.8 }))
    scatterMat.vertexColors = true
    add(instanced(skullGeometry(), scatterMat, heads, true, true))
    add(
      instanced(
        new CylinderGeometry(0.5, 0.5, 1, 6),
        mat(pbr(null, { tint: PALETTE.matiere.osSale, roughness: 0.85 })),
        lying,
        true,
        true,
      ),
    )
  }

  // Palissade : pieux qui bordent l'aire de jeu, avec des brèches.
  const bois = bank.set('bois')
  const woodMat = mat(
    cutMaterial(pbr(bois, { tint: PALETTE.matiere.bois, normalScale: 1.2, envIntensity: 0.1 }), 'bois'),
  )
  {
    const stakes: Matrix4[] = []
    const edge = A + FENCE_OFFSET
    let k = 0
    for (let side = 0; side < 4; side++) {
      for (let u = -edge; u <= edge; u += 1.05) {
        k++
        if (rnd(k, 1) < 0.18) continue
        const h = 0.75 + rnd(k, 2) * 0.85
        const lx = u + (rnd(k, 3) - 0.5) * 0.25
        const lz = edge + (rnd(k, 4) - 0.5) * 0.25
        const c = Math.cos((side * Math.PI) / 2)
        const s = Math.sin((side * Math.PI) / 2)
        stakes.push(
          compose(
            lx * c - lz * s,
            0,
            lx * s + lz * c,
            rnd(k, 5) * 6,
            1,
            h,
            1,
            (rnd(k, 6) - 0.5) * 0.25,
            (rnd(k, 7) - 0.5) * 0.25,
          ),
        )
      }
    }
    add(instanced(stakeGeometry(), woodMat, stakes, true, true))
  }

  // Torches sur poteaux (dans la bande entre la palissade et le mur) et braseros sur pieux, aux milieux des côtés.
  const fer = bank.set('fer')
  const ironMat = mat(
    cutMaterial(
      pbr(fer, { tint: PALETTE.matiere.fer, roughness: 1, useArmMetal: true, envIntensity: 0.3 }),
      'fer',
    ),
  )
  {
    const posts: Matrix4[] = []
    const cages: Matrix4[] = []
    const bowls: Matrix4[] = []
    const band = A + 1.6
    let n = 0
    for (let side = 0; side < 4; side++) {
      const c = Math.cos((side * Math.PI) / 2)
      const s = Math.sin((side * Math.PI) / 2)
      for (const u of [-11, -4.5, 4.5, 11]) {
        const x = u * c - band * s
        const z = u * s + band * c
        const h = 2.5 + rnd(n, 11) * 0.3
        posts.push(compose(x, h / 2, z, 0, 0.09, h, 0.09))
        cages.push(compose(x, h + 0.12, z, rnd(n, 12), 0.16, 0.26, 0.16))
        flame(x, h + 0.3, z, 0.42, `torche:${n}`)
        light('torche', `torche:${n}`, x, h + 0.38, z)
        n++
      }
      // Brasero au milieu du côté.
      const bx = -(band + 0.3) * s
      const bz = (band + 0.3) * c
      posts.push(compose(bx, 0.55, bz, 0, 0.12, 1.1, 0.12))
      bowls.push(compose(bx, 1.05, bz, 0, 1, 1, 1))
      flame(bx, 1.4, bz, 0.75, `brasero:${side}`)
      light('brasero', `brasero:${side}`, bx, 1.75, bz)
    }
    add(instanced(new CylinderGeometry(1, 1.2, 1, 7), woodMat, posts, true, true))
    add(instanced(new CylinderGeometry(1, 0.7, 1, 6, 1, true), ironMat, cages, true, false))
    add(instanced(bowlGeometry(), ironMat, bowls, true, true))
  }

  // Escalier de pierre le long du mur (côté −z), du fond de la fosse au bord.
  {
    const steps: Matrix4[] = []
    const z0 = -WALL_HALF + 0.85
    const nSteps = 12
    for (let i = 0; i < nSteps; i++) {
      const h = ((i + 1) / nSteps) * H
      steps.push(compose(1.5 + i * 0.62, h / 2, z0, 0, 0.62, h, 1.5))
    }
    add(instanced(new BoxGeometry(1, 1, 1), stoneMat, steps, true, true))
  }

  // Gibet sur le bord (côté −x) et sa cloche rouillée.
  let bell: Mesh | null = null
  {
    const gx = -WALL_HALF - 1.4
    const gz = -3
    const beams: Matrix4[] = [
      compose(gx, H + 1.9, gz - 1.4, 0, 0.16, 3.8, 0.16),
      compose(gx, H + 1.9, gz + 1.4, 0, 0.16, 3.8, 0.16),
      compose(gx, H + 3.7, gz, 0, 0.18, 0.18, 3.4),
      compose(gx, H + 3.1, gz - 1.05, 0, 0.1, 0.1, 1.0, Math.PI / 4),
    ]
    add(instanced(new BoxGeometry(1, 1, 1), woodMat, beams, true, true))
    const links: Matrix4[] = []
    for (let i = 0; i < 6; i++)
      links.push(compose(gx, H + 3.55 - i * 0.11, gz, (i % 2) * (Math.PI / 2), 0.06, 0.06, 0.06))
    add(instanced(new TorusGeometry(0.7, 0.18, 5, 10), ironMat, links, true, false))
    bell = add(new Mesh(bellGeometry(), ironMat))
    bell.position.set(gx, H + 2.25, gz)
    bell.castShadow = true
    bell.userData.idMaterial = uniformIdMaterial(0, ROLE.autre, { cut: ironMat.userData.cut === true })
  }

  // Croix et pieux plantés sur le bord, au fond.
  {
    const crosses: Matrix4[] = []
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.75 + (i / 8) * Math.PI * 0.5
      const r = WALL_HALF + 3 + rnd(i, 30) * 4
      const x = Math.cos(a) * r * 1.15
      const z = Math.sin(a) * r * 1.15
      const h = 2.4 + rnd(i, 31) * 1.2
      const tilt = (rnd(i, 32) - 0.5) * 0.3
      crosses.push(compose(x, H + h / 2, z, a, 0.14, h, 0.14, tilt))
      crosses.push(compose(x, H + h * 0.72, z, a, 0.12, 0.12, 1.2, tilt))
    }
    add(instanced(new BoxGeometry(1, 1, 1), woodMat, crosses, true, false))
  }

  // Bannières religieuses déchirées (images GPT Image), sur des hampes au bord.
  const banners: { mesh: Mesh; seed: number }[] = []
  {
    const bannerMats = ['banniere-1', 'banniere-2'].map((name) => {
      const tex = bank.generated(name)
      const m = mat(
        new MeshStandardMaterial({
          map: tex,
          color: PALETTE.technique.neutre,
          roughness: 0.95,
          alphaTest: 0.5,
          side: DoubleSide,
        }),
      )
      return m
    })
    const spots: [number, number][] = [
      [-WALL_HALF - 0.9, 7],
      [-WALL_HALF - 0.9, -9],
      [6, -WALL_HALF - 0.9],
      [-8, -WALL_HALF - 0.9],
      [WALL_HALF + 0.9, -6],
      [-11, WALL_HALF + 0.9],
      [9, WALL_HALF + 0.9],
      [WALL_HALF + 0.9, 8],
    ]
    const poles: Matrix4[] = []
    spots.forEach(([x, z], i) => {
      const yaw = Math.atan2(-x, -z)
      poles.push(compose(x, H + 1.6, z, 0, 0.07, 3.2, 0.07))
      const g = new PlaneGeometry(1.1, 1.85)
      g.translate(0, -0.92, 0)
      const bm = bannerMats[i % 2] as MeshStandardMaterial
      const m = new Mesh(g, bm)
      m.position.set(x - Math.sin(yaw) * 0.08, H + 3.0, z - Math.cos(yaw) * 0.08)
      m.rotation.set(0, yaw, 0)
      m.castShadow = true
      // Passe d'identification : même seuil d'alpha que la toile déchirée.
      if (bm.map)
        m.userData.idMaterial = uniformIdMaterial(0, ROLE.autre, {
          side: bm.side,
          alphaMap: { map: bm.map, test: bm.alphaTest },
        })
      add(m)
      banners.push({ mesh: m, seed: i * 1.7 })
    })
    add(instanced(new CylinderGeometry(1, 1, 1, 6), woodMat, poles, true, false))
  }

  // Silhouettes encapuchonnées sur le bord : elles regardent la fosse, sans réagir.
  const watcherMat = mat(
    cutMaterial(
      pbr(bank.set('tissu'), { tint: PALETTE.matiere.silhouette, normalScale: 1, envIntensity: 0 }),
      'silhouette',
    ),
  )
  const watcherBase: Matrix4[] = []
  const watchers = (() => {
    const pts: [number, number][] = []
    const rimPath = roundedSquare(WALL_HALF + 1.2, WALL_RADIUS + 1.2, 1)
    rimPath.forEach((p, i) => {
      if (rnd(i, 90) < 0.88) return
      pts.push([p.x, p.z])
    })
    for (const [x, z] of pts.slice(0, 22)) watcherBase.push(compose(x, H, z, Math.atan2(-x, -z), 1, 1, 1))
    const m = instanced(watcherGeometry(), watcherMat, watcherBase, true, false)
    add(m)
    return m
  })()

  // Lune : source fixe (direction), éclaire les morts en luminance comme le reste.
  // Placée derrière la caméra (côté +x, +z) : son reflet dans les flaques sort du cadre, ce sont les flammes que la
  // boue reflète (planche) ; les ombres de lune partent vers le haut de l'écran.
  lights.push(source('lune', 'lune', 16, 30, 12))

  // Flammes : quads tournés vers la caméra, forme et vacillement dans le shader (émissif HDR, halo du bloom).
  const flameMesh = (() => {
    const geo = new PlaneGeometry(1, 1.6)
    geo.translate(0, 0.55, 0)
    const m = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCore: { value: new Color(PALETTE.flamme.coeur) },
        uEdge: { value: new Color(PALETTE.flamme.bord) },
      },
      vertexShader: /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  vec3 c = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  float s = length( instanceMatrix[ 0 ].xyz );
  vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
  vec3 up = vec3( 0.0, 1.0, 0.0 );
  vec3 w = c + right * position.x * s + up * position.y * s;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4( w, 1.0 );
}`,
      fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vSeed;
float h( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
float n2( vec2 p ) { vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h( i ), h( i + vec2( 1, 0 ) ), f.x ), mix( h( i + vec2( 0, 1 ) ), h( i + vec2( 1, 1 ) ), f.x ), f.y ); }
void main() {
  vec2 p = vUv - vec2( 0.5, 0.0 );
  float t = uTime * 2.2 + vSeed;
  float wob = ( n2( vec2( p.y * 4.0 - t * 1.7, vSeed ) ) - 0.5 ) * 0.22 * p.y;
  float x = ( p.x + wob ) / max( 0.001, 0.36 * ( 1.0 - pow( p.y, 0.8 ) ) + 0.02 );
  float body = clamp( 1.0 - x * x, 0.0, 1.0 ) * smoothstep( 0.0, 0.08, p.y ) * ( 1.0 - smoothstep( 0.55, 1.0, p.y ) );
  float tongues = n2( vec2( p.x * 6.0, p.y * 5.0 - t * 3.0 ) );
  float a = body * smoothstep( 0.15, 0.7, body + tongues * 0.35 - p.y * 0.3 );
  if ( a < 0.01 ) discard;
  vec3 col = mix( uEdge, uCore, smoothstep( 0.2, 0.85, body ) ) * ( 1.6 + 3.4 * body );
  gl_FragColor = vec4( col, a );
}`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    materials.push(m)
    const mesh = new InstancedMesh(geo, m, Math.max(1, flames.length))
    const seeds = new Float32Array(Math.max(1, flames.length))
    flames.forEach((f, i) => {
      mesh.setMatrixAt(i, compose(f.x, f.y, f.z, 0, f.size, f.size, f.size))
      seeds[i] = f.seed
    })
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1))
    mesh.count = flames.length
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    mesh.instanceMatrix.needsUpdate = true
    add(mesh)
    return mesh
  })()

  const tmp = new Matrix4()
  const flameUniforms = (flameMesh.material as ShaderMaterial).uniforms
  return {
    group,
    lights,
    flames,
    groundMaterial: groundMat,
    materials,
    update(t: number) {
      if (flameUniforms.uTime) flameUniforms.uTime.value = t / TICK_HZ
      const s = t / TICK_HZ
      for (const b of banners) {
        b.mesh.rotation.x = 0.05 * Math.sin(s * 0.9 + b.seed) + 0.03 * Math.sin(s * 2.3 + b.seed * 2)
        b.mesh.rotation.z = 0.025 * Math.sin(s * 0.7 + b.seed * 3)
      }
      if (bell) bell.rotation.z = 0.04 * Math.sin(s * 0.5)
      // Respiration à peine visible des silhouettes (elles vivent, et ne réagissent pas).
      watcherBase.forEach((base, i) => {
        const k = 1 + 0.012 * Math.sin(s * 1.3 + i * 2.1)
        tmp.copy(base).multiply(new Matrix4().makeScale(1, k, 1))
        watchers.setMatrixAt(i, tmp)
      })
      watchers.instanceMatrix.needsUpdate = true
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose()
      })
      for (const m of materials) m.dispose()
    },
  }
}
