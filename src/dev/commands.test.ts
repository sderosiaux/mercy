import { describe, expect, it } from 'vitest'
import { IDLE_COMMANDS, type PlayerCommands } from '../sim/index'
import { decodeCommand, decodeNumber, encodeCommand, encodeNumber } from './commands'

const roundTrip = (c: PlayerCommands): PlayerCommands =>
  decodeCommand(JSON.parse(JSON.stringify(encodeCommand(c))))

describe('journal des commandes', () => {
  it('rend chaque nombre à l’identique à travers JSON, −0 et non-finis compris', () => {
    for (const n of [0, -0, 1, -1, 0.1 + 0.2, -Math.PI, 1e-300, Number.MAX_VALUE]) {
      const back = decodeNumber(JSON.parse(JSON.stringify(encodeNumber(n))))
      expect(Object.is(back, n)).toBe(true)
    }
    expect(Number.isNaN(decodeNumber(JSON.parse(JSON.stringify(encodeNumber(Number.NaN)))))).toBe(true)
    expect(decodeNumber(encodeNumber(Number.POSITIVE_INFINITY))).toBe(Number.POSITIVE_INFINITY)
    expect(decodeNumber(encodeNumber(Number.NEGATIVE_INFINITY))).toBe(Number.NEGATIVE_INFINITY)
  })

  it('JSON seul perdrait −0 : c’est la raison de l’encodage', () => {
    expect(Object.is(JSON.parse(JSON.stringify(-0)), -0)).toBe(false)
  })

  it('garde le point visé, la direction, les drapeaux et le rite', () => {
    const cases: PlayerCommands[] = [
      IDLE_COMMANDS,
      {
        move: { x: -0, z: -Math.SQRT1_2 },
        aim: { x: 3.000000000000001, z: -0 },
        strike: true,
        dodge: false,
        sentence: true,
        rite: 'charge',
        swapWeapon: true,
      },
      { ...IDLE_COMMANDS, dodge: true, rite: 'balayage' },
    ]
    for (const c of cases) {
      const back = roundTrip(c)
      expect(back).toEqual(c)
      expect(Object.is(back.move.x, c.move.x)).toBe(true)
      expect(Object.is(back.aim.z, c.aim.z)).toBe(true)
    }
  })

  it('refuse une commande mal formée', () => {
    expect(() => decodeCommand([0, 0, 0, 0, 1])).toThrow()
    expect(() => decodeCommand([0, 0, 0, 0, 16, 0])).toThrow()
    expect(() => decodeCommand([0, 0, 0, 0, 0, 3])).toThrow()
    expect(() => decodeCommand(['x', 0, 0, 0, 0, 0])).toThrow()
  })
})
