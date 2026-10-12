// Temps de frame (§29 : 60 i/s, échec sous 30) : intervalle entre deux images affichées, en ms, tel que l'hôte le
// mesure. Quantiles du même code que les métriques (src/metrics/stats.ts, type 7).
import { quantile } from '../metrics/index'

export interface FrameStats {
  readonly n: number
  readonly p50: number | null
  readonly p95: number | null
  readonly max: number | null
}

export const frameStats = (samples: readonly number[]): FrameStats => {
  const s = samples.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  return {
    n: s.length,
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    max: s.length === 0 ? null : (s[s.length - 1] as number),
  }
}

// Échantillons accumulés depuis la dernière remise à zéro (début de partie ou appel explicite).
export interface FrameRecorder {
  push(ms: number): void
  stats(): FrameStats
  reset(): void
}

export const createFrameRecorder = (): FrameRecorder => {
  let samples: number[] = []
  return {
    push: (ms) => {
      samples.push(ms)
    },
    stats: () => frameStats(samples),
    reset: () => {
      samples = []
    },
  }
}
