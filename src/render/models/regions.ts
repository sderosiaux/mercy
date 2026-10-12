// Régions d'un corps de la Forge, calculées au chargement dans la pose de repos, en mètres (attributs par sommet) :
// - partie (aPart) : 0 corps, 1 bras gauche, 2 bras droit (un Membre sectionné disparaît du corps), 3 sac du
//   Porteur (lueur et taille selon le stade), 4 halo du Confesseur (vert en prière) ;
// - marques dorées d'un Résistant (aMark) : une couronne autour du crâne, deux bandes autour du buste ;
// - coutures des Cicatrices (aSeams) : trois bandes obliques sur le buste, une par Cicatrice.
// Les régions propres à une famille (sac, halo) se reconnaissent à la géométrie : derrière le dos pour le sac,
// au-dessus du crâne pour le halo.
import { Vector3 } from 'three'

export const PART = { corps: 0, brasG: 1, brasD: 2, sac: 3, halo: 4 } as const

export interface BodyRegions {
  readonly part: Float32Array
  readonly mark: Float32Array
  readonly seams: Float32Array // 3 par sommet
  readonly sacCenter: Vector3 // centre du sac, repère du maillage (gonflement par stade)
  readonly counts: Readonly<Record<string, number>>
}

const ARM_L = new Set(['LeftArm', 'LeftForeArm', 'LeftHand'])
const ARM_R = new Set(['RightArm', 'RightForeArm', 'RightHand'])
const HEAD = new Set(['Head', 'head_end', 'headfront'])
const TORSO = new Set(['Spine', 'Spine01', 'Spine02'])
const BACK = new Set(['Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'LeftShoulder', 'RightShoulder', 'Hips'])

// `world` : positions des sommets au repos (m, repère du modèle, +Z devant, +Y en haut) ; `local` : positions
// du maillage (pour le centre du sac) ; `joints` : position au repos de chaque os, par nom.
export const bodyRegions = (
  id: string,
  world: Float32Array,
  local: ArrayLike<number>,
  dominant: Uint16Array,
  boneNames: readonly string[],
  joints: ReadonlyMap<string, Vector3>,
): BodyRegions => {
  const n = world.length / 3
  const part = new Float32Array(n)
  const mark = new Float32Array(n)
  const seams = new Float32Array(n * 3)
  const at = (name: string): Vector3 => joints.get(name) ?? new Vector3()
  const hips = at('Hips')
  const neck = at('neck')
  const head = at('Head')
  const headEnd = joints.get('head_end') ?? head.clone().add(new Vector3(0, 0.2, 0))
  const torsoH = Math.max(0.1, neck.y - hips.y)
  const headH = Math.max(0.05, headEnd.y - head.y)
  // Rayon du crâne : distance horizontale médiane des sommets du crâne à l'axe de la tête.
  const radii: number[] = []
  for (let i = 0; i < n; i++) {
    if (!HEAD.has(boneNames[dominant[i] as number] ?? '')) continue
    const y = world[i * 3 + 1] as number
    if (y < head.y || y > headEnd.y) continue
    radii.push(Math.hypot((world[i * 3] as number) - head.x, (world[i * 3 + 2] as number) - head.z))
  }
  radii.sort((a, b) => a - b)
  const headR = radii[Math.floor(radii.length * 0.75)] ?? 0.12
  let sacN = 0
  const sacSum = new Vector3()
  const counts: Record<string, number> = { brasG: 0, brasD: 0, sac: 0, halo: 0, marque: 0, couture: 0 }
  for (let i = 0; i < n; i++) {
    const name = boneNames[dominant[i] as number] ?? ''
    const x = world[i * 3] as number
    const y = world[i * 3 + 1] as number
    const z = world[i * 3 + 2] as number
    const rHead = Math.hypot(x - head.x, z - head.z)
    if (ARM_L.has(name)) part[i] = PART.brasG
    else if (ARM_R.has(name)) part[i] = PART.brasD
    // Halo du Confesseur : au-dessus du crâne, ou plus large que lui à hauteur de tête.
    if (
      id === 'confesseur' &&
      HEAD.has(name) &&
      (y > headEnd.y + 0.02 || (y > head.y + 0.4 * headH && rHead > headR * 1.6))
    )
      part[i] = PART.halo
    // Sac du Porteur : derrière le dos (plus de 12 cm derrière la colonne), au-dessus du bassin.
    if (id === 'porteur' && BACK.has(name) && y > hips.y - 0.1 && z < Math.min(hips.z, neck.z) - 0.12) {
      part[i] = PART.sac
      sacN++
      sacSum.add(new Vector3(local[i * 3] as number, local[i * 3 + 1] as number, local[i * 3 + 2] as number))
    }
    if (part[i] === PART.halo || part[i] === PART.sac) continue
    // Couronne dorée : bande à 55-70 % de la hauteur du crâne, sur le crâne lui-même.
    const hu = (y - head.y) / headH
    if (HEAD.has(name) && hu > 0.55 && hu < 0.7 && rHead < headR * 1.25) mark[i] = 1
    // Bandes dorées du buste : deux bandes de 4 cm à 40 % et 70 % de la hauteur du buste.
    const tu = (y - hips.y) / torsoH
    if (TORSO.has(name) && (Math.abs(tu - 0.4) * torsoH < 0.02 || Math.abs(tu - 0.7) * torsoH < 0.02))
      mark[i] = 1
    // Coutures : bandes obliques de 2 cm (pente 0,5) à 30 %, 50 %, 65 % du buste.
    if (TORSO.has(name)) {
      for (let k = 0; k < 3; k++) {
        const c = [0.3, 0.5, 0.65][k] as number
        const d = (y - hips.y - c * torsoH + 0.5 * (x - hips.x) * (k === 1 ? -1 : 1)) / Math.hypot(1, 0.5)
        if (Math.abs(d) < 0.01) seams[i * 3 + k] = 1
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (part[i] === PART.brasG) counts.brasG = (counts.brasG ?? 0) + 1
    if (part[i] === PART.brasD) counts.brasD = (counts.brasD ?? 0) + 1
    if (part[i] === PART.sac) counts.sac = (counts.sac ?? 0) + 1
    if (part[i] === PART.halo) counts.halo = (counts.halo ?? 0) + 1
    if (mark[i]) counts.marque = (counts.marque ?? 0) + 1
    if (seams[i * 3] || seams[i * 3 + 1] || seams[i * 3 + 2]) counts.couture = (counts.couture ?? 0) + 1
  }
  return {
    part,
    mark,
    seams,
    sacCenter: sacN > 0 ? sacSum.multiplyScalar(1 / sacN) : new Vector3(),
    counts,
  }
}
