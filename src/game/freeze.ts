// Gel d'image au coup du joueur (§8.1). Décision pure, par image affichée : rendre le monde courant, rendre le pas
// qui porte le coup, ou tenir l'image déjà affichée. Aucune horloge ici : l'appelant fournit l'instant (ms).
export interface FreezeState {
  readonly until: number // ms : l'image affichée tient jusqu'à cet instant
}

export const NO_FREEZE: FreezeState = { until: Number.NEGATIVE_INFINITY }

export type FrameView =
  | { readonly kind: 'live' } // le monde courant, interpolé
  | { readonly kind: 'hit'; readonly step: number } // le monde du pas `step` de cette image
  | { readonly kind: 'hold' } // l'image déjà affichée

// `strikes[i]` : durée du gel (ms) si le pas i de cette image porte un coup du joueur, null sinon.
// Décision (drapeau 2 de B5) : l'image figée est celle du coup. Le pas qui porte le coup (le dernier, s'il y en a
// plusieurs dans l'image) est rendu à cette image, puis l'image tient pendant le gel, compté depuis cette image.
// Un coup pendant un gel est rendu à son tour et relance le gel.
export const frameView = (
  s: FreezeState,
  now: number,
  strikes: readonly (number | null)[],
): { readonly state: FreezeState; readonly view: FrameView } => {
  for (let i = strikes.length - 1; i >= 0; i--) {
    const ms = strikes[i]
    if (ms !== null && ms !== undefined) return { state: { until: now + ms }, view: { kind: 'hit', step: i } }
  }
  return { state: s, view: now < s.until ? { kind: 'hold' } : { kind: 'live' } }
}
