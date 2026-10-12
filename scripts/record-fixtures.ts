// Enregistre les journaux d'entrées figés de fixtures/inputs/ (B7) : trois combats de Souriants, et une partie de
// V5 où les cinq familles agissent (revue P0, T1). À relancer seulement si le format change : le contrôle de
// déterminisme compare des rejeux entre eux, pas à une valeur attendue. Sans argument, tout est réenregistré ;
// avec des noms (`tsx scripts/record-fixtures.ts v5-cinq-familles`), seulement ceux-là.
import { writeFileSync } from 'node:fs'
import { DEFAULT_SPEC, playRun } from '../src/bots/harness'
import {
  createWorld,
  FAMILIES,
  IDLE_COMMANDS,
  type PlayerCommands,
  step,
  type WaveDef,
  type World,
} from '../src/sim/index'
import { dist, norm, sub } from '../src/sim/vec'
import { waveById } from '../src/sim/waves'

const only = new Set(process.argv.slice(2))
const wanted = (name: string): boolean => only.size === 0 || only.has(name)

const wave: WaveDef = {
  id: 'fixture-souriants',
  test: false,
  playerStart: { x: 0, z: 0 },
  jitter: { posM: 1, ritualPhase: true },
  spawns: [
    ...[0, 1, 2, 3].map((i) => ({ family: 'souriant' as const, pos: { x: 6 + i * 0.8, z: 4 }, group: 1 })),
    ...[0, 1, 2, 3].map((i) => ({ family: 'souriant' as const, pos: { x: -6 - i * 0.8, z: -5 }, group: 2 })),
    ...[0, 1, 2].map((i) => ({
      family: 'souriant' as const,
      pos: { x: 2 * i - 2, z: 9 },
      state: 'hostile' as const,
    })),
  ],
}

type Policy = (w: World) => PlayerCommands

const fighter =
  (opts: { passiveUntil: number }): Policy =>
  (w) => {
    if (w.tick < opts.passiveUntil) return IDLE_COMMANDS
    const p = w.player
    const alive = w.creatures.filter((c) => c.state.kind === 'rituel' || c.state.kind === 'hostile')
    const down = w.creatures.find((c) => c.state.kind === 'abattu' && dist(c.pos, p.pos) <= 2.4)
    const target = alive.reduce<(typeof alive)[number] | undefined>(
      (best, c) => (!best || dist(c.pos, p.pos) < dist(best.pos, p.pos) ? c : best),
      undefined,
    )
    const aim = target?.pos ?? down?.pos ?? { x: p.pos.x + 1, z: p.pos.z }
    const near = target ? dist(target.pos, p.pos) : 99
    return {
      move: near > 1.8 && target ? norm(sub(target.pos, p.pos)) : { x: 0, z: 0 },
      aim,
      strike: near <= 2.2,
      dodge: w.tick % 97 === 0,
      sentence: !!down && p.vie < 60 && w.tick % 13 === 0,
      rite:
        p.ferveur >= 35 && w.tick % 41 === 0
          ? 'charge'
          : p.ferveur >= 25 && w.tick % 29 === 0
            ? 'balayage'
            : null,
      swapWeapon: w.tick === 900,
    }
  }

const record = (name: string, seed: number, variant: 'A' | 'B', policy: Policy, ticks: number) => {
  if (!wanted(name)) return
  let w = createWorld({ seed, variant, wave, families: FAMILIES })
  const commands: PlayerCommands[] = []
  for (let i = 0; i < ticks; i++) {
    const c = policy(w)
    commands.push(c)
    w = step(w, c)
  }
  const deaths = w.player.deaths
  writeFileSync(`fixtures/inputs/${name}.json`, `${JSON.stringify({ seed, variant, wave, commands })}\n`)
  console.log(`${name} : ${ticks} ticks, morts du joueur ${deaths}, tick final ${w.tick}`)
}

// Une partie du banc (politique, vague, graine), commandes appliquées gardées telles quelles.
const recordBench = (name: string, waveId: string, policy: string, seed: number, ticks: number) => {
  if (!wanted(name)) return
  const variant = 'A'
  const { result, trace } = playRun(
    { ...DEFAULT_SPEC, wave: waveId, policy, seed, variant, timeoutTicks: ticks },
    { keepCommands: true },
  )
  const commands = trace.commands ?? []
  const log = { seed, variant, wave: waveById(waveId), commands }
  writeFileSync(`fixtures/inputs/${name}.json`, `${JSON.stringify(log)}\n`)
  console.log(
    `${name} : ${waveId}, ${policy}, graine ${seed}, ${commands.length} ticks, fin ${result.endTick}`,
  )
}

record('combat-a', 11, 'A', fighter({ passiveUntil: 0 }), 1800)
record('combat-b', 23, 'B', fighter({ passiveUntil: 0 }), 1800)
record('mort-puis-combat', 37, 'A', fighter({ passiveUntil: 600 }), 2400)
// Les cinq familles agissent (prière, opération, éclatement), et le joueur meurt une fois (L6 sur toutes).
recordBench('v5-cinq-familles', 'V5', 'négligent', 2, 3600)
