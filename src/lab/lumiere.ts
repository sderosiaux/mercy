// Lumière du Bourreau et morts éclairés naturellement (E8). Deux scènes de développement (D12 : morts placés dès le
// tick 0) : `rayon`, le Bourreau immobile au milieu d'un groupe de morts, d'Abattus et de sang, avec une rangée de
// corps tous les 2 m pour lire où sa chandelle s'éteint ; `eloignement`, la même, où il s'éloigne du groupe de morts
// après 1,5 s, puis s'arrête à 8 m d'eux, hors du rayon de sa chandelle.
import { uvToGround } from '../render/camera'
import {
  createWorld,
  type FamilyKind,
  IDLE_COMMANDS,
  type PlayerCommands,
  type SpawnDef,
  type Vec2,
  type World,
} from '../sim/index'
import { testWave } from '../sim/testing'
import { LAB_FAMILIES_QUIET } from './families'
import type { Policy } from './policies'

type Body = readonly [number, number, FamilyKind, 'mort' | 'abattu', 0 | 3]

// (u, v) en mètres (u vers la droite de l'écran, v vers le haut), joueur en (0, 0).
const BODIES: readonly Body[] = [
  // Groupe de morts, là où il vient de tuer.
  [1.6, 1.2, 'souriant', 'mort', 0],
  [2.4, 0.4, 'recousu', 'mort', 0],
  [1.2, 2.3, 'porteur', 'mort', 0],
  [2.9, 1.9, 'confesseur', 'mort', 0],
  [0.4, 1.6, 'chirurgien', 'mort', 0],
  [3.4, 0.9, 'souriant', 'mort', 3],
  // Vivants à terre près du groupe : la lumière normale sur eux, leur liseré.
  [-1.8, 1.4, 'souriant', 'abattu', 0],
  [2.2, -1.6, 'recousu', 'abattu', 3],
  // Rangée de jauge, un corps tous les 2 m vers le bas de l'écran à droite : où la chandelle s'éteint.
  [2, -3.5, 'souriant', 'mort', 0],
  [4, -3.5, 'souriant', 'abattu', 0],
  [6, -3.5, 'souriant', 'mort', 0],
  [8, -3.5, 'souriant', 'abattu', 0],
  [10, -3.5, 'souriant', 'mort', 0],
]

export const lumiereWorld = (): World =>
  createWorld({
    seed: 3,
    variant: 'A',
    wave: testWave(
      BODIES.map(
        ([u, v, family, state, cicatrices], i): SpawnDef => ({
          family,
          pos: uvToGround(u, v),
          facing: ((i + 1) * 0.82) % (2 * Math.PI),
          state,
          cicatrices,
        }),
      ),
      { x: 0, z: 0 },
    ),
    families: LAB_FAMILIES_QUIET,
  })

// Sang : flaques anciennes sous le groupe de morts, sang frais (né au tick 40, rouge vif et mouillé jusqu'au tick 160)
// entre le Bourreau et le groupe, et le long de la rangée de jauge.
export const lumiereDecals = (): { pos: Vec2; size: number; born?: number }[] => [
  { pos: uvToGround(1.8, 1.3), size: 1.6 },
  { pos: uvToGround(2.8, 1.2), size: 1.3 },
  { pos: uvToGround(0.9, 2.1), size: 1.2 },
  { pos: uvToGround(0.6, 0.4), size: 0.9, born: 40 },
  { pos: uvToGround(1.0, -0.7), size: 0.8, born: 40 },
  { pos: uvToGround(-0.6, -1.1), size: 0.7, born: 40 },
  // Sang frais là où le sol renvoie la chandelle vers la caméra (à environ 2,3 m vers le bas de l'écran) : reflet.
  { pos: uvToGround(0.3, -2.3), size: 0.9, born: 40 },
  ...[2, 4, 6, 8, 10].map((u) => ({ pos: uvToGround(u, -3.0), size: 0.9 })),
]

const away = ((): Vec2 => {
  const d = uvToGround(-1, -0.25)
  const l = Math.hypot(d.x, d.z)
  return { x: d.x / l, z: d.z / l }
})()
const STOP_U = -6 // il s'arrête à 6 m sur la gauche de l'écran : le groupe, à 8 m de lui, reste à l'image, hors du rayon

// Immobile 1,5 s, puis il s'éloigne du groupe de morts vers la gauche de l'écran, et s'arrête.
export const eloignementPolicy =
  (): Policy =>
  (w: World): PlayerCommands => {
    const p = w.player.pos
    const u = p.x * uvToGround(1, 0).x + p.z * uvToGround(1, 0).z
    const idle = { ...IDLE_COMMANDS, aim: p }
    if (w.tick < 90 || u <= STOP_U) return idle
    return { ...idle, move: away, aim: { x: p.x + away.x, z: p.z + away.z } }
  }
