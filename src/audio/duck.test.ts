import { describe, expect, it } from 'vitest'
import { DUCK_HOLD_S } from './constants'
import { DUCK_IDLE, DUCK_RAMP_S, type DuckState, duckStep } from './duck'

const run = (deathsAt: readonly number[], times: readonly number[]) => {
  let s: DuckState = DUCK_IDLE
  const out: { t: number; cmd: string | null; releaseAt?: number; kind: string }[] = []
  for (const t of times) {
    const r = duckStep(s, deathsAt.includes(t), t)
    s = r.state
    out.push({
      t,
      cmd: r.cmd?.t ?? null,
      ...(r.cmd ? { releaseAt: r.cmd.releaseAt } : {}),
      kind: s.kind,
    })
  }
  return out
}

const ticks = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => (from + i) / 60)

describe('atténuation de l’ambiance (§8.2, §19, D9)', () => {
  it('une mort : descente au tick de la mort, remontée 0,4 s plus tard', () => {
    const t = ticks(0, 60)
    const r = run([t[10] as number], t)
    const down = r.find((x) => x.cmd === 'duck-down')
    expect(down?.t).toBe(t[10])
    expect(down?.releaseAt).toBeCloseTo((t[10] as number) + DUCK_HOLD_S, 12)
    expect(r.filter((x) => x.cmd !== null)).toHaveLength(1)
    // Au repos dès que la remontée est finie.
    const idleAgain = r.find((x) => x.t > (t[10] as number) && x.kind === 'idle')
    expect(idleAgain?.t).toBeGreaterThanOrEqual((t[10] as number) + DUCK_HOLD_S + DUCK_RAMP_S)
  })

  it('une grappe ne s’empile pas : les morts suivantes ne font que reculer la remontée', () => {
    const t = ticks(0, 120)
    const r = run([t[10] as number, t[16] as number, t[30] as number], t)
    expect(r.filter((x) => x.cmd === 'duck-down')).toHaveLength(1)
    const ext = r.filter((x) => x.cmd === 'duck-extend')
    expect(ext.map((x) => x.t)).toEqual([t[16], t[30]])
    expect(ext[1]?.releaseAt).toBeCloseTo((t[30] as number) + DUCK_HOLD_S, 12)
  })

  it('une mort après la remontée ouvre une nouvelle descente', () => {
    const t = ticks(0, 120)
    const r = run([t[0] as number, t[60] as number], t)
    expect(r.filter((x) => x.cmd === 'duck-down').map((x) => x.t)).toEqual([t[0], t[60]])
  })

  it('une mort pendant la remontée redescend depuis le niveau courant', () => {
    const s0: DuckState = { kind: 'held', since: 0, releaseAt: 0.4 }
    const r = duckStep(s0, true, 0.4 + DUCK_RAMP_S / 2)
    expect(r.cmd?.t).toBe('duck-down')
  })
})
