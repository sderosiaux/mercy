// Orientation de l'auditeur Web Audio à partir de la droite de l'écran au sol (requête C5 R1).
// Le sol (x, z) du monde correspond à (X, Z) de Web Audio, Y vers le haut. Avec droite = avant × haut,
// avant = haut × droite = (droite.z, 0, −droite.x).
import type { Vec2 } from '../sim/index'

export interface ListenerAxes {
  readonly forward: readonly [number, number, number]
  readonly up: readonly [number, number, number]
}

export const listenerAxes = (screenRight: Vec2): ListenerAxes => ({
  forward: [screenRight.z, 0, 0 - screenRight.x], // 0 − x : jamais de −0
  up: [0, 1, 0],
})

export const orientListener = (ctx: BaseAudioContext, screenRight: Vec2): void => {
  const { forward, up } = listenerAxes(screenRight)
  const l = ctx.listener
  if (l.forwardX) {
    l.forwardX.value = forward[0]
    l.forwardY.value = forward[1]
    l.forwardZ.value = forward[2]
    l.upX.value = up[0]
    l.upY.value = up[1]
    l.upZ.value = up[2]
  } else l.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2])
}
