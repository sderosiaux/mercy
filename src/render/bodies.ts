// Corps et signaux au sol (E1). Les vivants vont dans la scène éclairée, une matière par sorte (chair, tissu, cuir,
// fer, os, bois) ; les morts aussi (E8 : gris, immobiles, sous la lumière du lieu comme tout le reste), avec une
// doublure qui porte leur ombre ; les signaux vont dans la couche des signaux, dessinée après le post-traitement et
// testée contre la profondeur de la scène : liseré (coque inversée), marques dorées, éclats, télégraphes (par-dessus
// les morts), halo de prière au sol, sceau de Sentence.
import {
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  type Quaternion,
  RingGeometry,
  type ShaderMaterial,
  type Side,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { type Creature, TUNING, type Vec2, type World } from '../sim/index'
import { Batch, Pool } from './batch'
import { RENDER } from './constants'
import { instancedIdMaterial, ROLE, uniformIdMaterial } from './idpass'
import { DEAD_PROXY_LAYER } from './lightrig'
import { telegraphColor } from './look'
import { DEAD_RENDER_ORDER, deadMaterial, signalMaterial } from './materials'
import { PALETTE } from './palette'
import { type Body, MATTERS, type Matter, type Shape } from './rig'
import { telegraphPulse, telegraphZones } from './telegraph'

const RIM_M = 0.04 // forme (C4) : épaisseur du liseré, m
const RIM_STRONG_M = 0.065 // liseré intensifié sous le curseur de Sentence (§21)
const GLOW_HDR = 1.0 // sac, halo en prière, reliquaire : émissif modéré, la teinte tient sous la courbe ACES

export const unitGeometry = (s: Shape): BufferGeometry => {
  switch (s) {
    case 'box':
      return new BoxGeometry(1, 1, 1)
    case 'sphere':
      return new SphereGeometry(0.5, 18, 12)
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 16)
    case 'cone':
      return new ConeGeometry(0.5, 1, 18)
    case 'torus':
      return new TorusGeometry(0.45, 0.05, 8, 28)
  }
}

const SHAPES: readonly Shape[] = ['box', 'sphere', 'cylinder', 'cone', 'torus']

// Scène éclairée (vivants et morts) et couche des signaux, dessinée en trois passes dans cet ordre : sol (halo de
// prière, sceau), télégraphes (au-dessus des morts), signaux des corps (liseré, marques, éclats).
export interface OverlayLayers {
  readonly scene: Object3D
  readonly ground: Object3D
  readonly tel: Object3D
  readonly signals: Object3D
}

export class BodyLayer {
  private readonly batches = new Map<string, Batch>()
  private readonly pools: Pool[]
  private readonly telBorder: Pool
  private readonly telFill: Pool
  private readonly telProgress: Pool
  private readonly telEdge: Pool
  private readonly halos: Pool
  private readonly haloEdges: Pool
  private readonly seals: Pool
  private readonly sectorCache = new Map<string, BufferGeometry>()
  private readonly lane: BufferGeometry
  private readonly tmp = new Matrix4()
  private readonly tmpS = new Matrix4()
  private readonly tmpV = new Vector3()
  readonly materials: Material[] = []
  showTelegraphs = true // instrument (audit §30.13) : masquer les télégraphes pour isoler leurs pixels

  constructor(layers: OverlayLayers, matterMaterials: Readonly<Record<Matter, Material>>, shadows: boolean) {
    const { scene } = layers
    // Une matière d'identification par lot (son état de rendu suit celui de la matière couleur du lot) ; dans la
    // couche des signaux, avec le test contre la profondeur de la scène de la matière couleur (idpass.ts).
    const idScene = (): ShaderMaterial => instancedIdMaterial()
    const idSignal = (side: Side = FrontSide): ShaderMaterial =>
      instancedIdMaterial({ side, sceneDepth: 'signal' })
    // Lueur (sac, halo en prière, flamme du reliquaire) : surtout émissive (sa couleur ne dépend pas des lumières
    // voisines, qui la brûleraient en blanc), un peu éclairée pour garder un volume.
    // Opaque : une lueur semi-transparente sur un fond chaud vire à l’olive, puis à l’or (audit §30.10).
    const glowMat = new MeshStandardMaterial({
      color: PALETTE.technique.neutre,
      roughness: 0.7, // reflets larges et faibles : une tache blanche sur le sac se lirait comme l’ivoire
      metalness: 0,
    })
    glowMat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * 0.5;
  diffuseColor.rgb *= 0.2;`,
      )
    }
    glowMat.customProgramCacheKey = () => 'e1-glow'
    const rimMat = signalMaterial({ side: BackSide })
    const flatMat = signalMaterial({})
    const deadMat = deadMaterial()
    const proxyMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    this.materials.push(glowMat, rimMat, flatMat, deadMat, proxyMat)
    for (const s of SHAPES) {
      const geometry = () => unitGeometry(s)
      const big = s === 'box'
      for (const m of MATTERS) {
        this.batches.set(
          `${m}:${s}`,
          new Batch(scene, {
            geometry,
            material: matterMaterials[m],
            idMaterial: idScene(),
            capacity: big ? 1024 : 128,
            cast: shadows,
            receive: shadows,
          }),
        )
      }
      this.batches.set(
        `glow:${s}`,
        new Batch(scene, {
          geometry,
          material: glowMat,
          idMaterial: idScene(),
          capacity: 64,
          cast: false,
          receive: false,
          colorScale: GLOW_HDR,
        }),
      )
      this.batches.set(
        `rim:${s}`,
        new Batch(layers.signals, {
          geometry,
          material: rimMat,
          idMaterial: idSignal(BackSide),
          capacity: big ? 2048 : 256,
          cast: false,
          receive: false,
        }),
      )
      this.batches.set(
        `flat:${s}`,
        new Batch(layers.signals, {
          geometry,
          material: flatMat,
          idMaterial: idSignal(),
          capacity: 256,
          cast: false,
          receive: false,
        }),
      )
      this.batches.set(
        `dead:${s}`,
        new Batch(scene, {
          geometry,
          material: deadMat,
          idMaterial: idScene(),
          capacity: big ? 4096 : 512,
          cast: false,
          receive: shadows,
          renderOrder: DEAD_RENDER_ORDER,
        }),
      )
      this.batches.set(
        `deadShadow:${s}`,
        new Batch(scene, {
          geometry,
          material: proxyMat,
          idMaterial: null,
          capacity: big ? 4096 : 512,
          cast: shadows,
          receive: false,
          layer: DEAD_PROXY_LAYER,
        }),
      )
    }
    this.lane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0)
    // Télégraphes : par-dessus les morts (un mort de la scène ne les cache pas, e8TelegraphDepthTest), sous les vivants
    // (test contre la profondeur de la scène). Halo de prière et sceau : sous les morts (un effet de support ne teint
    // jamais un mort). La passe d'identification fait de même (arbitrage E4) : un pixel de télégraphe sur un mort est
    // au télégraphe.
    const make =
      (opacity: number, order: number, overDead: boolean, stripes = false) =>
      (): Mesh => {
        const mat = signalMaterial({
          side: DoubleSide,
          transparent: opacity < 1,
          opacity,
          depthWrite: false,
          depthTest: !overDead,
          stripes,
          sceneDepth: overDead ? 'télégraphe' : 'signal',
        })
        mat.color.setHex(PALETTE.rougeBrun.telegraphe)
        const m = new Mesh(this.lane, mat)
        m.renderOrder = 2 + order
        m.userData.idMaterial = uniformIdMaterial(0, ROLE.autre, {
          side: DoubleSide,
          depthWrite: false,
          sceneDepth: overDead ? 'télégraphe' : 'signal',
        })
        return m
      }
    this.telBorder = new Pool(layers.tel, make(0.9, 0, true))
    this.telFill = new Pool(layers.tel, make(0.3, 1, true, true))
    this.telProgress = new Pool(layers.tel, make(0.45, 2, true))
    this.telEdge = new Pool(layers.tel, make(1, 3, true))
    this.halos = new Pool(layers.ground, make(0.22, 0, false))
    this.haloEdges = new Pool(layers.ground, make(0.9, 1, false))
    this.seals = new Pool(layers.ground, make(1, 3, false))
    this.pools = [
      this.telBorder,
      this.telFill,
      this.telProgress,
      this.telEdge,
      this.halos,
      this.haloEdges,
      this.seals,
    ]
  }

  private batch(key: string): Batch {
    const b = this.batches.get(key)
    if (!b) throw new Error(`lot absent ${key}`)
    return b
  }

  begin(): void {
    for (const b of this.batches.values()) b.begin()
    for (const p of this.pools) p.begin()
  }

  end(): void {
    for (const b of this.batches.values()) b.end()
    for (const p of this.pools) p.end()
  }

  get instances(): number {
    let n = 0
    for (const b of this.batches.values()) n += b.count
    return n
  }

  // Un corps : vivant ou mort dans la scène (un mort a sa doublure d'ombre), liseré dans la couche des signaux.
  push(body: Body, dead: boolean, sink: number): void {
    const { tmp, tmpS } = this
    for (const s of body.segments) {
      tmpS.makeScale(s.size[0], s.size[1], s.size[2])
      tmp.multiplyMatrices(s.frame, tmpS)
      if (sink !== 0) tmp.elements[13] = (tmp.elements[13] ?? 0) - sink
      const role = s.role === 'marque' ? ROLE.marque : s.role === 'autre' ? ROLE.autre : ROLE.corps
      if (dead) {
        this.batch(`dead:${s.shape}`).push(tmp, s.color, body.id, role)
        this.batch(`deadShadow:${s.shape}`).push(tmp, s.color, body.id, role)
      } else if (s.mat === 'flat') this.batch(`flat:${s.shape}`).push(tmp, s.color, body.id, role)
      else if (s.mat === 'glow') this.batch(`glow:${s.shape}`).push(tmp, s.color, body.id, role)
      else this.batch(`${s.matter}:${s.shape}`).push(tmp, s.color, body.id, role)
      if (body.rim && s.hull) {
        const d = 2 * (body.rim.strong ? RIM_STRONG_M : RIM_M)
        tmpS.makeScale(s.size[0] + d, s.size[1] + d, s.size[2] + d)
        tmp.multiplyMatrices(s.frame, tmpS)
        this.batch(`rim:${s.shape}`).push(tmp, body.rim.color, body.id, ROLE.lisere)
      }
    }
  }

  // Éclat doré d'un coup sur un Résistant à terre (L4) : six éclats tournés vers la caméra.
  spark(x: number, z: number, born: number, age: number, cameraQuat: Quaternion): void {
    for (let k = 0; k < 6; k++) {
      const ang = k * 1.047 + born
      const r = 0.15 + age * 0.05
      this.tmpV.set(x + Math.cos(ang) * r, 0.3 + age * 0.03 - age * age * 0.002, z + Math.sin(ang) * r)
      this.tmp.compose(this.tmpV, cameraQuat, new Vector3(0.06, 0.06, 0.06))
      this.batch('flat:box').push(this.tmp, PALETTE.or.crete, 0, ROLE.autre)
    }
  }

  private sector(arcDeg: number, inner: number): BufferGeometry {
    const key = `${arcDeg}:${inner}`
    let g = this.sectorCache.get(key)
    if (!g) {
      const th = (arcDeg * Math.PI) / 180
      const segs = Math.max(8, Math.round(arcDeg / 6))
      g =
        inner > 0
          ? new RingGeometry(inner, 1, segs, 1, -th / 2, th)
          : new CircleGeometry(1, segs, -th / 2, th)
      g.rotateX(-Math.PI / 2)
      this.sectorCache.set(key, g)
    }
    return g
  }

  private place(
    m: Mesh,
    geo: BufferGeometry,
    pos: Vec2,
    yaw: number,
    sx: number,
    sz: number,
    y: number,
    hex: number,
  ): void {
    m.geometry = geo
    m.position.set(pos.x, y, pos.z)
    m.rotation.set(0, yaw, 0)
    m.scale.set(Math.max(1e-4, sx), 1, Math.max(1e-4, sz))
    ;(m.material as MeshBasicMaterial).color.setHex(hex)
  }

  private fill(
    m: Mesh,
    geo: BufferGeometry,
    pos: Vec2,
    yaw: number,
    r: number,
    hex: number,
    opacity: number,
  ): void {
    this.place(m, geo, pos, yaw, r, r, 0.01, hex)
    ;(m.material as MeshBasicMaterial).opacity = opacity
  }

  // Télégraphe au sol de l'attaque en cours (§18), halo de prière, sceau de Sentence (§21).
  ground(c: Creature, pos: Vec2, _facing: number, t: number, w: World, target: number | null): void {
    const a = c.action
    const zones = this.showTelegraphs ? telegraphZones(c, w, t) : []
    if (a && zones.length > 0) {
      const left = a.activeAt - t
      const col = telegraphColor(left)
      const p = Math.min(1, Math.max(0, (t - a.start) / Math.max(1, a.activeAt - a.start)))
      const pulse = telegraphPulse(left, t)
      // Rouge brun : voile léger. Rouge vif : voile dense qui bat (le sang ne bat pas).
      const fillOpacity = left <= RENDER.rougeVifTicks ? 0.75 + 0.25 * pulse : 0.4
      // La zone suit le corps interpolé (le rendu peut être entre deux ticks).
      const dx = pos.x - c.pos.x
      const dz = pos.z - c.pos.z
      for (const zn of zones) {
        const at = { x: zn.x + dx, z: zn.z + dz }
        if (zn.kind === 'circle') {
          const r = zn.r
          this.place(
            this.telBorder.next(),
            this.sector(360, 0.86),
            at,
            0,
            r + 0.1,
            r + 0.1,
            0.008,
            PALETTE.noir,
          )
          this.fill(this.telFill.next(), this.sector(360, 0), at, 0, r, col, fillOpacity)
          this.place(this.telProgress.next(), this.sector(360, 0), at, 0, r * p, r * p, 0.012, col)
          this.place(this.telEdge.next(), this.sector(360, 0.92), at, 0, r, r, 0.014, col)
          continue
        }
        const yaw = -zn.facing
        const r = zn.reach
        const half = (zn.arcDeg * Math.PI) / 360
        this.place(
          this.telBorder.next(),
          this.sector(zn.arcDeg, 0.86),
          at,
          yaw,
          r + 0.1,
          r + 0.1,
          0.008,
          PALETTE.noir,
        )
        this.fill(this.telFill.next(), this.sector(zn.arcDeg, 0), at, yaw, r, col, fillOpacity)
        this.place(this.telProgress.next(), this.sector(zn.arcDeg, 0), at, yaw, r * p, r * p, 0.012, col)
        this.place(this.telEdge.next(), this.sector(zn.arcDeg, 0.92), at, yaw, r, r, 0.014, col)
        // Bords latéraux du cône : trait noir, puis trait de couleur (le cône se lit fermé sur le sang).
        for (const s of [-1, 1]) {
          this.place(this.telBorder.next(), this.lane, at, yaw + s * half, r + 0.1, 0.16, 0.008, PALETTE.noir)
          this.place(this.telEdge.next(), this.lane, at, yaw + s * half, r, 0.07, 0.014, col)
        }
      }
    }
    if (a && c.family === 'confesseur' && a.kind === 'canalisation' && c.state.kind !== 'mort') {
      const R = w.families[c.family]?.actions[a.name]?.reach ?? TUNING.confesseur.prayerRadius
      const p = Math.min(1, Math.max(0, (t - a.start) / Math.max(1, a.activeAt - a.start)))
      this.place(this.halos.next(), this.sector(360, 0), pos, 0, R * p, R * p, 0.006, PALETTE.vertMaladif)
      this.place(
        this.haloEdges.next(),
        this.sector(360, 0.95),
        pos,
        0,
        R * p,
        R * p,
        0.007,
        PALETTE.vertMaladif,
      )
    }
    if (target === c.id && c.state.kind === 'abattu') {
      const col = c.resistant ? PALETTE.or.base : PALETTE.ivoire.base
      this.place(this.seals.next(), this.sector(360, 0.82), pos, 0, 0.95, 0.95, 0.009, col)
      this.place(this.seals.next(), this.sector(360, 0.9), pos, 0, 0.6, 0.6, 0.009, col)
    }
  }

  dispose(): void {
    for (const b of this.batches.values()) b.dispose()
    for (const p of this.pools) p.dispose()
    for (const g of this.sectorCache.values()) g.dispose()
    this.lane.dispose()
    for (const m of this.materials) m.dispose()
  }
}
