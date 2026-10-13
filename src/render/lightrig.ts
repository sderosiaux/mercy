// Lumières three du système de lumière (E1) : un nombre fixe de créneaux (le nombre de lumières d'un shader ne
// change jamais, donc aucune recompilation), remplis à chaque image par la sélection pure de lights.ts.
// Créneaux d'ombre : projecteurs dirigés vers l'arène depuis la flamme (une carte d'ombre chacun). Créneaux sans
// ombre : lumières ponctuelles. La lune est une lumière directionnelle froide, avec ombre en qualité haute.
import { Color, DirectionalLight, HemisphereLight, PointLight, type Scene, SpotLight } from 'three'
import type { Vec2 } from '../sim/index'
import {
  type Assigned,
  flameJitter,
  flickerAt,
  judged,
  type LightSource,
  relativeLuminance,
  type Selection,
  selectLights,
} from './lights'
import { lanternUniforms } from './materials'
import { PALETTE } from './palette'
import type { FogLight } from './post'
import type { QualitySpec } from './quality'

export const DEAD_PROXY_LAYER = 2 // doublures d'ombre : vues par les caméras d'ombre, pas par la caméra du joueur
const HEMI_INTENSITY = 2.4 // ambiance de nuit (ciel froid, sol noir)
const RESIDUAL_GAIN = 0.6 // part des sources hors budget rendue en ambiance

// Éclairage d'une image (B2, amendement A11) : celui du jeu ; de jugement (chaque source, l'ambiance et la lune gardent
// leur position, leur portée et leur luminance, leur couleur passe au neutre) ; ou aucun (sources et ambiance
// éteintes). La lumière figée est une affaire de sources (mêmes sources, même instant), réglée par le moteur.
export type RigMode = 'jeu' | 'jugement' | 'sans'

const grey = (hex: number): Color => {
  const y = relativeLuminance(hex)
  return new Color(y, y, y)
}

export interface RigFrame {
  readonly selection: Selection
  readonly fog: FogLight[]
  readonly active: number
}

export class LightRig {
  private readonly points: PointLight[] = []
  private readonly spots: SpotLight[] = []
  readonly moon: DirectionalLight
  readonly hemi: HemisphereLight
  private readonly color = new Color()

  constructor(
    scene: Scene,
    private readonly q: QualitySpec,
    arenaHalf: number,
  ) {
    for (let i = 0; i < q.pointLights; i++) {
      const l = new PointLight(PALETTE.lumiere.torche, 0, 10, 2)
      scene.add(l)
      this.points.push(l)
    }
    for (let i = 0; i < q.shadowLights; i++) {
      const l = new SpotLight(PALETTE.lumiere.torche, 0, 18, Math.PI / 2.6, 0.75, 2)
      l.castShadow = true
      l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
      l.shadow.bias = -0.0009
      l.shadow.normalBias = 0.035
      l.shadow.camera.near = 0.3
      l.shadow.camera.layers.enable(DEAD_PROXY_LAYER)
      scene.add(l)
      scene.add(l.target)
      this.spots.push(l)
    }
    this.moon = new DirectionalLight(PALETTE.lumiere.lune, 0)
    this.moon.castShadow = q.moonShadow
    const half = arenaHalf + 6
    const cam = this.moon.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 1
    cam.far = 80
    cam.layers.enable(DEAD_PROXY_LAYER)
    this.moon.shadow.mapSize.set(q.moonShadowMapSize, q.moonShadowMapSize)
    this.moon.shadow.bias = -0.0005
    this.moon.shadow.normalBias = 0.03
    scene.add(this.moon)
    scene.add(this.moon.target)
    this.hemi = new HemisphereLight(PALETTE.lumiere.cielNuit, PALETTE.lumiere.solNuit, HEMI_INTENSITY)
    scene.add(this.hemi)
  }

  // Chandelle du reliquaire, pour la règle de l'arme (weapons.ts) : position et portée (null : joueur masqué).
  setLantern(s: LightSource | null): void {
    const u = lanternUniforms
    if (!s) {
      u.uLantern.value.set(0, -1000, 0, 0)
      return
    }
    u.uLantern.value.set(s.x, s.y, s.z, s.range)
  }

  update(
    sources: readonly LightSource[],
    focus: Vec2,
    t: number,
    viewRadius: number,
    mode: RigMode = 'jeu',
  ): RigFrame {
    if (mode === 'sans') return this.dark()
    const srcs = mode === 'jugement' ? sources.map(judged) : sources
    const moon = srcs.find((s) => s.kind === 'lune')
    if (moon) {
      this.moon.position.set(moon.x, moon.y, moon.z)
      this.moon.target.position.set(0, 0, 0)
      this.moon.target.updateMatrixWorld()
      this.moon.color.setHex(moon.color)
      this.moon.intensity = moon.intensity
    } else this.moon.intensity = 0
    const selection = selectLights(
      srcs,
      focus,
      { point: this.q.pointLights, shadow: this.q.shadowLights },
      viewRadius,
    )
    const fog: FogLight[] = []
    const push = (a: Assigned, x: number, y: number, z: number, intensity: number) => {
      this.color.setHex(a.src.color)
      fog.push({
        x,
        y,
        z,
        range: a.src.range,
        r: this.color.r * intensity,
        g: this.color.g * intensity,
        b: this.color.b * intensity,
      })
    }
    this.spots.forEach((l, i) => {
      const a = selection.shadowed[i]
      if (!a) {
        l.intensity = 0 // le créneau reste dans la scène : le nombre de lumières des shaders ne change pas
        return
      }
      const s = a.src
      const j = flameJitter(s, t)
      const intensity = s.intensity * flickerAt(s, t) * a.weight
      l.color.setHex(s.color)
      l.intensity = intensity
      l.decay = s.decay
      l.distance = s.range + 4
      l.position.set(s.x + j.x, s.y, s.z + j.z)
      const d = Math.hypot(s.x, s.z) || 1
      const reach = Math.min(7, d)
      l.target.position.set(s.x - (s.x / d) * reach, 0, s.z - (s.z / d) * reach)
      l.target.updateMatrixWorld()
      l.shadow.camera.far = s.range + 6
      push(a, s.x, s.y, s.z, intensity)
    })
    this.points.forEach((l, i) => {
      const a = selection.point[i]
      if (!a) {
        l.intensity = 0 // le créneau reste dans la scène : le nombre de lumières des shaders ne change pas
        return
      }
      const s = a.src
      const j = flameJitter(s, t)
      const intensity = s.intensity * flickerAt(s, t) * a.weight
      l.color.setHex(s.color)
      l.intensity = intensity
      l.decay = s.decay
      l.distance = s.range
      l.position.set(s.x + j.x, s.y, s.z + j.z)
      push(a, s.x, s.y, s.z, intensity)
    })
    fog.sort((p, q) => q.r + q.g + q.b - (p.r + p.g + p.b))
    this.residual(srcs, selection, focus, mode === 'jugement')
    return {
      selection,
      fog: fog.slice(0, this.q.fogLights),
      active: selection.point.length + selection.shadowed.length,
    }
  }

  // Rendu sans lumière (B2, amendement A11) : tous les créneaux, la lune et l'ambiance éteints.
  private dark(): RigFrame {
    for (const l of [...this.spots, ...this.points]) l.intensity = 0
    this.moon.intensity = 0
    this.hemi.intensity = 0
    return { selection: { shadowed: [], point: [] }, fog: [], active: 0 }
  }

  // Lumière des sources hors budget : leur éclairement au centre de la vue, ajouté à l'ambiance (teinte chaude). Un
  // budget plus petit assombrit moins la scène ; ces sources n'ont ni ombre, ni reflet, ni direction. Jugement : le
  // ciel et le sol de l'ambiance gardent leur luminance, leur couleur passe au neutre (les sources le sont déjà).
  private residual(sources: readonly LightSource[], sel: Selection, focus: Vec2, judge: boolean): void {
    const skyHex = PALETTE.lumiere.cielNuit
    const sky0 = judge ? grey(skyHex) : new Color(skyHex)
    if (judge) this.hemi.groundColor.copy(grey(PALETTE.lumiere.solNuit))
    else this.hemi.groundColor.setHex(PALETTE.lumiere.solNuit)
    const used = new Map<string, number>()
    for (const a of [...sel.shadowed, ...sel.point])
      used.set(a.src.key, (used.get(a.src.key) ?? 0) + a.weight)
    let e = 0
    let r = 0
    let g = 0
    let b = 0
    for (const s of sources) {
      if (s.kind === 'lune' || s.range <= 0) continue
      const left = 1 - (used.get(s.key) ?? 0)
      if (left <= 1e-3) continue
      const d = Math.hypot(s.x - focus.x, s.z - focus.z, s.y)
      const win = Math.max(0, 1 - (d / s.range) ** 4) ** 2
      const add = (left * s.intensity * win) / Math.max(1, d ** s.decay)
      if (add <= 0) continue
      this.color.setHex(s.color)
      e += add
      r += this.color.r * add
      g += this.color.g * add
      b += this.color.b * add
    }
    const base = HEMI_INTENSITY
    if (e <= 1e-4) {
      this.hemi.color.copy(sky0)
      this.hemi.intensity = base
      return
    }
    // Ambiance = ciel de nuit (base) + part résiduelle ; la couleur suit le mélange des deux.
    const k = Math.min(1.5, e * RESIDUAL_GAIN)
    const sky = sky0.clone().multiplyScalar(base)
    sky.r += (r / e) * k
    sky.g += (g / e) * k
    sky.b += (b / e) * k
    const total = Math.max(sky.r, sky.g, sky.b)
    this.hemi.color.setRGB(sky.r / total, sky.g / total, sky.b / total)
    this.hemi.intensity = total
  }

  dispose(): void {
    for (const l of [...this.points, ...this.spots]) l.dispose()
    this.moon.dispose()
    this.hemi.dispose()
  }
}
