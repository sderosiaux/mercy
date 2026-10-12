// Scènes et politiques de B5 §6 (contrat gelé), transcrites pour le banc audio : S1 (5 variantes), S-nappe, S-sat.
// Les vagues de jeu et ces mêmes scènes appartiennent à src/sim/waves.ts (tâche C6) ; tant qu'il n'existe pas, le
// laboratoire audio les construit ici avec les outils de scène de la simulation. À remplacer par les définitions de
// C6 à l'intégration.
import {
  createWorld,
  IDLE_COMMANDS,
  type PlayerCommands,
  type SpawnDef,
  souriant,
  step,
  type Vec2,
  type WaveDef,
  type World,
} from '../sim/index'

const v = (x: number, z: number): Vec2 => ({ x, z })
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)
const unit = (d: Vec2): Vec2 => {
  const n = Math.hypot(d.x, d.z)
  return n === 0 ? v(0, 0) : v(d.x / n, d.z / n)
}
const debout = (w: World, id: number) => {
  const k = w.creatures.find((c) => c.id === id)?.state.kind
  return k === 'rituel' || k === 'hostile'
}
// base de B5 §6 : Couperet, jamais d'Esquive ni de Charge.
const base = (w: World): PlayerCommands => ({
  ...IDLE_COMMANDS,
  aim: v(w.player.pos.x + 1, w.player.pos.z),
})

const wave = (id: string, spawns: readonly SpawnDef[]): WaveDef => ({
  id,
  test: true,
  playerStart: v(0, 0),
  spawns,
  jitter: { posM: 0, ritualPhase: false },
})

export const createScene = (def: WaveDef, seed = 1): World =>
  createWorld({ seed, wave: def, variant: 'A', families: { souriant } })

// --- S1 ---------------------------------------------------------------------------------------------------

export type S1Variant = 'S1-hal' | 'S1-cri' | 'S1-sent' | 'S1-insp' | 'S1-rel'
export const S1_VARIANTS: readonly S1Variant[] = ['S1-hal', 'S1-cri', 'S1-sent', 'S1-insp', 'S1-rel']

const S1_PARAMS: Record<S1Variant, { k: number; verbe: 'frappe' | 'sentence' | 'aucun' }> = {
  'S1-hal': { k: 0, verbe: 'frappe' },
  'S1-cri': { k: 120, verbe: 'frappe' },
  'S1-sent': { k: 120, verbe: 'sentence' },
  'S1-insp': { k: 300, verbe: 'frappe' },
  'S1-rel': { k: 0, verbe: 'aucun' },
}

// Un Souriant en Rituel à (+2 ; 0) du point d'apparition du joueur, rien d'autre.
export const S1_WAVE = wave('S1', [{ family: 'souriant', pos: v(2, 0), state: 'rituel' }])

export const s1Policy =
  (variant: S1Variant) =>
  (w: World): PlayerCommands => {
    const { k, verbe } = S1_PARAMS[variant]
    const c = [...w.creatures].sort((a, b) => a.id - b.id)[0]
    if (!c) return base(w)
    const b = { ...base(w), aim: c.pos }
    const t = w.tick
    if (debout(w, c.id)) return { ...b, strike: true }
    if (c.state.kind === 'abattu' && verbe !== 'aucun' && t >= c.state.since + k) {
      if (verbe === 'frappe') return { ...b, strike: true }
      return w.player.action === null ? { ...b, sentence: t % 2 === 0 } : b
    }
    return b
  }

// --- S-nappe ----------------------------------------------------------------------------------------------

export const SNAPPE_WAVE = wave(
  'S-nappe',
  [0, 60, 120, 180, 240, 300].map((deg) => ({
    family: 'souriant' as const,
    pos: v(10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180)),
    state: 'rituel' as const,
  })),
)

export const sNappePolicy = (w: World): PlayerCommands => {
  const morts = w.creatures.flatMap((c) => (c.state.kind === 'mort' ? [c.state.at] : []))
  const dernier = morts.length ? Math.max(...morts) : 0
  if (w.tick < dernier + 180) return base(w)
  const c = w.creatures.filter((x) => x.state.kind !== 'mort').sort((a, b) => a.id - b.id)[0]
  if (!c) return base(w)
  const p = w.player.pos
  if (dist(c.pos, p) > 2 && debout(w, c.id))
    return { ...base(w), move: unit(v(c.pos.x - p.x, c.pos.z - p.z)), aim: c.pos }
  return { ...base(w), aim: c.pos, strike: true }
}

// --- S-sat ------------------------------------------------------------------------------------------------

const SAT_X = [3.25, 4.75, 6.25, 7.75, 9.25, 10.75]
const SAT_Z = [-3.75, -2.25, -0.75, 0.75, 2.25, 3.75]
// 36 Souriants Abattus au tick 0, grille 6 × 6 (ids croissants en x puis en z : ordre non fixé par le contrat).
export const SSAT_WAVE = wave(
  'S-sat',
  SAT_X.flatMap((x) =>
    SAT_Z.map((z) => ({ family: 'souriant' as const, pos: v(x, z), state: 'abattu' as const })),
  ),
)

export const sSatPolicy = (w: World): PlayerCommands => {
  const t = w.tick
  if (t < 90) return base(w)
  if (t < 150) return { ...base(w), move: v(0, 1) }
  return { ...base(w), move: v(0, -1) }
}
export const SSAT_END = 265

// --- Exécution sans son : durée d'une scène ------------------------------------------------------------------

export interface SceneDef {
  readonly label: string
  readonly world0: World
  readonly policy: (w: World) => PlayerCommands
  readonly ticks: number
}

const firstTick = (
  w0: World,
  policy: (w: World) => PlayerCommands,
  max: number,
  pred: (w: World) => boolean,
): number => {
  let w = w0
  for (let i = 0; i < max; i++) {
    if (pred(w)) return w.tick
    w = step(w, policy(w))
  }
  throw new Error('condition de fin jamais atteinte')
}

export const s1Scene = (variant: S1Variant, seed = 1): SceneDef => {
  const world0 = createScene(S1_WAVE, seed)
  const policy = s1Policy(variant)
  if (variant === 'S1-rel') {
    const fell = firstTick(world0, policy, 10_000, (w) => w.events.some((e) => e.type === 'fell'))
    return { label: variant, world0, policy, ticks: fell + 420 }
  }
  const death = firstTick(world0, policy, 10_000, (w) => w.events.some((e) => e.type === 'death'))
  return { label: variant, world0, policy, ticks: death + 180 }
}

export const sNappeScene = (seed = 1): SceneDef => {
  const world0 = createScene(SNAPPE_WAVE, seed)
  const end = firstTick(world0, sNappePolicy, 20_000, (w) => {
    const alive = w.creatures.some((c) => c.state.kind !== 'mort')
    const morts = w.creatures.flatMap((c) => (c.state.kind === 'mort' ? [c.state.at] : []))
    return !alive && w.tick >= Math.max(0, ...morts) + 180
  })
  return { label: 'S-nappe', world0, policy: sNappePolicy, ticks: end }
}

export const sSatScene = (seed = 1): SceneDef => ({
  label: 'S-sat',
  world0: createScene(SSAT_WAVE, seed),
  policy: sSatPolicy,
  ticks: SSAT_END,
})
