// Décision du concepteur (2026-10-12) : aucune zone d'attaque n'est peinte au sol. Une attaque se lit à la pose
// d'anticipation de la créature (§18) et au son, pas à un cercle qui n'existe pas dans le monde.
import { Group, type Material, MeshStandardMaterial, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { type Action, type Creature, FAMILIES } from '../sim/index'
import { scene, withCreature } from '../sim/testing'
import { BodyLayer } from './bodies'
import { creatureBody, MATTERS, type Matter } from './rig'

const meshes = (g: Object3D): Object3D[] => {
  const out: Object3D[] = []
  g.traverse((o) => {
    if (o !== g && o.visible && (o as { isMesh?: boolean }).isMesh) out.push(o)
  })
  return out
}

describe('aucune zone d’attaque au sol', () => {
  it('un Recousu qui arme son Marteau ne peint rien au sol, du début du geste au coup', () => {
    const marteau: Action = {
      name: 'marteau',
      kind: 'attaque',
      start: 0,
      activeAt: 60,
      end: 100,
      target: null,
      limb: 'brasDroit',
    }
    const w = withCreature(
      scene([{ family: 'recousu', pos: { x: 3, z: 1 }, facing: 0.7, state: 'hostile' }], {
        families: { recousu: FAMILIES.recousu },
      }),
      1,
      { action: marteau },
    )
    const groups = { scene: new Group(), ground: new Group(), signals: new Group() }
    const matters = Object.fromEntries(
      MATTERS.map((m) => [m, new MeshStandardMaterial()]),
    ) as unknown as Record<Matter, Material>
    const layer = new BodyLayer(groups, matters, false)
    for (const t of [1, 30, 50, 59]) {
      layer.begin()
      for (const c of w.creatures as Creature[]) {
        const ctx = { t, groupPhase: 0, speed: 0, targeted: false, limbStage: 0, prayerColor: null }
        layer.push(creatureBody(c, c.pos, c.facing, ctx), false, 0)
        layer.ground(c, c.pos, c.facing, t, w, null)
      }
      layer.end()
      expect(meshes(groups.ground), `tick ${t}`).toEqual([])
    }
  })
})
