// Niveaux de qualité du moteur de présentation (E1, §24 : 60 i/s visés, 30 au minimum, sur une puce intégrée).
// Un niveau fixe des budgets, pas des sens : liseré, gris des morts, télégraphes et sang sont identiques partout.
// Le choix vient de l'option du rendu, sinon du paramètre d'URL `qualite` (haute par défaut).

export type QualityLevel = 'haute' | 'basse'

export interface QualitySpec {
  readonly level: QualityLevel
  readonly pointLights: number // lumières ponctuelles sans ombre actives à la fois
  readonly shadowLights: number // flammes qui portent une ombre (projecteurs), choisies par importance
  readonly shadowMapSize: number
  readonly moonShadow: boolean
  readonly moonShadowMapSize: number
  readonly fogLights: number // lumières qui diffusent dans le brouillard (les plus importantes des actives)
  readonly bloom: boolean
  readonly grain: boolean
  readonly reflections: boolean // reflets de l'environnement capturé dans la boue mouillée
  readonly renderScale: number // résolution de la passe de scène, en fraction du canvas
  readonly flamesPerTorch: number
}

export const QUALITY: Readonly<Record<QualityLevel, QualitySpec>> = {
  haute: {
    level: 'haute',
    pointLights: 10,
    shadowLights: 3,
    shadowMapSize: 1024,
    moonShadow: true,
    moonShadowMapSize: 2048,
    fogLights: 8,
    bloom: true,
    grain: true,
    reflections: true,
    renderScale: 1,
    flamesPerTorch: 3,
  },
  basse: {
    level: 'basse',
    pointLights: 4,
    shadowLights: 1,
    shadowMapSize: 512,
    moonShadow: false,
    moonShadowMapSize: 1024,
    fogLights: 4,
    bloom: false,
    grain: true,
    reflections: false,
    renderScale: 0.75, // scène à 75 % de la résolution ; signaux (liseré, morts, télégraphes) à pleine résolution
    flamesPerTorch: 2,
  },
}

export const isQualityLevel = (s: string | null | undefined): s is QualityLevel =>
  s === 'haute' || s === 'basse'

// Paramètre d'URL lu une fois, si la page en a un (le jeu et le laboratoire le partagent).
export const urlParam = (key: string): string | null => {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get(key)
}

export const qualityFrom = (level: QualityLevel | undefined): QualitySpec => {
  if (level) return QUALITY[level]
  const p = urlParam('qualite')
  return QUALITY[isQualityLevel(p) ? p : 'haute']
}
