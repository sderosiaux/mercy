// Visionneuse du test des 3 s (B2 §11, §12 I7) : logique pure. Ordre des captures, place des marqueurs,
// enregistrement et décompte des réponses. Aucun LLM, aucun tirage hors sfc32.
import { nextFloat, seedRng } from '../sim/rng'

export type Truth = 'Abattu' | 'Mort' | 'Résistant'
export type Answer = Truth | 'Je ne sais pas'
export const ANSWERS: readonly Answer[] = ['Abattu', 'Mort', 'Résistant', 'Je ne sais pas']

export interface Probe {
  readonly n: 1 | 2 | 3 | 4
  readonly x: number // barycentre des pixels visibles du corps, pixels de l'image
  readonly y: number
  readonly truth: Truth
  readonly entity?: number
}

export interface Capture {
  readonly id: string
  readonly image: string // URL ou nom de fichier
  readonly width: number
  readonly height: number
  readonly probes: readonly Probe[]
}

export interface Session {
  readonly id: string
  readonly training: readonly Capture[]
  readonly captures: readonly Capture[]
}

export interface Record_ {
  readonly capture: string
  readonly training: boolean
  readonly probe: number
  readonly entity: number | null
  readonly truth: Truth
  readonly answer: Answer
  readonly shownMs: number
  readonly shownFrames: number
}

export const ORDER_SEED = 2929 // B2 §11 : mélange par sfc32, graine 2929
export const FIXATION_MS = 1000
export const EXPOSURE_MS = 3000
export const MARKER = { diameter: 20, stroke: 2, digit: 12, offset: 28 } as const

// Mélange de Fisher-Yates par sfc32 ; un observateur sur deux (numéro impair) voit l'ordre à l'envers.
export const captureOrder = (count: number, observer: number): number[] => {
  const order = Array.from({ length: count }, (_, i) => i)
  let rng = seedRng(ORDER_SEED)
  for (let i = count - 1; i > 0; i--) {
    const [u, next] = nextFloat(rng)
    rng = next
    const j = Math.floor(u * (i + 1))
    const a = order[i] as number
    order[i] = order[j] as number
    order[j] = a
  }
  return observer % 2 === 1 ? order.reverse() : order
}

// Marqueur centré 28 px au-dessus du barycentre, ou 28 px en dessous s'il sortirait de l'image.
export const markerCenter = (p: Probe, width: number, height: number): { x: number; y: number } => {
  const r = MARKER.diameter / 2 + MARKER.stroke / 2
  const above = p.y - MARKER.offset
  const y = above - r >= 0 ? above : p.y + MARKER.offset
  return { x: Math.min(width - r, Math.max(r, p.x)), y: Math.min(height - r, y) }
}

export interface Candidate {
  readonly entity: number
  readonly truth: Truth
  readonly x: number
  readonly y: number
  readonly visible: number // pixels visibles au viewport de la capture
}

export const PROBE_SEED_BASE = 29000 // B2 §11 : graine 29 000 + numéro de capture
export const MIN_VISIBLE = 150

// Tirage des 4 sondes (B2 §11). S1 et S2 : 2 Résistants et 2 autres corps ; S3 : 2 vivants (Abattu, ou Résistant à
// sa place) et 2 morts. Une classe trop petite est complétée par l'autre. Les numéros suivent l'ordre du tirage,
// qui mêle les classes : le numéro ne trahit pas la classe.
export const drawProbes = (
  candidates: readonly Candidate[],
  captureNumber: number,
  kind: 'S1S2' | 'S3',
  eligible: (c: Candidate) => boolean = () => true,
): Probe[] => {
  const pool = candidates
    .filter((c) => c.visible >= MIN_VISIBLE && eligible(c))
    .sort((a, b) => a.entity - b.entity)
  const classOf = (c: Candidate): 'A' | 'B' =>
    kind === 'S1S2' ? (c.truth === 'Résistant' ? 'A' : 'B') : c.truth === 'Mort' ? 'B' : 'A'
  const nA = pool.filter((c) => classOf(c) === 'A').length
  const nB = pool.length - nA
  let qA = Math.min(2, nA)
  const qB = Math.min(4 - qA, nB)
  qA = Math.min(4 - qB, nA)
  const left = { A: qA, B: qB }
  let rng = seedRng(PROBE_SEED_BASE + captureNumber)
  const out: Probe[] = []
  const rest = [...pool]
  while (out.length < qA + qB && rest.length > 0) {
    const [u, next] = nextFloat(rng)
    rng = next
    const [c] = rest.splice(Math.floor(u * rest.length), 1)
    if (!c) break
    const k = classOf(c)
    if (left[k] <= 0) continue
    left[k]--
    out.push({ n: (out.length + 1) as Probe['n'], x: c.x, y: c.y, truth: c.truth, entity: c.entity })
  }
  return out
}

export interface Tally {
  readonly sondes: number
  readonly confusionVivantMort: number // part des sondes ; « Je ne sais pas » n'en est pas une
  readonly jeNeSaisPas: number
  readonly resistantsReconnus: number
  readonly exactitude: number
  readonly matrice: Readonly<Record<Truth, Readonly<Record<Answer, number>>>>
}

const alive = (x: Answer): boolean => x === 'Abattu' || x === 'Résistant'

// Décompte de B2 §11 sur les sondes hors entraînement.
export const tally = (records: readonly Record_[]): Tally => {
  const rs = records.filter((r) => !r.training)
  const zero = (): Record<Answer, number> => ({ Abattu: 0, Mort: 0, Résistant: 0, 'Je ne sais pas': 0 })
  const matrice: Record<Truth, Record<Answer, number>> = { Abattu: zero(), Mort: zero(), Résistant: zero() }
  for (const r of rs) matrice[r.truth][r.answer]++
  const n = rs.length || 1
  const confusions = rs.filter(
    (r) => (alive(r.truth) && r.answer === 'Mort') || (r.truth === 'Mort' && alive(r.answer)),
  ).length
  const res = rs.filter((r) => r.truth === 'Résistant')
  return {
    sondes: rs.length,
    confusionVivantMort: confusions / n,
    jeNeSaisPas: rs.filter((r) => r.answer === 'Je ne sais pas').length / n,
    resistantsReconnus: res.length
      ? res.filter((r) => r.answer === 'Résistant').length / res.length
      : Number.NaN,
    exactitude: rs.filter((r) => r.answer === r.truth).length / n,
    matrice,
  }
}

export const CONSIGNE =
  'Tu vas voir 12 images de combat, 3 secondes chacune. Sur chaque image, 4 corps à terre portent un numéro. ' +
  "Après l'image, dis pour chaque numéro s'il s'agit d'un Abattu (à terre et vivant), d'un mort, ou d'un " +
  'Résistant (à terre et vivant, seule la Sentence le tue). Si tu ne sais pas, dis-le.'
