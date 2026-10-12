// Scènes construites pour les tests des politiques de B1 et B3, à partir de src/sim/testing.ts. Aucune règle de
// jeu ni de politique ici. Le joueur est en (0, 0) au tick 0 ; un Abattu placé se relève au tick 360 (480 s'il
// est Résistant), donc hors du télégraphe tant qu'on ne le déplace pas avec releveDans().
import { expect } from 'vitest'
import {
  FAMILIES,
  type FamilyKind,
  IDLE_COMMANDS,
  type PlayerCommands,
  PORTEUR_STAGE_KEY,
  type SpawnDef,
  type World,
} from '../../sim/index'
import { creature, scene, withCreature } from '../../sim/testing'
import { vec } from '../../sim/vec'

export const hostileEn = (family: FamilyKind, x: number, z: number, cicatrices: 0 | 3 = 0): SpawnDef => ({
  family,
  pos: vec(x, z),
  state: 'hostile',
  cicatrices,
})
export const rituelEn = (family: FamilyKind, x: number, z: number): SpawnDef => ({ family, pos: vec(x, z) })
export const abattuEn = (family: FamilyKind, x: number, z: number, cicatrices: 0 | 3 = 0): SpawnDef => ({
  family,
  pos: vec(x, z),
  state: 'abattu',
  cicatrices,
})
export const mortEn = (family: FamilyKind, x: number, z: number): SpawnDef => ({
  family,
  pos: vec(x, z),
  state: 'mort',
})

// ids : 1, 2, 3… dans l'ordre des spawns.
export const monde = (...spawns: SpawnDef[]): World => scene(spawns, { families: FAMILIES })

// Action de la famille `name`, commencée il y a `depuis` ticks, d'impact (ou de fin de canalisation) dans
// `impactDans` ticks.
export const enAction = (w: World, id: number, name: string, depuis: number, impactDans: number): World => {
  const c = creature(w, id)
  const def = FAMILIES[c.family]?.actions[name]
  if (!def) throw new Error(`action inconnue : ${c.family}.${name}`)
  const activeAt = w.tick + impactDans
  return withCreature(w, id, {
    action: {
      name,
      kind: def.kind,
      start: w.tick - depuis,
      activeAt,
      end: def.kind === 'canalisation' ? activeAt : activeAt + def.recoverTicks,
      target: null,
      limb: def.limb ?? null,
    },
  })
}

// Abattu qui se relève dans `ticks` ticks (null : jamais seul).
export const releveDans = (w: World, id: number, ticks: number | null): World => {
  const c = creature(w, id)
  if (c.state.kind !== 'abattu') throw new Error(`créature ${id} pas à terre`)
  return withCreature(w, id, { state: { ...c.state, riseAt: ticks === null ? null : w.tick + ticks } })
}

// Membre errant détaché de `owner` (anatomy.ts : riseAt et cryAt nuls, unionOf = propriétaire).
export const membreDe = (w: World, id: number, owner: number): World => {
  const c = creature(w, id)
  if (c.state.kind !== 'abattu' || c.family !== 'membre')
    throw new Error(`créature ${id} : pas un Membre à terre`)
  return withCreature(w, id, { unionOf: owner, state: { ...c.state, riseAt: null, cryAt: null } })
}

export const auStade = (w: World, id: number, stade: number): World =>
  withCreature(w, id, { familyData: { ...creature(w, id).familyData, [PORTEUR_STAGE_KEY]: stade } })

export const commandes = (patch: Partial<PlayerCommands> = {}): PlayerCommands => ({
  ...IDLE_COMMANDS,
  ...patch,
})

// Égalité de commandes ; les vecteurs à 1e-9 près (une rotation peut produire −0).
export const memesCommandes = (a: PlayerCommands, b: PlayerCommands): void => {
  expect({ ...a, move: null, aim: null }).toEqual({ ...b, move: null, aim: null })
  for (const k of ['move', 'aim'] as const) {
    expect(a[k].x).toBeCloseTo(b[k].x, 9)
    expect(a[k].z).toBeCloseTo(b[k].z, 9)
  }
}
