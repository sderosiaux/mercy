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
  type LightSource,
  type Selection,
  selectLights,
} from './lights'
import { fixedLightUniforms } from './materials'
import { PALETTE } from './palette'
import type { FogLight } from './post'
import type { QualitySpec } from './quality'
import { MAX_FIXED_LIGHTS } from './shaders'

export const DEAD_PROXY_LAYER = 2 // ombres des morts : vues par les caméras d'ombre, pas par la caméra du joueur
const HEMI_INTENSITY = 2.4 // ambiance de nuit (ciel froid, sol noir)
const RESIDUAL_GAIN = 0.6 // part des sources hors budget rendue en ambiance
const DEAD_PALLOR = 0.55 // forme (E1) : éclairement constant ajouté à la lumière fixe des morts

const lum = (hex: number): number => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
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

  // Lumière fixe du lieu, pour la matière des morts : intensité de base (sans vacillement), luminance seule.
  setFixed(sources: readonly LightSource[]): void {
    const u = fixedLightUniforms
    let n = 0
    for (const s of sources) {
      if (!s.fixed) continue
      if (s.kind === 'lune') {
        u.uMoonDir.value.set(s.x, s.y, s.z).normalize()
        u.uMoonLum.value = s.intensity * lum(s.color)
        this.moon.position.set(s.x, s.y, s.z)
        this.moon.target.position.set(0, 0, 0)
        this.moon.color.setHex(s.color)
        this.moon.intensity = s.intensity
        continue
      }
      if (n >= MAX_FIXED_LIGHTS) continue
      u.uFixedPos.value[n]?.set(s.x, s.y, s.z, s.range)
      u.uFixedLum.value[n] = s.intensity * lum(s.color)
      n++
    }
    u.uFixedCount.value = n
    // Ambiance de la nuit, plus la pâleur du cadavre : un gris qui se lit gris même loin des flammes (B2.O3 :
    // le mort se détache du sol). Choix de lisibilité assumé, constant, donc sans effet sur l'immobilité (B2.O5).
    u.uDeadAmbient.value =
      HEMI_INTENSITY * (lum(PALETTE.lumiere.cielNuit) + lum(PALETTE.lumiere.solNuit)) * 0.5 * Math.PI +
      DEAD_PALLOR
  }

  // Chandelle du reliquaire pour les morts : intensité de base, sans vacillement (null : joueur masqué).
  setLantern(s: LightSource | null): void {
    const u = fixedLightUniforms
    if (!s) {
      u.uLanternLum.value = 0
      return
    }
    u.uLantern.value.set(s.x, s.y, s.z, s.range)
    u.uLanternLum.value = s.intensity * lum(s.color)
  }

  update(sources: readonly LightSource[], focus: Vec2, t: number, viewRadius: number): RigFrame {
    const selection = selectLights(
      sources,
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
      l.distance = s.range
      l.position.set(s.x + j.x, s.y, s.z + j.z)
      push(a, s.x, s.y, s.z, intensity)
    })
    fog.sort((p, q) => q.r + q.g + q.b - (p.r + p.g + p.b))
    this.residual(sources, selection, focus)
    return {
      selection,
      fog: fog.slice(0, this.q.fogLights),
      active: selection.point.length + selection.shadowed.length,
    }
  }

  // Lumière des sources hors budget : leur éclairement au centre de la vue, ajouté à l'ambiance (teinte chaude). Un
  // budget plus petit assombrit moins la scène ; ces sources n'ont ni ombre, ni reflet, ni direction.
  private residual(sources: readonly LightSource[], sel: Selection, focus: Vec2): void {
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
      const add = (left * s.intensity * win) / Math.max(1, d * d)
      if (add <= 0) continue
      this.color.setHex(s.color)
      e += add
      r += this.color.r * add
      g += this.color.g * add
      b += this.color.b * add
    }
    const base = HEMI_INTENSITY
    if (e <= 1e-4) {
      this.hemi.color.setHex(PALETTE.lumiere.cielNuit)
      this.hemi.intensity = base
      return
    }
    // Ambiance = ciel de nuit (base) + part résiduelle ; la couleur suit le mélange des deux.
    const k = Math.min(1.5, e * RESIDUAL_GAIN)
    const sky = new Color(PALETTE.lumiere.cielNuit).multiplyScalar(base)
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
