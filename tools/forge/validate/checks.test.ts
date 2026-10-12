// Chaque contrôle de la validation, sur une figurine glTF animée construite en code (aucun asset externe) : un cas
// qui passe, un défaut connu qui échoue, et ce qui doit rester « non mesurable ».
import { describe, expect, it } from 'vitest'
import { TUNING } from '../../../src/sim/index'
import { bancSheetRaw } from '../banc'
import { type BuildOptions, buildFigure, type ClipDef } from '../gltf/build'
import {
  hit,
  idle,
  idleWithSeam,
  mercyExtras,
  rise,
  slidingIdle,
  strike,
  walkInPlace,
  walkWithRootMotion,
} from '../gltf/fixtures'
import { encodePng } from '../image/png'
import { parseAsset } from '../schema'
import { type CheckResult, type ValidateOptions, type ValidationReport, validate } from './checks'
import { loadRig } from './rig'
import { FOOT_SLIDE_MAX_M, FREEZE_MAX_M, INTERRUPT_MAX_FRAMES } from './thresholds'

const GOOD: readonly ClipDef[] = [
  idle('rituel'),
  walkInPlace('marche'),
  strike('attaque'),
  hit('reaction'),
  rise('relevement'),
]

const run = async (
  opts: {
    clips?: readonly ClipDef[]
    build?: Partial<BuildOptions>
    sheet?: (raw: Record<string, unknown>) => void
    validate?: ValidateOptions
  } = {},
): Promise<ValidationReport> => {
  const raw = structuredClone(bancSheetRaw())
  opts.sheet?.(raw)
  const sheet = parseAsset(raw)
  const glb = buildFigure({ clips: opts.clips ?? GOOD, ...opts.build })
  const rig = await loadRig(glb, { hauteurM: sheet.hauteurM, stripTextures: true })
  return validate(sheet, glb, rig, opts.validate)
}

const replace = (name: string, clip: ClipDef): ClipDef[] => GOOD.map((c) => (c.name === name ? clip : c))
const find = (r: ValidationReport, controle: string, clip?: string): CheckResult => {
  const found = r.controles.find((c) => c.controle === controle && (clip === undefined || c.clip === clip))
  if (!found)
    throw new Error(
      `contrôle ${controle} ${clip ?? ''} absent : ${JSON.stringify(r.controles.map((c) => [c.controle, c.clip]))}`,
    )
  return found
}
const clipsOf = (raw: Record<string, unknown>) => raw.clips as Record<string, unknown>[]

describe('validation : la figurine de banc passe tout', () => {
  it('verdict valide, aucun échec, rien de non mesurable', async () => {
    const r = await run()
    expect(r.controles.filter((c) => c.verdict !== 'ok')).toEqual([])
    expect(r.bilan.verdict).toBe('valide')
  })
})

describe('squelette et clips', () => {
  it('un maillage sans squelette échoue', async () => {
    const r = await run({ build: { skinned: false } })
    expect(find(r, 'squelette').verdict).toBe('echec')
  })

  it('un clip demandé absent échoue ; un clip mal étiqueté aussi', async () => {
    const missing = await run({ clips: GOOD.filter((c) => c.name !== 'relevement') })
    expect(find(missing, 'clip', 'relevement')).toMatchObject({
      verdict: 'echec',
      detail: 'clip absent du modèle',
    })
    const mislabeled = await run({
      clips: replace('rituel', { ...idle('rituel'), extras: mercyExtras('rituel', 'boucle', false) }),
    })
    expect(find(mislabeled, 'clip', 'rituel').verdict).toBe('echec')
  })

  it('une durée nulle échoue', async () => {
    const r = await run({ clips: replace('reaction', hit('reaction', 0)) })
    expect(find(r, 'duree', 'reaction').verdict).toBe('echec')
  })
})

describe('repère d’impact et calage sur le tick actif', () => {
  it('le repère est présent, dans le clip, et proche du pic d’allonge mesuré de l’effecteur', async () => {
    const r = await run()
    expect(find(r, 'impact', 'attaque')).toMatchObject({ verdict: 'ok', mesure: 0.55 })
    const m = r.clips.find((c) => c.etat === 'attaque')
    expect(Math.abs((m?.impactMesureS ?? 0) - 0.55)).toBeLessThanOrEqual(2 / 60)
    // vitesse = 0,55 s de clip jouées en 24 ticks (télégraphe de la morsure)
    expect(m?.recette.rate).toBeCloseTo(0.55 / (TUNING.souriant.morsure.telegraph / 60), 6)
  })

  it('un repère absent ou hors du clip échoue', async () => {
    const absent = await run({ clips: replace('attaque', strike('attaque', 1, 0.55, null)) })
    expect(find(absent, 'impact', 'attaque').verdict).toBe('echec')
    const outside = await run({ clips: replace('attaque', strike('attaque', 1, 0.55, 1.4)) })
    expect(find(outside, 'impact', 'attaque').verdict).toBe('echec')
  })

  it('un clip qu’il faudrait accélérer de plus de 2 fois pour caler l’impact échoue', async () => {
    const r = await run({ clips: replace('attaque', strike('attaque', 1.2, 0.95)) })
    expect(find(r, 'vitesse', 'attaque')).toMatchObject({ verdict: 'echec', mesure: 2.375 })
  })

  it('coup qui touche au tick de départ (Frappe) : anticipation sautée, la récupération doit couvrir la fenêtre', async () => {
    const asFrappe = (raw: Record<string, unknown>) => {
      raw.famille = 'bourreau'
      raw.interruption = null
      clipsOf(raw)[2] = {
        ...clipsOf(raw)[2],
        temps: { impact: 'debut', fenetre: ['weapons.couperet.period'] },
      }
    }
    const ok = await run({ sheet: asFrappe })
    expect(find(ok, 'recuperation', 'attaque')).toMatchObject({ verdict: 'ok', mesure: 0.45, seuil: 0.35 })
    expect(ok.clips.find((c) => c.etat === 'attaque')?.recette).toMatchObject({ startS: 0.55, rate: 1 })
    const short = await run({ sheet: asFrappe, clips: replace('attaque', strike('attaque', 0.7, 0.55)) })
    expect(find(short, 'recuperation', 'attaque').verdict).toBe('echec')
  })

  it('une transition calée sur une fenêtre de la simulation (Relèvement, 90 ticks) respecte les bornes de vitesse', async () => {
    const ok = await run({ clips: replace('relevement', rise('relevement', 3)) })
    expect(find(ok, 'vitesse', 'relevement')).toMatchObject({ verdict: 'ok', mesure: 2 })
    const tooLong = await run({ clips: replace('relevement', rise('relevement', 4)) })
    expect(find(tooLong, 'vitesse', 'relevement').verdict).toBe('echec')
  })
})

describe('boucles', () => {
  it('une boucle dont la dernière image ne rejoint pas la première échoue', async () => {
    const ok = await run()
    expect(find(ok, 'boucle', 'rituel')).toMatchObject({ verdict: 'ok', mesure: 0 })
    const seam = await run({ clips: replace('rituel', idleWithSeam('rituel')) })
    const c = find(seam, 'boucle', 'rituel')
    expect(c.verdict).toBe('echec')
    expect((c.mesure ?? 0) > (c.seuil ?? 0)).toBe(true)
  })

  it('le tremblement du vivant est mesuré (sans verdict), en pixels', async () => {
    const r = await run()
    expect(r.clips.find((c) => c.etat === 'rituel')?.tremblementMinPx).toBeGreaterThan(0)
  })
})

describe('pieds', () => {
  it('des pieds qui glissent pendant l’appui échouent sur un clip sur place', async () => {
    const r = await run({ clips: replace('rituel', slidingIdle('rituel')) })
    const c = find(r, 'pieds', 'rituel')
    expect(c.verdict).toBe('echec')
    expect(c.mesure).toBeGreaterThan(FOOT_SLIDE_MAX_M)
  })

  it('des os de pied introuvables rendent la mesure impossible, jamais réputée bonne ; la fiche peut les nommer', async () => {
    const names = { footL: 'Bone_11', footR: 'Bone_14' }
    const r = await run({ build: { boneNames: names } })
    expect(find(r, 'pieds', 'rituel').verdict).toBe('non-mesurable')
    expect(r.bilan.verdict).toBe('incomplet')
    const named = await run({
      build: { boneNames: names },
      sheet: (raw) => {
        raw.os = { piedGauche: 'Bone_11', piedDroit: 'Bone_14' }
      },
    })
    expect(find(named, 'pieds', 'rituel').verdict).toBe('ok')
  })
})

describe('locomotion', () => {
  it('la foulée mesurée donne la vitesse de lecture qui colle les pieds au sol à la vitesse de la simulation', async () => {
    const r = await run()
    const m = r.clips.find((c) => c.etat === 'marche')
    expect(m?.fouleeMps).toBeGreaterThan(0)
    expect(m?.recette.rate).toBeCloseTo(TUNING.souriant.speed / (m?.fouleeMps ?? 1), 2)
    expect(find(r, 'vitesse', 'marche').verdict).toBe('ok')
  })

  it('une marche qui avance d’elle-même (mouvement de racine) échoue', async () => {
    const r = await run({ clips: replace('marche', walkWithRootMotion('marche', 1.2)) })
    expect(find(r, 'sur-place', 'marche')).toMatchObject({ verdict: 'echec', mesure: 1.2 })
  })

  it('une foulée trop courte pour la vitesse de la simulation échoue', async () => {
    const r = await run({ clips: replace('marche', walkInPlace('marche', 1, 0.12)) })
    expect(find(r, 'vitesse', 'marche').verdict).toBe('echec')
  })
})

describe('budgets', () => {
  it('triangles au-dessus du budget : échec ; budget absent : non mesurable', async () => {
    expect(find(await run({ build: { extraTriangles: 2000 } }), 'triangles')).toMatchObject({
      verdict: 'echec',
      mesure: 2180,
    })
    const none = await run({
      sheet: (raw) => {
        raw.budgets = { triangles: null, texturePx: 1024 }
      },
    })
    expect(find(none, 'triangles').verdict).toBe('non-mesurable')
  })

  it('texture au-dessus du budget : échec', async () => {
    const png = (n: number) =>
      encodePng({ width: n, height: n, channels: 3, data: new Uint8Array(n * n * 3) })
    expect(
      find(await run({ build: { image: { mime: 'image/png', bytes: png(512) } } }), 'textures').verdict,
    ).toBe('ok')
    expect(
      find(await run({ build: { image: { mime: 'image/png', bytes: png(2048) } } }), 'textures'),
    ).toMatchObject({
      verdict: 'echec',
      mesure: 2048,
    })
  })
})

describe('interruption (L7) et mort (L4, §18)', () => {
  it('un coup coupe l’attaque : la pose de la réaction est atteinte en 2 images au plus à 60 i/s', async () => {
    const c = find(await run(), 'interruption', 'attaque')
    expect(c.verdict).toBe('ok')
    expect(c.mesure).toBeLessThanOrEqual(INTERRUPT_MAX_FRAMES)
  })

  it('un fondu de 0,25 s laisse l’attaque visible trop longtemps : échec', async () => {
    const c = find(await run({ validate: { interruptFadeS: 0.25 } }), 'interruption', 'attaque')
    expect(c.verdict).toBe('echec')
  })

  it('sans clip de réaction, l’interruption n’est pas mesurable', async () => {
    const r = await run({ clips: GOOD.filter((c) => c.name !== 'reaction') })
    expect(find(r, 'interruption', 'attaque').verdict).toBe('non-mesurable')
  })

  it('figée en plein fondu, la pose ne bouge plus d’un millimètre en 10 s (horloge du mélangeur gelée)', async () => {
    const c = find(await run(), 'gel')
    expect(c.verdict).toBe('ok')
    expect(c.mesure).toBeLessThan(FREEZE_MAX_M)
  })

  it('mettre les actions en pause ne fige pas : le fondu continue de bouger la pose (piège documenté)', async () => {
    const c = find(await run({ validate: { freezeMode: 'pause' } }), 'gel')
    expect(c.verdict).toBe('echec')
    expect(c.mesure).toBeGreaterThan(FREEZE_MAX_M)
  })
})
