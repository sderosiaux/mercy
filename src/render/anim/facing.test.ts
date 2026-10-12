// Orientation affichée du Bourreau (E6) : un changement d'orientation de la simulation ne fait jamais sauter le
// modèle d'une image à l'autre, le virage tient dans l'anticipation la plus courte, et au tick où un coup porte le
// modèle regarde exactement dans la direction du coup. Sur de vrais mondes de la simulation (règle du 2026-10-12 :
// face à la marche, vers le curseur au début d'un geste, orientation gardée à l'arrêt).
import { describe, expect, it } from 'vitest'
import { FAMILIES, step, TUNING, type World } from '../../sim/index'
import { cmd, scene } from '../../sim/testing'
import { FacingSmoother, TURN_TICKS, turnAt, wrapAngle } from './facing'
import { AnimMemory, playerDeadline } from './memory'

const diff = (a: number, b: number): number => Math.abs(wrapAngle(a - b))

const empty = (): World =>
  scene([{ family: 'souriant', pos: { x: 12, z: 12 }, facing: 0, state: 'rituel' }], { families: FAMILIES })

// Joue des commandes tick par tick, mémoire observée après chaque pas ; renvoie les mondes.
const play = (w0: World, commands: (w: World) => ReturnType<typeof cmd>, ticks: number) => {
  const mem = new AnimMemory()
  const worlds: World[] = [w0]
  let w = w0
  mem.observe(w)
  for (let k = 0; k < ticks; k++) {
    w = step(w, commands(w))
    mem.observe(w)
    worlds.push(w)
  }
  return { mem, worlds }
}

describe('virage affiché', () => {
  it('le virage tient dans l’anticipation la plus courte des armes', () => {
    expect(TURN_TICKS).toBe(Math.min(...Object.values(TUNING.weapons).map((w) => w.windup)))
    expect(TURN_TICKS).toBeGreaterThanOrEqual(1)
  })

  it('orientation constante : le modèle ne bouge pas', () => {
    const s = new FacingSmoother()
    for (let T = 0; T < 10; T++) {
      s.observe({ tick: T, facing: 1.2, deadline: null, snap: false })
      if (T > 0) for (let k = 1; k <= 4; k++) expect(s.at(T - 1 + k / 4)).toBeCloseTo(1.2, 12)
    }
  })

  it('demi-tour instantané de la simulation : virage lissé, monotone, fini en TURN_TICKS, sans saut', () => {
    const s = new FacingSmoother()
    for (let T = 0; T <= 3; T++) s.observe({ tick: T, facing: 0, deadline: null, snap: false })
    const shown: number[] = []
    for (let T = 4; T <= 4 + TURN_TICKS + 2; T++) {
      s.observe({ tick: T, facing: Math.PI, deadline: null, snap: false })
      for (let k = 1; k <= 4; k++) shown.push(s.at(T - 1 + k / 4) as number)
    }
    // Avant le virage : 0. Pendant : chaque image avance, aucune ne recule, aucune ne saute plus que la pente
    // maximale d'une courbe d'Hermite (1,5 × l'écart / la durée), divisée par 4 images par tick.
    const unwrapped = shown.map((a) => (a < -1e-9 ? a + 2 * Math.PI : a))
    let prev = 0
    for (const a of unwrapped) {
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(a - prev).toBeLessThanOrEqual((1.5 * Math.PI) / TURN_TICKS / 4 + 1e-9)
      prev = a
    }
    expect(diff(s.at(3 + TURN_TICKS) as number, Math.PI)).toBeLessThan(1e-9)
    expect(diff(s.at(3 + TURN_TICKS - 1) as number, Math.PI)).toBeGreaterThan(0.01)
  })

  it('une cible qui change pendant un virage repart de la pose et de la vitesse affichées (continuité)', () => {
    const s = new FacingSmoother()
    s.observe({ tick: 0, facing: 0, deadline: null, snap: false })
    s.observe({ tick: 1, facing: 0, deadline: null, snap: false })
    s.observe({ tick: 2, facing: 2, deadline: null, snap: false })
    const before = s.at(2) as number
    s.observe({ tick: 3, facing: 1, deadline: null, snap: false })
    // Même valeur au tick 2, que l'on lise le virage décidé à 2 ou celui décidé à 3 (l'image ne saute pas).
    expect(s.at(2)).toBeCloseTo(before, 12)
    // Jamais au-delà de la nouvelle cible ni en deçà de la pose de départ (courbe monotone).
    const lo = Math.min(before, 1) - 1e-9
    const hi = Math.max(before, 1) + 1e-9
    for (let T = 3; T <= 3 + TURN_TICKS + 1; T++) {
      if (T > 3) s.observe({ tick: T, facing: 1, deadline: null, snap: false })
      for (let k = 1; k <= 4; k++) {
        const a = s.at(T - 1 + k / 4) as number
        expect(a).toBeGreaterThanOrEqual(lo)
        expect(a).toBeLessThanOrEqual(hi)
      }
    }
    expect(s.at(3 + TURN_TICKS)).toBeCloseTo(1, 12)
  })

  it('l’échéance d’un coup l’emporte : au tick d’impact, le virage est fini', () => {
    const s = new FacingSmoother()
    for (let T = 0; T <= 3; T++) s.observe({ tick: T, facing: 0, deadline: null, snap: false })
    s.observe({ tick: 4, facing: 3, deadline: 6, snap: false })
    s.observe({ tick: 5, facing: 3, deadline: 6, snap: false })
    s.observe({ tick: 6, facing: 3, deadline: 6, snap: false })
    expect(s.at(6)).toBeCloseTo(3, 12)
    expect(diff(s.at(4) as number, 3)).toBeGreaterThan(0.1)
  })

  it('un tick qui recule (nouvelle partie) ou un saut de ticks repart sans virage', () => {
    const s = new FacingSmoother()
    s.observe({ tick: 0, facing: 0, deadline: null, snap: false })
    s.observe({ tick: 1, facing: 0, deadline: null, snap: false })
    s.observe({ tick: 0, facing: 2, deadline: null, snap: false })
    expect(s.at(0)).toBeCloseTo(2, 12)
    s.observe({ tick: 9, facing: -1, deadline: null, snap: false })
    expect(s.at(9)).toBeCloseTo(-1, 12)
    expect(s.at(30)).toBeNull()
  })

  it('courbe d’Hermite : extrémités exactes', () => {
    const turn = { from: 2, d: 5, p0: 0.5, m0: 0.8, p1: 2 }
    expect(turnAt(turn, 2)).toBeCloseTo(0.5, 12)
    expect(turnAt(turn, 7)).toBeCloseTo(2, 12)
    expect(turnAt(turn, 9)).toBeCloseTo(2, 12)
  })
})

describe('sur la simulation', () => {
  it('Frappe derrière soi : demi-tour lissé, le modèle regarde le coup au tick d’impact', () => {
    // Il marche vers +x (il fait face à sa marche), s'arrête, puis frappe vers −x : la simulation le retourne d'un coup
    // au début du geste.
    const { mem, worlds } = play(
      empty(),
      (w) =>
        w.tick < 10
          ? cmd({ move: { x: 1, z: 0 }, aim: { x: w.player.pos.x + 3, z: w.player.pos.z } })
          : cmd({ strike: w.tick === 12 && w.player.action === null, aim: { x: w.player.pos.x - 3, z: 0 } }),
      40,
    )
    const strike = worlds.find((w) => w.player.action?.kind === 'frappe')
    const a = strike?.player.action
    expect(a?.activeAt).toBeDefined()
    const start = a?.start as number
    const activeAt = a?.activeAt as number
    expect(diff(strike?.player.facing as number, Math.PI)).toBeLessThan(1e-9)
    // La mémoire garde les derniers ticks : on rejoue en lisant l'orientation affichée entre chaque tick (4 images par
    // tick, comme un écran à 240 Hz) ; aucune image ne saute plus que la pente maximale du virage.
    const replay = new AnimMemory()
    let last: number | null = null
    for (const w of worlds) {
      replay.observe(w)
      for (let k = 1; k <= 4; k++) {
        const a = replay.playerFacing.at(w.tick - 1 + k / 4)
        if (a === null) continue
        if (last !== null) expect(diff(a, last)).toBeLessThanOrEqual((1.5 * Math.PI) / TURN_TICKS / 4 + 1e-6)
        last = a
      }
      if (w.tick === start) {
        // Au départ du geste, le modèle n'a pas encore fait le demi-tour (pas de saut)…
        expect(diff(replay.playerFacing.at(start) as number, Math.PI)).toBeGreaterThan(0.5)
        expect(diff(replay.playerFacing.at(start - 1) as number, 0)).toBeLessThan(1e-9)
      }
      if (w.tick === activeAt) {
        // … et au tick d'impact il regarde exactement dans la direction du coup.
        expect(w.events.some((e) => e.type === 'player-impact')).toBe(true)
        expect(diff(replay.playerFacing.at(activeAt) as number, w.player.facing)).toBeLessThan(1e-9)
      }
    }
    expect(mem.lastTick).toBe(40)
  })

  it('marche au clavier : un quart de tour de la marche est lissé ; à l’arrêt, l’orientation reste', () => {
    const { worlds } = play(
      empty(),
      (w) =>
        cmd({
          move: w.tick < 10 ? { x: 1, z: 0 } : w.tick < 20 ? { x: 0, z: 1 } : { x: 0, z: 0 },
          aim: { x: -5, z: -5 },
        }),
      30,
    )
    const replay = new AnimMemory()
    let jump = 0
    let last: number | null = null
    for (const w of worlds) {
      replay.observe(w)
      for (let k = 1; k <= 4; k++) {
        const a = replay.playerFacing.at(w.tick - 1 + k / 4)
        if (a === null) continue
        if (last !== null) jump = Math.max(jump, diff(a, last))
        last = a
      }
    }
    expect(jump).toBeLessThanOrEqual((1.5 * (Math.PI / 2)) / TURN_TICKS / 4 + 1e-6)
    expect(replay.playerFacing.at(30)).toBeCloseTo(Math.PI / 2, 9)
  })

  it('échéance du geste : impact d’une Frappe, fin d’une Sentence, rien pour une Esquive', () => {
    const w0 = empty()
    const w1 = step(w0, cmd({ strike: true, aim: { x: 3, z: 0 } }))
    const a = w1.player.action
    expect(playerDeadline(w1, w1.tick)).toBe(a?.activeAt)
    const w2 = step(w0, cmd({ dodge: true, move: { x: 0, z: 1 } }))
    expect(w2.player.action?.kind).toBe('esquive')
    expect(playerDeadline(w2, w2.tick)).toBeNull()
  })
})
