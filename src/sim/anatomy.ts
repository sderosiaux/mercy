// §8.4 Membres. Les dégâts reçus pendant qu'un membre attaque s'appliquent aussi à ce membre.
// Tranchant à 0 : sectionné, il devient un Membre errant. Contondant à 0 : brisé jusqu'au prochain Relèvement.
import { byId, type Draft, emit, type MCreature, radiusOf } from './draft'
import { TUNING } from './tuning'
import type { DamageType } from './types'
import { add, dist, fromAngle, moveToward, scale } from './vec'

export const damageAttackingLimb = (
  d: Draft,
  c: MCreature,
  amount: number,
  type: DamageType,
): 'severed' | 'broken' | null => {
  const limbId = c.action?.limb
  if (c.size !== 'large' || !limbId) return null
  const idx = c.limbs.findIndex((l) => l.id === limbId && l.state === 'ok')
  const limb = c.limbs[idx]
  if (!limb) return null
  const hp = limb.hp - amount
  if (hp > 0) {
    c.limbs = c.limbs.map((l, i) => (i === idx ? { ...l, hp } : l))
    return null
  }
  if (type === 'contondant') {
    c.limbs = c.limbs.map((l, i) => (i === idx ? { ...l, hp: 0, state: 'broken' } : l))
    emit(d, { type: 'break', tick: d.tick, owner: c.id, limb: limbId })
    return 'broken'
  }
  c.limbs = c.limbs.map((l, i) => (i === idx ? { ...l, hp: 0, state: 'severed' } : l))
  const memberId = d.nextId++
  d.creatures.push({
    id: memberId,
    family: 'membre',
    size: 'small',
    pos: add(c.pos, scale(fromAngle(c.facing + Math.PI / 2), radiusOf(c) + 1.5)),
    facing: c.facing,
    chair: 0,
    chairMax: 1,
    cicatrices: 0,
    resistant: false,
    state: { kind: 'abattu', since: d.tick, riseAt: null, cryAt: null, claimedBy: null },
    unionOf: c.id,
    limbs: [],
    action: null,
    stunnedUntil: 0,
    spawn: null,
    group: null,
    ritualPhase: 0,
    familyData: { limbIndex: idx },
  })
  emit(d, { type: 'sever', tick: d.tick, owner: c.id, limb: limbId, member: memberId })
  return 'severed'
}

// Recoud le membre à son propriétaire et retire le Membre errant du monde.
export const reattach = (d: Draft, member: MCreature, by: 'contact' | number): void => {
  const owner = member.unionOf === null ? undefined : byId(d, member.unionOf)
  if (!owner) return
  const idx = member.familyData.limbIndex ?? -1
  const limb = owner.limbs[idx]
  if (limb) owner.limbs = owner.limbs.map((l, i) => (i === idx ? { ...l, hp: l.hpMax, state: 'ok' } : l))
  d.creatures = d.creatures.filter((c) => c.id !== member.id)
  emit(d, { type: 'reattach', tick: d.tick, owner: owner.id, limb: limb?.id ?? '', member: member.id, by })
}

// Les Membres errants rampent à 1,2 m/s vers leur propriétaire et se recousent en 60 ticks au contact.
export const memberTick = (d: Draft): void => {
  for (const m of [...d.creatures]) {
    if (m.family !== 'membre' || m.state.kind !== 'abattu' || m.state.claimedBy !== null) continue
    const owner = m.unionOf === null ? undefined : byId(d, m.unionOf)
    if (!owner || owner.state.kind === 'mort') continue
    const contact = radiusOf(owner) + TUNING.membre.contact
    if (dist(m.pos, owner.pos) > contact) {
      m.pos = moveToward(m.pos, owner.pos, TUNING.membre.crawl / 60)
      const { reattachAt: _, ...rest } = m.familyData
      m.familyData = rest
      continue
    }
    const at = m.familyData.reattachAt
    if (at === undefined) m.familyData = { ...m.familyData, reattachAt: d.tick + TUNING.membre.reattachTicks }
    else if (d.tick >= at) reattach(d, m, 'contact')
  }
}
