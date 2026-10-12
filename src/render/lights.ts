// Système de lumière du moteur de présentation (E1) : les sources sont des objets du monde, déclarés par le décor
// (torches, braseros, chandelles, lune) ou tirés de l'état des entités (halo de prière, lueur du sac, chandelle du
// reliquaire du Bourreau). Chaque source a une couleur de la palette, une intensité, une portée, un vacillement et
// une importance. Un budget (niveau de qualité) fixe combien de lumières et d'ombres sont actives à la fois ; la
// sélection est une fonction pure de la position de la caméra, sans mémoire : rendre deux fois la même image donne
// les mêmes lumières. Les poids sont continus : une source qui entre ou sort du budget s'allume ou s'éteint en
// fondu à mesure que la caméra bouge, jamais d'un coup.
//
// Règle de lecture (B2.O1, O5) : les morts ne reçoivent que la lumière fixe du lieu, à intensité de base (sans
// vacillement), en luminance seulement. Les sources d'entité (prière, sac, reliquaire) ne les touchent jamais.
import {
  actionPhase,
  type Creature,
  PORTEUR_STAGE_KEY,
  TICK_HZ,
  TUNING,
  type Vec2,
  type World,
} from '../sim/index'
import { sacColor } from './look'
import { PALETTE } from './palette'

export type LightKind = 'torche' | 'brasero' | 'chandelle' | 'lune' | 'priere' | 'sac' | 'reliquaire'

export interface LightSource {
  readonly key: string // identité stable (décor : « torche:3 » ; entité : « sac:17 »)
  readonly kind: LightKind
  readonly x: number
  readonly y: number
  readonly z: number
  readonly color: number // palette
  readonly intensity: number // candela (three, décroissance en 1/d²)
  readonly range: number // m : au-delà, aucune contribution
  readonly flicker: number // amplitude relative du vacillement (0 : fixe)
  readonly seed: number // phase propre du vacillement
  readonly importance: number // poids dans le budget
  readonly shadow: boolean // peut porter une ombre (projecteur dirigé vers l'arène)
  readonly fixed: boolean // lumière fixe du lieu : éclaire les morts (luminance, intensité de base)
  readonly owner?: number // entité porteuse
}

// Profils par sorte de source. Valeurs de forme (E1), réglées à l'œil sur la planche key-art-la-fosse.
export const LIGHT_KINDS: Readonly<
  Record<
    LightKind,
    Pick<LightSource, 'color' | 'intensity' | 'range' | 'flicker' | 'importance' | 'shadow' | 'fixed'>
  >
> = {
  torche: {
    color: PALETTE.lumiere.torche,
    intensity: 30,
    range: 14,
    flicker: 0.16,
    importance: 3,
    shadow: true,
    fixed: true,
  },
  brasero: {
    color: PALETTE.lumiere.brasero,
    intensity: 50,
    range: 16,
    flicker: 0.2,
    importance: 4,
    shadow: true,
    fixed: true,
  },
  chandelle: {
    color: PALETTE.lumiere.chandelle,
    intensity: 7,
    range: 5,
    flicker: 0.1,
    importance: 1,
    shadow: false,
    fixed: true,
  },
  lune: {
    color: PALETTE.lumiere.lune,
    intensity: 0.6,
    range: 0,
    flicker: 0,
    importance: 0,
    shadow: true,
    fixed: true,
  },
  priere: {
    color: PALETTE.vertMaladif,
    intensity: 12,
    range: TUNING.confesseur.prayerRadius,
    flicker: 0.06,
    importance: 6,
    shadow: false,
    fixed: false,
  },
  sac: {
    color: PALETTE.chair.sacLueur,
    intensity: 9,
    range: 6,
    flicker: 0.12,
    importance: 5,
    shadow: false,
    fixed: false,
  },
  reliquaire: {
    color: PALETTE.lumiere.reliquaire,
    intensity: 14,
    range: 9,
    flicker: 0.07,
    importance: 10,
    shadow: false,
    fixed: false,
  },
}

export const source = (
  kind: LightKind,
  key: string,
  x: number,
  y: number,
  z: number,
  patch: Partial<LightSource> = {},
): LightSource => ({ ...LIGHT_KINDS[kind], key, kind, x, y, z, seed: hashSeed(key), ...patch })

// Graine stable d'une clé (FNV-1a), dans [0, 2π).
export const hashSeed = (key: string): number => {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2
}

// Vacillement : somme de sinusoïdes incommensurables, fonction du temps de rendu en ticks. Moyenne 1, amplitude
// bornée par `flicker` (|f − 1| ≤ flicker).
export const flickerAt = (s: Pick<LightSource, 'flicker' | 'seed'>, t: number): number => {
  if (s.flicker <= 0) return 1
  const sec = t / TICK_HZ
  const n =
    0.5 * Math.sin(2 * Math.PI * 1.13 * sec + s.seed) +
    0.3 * Math.sin(2 * Math.PI * 3.71 * sec + 2.3 * s.seed) +
    0.2 * Math.sin(2 * Math.PI * 8.9 * sec + 5.1 * s.seed)
  return 1 + s.flicker * n
}

// Petit déplacement de la flamme (ombres qui dansent), en m, borné à 3 cm.
export const flameJitter = (s: Pick<LightSource, 'flicker' | 'seed'>, t: number): Vec2 => {
  if (s.flicker <= 0) return { x: 0, z: 0 }
  const sec = t / TICK_HZ
  const k = 0.03 * Math.min(1, s.flicker * 5)
  return {
    x: k * Math.sin(2 * Math.PI * 2.3 * sec + 1.7 * s.seed),
    z: k * Math.sin(2 * Math.PI * 1.9 * sec + 3.1 * s.seed),
  }
}

// ---------------------------------------------------------------------------------------------------------
// Budget

export interface Budget {
  readonly point: number // lumières ponctuelles sans ombre
  readonly shadow: number // lumières qui portent une ombre
}

export interface Assigned {
  readonly src: LightSource
  readonly weight: number // 0 à 1 : part de l'intensité de la source rendue par ce créneau
}

export interface Selection {
  readonly shadowed: readonly Assigned[]
  readonly point: readonly Assigned[]
}

// Pertinence d'une source pour l'image : importance, atténuée avec la distance au centre de la vue au-delà de sa
// portée. Une source dont la lumière ne peut pas atteindre la vue vaut 0.
export const lightScore = (s: LightSource, focus: Vec2, viewRadius: number): number => {
  if (s.kind === 'lune') return 0
  const d = Math.hypot(s.x - focus.x, s.z - focus.z)
  const reach = viewRadius + s.range
  if (d >= reach) return 0
  const u = d / reach
  return s.importance * (1 - u * u) * (1 - u * u)
}

const FADE = 0.3 // une source à moins de 30 % au-dessus du seuil du budget est atténuée

const smooth01 = (x: number): number => {
  const u = Math.min(1, Math.max(0, x))
  return u * u * (3 - 2 * u)
}

const fade = (score: number, cut: number): number => (cut <= 0 ? 1 : smooth01((score - cut) / (FADE * score)))

interface Scored {
  readonly src: LightSource
  readonly score: number
}

const byScore = (a: Scored, b: Scored): number => b.score - a.score || (a.src.key < b.src.key ? -1 : 1)

// Sélection pure. Les ombres vont aux sources qui peuvent en porter, par score ; une source près du seuil des
// ombres est rendue en partie par un créneau d'ombre et en partie par un créneau sans ombre (son intensité totale
// reste la même, seule l'ombre s'estompe). Les créneaux sans ombre vont ensuite aux meilleurs scores restants.
export const selectLights = (
  sources: readonly LightSource[],
  focus: Vec2,
  budget: Budget,
  viewRadius: number,
): Selection => {
  const scored: Scored[] = []
  for (const src of sources) {
    const score = lightScore(src, focus, viewRadius)
    if (score > 0) scored.push({ src, score })
  }
  scored.sort(byScore)
  const shadowCands = scored.filter((s) => s.src.shadow)
  const shadowCut = shadowCands[budget.shadow]?.score ?? 0
  const shadowed: Assigned[] = []
  const residual = new Map<string, number>()
  for (let i = 0; i < Math.min(budget.shadow, shadowCands.length); i++) {
    const s = shadowCands[i] as Scored
    const w = fade(s.score, shadowCut)
    shadowed.push({ src: s.src, weight: w })
    residual.set(s.src.key, 1 - w)
  }
  const pointCands = scored.filter((s) => (residual.get(s.src.key) ?? 1) > 1e-6)
  const pointCut = pointCands[budget.point]?.score ?? 0
  const point: Assigned[] = []
  for (let i = 0; i < Math.min(budget.point, pointCands.length); i++) {
    const s = pointCands[i] as Scored
    point.push({ src: s.src, weight: (residual.get(s.src.key) ?? 1) * fade(s.score, pointCut) })
  }
  return { shadowed, point }
}

// ---------------------------------------------------------------------------------------------------------
// Sources tirées de l'état des entités

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

// Chandelle du reliquaire (planche du Bourreau) : le rayon de lumière autour du joueur, à la manière de Diablo.
// Halo de prière : vert maladif, son intensité monte avec la canalisation. Lueur du sac : couleur du stade.
export const entityLights = (world: World, prev: World, alpha: number, t: number): LightSource[] => {
  const out: LightSource[] = []
  const p = world.player
  const pp = prev.player
  const px = lerp(pp.pos.x, p.pos.x, alpha)
  const pz = lerp(pp.pos.z, p.pos.z, alpha)
  // Rayon de lumière à la Diablo : la flamme du reliquaire est à la ceinture (rig-bourreau.ts), mais la source de
  // lumière est placée au-dessus du Bourreau, pour éclairer le sol autour de lui sans brûler son propre corps. Elle
  // ne dépend que de la position (pas de l'orientation) : un Bourreau immobile ne fait pas bouger la lumière.
  out.push(source('reliquaire', 'reliquaire', px, 2.8, pz, { owner: -1 }))
  const prevById = new Map(prev.creatures.map((c) => [c.id, c]))
  for (const c of world.creatures) {
    if (c.state.kind === 'mort' || c.state.kind === 'absorbe') continue
    const pc = prevById.get(c.id) ?? c
    const x = lerp(pc.pos.x, c.pos.x, alpha)
    const z = lerp(pc.pos.z, c.pos.z, alpha)
    const a = c.action
    if (
      c.family === 'confesseur' &&
      a &&
      a.kind === 'canalisation' &&
      actionPhase(a, Math.floor(t)) === 'canalisation'
    ) {
      const k = Math.min(1, Math.max(0, (t - a.start) / Math.max(1, a.activeAt - a.start)))
      out.push(
        source('priere', `priere:${c.id}`, x, c.state.kind === 'abattu' ? 2.2 : 3.6, z, {
          intensity: LIGHT_KINDS.priere.intensity * (0.35 + 0.65 * k),
          owner: c.id,
        }),
      )
    }
    if (c.family === 'porteur') {
      const stage = c.familyData[PORTEUR_STAGE_KEY] ?? 0
      if (stage >= 1) out.push(sacLight(c, x, z, stage))
    }
  }
  return out
}

const sacLight = (c: Creature, x: number, z: number, stage: number): LightSource => {
  const back = 0.9 // au-delà du sac : la lueur baigne le sol derrière le Porteur sans brûler son corps
  return source(
    'sac',
    `sac:${c.id}`,
    x - back * Math.cos(c.facing),
    c.state.kind === 'abattu' ? 0.8 : 1.9,
    z - back * Math.sin(c.facing),
    {
      color: sacColor(stage),
      intensity: LIGHT_KINDS.sac.intensity * (0.5 + 0.5 * stage),
      importance: stage >= 3 ? 8 : LIGHT_KINDS.sac.importance,
      owner: c.id,
    },
  )
}
