// Le Bourreau (§6, §8.1, §8.2, §8.3) : Frappe, Esquive, Sentence, Balayage, Charge, changement d'arme.
import { damageAttackingLimb } from '../anatomy'
import {
  alert,
  byId,
  type Draft,
  emit,
  familyOf,
  gainFerveur,
  heal,
  interrupt,
  isDown,
  isPresent,
  isStanding,
  type MCreature,
  radiusOf,
} from '../draft'
import { applyEffects } from '../effects'
import { kill } from '../laws/death'
import { fall } from '../laws/flesh'
import { TUNING, type WeaponTuning } from '../tuning'
import type { BufferedCommand, DamageType, Effect, PlayerCommands, Vec2, World } from '../types'
import { add, angleOf, dist, distToSegment, fromAngle, inCone, len, norm, scale, sub } from '../vec'

export const weaponOf = (d: { player: { weapon: 'couperet' | 'masse' } }): WeaponTuning =>
  TUNING.weapons[d.player.weapon]

const facingToward = (from: Vec2, aim: Vec2, fallback: number): number =>
  dist(from, aim) < 1e-9 ? fallback : angleOf(from, aim)

interface HitContext {
  readonly heavy: boolean // 3e coup contondant
  readonly charge: boolean
  // Effets des crochets onPlayerHit (éclatement du Porteur) : appliqués après la boucle de dégâts du geste,
  // pour qu'un même coup n'achève jamais ce que l'éclatement vient d'abattre (L4), quel que soit l'ordre des id.
  readonly deferred: Array<{ readonly c: MCreature; readonly effects: readonly Effect[] }>
}

const flush = (d: Draft, ctx: HitContext): void => {
  for (const { c, effects } of ctx.deferred.splice(0)) applyEffects(d, c, effects)
}

type Outcome = 'achieved' | 'clang' | 'standing-hit' | 'variant-b' | 'none'

// Une instance de dégâts du joueur sur une créature. C'est le seul chemin vers la mort (L4).
export const playerHit = (
  d: Draft,
  c: MCreature,
  amount: number,
  type: DamageType,
  ctx: HitContext,
): Outcome => {
  if (isDown(c)) {
    if (c.action?.kind === 'canalisation') interrupt(d, c, 'player') // D6 : même sans effet sur la Chair
    if (c.resistant) {
      emit(d, { type: 'clang', tick: d.tick, id: c.id })
      return 'clang'
    }
    kill(d, c, 'achevement')
    gainFerveur(d, TUNING.ferveur.achevement, 'achevement')
    return 'achieved'
  }
  if (!isStanding(c)) return 'none'
  const wasRituel = c.state.kind === 'rituel'
  emit(d, { type: 'hit', tick: d.tick, target: c.id, amount, damageType: type, by: 'player' })
  const limb = damageAttackingLimb(d, c, amount, type)
  const before = c.chair
  c.chair -= amount
  if (c.chair <= 0) {
    const excess = amount - before
    if (d.variant === 'B' && !c.resistant && excess >= TUNING.variantBExcessRatio * c.chairMax) {
      kill(d, c, 'variant-b')
      gainFerveur(d, TUNING.ferveur.achevement, 'variant-b') // D10
      return 'variant-b'
    }
    fall(d, c, 'player')
  } else if (c.action) {
    const interrupts =
      c.action.kind === 'canalisation' || c.size === 'small' || ctx.heavy || ctx.charge || limb !== null
    if (interrupts) interrupt(d, c, 'player')
  }
  if (wasRituel) alert(d, c, 'damage')
  const hook = familyOf(d, c).onPlayerHit
  if (hook && c.state.kind !== 'mort') ctx.deferred.push({ c, effects: hook(d, c, d.player.pos) })
  return 'standing-hit'
}

type ImpactSets = { debout: number[]; abattusOrd: number[]; abattusRes: number[]; mortsDansZone: number }

const snapshotImpact = (d: Draft, inZone: (c: MCreature) => boolean): ImpactSets => {
  const s: ImpactSets = { debout: [], abattusOrd: [], abattusRes: [], mortsDansZone: 0 }
  for (const c of d.creatures) {
    if (!inZone(c)) continue
    if (c.state.kind === 'mort') s.mortsDansZone++
    else if (isStanding(c)) s.debout.push(c.id)
    else if (isDown(c)) (c.resistant ? s.abattusRes : s.abattusOrd).push(c.id)
  }
  return s
}

const strikeCone = (d: Draft) => {
  const w = weaponOf(d)
  return { origin: d.player.pos, facing: d.player.facing, reach: w.reach, arcDeg: w.arcDeg }
}

const startStrike = (d: Draft, aim: Vec2): void => {
  const p = d.player
  const w = weaponOf(d)
  const step = p.comboStep
  p.facing = facingToward(p.pos, aim, p.facing)
  p.action = { kind: 'frappe', start: d.tick, end: d.tick + w.period, comboStep: step }
  p.comboStep = ((step + 1) % 3) as 0 | 1 | 2
  const third = step === 2
  const amount = third ? w.thirdDamage : w.damage
  const cone = strikeCone(d)
  const inZone = (c: MCreature) => inCone(cone, c.pos, radiusOf(c))
  const sets = snapshotImpact(d, inZone)
  emit(d, { type: 'player-impact', tick: d.tick, source: 'frappe', comboStep: step, ...sets })
  let standingHits = 0
  const touched: MCreature[] = []
  const ctx: HitContext = { heavy: third && w.type === 'contondant', charge: false, deferred: [] }
  for (const c of [...d.creatures]) {
    if (!isPresent(c) || !inZone(c)) continue
    const out = playerHit(d, c, amount, w.type, ctx)
    if (out === 'standing-hit' || out === 'variant-b') standingHits++
    if (out === 'standing-hit') touched.push(c)
  }
  flush(d, ctx)
  if (standingHits > 0) {
    gainFerveur(
      d,
      Math.min(TUNING.ferveur.strikeCap, TUNING.ferveur.strikePerCreature * standingHits),
      'frappe',
    )
  }
  if (third) {
    for (const c of touched) {
      if (c.state.kind === 'mort') continue
      const dir = norm(sub(c.pos, p.pos))
      c.pos = add(c.pos, scale(len(dir) === 0 ? fromAngle(p.facing) : dir, w.thirdKnockback))
    }
  }
}

const startBalayage = (d: Draft): void => {
  const p = d.player
  const w = weaponOf(d)
  p.ferveur -= TUNING.balayage.cost
  p.action = { kind: 'balayage', start: d.tick, end: d.tick + TUNING.balayage.duration }
  emit(d, { type: 'player-rite', tick: d.tick, rite: 'balayage' })
  const inZone = (c: MCreature) => dist(c.pos, p.pos) <= TUNING.balayage.radius + radiusOf(c)
  emit(d, { type: 'player-impact', tick: d.tick, source: 'balayage', ...snapshotImpact(d, inZone) })
  const ctx: HitContext = { heavy: false, charge: false, deferred: [] }
  for (const c of [...d.creatures]) {
    if (isPresent(c) && inZone(c)) playerHit(d, c, TUNING.balayage.damage, w.type, ctx)
  }
  flush(d, ctx)
}

const startCharge = (d: Draft, aim: Vec2): void => {
  const p = d.player
  p.ferveur -= TUNING.charge.cost
  p.facing = facingToward(p.pos, aim, p.facing)
  p.action = {
    kind: 'charge',
    start: d.tick,
    end: d.tick + TUNING.charge.duration,
    dir: fromAngle(p.facing),
    charged: [],
    impact: { debout: [], abattusOrd: [], abattusRes: [], mortsDansZone: 0 },
  }
  emit(d, { type: 'player-rite', tick: d.tick, rite: 'charge' })
}

// Chaque tick de ruée : avance et touche ce qui est sur le segment parcouru, une fois par créature.
const chargeTick = (d: Draft): void => {
  const p = d.player
  const a = p.action
  if (a?.kind !== 'charge' || !a.dir || d.tick - a.start >= TUNING.charge.dashTicks) return
  const prev = a.impact ?? { debout: [], abattusOrd: [], abattusRes: [], mortsDansZone: 0 }
  const impact: ImpactSets = {
    debout: [...prev.debout],
    abattusOrd: [...prev.abattusOrd],
    abattusRes: [...prev.abattusRes],
    mortsDansZone: prev.mortsDansZone,
  }
  const from = p.pos
  const to = add(from, scale(a.dir, TUNING.charge.length / TUNING.charge.dashTicks))
  p.pos = to
  const charged = [...(a.charged ?? [])]
  const ctx: HitContext = { heavy: false, charge: true, deferred: [] }
  for (const c of [...d.creatures]) {
    if (!isPresent(c) || charged.includes(c.id)) continue
    if (distToSegment(c.pos, from, to) > TUNING.charge.hitHalfWidth) continue
    charged.push(c.id)
    if (c.state.kind === 'mort') impact.mortsDansZone++
    else if (isStanding(c)) impact.debout.push(c.id)
    else (c.resistant ? impact.abattusRes : impact.abattusOrd).push(c.id)
    const out = playerHit(d, c, TUNING.charge.damage, weaponOf(d).type, ctx)
    if (out === 'standing-hit') {
      const side = (c.pos.x - from.x) * -a.dir.z + (c.pos.z - from.z) * a.dir.x
      const lateral = fromAngle(angleOf({ x: 0, z: 0 }, a.dir) + (side < 0 ? -Math.PI / 2 : Math.PI / 2))
      c.pos = add(c.pos, scale(lateral, TUNING.charge.push))
    }
  }
  flush(d, ctx)
  p.action = { ...a, charged, impact }
  if (d.tick - a.start === TUNING.charge.dashTicks - 1) {
    emit(d, { type: 'player-impact', tick: d.tick, source: 'charge', ...impact })
  }
}

export const sentenceTargetOf = (w: World, aim: Vec2): number | null => {
  let best: { id: number; dAim: number; dPlayer: number } | null = null
  for (const c of w.creatures) {
    if (c.state.kind !== 'abattu') continue
    if (c.state.claimedBy !== null && c.state.claimedBy !== 'player') continue
    const dPlayer = dist(c.pos, w.player.pos)
    if (dPlayer > TUNING.sentence.range) continue
    const dAim = dist(c.pos, aim)
    const better =
      !best ||
      dAim < best.dAim - 1e-9 ||
      (Math.abs(dAim - best.dAim) <= 1e-9 && dPlayer < best.dPlayer - 1e-9) ||
      (Math.abs(dAim - best.dAim) <= 1e-9 && Math.abs(dPlayer - best.dPlayer) <= 1e-9 && c.id < best.id)
    if (better) best = { id: c.id, dAim, dPlayer }
  }
  return best?.id ?? null
}

const startSentence = (d: Draft, aim: Vec2): boolean => {
  const p = d.player
  const targetId = sentenceTargetOf(d as unknown as World, aim)
  const t = targetId === null ? undefined : byId(d, targetId)
  if (t?.state.kind !== 'abattu') {
    emit(d, { type: 'sentence-none', tick: d.tick })
    return false
  }
  const duration = t.resistant ? TUNING.sentence.durationResistant : TUNING.sentence.durationOrdinaire
  // La saisie interrompt une canalisation de la cible (un Confesseur qui prie à terre).
  if (t.action?.kind === 'canalisation') interrupt(d, t, 'player')
  // La cible est réservée ; un corps encore muet le reste : l'exécution est silencieuse.
  const cryAt = t.state.cryAt !== null && t.state.cryAt > d.tick ? null : t.state.cryAt
  t.state = { ...t.state, claimedBy: 'player', cryAt }
  p.facing = angleOf(p.pos, t.pos)
  if (dist(p.pos, t.pos) > 1) p.pos = sub(t.pos, scale(fromAngle(p.facing), 1))
  p.action = { kind: 'sentence', start: d.tick, end: d.tick + duration, target: t.id }
  p.invulnerableUntil = Math.max(p.invulnerableUntil, d.tick + duration)
  emit(d, { type: 'sentence-start', tick: d.tick, target: t.id })
  return true
}

const finishSentence = (d: Draft, targetId: number): void => {
  const t = byId(d, targetId)
  if (t?.state.kind !== 'abattu') return
  const resistant = t.resistant
  kill(d, t, 'sentence')
  heal(d, resistant ? TUNING.sentence.healResistant : TUNING.sentence.healOrdinaire, 'sentence')
  gainFerveur(d, resistant ? TUNING.ferveur.sentenceResistant : TUNING.ferveur.sentenceOrdinaire, 'sentence')
}

const startDodge = (d: Draft, cmds: PlayerCommands, aim: Vec2): boolean => {
  const p = d.player
  if (p.dodgeCharges <= 0) return false
  if (p.action?.kind === 'frappe') p.comboStep = 0 // l'Esquive annule une Frappe
  p.dodgeCharges -= 1
  if (p.dodgeRechargeAt === null) p.dodgeRechargeAt = d.tick + TUNING.dodge.recharge
  const dir = len(cmds.move) > 0 ? norm(cmds.move) : fromAngle(facingToward(p.pos, aim, p.facing))
  p.action = { kind: 'esquive', start: d.tick, end: d.tick + TUNING.dodge.duration, dir }
  p.invulnerableUntil = Math.max(p.invulnerableUntil, d.tick + TUNING.dodge.iframes)
  emit(d, { type: 'player-dodge', tick: d.tick })
  return true
}

const hostileWithin = (d: Draft, r: number): boolean =>
  d.creatures.some((c) => c.state.kind === 'hostile' && dist(c.pos, d.player.pos) <= r)

const tryStart = (d: Draft, cmd: BufferedCommand, cmds: PlayerCommands, aim: Vec2): boolean => {
  const p = d.player
  switch (cmd) {
    case 'dodge':
      return startDodge(d, cmds, aim)
    case 'sentence':
      startSentence(d, aim)
      return true
    case 'balayage':
      if (p.ferveur < TUNING.balayage.cost) return true
      startBalayage(d)
      return true
    case 'charge':
      if (p.ferveur < TUNING.charge.cost) return true
      startCharge(d, aim)
      return true
  }
}

const requested = (cmds: PlayerCommands): BufferedCommand | null =>
  cmds.dodge ? 'dodge' : cmds.sentence ? 'sentence' : cmds.rite

export const playerTick = (d: Draft, cmds: PlayerCommands): void => {
  const p = d.player
  // 1. Fin d'action.
  if (p.action && d.tick >= p.action.end) {
    const a = p.action
    p.action = null
    if (a.kind === 'sentence' && a.target !== undefined) finishSentence(d, a.target)
    if (a.kind === 'frappe' && !cmds.strike) p.comboStep = 0
  }
  // 2. Demande du tick, sinon demande en attente.
  const req = requested(cmds)
  if (req) p.buffer = { cmd: req, until: d.tick + TUNING.commandBuffer, aim: cmds.aim }
  if (p.buffer && d.tick > p.buffer.until) p.buffer = null
  const canCancel = p.buffer?.cmd === 'dodge' && p.action?.kind === 'frappe'
  if (p.buffer && (!p.action || canCancel)) {
    const b = p.buffer
    if (canCancel) p.action = null
    if (tryStart(d, b.cmd, cmds, b.aim)) p.buffer = null
  }
  // 3. Changement d'arme, puis Frappe maintenue.
  if (!p.action && cmds.swapWeapon && !hostileWithin(d, TUNING.swapHostileRadius)) {
    p.weapon = p.weapon === 'couperet' ? 'masse' : 'couperet'
    p.comboStep = 0
    emit(d, { type: 'weapon-swap', tick: d.tick, weapon: p.weapon })
  }
  if (!p.action && cmds.strike) startStrike(d, cmds.aim)
  // 4. Mouvement.
  const a = p.action
  if (!a) {
    p.facing = facingToward(p.pos, cmds.aim, p.facing)
    if (len(cmds.move) > 0) p.pos = add(p.pos, scale(norm(cmds.move), TUNING.playerSpeed / 60))
  } else if (a.kind === 'esquive' && a.dir) {
    p.pos = add(p.pos, scale(a.dir, TUNING.dodge.distance / TUNING.dodge.duration))
  } else if (a.kind === 'charge') {
    chargeTick(d)
  }
}

export const playerTimersTick = (d: Draft): void => {
  const p = d.player
  if (d.tick - p.lastFerveurGain > TUNING.ferveur.decayDelay && p.ferveur > 0) {
    p.ferveur = Math.max(0, p.ferveur - TUNING.ferveur.decayPerSecond / 60)
  }
  if (p.dodgeRechargeAt !== null && d.tick >= p.dodgeRechargeAt) {
    p.dodgeCharges = Math.min(TUNING.dodge.charges, p.dodgeCharges + 1)
    p.dodgeRechargeAt = p.dodgeCharges < TUNING.dodge.charges ? d.tick + TUNING.dodge.recharge : null
  }
}
