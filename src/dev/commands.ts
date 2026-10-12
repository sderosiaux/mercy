// Journal des commandes du joueur (B1 §12.6, B2 I6) : une entrée par step, point visé compris, rejouable à l'identique.
// JSON perd −0 (sérialisé en 0) et ne sait pas écrire NaN ni l'infini. Un −0 dans `move` ou `aim` peut changer un
// atan2 dans la simulation, donc le rejeu : chaque nombre est écrit exactement, −0 et non-finis en chaînes.
import type { PlayerCommands } from '../sim/index'

// [move.x, move.z, aim.x, aim.z, drapeaux, rite]
// drapeaux : 1 strike, 2 dodge, 4 sentence, 8 swapWeapon. rite : 0 aucun, 1 balayage, 2 charge.
export type ExactNumber = number | '-0' | 'NaN' | 'Infinity' | '-Infinity'
export type EncodedCommand = readonly [ExactNumber, ExactNumber, ExactNumber, ExactNumber, number, 0 | 1 | 2]

export const encodeNumber = (n: number): ExactNumber => {
  if (Object.is(n, -0)) return '-0'
  if (Number.isNaN(n)) return 'NaN'
  if (n === Number.POSITIVE_INFINITY) return 'Infinity'
  if (n === Number.NEGATIVE_INFINITY) return '-Infinity'
  return n
}

export const decodeNumber = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (v === '-0') return -0
  if (v === 'NaN') return Number.NaN
  if (v === 'Infinity') return Number.POSITIVE_INFINITY
  if (v === '-Infinity') return Number.NEGATIVE_INFINITY
  throw new Error(`nombre mal encodé dans le journal des commandes : ${JSON.stringify(v)}`)
}

const RITES = [null, 'balayage', 'charge'] as const

export const encodeCommand = (c: PlayerCommands): EncodedCommand => [
  encodeNumber(c.move.x),
  encodeNumber(c.move.z),
  encodeNumber(c.aim.x),
  encodeNumber(c.aim.z),
  (c.strike ? 1 : 0) | (c.dodge ? 2 : 0) | (c.sentence ? 4 : 0) | (c.swapWeapon ? 8 : 0),
  c.rite === 'balayage' ? 1 : c.rite === 'charge' ? 2 : 0,
]

export const decodeCommand = (e: unknown): PlayerCommands => {
  if (!Array.isArray(e) || e.length !== 6) throw new Error(`commande mal formée : ${JSON.stringify(e)}`)
  const [mx, mz, ax, az, flags, rite] = e as unknown[]
  if (typeof flags !== 'number' || !Number.isInteger(flags) || flags < 0 || flags > 15)
    throw new Error(`drapeaux de commande invalides : ${JSON.stringify(flags)}`)
  if (rite !== 0 && rite !== 1 && rite !== 2) throw new Error(`rite invalide : ${JSON.stringify(rite)}`)
  return {
    move: { x: decodeNumber(mx), z: decodeNumber(mz) },
    aim: { x: decodeNumber(ax), z: decodeNumber(az) },
    strike: (flags & 1) !== 0,
    dodge: (flags & 2) !== 0,
    sentence: (flags & 4) !== 0,
    swapWeapon: (flags & 8) !== 0,
    rite: RITES[rite],
  }
}
