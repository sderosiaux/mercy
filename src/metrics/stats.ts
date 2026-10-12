// Statistiques de distribution. Quantile : interpolation linéaire entre rangs (type 7 de Hyndman et Fan,
// celui de R et de numpy par défaut) ; la médiane d'un nombre pair de valeurs est la moyenne des deux du milieu.

export interface Distribution {
  readonly n: number
  readonly min: number | null
  readonly p10: number | null
  readonly median: number | null
  readonly p90: number | null
  readonly max: number | null
}

export const quantile = (sorted: readonly number[], q: number): number | null => {
  const n = sorted.length
  if (n === 0) return null
  const h = (n - 1) * q
  const lo = Math.floor(h)
  const a = sorted[lo] as number
  const b = sorted[Math.min(n - 1, lo + 1)] as number
  return a + (h - lo) * (b - a)
}

export const distribution = (values: readonly number[]): Distribution => {
  const s = [...values].sort((a, b) => a - b)
  return {
    n: s.length,
    min: s[0] ?? null,
    p10: quantile(s, 0.1),
    median: quantile(s, 0.5),
    p90: quantile(s, 0.9),
    max: s[s.length - 1] ?? null,
  }
}

export const median = (values: readonly number[]): number | null =>
  quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  )

export const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den)
