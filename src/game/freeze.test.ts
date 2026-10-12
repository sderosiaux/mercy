import { describe, expect, it } from 'vitest'
import { frameView, NO_FREEZE } from './freeze'

// Drapeau 2 de B5 : le son coupe au pas qui porte le coup (main.ts, audio.update après chaque step). L'image figée
// doit être celle du coup, pas celle d'avant.
describe("gel d'image au coup du joueur (§8.1)", () => {
  it('sans coup : le monde courant est rendu', () => {
    expect(frameView(NO_FREEZE, 1000, [null, null]).view).toEqual({ kind: 'live' })
  })

  it("l'image où le coup porte rend le pas du coup, puis l'image tient pendant le gel", () => {
    const a = frameView(NO_FREEZE, 1000, [null, 50])
    expect(a.view).toEqual({ kind: 'hit', step: 1 })
    expect(frameView(a.state, 1016, [null]).view).toEqual({ kind: 'hold' })
    expect(frameView(a.state, 1049.9, [null]).view).toEqual({ kind: 'hold' })
    expect(frameView(a.state, 1050, [null]).view).toEqual({ kind: 'live' })
  })

  it("coup au premier de deux pas : l'image est celle du coup, pas celle du pas suivant", () => {
    expect(frameView(NO_FREEZE, 1000, [90, null]).view).toEqual({ kind: 'hit', step: 0 })
  })

  it('deux coups dans la même image : le dernier est rendu et fixe la durée du gel', () => {
    const a = frameView(NO_FREEZE, 1000, [90, 50])
    expect(a.view).toEqual({ kind: 'hit', step: 1 })
    expect(frameView(a.state, 1049, []).view).toEqual({ kind: 'hold' })
    expect(frameView(a.state, 1050, []).view).toEqual({ kind: 'live' })
  })

  it('un nouveau coup pendant le gel est rendu à son tour, et le gel repart de cette image', () => {
    const a = frameView(NO_FREEZE, 1000, [90])
    const b = frameView(a.state, 1033, [null, 50])
    expect(b.view).toEqual({ kind: 'hit', step: 1 })
    expect(frameView(b.state, 1082, []).view).toEqual({ kind: 'hold' })
    expect(frameView(b.state, 1083, []).view).toEqual({ kind: 'live' })
  })

  it('en pause (aucun pas) : le gel en cours tient, puis le monde est rendu', () => {
    const a = frameView(NO_FREEZE, 1000, [50])
    expect(frameView(a.state, 1020, []).view).toEqual({ kind: 'hold' })
    expect(frameView(a.state, 1060, []).view).toEqual({ kind: 'live' })
  })
})
