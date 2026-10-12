// Machine d'états d'animation : état de simulation → clips de la Forge, avec la recette du manifeste. Pure : la pose
// d'une image est une fonction de la mémoire (memory.ts), du catalogue du modèle et de l'horloge de rendu t (ticks).
//
// Contrats tenus ici :
// - une attaque frappe au tick où la simulation frappe : le repère d'impact du clip tombe au tick actif de l'action
//   (vitesse calée sur le télégraphe de la simulation, impactRate) ;
// - touchée, une créature debout réagit dans les 2 images (fondu de la recette d'interruption) ; un coup qui ne
//   l'interrompt pas (grande créature) donne une réaction partielle, l'attaque continue et frappe à son tick ;
// - morte, elle agonise (TUNING.agonie) : elle s'effondre ou a un dernier spasme, puis plus rien (agonyFrame) ;
// - tout ce qui vit tremble (gain du tremblement procédural, nul à la mort).
import { type Creature, TICK_HZ, TUNING } from '../../sim/index'
import { BASE_FADE_TICKS, type BaseKey, cutsWindup, odometerAt, type Segment, type Track } from './memory'
import {
  type ClipRecipe,
  clipTimeAt,
  FRAME_S,
  fadeWeightAt,
  INTERRUPT_FADE_FRAMES,
  impactRate,
  windupRecipe,
} from './playback'

export interface ClipInfo {
  readonly recipe: ClipRecipe
  readonly duration: number // s
  readonly settleS?: number // chute : instant où le corps touche le sol (bassin à 95 % de sa descente)
  readonly descentS?: number // chute : instant où le corps commence à tomber (bassin à 5 % de sa descente)
}

// Chute (L1, L2) : pour la simulation, le corps est à terre dès le coup ; à l'écran, il doit toucher le sol à la fin
// du halètement (0,5 s, TUNING.criDelai), quand le cri commence. Les chutes de la Forge mettent 0,9 à 2,7 s à toucher
// le sol : on les accélère (au plus × 2, la borne de vitesse de la validation de la Forge) et, s'il le faut encore, on
// en saute le début.
export const FALL_RATE_MAX = 2
export const fallRecipe = (info: ClipInfo): { startS: number; rate: number } => {
  const win = TUNING.criDelai / TICK_HZ
  const settle = info.settleS ?? info.duration
  const span = settle - info.recipe.startS
  if (span <= 0 || win <= 0) return { startS: info.recipe.startS, rate: info.recipe.rate }
  const rate = Math.min(FALL_RATE_MAX, span / win)
  return { startS: Math.max(info.recipe.startS, settle - rate * win), rate }
}
export type Catalog = ReadonlyMap<string, ClipInfo>

export interface Layer {
  readonly clip: string
  readonly time: number // s, dans le clip
  readonly weight: number
}

export interface AnimFrame {
  readonly layers: readonly Layer[] // poids de somme 1
  readonly tremble: number // gain du tremblement procédural
  readonly headYaw: number // pivot de tête procédural (rad), relatif au corps
}

// Réaction (forme, E2) : pleine en 2 images, tenue 12 ticks (0,2 s), puis 8 ticks de retour à l'état de base ;
// coupée dès qu'une nouvelle action commence. Un coup qui n'interrompt pas pèse 40 %.
export const REACTION_HOLD_TICKS = 12
export const REACTION_FADE_TICKS = 8
export const REACTION_PARTIAL = 0.4
// Soubresaut d'un corps à terre touché (clang, coup sur un Abattu) : tremblement × 4, qui retombe en 0,25 s.
export const JOLT_GAIN = 4
export const JOLT_TICKS = 15

const sec = (ticks: number): number => ticks / TICK_HZ

// Phase pseudo-aléatoire stable d'un corps, dans [0, 1) (aucun tirage, aucune horloge).
export const phase01 = (id: number, k: number): number => {
  const s = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453
  return s - Math.floor(s)
}

const kebab = (s: string): string => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

// Clips de Rituel par famille, dans l'ordre du manifeste : un groupe en prend un, choisi par son numéro.
const ritualClips = (catalog: Catalog): string[] => [...catalog.keys()].filter((n) => n.startsWith('rituel.'))

// Vitesse de référence (m/s) d'un clip de locomotion : celle sur laquelle la Forge a calé sa vitesse de lecture.
export const locomotionSpeed = (family: string, clip: string): number => {
  if (clip === 'abattu.reptation') return TUNING.abattuCrawl
  if (clip === 'marche.stade3') return TUNING.porteur.speedStage3
  if (family === 'bourreau') return TUNING.playerSpeed
  const f = (TUNING as unknown as Record<string, { speed?: number } | undefined>)[family]
  return f?.speed ?? 1
}

export interface MachineInput {
  readonly family: string // famille de la simulation, ou 'bourreau'
  readonly id: number
  readonly catalog: Catalog
  readonly track: Track | undefined
  readonly t: number // horloge de rendu (ticks)
  readonly groupPhase: number // phase partagée du groupe de Rituel, [0, 1)
  readonly group: number | null
  readonly alertedAt: number | null
  readonly toPlayer: number // angle vers le joueur moins l'orientation du corps (rad)
}

// Premier clip présent parmi des candidats ; à défaut, un clip de repli connu du catalogue.
export const pick = (catalog: Catalog, ...names: string[]): string | null => {
  for (const n of names) if (catalog.has(n)) return n
  return null
}

const loopTime = (info: ClipInfo, seconds: number, phase: number): number => {
  const d = info.duration
  if (d <= 0) return 0
  const raw = info.recipe.startS + phase * d + seconds * info.recipe.rate
  const r = raw % d
  return r < 0 ? r + d : r
}

const once = (info: ClipInfo, seconds: number, rate = info.recipe.rate): number =>
  clipTimeAt({ ...info.recipe, rate }, info.duration, seconds, true)

// Vitesse qui fait durer la lecture de startS à la fin du clip exactement `ticks` ticks (fenêtre de la simulation).
const windowRate = (info: ClipInfo, ticks: number): number => {
  const span = info.duration - info.recipe.startS
  return ticks > 0 && span > 0 ? span / (ticks * FRAME_S) : info.recipe.rate
}

const single = (clip: string | null, time: number): Layer[] => (clip ? [{ clip, time, weight: 1 }] : [])

const blend = (a: Layer[], b: Layer[], w: number): Layer[] => {
  if (w >= 1 || a.length === 0) return b
  if (w <= 0 || b.length === 0) return a
  return [
    ...a.map((l) => ({ ...l, weight: l.weight * (1 - w) })),
    ...b.map((l) => ({ ...l, weight: l.weight * w })),
  ]
}

const locoClip = (inp: MachineInput, variant: 'normal' | 'stade3' | 'recul'): string | null => {
  const c = inp.catalog
  const base = pick(c, 'course', 'marche')
  if (variant === 'stade3') return pick(c, 'marche.stade3') ?? base
  if (variant === 'recul') return pick(c, 'marche.recul') ?? base
  return base
}

const locomotion = (inp: MachineInput, clip: string | null, t: number): Layer[] => {
  if (!clip) return []
  const info = inp.catalog.get(clip) as ClipInfo
  const odo = inp.track ? odometerAt(inp.track, t) : 0
  // Le clip avance avec le chemin parcouru : à la vitesse de référence, à la vitesse de lecture du manifeste.
  const seconds = odo / locomotionSpeed(inp.family, clip)
  return single(clip, loopTime(info, seconds, phase01(inp.id, 3)))
}

// Pose d'un état de base à l'instant t (ticks).
const evalKey = (inp: MachineInput, key: BaseKey, t: number): Layer[] => {
  const c = inp.catalog
  switch (key.kind) {
    case 'rituel': {
      const list = ritualClips(c)
      const name = list.length ? (list[(inp.group ?? inp.id) % list.length] as string) : null
      if (!name) return locomotion(inp, locoClip(inp, 'normal'), t)
      // Synchronie du Rituel (§18) : même clip, même phase pour tout le groupe.
      return single(name, loopTime(c.get(name) as ClipInfo, sec(t), inp.groupPhase))
    }
    case 'loco':
      return locomotion(inp, locoClip(inp, key.variant), t)
    case 'attack': {
      const name = pick(c, `attaque.${kebab(key.name)}`, `attaque.${key.name}`)
      if (!name) return locomotion(inp, locoClip(inp, 'normal'), t)
      const info = c.get(name) as ClipInfo
      // Le repère d'impact tombe au tick actif (télégraphe de la simulation).
      const rate = impactRate(info.recipe, key.activeAt - key.start)
      return single(name, once(info, sec(t - key.start), rate))
    }
    case 'channel': {
      const name = key.down
        ? pick(c, `canalisation.${key.name}-abattu`, 'abattu.torsion')
        : pick(c, `canalisation.${key.name}`)
      if (!name) return locomotion(inp, locoClip(inp, 'normal'), t)
      return single(name, loopTime(c.get(name) as ClipInfo, sec(t - key.start), 0))
    }
    case 'stun': {
      const name = pick(c, 'vacille', 'reaction')
      if (!name) return locomotion(inp, locoClip(inp, 'normal'), t)
      const info = c.get(name) as ClipInfo
      return single(name, once(info, sec(t - key.from), windowRate(info, key.until - key.from)))
    }
    case 'absorb': {
      const name = pick(c, 'absorption')
      if (!name) return locomotion(inp, locoClip(inp, 'normal'), t)
      const info = c.get(name) as ClipInfo
      return single(name, once(info, sec(t - key.at), windowRate(info, TUNING.porteur.absorbEvery)))
    }
    case 'down':
      return down(inp, key, t)
    case 'rise': {
      const name = pick(c, 'relevement')
      if (!name) return down(inp, { kind: 'down', since: key.from, placed: true, mode: 'twist' }, t)
      const info = c.get(name) as ClipInfo
      // Les mains se plantent 1,5 s avant le Relèvement (L3) : le clip couvre exactement cette fenêtre.
      return single(name, once(info, sec(t - key.from), windowRate(info, key.at - key.from)))
    }
    case 'player-idle': {
      const run = pick(c, 'course')
      const idle = pick(c, 'repos')
      if (key.moving || !idle) return locomotion(inp, run, t)
      return single(idle, loopTime(c.get(idle) as ClipInfo, sec(t), 0))
    }
    case 'player-action':
      return playerAction(inp, key, t)
  }
}

const down = (inp: MachineInput, key: Extract<BaseKey, { kind: 'down' }>, t: number): Layer[] => {
  const c = inp.catalog
  const mode =
    key.mode === 'crawl'
      ? pick(c, 'abattu.reptation', 'abattu.torsion')
      : pick(c, 'abattu.torsion', 'abattu.reptation')
  const lying = (): Layer[] => {
    if (!mode) return []
    const info = c.get(mode) as ClipInfo
    if (mode === 'abattu.reptation') return locomotion(inp, mode, t)
    return single(mode, loopTime(info, sec(t - key.since), phase01(inp.id, 5)))
  }
  const fall = pick(c, 'chute')
  if (key.placed || !fall) return lying()
  const info = c.get(fall) as ClipInfo
  const fr = fallRecipe(info)
  const fallTicks = ((info.duration - fr.startS) / fr.rate) * TICK_HZ
  const e = t - key.since
  const chute = single(fall, clipTimeAt({ ...info.recipe, ...fr }, info.duration, sec(e), true))
  if (e < fallTicks) return chute
  return blend(chute, lying(), fadeWeightAt(sec(e - fallTicks), sec(BASE_FADE_TICKS)))
}

const playerAction = (
  inp: MachineInput,
  key: Extract<BaseKey, { kind: 'player-action' }>,
  t: number,
): Layer[] => {
  const c = inp.catalog
  const e = t - key.start
  const win = key.end - key.start
  let name: string | null = null
  switch (key.action) {
    case 'frappe':
      name = pick(c, `frappe.${key.weapon}.${key.comboStep + 1}`, `frappe.${key.weapon}.1`)
      break
    case 'sentence': {
      const dmg = key.weapon === 'masse' ? 'contondant' : 'tranchant'
      const size = key.targetSize === 'large' ? 'grande' : 'petite'
      name = pick(c, `sentence.${dmg}.${size}`, `sentence.${dmg}.petite`)
      break
    }
    default:
      name = pick(c, key.action)
  }
  if (!name) return evalKey(inp, { kind: 'player-idle', moving: false }, t)
  const info = c.get(name) as ClipInfo
  if (key.action === 'esquive' || key.action === 'charge') {
    // Le clip couvre la durée de l'action de la simulation (la simulation déplace le joueur).
    return single(name, once(info, sec(e), windowRate(info, win)))
  }
  // Frappe et Balayage : le repère d'impact du clip tombe au tick d'impact de la simulation (activeAt), l'anticipation
  // du clip se joue avant (windupRecipe) ; sans anticipation (activeAt absent ou au départ), le coup touche au tick de
  // départ et le clip part de son repère. Sentence : la mort tombe à la fin de l'action, le repère d'impact y est calé.
  if ((key.action === 'frappe' || key.action === 'balayage') && key.activeAt !== null) {
    const wr = windupRecipe(info.recipe, key.activeAt - key.start)
    return single(name, clipTimeAt(wr, info.duration, sec(e), true))
  }
  const rate = key.action === 'sentence' ? impactRate(info.recipe, win) : info.recipe.rate
  return single(name, once(info, sec(e), rate))
}

// Segment actif et fondus entre segments.
const evalSegments = (inp: MachineInput, segs: readonly Segment[], t: number): Layer[] => {
  let i = segs.length - 1
  while (i >= 0 && (segs[i] as Segment).from > t) i--
  if (i < 0) {
    const first = segs[0]
    return first ? evalKey(inp, first.key, t) : []
  }
  const cur = segs[i] as Segment
  const layers = evalKey(inp, cur.key, t)
  const w = fadeWeightAt(sec(t - cur.from), sec(cur.fade))
  if (w >= 1 || i === 0) return layers
  // Un geste du Bourreau coupé pendant son anticipation s'arrête là où on l'a coupé : pendant le fondu, il ne
  // continue pas jusqu'à son repère d'impact (la simulation n'a pas frappé).
  const before = segs[i - 1] as Segment
  const tBefore = cutsWindup(before.key, cur.from) ? Math.min(t, cur.from) : t
  return blend(evalSegments(inp, segs.slice(0, i), tBefore), layers, w)
}

const reactionWeight = (t: number, hitTick: number, cutAt: number | null): number => {
  const e = t - hitTick
  if (e < 0) return 0
  const rise = fadeWeightAt(sec(e), sec(INTERRUPT_FADE_FRAMES))
  const decayFrom = Math.min(hitTick + REACTION_HOLD_TICKS, cutAt ?? Number.POSITIVE_INFINITY)
  const fall = t <= decayFrom ? 1 : 1 - fadeWeightAt(sec(t - decayFrom), sec(REACTION_FADE_TICKS))
  return Math.min(rise, fall)
}

export const animate = (inp: MachineInput): AnimFrame => {
  const { t, track, catalog } = inp
  const segs = track?.segments ?? []
  let layers = evalSegments(inp, segs, t)
  let tremble = 1
  // Réaction au dernier coup reçu debout.
  const hit = track?.hits.filter((h) => h.tick <= t).at(-1)
  if (hit?.standing) {
    const next = segs.find(
      (s) => s.from > hit.tick && s.from <= t && (s.key.kind === 'attack' || s.key.kind === 'channel'),
    )
    const w = reactionWeight(t, hit.tick, next?.from ?? null) * (hit.interrupting ? 1 : REACTION_PARTIAL)
    const name = pick(catalog, 'reaction')
    if (name && w > 0) {
      const info = catalog.get(name) as ClipInfo
      layers = blend(layers, single(name, once(info, sec(t - hit.tick))), w)
    }
  } else if (hit && t - hit.tick < JOLT_TICKS) {
    tremble += JOLT_GAIN * (1 - (t - hit.tick) / JOLT_TICKS)
  }
  const cur = segs.filter((s) => s.from <= t).at(-1)
  if (cur?.key.kind === 'stun') tremble = Math.max(tremble, 3)
  // Pivot de tête de l'alerte (L7) : d'un coup sec vers le joueur pendant 0,4 s, puis retour en 0,3 s.
  let headYaw = 0
  if (inp.alertedAt !== null) {
    const e = t - inp.alertedAt
    const turn = TUNING.alertTurnTicks
    if (e >= 0 && e < turn + 18) {
      const snap = Math.min(1, e / 4)
      const back = e <= turn ? 1 : 1 - (e - turn) / 18
      const lim = 1.3
      headYaw = Math.max(-lim, Math.min(lim, inp.toPlayer)) * snap * back
    }
  }
  return { layers: normalize(layers), tremble, headYaw }
}

// Un même clip ne se lit qu'à un instant (une action par clip dans le mélangeur) : deux couches du même clip (deux
// segments du même clip en fondu) prennent l'instant de la plus lourde et la somme des poids.
const normalize = (layers: Layer[]): Layer[] => {
  const merged = new Map<string, { time: number; weight: number; best: number }>()
  for (const l of layers) {
    if (l.weight <= 0) continue
    const m = merged.get(l.clip)
    if (!m) merged.set(l.clip, { time: l.time, weight: l.weight, best: l.weight })
    else {
      if (l.weight > m.best) {
        m.time = l.time
        m.best = l.weight
      }
      m.weight += l.weight
    }
  }
  const sum = [...merged.values()].reduce((s, m) => s + m.weight, 0)
  if (sum <= 0) return []
  return [...merged.entries()].map(([clip, m]) => ({ clip, time: m.time, weight: m.weight / sum }))
}

// ---------------------------------------------------------------------------------------------------------
// Agonie (L4, §18, §30.3 ; décision du concepteur du 2026-10-12) : la mort reste instantanée dans la simulation,
// mais le corps s'effondre pendant TUNING.agonie ticks (seule source, partagée avec l'audio), puis ne bouge plus
// jamais. Comme le reste, la pose d'une image de l'agonie est une fonction pure de la mémoire et de l'horloge ; sa
// dernière image est la pose figée du mort (deathFrame), identique pour toujours.
// - à terre (couché, reptation, prière à terre, chute finie) : un dernier spasme. Le clip couché continue en
//   ralentissant jusqu'à l'arrêt, le tremblement monte puis s'éteint ;
// - en train de tomber (chute pas encore au sol) : il finit de tomber, la chute recalée sur l'agonie ;
// - en train de se relever : il retombe, le relèvement joué à rebours jusqu'à sa pose couchée ;
// - debout (variante B, partie d'une Union) : il tombe. La descente d'un clip de chute du manifeste (mort debout si
//   sa vitesse reste sous AGONY_FALL_RATE_MAX, sinon la chute) est recalée sur l'agonie, depuis la pose vivante du
//   tick du coup (fondu de AGONY_BLEND_TICKS) ;
// - placé mort (scène de test, sauvegarde) ou sans mémoire : aucune agonie, la pose finale.

export const AGONY_TICKS = TUNING.agonie
// Vitesse de lecture la plus haute d'une descente recalée sur l'agonie (forme, E7) : au-delà, le corps part plus
// loin dans la descente plutôt que de la jouer encore plus vite.
export const AGONY_FALL_RATE_MAX = 2.5
export const AGONY_BLEND_TICKS = 4
const SPASM_CLIP_S = 0.45 // secondes de clip couché jouées, en ralentissant, pendant l'agonie
const SPASM_PEAK = 5 // tremblement au plus fort du spasme, en multiple du tremblement vivant

export type AgonyKind = 'spasme' | 'rechute' | 'effondrement' | 'aucune'

// Ce que l'agonie joue, d'après l'état de base du corps au tick du coup.
export const agonyKind = (track: Track | undefined, deathTick: number): AgonyKind => {
  const cur = (track?.segments ?? []).filter((s) => s.from <= deathTick).at(-1)
  if (!cur) return 'aucune'
  switch (cur.key.kind) {
    case 'down':
      return 'spasme' // fin de chute ou spasme : tranché par agonyFrame selon l'instant de la chute
    case 'rise':
      return 'rechute'
    case 'channel':
      return cur.key.down ? 'spasme' : 'effondrement'
    default:
      return 'effondrement'
  }
}

// Un mort tué à terre (L1) : couché, en reptation, en prière à terre, en train de tomber ou de se relever.
export const diedLying = (track: Track | undefined, deathTick: number): boolean => {
  const k = agonyKind(track, deathTick)
  return k === 'spasme' || k === 'rechute'
}

const ease = (u: number): number => 1 - (1 - u) * (1 - u) // départ rapide, arrêt doux

// Avance un clip de `ds` secondes depuis `time` : en boucle s'il boucle, borné à sa fin sinon.
const advance = (info: ClipInfo | undefined, time: number, ds: number): number => {
  if (!info) return time
  const raw = time + ds * info.recipe.rate
  if (info.recipe.boucle) {
    const d = info.duration
    if (d <= 0) return 0
    const r = raw % d
    return r < 0 ? r + d : r
  }
  return Math.min(info.duration, Math.max(0, raw))
}

// Descente d'un clip de chute (du début de la descente au contact au sol) et la vitesse qui la fait tenir dans
// l'agonie.
const descent = (info: ClipInfo): { from: number; to: number; rate: number } => {
  const to = info.settleS ?? info.duration
  const from = Math.min(to, info.descentS ?? info.recipe.startS)
  return { from, to, rate: (to - from) / sec(AGONY_TICKS) }
}

// Clip de l'effondrement debout : la mort debout du manifeste si sa descente tient sous la vitesse la plus haute,
// sinon celui des clips de chute dont la descente demande la vitesse la plus basse.
export const collapseClip = (catalog: Catalog): string | null => {
  const names = ['mort.debout', 'chute'].filter((n) => catalog.has(n))
  const first = names[0]
  if (first === undefined) return null
  const rate = (n: string): number => descent(catalog.get(n) as ClipInfo).rate
  if (rate(first) <= AGONY_FALL_RATE_MAX) return first
  return names.reduce((a, b) => (rate(b) < rate(a) ? b : a))
}

// Pose finale sans passé (placé mort) : la fin de la chute.
const finalOfNothing = (catalog: Catalog): AnimFrame => {
  const fall = pick(catalog, 'chute', 'abattu.torsion')
  if (!fall) return { layers: [], tremble: 0, headYaw: 0 }
  const info = catalog.get(fall) as ClipInfo
  return {
    layers: [{ clip: fall, time: fall === 'chute' ? info.duration : 0, weight: 1 }],
    tremble: 0,
    headYaw: 0,
  }
}

// Pose d'un corps mort à l'horloge t (ticks) : l'agonie de deathTick à deathTick + AGONY_TICKS, puis la pose finale.
export const agonyFrame = (inp: MachineInput, deathTick: number, t: number): AnimFrame => {
  const kind = agonyKind(inp.track, deathTick)
  if (kind === 'aucune') return finalOfNothing(inp.catalog)
  const e = Math.min(AGONY_TICKS, Math.max(0, t - deathTick))
  const u = AGONY_TICKS > 0 ? e / AGONY_TICKS : 1
  const alive = animate({ ...inp, t: deathTick }) // la pose du vivant au tick du coup
  const c = inp.catalog
  const headYaw = alive.headYaw * (1 - u)

  if (kind === 'spasme') {
    const chute = alive.layers.find((l) => l.clip === 'chute')
    const info = c.get('chute')
    const settle = info ? (info.settleS ?? info.duration) : 0
    if (chute && info && chute.time < settle) {
      // Encore en l'air : il finit de tomber, le reste de la chute recalé sur l'agonie.
      const others = alive.layers.filter((l) => l.clip !== 'chute')
      const fall = [{ clip: 'chute', time: chute.time + (settle - chute.time) * u, weight: 1 }]
      return {
        layers: normalize(blend(others, fall, chute.weight + (1 - chute.weight) * Math.min(1, u * 4))),
        tremble: alive.tremble * (1 - u),
        headYaw,
      }
    }
    // Couché : le clip continue en ralentissant jusqu'à l'arrêt ; le spasme monte puis s'éteint.
    const ds = SPASM_CLIP_S * ease(u)
    return {
      layers: alive.layers.map((l) => ({ ...l, time: advance(c.get(l.clip), l.time, ds) })),
      tremble: alive.tremble * (1 - u) * (1 + SPASM_PEAK * Math.sin(Math.PI * u)),
      headYaw,
    }
  }

  if (kind === 'rechute') {
    // Il retombe : le relèvement joué à rebours jusqu'à sa première image (couchée), en accélérant.
    const k = u * u
    return {
      layers: alive.layers.map((l) => {
        if (l.clip !== 'relevement') return l
        const start = c.get(l.clip)?.recipe.startS ?? 0
        return { ...l, time: l.time + (start - l.time) * k }
      }),
      tremble: alive.tremble * (1 - u) * (1 + SPASM_PEAK * 0.5 * Math.sin(Math.PI * u)),
      headYaw,
    }
  }

  // Debout : il tombe.
  const name = collapseClip(c)
  if (!name) return { layers: alive.layers, tremble: 0, headYaw: 0 }
  const d = descent(c.get(name) as ClipInfo)
  const rate = Math.min(AGONY_FALL_RATE_MAX, d.rate)
  const from = d.to - rate * sec(AGONY_TICKS)
  const fall = [{ clip: name, time: from + rate * sec(e), weight: 1 }]
  return {
    layers: normalize(blend([...alive.layers], fall, fadeWeightAt(sec(e), sec(AGONY_BLEND_TICKS)))),
    tremble: alive.tremble * (1 - u),
    headYaw,
  }
}

// Pose figée d'un mort, la dernière image de son agonie : elle ne change plus jamais (B2.O5, amendement A5).
export const deathFrame = (inp: MachineInput, deathTick: number): AnimFrame =>
  agonyFrame(inp, deathTick, deathTick + AGONY_TICKS)

export const isAlive = (c: Creature): boolean => c.state.kind !== 'mort'
