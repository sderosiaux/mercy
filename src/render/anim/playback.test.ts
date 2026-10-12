// La recette du jeu (fonctions pures, horloge = ticks) donne exactement ce que la recette de la Forge produit dans un
// mélangeur three avancé pas à pas à 60 i/s : même temps lu, mêmes poids pendant l'interruption, même gel à la mort.
import { AnimationClip, AnimationMixer, NumberKeyframeTrack, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import {
  type ClipRecipe,
  clipTimeAt,
  FRAME_S,
  fadeWeightAt,
  freeze,
  INTERRUPT_FADE_FRAMES,
  INTERRUPT_FADE_S,
  impactRate,
  interrupt,
  playClip,
  SIM_FPS,
} from './playback'

// Clip linéaire : la valeur de la piste vaut le temps du clip, ce qui rend le temps lu observable sur l'objet.
const linearClip = (name: string, duration: number): AnimationClip =>
  new AnimationClip(name, duration, [new NumberKeyframeTrack('.userData[t]', [0, duration], [0, duration])])

const rig = () => {
  const root = new Object3D()
  root.userData.t = 0
  const mixer = new AnimationMixer(root)
  return { root, mixer }
}

describe('constantes de la recette', () => {
  it('reprend les valeurs de la Forge', () => {
    expect(SIM_FPS).toBe(60)
    expect(FRAME_S).toBeCloseTo(1 / 60, 12)
    expect(INTERRUPT_FADE_FRAMES).toBe(2)
    expect(INTERRUPT_FADE_S).toBeCloseTo(2 / 60, 12)
  })
})

describe('clipTimeAt = playClip avancé pas à pas', () => {
  const cases: ClipRecipe[] = [
    { name: 'boucle', boucle: true, startS: 0, rate: 1.7397, impactS: null },
    { name: 'boucle-decalee', boucle: true, startS: 0.4, rate: 0.9, impactS: null },
    { name: 'unique', boucle: false, startS: 0, rate: 1.0425, impactS: 0.417 },
    { name: 'unique-decalee', boucle: false, startS: 0.567, rate: 1, impactS: 0.567 },
  ]
  for (const recipe of cases) {
    it(recipe.name, () => {
      const duration = 1.9667
      const { mixer } = rig()
      const clip = linearClip(recipe.name, duration)
      const action = playClip(mixer.clipAction(clip), recipe)
      mixer.update(0)
      for (let f = 0; f <= 240; f++) {
        expect(action.time).toBeCloseTo(clipTimeAt(recipe, duration, f * FRAME_S), 6)
        mixer.update(FRAME_S)
      }
    })
  }
})

describe('interrupt : la réaction coupe en 2 images', () => {
  it('poids complémentaires, linéaires, réaction pleine à la 2e image', () => {
    const { mixer } = rig()
    const attack = playClip(mixer.clipAction(linearClip('attaque', 2)), {
      name: 'attaque',
      boucle: false,
      startS: 0,
      rate: 1,
      impactS: 1,
    })
    mixer.update(0.3)
    const recipe: ClipRecipe = { name: 'reaction', boucle: false, startS: 0, rate: 1, impactS: null }
    const reaction = interrupt(attack, mixer.clipAction(linearClip('reaction', 1.6)), recipe)
    for (let f = 0; f <= 4; f++) {
      mixer.update(f === 0 ? 0 : FRAME_S)
      const w = fadeWeightAt(f * FRAME_S)
      expect(reaction.getEffectiveWeight()).toBeCloseTo(w, 6)
      expect(attack.getEffectiveWeight()).toBeCloseTo(1 - w, 6)
      expect(reaction.time).toBeCloseTo(clipTimeAt(recipe, 1.6, f * FRAME_S, true), 6)
    }
    expect(fadeWeightAt(INTERRUPT_FADE_S)).toBe(1)
  })
})

describe('freeze : la pose ne bouge plus', () => {
  it('le temps lu et la valeur restent ceux de la mort, fondu en cours compris', () => {
    const { root, mixer } = rig()
    const loop = playClip(mixer.clipAction(linearClip('torsion', 3)), {
      name: 'torsion',
      boucle: true,
      startS: 0,
      rate: 1,
      impactS: null,
    })
    mixer.update(0.5)
    interrupt(loop, mixer.clipAction(linearClip('reaction', 1)), {
      name: 'reaction',
      boucle: false,
      startS: 0,
      rate: 1,
      impactS: null,
    })
    mixer.update(FRAME_S)
    freeze(mixer)
    const at = root.userData.t
    for (let f = 0; f < 60; f++) {
      mixer.update(FRAME_S)
      expect(root.userData.t).toBe(at)
    }
  })
})

describe('impactRate : le repère d’impact tombe au tick actif de la simulation', () => {
  it('cale la vitesse sur le télégraphe', () => {
    const r: ClipRecipe = { name: 'attaque.morsure', boucle: false, startS: 0, rate: 1.0425, impactS: 0.417 }
    const rate = impactRate(r, 24)
    expect(clipTimeAt({ ...r, rate }, 1.967, 24 * FRAME_S)).toBeCloseTo(0.417, 9)
    // Un autre télégraphe (réglage) déplace la vitesse, pas l'image d'impact.
    const slow = impactRate(r, 36)
    expect(clipTimeAt({ ...r, rate: slow }, 1.967, 36 * FRAME_S)).toBeCloseTo(0.417, 9)
  })
  it('sans repère, ou repère au début, garde la vitesse du manifeste', () => {
    expect(impactRate({ name: 'b', boucle: false, startS: 0, rate: 1, impactS: null }, 24)).toBe(1)
    expect(impactRate({ name: 'f', boucle: false, startS: 0.567, rate: 1, impactS: 0.567 }, 21)).toBe(1)
  })
})
