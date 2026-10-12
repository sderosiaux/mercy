// Correspondance clavier et souris → PlayerCommands (§6). Les touches sont lues par position physique
// (KeyboardEvent.code) : ZQSD en AZERTY et WASD en QWERTY sont les mêmes codes. Pur : testable sans DOM.
import type { PlayerCommands, Vec2 } from '../sim/index'

export type Edge = 'dodge' | 'sentence' | 'balayage' | 'charge' | 'swap'

// Déplacement à l'écran : haut, bas, gauche, droite.
export const MOVE_CODES: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
}

// Fronts montants (§6) : Esquive, Sentence, Charge (A en AZERTY, Q en QWERTY), changement d'arme.
export const EDGE_CODES: Readonly<Record<string, Edge>> = {
  Space: 'dodge',
  KeyF: 'sentence',
  KeyQ: 'charge',
  KeyX: 'swap',
}

// Bits de PointerEvent.buttons (boutons tenus), pas les numéros de PointerEvent.button.
export const MOUSE_STRIKE = 1 // clic gauche maintenu : Frappe
export const MOUSE_BALAYAGE = 2 // clic droit : Rite Balayage

export interface InputState {
  readonly held: ReadonlySet<string> // codes de touches enfoncées
  readonly buttons: number // boutons de souris tenus (PointerEvent.buttons)
  readonly strikeHeld: boolean
  readonly strikePressed: boolean // clic gauche pressé depuis le dernier échantillon (clic bref entre deux ticks)
  readonly edges: ReadonlySet<Edge> // fronts montants depuis le dernier échantillon
}

export const EMPTY_INPUT: InputState = {
  held: new Set(),
  buttons: 0,
  strikeHeld: false,
  strikePressed: false,
  edges: new Set(),
}

export const keyDown = (s: InputState, code: string, repeat: boolean): InputState => {
  const edge = EDGE_CODES[code]
  const held = new Set(s.held)
  held.add(code)
  const edges = edge && !repeat && !s.held.has(code) ? new Set([...s.edges, edge]) : s.edges
  return { ...s, held, edges }
}

export const keyUp = (s: InputState, code: string): InputState => {
  const held = new Set(s.held)
  held.delete(code)
  return { ...s, held }
}

// Nouvel ensemble de boutons tenus. Pointer Events n'émet `pointerdown` qu'au premier bouton pressé et `pointerup`
// qu'au dernier relâché : un bouton pressé ou relâché pendant qu'un autre est tenu n'arrive que par `pointermove`.
// On compare donc les boutons tenus d'un évènement à l'autre : un bit qui apparaît est un front montant.
export const mouseButtons = (s: InputState, buttons: number): InputState => {
  const pressed = buttons & ~s.buttons
  return {
    ...s,
    buttons,
    strikeHeld: (buttons & MOUSE_STRIKE) !== 0,
    strikePressed: s.strikePressed || (pressed & MOUSE_STRIKE) !== 0,
    edges: (pressed & MOUSE_BALAYAGE) !== 0 ? new Set([...s.edges, 'balayage']) : s.edges,
  }
}

// Perte de focus : plus rien n'est tenu, les fronts déjà vus restent valables pour le prochain échantillon.
export const blur = (s: InputState): InputState => ({ ...s, held: new Set(), buttons: 0, strikeHeld: false })

export interface ScreenAxes {
  readonly up: Vec2 // direction au sol du haut de l'écran
  readonly right: Vec2
}

// Direction de déplacement au sol, norme 0 ou 1 (contrat de PlayerCommands.move).
export const moveVector = (held: ReadonlySet<string>, axes: ScreenAxes): Vec2 => {
  let sx = 0
  let sy = 0
  for (const code of held) {
    const d = MOVE_CODES[code]
    if (d) {
      sx += d[0]
      sy += d[1]
    }
  }
  const x = axes.right.x * sx + axes.up.x * sy
  const z = axes.right.z * sx + axes.up.z * sy
  const l = Math.hypot(x, z)
  return l < 1e-9 ? { x: 0, z: 0 } : { x: x / l + 0, z: z / l + 0 } // + 0 : pas de -0
}

// Échantillon d'un tick : les commandes, et l'état avec les fronts consommés.
export const sampleCommands = (
  s: InputState,
  aim: Vec2,
  axes: ScreenAxes,
): { readonly commands: PlayerCommands; readonly next: InputState } => {
  const rite = s.edges.has('charge') ? 'charge' : s.edges.has('balayage') ? 'balayage' : null
  return {
    commands: {
      move: moveVector(s.held, axes),
      aim,
      strike: s.strikeHeld || s.strikePressed,
      dodge: s.edges.has('dodge'),
      sentence: s.edges.has('sentence'),
      rite,
      swapWeapon: s.edges.has('swap'),
    },
    // Deux Rites dans le même tick : la Charge part, le Balayage attend l'échantillon suivant.
    next: {
      ...s,
      strikePressed: false,
      edges: rite === 'charge' && s.edges.has('balayage') ? new Set<Edge>(['balayage']) : new Set<Edge>(),
    },
  }
}
