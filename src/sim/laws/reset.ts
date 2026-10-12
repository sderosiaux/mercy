// L6 Seule la mort est permanente : à la mort du joueur, ce qui n'est pas mort revient à son état d'origine.
import { baseChair, chairMaxFor, crying, type Draft, emit, type MCreature } from '../draft'
import { TUNING } from '../tuning'
import type { CreatureState } from '../types'

const spawnState = (d: Draft, c: MCreature): CreatureState => {
  const s = c.spawn
  if (!s) throw new Error('spawn absent')
  switch (s.state) {
    case 'rituel':
      return { kind: 'rituel' }
    case 'hostile':
      return { kind: 'hostile', alertedAt: d.tick }
    case 'abattu':
      return {
        kind: 'abattu',
        since: d.tick,
        riseAt: d.tick + (s.cicatrices >= 3 ? TUNING.relevementResistant : TUNING.relevementOrdinaire),
        cryAt: d.tick + TUNING.criDelai,
        claimedBy: null,
      }
    case 'mort':
      return { kind: 'mort', at: d.tick }
  }
}

export const resetTick = (d: Draft): void => {
  if (d.player.vie > 0) return
  emit(d, { type: 'player-death', tick: d.tick })
  emit(d, { type: 'reset', tick: d.tick })
  const kept: MCreature[] = []
  for (const c of d.creatures) {
    if (c.state.kind === 'mort') {
      kept.push(c)
      continue
    }
    if (crying(c, d.tick)) emit(d, { type: 'cry-stop', tick: d.tick, id: c.id, cause: 'reset' })
    const s = c.spawn
    if (!s) continue // née en combat : retirée
    const base = baseChair(d, c)
    const chairMax = chairMaxFor(base, s.cicatrices)
    const state = spawnState(d, c)
    kept.push({
      ...c,
      pos: s.pos,
      facing: s.facing,
      cicatrices: s.cicatrices,
      resistant: s.cicatrices >= 3,
      chairMax,
      chair: state.kind === 'abattu' || state.kind === 'mort' ? 0 : chairMax,
      state,
      unionOf: null,
      limbs: c.limbs.map((l) => ({ ...l, hp: l.hpMax, state: 'ok' })),
      action: null,
      stunnedUntil: 0,
      group: s.group,
      ritualPhase: s.ritualPhase,
      familyData: {},
    })
  }
  d.creatures = kept
  const p = d.player
  const missing = TUNING.vieMax - Math.max(0, p.vie)
  p.vie = TUNING.vieMax
  emit(d, { type: 'heal', tick: d.tick, amount: missing, source: 'reset' })
  p.pos = p.spawnPos
  p.facing = 0
  p.ferveur = 0
  p.action = null
  p.buffer = null
  p.comboStep = 0
  p.dodgeCharges = TUNING.dodge.charges
  p.dodgeRechargeAt = null
  p.invulnerableUntil = 0
  p.deaths += 1
}
