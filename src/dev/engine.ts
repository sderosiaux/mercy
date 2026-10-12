// Empreinte du moteur JS : la simulation n'est déterministe qu'au sein d'un même moteur (plan, « Contraintes
// globales » : trigonométrie autorisée). Math.sin, cos, atan2 et hypot (src/sim/vec.ts) ne sont pas correctement
// arrondis par la norme et diffèrent d'un ulp entre versions de V8. Une télémétrie du navigateur ne se rejoue donc
// à l'identique dans Node que si les deux moteurs donnent les mêmes valeurs sur les calculs que la partie a faits.
// Cet instrument compare les deux moteurs : mêmes parties de bot dans le navigateur (window.__mercy.engine) et dans
// Node (src/dev/engine-cli.ts), hash du monde initial et du monde final.
import { makePolicy } from '../bots/harness'
import { hashWorld, step, type Variant } from '../sim/index'
import { initialWorld } from './telemetry'

export interface EngineRow {
  readonly wave: string
  readonly seed: number
  readonly variant: Variant
  readonly hash0: string
  readonly hashFin: string
  readonly tickFin: number
}

export interface FingerprintRequest {
  readonly waves: readonly string[]
  readonly seeds: readonly number[]
  readonly variants: readonly Variant[]
  readonly policy: string
  readonly maxTicks: number
}

export const engineFingerprint = (o: FingerprintRequest): EngineRow[] => {
  const rows: EngineRow[] = []
  for (const wave of o.waves)
    for (const variant of o.variants)
      for (const seed of o.seeds) {
        const w0 = initialWorld({ vague: wave, graine: seed, variante: variant })
        const policy = makePolicy(o.policy)
        let memory = policy.init(w0)
        let w = w0
        while (w.wave.endedAt === null && w.tick < o.maxTicks) {
          const [cmd, next] = policy.decide(w, memory)
          memory = next
          w = step(w, cmd)
        }
        rows.push({ wave, seed, variant, hash0: hashWorld(w0), hashFin: hashWorld(w), tickFin: w.tick })
      }
  return rows
}

// Valeurs brutes des fonctions non correctement arrondies, sur des entrées fixes, en hexadécimal IEEE 754.
const hex = (x: number): string => {
  const b = new DataView(new ArrayBuffer(8))
  b.setFloat64(0, x)
  return Array.from({ length: 8 }, (_, i) => b.getUint8(i).toString(16).padStart(2, '0')).join('')
}

export const mathProbe = (): Record<string, string[]> => {
  const xs = Array.from({ length: 64 }, (_, i) => -Math.PI + (i * 2 * Math.PI) / 63 + i * 1e-3)
  return {
    cos: xs.map((x) => hex(Math.cos(x))),
    sin: xs.map((x) => hex(Math.sin(x))),
    atan2: xs.map((x, i) => hex(Math.atan2(x, 1 + ((i * 7) % 5) - 2.5))),
    hypot: xs.map((x, i) => hex(Math.hypot(x, i / 7))),
  }
}

export interface EngineComparison {
  readonly parties: number
  readonly monde0Differents: number
  readonly finDifferente: number
  readonly ecarts: readonly { readonly wave: string; readonly seed: number; readonly variant: Variant }[]
  readonly math: Readonly<Record<string, number>> // nombre d'entrées dont la valeur diffère, par fonction
}

export const compareEngines = (
  a: { readonly rows: readonly EngineRow[]; readonly math: Record<string, string[]> },
  b: { readonly rows: readonly EngineRow[]; readonly math: Record<string, string[]> },
): EngineComparison => {
  const key = (r: EngineRow) => `${r.wave}|${r.seed}|${r.variant}`
  const other = new Map(b.rows.map((r) => [key(r), r]))
  let monde0Differents = 0
  let finDifferente = 0
  const ecarts: { wave: string; seed: number; variant: Variant }[] = []
  for (const r of a.rows) {
    const o = other.get(key(r))
    if (!o) continue
    if (o.hash0 !== r.hash0) monde0Differents++
    if (o.hashFin !== r.hashFin || o.tickFin !== r.tickFin) {
      finDifferente++
      ecarts.push({ wave: r.wave, seed: r.seed, variant: r.variant })
    }
  }
  const math: Record<string, number> = {}
  for (const [fn, values] of Object.entries(a.math)) {
    const ov = b.math[fn] ?? []
    math[fn] = values.filter((v, i) => v !== ov[i]).length
  }
  return { parties: a.rows.length, monde0Differents, finDifferente, ecarts, math }
}
