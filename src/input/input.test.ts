// Correspondance clavier → commandes (§6), par la vraie fonction createInput sur une cible d'évènements.
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../sim/index'
import { createInput } from './input'
import { EMPTY_INPUT, keyDown, moveVector, sampleCommands } from './keymap'

// Caméra factice : 10 px = 1 m, le haut de l'écran est −z, la droite est +x.
const stg = (x: number, y: number): Vec2 => ({ x: x / 10, z: y / 10 })

const setup = () => {
  const target = new EventTarget() as EventTarget & { clientWidth: number; clientHeight: number }
  target.clientWidth = 400
  target.clientHeight = 300
  const input = createInput(target, stg, { keyTarget: target })
  const fire = (type: string, props: Record<string, unknown>) =>
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props))
  return {
    input,
    key: (code: string, down = true, repeat = false) => fire(down ? 'keydown' : 'keyup', { code, repeat }),
    // Ce qu'émet un navigateur (Pointer Events) : `button` est le bouton qui vient de changer (−1 : aucun),
    // `buttons` les boutons tenus après l'évènement (1 : gauche, 2 : droit). `pointerdown` n'arrive qu'au premier
    // bouton pressé, `pointerup` qu'au dernier relâché ; entre les deux, un autre bouton arrive par `pointermove`.
    mouse: (
      type: 'pointerdown' | 'pointerup' | 'pointermove' | 'pointercancel',
      button: number,
      buttons: number,
      x = 0,
      y = 0,
    ) => fire(type, { button, buttons, clientX: x, clientY: y }),
  }
}

describe('déplacement par position physique (§6)', () => {
  it('lit KeyW/KeyA/KeyS/KeyD : la même touche physique en AZERTY (Z, Q, S, D) et en QWERTY', () => {
    const { input, key } = setup()
    key('KeyW')
    expect(input.sample().move).toEqual({ x: 0, z: -1 })
    key('KeyD')
    const diag = input.sample().move
    expect(diag.x).toBeCloseTo(Math.SQRT1_2, 9)
    expect(diag.z).toBeCloseTo(-Math.SQRT1_2, 9)
    key('KeyW', false)
    key('KeyD', false)
    key('KeyA')
    expect(input.sample().move).toEqual({ x: -1, z: 0 })
    key('KeyA', false)
    key('KeyS')
    expect(input.sample().move).toEqual({ x: 0, z: 1 })
  })

  it('donne une direction de norme 0 ou 1, nulle si deux touches opposées s’annulent', () => {
    const axes = { up: { x: 0, z: -1 }, right: { x: 1, z: 0 } }
    expect(moveVector(new Set(['KeyW', 'KeyS']), axes)).toEqual({ x: 0, z: 0 })
    const m = moveVector(new Set(['KeyW', 'KeyA']), axes)
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(1, 12)
  })

  it('ignore les touches hors du schéma (la lettre Z d’un AZERTY arrive en KeyW, pas en KeyZ)', () => {
    const { input, key } = setup()
    key('KeyZ')
    key('KeyE')
    expect(input.sample().move).toEqual({ x: 0, z: 0 })
  })
})

describe('fronts montants (§6)', () => {
  it('Espace, F, KeyQ et X ne valent qu’un tick, même tenus', () => {
    const { input, key } = setup()
    key('Space')
    key('KeyF')
    key('KeyX')
    const a = input.sample()
    expect([a.dodge, a.sentence, a.swapWeapon]).toEqual([true, true, true])
    key('Space', true, true) // répétition automatique du clavier
    const b = input.sample()
    expect([b.dodge, b.sentence, b.swapWeapon]).toEqual([false, false, false])
    key('KeyQ')
    expect(input.sample().rite).toBe('charge')
    expect(input.sample().rite).toBeNull()
  })

  it('garde un appui bref tombé entre deux ticks', () => {
    const { input, key } = setup()
    key('Space')
    key('Space', false)
    expect(input.sample().dodge).toBe(true)
  })

  it('relâcher puis réappuyer redonne un front', () => {
    const { input, key } = setup()
    key('KeyF')
    input.sample()
    key('KeyF', false)
    key('KeyF')
    expect(input.sample().sentence).toBe(true)
  })

  it('clic droit : Balayage ; si la Charge part au même tick, le Balayage attend le suivant', () => {
    const { input, key, mouse } = setup()
    mouse('pointerdown', 2, 2)
    expect(input.sample().rite).toBe('balayage')
    mouse('pointerup', 2, 0)
    mouse('pointerdown', 2, 2)
    key('KeyQ')
    expect(input.sample().rite).toBe('charge')
    expect(input.sample().rite).toBe('balayage')
    expect(input.sample().rite).toBeNull() // tenu, le clic droit ne redonne pas de front
  })
})

describe('Frappe et visée', () => {
  it('clic gauche maintenu : Frappe à chaque tick jusqu’au relâchement', () => {
    const { input, mouse } = setup()
    mouse('pointerdown', 0, 1, 100, 100)
    expect(input.sample().strike).toBe(true)
    expect(input.sample().strike).toBe(true)
    mouse('pointerup', 0, 0)
    expect(input.sample().strike).toBe(false)
  })

  it('un clic bref entre deux ticks donne une Frappe', () => {
    const { input, mouse } = setup()
    mouse('pointerdown', 0, 1, 50, 50)
    mouse('pointerup', 0, 0)
    expect(input.sample().strike).toBe(true)
    expect(input.sample().strike).toBe(false)
  })

  it('vise le point du sol sous le curseur', () => {
    const { input, mouse } = setup()
    mouse('pointermove', -1, 0, 250, 120)
    expect(input.sample().aim).toEqual({ x: 25, z: 12 })
  })

  it('n’émet aucun front sans évènement', () => {
    const { commands } = sampleCommands(
      keyDown(EMPTY_INPUT, 'KeyW', false),
      { x: 0, z: 0 },
      {
        up: { x: 0, z: -1 },
        right: { x: 1, z: 0 },
      },
    )
    expect(commands).toMatchObject({
      dodge: false,
      sentence: false,
      rite: null,
      swapWeapon: false,
      strike: false,
    })
  })
})

// Revue P0 H1 : un second bouton pressé ou relâché pendant qu'un autre est tenu n'arrive que par `pointermove`.
// Séquences relevées dans Chrome (entrée CDP réelle, revue de code P0).
describe('accords de boutons (Pointer Events)', () => {
  it('clic droit pendant la Frappe tenue : Balayage, et la Frappe continue', () => {
    const { input, mouse } = setup()
    mouse('pointerdown', 0, 1)
    expect(input.sample()).toMatchObject({ strike: true, rite: null })
    mouse('pointermove', 2, 3)
    expect(input.sample()).toMatchObject({ strike: true, rite: 'balayage' })
    expect(input.sample()).toMatchObject({ strike: true, rite: null })
    mouse('pointermove', 2, 1)
    expect(input.sample()).toMatchObject({ strike: true, rite: null })
    mouse('pointerup', 0, 0)
    expect(input.sample()).toMatchObject({ strike: false, rite: null })
  })

  it('gauche tenu, droit pressé, gauche relâché, droit relâché : la Frappe ne reste pas bloquée', () => {
    const { input, mouse } = setup()
    mouse('pointerdown', 0, 1)
    mouse('pointermove', 2, 3)
    expect(input.sample().strike).toBe(true)
    mouse('pointermove', 0, 2)
    expect(input.sample().strike).toBe(false)
    mouse('pointerup', 2, 0)
    expect(input.sample()).toMatchObject({ strike: false, rite: null })
    expect(input.sample().strike).toBe(false)
  })

  it('droit tenu puis clic gauche : Frappe ; le gauche relâché la termine', () => {
    const { input, mouse } = setup()
    mouse('pointerdown', 2, 2)
    expect(input.sample()).toMatchObject({ strike: false, rite: 'balayage' })
    mouse('pointermove', 0, 3)
    expect(input.sample()).toMatchObject({ strike: true, rite: null })
    mouse('pointermove', 0, 2)
    expect(input.sample().strike).toBe(false)
    mouse('pointerup', 2, 0)
    expect(input.sample().strike).toBe(false)
  })

  it('un clic gauche bref pendant le clic droit tenu donne quand même une Frappe', () => {
    const { input, mouse } = setup()
    mouse('pointerdown', 2, 2)
    input.sample()
    mouse('pointermove', 0, 3)
    mouse('pointermove', 0, 2)
    expect(input.sample().strike).toBe(true)
    expect(input.sample().strike).toBe(false)
  })

  it('un déplacement sans changement de bouton ne presse rien, mais révèle un relâchement manqué', () => {
    const { input, mouse } = setup()
    mouse('pointermove', -1, 1, 10, 10) // bouton pressé hors de la cible : pas de Frappe
    expect(input.sample().strike).toBe(false)
    mouse('pointerdown', 0, 1)
    expect(input.sample().strike).toBe(true)
    mouse('pointermove', -1, 0, 20, 20) // relâché sans pointerup reçu : la Frappe s'arrête
    expect(input.sample().strike).toBe(false)
  })

  it('pointercancel relâche tous les boutons', () => {
    const { input, mouse } = setup()
    mouse('pointerdown', 0, 1)
    expect(input.sample().strike).toBe(true)
    mouse('pointercancel', -1, 0)
    expect(input.sample().strike).toBe(false)
  })
})
