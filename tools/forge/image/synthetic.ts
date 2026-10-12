// Planche synthétique pour les tests : fond gris légèrement bruité, silhouettes sombres séparées par du vide, avec
// des « bras » d'un pixel détachés du corps (ils doivent rester dans la vue de leur silhouette).
import type { Raster } from './png'

export const syntheticSheet = (
  w = 300,
  h = 160,
  figures: readonly (readonly [number, number])[] = [
    [30, 70],
    [130, 170],
    [230, 270],
  ],
): Raster => {
  const data = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const noise = (x * 7 + y * 13) % 9 // bruit déterministe, sous la tolérance du fond
      const inFigure = figures.some(([a, b]) => x >= a && x <= b && y >= 20 && y <= 140)
      const arm = figures.some(([a, b]) => (x === a - 6 || x === b + 6) && y >= 40 && y <= 90)
      const v = inFigure || arm ? 40 : 128 + noise - 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = inFigure || arm ? 30 : v
    }
  }
  return { width: w, height: h, channels: 3, data }
}
