// Application des effets déclaratifs renvoyés par les familles. Aucun effet ne peut tuer : seule la mort
// donnée par le joueur tue (§30.1). Un éclatement abat, il ne tue jamais.
import { reattach } from './anatomy'
import {
  alert,
  byId,
  chairMaxFor,
  type Draft,
  emit,
  familyOf,
  gainFerveur,
  interrupt,
  isDown,
  isPresent,
  isStanding,
  type MCreature,
  radiusOf,
} from './draft'
import { fall } from './laws/flesh'
import { noise } from './laws/indifference'
import { rise } from './laws/rise'
import { PORTEUR_STAGE_KEY } from './predicates'
import { nextFloat } from './rng'
import { TUNING } from './tuning'
import type { Area, Effect, Vec2 } from './types'
import { add, angleOf, dist, fromAngle, inCone, scale } from './vec'

const inArea = (area: Area, p: Vec2, radius: number): boolean =>
  area.kind === 'circle' ? dist(area.center, p) <= area.radius + radius : inCone(area, p, radius)

const rand = (d: Draft): number => {
  const [v, next] = nextFloat(d.rng)
  d.rng = next
  return v
}

const clampArena = (p: Vec2): Vec2 => {
  const h = TUNING.arenaHalf - TUNING.radiusLarge
  return { x: Math.max(-h, Math.min(h, p.x)), z: Math.max(-h, Math.min(h, p.z)) }
}

const damagePlayer = (
  d: Draft,
  self: MCreature,
  amount: number,
  source: 'creature' | 'burst',
  push?: { from: Vec2; distance: number },
): void => {
  const p = d.player
  if (d.tick < p.invulnerableUntil) {
    const a = p.action
    if (a?.kind === 'esquive' && d.tick - a.start < TUNING.dodge.perfectWindow && !a.perfectDone) {
      p.action = { ...a, perfectDone: true }
      emit(d, { type: 'player-perfect-dodge', tick: d.tick })
      gainFerveur(d, TUNING.ferveur.perfectDodge, 'esquive-parfaite')
    }
    return
  }
  p.vie -= amount
  emit(d, { type: 'hit', tick: d.tick, target: 'player', amount, damageType: source, by: self.id })
  if (push && push.distance > 0) {
    const away = dist(push.from, p.pos) < 1e-9 ? self.facing : angleOf(push.from, p.pos)
    p.pos = clampArena(add(p.pos, scale(fromAngle(away), push.distance)))
  }
}

const damageCreatures = (d: Draft, self: MCreature, e: Extract<Effect, { kind: 'damage' }>): void => {
  for (const c of d.creatures) {
    if (c.id === self.id || !isPresent(c) || !inArea(e.area, c.pos, radiusOf(c))) continue
    if (c.action?.kind === 'canalisation') interrupt(d, c, 'burst') // D6
    if (isDown(c)) {
      // Un Abattu est projeté de 2 à 4 m et reste Abattu.
      const center = e.area.kind === 'circle' ? e.area.center : e.area.origin
      const away = dist(center, c.pos) < 1e-9 ? rand(d) * 2 * Math.PI : angleOf(center, c.pos)
      c.pos = clampArena(add(c.pos, scale(fromAngle(away), 2 + 2 * rand(d))))
      continue
    }
    const wasRituel = c.state.kind === 'rituel'
    emit(d, { type: 'hit', tick: d.tick, target: c.id, amount: e.amount, damageType: e.source, by: self.id })
    if (c.size === 'small' && !c.resistant && e.abatSmall) {
      fall(d, c, 'burst')
      continue
    }
    c.chair -= e.amount
    c.stunnedUntil = Math.max(c.stunnedUntil, d.tick + e.staggerLarge)
    interrupt(d, c, 'burst')
    if (c.chair <= 0) fall(d, c, 'burst')
    else if (wasRituel) alert(d, c, 'damage')
  }
}

const absorbable = (c: MCreature | undefined): c is MCreature =>
  !!c && c.state.kind === 'abattu' && c.state.claimedBy === null && !c.resistant && c.family !== 'membre'

export const applyEffects = (d: Draft, self: MCreature, effects: readonly Effect[]): void => {
  for (const e of effects) {
    switch (e.kind) {
      case 'damage':
        if (inArea(e.area, d.player.pos, TUNING.playerRadius)) {
          const from = e.area.kind === 'circle' ? e.area.center : e.area.origin
          damagePlayer(d, self, e.amount, e.source, { from, distance: e.knockback ?? 0 })
        }
        if (e.hitsCreatures) damageCreatures(d, self, e)
        break
      case 'raise': {
        // Une prière achevée émet toujours prayer-complete, même si elle ne relève personne.
        const raised: number[] = []
        for (const id of e.ids) {
          const c = byId(d, id)
          if (
            c &&
            c.state.kind === 'abattu' &&
            c.state.claimedBy === null &&
            !c.resistant &&
            c.family !== 'membre'
          ) {
            rise(d, c, 'priere')
            raised.push(c.id)
          }
        }
        emit(d, { type: 'prayer-complete', tick: d.tick, id: self.id, others: raised })
        break
      }
      case 'absorb': {
        const c = byId(d, e.id)
        if (!absorbable(c)) break
        interrupt(d, c, 'creature') // un corps avalé perd sa canalisation (Confesseur qui priait à terre)
        c.state = { kind: 'absorbe', into: self.id, cryAt: c.state.kind === 'abattu' ? c.state.cryAt : null }
        c.unionOf = self.id
        c.pos = self.pos
        emit(d, { type: 'absorb', tick: d.tick, id: self.id, others: [c.id] })
        break
      }
      case 'expelAll': {
        const inside = d.creatures.filter((c) => c.state.kind === 'absorbe' && c.state.into === self.id)
        for (const c of inside) {
          const cryAt = c.state.kind === 'absorbe' ? c.state.cryAt : null
          c.state = {
            kind: 'abattu',
            since: d.tick,
            riseAt: d.tick + (c.resistant ? TUNING.relevementResistant : TUNING.relevementOrdinaire),
            cryAt,
            claimedBy: null,
          }
          c.unionOf = null
          c.pos = clampArena(add(self.pos, scale(fromAngle(rand(d) * 2 * Math.PI), 1 + 1.5 * rand(d))))
          emit(d, { type: 'fell', tick: d.tick, id: c.id })
        }
        const others = inside.map((c) => c.id)
        emit(d, {
          type: 'burst',
          tick: d.tick,
          id: self.id,
          others,
          cause: e.cause,
          stage: self.familyData[PORTEUR_STAGE_KEY] ?? 0,
        })
        emit(d, { type: 'expel', tick: d.tick, id: self.id, others })
        break
      }
      case 'assemble': {
        const recousu = d.families.recousu
        const bodies = e.ids.map((id) => byId(d, id)).filter(absorbableOrClaimedBy(self.id))
        if (!recousu || bodies.length < 2) break
        const id = d.nextId++
        const center = {
          x: bodies.reduce((s, b) => s + b.pos.x, 0) / bodies.length,
          z: bodies.reduce((s, b) => s + b.pos.z, 0) / bodies.length,
        }
        const base = TUNING.chirurgien.assembleChairPerBody * bodies.length
        d.creatures.push({
          id,
          family: 'recousu',
          size: recousu.size,
          pos: center,
          facing: angleOf(center, d.player.pos),
          chair: chairMaxFor(base, 0),
          chairMax: chairMaxFor(base, 0),
          cicatrices: 0,
          resistant: false,
          state: { kind: 'hostile', alertedAt: d.tick - TUNING.alertTurnTicks },
          unionOf: null,
          limbs: recousu.base.limbs.map((l) => ({ id: l.id, hp: l.hp, hpMax: l.hp, state: 'ok' })),
          action: null,
          stunnedUntil: 0,
          spawn: null,
          group: null,
          ritualPhase: 0,
          familyData: { baseChair: base },
        })
        for (const b of bodies) {
          interrupt(d, b, 'creature')
          b.state = { kind: 'absorbe', into: id, cryAt: b.state.kind === 'abattu' ? b.state.cryAt : null }
          b.unionOf = id
          b.pos = center
        }
        emit(d, { type: 'assemble', tick: d.tick, id: self.id, others: bodies.map((b) => b.id), created: id })
        break
      }
      case 'repair': {
        const c = byId(d, e.id)
        if (c?.state.kind !== 'abattu') break
        if (c.state.claimedBy !== null && c.state.claimedBy !== self.id) break
        if (c.family === 'membre') reattach(d, c, self.id)
        else rise(d, c, 'chirurgien')
        break
      }
      case 'alert':
        noise(d, e.center, e.radius, e.cause)
        break
      case 'selfAbattu':
        if (isStanding(self)) fall(d, self, 'creature')
        break
      case 'setData':
        self.familyData = { ...self.familyData, [e.key]: e.value }
        break
      case 'dashSelf':
        self.pos = clampArena(e.to)
        break
    }
  }
}

const absorbableOrClaimedBy =
  (surgeon: number) =>
  (c: MCreature | undefined): c is MCreature =>
    !!c &&
    c.state.kind === 'abattu' &&
    (c.state.claimedBy === null || c.state.claimedBy === surgeon) &&
    !c.resistant &&
    c.family !== 'membre'

export const familyTick = (d: Draft, c: MCreature): void => {
  const f = familyOf(d, c)
  if (f.tick) applyEffects(d, c, f.tick(d, c))
}
