// Playtest A/B à l'aveugle (B4 §11 et §12 I7). Logique pure : ordre des blocs, étapes, étiquettes, fichier de
// correspondance. Le panneau n'affiche que les étiquettes ; la variante réelle ne sort que dans le fichier de
// correspondance, écrit une fois au début de la session, à part des exports de télémétrie.
import { TICK_HZ, type Variant } from '../sim/index'

export const LABEL_1 = 'Réglage 1'
export const LABEL_2 = 'Réglage 2'
export type BlindLabel = typeof LABEL_1 | typeof LABEL_2

// B4 §11, déroulé 4 : une vague non finie après 300 s de jeu s'arrête et compte comme hors délai. Compté depuis T0,
// comme la limite des bots (B4 §5, « Exécution », et I5), pour que humains et bots soient coupés au même instant.
export const BLIND_TIMEOUT_S = 300
export const BLIND_TIMEOUT_TICKS = BLIND_TIMEOUT_S * TICK_HZ

export type BlockOrder = readonly [Variant, Variant, Variant, Variant]

// B4 §11, déroulé 3 : testeur d'indice impair A, B, B, A ; pair B, A, A, B. L'indice suit l'ordre d'arrivée (1, 2, …).
export const blockOrder = (testeur: number): BlockOrder => {
  if (!Number.isInteger(testeur) || testeur < 1)
    throw new Error(`indice de testeur invalide : ${testeur} (entier ≥ 1, ordre d'arrivée)`)
  return testeur % 2 === 1 ? ['A', 'B', 'B', 'A'] : ['B', 'A', 'A', 'B']
}

// Le réglage 1 est celui du premier bloc (B4 §11, « Matériel »).
export const labelOf = (order: BlockOrder, variant: Variant): BlindLabel =>
  variant === order[0] ? LABEL_1 : LABEL_2

export const variantOfLabel = (order: BlockOrder, label: BlindLabel): Variant =>
  label === LABEL_1 ? order[0] : order[0] === 'A' ? 'B' : 'A'

export interface BlindStep {
  readonly index: number // 0 : échauffement, puis 1 à 8
  readonly etape: 'echauffement' | 'bloc'
  readonly bloc: number | null
  readonly vague: 'V1' | 'V2' | 'V6'
  readonly graine: number
  readonly etiquette: BlindLabel
}

// B4 §11, déroulé 1 et 2 : échauffement V1 graine 1 dans la variante du bloc 1 ; puis 4 blocs, chacun V2 puis V6
// avec la graine du numéro de bloc. La variante n'est pas un champ de l'étape : elle se déduit de l'étiquette et de
// l'ordre, que seul le fichier de correspondance contient.
export const blindSteps = (testeur: number): readonly BlindStep[] => {
  const order = blockOrder(testeur)
  const steps: BlindStep[] = [
    { index: 0, etape: 'echauffement', bloc: null, vague: 'V1', graine: 1, etiquette: LABEL_1 },
  ]
  for (let b = 1; b <= 4; b++) {
    const etiquette = labelOf(order, order[b - 1] as Variant)
    for (const vague of ['V2', 'V6'] as const)
      steps.push({ index: steps.length, etape: 'bloc', bloc: b, vague, graine: b, etiquette })
  }
  return steps
}

export const stepVariant = (testeur: number, step: BlindStep): Variant =>
  variantOfLabel(blockOrder(testeur), step.etiquette)

export const CORRESPONDENCE_FORMAT = 'mercy-correspondance'

export interface Correspondence {
  readonly format: typeof CORRESPONDENCE_FORMAT
  readonly version: 1
  readonly testeur: number
  readonly ordre: BlockOrder
  readonly reglages: Readonly<Record<BlindLabel, Variant>>
  readonly note: string
}

export const correspondence = (testeur: number): Correspondence => {
  const ordre = blockOrder(testeur)
  return {
    format: CORRESPONDENCE_FORMAT,
    version: 1,
    testeur,
    ordre,
    reglages: { [LABEL_1]: variantOfLabel(ordre, LABEL_1), [LABEL_2]: variantOfLabel(ordre, LABEL_2) },
    note: "B4 §11 : à n'ouvrir qu'après le codage des réponses Q4 et Q7.",
  }
}

export const correspondenceFileName = (testeur: number): string =>
  `mercy-correspondance-testeur-${testeur}.json`

export const parseCorrespondence = (v: unknown): Correspondence => {
  const c = v as Partial<Correspondence> | null
  if (!c || c.format !== CORRESPONDENCE_FORMAT || c.version !== 1)
    throw new Error(`fichier de correspondance attendu (format ${CORRESPONDENCE_FORMAT}, version 1)`)
  const r = c.reglages as Record<string, unknown> | undefined
  const ok = (x: unknown) => x === 'A' || x === 'B'
  if (!r || !ok(r[LABEL_1]) || !ok(r[LABEL_2]) || r[LABEL_1] === r[LABEL_2])
    throw new Error("correspondance invalide : il faut « Réglage 1 » et « Réglage 2 », l'un A, l'autre B")
  return c as Correspondence
}
