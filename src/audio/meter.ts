// Mesure par quantum (B5 I3, I4) dans un AudioWorklet : énergie moyenne et crête de chaque prise, horodatées par
// le numéro de quantum du rendu (currentFrame / 128). Aucun tampon multicanal n'est gardé en mémoire : seules deux
// valeurs par prise et par quantum remontent au fil principal.
import type { Taps } from './graph'

export const METER_INPUTS = [
  ...Array.from({ length: 24 }, (_, i) => `slot${i}`),
  'autres',
  'creatures',
  'nappe',
  'ambiance-avant',
  'ambiance-apres',
  'master-g',
  'master-d',
] as const
export type MeterInput = (typeof METER_INPUTS)[number]

// Source du processeur : chaîne de JavaScript, chargée par URL de blob (fonctionne en dev, en build et hors Vite).
const PROCESSOR = `
class MercyMeter extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options.processorOptions
    this.n = o.inputs
    this.batch = o.batch
    this.endQ = o.endQuantum
    this.qs = new Int32Array(this.batch)
    this.buf = new Float32Array(this.batch * this.n * 2)
    this.count = 0
    this.port.onmessage = () => this.flush()
  }
  process(inputs) {
    const q = Math.floor(currentFrame / 128)
    const base = this.count * this.n * 2
    for (let i = 0; i < this.n; i++) {
      const inp = inputs[i]
      const nch = inp ? inp.length : 0
      let s = 0
      let pk = 0
      let len = 128
      for (let c = 0; c < nch; c++) {
        const ch = inp[c]
        len = ch.length
        for (let k = 0; k < ch.length; k++) {
          const v = ch[k]
          s += v * v
          const a = v < 0 ? -v : v
          if (a > pk) pk = a
        }
      }
      this.buf[base + 2 * i] = nch ? s / (len * nch) : 0
      this.buf[base + 2 * i + 1] = pk
    }
    this.qs[this.count] = q
    this.count++
    if (this.count === this.batch || (this.endQ > 0 && q >= this.endQ - 1)) this.flush()
    return true
  }
  flush() {
    if (!this.count) return
    this.port.postMessage({ qs: this.qs.slice(0, this.count), data: this.buf.slice(0, this.count * this.n * 2) })
    this.count = 0
  }
}
registerProcessor('mercy-meter', MercyMeter)
`

const loaded = new WeakSet<BaseAudioContext>()
export const loadMeterModule = async (ctx: BaseAudioContext): Promise<void> => {
  if (loaded.has(ctx)) return
  const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  loaded.add(ctx)
}

// Tables par prise : énergie moyenne (carré moyen, linéaire) et crête, indexées par quantum depuis `firstQ`.
export interface MeterTables {
  readonly inputs: readonly MeterInput[]
  readonly firstQ: number
  readonly count: number
  readonly ms: readonly Float32Array[]
  readonly peak: readonly Float32Array[]
}

export const levelDb = (t: MeterTables, input: MeterInput, q: number): number => {
  const i = t.inputs.indexOf(input)
  const v = t.ms[i]?.[q - t.firstQ] ?? 0
  return v > 0 ? 10 * Math.log10(v) : Number.NEGATIVE_INFINITY
}

export interface Meter {
  readonly node: AudioWorkletNode
  tables(): MeterTables
  received(): number
  flush(): void
}

// `quanta` : nombre de quanta attendus (hors ligne : longueur du rendu / 128) ; 0 en direct (tables extensibles).
export const attachMeter = (ctx: BaseAudioContext, taps: Taps, quanta: number, batch = 64): Meter => {
  const n = METER_INPUTS.length
  const node = new AudioWorkletNode(ctx, 'mercy-meter', {
    numberOfInputs: n,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { inputs: n, batch, endQuantum: quanta },
  })
  taps.slots.forEach((g, i) => {
    g.connect(node, 0, i)
  })
  taps.others.connect(node, 0, 24)
  taps.creatures.connect(node, 0, 25)
  taps.nappe.connect(node, 0, 26)
  taps.ambPre.connect(node, 0, 27)
  taps.ambPost.connect(node, 0, 28)
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 })
  taps.master.connect(split)
  split.connect(node, 0, 29)
  split.connect(node, 1, 30)
  node.connect(ctx.destination) // sortie muette : garde le processeur tiré par le rendu

  let cap = quanta > 0 ? quanta : 1 << 14
  let ms = Array.from({ length: n }, () => new Float32Array(cap))
  let peak = Array.from({ length: n }, () => new Float32Array(cap))
  let firstQ = -1
  let maxQ = -1
  let got = 0
  const grow = (need: number) => {
    if (need <= cap) return
    while (cap < need) cap *= 2
    ms = ms.map((a) => {
      const b = new Float32Array(cap)
      b.set(a)
      return b
    })
    peak = peak.map((a) => {
      const b = new Float32Array(cap)
      b.set(a)
      return b
    })
  }
  node.port.onmessage = (ev: MessageEvent<{ qs: Int32Array; data: Float32Array }>) => {
    const { qs, data } = ev.data
    for (let k = 0; k < qs.length; k++) {
      const q = qs[k] as number
      if (firstQ < 0) firstQ = q
      const idx = q - firstQ
      grow(idx + 1)
      for (let i = 0; i < n; i++) {
        ;(ms[i] as Float32Array)[idx] = data[(k * n + i) * 2] as number
        ;(peak[i] as Float32Array)[idx] = data[(k * n + i) * 2 + 1] as number
      }
      maxQ = Math.max(maxQ, q)
      got++
    }
  }
  return {
    node,
    tables: () => {
      const count = firstQ < 0 ? 0 : maxQ - firstQ + 1
      return {
        inputs: METER_INPUTS,
        firstQ: Math.max(0, firstQ),
        count,
        ms: ms.map((a) => a.subarray(0, count)),
        peak: peak.map((a) => a.subarray(0, count)),
      }
    },
    received: () => got,
    flush: () => node.port.postMessage('flush'),
  }
}
