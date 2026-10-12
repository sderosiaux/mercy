// Toutes les valeurs « réglage » de P0, avec leur section de GAME_SPEC.md. Les règles ne sont jamais ici.
// Les valeurs marquées « hors spec » n'ont pas de chiffre dans le spec : choisies ici, consignées comme réglages.
import type { DamageType } from './types'

export const TICK_HZ = 60
export const ticks = (seconds: number): number => Math.round(seconds * TICK_HZ)

export interface WeaponTuning {
  readonly damage: number
  readonly thirdDamage: number
  readonly period: number // ticks entre deux coups (§8.5)
  readonly thirdKnockback: number // m
  readonly arcDeg: number
  readonly reach: number
  readonly type: DamageType
}

export const TUNING = {
  arenaHalf: 15, // §28 P0 : arène de 30 × 30 m

  // Joueur (§6, §8.1, §8.7)
  vieMax: 100,
  playerSpeed: 5, // m/s
  playerRadius: 0.45, // hors spec
  commandBuffer: ticks(0.15), // hors spec : une touche pressée pendant une action reste valable 9 ticks

  dodge: {
    distance: 4,
    duration: ticks(0.3), // hors spec : la roulade dure autant que l'invulnérabilité
    iframes: ticks(0.3),
    charges: 2,
    recharge: ticks(1.5),
    perfectWindow: ticks(0.2),
  },

  ferveur: {
    max: 100,
    strikePerCreature: 2,
    strikeCap: 6,
    achevement: 4, // aussi pour une mort par variante B (D10)
    sentenceOrdinaire: 10,
    sentenceResistant: 40,
    perfectDodge: 10,
    decayDelay: ticks(4),
    decayPerSecond: 10,
  },

  weapons: {
    couperet: {
      damage: 12,
      thirdDamage: 18,
      period: ticks(0.35),
      thirdKnockback: 1,
      arcDeg: 120,
      reach: 2.2,
      type: 'tranchant',
    },
    masse: {
      damage: 20,
      thirdDamage: 30,
      period: ticks(0.55),
      thirdKnockback: 3,
      arcDeg: 100,
      reach: 2.4,
      type: 'contondant',
    },
  } satisfies Record<string, WeaponTuning>,

  balayage: { cost: 25, radius: 4, damage: 25, duration: ticks(0.8) },
  charge: {
    cost: 35,
    length: 7,
    dashTicks: ticks(0.35),
    damage: 30,
    push: 2,
    hitHalfWidth: 0.9, // hors spec : demi-largeur de la ligne touchée
    duration: ticks(0.8),
  },

  sentence: {
    range: 2.5,
    durationOrdinaire: ticks(0.6),
    durationResistant: ticks(1.0),
    healOrdinaire: 0.08,
    healResistant: 0.3,
  },

  swapHostileRadius: 15,

  // Lois (§7)
  abattuCrawl: 0.8, // L1
  supportRadius: 12, // L1
  criDelai: ticks(0.5), // L2
  criAlertRadius: 8, // L2
  relevementOrdinaire: ticks(6), // L3
  relevementResistant: ticks(8), // L3
  relevementTelegraph: ticks(1.5), // L3
  cicatriceChairMul: 1.5, // L3 (règle, gardée ici avec les autres facteurs)
  cicatriceSizeMul: 1.08, // L3
  alertProximity: 2.5, // L7
  alertProximityMere: 6, // L7
  alertBurst: 15, // L7
  alertBark: 10, // L7
  alertTurnTicks: ticks(0.4), // L7 : pivot de tête avant la première décision Hostile

  variantBExcessRatio: 0.5, // §27, variante B

  radiusSmall: 0.4, // hors spec
  radiusLarge: 0.8, // hors spec

  membre: { crawl: 1.2, reattachTicks: ticks(1), contact: 0.6 }, // §8.4

  souriant: {
    chair: 20,
    speed: 4.5,
    morsure: { damage: 6, telegraph: ticks(0.4), recover: ticks(0.5), reach: 1.6, arcDeg: 90 }, // portée et récupération hors spec
  },
  recousu: {
    chair: 160,
    speed: 2.5,
    armHp: 40,
    marteau: { damage: 22, telegraph: ticks(0.9), recover: ticks(0.7), reach: 2.5, arcDeg: 70 },
    empoignade: { damage: 15, telegraph: ticks(1.0), recover: ticks(0.8), reach: 1.8, throwDistance: 4 },
    coupDeTete: { damage: 18, telegraph: ticks(0.6), recover: ticks(0.9), rush: 5 },
  },
  porteur: {
    chair: 60,
    speed: 2,
    speedStage3: 3,
    seekRadius: 12, // D7
    turnRateDegPerSecond: 90, // D4
    absorbRadius: 3,
    absorbEvery: ticks(1.5),
    maxStage: 3,
    burstAfter: ticks(4),
    rearArcDeg: 120,
    burstBaseRadius: 2,
    burstDamageBase: 10,
    burstDamagePerStage: 10,
    burstStaggerLarge: ticks(1.5),
    bousculade: { damage: 5, telegraph: ticks(0.4), recover: ticks(0.6), reach: 1.4, arcDeg: 90 },
  },
  confesseur: {
    chair: 40,
    speed: 3,
    keepMin: 7,
    keepMax: 10,
    baton: { damage: 8, telegraph: ticks(0.5), recover: ticks(0.6), reach: 1.6, arcDeg: 90 },
    prayerTrigger: 2, // D2 : lui-même compris s'il est à terre
    prayerRadius: 8, // D3
    prayerChannel: ticks(2.5),
    prayerCooldown: ticks(10), // D1 : part aussi après une interruption
  },
  chirurgien: {
    chair: 50,
    speed: 4,
    fleeRadius: 4,
    scalpel: { damage: 10, telegraph: ticks(0.4), recover: ticks(0.5), reach: 1.4, arcDeg: 70 },
    operation: ticks(3),
    assembleRadius: 2,
    assembleChairPerBody: 80,
  },
} as const
