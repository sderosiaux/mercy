// Mesureur du banc (I3, I4) : le processeur AudioWorklet numérote chaque quantum une fois et une seule. Constaté au
// banc (passe D-fix2, 1 rendu sur 355) : un quantum reçu deux fois et le suivant jamais, lu comme un silence sur
// toutes les prises. Ici le processeur tourne dans Node, avec un currentFrame décalé d'un échantillon.
import { describe, expect, it } from 'vitest'
import { METER_PROCESSOR } from './meter'

interface Posted {
  readonly qs: Int32Array
  readonly data: Float32Array
  readonly jitter?: number
}

const load = () => {
  const posted: Posted[] = []
  let Proc: (new (o: unknown) => { process(inputs: Float32Array[][]): boolean }) | null = null
  const scope = {
    frame: 0,
    AudioWorkletProcessor: class {
      port = { postMessage: (m: Posted) => posted.push(m), onmessage: null as unknown }
    },
    registerProcessor: (_name: string, c: typeof Proc) => {
      Proc = c
    },
  }
  // Le code du processeur lit la globale `currentFrame` de l'AudioWorkletGlobalScope.
  Object.defineProperty(scope, 'currentFrame', { get: () => scope.frame })
  new Function('scope', `with (scope) {\n${METER_PROCESSOR}\n}`)(scope)
  if (!Proc) throw new Error('processeur non enregistré')
  const P = Proc as new (o: unknown) => { process(inputs: Float32Array[][]): boolean }
  return { scope, posted, proc: new P({ processorOptions: { inputs: 1, batch: 4, endQuantum: 10 } }) }
}

describe('mesureur : un numéro par quantum rendu', () => {
  it('un currentFrame lu un échantillon trop tôt ne donne ni doublon ni quantum manquant', () => {
    const { scope, posted, proc } = load()
    for (let k = 0; k < 10; k++) {
      scope.frame = k === 5 ? k * 128 - 1 : k * 128
      proc.process([[new Float32Array(128).fill(0.5)]])
    }
    const qs = posted.flatMap((p) => [...p.qs])
    expect(qs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    // l'écart est signalé au fil principal
    expect(posted.reduce((s, p) => s + (p.jitter ?? 0), 0)).toBe(1)
  })

  it('en direct, la numérotation part du quantum où le processeur démarre', () => {
    const { scope, posted, proc } = load()
    for (let k = 0; k < 10; k++) {
      scope.frame = (1000 + k) * 128
      proc.process([[new Float32Array(128)]])
    }
    expect(posted.flatMap((p) => [...p.qs])).toEqual([
      1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009,
    ])
  })
})
