// Recousu (§8.10, §8.4) : grande brute à deux bras. Chaque bras porte une attaque ; un bras sectionné ou brisé
// la lui retire jusqu'au Relèvement (ou jusqu'à ce que son Membre errant soit recousu). Sans bras valide, il passe
// au Coup de tête. Le cœur refuse déjà une attaque dont le membre n'est pas `ok` ; on ne la demande donc jamais.
import { radiusOf } from '../draft'
import { clampToArena } from '../predicates'
import { TUNING } from '../tuning'
import type { Area, Creature, Effect, FamilyModule, Intent, Vec2 } from '../types'
import { add, dist, fromAngle, scale } from '../vec'

const R = TUNING.recousu
export const BRAS_DROIT = 'brasDroit' // Marteau
export const BRAS_GAUCHE = 'brasGauche' // Empoignade

const armOk = (self: Creature, id: string): boolean => self.limbs.some((l) => l.id === id && l.state === 'ok')

const strike = (area: Area, amount: number, knockback?: number): Effect => ({
  kind: 'damage',
  area,
  amount,
  source: 'creature',
  abatSmall: false,
  staggerLarge: 0,
  hitsCreatures: false,
  ...(knockback === undefined ? {} : { knockback }),
})

// Même borne que l'effet dashSelf du cœur (effects.ts) : le centre du coup est là où le corps arrive.
const clampArena = (p: Vec2): Vec2 => clampToArena(p, TUNING.radiusLarge)

// Choix par la portée, sans autre valeur que celles du réglage : l'Empoignade (1,8 m) si le joueur est collé,
// le Marteau (2,5 m) un cran plus loin, le Coup de tête (ruée de 5 m) quand aucun bras ne tient plus.
const decide = (player: Vec2, self: Creature): Intent => {
  const d = dist(self.pos, player)
  const within = (reach: number): boolean => d <= reach + TUNING.playerRadius
  const gauche = armOk(self, BRAS_GAUCHE)
  const droit = armOk(self, BRAS_DROIT)
  if (gauche && within(R.empoignade.reach)) return { kind: 'act', action: 'empoignade', target: player }
  if (droit && within(R.marteau.reach)) return { kind: 'act', action: 'marteau', target: player }
  if (!gauche && !droit && within(R.coupDeTete.rush))
    return { kind: 'act', action: 'coupDeTete', target: player }
  return { kind: 'moveTo', target: player }
}

export const recousu: FamilyModule = {
  kind: 'recousu',
  size: 'large',
  isSupport: false,
  base: {
    chair: R.chair,
    speed: R.speed,
    limbs: [
      { id: BRAS_DROIT, hp: R.armHp },
      { id: BRAS_GAUCHE, hp: R.armHp },
    ],
  },
  actions: {
    marteau: {
      kind: 'attaque',
      telegraphTicks: R.marteau.telegraph,
      recoverTicks: R.marteau.recover,
      limb: BRAS_DROIT,
      reach: R.marteau.reach,
      arcDeg: R.marteau.arcDeg,
    },
    empoignade: {
      kind: 'attaque',
      telegraphTicks: R.empoignade.telegraph,
      recoverTicks: R.empoignade.recover,
      limb: BRAS_GAUCHE,
      reach: R.empoignade.reach,
    },
    coupDeTete: {
      kind: 'attaque',
      telegraphTicks: R.coupDeTete.telegraph,
      recoverTicks: R.coupDeTete.recover,
      reach: R.coupDeTete.rush,
    },
  },
  decide: (world, self) => decide(world.player.pos, self),
  resolve: (_world, self, action) => {
    switch (action.name) {
      case 'marteau':
        return [
          strike(
            {
              kind: 'cone',
              origin: self.pos,
              facing: self.facing,
              reach: R.marteau.reach,
              arcDeg: R.marteau.arcDeg,
            },
            R.marteau.damage,
          ),
        ]
      case 'empoignade':
        // Saisie puis projection : le joueur touché est rejeté à 4 m, à l'opposé du Recousu. Le spec ne donne
        // pas d'arc à la saisie : zone circulaire de la portée de l'Empoignade.
        return [
          strike(
            { kind: 'circle', center: self.pos, radius: R.empoignade.reach },
            R.empoignade.damage,
            R.empoignade.throwDistance,
          ),
        ]
      case 'coupDeTete': {
        // Ruée dans la direction prise au début du télégraphe, au plus 5 m, jusqu'au point visé alors.
        // Le coup porte au contact des corps à l'arrivée : un joueur qui a quitté ce point l'esquive.
        const aimed = typeof action.target === 'object' && action.target !== null ? action.target : null
        const length = aimed ? Math.min(R.coupDeTete.rush, dist(self.pos, aimed)) : R.coupDeTete.rush
        const to = clampArena(add(self.pos, scale(fromAngle(self.facing), length)))
        return [
          { kind: 'dashSelf', to },
          strike({ kind: 'circle', center: to, radius: radiusOf(self) }, R.coupDeTete.damage),
        ]
      }
      default:
        return []
    }
  },
}
