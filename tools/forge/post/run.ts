// Post-traitements d'un GLB assemblé. Chaque clip produit est mesuré avec les fonctions mêmes de la validation et
// ne reçoit un traitement que si la mesure correspondante dépasse le seuil de la validation, jamais un autre :
//   1. racine : clip sur place dont le bassin dérive (critère du contrôle « sur-place ») ;
//   2. boucle : couture plus grande que le seuil de boucle ;
//   3. foulée : locomotion qu'il faudrait lire hors des bornes de vitesse ; puis boucle encore si elle s'est rouverte ;
//   4. pieds : clip sur place dont un pied glisse en appui (vient en dernier : les étapes d'avant bougent les pieds).
// Un traitement qui changerait trop le geste (foulée au-delà de STRIDE_MAX_FACTOR) ou que les jambes ne peuvent pas
// tenir n'est pas appliqué en force : le défaut reste, et il est dit (nonCorriges).
// Le GLB d'entrée n'est pas modifié. La validation complète est refaite avant et après : tout contrôle qui passait
// avant et échoue après est une régression, consignée dans le rapport.
import { compactGlb } from '../gltf/compact'
import type { Glb } from '../gltf/glb'
import { type AssetSheet, type ClipSpec, producedClips, tuningAt } from '../schema'
import {
  type ClipMeasures,
  footSlide,
  loopSeam,
  median,
  strideSpeeds,
  type ValidationReport,
  validate,
} from '../validate/checks'
import { findBone, findHips, loadRig, type Rig } from '../validate/rig'
import { FOOT_SLIDE_MAX_M, RATE_MAX, RATE_MIN, ROOT_DRIFT_MAX_MPS } from '../validate/thresholds'
import { type ClipFrames, posesOf, sampleFrames, writeFrames } from './frames'
import { type Leg, legOf, lockFeet, scaleStride } from './legs'
import { closeLoop, findLoopCut } from './loop'
import { rootDrift, stripDrift } from './root'

export const POST_VERSION = 1

// Une foulée hors bornes est ramenée à 90 % de la borne franchie (×1,8 au lieu de ×2) : assez près pour changer
// le geste le moins possible, assez loin pour qu'un arrondi de mesure ne le refasse pas basculer.
export const STRIDE_RATE_MARGIN = 0.9
// Allonger (ou raccourcir) la foulée d'un quart au plus : la forme du pas reste celle du geste capturé. Au-delà,
// comme pour une vitesse de lecture hors bornes, c'est un autre clip qu'il faut, pas un étirement : on ne
// corrige pas, on le dit.
export const STRIDE_MAX_FACTOR = 1.25

export type TreatmentKind = 'racine' | 'boucle' | 'foulee' | 'pieds'

export interface Treatment {
  readonly traitement: TreatmentKind
  readonly detail: string
  readonly avant: Readonly<Record<string, number>>
  readonly apres: Readonly<Record<string, number>>
}

export interface ClipPost {
  readonly etat: string
  readonly traitements: readonly Treatment[]
}

type Bilan = ValidationReport['bilan']

export interface PostReport {
  readonly version: number
  readonly clips: readonly ClipPost[]
  readonly clipsAvant: readonly ClipMeasures[] // mesures et recettes de lecture des clips bruts (galerie : « avant »)
  readonly avant: Bilan
  readonly apres: Bilan
  readonly regressions: readonly string[] // contrôles « ok » avant, en échec après
  readonly echecsRestants: readonly string[]
  readonly nonCorriges: readonly NotFixed[] // défauts qu'un post-traitement local ne corrige pas, et pourquoi
}

export interface NotFixed {
  readonly etat: string
  readonly controle: string
  readonly raison: string
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000
const mm = (m: number): string => `${(m * 1000).toFixed(1)} mm`
const duration = (f: ClipFrames): number => f.times[f.times.length - 1] as number

interface Measures {
  readonly seam: { readonly jump: number; readonly seuil: number }
  readonly slide: number | null
  readonly stride: number | null
  readonly rate: number | null
  readonly drift: number | null
}

interface Ctx {
  readonly rig: Rig
  readonly spec: ClipSpec
  readonly legs: readonly Leg[]
  readonly hips: number
}

const measure = (c: Ctx, f: ClipFrames): Measures => {
  const poses = posesOf(c.rig, f)
  const times = Array.from(f.times)
  const slide = c.legs.length > 0 ? Math.max(...c.legs.map((l) => footSlide(poses, l.bone))) : null
  const speeds = c.legs.flatMap((l) => strideSpeeds(poses, times, l.bone))
  const stride = speeds.length > 0 ? median(speeds) : null
  const vSim = c.spec.locomotion ? tuningAt(c.spec.locomotion.vitesse) : undefined
  return {
    seam: loopSeam(poses),
    slide,
    stride,
    rate: stride !== null && vSim !== undefined ? vSim / stride : null,
    drift: c.hips >= 0 ? rootDrift(poses, c.hips, duration(f)) : null,
  }
}

const treatClip = (
  c: Ctx,
  glb: Glb,
  index: number,
): { frames: ClipFrames | null; traitements: Treatment[]; nonCorriges: NotFixed[] } => {
  const { rig, spec, legs } = c
  let f = sampleFrames(rig, glb, index)
  let m = measure(c, f)
  const traitements: Treatment[] = []
  const nonCorriges: NotFixed[] = []

  if (spec.surPlace && m.drift !== null && m.drift > ROOT_DRIFT_MAX_MPS) {
    const before = m
    const hipsObject = rig.bones[c.hips]
    if (hipsObject) {
      f = stripDrift(rig, f, hipsObject, posesOf(rig, f), c.hips)
      m = measure(c, f)
      traitements.push({
        traitement: 'racine',
        detail: `dérive horizontale nette du bassin retirée (tendance linéaire) : ${mm((before.drift as number) * duration(f))} sur ${r4(duration(f))} s`,
        avant: { deriveMps: r4(before.drift as number), seuilMps: ROOT_DRIFT_MAX_MPS },
        apres: { deriveMps: r4(m.drift ?? Number.NaN) },
      })
    }
  }

  const close = (search: boolean): void => {
    const before = m
    const d0 = duration(f)
    const last = f.times.length - 1
    const cut = search ? findLoopCut(posesOf(rig, f)) : { a: 0, b: last, cost: before.seam.jump }
    const from = f.times[cut.a] as number
    const to = f.times[cut.b] as number
    f = closeLoop(f, cut.a, cut.b)
    m = measure(c, f)
    traitements.push({
      traitement: 'boucle',
      detail:
        cut.a === 0 && cut.b === last
          ? `écart de couture de ${mm(before.seam.jump)} réparti sur tout le clip`
          : `portion ${r4(from)}–${r4(to)} s gardée sur ${r4(d0)} s (coupe la moins coûteuse par image : ${mm(cut.cost)} sur ${cut.b - cut.a} images), écart restant réparti sur la portion`,
      avant: { coutureM: r4(before.seam.jump), seuilM: r4(before.seam.seuil), dureeS: r4(d0) },
      apres: {
        coutureM: r4(m.seam.jump),
        seuilM: r4(m.seam.seuil),
        dureeS: r4(duration(f)),
        debutS: r4(from),
      },
    })
  }
  const seamFails = (): boolean => m.seam.jump > m.seam.seuil

  if (spec.boucle && seamFails()) close(true)

  if (spec.locomotion && m.rate !== null && m.stride !== null && (m.rate > RATE_MAX || m.rate < RATE_MIN)) {
    const before = m
    const target = m.rate > RATE_MAX ? RATE_MAX * STRIDE_RATE_MARGIN : RATE_MIN / STRIDE_RATE_MARGIN
    const factor = m.rate / target
    if (factor > STRIDE_MAX_FACTOR || factor < 1 / STRIDE_MAX_FACTOR) {
      nonCorriges.push({
        etat: spec.etat,
        controle: 'vitesse',
        raison: `foulée à mettre à l'échelle ×${r4(factor)} pour une lecture à ×${r4(target)} : au-delà de ×${STRIDE_MAX_FACTOR}, il faut un autre clip`,
      })
    } else {
      const res = scaleStride(rig, f, legs, factor)
      const after = measure(c, res.frames)
      const reached = res.maxErrorM <= FOOT_SLIDE_MAX_M
      const inBounds = after.rate !== null && after.rate <= RATE_MAX && after.rate >= RATE_MIN
      if (reached && inBounds) {
        f = res.frames
        m = after
        traitements.push({
          traitement: 'foulee',
          detail: `amplitude horizontale des pieds ×${r4(factor)} autour de leur position moyenne (vitesse de lecture visée ×${r4(target)})`,
          avant: { fouleeMps: r4(before.stride as number), vitesse: r4(before.rate as number) },
          apres: {
            fouleeMps: r4(m.stride ?? Number.NaN),
            vitesse: r4(m.rate ?? Number.NaN),
            correctionMaxM: r4(res.maxCorrectionM),
            ecartCibleMaxM: r4(res.maxErrorM),
          },
        })
        if (spec.boucle && seamFails()) close(false)
      } else {
        nonCorriges.push({
          etat: spec.etat,
          controle: 'vitesse',
          raison: reached
            ? `foulée ×${r4(factor)} : vitesse de lecture encore à ×${r4(after.rate ?? Number.NaN)}`
            : `foulée ×${r4(factor)} : les jambes n'atteignent pas (écart ${mm(res.maxErrorM)}, plus de 2 px)`,
        })
      }
    }
  }

  if (spec.surPlace && m.slide !== null && m.slide > FOOT_SLIDE_MAX_M) {
    const before = m
    const res = lockFeet(rig, f, legs, spec.boucle)
    f = res.frames
    m = measure(c, f)
    traitements.push({
      traitement: 'pieds',
      detail:
        `${res.appuis} appui(s) tenus par cinématique inverse (cuisse, tibia), pied gardé dans son orientation` +
        (res.bassinM > 0
          ? ` ; bassin abaissé de ${mm(res.bassinM)} au plus là où la jambe n'atteignait pas`
          : ''),
      avant: {
        glissementM: r4(before.slide as number),
        ...(spec.boucle ? { coutureM: r4(before.seam.jump) } : {}),
      },
      apres: {
        glissementM: r4(m.slide ?? Number.NaN),
        ...(spec.boucle ? { coutureM: r4(m.seam.jump) } : {}),
        correctionMaxM: r4(res.maxCorrectionM),
        ecartCibleMaxM: r4(res.maxErrorM),
        bassinM: r4(res.bassinM),
      },
    })
    if (m.slide !== null && m.slide > FOOT_SLIDE_MAX_M) {
      nonCorriges.push({
        etat: spec.etat,
        controle: 'pieds',
        raison: `appuis tenus mais les jambes n'atteignent pas tous leurs points fixes (écart ${mm(res.maxErrorM)})`,
      })
    }
  }
  return { frames: traitements.length > 0 ? f : null, traitements, nonCorriges }
}

const key = (c: { controle: string; clip?: string }): string => `${c.controle}${c.clip ? ` ${c.clip}` : ''}`

export const postProcess = async (sheet: AssetSheet, glb: Glb): Promise<{ glb: Glb; report: PostReport }> => {
  const rig = await loadRig(glb, { hauteurM: sheet.hauteurM, stripTextures: true })
  const before = validate(sheet, glb, rig)
  const legs = [findBone(rig, 'piedGauche', sheet.os), findBone(rig, 'piedDroit', sheet.os)]
    .filter((b) => b >= 0)
    .map((b) => legOf(rig, b))
    .filter((l): l is Leg => l !== null)
  const hips = findHips(rig)
  let out = glb
  const clips: ClipPost[] = []
  const nonCorriges: NotFixed[] = []
  for (const spec of producedClips(sheet)) {
    const index = (glb.json.animations ?? []).findIndex((a) => a.name === spec.etat)
    if (index < 0) continue
    const r = treatClip({ rig, spec, legs, hips }, glb, index)
    if (r.frames) out = writeFrames(out, r.frames)
    clips.push({ etat: spec.etat, traitements: r.traitements })
    nonCorriges.push(...r.nonCorriges)
  }
  out = compactGlb(out)
  const after = validate(sheet, out, await loadRig(out, { hauteurM: sheet.hauteurM, stripTextures: true }))
  const okBefore = new Set(before.controles.filter((c) => c.verdict === 'ok').map(key))
  return {
    glb: out,
    report: {
      version: POST_VERSION,
      clips,
      clipsAvant: before.clips,
      avant: before.bilan,
      apres: after.bilan,
      regressions: after.controles.filter((c) => c.verdict !== 'ok' && okBefore.has(key(c))).map(key),
      echecsRestants: after.controles.filter((c) => c.verdict !== 'ok').map(key),
      nonCorriges,
    },
  }
}
