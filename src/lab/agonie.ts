// Scènes de l'agonie (E7) pour les séquences image par image : une mort debout en variante B (l'excédent de dégâts
// achève directement, la créature tombe pendant son agonie) et une mort d'Union (achever un Recousu à terre tue dans
// la même image son bras tranché, Membre errant, qui rampe à côté). Les familles sont celles du jeu.
import {
  createWorld,
  FAMILIES,
  type FamilyKind,
  IDLE_COMMANDS,
  type PlayerCommands,
  type SpawnDef,
  type Vec2,
  type World,
} from '../sim/index'
import { testWave, withCreature } from '../sim/testing'
import type { Policy } from './policies'

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.z)
  return l === 0 ? { x: 0, z: 0 } : { x: v.x / l, z: v.z / l }
}

// Une créature de chaque famille, debout, en Rituel autour du Bourreau ; Chair à 1 : le premier coup de Couperet
// (12) laisse un excédent d'au moins la moitié de la Chair max, la variante B l'achève debout (§27, décision du
// concepteur).
const STANDING: readonly [FamilyKind, number, number][] = [
  ['souriant', 1.4, 0],
  ['recousu', -1.6, 1.2],
  ['porteur', 0.4, -2.2],
  ['confesseur', -0.6, 2.6],
  ['chirurgien', 2.4, 2.0],
]

export const standingDeathWorld = (): World => {
  const spawns: SpawnDef[] = STANDING.map(([family, x, z], k) => ({
    family,
    pos: { x, z },
    facing: Math.atan2(-z, -x),
    state: 'rituel',
    group: 10 + k,
  }))
  let w = createWorld({ seed: 11, variant: 'B', wave: testWave(spawns, { x: 0, z: 0 }), families: FAMILIES })
  for (const c of w.creatures) w = withCreature(w, c.id, { chair: 1 })
  return w
}

// Le Bourreau va frapper la créature debout la plus proche, une à une.
export const standingDeathPolicy =
  (): Policy =>
  (w: World): PlayerCommands => {
    const p = w.player
    const standing = w.creatures
      .filter((c) => c.state.kind === 'rituel' || c.state.kind === 'hostile')
      .sort((a, b) => dist(p.pos, a.pos) - dist(p.pos, b.pos) || a.id - b.id)
    const t = standing[0]
    if (!t) return { ...IDLE_COMMANDS, aim: p.pos }
    const d = dist(p.pos, t.pos)
    return {
      ...IDLE_COMMANDS,
      move: d > 1.4 ? norm({ x: t.pos.x - p.pos.x, z: t.pos.z - p.pos.z }) : { x: 0, z: 0 },
      aim: t.pos,
      strike: d <= 1.6 && p.action === null,
    }
  }

// Recousu à terre (id 1), bras droit tranché : son Membre errant (id 2) rampe à côté (L5, partie du tout).
export const unionWorld = (): World => {
  let w = createWorld({
    seed: 12,
    variant: 'A',
    wave: testWave(
      [
        { family: 'recousu', pos: { x: 1.5, z: 0.3 }, facing: 2.2, state: 'abattu' },
        { family: 'membre', pos: { x: 2.4, z: -1.6 }, facing: 0.4, state: 'abattu' },
      ],
      { x: 0, z: 0 },
    ),
    families: FAMILIES,
  })
  const rec = w.creatures.find((c) => c.family === 'recousu')
  const mem = w.creatures.find((c) => c.family === 'membre')
  if (rec)
    w = withCreature(w, rec.id, {
      limbs: rec.limbs.map((l) => (/droit/i.test(l.id) ? { ...l, hp: 0, state: 'severed' as const } : l)),
    })
  if (mem && rec) w = withCreature(w, mem.id, { unionOf: rec.id, familyData: { limbIndex: 0 } })
  return w
}

// Achève le Recousu dès qu'il est à portée (L4) : le Membre errant meurt dans la même image (L5).
export const unionPolicy =
  (): Policy =>
  (w: World): PlayerCommands => {
    const p = w.player
    const rec = w.creatures.find((c) => c.family === 'recousu')
    if (!rec || rec.state.kind === 'mort') return { ...IDLE_COMMANDS, aim: p.pos }
    const d = dist(p.pos, rec.pos)
    return {
      ...IDLE_COMMANDS,
      move: d > 1.3 ? norm({ x: rec.pos.x - p.pos.x, z: rec.pos.z - p.pos.z }) : { x: 0, z: 0 },
      aim: rec.pos,
      strike: d <= 1.6 && p.action === null,
    }
  }
