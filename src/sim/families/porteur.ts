// Porteur (§8.10) : petit support qui fait de chaque corps à terre une munition. Il absorbe les Abattus
// ordinaires dans son sac (jusqu'au stade 3), garde son sac tourné loin du joueur, et éclate : de lui-même
// au stade 3 (contact ou délai), ou sur-le-champ quand le joueur le frappe dans le dos.
// Le sac est l'unique source de vérité de son stade : le nombre de corps absorbés dans ce Porteur.
// Le stade est recopié dans familyData[PORTEUR_STAGE_KEY] pour les bots, le rendu et l'audio.
import { isStanding, radiusOf } from '../draft'
import { absorbableBody, inPorteurRearArc, PORTEUR_STAGE_KEY } from '../predicates'
import { TICK_HZ, TUNING } from '../tuning'
import type { Creature, Effect, FamilyModule, Intent, World } from '../types'
import { angleDiff, angleOf, dist, turnToward } from '../vec'

const P = TUNING.porteur
const B = P.bousculade

// Clés privées de familyData. Absentes = valeur par défaut (L6 remet familyData à {}).
const STAGE3_AT = 'stade3At' // début du délai du stade 3, debout ; -1 ou absent : pas au stade 3, ou à terre
const ABSORB_READY_AT = 'absorbeA' // tick à partir duquel une nouvelle absorption est permise ; absent : tout de suite

// D4 : rotation bornée, en radians par tick.
const MAX_TURN = (P.turnRateDegPerSecond * Math.PI) / 180 / TICK_HZ
// Tolérance numérique, pas un réglage : les collisions replacent le joueur exactement au contact.
const CONTACT_EPS = 1e-6

const absorbedInto = (world: World, self: Creature): number =>
  world.creatures.filter((c) => c.state.kind === 'absorbe' && c.state.into === self.id).length

// Ce que le sac peut prendre (§8.10, §26) : le prédicat de l'effet `absorb` du cœur, pour ne jamais viser un corps
// que le cœur refuserait.
const nearestBody = (world: World, self: Creature, radius: number): Creature | undefined => {
  let best: Creature | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const c of world.creatures) {
    if (c.id === self.id || !absorbableBody(c)) continue
    const d = dist(self.pos, c.pos)
    if (d > radius) continue
    if (d < bestD || (d === bestD && best !== undefined && c.id < best.id)) {
      best = c
      bestD = d
    }
  }
  return best
}

const touchesPlayer = (world: World, self: Creature): boolean =>
  dist(self.pos, world.player.pos) <= radiusOf(self) + TUNING.playerRadius + CONTACT_EPS

// Éclatement (§8.10) : rayon 2 + stade, dégâts 10 + 10 × stade au joueur et aux créatures, petites créatures
// ordinaires abattues, grandes et Résistantes qui vacillent, alerte de bruit à 15 m (L7), corps expulsés,
// Porteur vide abattu, stade remis à 0. Le stade est réécrit avant `expelAll`, qui le lit pour l'évènement.
const burstEffects = (
  self: Creature,
  stage: number,
  cause: 'dos' | 'contact' | 'delai',
): readonly Effect[] => [
  { kind: 'setData', key: PORTEUR_STAGE_KEY, value: stage },
  {
    kind: 'damage',
    area: { kind: 'circle', center: self.pos, radius: P.burstBaseRadius + stage },
    amount: P.burstDamageBase + P.burstDamagePerStage * stage,
    source: 'burst',
    abatSmall: true,
    staggerLarge: P.burstStaggerLarge,
    hitsCreatures: true,
  },
  { kind: 'alert', center: self.pos, radius: TUNING.alertBurst, cause: 'burst' },
  { kind: 'expelAll', cause },
  { kind: 'selfAbattu' },
  { kind: 'setData', key: PORTEUR_STAGE_KEY, value: 0 },
  { kind: 'setData', key: STAGE3_AT, value: -1 },
]

// Chaque tick, debout ou à terre : le stade suit le contenu du sac. Debout seulement : éclatement au stade 3
// (contact ou délai), puis absorption d'un corps à moins de 3 m, au plus un toutes les 90 ticks.
// Aussi en Rituel : le Porteur « mange des corps » sans voir le joueur.
// Le délai de 4 s du stade 3 ne court que debout (décision de la revue P0, M2) : à terre il est suspendu, et il
// repart de zéro au premier tick debout qui suit (Relèvement, prière).
const tick = (world: World, self: Creature): readonly Effect[] => {
  const t = world.tick
  const stage = Math.min(P.maxStage, absorbedInto(world, self))
  const data = self.familyData
  const out: Effect[] = []
  // Écrit aussi quand la clé manque (monde neuf, après L6) : les lecteurs trouvent toujours un nombre.
  if (data[PORTEUR_STAGE_KEY] !== stage) out.push({ kind: 'setData', key: PORTEUR_STAGE_KEY, value: stage })
  const standing = isStanding(self)
  const counting = standing && stage >= P.maxStage
  const stage3At = data[STAGE3_AT] ?? -1
  if (!counting && stage3At >= 0) out.push({ kind: 'setData', key: STAGE3_AT, value: -1 })
  if (counting && stage3At < 0) out.push({ kind: 'setData', key: STAGE3_AT, value: t })
  // Abattu, il n'attaque plus (L1) : ni éclatement de lui-même, ni absorption.
  if (!standing) return out

  if (stage >= P.maxStage) {
    if (touchesPlayer(world, self)) return [...out, ...burstEffects(self, stage, 'contact')]
    const since = stage3At < 0 ? t : stage3At
    if (t >= since + P.burstAfter) return [...out, ...burstEffects(self, stage, 'delai')]
    return out
  }

  if (t < (data[ABSORB_READY_AT] ?? 0) || t < self.stunnedUntil) return out
  const body = nearestBody(world, self, P.absorbRadius)
  if (!body) return out
  out.push(
    { kind: 'absorb', id: body.id },
    { kind: 'setData', key: PORTEUR_STAGE_KEY, value: stage + 1 },
    { kind: 'setData', key: ABSORB_READY_AT, value: t + P.absorbEvery },
  )
  if (stage + 1 >= P.maxStage) out.push({ kind: 'setData', key: STAGE3_AT, value: t })
  return out
}

// Hostile et libre. L'orientation ne change que par `keepFacing` : elle tourne vers le joueur à 90°/s au plus
// (D4), pour garder le sac loin de lui. Le déplacement, lui, va vers sa cible.
const decide = (world: World, self: Creature): Intent => {
  const player = world.player.pos
  const toPlayer = dist(self.pos, player) < 1e-9 ? self.facing : angleOf(self.pos, player)
  const keepFacing = turnToward(self.facing, toPlayer, MAX_TURN)
  const stage = self.familyData[PORTEUR_STAGE_KEY] ?? 0
  // Stade 3 : il marche sur le joueur, à 3 m/s.
  if (stage >= P.maxStage) {
    return { kind: 'moveTo', target: player, speedFactor: P.speedStage3 / P.speed, keepFacing }
  }
  // Sac pas plein : il va chercher l'Abattu le plus proche à moins de 12 m (D7).
  const body = nearestBody(world, self, P.seekRadius)
  if (body) return { kind: 'moveTo', target: body.pos, keepFacing }
  // Rien à manger : il attaque (L7). La Bousculade part dans l'axe où il regarde déjà, sans pivot brusque.
  const inReach = dist(self.pos, player) <= B.reach + TUNING.playerRadius
  const inFront = angleDiff(toPlayer, self.facing) <= (B.arcDeg * Math.PI) / 360
  if (inReach && inFront) return { kind: 'act', action: 'bousculade' }
  return { kind: 'moveTo', target: player, keepFacing }
}

export const porteur: FamilyModule = {
  kind: 'porteur',
  size: 'small',
  isSupport: true,
  base: { chair: P.chair, speed: P.speed, limbs: [] },
  actions: {
    bousculade: {
      kind: 'attaque',
      telegraphTicks: B.telegraph,
      recoverTicks: B.recover,
      reach: B.reach,
      arcDeg: B.arcDeg,
    },
  },
  // Décision du concepteur (2026-10-12) : la Charge le traverse sans le pousser, pour que le joueur finisse dans son
  // dos (D4, §9 « la Charge traverse : elle met le joueur dans le dos du Porteur »).
  notPushedByCharge: true,
  decide,
  resolve: (_world, self, action) =>
    action.name === 'bousculade'
      ? [
          {
            kind: 'damage',
            area: { kind: 'cone', origin: self.pos, facing: self.facing, reach: B.reach, arcDeg: B.arcDeg },
            amount: B.damage,
            source: 'creature',
            abatSmall: false,
            staggerLarge: 0,
            hitsCreatures: false,
          },
        ]
      : [],
  tick,
  // Un coup dans le dos (arc arrière de 120°) fait éclater le sac sur-le-champ, à son stade, même vide.
  // De face, le coup a déjà touché le corps (le cœur applique les dégâts avant d'appeler ce crochet).
  onPlayerHit: (world, self, from) =>
    inPorteurRearArc(self, from)
      ? burstEffects(self, Math.min(P.maxStage, absorbedInto(world, self)), 'dos')
      : [],
}
