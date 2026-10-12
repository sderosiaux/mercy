// Découpe de la planche en vues : la planche demande trois vues côte à côte sur fond gris uni, séparées par du
// vide. On estime le fond sur le cadre de l'image, on projette les pixels de premier plan sur les colonnes, et
// chaque bande continue de colonnes occupées est une vue. Mesure, pas d'avis : si on ne trouve pas exactement le
// nombre de vues attendu, l'étape échoue et la planche est à refaire.
import { crop, type Raster } from './png'

export interface Panel {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

// Écart maximal à la couleur du fond, par canal, pour qu'un pixel compte comme fond (sur 255). Un fond « uni »
// généré garde du bruit et un léger dégradé ; 28 les absorbe sans avaler un tissu gris foncé contre un gris moyen.
export const BG_TOLERANCE = 28
const MIN_COLUMN_FILL = 0.004 // part de la hauteur qu'une colonne doit couvrir pour compter comme occupée
const MIN_GAP = 0.012 // largeur minimale d'un vide entre deux vues, en part de la largeur
const MIN_PANEL = 0.04 // largeur minimale d'une vue, en part de la largeur
const MARGIN = 0.02 // marge gardée autour de chaque vue, en part de la largeur

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] as number
}

export const backgroundOf = (r: Raster): readonly number[] => {
  const samples: number[][] = [[], [], []]
  const take = (x: number, y: number): void => {
    const i = (y * r.width + x) * r.channels
    for (let c = 0; c < 3; c++) samples[c]?.push(r.data[i + c] as number)
  }
  const band = Math.max(1, Math.floor(Math.min(r.width, r.height) * 0.01))
  for (let x = 0; x < r.width; x++) for (let y = 0; y < band; y++) take(x, y)
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < band; x++) {
      take(x, y)
      take(r.width - 1 - x, y)
    }
  }
  return samples.map(median)
}

const isForeground = (r: Raster, bg: readonly number[], x: number, y: number): boolean => {
  const i = (y * r.width + x) * r.channels
  if (r.channels === 4 && (r.data[i + 3] as number) < 128) return false
  for (let c = 0; c < 3; c++)
    if (Math.abs((r.data[i + c] as number) - (bg[c] as number)) > BG_TOLERANCE) return true
  return false
}

export const findPanels = (r: Raster): Panel[] => {
  const bg = backgroundOf(r)
  const minFill = Math.max(2, Math.round(r.height * MIN_COLUMN_FILL))
  const occupied: boolean[] = []
  for (let x = 0; x < r.width; x++) {
    let n = 0
    for (let y = 0; y < r.height; y++) if (isForeground(r, bg, x, y)) n++
    occupied.push(n >= minFill)
  }
  const runs: [number, number][] = []
  let start = -1
  for (let x = 0; x <= r.width; x++) {
    const on = x < r.width && occupied[x]
    if (on && start < 0) start = x
    if (!on && start >= 0) {
      runs.push([start, x - 1])
      start = -1
    }
  }
  const merged: [number, number][] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && run[0] - last[1] - 1 < r.width * MIN_GAP) last[1] = run[1]
    else merged.push([run[0], run[1]])
  }
  const margin = Math.round(r.width * MARGIN)
  return merged
    .filter(([a, b]) => b - a + 1 >= r.width * MIN_PANEL)
    .map(([a, b]) => {
      let top = r.height
      let bottom = -1
      for (let y = 0; y < r.height; y++) {
        for (let x = a; x <= b; x++) {
          if (isForeground(r, bg, x, y)) {
            if (y < top) top = y
            bottom = y
            break
          }
        }
      }
      const x = Math.max(0, a - margin)
      const y = Math.max(0, top - margin)
      return {
        x,
        y,
        width: Math.min(r.width - 1, b + margin) - x + 1,
        height: Math.min(r.height - 1, bottom + margin) - y + 1,
      }
    })
}

export const splitViews = (r: Raster, expected: number): Raster[] => {
  const panels = findPanels(r)
  if (panels.length !== expected) {
    throw new Error(`planche : ${panels.length} vue(s) séparée(s) par du fond, ${expected} attendue(s)`)
  }
  return panels.map((p) => crop(r, p.x, p.y, p.width, p.height))
}
