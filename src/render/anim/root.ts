// Racine des clips neutralisée à la lecture (requête F2-1) : la position d'un corps est celle de la simulation, pas
// celle du clip. Une transition de la Forge déplace parfois le bassin (chute 0,99 m, relèvement 1,45 m avec un
// demi-tour, morsure 12 cm) : sans correction, le corps sauterait à la fin du clip, quand le clip suivant ramène le
// bassin à sa place.
//
// Deux corrections, appliquées une fois aux pistes du bassin au chargement :
// - translation horizontale : le bassin reste à sa position de repos (x, z du squelette lié) pendant tout clip ;
//   la hauteur garde le mouvement du clip (le corps tombe, se relève) ;
// - cap (rotation autour de la verticale) : aux bouts « debout » d'un clip, le cap du bassin est ramené au cap de
//   repos, donc au cap de la simulation ; aux bouts « à terre », il est laissé tel que le clip le donne. Entre les
//   deux bouts, la correction varie linéairement : un clip qui pivote sur lui-même (le relèvement en demi-tour)
//   tourne en continu au lieu de sauter à la fin.
// Les clips qui se jouent à terre (abattu.*, prière à terre) ne sont pas corrigés en cap.

export type RootClass = 'debout' | 'tombe' | 'releve' | 'aTerre'

export const rootClassOf = (name: string): RootClass => {
  if (name.startsWith('abattu.') || name === 'canalisation.priere-abattu') return 'aTerre'
  if (name === 'chute' || name === 'mort.debout') return 'tombe'
  if (name === 'relevement') return 'releve'
  return 'debout'
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

// Cap d'un quaternion (x, y, z, w) : angle de la torsion autour de l'axe vertical (décomposition torsion-balancement).
// Seules les composantes y et w comptent : q = Ry(ψ) · balancement donne y / w = tan(ψ / 2).
export const headingOf = (y: number, w: number): number => 2 * Math.atan2(y, w)

// Rotation de cap `a` (autour de +Y) appliquée à gauche du quaternion q : q' = Ry(a) · q.
const preYaw = (
  a: number,
  q: readonly [number, number, number, number],
): [number, number, number, number] => {
  const s = Math.sin(a / 2)
  const c = Math.cos(a / 2)
  const [x, y, z, w] = q
  // (0, s, 0, c) ⊗ (x, y, z, w)
  return [c * x + s * z, c * y + s * w, c * z - s * x, c * w - s * y]
}

export interface RootFix {
  readonly positions: Float32Array | null // valeurs corrigées de la piste de position (x, y, z)
  readonly quaternions: Float32Array | null // valeurs corrigées de la piste de rotation (x, y, z, w)
  readonly yawStart: number // correction de cap appliquée au début et à la fin (radians)
  readonly yawEnd: number
}

// Corrige les pistes du bassin d'un clip. `bindX`, `bindZ` : position de repos du bassin ; `bindHeading` : cap de
// repos. Les temps sont ceux des pistes (secondes), `duration` celle du clip.
export const neutralizeRoot = (opts: {
  readonly cls: RootClass
  readonly duration: number
  readonly bindX: number
  readonly bindZ: number
  readonly bindHeading: number
  readonly positionTimes: ArrayLike<number> | null
  readonly positionValues: ArrayLike<number> | null
  readonly quaternionTimes: ArrayLike<number> | null
  readonly quaternionValues: ArrayLike<number> | null
}): RootFix => {
  let positions: Float32Array | null = null
  if (opts.positionValues) {
    positions = Float32Array.from(opts.positionValues)
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = opts.bindX
      positions[i + 2] = opts.bindZ
    }
  }
  let quaternions: Float32Array | null = null
  let yawStart = 0
  let yawEnd = 0
  const qv = opts.quaternionValues
  const qt = opts.quaternionTimes
  if (qv && qt && qv.length >= 4 && opts.cls !== 'aTerre') {
    const n = qv.length / 4
    const h = (k: number): number => headingOf(qv[k * 4 + 1] as number, qv[k * 4 + 3] as number)
    const standingStart = opts.cls === 'debout' || opts.cls === 'tombe'
    const standingEnd = opts.cls === 'debout' || opts.cls === 'releve'
    yawStart = standingStart ? wrap(opts.bindHeading - h(0)) : 0
    yawEnd = standingEnd ? wrap(opts.bindHeading - h(n - 1)) : 0
    const span = wrap(yawEnd - yawStart)
    const tEnd = (qt[n - 1] as number) || opts.duration || 1
    quaternions = new Float32Array(qv.length)
    for (let k = 0; k < n; k++) {
      const u = Math.min(1, Math.max(0, (qt[k] as number) / tEnd))
      const a = yawStart + span * u
      const q = preYaw(a, [
        qv[k * 4] as number,
        qv[k * 4 + 1] as number,
        qv[k * 4 + 2] as number,
        qv[k * 4 + 3] as number,
      ])
      quaternions.set(q, k * 4)
    }
  }
  return { positions, quaternions, yawStart, yawEnd }
}
