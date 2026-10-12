// Manifeste étendu de la banque (B5 I8). Le lecteur lit ici rôle, boucle, offset et canaux ; il n'en garde
// aucune copie ailleurs. Écrit par scripts/generate-audio.ts, servi depuis public/audio/manifest.json.

export type Role =
  | 'halètement'
  | 'cri'
  | 'inspiration'
  | 'cri-etouffe' // D8 : voix d'un corps absorbé dans le sac d'un Porteur
  | 'gargouillis'
  | 'chant'
  | 'etranglement' // §8.10 : prière interrompue
  | 'scie'
  | 'coutures'
  | 'nappe'
  | 'vent' // ambiance (§19 : « une zone vidée n'a plus que le vent »)
  | 'impact-tranchant'
  | 'impact-contondant'
  | 'clang' // L4 : coup sur un Résistant Abattu
  | 'mat' // §21 : F sans cible

export const VOICE_ROLES: ReadonlySet<Role> = new Set(['halètement', 'cri', 'inspiration', 'cri-etouffe'])
// B5.O11 (e) : sources spatialisées (voix, gargouillis, chant, scie, coutures, et l'étranglement d'un Confesseur).
export const SPATIAL_ROLES: ReadonlySet<Role> = new Set([
  'halètement',
  'cri',
  'inspiration',
  'cri-etouffe',
  'gargouillis',
  'chant',
  'etranglement',
  'scie',
  'coutures',
])
export const IMPACT_ROLES: ReadonlySet<Role> = new Set(['impact-tranchant', 'impact-contondant'])

export interface ManifestEntry {
  readonly id: string
  readonly file: string // relatif à public/audio/
  readonly role: Role
  readonly prompt: string
  readonly model: string
  readonly apiOutputFormat: string
  readonly promptInfluence: number
  readonly requestedDurationS: number
  readonly apiLoop: boolean // paramètre `loop` envoyé à l'API
  readonly durationMs: number // fichier écrit
  readonly frames: number
  readonly loop: boolean // le lecteur boucle ce fichier
  readonly loopStart: number // échantillons, dans le tampon décodé à sampleRate
  readonly loopEnd: number // échantillons, exclusif
  readonly startOffset: number // échantillons : point de départ de la lecture
  // Gain de lecture en dB, appliqué par le lecteur et par I9 (0 si absent). Corrige le niveau d'un fichier sans
  // retoucher le WAV : cri-07 (B5.O11 g), consigné dans `retouches`.
  readonly gainDb?: number
  readonly channels: number
  readonly sampleRate: number
  readonly format: 'wav-pcm16'
  readonly sha256: string
  readonly rawSha256: string // réponse brute de l'API
  readonly retouches: readonly string[] // chaque transformation appliquée au son généré, avec ses chiffres
  readonly generatedAt: string
  readonly attempt: number // 1 = première génération ; 2 et 3 = régénérations après échec des contrôles
}

export interface Manifest {
  readonly version: 1
  readonly generator: string
  readonly sampleRate: number
  readonly quantum: number
  readonly bankSha256: string // empreinte de la banque : sha256 des empreintes triées par id
  readonly files: readonly ManifestEntry[]
}

export const byRole = (m: Manifest, role: Role): readonly ManifestEntry[] =>
  m.files.filter((f) => f.role === role).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

// Choix reproductible d'un fichier dans un rôle à partir de voiceSeed(world, id) (B5 I3) : jamais Math.random.
// `salt` sépare les tirages (cri, halètement, inspiration) pour qu'ils ne soient pas corrélés.
export const pick = <T>(pool: readonly T[], seed: number, salt: number): T => {
  if (pool.length === 0) throw new Error('banque vide pour ce rôle')
  const mixed = (Math.imul(seed ^ Math.imul(salt + 1, 0x85ebca6b), 0xc2b2ae35) ^ (seed >>> 13)) >>> 0
  return pool[mixed % pool.length] as T
}
