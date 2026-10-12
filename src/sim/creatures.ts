// Actions et décisions des créatures. Les familles décident et décrivent des effets ; le cœur les applique.
import { byId, type Draft, emit, familyOf, isPresent, isStanding, type MCreature } from './draft'
import { applyEffects, familyTick } from './effects'
import { releaseClaim } from './laws/rise'
import { actionEnded, freeToDecide } from './predicates'
import type { Vec2 } from './types'
import { angleOf, dist, moveToward } from './vec'

const targetPos = (d: Draft, t: number | Vec2 | null | undefined): Vec2 | null => {
  if (t === null || t === undefined) return null
  if (typeof t === 'number') return byId(d, t)?.pos ?? null
  return t
}

const progressAction = (d: Draft, c: MCreature): void => {
  const a = c.action
  if (!a) return
  if (d.tick === a.activeAt) {
    emit(d, { type: 'action-hit', tick: d.tick, id: c.id, action: a.name })
    applyEffects(d, c, familyOf(d, c).resolve(d, c, a))
  }
  if (c.action === a && actionEnded(a, d.tick)) {
    emit(d, { type: 'action-end', tick: d.tick, id: c.id, action: a.name })
    c.action = null
  }
}

const decideAndAct = (d: Draft, c: MCreature): void => {
  if (c.action) return
  const f = familyOf(d, c)
  const down = c.state.kind === 'abattu'
  if (!freeToDecide(c, d.tick, !!f.canActWhileDown)) return
  const intent = f.decide(d, c)
  if (intent.kind === 'moveTo') {
    if (down) return
    const step = (f.base.speed * (intent.speedFactor ?? 1)) / 60
    const from = c.pos
    c.pos = moveToward(from, intent.target, step)
    c.facing = intent.keepFacing ?? (dist(from, c.pos) > 0 ? angleOf(from, c.pos) : c.facing)
    return
  }
  if (intent.kind !== 'act') return
  const def = f.actions[intent.action]
  if (!def) throw new Error(`action inconnue : ${c.family}.${intent.action}`)
  if (def.limb && c.limbs.find((l) => l.id === def.limb)?.state !== 'ok') return
  const tp = targetPos(d, intent.target)
  if (tp && dist(tp, c.pos) > 0) c.facing = angleOf(c.pos, tp)
  const channel = def.kind === 'canalisation'
  const activeAt = d.tick + (channel ? (def.channelTicks ?? 0) : def.telegraphTicks)
  c.action = {
    name: intent.action,
    kind: def.kind,
    start: d.tick,
    activeAt,
    end: channel ? activeAt : activeAt + def.recoverTicks,
    target: intent.target ?? null,
    limb: def.limb ?? null,
  }
  emit(d, { type: 'action-start', tick: d.tick, id: c.id, action: intent.action })
  // Une canalisation sur un corps le réserve : il ne se relève pas seul et aucun autre support ne le prend.
  if (channel && typeof intent.target === 'number') {
    const body = byId(d, intent.target)
    if (body && body.state.kind === 'abattu' && body.state.claimedBy === null) {
      body.state = { ...body.state, claimedBy: c.id }
    }
  }
}

// Une réservation ne vaut que tant que la canalisation qui l'a posée continue.
const releaseClaims = (d: Draft): void => {
  for (const b of d.creatures) {
    if (b.state.kind !== 'abattu' || typeof b.state.claimedBy !== 'number') continue
    const op = byId(d, b.state.claimedBy)
    const holds = op?.action?.kind === 'canalisation' && op.action.target === b.id && op.state.kind !== 'mort'
    if (!holds) releaseClaim(d, b)
  }
}

export const creaturesTick = (d: Draft): void => {
  releaseClaims(d)
  for (const c of [...d.creatures]) {
    if (!d.creatures.includes(c) || c.state.kind === 'mort') continue
    if (c.state.kind === 'absorbe') {
      const host = byId(d, c.state.into)
      if (host) c.pos = host.pos
      continue
    }
    familyTick(d, c)
    if (!isPresent(c)) continue
    progressAction(d, c)
    if (isStanding(c) || c.state.kind === 'abattu') decideAndAct(d, c)
  }
}
