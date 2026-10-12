// Entrées DOM → PlayerCommands, échantillonnées une fois par tick. N'écrit jamais dans le monde.
// La visée est le point du sol sous le curseur, recalculé à chaque échantillon (la caméra a pu bouger).
import type { PlayerCommands, Vec2 } from '../sim/index'
import {
  blur,
  EDGE_CODES,
  EMPTY_INPUT,
  type InputState,
  keyDown,
  keyUp,
  MOVE_CODES,
  mouseButtons,
  type ScreenAxes,
  sampleCommands,
} from './keymap'

export interface Input {
  sample(): PlayerCommands
  dispose(): void
}

export interface InputOptions {
  readonly keyTarget?: EventTarget // défaut : la fenêtre (le clavier n'a pas besoin du focus du canvas)
}

type Rect = { left: number; top: number; width: number; height: number }

const rectOf = (target: EventTarget): Rect => {
  const el = target as Partial<HTMLElement>
  if (typeof el.getBoundingClientRect === 'function') return el.getBoundingClientRect()
  return { left: 0, top: 0, width: el.clientWidth ?? 1, height: el.clientHeight ?? 1 }
}

// Axes de l'écran au sol, tirés de screenToGround au centre de la cible : exacts au centre d'une perspective.
const axesFrom = (stg: (x: number, y: number) => Vec2, w: number, h: number): ScreenAxes => {
  const cx = w / 2
  const cy = h / 2
  const o = stg(cx, cy)
  const up = stg(cx, cy - h / 8)
  const right = stg(cx + w / 8, cy)
  const n = (p: Vec2): Vec2 => {
    const l = Math.hypot(p.x, p.z)
    return l < 1e-9 ? { x: 0, z: 0 } : { x: p.x / l, z: p.z / l }
  }
  return { up: n({ x: up.x - o.x, z: up.z - o.z }), right: n({ x: right.x - o.x, z: right.z - o.z }) }
}

export const createInput = (
  target: EventTarget,
  screenToGround: (x: number, y: number) => Vec2,
  options: InputOptions = {},
): Input => {
  const keyTarget = options.keyTarget ?? (typeof window !== 'undefined' ? window : target)
  let state: InputState = EMPTY_INPUT
  let cursor: { x: number; y: number } | null = null

  const relevant = (code: string): boolean => code in MOVE_CODES || code in EDGE_CODES
  const onKeyDown = (e: Event): void => {
    const k = e as KeyboardEvent
    if (!relevant(k.code)) return
    k.preventDefault?.()
    state = keyDown(state, k.code, k.repeat === true)
  }
  const onKeyUp = (e: Event): void => {
    const k = e as KeyboardEvent
    if (relevant(k.code)) state = keyUp(state, k.code)
  }
  const aimAt = (m: MouseEvent): void => {
    const r = rectOf(target)
    cursor = { x: m.clientX - r.left, y: m.clientY - r.top }
  }
  // Un second bouton pressé ou relâché pendant qu'un autre est tenu arrive ici (`button` ≠ −1, Pointer Events).
  // Sans changement de bouton, l'évènement ne peut que révéler un relâchement manqué : jamais de Frappe bloquée,
  // et un bouton pressé hors de la cible ne déclenche rien en y entrant.
  const onPointerMove = (e: Event): void => {
    const m = e as MouseEvent
    aimAt(m)
    state = mouseButtons(state, m.button !== -1 ? m.buttons : m.buttons & state.buttons)
  }
  const onPointerDown = (e: Event): void => {
    const m = e as MouseEvent
    aimAt(m)
    state = mouseButtons(state, m.buttons)
  }
  const onPointerUp = (e: Event): void => {
    state = mouseButtons(state, (e as MouseEvent).buttons)
  }
  const onPointerCancel = (): void => {
    state = mouseButtons(state, 0)
  }
  const onContext = (e: Event): void => e.preventDefault()
  const onBlur = (): void => {
    state = blur(state)
  }

  keyTarget.addEventListener('keydown', onKeyDown)
  keyTarget.addEventListener('keyup', onKeyUp)
  keyTarget.addEventListener('blur', onBlur)
  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerdown', onPointerDown)
  keyTarget.addEventListener('pointerup', onPointerUp)
  keyTarget.addEventListener('pointercancel', onPointerCancel)
  target.addEventListener('contextmenu', onContext)

  return {
    sample() {
      const r = rectOf(target)
      const c = cursor ?? { x: r.width / 2, y: r.height / 2 }
      const aim = screenToGround(c.x, c.y)
      const { commands, next } = sampleCommands(state, aim, axesFrom(screenToGround, r.width, r.height))
      state = next
      return commands
    },
    dispose() {
      keyTarget.removeEventListener('keydown', onKeyDown)
      keyTarget.removeEventListener('keyup', onKeyUp)
      keyTarget.removeEventListener('blur', onBlur)
      target.removeEventListener('pointermove', onPointerMove)
      target.removeEventListener('pointerdown', onPointerDown)
      keyTarget.removeEventListener('pointerup', onPointerUp)
      keyTarget.removeEventListener('pointercancel', onPointerCancel)
      target.removeEventListener('contextmenu', onContext)
    },
  }
}
