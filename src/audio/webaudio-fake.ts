// Web Audio de test, pour les tests du graphe sans navigateur. Ce n'est pas un moteur audio : il ne produit aucun
// échantillon. Il reproduit seulement ce que le graphe doit respecter et que Node n'a pas :
// - les règles d'automatisation d'AudioParam de la spécification Web Audio, exceptions comprises
//   (setValueCurveAtTime : NotSupportedError si un évènement tombe strictement dans ]T ; T + D[, ou si un appel
//   d'automatisation tombe dans [T ; T + D[ d'une courbe existante ; cancelScheduledValues retire aussi la courbe
//   active à l'instant d'annulation) ;
// - la valeur d'un paramètre à un instant (paliers, rampes linéaires et exponentielles, courbes interpolées avec
//   k = ⌊(N − 1)(t − T₀)/T_D⌋) ;
// - le cycle de vie des sources (start, stop, plusieurs stop : seul le dernier compte).
// installFakeWebAudio() pose les constructeurs globaux (GainNode, AudioBufferSourceNode, PannerNode…) que graph.ts
// appelle, et rend un contexte dont l'horloge est réglée par le test.

type Ev =
  | { readonly type: 'set'; readonly time: number; readonly value: number }
  | { readonly type: 'linear'; readonly time: number; readonly value: number }
  | { readonly type: 'exp'; readonly time: number; readonly value: number }
  | {
      readonly type: 'curve'
      readonly time: number
      readonly duration: number
      readonly values: Float32Array
    }

const notSupported = (msg: string): Error => {
  const e = new Error(msg)
  e.name = 'NotSupportedError'
  return e
}

export class FakeParam {
  readonly events: Ev[] = []
  readonly calls: string[] = []
  constructor(readonly defaultValue: number) {}

  get value(): number {
    return this.defaultValue
  }
  set value(_v: number) {
    // Le graphe ne pose jamais .value directement ; un test qui le ferait doit le voir.
    throw new Error('FakeParam : affectation directe de .value non modélisée')
  }

  // Règle de la spécification : aucun appel d'automatisation dans [T ; T + D[ d'une courbe existante.
  private checkNotInCurve(time: number, method: string): void {
    for (const e of this.events)
      if (e.type === 'curve' && time >= e.time && time < e.time + e.duration)
        throw notSupported(`${method}(${time}) chevauche setValueCurveAtTime(${e.time}, ${e.duration})`)
  }

  private insert(e: Ev): void {
    // Ordre par instant, puis ordre d'insertion à instant égal.
    let i = this.events.length
    while (i > 0 && (this.events[i - 1] as Ev).time > e.time) i--
    this.events.splice(i, 0, e)
  }

  setValueAtTime(value: number, time: number): this {
    this.calls.push(`set ${value} @${time}`)
    this.checkNotInCurve(time, 'setValueAtTime')
    this.insert({ type: 'set', time, value })
    return this
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push(`linear ${value} @${time}`)
    this.checkNotInCurve(time, 'linearRampToValueAtTime')
    this.insert({ type: 'linear', time, value })
    return this
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.calls.push(`exp ${value} @${time}`)
    if (value === 0) throw new RangeError('exponentialRampToValueAtTime : valeur nulle')
    this.checkNotInCurve(time, 'exponentialRampToValueAtTime')
    this.insert({ type: 'exp', time, value })
    return this
  }

  setValueCurveAtTime(values: ArrayLike<number>, time: number, duration: number): this {
    this.calls.push(`curve ${values.length} @${time} +${duration}`)
    if (values.length < 2) throw new Error('InvalidStateError : courbe de moins de 2 valeurs')
    for (const e of this.events)
      if (e.time > time && e.time < time + duration)
        throw notSupported(`setValueCurveAtTime(${time}, ${duration}) chevauche un évènement à ${e.time}`)
    this.checkNotInCurve(time, 'setValueCurveAtTime')
    this.insert({ type: 'curve', time, duration, values: Float32Array.from(values) })
    return this
  }

  cancelScheduledValues(time: number): this {
    this.calls.push(`cancel @${time}`)
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i] as Ev
      const activeCurve = e.type === 'curve' && e.time < time && time < e.time + e.duration
      if (e.time >= time || activeCurve) this.events.splice(i, 1)
    }
    return this
  }

  // Valeur à l'instant t d'après la liste d'évènements courante.
  valueAt(t: number): number {
    let pt = Number.NEGATIVE_INFINITY
    let pv = this.defaultValue
    for (const e of this.events) {
      if (e.type === 'set') {
        if (e.time > t) break
        pt = e.time
        pv = e.value
      } else if (e.type === 'linear' || e.type === 'exp') {
        if (e.time <= t) {
          pt = e.time
          pv = e.value
          continue
        }
        if (!Number.isFinite(pt)) return pv
        const u = (t - pt) / (e.time - pt)
        if (e.type === 'linear') return pv + (e.value - pv) * u
        if (pv === 0 || pv * e.value < 0) return pv
        return pv * (e.value / pv) ** u
      } else {
        if (e.time > t) break
        if (t >= e.time + e.duration) {
          pt = e.time + e.duration
          pv = e.values[e.values.length - 1] as number
          continue
        }
        const n = e.values.length
        const v = ((n - 1) * (t - e.time)) / e.duration
        const k = Math.floor(v)
        const f = v - k
        const a = e.values[k] as number
        const b = e.values[Math.min(n - 1, k + 1)] as number
        return (1 - f) * a + f * b
      }
    }
    return pv
  }
}

export interface FakeContext {
  currentTime: number
  readonly sampleRate: number
  readonly destination: FakeNode
  readonly listener: {
    readonly positionX: FakeParam
    readonly positionY: FakeParam
    readonly positionZ: FakeParam
  }
  readonly nodes: FakeNode[]
  // Pour la mesure en direct (live.ts) : contexte « en marche », décodage compté, module de mesure accepté.
  readonly state: 'running'
  readonly baseLatency: number
  readonly outputLatency: number
  decodes: number
  resume(): Promise<void>
  decodeAudioData(bytes: ArrayBuffer): Promise<FakeBuffer>
  readonly audioWorklet: { addModule(url: string): Promise<void> }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode>()
  disconnected = false
  constructor(readonly ctx: FakeContext) {
    ctx.nodes.push(this)
  }
  connect(dest: FakeNode): FakeNode {
    this.outputs.add(dest)
    return dest
  }
  disconnect(): void {
    this.outputs.clear()
    this.disconnected = true
  }
}

export class FakeGainNode extends FakeNode {
  readonly gain: FakeParam
  constructor(ctx: FakeContext, o: { gain?: number } = {}) {
    super(ctx)
    this.gain = new FakeParam(o.gain ?? 1)
  }
}

export interface FakeBuffer {
  readonly duration: number
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
}

export class FakeSourceNode extends FakeNode {
  readonly buffer: FakeBuffer | null
  readonly loop: boolean
  readonly playbackRate: FakeParam
  startAt: number | null = null
  offset = 0
  stopAt: number | null = null
  stopCalls = 0
  constructor(ctx: FakeContext, o: { buffer?: FakeBuffer; loop?: boolean; playbackRate?: number } = {}) {
    super(ctx)
    this.buffer = o.buffer ?? null
    this.loop = o.loop ?? false
    this.playbackRate = new FakeParam(o.playbackRate ?? 1)
  }
  start(when = 0, offset = 0): void {
    if (this.startAt !== null) throw new Error('InvalidStateError : start() appelé deux fois')
    this.startAt = when
    this.offset = offset
  }
  stop(when = 0): void {
    if (this.startAt === null) throw new Error('InvalidStateError : stop() avant start()')
    this.stopAt = when // spécification : seul le dernier appel compte
    this.stopCalls++
  }
  // La source sonne-t-elle encore (démarrée, pas arrêtée, pas arrivée en fin de tampon) à l'instant t ?
  playingAt(t: number): boolean {
    if (this.startAt === null || t < this.startAt) return false
    if (this.stopAt !== null && t >= this.stopAt) return false
    if (!this.loop && this.buffer) return t < this.startAt + this.buffer.duration - this.offset
    return true
  }
}

export class FakePannerNode extends FakeNode {
  readonly positionX: FakeParam
  readonly positionY: FakeParam
  readonly positionZ: FakeParam
  constructor(ctx: FakeContext, o: { positionX?: number; positionY?: number; positionZ?: number } = {}) {
    super(ctx)
    this.positionX = new FakeParam(o.positionX ?? 0)
    this.positionY = new FakeParam(o.positionY ?? 0)
    this.positionZ = new FakeParam(o.positionZ ?? 0)
  }
}

// Mesureur (meter.ts) : un AudioWorkletNode dont le port ne reçoit jamais de mesures (aucun rendu ici).
export class FakeWorkletNode extends FakeNode {
  readonly port = {
    onmessage: null as unknown,
    closed: false,
    postMessage: (_m: unknown): void => {},
    close(): void {
      this.closed = true
    },
  }
}

export class FakeSplitterNode extends FakeNode {
  override connect(dest: FakeNode, _output?: number, _input?: number): FakeNode {
    return super.connect(dest)
  }
}

// Tampon factice décodé depuis des octets : 4 octets par trame (voir fakeFileBytes).
export const fakeFileBytes = (frames: number): ArrayBuffer => new ArrayBuffer(4 * frames)

export const fakeBuffer = (frames: number, sampleRate: number): FakeBuffer => ({
  duration: frames / sampleRate,
  length: frames,
  sampleRate,
  numberOfChannels: 1,
})

// Pose les constructeurs globaux et rend un contexte factice. `restore` remet les globaux d'avant.
export const installFakeWebAudio = (): { ctx: FakeContext; restore: () => void } => {
  const g = globalThis as Record<string, unknown>
  const saved = [
    'GainNode',
    'AudioBufferSourceNode',
    'PannerNode',
    'AudioWorkletNode',
    'ChannelSplitterNode',
  ].map((k) => [k, g[k]] as const)
  g.GainNode = FakeGainNode
  g.AudioBufferSourceNode = FakeSourceNode
  g.PannerNode = FakePannerNode
  g.AudioWorkletNode = FakeWorkletNode
  g.ChannelSplitterNode = FakeSplitterNode
  const ctx = {
    currentTime: 0,
    sampleRate: 48_000,
    nodes: [] as FakeNode[],
    state: 'running',
    baseLatency: 0,
    outputLatency: 0,
    decodes: 0,
    resume: async () => {},
    decodeAudioData: async (bytes: ArrayBuffer) => {
      ctx.decodes++
      return fakeBuffer(bytes.byteLength / 4, 48_000)
    },
    audioWorklet: { addModule: async () => {} },
  } as unknown as FakeContext & { destination: FakeNode; listener: FakeContext['listener'] }
  ;(ctx as { destination: FakeNode }).destination = new FakeNode(ctx)
  ;(ctx as { listener: FakeContext['listener'] }).listener = {
    positionX: new FakeParam(0),
    positionY: new FakeParam(0),
    positionZ: new FakeParam(0),
  }
  return {
    ctx,
    restore: () => {
      for (const [k, v] of saved) g[k] = v
    },
  }
}
