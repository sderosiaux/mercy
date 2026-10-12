// PRNG sfc32. L'état vit dans le monde ; chaque tirage renvoie un nouvel état.
import type { RngState } from './types'

export const seedRng = (seed: number): RngState => {
  // splitmix32 pour répartir la graine sur les 4 mots, puis 12 tours de chauffe.
  let s = seed >>> 0
  const mix = () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  let state: RngState = [mix(), mix(), mix(), mix()]
  for (let i = 0; i < 12; i++) state = nextFloat(state)[1]
  return state
}

export const nextUint32 = (state: RngState): readonly [number, RngState] => {
  let [a, b, c, d] = state
  const t = (((a + b) >>> 0) + d) >>> 0
  d = (d + 1) >>> 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) >>> 0
  c = ((c << 21) | (c >>> 11)) >>> 0
  c = (c + t) >>> 0
  return [t >>> 0, [a >>> 0, b, c, d]]
}

export const nextFloat = (state: RngState): readonly [number, RngState] => {
  const [u, next] = nextUint32(state)
  return [u / 4294967296, next]
}
