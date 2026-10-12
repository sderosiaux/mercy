// Vagues jouées de P0 (V1 à V6) et scènes de test de B5 (S1, S-nappe, S-sat).
// Compositions : prompt P0 et §12 (parcelle 1, parcelle 2, bas-côtés A et B). Positions : choix de C6a, dans
// l'arène de 30 × 30 m (§28), consignés dans .mercy/requests/C6a.md. Le joueur arrive toujours par le sud (−z).
// La graine décale chaque départ dans un disque de WAVE_JITTER_M mètres et tire la phase de Rituel
// (B1 §12.3, B3 I9) ; le tirage lui-même vit dans createWorld.
import type { FamilyKind, SpawnDef, Vec2, WaveDef } from './types'
import { add, angleOf, fromAngle, scale, vec } from './vec'

// « La graine décale chaque départ de l'ordre du mètre » (brief C6a, B3 I9).
export const WAVE_JITTER_M = 1

// n créatures réparties sur un cercle, la première à l'angle `start` (radians), sens trigonométrique.
const ring = (
  family: FamilyKind,
  center: Vec2,
  radius: number,
  n: number,
  group: number,
  start = Math.PI / 2,
): SpawnDef[] =>
  Array.from({ length: n }, (_, k) => ({
    family,
    pos: add(center, scale(fromAngle(start + (2 * Math.PI * k) / n), radius)),
    group,
  }))

// Le Porteur garde son sac loin du joueur (§8.10) : au départ, il fait face à l'entrée du joueur.
const porteur = (pos: Vec2, group: number, playerStart: Vec2): SpawnDef => ({
  family: 'porteur',
  pos,
  facing: angleOf(pos, playerStart),
  group,
})

const one = (family: FamilyKind, pos: Vec2, group: number): SpawnDef => ({ family, pos, group })

const played = (id: string, playerStart: Vec2, spawns: readonly SpawnDef[]): WaveDef => ({
  id,
  test: false,
  playerStart,
  spawns,
  jitter: { posM: WAVE_JITTER_M, ritualPhase: true },
})

const scene = (id: string, spawns: readonly SpawnDef[]): WaveDef => ({
  id,
  test: true,
  playerStart: vec(0, 0),
  spawns,
  jitter: { posM: 0, ritualPhase: false },
})

// V1, parcelle 1 (§12) : deux groupes de 3 Souriants en Rituel, centres à 14 m l'un de l'autre.
const V1_START = vec(-3, -9)
const V1 = played('V1', V1_START, [
  ...ring('souriant', vec(-7, 1), 1, 3, 1),
  ...ring('souriant', vec(7, 1), 1, 3, 2),
])

// V2, parcelle 2 (§12) : 8 Souriants et un Porteur près d'eux. Les deux Délaissés du §12 n'existent pas en P0.
const V2_START = vec(0, -9)
const V2 = played('V2', V2_START, [
  ...ring('souriant', vec(0, 1), 2, 8, 1),
  porteur(vec(3.5, 4.5), 2, V2_START),
])

// V3, Hospice (§12) : un Recousu, un Chirurgien en retrait, 6 Souriants (effectif du bas-côté B, la seule
// rencontre du §12 qui mêle un Recousu à des Souriants).
const V3_START = vec(0, -9)
const V3 = played('V3', V3_START, [
  ...ring('souriant', vec(-1.5, 0), 2, 6, 1),
  one('recousu', vec(2.5, 2), 2),
  one('chirurgien', vec(0, 6.5), 3),
])

// V4, bas-côté A (§12) : 2 Confesseurs devant leur autel, 8 Souriants.
const V4_START = vec(0, -9)
const V4 = played('V4', V4_START, [
  ...ring('souriant', vec(0, 0), 2, 8, 1),
  one('confesseur', vec(-3, 6), 2),
  one('confesseur', vec(3, 6), 2),
])

// V5, bas-côté B (§12 : 1 Confesseur, 1 Porteur, 6 Souriants, 1 Recousu) plus un Chirurgien : les cinq familles.
const V5_START = vec(0, -9)
const V5 = played('V5', V5_START, [
  ...ring('souriant', vec(0, 0), 1.8, 6, 1),
  one('recousu', vec(-3.5, 2.5), 2),
  porteur(vec(3.5, 2.5), 3, V5_START),
  one('chirurgien', vec(-2, 7), 4),
  one('confesseur', vec(2, 7), 5),
])

// V6, charge maximale (§24 : 40 créatures) : quatre foules de 9 Souriants autour d'un Porteur, centres à 6 m,
// à portée de cri les unes des autres (L2, 8 m), pour qu'une horde se forme (B4.O7, mêlée de 15 corps du §29).
// Écartement choisi sur sonde (rapport C6a) : plus large, un joueur qui achève en silence les prend une à une.
const V6_START = vec(0, -12)
const V6_CENTERS: readonly Vec2[] = [vec(-3, 1), vec(3, 1), vec(-3, 7), vec(3, 7)]
const V6 = played(
  'V6',
  V6_START,
  V6_CENTERS.flatMap((c, i) => [...ring('souriant', c, 2, 9, i + 1), porteur(c, 5 + i, V6_START)]),
)

// Scènes de B5 (B5.md §6), placées au tick 0 sans décalage. Le joueur apparaît en (0, 0), centre de l'arène.
// S1 : un Souriant en Rituel à (+2 ; 0).
const S1 = scene('S1', [{ family: 'souriant', pos: vec(2, 0) }])
// S-nappe : 6 Souriants en Rituel sur un cercle de 10 m, angles 0° à 300°, ids croissants dans cet ordre.
const S_NAPPE = scene('S-nappe', ring('souriant', vec(0, 0), 10, 6, 1, 0))
// S-sat : 36 Souriants Abattus au tick 0 (fell au tick 0, D12), grille 6 × 6, ids par x puis par z.
const S_SAT_X = [3.25, 4.75, 6.25, 7.75, 9.25, 10.75] as const
const S_SAT_Z = [-3.75, -2.25, -0.75, 0.75, 2.25, 3.75] as const
const S_SAT = scene(
  'S-sat',
  S_SAT_X.flatMap((x) =>
    S_SAT_Z.map((z): SpawnDef => ({ family: 'souriant', pos: vec(x, z), state: 'abattu' })),
  ),
)

export const WAVE_IDS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const
export const SCENE_IDS = ['S1', 'S-nappe', 'S-sat'] as const
export type WaveId = (typeof WAVE_IDS)[number]
export type SceneId = (typeof SCENE_IDS)[number]

export const WAVES: Readonly<Record<WaveId | SceneId, WaveDef>> = {
  V1,
  V2,
  V3,
  V4,
  V5,
  V6,
  S1,
  'S-nappe': S_NAPPE,
  'S-sat': S_SAT,
}

export const isWaveId = (id: string): id is WaveId | SceneId => Object.hasOwn(WAVES, id)

export const waveById = (id: string): WaveDef => {
  if (!isWaveId(id)) throw new Error(`vague inconnue : ${id} (connues : ${Object.keys(WAVES).join(', ')})`)
  return WAVES[id]
}
