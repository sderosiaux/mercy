// Validation déterministe d'un modèle animé contre sa fiche. Chaque contrôle est une mesure avec un seuil écrit
// dans thresholds.ts ; ce qui ne se mesure pas (os introuvable, budget absent) est « non mesurable », jamais
// réputé bon. Aucun avis : le reste se juge à l'œil dans la galerie.
import { type AnimationAction, type AnimationClip, AnimationMixer, PropertyBinding } from 'three'
import type { Glb } from '../gltf/glb'
import { type ImageSize, textureSizes, triangleCount } from '../gltf/inspect'
import { type ClipRecipe, FRAME_S, freeze, INTERRUPT_FADE_S, interrupt, playClip } from '../playback'
import { type AssetSheet, type ClipSpec, producedClips, resolveTemps, ticksToS, tuningAt } from '../schema'
import {
  boneAt,
  findBone,
  findHips,
  frameTimes,
  maxDisplacement,
  type Pose,
  type Rig,
  readPose,
  sampleClip,
} from './rig'
import {
  FOOT_CONTACT_M,
  FOOT_SLIDE_MAX_M,
  FREEZE_FRAMES,
  FREEZE_MAX_M,
  INTERRUPT_MAX_FRAMES,
  LOOP_FLOOR_M,
  LOOP_STEP_FACTOR,
  MIN_CONTACT_FRAMES,
  PIXEL_M,
  POSE_EPS_M,
  RATE_MAX,
  RATE_MIN,
  ROOT_DRIFT_MAX_MPS,
  TREMBLE_WINDOW_FRAMES,
} from './thresholds'

export const VALIDATOR_VERSION = 1

export type Verdict = 'ok' | 'echec' | 'non-mesurable'

export interface CheckResult {
  readonly controle: string
  readonly clip?: string
  readonly verdict: Verdict
  readonly mesure?: number
  readonly seuil?: number
  readonly unite?: string
  readonly detail: string
}

export interface ClipMeasures {
  readonly etat: string
  readonly dureeS: number
  readonly recette: ClipRecipe
  readonly impactMesureS?: number | null
  readonly coutureM?: number
  readonly glissementM?: number
  readonly fouleeMps?: number
  readonly amorceS?: number | null
  readonly tremblementMinPx?: number | null
}

export interface ValidationReport {
  readonly id: string
  readonly validateur: number
  readonly echelle: {
    readonly hauteurModele: number
    readonly hauteurFiche: number | null
    readonly facteur: number
  }
  readonly triangles: number
  readonly textures: readonly ImageSize[]
  readonly os: number
  readonly controles: readonly CheckResult[]
  readonly clips: readonly ClipMeasures[]
  readonly recetteGlobale: { readonly interruptionFadeS: number; readonly mort: string }
  readonly bilan: {
    readonly ok: number
    readonly echec: number
    readonly nonMesurable: number
    readonly verdict: 'valide' | 'refuse' | 'incomplet'
  }
}

export interface ValidateOptions {
  readonly interruptFadeS?: number // pour montrer l'échec d'un fondu trop long
  readonly freezeMode?: 'horloge' | 'pause' // 'pause' : la fausse bonne idée, mesurée pour la documenter
}

export interface ClipTag {
  readonly etat: string
  readonly type: ClipSpec['type']
  readonly boucle: boolean
  readonly impactS?: number
  readonly debutS?: number
}

export const tagOf = (clip: AnimationClip): Partial<ClipTag> =>
  ((clip.userData as { mercy?: Partial<ClipTag> } | undefined)?.mercy ?? {}) as Partial<ClipTag>

export const percentile = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] as number
}

export const median = (xs: readonly number[]): number => percentile(xs, 0.5)
const horiz = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number))

export interface ContactRun {
  readonly from: number
  readonly to: number
}

// Appuis d'un pied : images où il est à moins de FOOT_CONTACT_M de son point le plus bas du clip.
export const contactRuns = (poses: readonly Pose[], bone: number): ContactRun[] => {
  const ys = poses.map((p) => boneAt(p, bone)[1])
  const minY = Math.min(...ys)
  const runs: ContactRun[] = []
  let start = -1
  ys.forEach((y, k) => {
    const on = y <= minY + FOOT_CONTACT_M
    if (on && start < 0) start = k
    if (!on && start >= 0) {
      if (k - start >= MIN_CONTACT_FRAMES) runs.push({ from: start, to: k - 1 })
      start = -1
    }
  })
  if (start >= 0 && ys.length - start >= MIN_CONTACT_FRAMES) runs.push({ from: start, to: ys.length - 1 })
  return runs
}

export const footSlide = (poses: readonly Pose[], bone: number): number => {
  let worst = 0
  for (const run of contactRuns(poses, bone)) {
    const origin = boneAt(poses[run.from] as Pose, bone)
    for (let k = run.from; k <= run.to; k++)
      worst = Math.max(worst, horiz(boneAt(poses[k] as Pose, bone), origin))
  }
  return worst
}

export const strideSpeeds = (poses: readonly Pose[], times: readonly number[], bone: number): number[] => {
  const out: number[] = []
  for (const run of contactRuns(poses, bone)) {
    for (let k = run.from; k < run.to; k++) {
      const dt = (times[k + 1] as number) - (times[k] as number)
      if (dt > 1e-6) out.push(horiz(boneAt(poses[k + 1] as Pose, bone), boneAt(poses[k] as Pose, bone)) / dt)
    }
  }
  return out
}

// Pic d'allonge de l'effecteur : l'instant où il est le plus loin devant le bassin de départ. Devant = +Z, l'avant
// d'un asset glTF (et l'orientation que Meshy exige pour le rigging).
const reachPeak = (
  poses: readonly Pose[],
  times: readonly number[],
  effector: number,
  hips: number,
): number => {
  const origin = boneAt(poses[0] as Pose, hips)
  let best = Number.NEGATIVE_INFINITY
  let at = times[0] as number
  poses.forEach((p, k) => {
    const d = boneAt(p, effector)[2] - origin[2]
    if (d > best) {
      best = d
      at = times[k] as number
    }
  })
  return at
}

// Repère d'impact mesuré pour une attaque dont la fiche ne pose pas `impactS` : pic d'allonge de son effecteur
// après `debutS`. null si l'effecteur ou le bassin est introuvable.
export const measuredImpact = (
  rig: Rig,
  sheet: AssetSheet,
  spec: ClipSpec,
  clip: AnimationClip,
): number | null => {
  if (!spec.effecteur) return null
  const eff = findBone(rig, spec.effecteur, sheet.os)
  const hips = findHips(rig)
  if (eff < 0 || hips < 0) return null
  const times = frameTimes(spec.debutS ?? 0, clip.duration)
  const at = reachPeak(sampleClip(rig, clip, times), times, eff, hips)
  return at > (spec.debutS ?? 0) && at < clip.duration ? r3(at) : null
}

// Couture d'une boucle : écart de pose entre la dernière et la première image, et son seuil (1,5 × pas p95,
// plancher ½ px).
export const loopSeam = (poses: readonly Pose[]): { readonly jump: number; readonly seuil: number } => {
  const steps: number[] = []
  for (let k = 0; k + 1 < poses.length; k++)
    steps.push(maxDisplacement(poses[k + 1] as Pose, poses[k] as Pose))
  const jump = maxDisplacement(poses[poses.length - 1] as Pose, poses[0] as Pose)
  const seuil = Math.max(LOOP_STEP_FACTOR * percentile(steps, 0.95), LOOP_FLOOR_M)
  return { jump, seuil }
}

const trembleMinPx = (poses: readonly Pose[]): number | null => {
  if (poses.length <= TREMBLE_WINDOW_FRAMES) return null
  let min = Number.POSITIVE_INFINITY
  for (let k = 0; k + TREMBLE_WINDOW_FRAMES < poses.length; k++) {
    let m = 0
    for (let j = 1; j <= TREMBLE_WINDOW_FRAMES; j++) {
      m = Math.max(m, maxDisplacement(poses[k + j] as Pose, poses[k] as Pose))
    }
    min = Math.min(min, m)
  }
  return min / PIXEL_M
}

const rateVerdict = (rate: number): Verdict => (rate >= RATE_MIN && rate <= RATE_MAX ? 'ok' : 'echec')
const r3 = (x: number): number => Math.round(x * 1000) / 1000
const mm = (m: number): string => `${(m * 1000).toFixed(1)} mm`

interface Ctx {
  readonly sheet: AssetSheet
  readonly rig: Rig
  readonly out: CheckResult[]
}

const check = (ctx: Ctx, r: CheckResult): void => {
  ctx.out.push(r)
}

// Recette d'un clip : où commencer, à quelle vitesse jouer pour caler l'impact, la fenêtre ou la foulée sur la
// simulation. Contrôle 'vitesse' quand le clip est calé.
const recipeFor = (
  ctx: Ctx,
  spec: ClipSpec,
  clip: AnimationClip,
  locomotionSpeed: number | null,
): ClipRecipe => {
  const tag = tagOf(clip)
  const startS = spec.debutS ?? tag.debutS ?? 0
  const impactS = typeof tag.impactS === 'number' ? tag.impactS : null
  const dur = clip.duration
  const temps = resolveTemps(ctx.sheet, spec)
  const base = { name: spec.etat, boucle: spec.boucle, impactS }
  const rated = (rate: number, start: number, detail: string): ClipRecipe => {
    check(ctx, {
      controle: 'vitesse',
      clip: spec.etat,
      verdict: Number.isFinite(rate) ? rateVerdict(rate) : 'echec',
      mesure: r3(rate),
      seuil: RATE_MAX,
      unite: '×',
      detail: `${detail} ; bornes ${RATE_MIN} à ${RATE_MAX}`,
    })
    return { ...base, startS: start, rate: Number.isFinite(rate) ? rate : 1 }
  }
  if (spec.type === 'attaque' && temps && temps.impactTicks !== null && impactS !== null) {
    if (temps.impactTicks > 0) {
      return rated(
        (impactS - startS) / ticksToS(temps.impactTicks),
        startS,
        `impact du clip à ${r3(impactS)} s calé sur le tick actif (${temps.impactTicks} ticks, ${temps.origine})`,
      )
    }
    // Le coup touche au tick de départ (Frappe, Balayage : src/sim/player/bourreau.ts) : rien ne peut précéder
    // l'impact à l'écran, le clip part de son repère. Il doit couvrir la fenêtre de l'action à vitesse 1, sinon
    // il se fige sur sa dernière image avant la fin de l'action.
    const after = dur - impactS
    const need = ticksToS(temps.fenetreTicks)
    check(ctx, {
      controle: 'recuperation',
      clip: spec.etat,
      verdict: after + 1e-9 >= need ? 'ok' : 'echec',
      mesure: r3(after),
      seuil: r3(need),
      unite: 's',
      detail: `anticipation sautée (impact au tick de départ, ${temps.origine}) ; ${r3(after)} s de clip après l'impact pour ${r3(need)} s d'action`,
    })
    return { ...base, startS: impactS, rate: 1 }
  }
  if (temps && !spec.boucle && temps.fenetreTicks > 0 && spec.type !== 'attaque') {
    return rated(
      (dur - startS) / ticksToS(temps.fenetreTicks),
      startS,
      `clip calé sur la fenêtre de ${temps.fenetreTicks} ticks (${temps.origine})`,
    )
  }
  if (spec.locomotion && locomotionSpeed !== null) {
    const vSim = tuningAt(spec.locomotion.vitesse) ?? Number.NaN
    return rated(
      vSim / locomotionSpeed,
      startS,
      `foulée du clip ${r3(locomotionSpeed)} m/s calée sur ${vSim} m/s (${spec.locomotion.vitesse})`,
    )
  }
  return { ...base, startS, rate: 1 }
}

const measureClip = (ctx: Ctx, spec: ClipSpec, clip: AnimationClip): ClipMeasures => {
  const { rig, sheet } = ctx
  const dur = clip.duration
  const tag = tagOf(clip)
  const tagOk = tag.etat === spec.etat && tag.boucle === spec.boucle && tag.type === spec.type
  check(ctx, {
    controle: 'clip',
    clip: spec.etat,
    verdict: tagOk ? 'ok' : 'echec',
    detail: tagOk
      ? 'présent et étiqueté'
      : `étiquette ${JSON.stringify(tag)} ≠ fiche (${spec.type}, boucle ${spec.boucle})`,
  })
  const durOk = Number.isFinite(dur) && dur > 0 && (spec.debutS ?? 0) < dur
  check(ctx, {
    controle: 'duree',
    clip: spec.etat,
    verdict: durOk ? 'ok' : 'echec',
    mesure: r3(dur),
    unite: 's',
    detail: durOk ? `${r3(dur)} s` : 'durée nulle, non finie, ou début au-delà de la fin',
  })
  const times = frameTimes(0, dur)
  const poses = sampleClip(rig, clip, times)
  const hips = findHips(rig)
  const feet = [findBone(rig, 'piedGauche', sheet.os), findBone(rig, 'piedDroit', sheet.os)].filter(
    (b) => b >= 0,
  )
  const m: { -readonly [K in keyof ClipMeasures]?: ClipMeasures[K] } = {}

  if (spec.type === 'attaque') {
    const impactS = tag.impactS
    const start = spec.debutS ?? tag.debutS ?? 0
    const inClip = typeof impactS === 'number' && impactS > start && impactS < dur
    check(ctx, {
      controle: 'impact',
      clip: spec.etat,
      verdict: inClip ? 'ok' : 'echec',
      ...(typeof impactS === 'number' ? { mesure: r3(impactS) } : {}),
      unite: 's',
      detail: inClip
        ? `repère d'impact à ${r3(impactS as number)} s dans [${r3(start)} ; ${r3(dur)}]`
        : `repère d'impact ${typeof impactS === 'number' ? `hors du clip (${r3(impactS)} s)` : 'absent'}`,
    })
    const eff = spec.effecteur ? findBone(rig, spec.effecteur, sheet.os) : -1
    m.impactMesureS = eff >= 0 && hips >= 0 ? r3(reachPeak(poses, times, eff, hips)) : null
  }

  if (spec.boucle) {
    const { jump, seuil } = loopSeam(poses)
    m.coutureM = r3(jump)
    check(ctx, {
      controle: 'boucle',
      clip: spec.etat,
      verdict: jump <= seuil ? 'ok' : 'echec',
      mesure: r3(jump),
      seuil: r3(seuil),
      unite: 'm',
      detail: `écart dernière/première image ${mm(jump)}, seuil ${mm(seuil)} (1,5 × pas p95, plancher ½ px)`,
    })
    m.tremblementMinPx = (() => {
      const t = trembleMinPx(poses)
      return t === null ? null : r3(t)
    })()
  }

  if (spec.surPlace) {
    if (feet.length === 0) {
      check(ctx, {
        controle: 'pieds',
        clip: spec.etat,
        verdict: 'non-mesurable',
        detail: 'os des pieds introuvables',
      })
    } else {
      const slide = Math.max(...feet.map((f) => footSlide(poses, f)))
      m.glissementM = r3(slide)
      check(ctx, {
        controle: 'pieds',
        clip: spec.etat,
        verdict: slide <= FOOT_SLIDE_MAX_M ? 'ok' : 'echec',
        mesure: r3(slide),
        seuil: r3(FOOT_SLIDE_MAX_M),
        unite: 'm',
        detail: `glissement d'un pied en appui ${mm(slide)}, seuil ${mm(FOOT_SLIDE_MAX_M)} (2 px)`,
      })
    }
  }

  let locomotionSpeed: number | null = null
  if (spec.locomotion) {
    const speeds = feet.flatMap((f) => strideSpeeds(poses, times, f))
    const drift =
      hips >= 0
        ? horiz(boneAt(poses[poses.length - 1] as Pose, hips), boneAt(poses[0] as Pose, hips)) /
          Math.max(dur, 1e-6)
        : Number.NaN
    if (feet.length === 0 || speeds.length === 0 || !Number.isFinite(drift)) {
      check(ctx, {
        controle: 'sur-place',
        clip: spec.etat,
        verdict: 'non-mesurable',
        detail: feet.length === 0 ? 'os des pieds introuvables' : 'aucun appui de pied mesurable',
      })
    } else {
      locomotionSpeed = median(speeds)
      m.fouleeMps = r3(locomotionSpeed)
      check(ctx, {
        controle: 'sur-place',
        clip: spec.etat,
        verdict: drift <= ROOT_DRIFT_MAX_MPS ? 'ok' : 'echec',
        mesure: r3(drift),
        seuil: ROOT_DRIFT_MAX_MPS,
        unite: 'm/s',
        detail: `dérive du bassin ${r3(drift)} m/s : la simulation déplace déjà la créature`,
      })
    }
  }

  if (spec.type === 'reaction') {
    const k = poses.findIndex((p) => maxDisplacement(p, poses[0] as Pose) >= PIXEL_M)
    m.amorceS = k < 0 ? null : r3(times[k] as number)
  }

  const recette = recipeFor(ctx, spec, clip, locomotionSpeed)
  return { etat: spec.etat, dureeS: r3(dur), recette, ...m }
}

const recipeOf = (measures: readonly ClipMeasures[], etat: string): ClipRecipe | undefined =>
  measures.find((x) => x.etat === etat)?.recette

// Interruption simulée : l'attaque (ou la canalisation) est jouée jusqu'au milieu de son télégraphe, un coup la
// coupe (recette `interrupt`), on compte les images à 60 i/s avant que la pose soit celle de la réaction seule.
const interruption = (
  ctx: Ctx,
  spec: ClipSpec,
  clip: AnimationClip,
  reaction: AnimationClip,
  measures: readonly ClipMeasures[],
  fadeS: number,
): void => {
  const { rig } = ctx
  const rec = recipeOf(measures, spec.etat)
  const recR = recipeOf(measures, reaction.name)
  if (!rec || !recR) return
  const end = rec.impactS ?? clip.duration
  const hitAt = rec.startS + (end - rec.startS) / 2
  const frames = INTERRUPT_MAX_FRAMES + 4
  const refTimes = Array.from({ length: frames + 1 }, (_, n) =>
    Math.min(recR.startS + n * FRAME_S * recR.rate, reaction.duration),
  )
  const ref = sampleClip(rig, reaction, refTimes)
  const mixer = new AnimationMixer(rig.root)
  const a = playClip(mixer.clipAction(clip), { ...rec, startS: hitAt })
  mixer.update(0)
  interrupt(a, mixer.clipAction(reaction), recR, fadeS)
  let switched = -1
  let last = 0
  for (let n = 1; n <= frames; n++) {
    mixer.update(FRAME_S)
    last = maxDisplacement(readPose(rig), ref[n] as Pose)
    if (last <= POSE_EPS_M) {
      switched = n
      break
    }
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(rig.root)
  check(ctx, {
    controle: 'interruption',
    clip: spec.etat,
    verdict: switched > 0 && switched <= INTERRUPT_MAX_FRAMES ? 'ok' : 'echec',
    ...(switched > 0 ? { mesure: switched } : {}),
    seuil: INTERRUPT_MAX_FRAMES,
    unite: 'images',
    detail:
      switched > 0
        ? `coupé à ${r3(hitAt)} s, pose de ${reaction.name} atteinte en ${switched} image(s) à 60 i/s`
        : `pose de ${reaction.name} non atteinte après ${frames} images (écart ${mm(last)})`,
  })
}

// Mort : on coupe un clip en plein fondu (le pire cas), on fige, et on avance 10 s.
const frozen = (
  ctx: Ctx,
  clip: AnimationClip,
  reaction: AnimationClip | null,
  measures: readonly ClipMeasures[],
  mode: 'horloge' | 'pause',
): void => {
  const { rig } = ctx
  const rec = recipeOf(measures, clip.name) ?? {
    name: clip.name,
    boucle: false,
    startS: 0,
    rate: 1,
    impactS: null,
  }
  const mixer = new AnimationMixer(rig.root)
  const a = playClip(mixer.clipAction(clip), {
    ...rec,
    startS: rec.startS + (clip.duration - rec.startS) / 3,
  })
  mixer.update(0)
  const actions: AnimationAction[] = [a]
  const recR = reaction ? recipeOf(measures, reaction.name) : undefined
  if (reaction && recR) actions.push(interrupt(a, mixer.clipAction(reaction), recR, 0.25))
  mixer.update(FRAME_S)
  if (mode === 'horloge') freeze(mixer)
  else for (const x of actions) x.paused = true
  const p0 = readPose(rig)
  let worst = 0
  for (let k = 0; k < FREEZE_FRAMES; k++) {
    mixer.update(FRAME_S)
    worst = Math.max(worst, maxDisplacement(readPose(rig), p0))
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(rig.root)
  check(ctx, {
    controle: 'gel',
    clip: clip.name,
    verdict: worst < FREEZE_MAX_M ? 'ok' : 'echec',
    mesure: worst,
    seuil: FREEZE_MAX_M,
    unite: 'm',
    detail: `figé en plein fondu${reaction ? ` vers ${reaction.name}` : ''} (${mode === 'horloge' ? 'horloge du mélangeur gelée' : 'actions en pause'}), déplacement maximal sur ${FREEZE_FRAMES} images : ${mm(worst)}`,
  })
}

export const validate = (
  sheet: AssetSheet,
  glb: Glb,
  rig: Rig,
  opts: ValidateOptions = {},
): ValidationReport => {
  const out: CheckResult[] = []
  const ctx: Ctx = { sheet, rig, out }

  const skeletonOk = rig.bones.length >= 2 && rig.skinned.length >= 1
  check(ctx, {
    controle: 'squelette',
    verdict: skeletonOk ? 'ok' : 'echec',
    mesure: rig.bones.length,
    unite: 'os',
    detail: `${rig.bones.length} os, ${rig.skinned.length} maillage(s) skinné(s)`,
  })
  const unbound: string[] = []
  for (const clip of rig.clips) {
    for (const track of clip.tracks) {
      const { nodeName } = PropertyBinding.parseTrackName(track.name)
      if (!PropertyBinding.findNode(rig.root, nodeName)) unbound.push(`${clip.name}:${nodeName}`)
    }
  }
  check(ctx, {
    controle: 'pistes',
    verdict: unbound.length === 0 ? 'ok' : 'echec',
    mesure: unbound.length,
    detail:
      unbound.length === 0
        ? 'toutes les pistes visent un nœud du modèle'
        : `pistes orphelines : ${unbound.slice(0, 5).join(', ')}`,
  })

  const triangles = triangleCount(glb)
  const tb = sheet.budgets.triangles
  check(ctx, {
    controle: 'triangles',
    verdict: tb === null ? 'non-mesurable' : triangles <= tb ? 'ok' : 'echec',
    mesure: triangles,
    ...(tb === null ? {} : { seuil: tb }),
    detail:
      tb === null
        ? `${triangles} triangles ; budget absent de la fiche (requête F1)`
        : `${triangles} triangles pour ${tb}`,
  })
  const tex = textureSizes(glb)
  const xb = sheet.budgets.texturePx
  const biggest = Math.max(0, ...tex.sizes.map((s) => Math.max(s.width, s.height)))
  check(ctx, {
    controle: 'textures',
    verdict: tex.unreadable.length > 0 || xb === null ? 'non-mesurable' : biggest <= xb ? 'ok' : 'echec',
    mesure: biggest,
    ...(xb === null ? {} : { seuil: xb }),
    unite: 'px',
    detail:
      tex.unreadable.length > 0
        ? tex.unreadable.join(' ; ')
        : `${tex.sizes.length} texture(s), plus grand côté ${biggest} px${xb === null ? ' ; budget absent de la fiche (requête F1)' : ''}`,
  })

  const measures: ClipMeasures[] = []
  const present = new Map<string, AnimationClip>()
  for (const spec of producedClips(sheet)) {
    const clip = rig.clips.find((c) => c.name === spec.etat)
    if (!clip) {
      check(ctx, { controle: 'clip', clip: spec.etat, verdict: 'echec', detail: 'clip absent du modèle' })
      continue
    }
    present.set(spec.etat, clip)
    measures.push(measureClip(ctx, spec, clip))
  }

  const reactionName = sheet.interruption?.reaction
  const reaction = reactionName ? (present.get(reactionName) ?? null) : null
  const fadeS = opts.interruptFadeS ?? INTERRUPT_FADE_S
  if (sheet.interruption) {
    for (const spec of producedClips(sheet)) {
      if (spec.type !== 'attaque' && spec.type !== 'canalisation') continue
      const clip = present.get(spec.etat)
      if (!clip) continue
      if (!reaction) {
        check(ctx, {
          controle: 'interruption',
          clip: spec.etat,
          verdict: 'non-mesurable',
          detail: `clip de réaction ${reactionName} absent`,
        })
        continue
      }
      interruption(ctx, spec, clip, reaction, measures, fadeS)
    }
  }

  const firstAttack = producedClips(sheet).find((s) => s.type === 'attaque' && present.has(s.etat))
  const gelClip = (firstAttack && present.get(firstAttack.etat)) ?? present.values().next().value
  if (gelClip) frozen(ctx, gelClip, reaction, measures, opts.freezeMode ?? 'horloge')
  else check(ctx, { controle: 'gel', verdict: 'non-mesurable', detail: 'aucun clip à figer' })

  const count = (v: Verdict): number => out.filter((r) => r.verdict === v).length
  const echec = count('echec')
  const nonMesurable = count('non-mesurable')
  return {
    id: sheet.id,
    validateur: VALIDATOR_VERSION,
    echelle: { hauteurModele: r3(rig.restHeight), hauteurFiche: sheet.hauteurM, facteur: r3(rig.scale) },
    triangles,
    textures: tex.sizes,
    os: rig.bones.length,
    controles: out,
    clips: measures,
    recetteGlobale: {
      interruptionFadeS: r3(fadeS),
      mort: 'mixer.timeScale = 0 (horloge du mélangeur gelée)',
    },
    bilan: {
      ok: count('ok'),
      echec,
      nonMesurable,
      verdict: echec > 0 ? 'refuse' : nonMesurable > 0 ? 'incomplet' : 'valide',
    },
  }
}
