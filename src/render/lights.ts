// Système de lumière du moteur de présentation (E1) : les sources sont des objets du monde, déclarés par le décor
// (torches, braseros, chandelles, lune) ou tirés de l'état des entités (halo de prière, lueur du sac, chandelle du
// reliquaire du Bourreau). Chaque source a une couleur de la palette, une intensité, une portée, un vacillement et
// une importance. Un budget (niveau de qualité) fixe combien de lumières et d'ombres sont actives à la fois ; la
// sélection est une fonction pure de la position de la caméra, sans mémoire : rendre deux fois la même image donne
// les mêmes lumières. Les poids sont continus : une source qui entre ou sort du budget s'allume ou s'éteint en
// fondu à mesure que la caméra bouge, jamais d'un coup.
//
// Les morts reçoivent la lumière du lieu comme tout le reste (E8, décision du concepteur : « comme avec de la lumière
// naturelle ») : aucune source n'est réservée aux vivants ni au décor, aucune lumière fixe ne leur est propre.
// La chandelle du reliquaire est la lumière du Bourreau, à la manière de Diablo : un rayon qui le suit (RAYON_BOURREAU_M).
//
// Instruments de B2 (amendement A11) : rendu de jugement (judged : chaque source garde sa position, sa portée et sa
// luminance, sa couleur passe au neutre), rendu à lumière figée et rendu sans lumière (renderer.ts, lightrig.ts).
import { Color } from 'three'
import {
  actionPhase,
  type Creature,
  PORTEUR_STAGE_KEY,
  TICK_HZ,
  TUNING,
  type Vec2,
  type World,
} from '../sim/index'
import { sacCastsLight } from './look'
import { PALETTE } from './palette'
import { urlParam } from './quality'

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
  readonly decay: number // exposant de la décroissance avec la distance (three : 2, loi physique)
  readonly owner?: number // entité porteuse
}

// Rayon de lumière du Bourreau (E8, décision du concepteur : « la chandelle de son reliquaire éclaire un vrai rayon
// autour de lui, à la Diablo », réglage de 6 à 8 m à choisir sur image). C'est la distance au sol, depuis ses pieds,
// où la lumière de la chandelle s'éteint. Là où il tue (2,5 à 4 m), créatures, sang et boue se voient ; au-delà de ce
// rayon, le noir du lieu reprend. Choix sur image : rapport E8.
export const RAYON_BOURREAU_M = 7

// Hauteur (m) de la source de la chandelle au-dessus du Bourreau. La flamme visible pend à sa ceinture
// (rig-bourreau.ts) ; la source de lumière est placée au-dessus de lui pour éclairer un disque au sol autour de lui
// sans brûler son propre corps, comme la lumière d'un héros de Diablo. Elle ne dépend que de sa position.
export const RELIQUAIRE_HEIGHT_M = 4

// Forme du rayon : la décroissance physique en 1/d² donne une tache brûlante sous le Bourreau et un anneau déjà noir à
// 4 m ; un exposant 1 éclairait encore ses pieds 1,5 fois plus que l'ancienne chandelle (morts à ses pieds à L* 45 au
// rendu de jugement de B2, classés plus près de l'or que du gris par B2.O2 ; reflet de la chandelle aveuglant).
// Sans décroissance avec la distance (exposant 0), la coupure de three (fenêtre lisse jusqu'à 0 à la portée) et le
// cosinus d'incidence font un disque : sous ses pieds, l'éclairement de l'ancienne chandelle (1,75) ; à 3 m, les deux
// tiers ; à 5 m, un quart ; à 6 m, moins d'un dixième ; au rayon, rien. La portée est la distance de la source à un
// point du sol situé au rayon. Instruments (choix sur image et mesures, rapport E8) : `rayon=<m>`, `chandelle=<cd>`,
// `decroissance=<exposant>`.
const RAYON = Number(urlParam('rayon') ?? Number.NaN)
const CHANDELLE = Number(urlParam('chandelle') ?? Number.NaN)
const DECROISSANCE = Number(urlParam('decroissance') ?? Number.NaN)
const rayon = Number.isFinite(RAYON) && RAYON > 0 ? RAYON : RAYON_BOURREAU_M
export const RELIQUAIRE = {
  rayon,
  intensity: Number.isFinite(CHANDELLE) && CHANDELLE >= 0 ? CHANDELLE : 2,
  decay: Number.isFinite(DECROISSANCE) && DECROISSANCE >= 0 ? DECROISSANCE : 0,
  range: Math.hypot(rayon, RELIQUAIRE_HEIGHT_M),
} as const

// Profils par sorte de source. Valeurs de forme (E1), réglées à l'œil sur la planche key-art-la-fosse.
export const LIGHT_KINDS: Readonly<
  Record<
    LightKind,
    Pick<LightSource, 'color' | 'intensity' | 'range' | 'flicker' | 'importance' | 'shadow' | 'decay'>
  >
> = {
  torche: {
    color: PALETTE.lumiere.torche,
    intensity: 30,
    range: 14,
    flicker: 0.16,
    importance: 3,
    shadow: true,
    decay: 2,
  },
  brasero: {
    color: PALETTE.lumiere.brasero,
    intensity: 50,
    range: 16,
    flicker: 0.2,
    importance: 4,
    shadow: true,
    decay: 2,
  },
  chandelle: {
    color: PALETTE.lumiere.chandelle,
    intensity: 7,
    range: 5,
    flicker: 0.1,
    importance: 1,
    shadow: false,
    decay: 2,
  },
  lune: {
    color: PALETTE.lumiere.lune,
    intensity: 0.6,
    range: 0,
    flicker: 0,
    importance: 0,
    shadow: true,
    decay: 2,
  },
  priere: {
    color: PALETTE.vertMaladif,
    intensity: 12,
    range: TUNING.confesseur.prayerRadius,
    flicker: 0.06,
    importance: 6,
    shadow: false,
    decay: 2,
  },
  // Sac au stade 3 seulement : rouge vif (§17). Valeurs d'avant E5 au stade 3 : 9 × (0,5 + 0,5 × 3), importance 8.
  sac: {
    color: PALETTE.rougeVif,
    intensity: 18,
    range: 6,
    flicker: 0.12,
    importance: 8,
    shadow: false,
    decay: 2,
  },
  // Chandelle du reliquaire : le rayon de lumière du Bourreau (voir RAYON_BOURREAU_M).
  reliquaire: {
    color: PALETTE.lumiere.reliquaire,
    intensity: RELIQUAIRE.intensity,
    range: RELIQUAIRE.range,
    flicker: 0.07,
    importance: 10,
    shadow: false,
    decay: RELIQUAIRE.decay,
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

// Luminance relative Y (sRGB linéaire, D65) d'une couleur de la palette.
export const relativeLuminance = (hex: number): number => {
  const c = new Color(hex) // three : converti en linéaire
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

// Rendu de jugement (B2, amendement A11) : la source garde sa position, sa portée, son vacillement et sa luminance ;
// sa couleur passe au neutre de la palette, son intensité est multipliée par la luminance relative de sa couleur.
export const judged = (s: LightSource): LightSource => ({
  ...s,
  color: PALETTE.lumiere.neutre,
  intensity: s.intensity * relativeLuminance(s.color),
})

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
// Halo de prière : vert maladif, son intensité monte avec la canalisation. Lueur du sac : rouge vif, au stade 3 seulement.
export const entityLights = (world: World, prev: World, alpha: number, t: number): LightSource[] => {
  const out: LightSource[] = []
  const p = world.player
  const pp = prev.player
  const px = lerp(pp.pos.x, p.pos.x, alpha)
  const pz = lerp(pp.pos.z, p.pos.z, alpha)
  // Rayon de lumière à la Diablo (RAYON_BOURREAU_M) : la source est au-dessus du Bourreau. Elle ne dépend que de sa
  // position (pas de l'orientation) : un Bourreau immobile ne fait pas bouger la lumière.
  out.push(source('reliquaire', 'reliquaire', px, RELIQUAIRE_HEIGHT_M, pz, { owner: -1 }))
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
      if (sacCastsLight(stage)) out.push(sacLight(c, x, z))
    }
  }
  return out
}

// Lueur du sac au stade 3 (look.ts, sacCastsLight : aux stades 0 à 2, le sac n'éclaire rien).
const sacLight = (c: Creature, x: number, z: number): LightSource => {
  const back = 0.9 // au-delà du sac : la lueur baigne le sol derrière le Porteur sans brûler son corps
  return source(
    'sac',
    `sac:${c.id}`,
    x - back * Math.cos(c.facing),
    c.state.kind === 'abattu' ? 0.8 : 1.9,
    z - back * Math.sin(c.facing),
    { owner: c.id },
  )
}
