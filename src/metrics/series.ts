// Série par tick (B4 I4), lue dans World. Un second flux à côté des évènements, commun au banc de bots et à la
// télémétrie humaine (C7). Une ligne ne dépend que du monde du tick : (World) => ligne.
import type { Creature, Vec2, World } from '../sim/index'
import { dhypot } from '../sim/index'

// Paramètres de mesure fixés par les contrats (pas des réglages de jeu).
export const HORDE_RADIUS_M = 8 // B4.O7 : rayon du cri (L2), tient dans le champ de la caméra
export const MELEE_RADIUS_M = 6 // B2 §5, scène S3 : corps à moins de 6,0 m du joueur

export interface SeriesLine {
  readonly tick: number
  readonly hostiles: number // B4 I4 : Hostiles debout
  readonly rituels: number
  readonly abattusOrd: number // B4 : à terre, non Résistants, Membres errants compris
  readonly abattusRes: number
  readonly absorbes: number
  readonly morts: number
  readonly nonMorts: number // B5 N(t) : tout ce qui n'est pas mort, Abattus et absorbés compris
  readonly cris: number // B4 I4 : cris actifs (Abattus et absorbés dont le cri a commencé, D8)
  readonly vocalisent: number // B5 : corps qui vocalisent (Abattus et absorbés, D8), hors Membres errants
  readonly horde8: number // B4.O7 : Hostiles ou Abattus à 8 m ou moins du joueur
  readonly abattus6: number // B2 S3 : Abattus à 6 m ou moins du joueur, Membres errants compris
  readonly morts6: number // B2 S3 : morts à 6 m ou moins du joueur
  readonly vie: number
  readonly ferveur: number
}

const dist = (a: Vec2, b: Vec2): number => dhypot(a.x - b.x, a.z - b.z) // déterministe d'un moteur à l'autre

// Un corps crie dès cryAt (L2), à terre ou dans un sac (D8). Lecture de l'état, pas une règle.
export const isCrying = (c: Creature, tick: number): boolean =>
  (c.state.kind === 'abattu' || c.state.kind === 'absorbe') && c.state.cryAt !== null && c.state.cryAt <= tick

// B5 « corps qui vocalise » : état abattu, et absorbé avec la lecture 2 retenue (D8). Un Membre errant n'a pas
// de voix (GAME_SPEC, Écarts, phase B).
export const vocalises = (c: Creature): boolean =>
  (c.state.kind === 'abattu' || c.state.kind === 'absorbe') && c.family !== 'membre'

export const seriesLine = (w: World): SeriesLine => {
  const p = w.player.pos
  let hostiles = 0
  let rituels = 0
  let abattusOrd = 0
  let abattusRes = 0
  let absorbes = 0
  let morts = 0
  let cris = 0
  let vocalisent = 0
  let horde8 = 0
  let abattus6 = 0
  let morts6 = 0
  for (const c of w.creatures) {
    const d = dist(c.pos, p)
    switch (c.state.kind) {
      case 'hostile':
        hostiles++
        if (d <= HORDE_RADIUS_M) horde8++
        break
      case 'rituel':
        rituels++
        break
      case 'abattu':
        if (c.resistant) abattusRes++
        else abattusOrd++
        if (d <= HORDE_RADIUS_M) horde8++
        if (d <= MELEE_RADIUS_M) abattus6++
        break
      case 'absorbe':
        absorbes++
        break
      case 'mort':
        morts++
        if (d <= MELEE_RADIUS_M) morts6++
        break
    }
    if (isCrying(c, w.tick)) cris++
    if (vocalises(c)) vocalisent++
  }
  return {
    tick: w.tick,
    hostiles,
    rituels,
    abattusOrd,
    abattusRes,
    absorbes,
    morts,
    nonMorts: w.creatures.length - morts,
    cris,
    vocalisent,
    horde8,
    abattus6,
    morts6,
    vie: w.player.vie,
    ferveur: w.player.ferveur,
  }
}

// B5 I2 : corps qui vocalisent, triés par distance à l'auditeur (le joueur, D9) puis par id.
export const voicesByRank = (w: World): readonly { readonly id: number; readonly dist: number }[] =>
  w.creatures
    .filter(vocalises)
    .map((c) => ({ id: c.id, dist: dist(c.pos, w.player.pos) }))
    .sort((a, b) => a.dist - b.dist || a.id - b.id)
