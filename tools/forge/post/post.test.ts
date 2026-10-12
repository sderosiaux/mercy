// Chaque post-traitement sur une figurine animée construite en code : le défaut est mesuré en échec par la
// validation avant, en succès après, sans régression ailleurs ; et ce qu'on ne mesure pas (vitesse à la couture,
// glissement entre deux images, poses de raccord) est vérifié à part.
import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bancSheetRaw } from '../banc'
import { buildFigure, type ClipDef } from '../gltf/build'
import { compactGlb } from '../gltf/compact'
import { crouchWalk, hit, idle, idleWithSeam, rise, slidingIdle, strike, walkInPlace } from '../gltf/fixtures'
import { type Glb, writeGlb } from '../gltf/glb'
import { parseAsset } from '../schema'
import { type CheckResult, footSlide, type ValidationReport, validate } from '../validate/checks'
import { boneAt, findBone, loadRig, type Pose, type Rig, sampleClip } from '../validate/rig'
import { FOOT_SLIDE_MAX_M, RATE_MAX } from '../validate/thresholds'
import { posesOf, sampleFrames, writeFrames } from './frames'
import { legOf, solveLeg } from './legs'
import { closeLoop, findLoopCut } from './loop'
import { type PostReport, postProcess, STRIDE_RATE_MARGIN } from './run'

const GOOD: readonly ClipDef[] = [
  idle('rituel'),
  walkInPlace('marche'),
  strike('attaque'),
  hit('reaction'),
  rise('relevement'),
]
const replace = (name: string, clip: ClipDef): ClipDef[] => GOOD.map((c) => (c.name === name ? clip : c))
const sheet = parseAsset(bancSheetRaw())
const load = (glb: Glb): Promise<Rig> => loadRig(glb, { hauteurM: sheet.hauteurM, stripTextures: true })
const check = async (glb: Glb): Promise<ValidationReport> => validate(sheet, glb, await load(glb))
const find = (r: ValidationReport, controle: string, clip: string): CheckResult => {
  const c = r.controles.find((x) => x.controle === controle && x.clip === clip)
  if (!c) throw new Error(`${controle} ${clip} absent`)
  return c
}
const treatmentsOf = (r: PostReport, etat: string): string[] =>
  r.clips.find((c) => c.etat === etat)?.traitements.map((t) => t.traitement) ?? []

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

// Poses à `hz` images par seconde (plus fin que la validation), la durée comprise.
const dense = (rig: Rig, name: string, hz: number): Pose[] => {
  const clip = rig.clips.find((c) => c.name === name)
  if (!clip) throw new Error(`clip ${name} absent`)
  const times: number[] = []
  for (let k = 0; k / hz < clip.duration - 1e-5; k++) times.push(k / hz)
  times.push(clip.duration)
  return sampleClip(rig, clip, times)
}

// Plus grande seconde différence d'un os (m par image²) : à-coup.
const jerk = (a: Pose, b: Pose, c: Pose): number => {
  let m = 0
  for (let i = 0; i < a.length; i += 3) {
    m = Math.max(
      m,
      Math.hypot(
        (a[i] as number) - 2 * (b[i] as number) + (c[i] as number),
        (a[i + 1] as number) - 2 * (b[i + 1] as number) + (c[i + 1] as number),
        (a[i + 2] as number) - 2 * (b[i + 2] as number) + (c[i + 2] as number),
      ),
    )
  }
  return m
}

describe('rien à corriger', () => {
  it('une figurine qui passe tout ressort sans traitement, même validation ; deux passages donnent les mêmes octets', async () => {
    const glb = buildFigure({ clips: GOOD })
    const a = await postProcess(sheet, glb)
    expect(a.report.clips.every((c) => c.traitements.length === 0)).toBe(true)
    expect(a.report.regressions).toEqual([])
    expect((await check(a.glb)).controles).toEqual((await check(glb)).controles)
    const b = await postProcess(sheet, glb)
    expect(writeGlb(b.glb)).toEqual(writeGlb(a.glb))
  })
})

describe('boucle : fermeture par fondu de pose', () => {
  it('une boucle arrêtée aux 3/4 de sa période échoue avant, passe après, sans saut de vitesse à la couture', async () => {
    const glb = buildFigure({ clips: replace('rituel', idleWithSeam('rituel')) })
    expect(find(await check(glb), 'boucle', 'rituel').verdict).toBe('echec')
    const { glb: out, report } = await postProcess(sheet, glb)
    const after = await check(out)
    expect(find(after, 'boucle', 'rituel')).toMatchObject({ verdict: 'ok' })
    expect(find(after, 'boucle', 'rituel').mesure).toBeLessThan(1e-4)
    expect(treatmentsOf(report, 'rituel')).toEqual(['boucle'])
    expect(report.regressions).toEqual([])
    // à-coup à la couture (images n−2, n−1 = 0, 1) pas plus grand que le plus grand à-coup du clip
    const p = dense(await load(out), 'rituel', 60)
    const n = p.length
    let inner = 0
    for (let k = 1; k + 1 < n; k++)
      inner = Math.max(inner, jerk(p[k - 1] as Pose, p[k] as Pose, p[k + 1] as Pose))
    expect(jerk(p[n - 2] as Pose, p[n - 1] as Pose, p[1] as Pose)).toBeLessThanOrEqual(inner * 1.05)
  })

  it('dans un clip de 1,75 période, les points de bouclage tombent sur une période entière', async () => {
    const glb = buildFigure({ clips: [idle('rituel', 3.5, 1.75)] })
    const rig = await load(glb)
    const f = sampleFrames(rig, glb, 0)
    const cut = findLoopCut(posesOf(rig, f))
    expect(cut.b - cut.a).toBe(120) // 2 s à 60 i/s
    expect(cut.cost).toBeLessThan(1e-4)
    const closed = closeLoop(f, cut.a, cut.b)
    expect(closed.times[closed.times.length - 1]).toBeCloseTo(2, 9)
  })

  it('la fermeture ne touche pas aux clips sources : nouvelles images, entrée intacte', async () => {
    const glb = buildFigure({ clips: [idleWithSeam('rituel')] })
    const rig = await load(glb)
    const f = sampleFrames(rig, glb, 0)
    const copy = f.tracks.map((t) => t.r?.slice())
    closeLoop(f, 0, f.times.length - 1)
    f.tracks.forEach((t, i) => {
      expect(t.r).toEqual(copy[i])
    })
  })
})

describe('pieds : verrouillage des appuis par cinématique inverse', () => {
  it('le bassin qui glisse traîne les pieds (échec) ; après, les pieds tiennent, la boucle reste fermée', async () => {
    const glb = buildFigure({ clips: replace('rituel', slidingIdle('rituel')) })
    expect(find(await check(glb), 'pieds', 'rituel').verdict).toBe('echec')
    const { glb: out, report } = await postProcess(sheet, glb)
    const after = await check(out)
    expect(find(after, 'pieds', 'rituel').verdict).toBe('ok')
    expect(find(after, 'boucle', 'rituel').verdict).toBe('ok')
    expect(treatmentsOf(report, 'rituel')).toEqual(['pieds'])
    expect(report.regressions).toEqual([])
    // entre deux images aussi : à 240 i/s, le glissement reste sous le seuil
    const rig = await load(out)
    const p = dense(rig, 'rituel', 240)
    for (const side of ['piedGauche', 'piedDroit'] as const)
      expect(footSlide(p, findBone(rig, side))).toBeLessThan(FOOT_SLIDE_MAX_M / 4)
  })

  it('attaque qui glisse : pieds tenus, pose de départ gardée, repère d’impact, interruption et gel inchangés', async () => {
    const base = strike('attaque')
    const sliding: ClipDef = {
      ...base,
      pose: (t) => ({ ...base.pose(t), hips: { move: [0.08 * smooth(t / base.duration), 0, 0] } }),
    }
    const glb = buildFigure({ clips: replace('attaque', sliding) })
    const before = await check(glb)
    expect(find(before, 'pieds', 'attaque').verdict).toBe('echec')
    const { glb: out, report } = await postProcess(sheet, glb)
    const after = await check(out)
    for (const c of ['pieds', 'impact', 'vitesse', 'interruption'])
      expect(find(after, c, 'attaque').verdict).toBe('ok')
    expect(find(after, 'impact', 'attaque').mesure).toBe(find(before, 'impact', 'attaque').mesure)
    expect(after.controles.find((c) => c.controle === 'gel')?.verdict).toBe('ok')
    expect(report.regressions).toEqual([])
    const r0 = await load(glb)
    const r1 = await load(out)
    const p0 = dense(r0, 'attaque', 60)
    const p1 = dense(r1, 'attaque', 60)
    const foot = findBone(r0, 'piedDroit')
    expect(boneAt(p1[0] as Pose, foot)).toEqual(boneAt(p0[0] as Pose, foot).map((x) => expect.closeTo(x, 6)))
  })

  it('un bassin qui s’éloigne trop des appuis : le bassin descend juste assez, les pieds tiennent, la boucle reste fermée', async () => {
    // balancement de ±25 cm, jambes tendues : sans abaisser le bassin, les pieds tenus sont hors d'atteinte
    const swaying: ClipDef = {
      ...slidingIdle('rituel'),
      pose: (t) => ({ hips: { move: [0.25 * Math.sin((2 * Math.PI * t) / 2), 0, 0] } }),
    }
    const glb = buildFigure({ clips: replace('rituel', swaying) })
    const { glb: out, report } = await postProcess(sheet, glb)
    const pieds = report.clips
      .find((c) => c.etat === 'rituel')
      ?.traitements.find((t) => t.traitement === 'pieds')
    expect(pieds?.apres.bassinM).toBeGreaterThan(0.005)
    expect(pieds?.apres.ecartCibleMaxM).toBeLessThan(1e-4)
    const after = await check(out)
    expect(find(after, 'pieds', 'rituel').verdict).toBe('ok')
    expect(find(after, 'boucle', 'rituel').verdict).toBe('ok')
    expect(report.regressions).toEqual([])
    const rig = await load(out)
    const p = dense(rig, 'rituel', 240)
    for (const side of ['piedGauche', 'piedDroit'] as const)
      expect(footSlide(p, findBone(rig, side))).toBeLessThan(FOOT_SLIDE_MAX_M / 4)
  })

  it('la cinématique inverse amène la cheville sur la cible et garde l’orientation du pied', async () => {
    const glb = buildFigure({ clips: [] })
    const rig = await load(glb)
    const leg = legOf(rig, findBone(rig, 'piedGauche'))
    if (!leg) throw new Error('jambe introuvable')
    rig.root.updateMatrixWorld(true)
    const q0 = leg.foot.getWorldQuaternion(new Quaternion())
    const target = leg.foot.getWorldPosition(new Vector3()).add(new Vector3(0.12, 0.05, -0.08))
    expect(solveLeg(leg, target)).toBeLessThan(1e-6)
    expect(leg.foot.getWorldQuaternion(new Quaternion()).angleTo(q0)).toBeLessThan(1e-6)
    // hors d'atteinte : la jambe s'étire au plus, l'écart restant est rendu
    expect(solveLeg(leg, target.clone().add(new Vector3(0, -2, 0)))).toBeGreaterThan(0.5)
  })
})

describe('racine : dérive d’un clip joué sur place', () => {
  it('une réaction qui recule de 40 cm finit à sa place ; ses pieds tiennent', async () => {
    const base = hit('reaction', 1)
    const drifting: ClipDef = {
      ...base,
      pose: (t) => ({ ...base.pose(t), hips: { move: [0.4 * smooth(t / base.duration), 0, 0] } }),
    }
    const glb = buildFigure({ clips: replace('reaction', drifting) })
    expect(find(await check(glb), 'pieds', 'reaction').verdict).toBe('echec')
    const { glb: out, report } = await postProcess(sheet, glb)
    expect(treatmentsOf(report, 'reaction')).toEqual(['racine', 'pieds'])
    const t = report.clips.find((c) => c.etat === 'reaction')?.traitements[0]
    expect(t?.avant.deriveMps).toBeCloseTo(0.4, 3)
    expect(t?.apres.deriveMps).toBeLessThan(1e-4)
    const after = await check(out)
    expect(find(after, 'pieds', 'reaction').verdict).toBe('ok')
    expect(find(after, 'interruption', 'attaque').verdict).toBe('ok')
    expect(report.regressions).toEqual([])
  })
})

describe('foulée : locomotion lue hors des bornes', () => {
  it('une marche genoux pliés un peu courte pour 4,5 m/s demande ×2,23 (échec) ; la foulée allongée de 24 % se lit à ×1,8', async () => {
    const glb = buildFigure({ clips: replace('marche', crouchWalk('marche', 1, 0.45)) })
    const before = find(await check(glb), 'vitesse', 'marche')
    expect(before.verdict).toBe('echec')
    expect(before.mesure).toBeGreaterThan(RATE_MAX)
    const { glb: out, report } = await postProcess(sheet, glb)
    expect(treatmentsOf(report, 'marche')).toEqual(['foulee'])
    const after = find(await check(out), 'vitesse', 'marche')
    expect(after.verdict).toBe('ok')
    expect(after.mesure).toBeCloseTo(RATE_MAX * STRIDE_RATE_MARGIN, 2)
    expect(report.regressions).toEqual([])
    expect(report.nonCorriges).toEqual([])
  })

  it('jambes tendues : le pas allongé est hors d’atteinte, le clip reste tel quel et le défaut est dit', async () => {
    const glb = buildFigure({ clips: replace('marche', walkInPlace('marche', 1, 0.4)) })
    const { glb: out, report } = await postProcess(sheet, glb)
    expect(treatmentsOf(report, 'marche')).toEqual([])
    expect(report.nonCorriges).toEqual([
      { etat: 'marche', controle: 'vitesse', raison: expect.stringMatching(/n'atteignent pas/) },
    ])
    expect(find(await check(out), 'vitesse', 'marche').verdict).toBe('echec')
  })

  it('une foulée quatre fois trop courte n’est pas étirée : il faut un autre clip, et c’est dit', async () => {
    const glb = buildFigure({ clips: replace('marche', walkInPlace('marche', 1, 0.12)) })
    const { glb: out, report } = await postProcess(sheet, glb)
    expect(treatmentsOf(report, 'marche')).toEqual([])
    expect(report.nonCorriges).toEqual([
      { etat: 'marche', controle: 'vitesse', raison: expect.stringMatching(/il faut un autre clip/) },
    ])
    expect(find(await check(out), 'vitesse', 'marche').verdict).toBe('echec')
    expect(report.echecsRestants).toContain('vitesse marche')
  })
})

describe('GLB de sortie', () => {
  it('compacté : les données des clips remplacés partent, la validation ne change pas', async () => {
    const glb = buildFigure({ clips: replace('rituel', idleWithSeam('rituel')) })
    const rig = await load(glb)
    const index = (glb.json.animations ?? []).findIndex((a) => a.name === 'rituel')
    const f = sampleFrames(rig, glb, index)
    const rewritten = writeFrames(glb, closeLoop(f, 0, f.times.length - 1))
    const compact = compactGlb(rewritten)
    expect(compact.bin.byteLength).toBeLessThan(rewritten.bin.byteLength)
    expect((await check(compact)).controles).toEqual((await check(rewritten)).controles)
    expect(compactGlb(compact)).toEqual(compact)
  })

  it('un clip relu puis réécrit sans changement donne les mêmes poses aux instants de la validation', async () => {
    const glb = buildFigure({ clips: [strike('attaque')] })
    const rig = await load(glb)
    const out = writeFrames(glb, sampleFrames(rig, glb, 0))
    const a = dense(rig, 'attaque', 60)
    const b = dense(await load(out), 'attaque', 60)
    a.forEach((p, k) => {
      ;(b[k] as Pose).forEach((x, i) => {
        expect(x).toBeCloseTo(p[i] as number, 5)
      })
    })
  })

  it('un second passage ne trouve plus rien à corriger et rend les mêmes octets', async () => {
    const glb = buildFigure({
      clips: [
        idleWithSeam('rituel'),
        walkInPlace('marche', 1, 0.4),
        strike('attaque'),
        hit('reaction'),
        rise(),
      ],
    })
    const once = await postProcess(sheet, glb)
    const twice = await postProcess(sheet, once.glb)
    expect(twice.report.clips.every((c) => c.traitements.length === 0)).toBe(true)
    expect(writeGlb(twice.glb)).toEqual(writeGlb(once.glb))
  })
})
