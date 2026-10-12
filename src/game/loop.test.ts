import { describe, expect, it } from 'vitest'
import { advance, initialLoop, MAX_STEPS_PER_FRAME, STEP_MS } from './loop'

describe("boucle à pas fixe (point d'attention 5)", () => {
  it("fait un pas par 1/60 s écoulé et garde le reste pour l'interpolation", () => {
    let s = advance(initialLoop, 1000, false).state
    const r = advance(s, 1000 + STEP_MS * 2.5, false)
    expect(r.steps).toBe(2)
    expect(r.alpha).toBeCloseTo(0.5, 6)
    s = r.state
    expect(advance(s, 1000 + STEP_MS * 3, false).steps).toBe(1)
  })

  it(`plafonne à ${MAX_STEPS_PER_FRAME} pas après un gros saut de temps, sans dette`, () => {
    const s = advance(initialLoop, 0, false).state
    const r = advance(s, 10_000, false)
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME)
    expect(advance(r.state, 10_000 + STEP_MS, false).steps).toBe(1)
  })

  it("ne fait aucun pas quand l'onglet est caché, et ne rattrape pas au retour", () => {
    const s = advance(initialLoop, 0, false).state
    const hidden = advance(s, 5_000, true)
    expect(hidden.steps).toBe(0)
    expect(advance(hidden.state, 5_000 + STEP_MS, false).steps).toBe(1)
  })
})
