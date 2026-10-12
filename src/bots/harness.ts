// Banc de bots : joue une politique sur une vague, une graine, une variante, et rend des chiffres appariables.
// Pur et sans dépendance Node : scripts/bots.ts y ajoute le parallélisme (worker threads), scripts/sim.ts la sortie
// d'une partie. Les instruments servis : B1 §12 (fin de vague, CAP), B3 I8 à I10, B4 I3, I4, I5, I8, B5 §6 (R).
import {
  type Distribution,
  distribution,
  isEngagement,
  median,
  type RunMetrics,
  ratio,
  reduceRun,
  type SeriesLine,
  seriesLine,
  type TickNote,
  tickNotes,
} from '../metrics/index'
import {
  createWorld,
  FAMILIES,
  IDLE_COMMANDS,
  type PlayerCommands,
  type SimEvent,
  step,
  type Variant,
  type WeaponId,
  type World,
} from '../sim/index'
import { waveById } from '../sim/waves'
import { policies as b1b3 } from './b1b3/index'
import { policies as b2b4b5 } from './b2b4b5/index'
import type { Policy, PolicyFactory } from './policy'
import { policies as reference } from './reference'

// ---------------------------------------------------------------------------------------------------------------
// Registre : politiques de référence du banc, puis les lots C6b et C6c. Un nom en double est une erreur.
export const mergeRegistries = (
  ...regs: readonly Readonly<Record<string, PolicyFactory>>[]
): Readonly<Record<string, PolicyFactory>> => {
  const out: Record<string, PolicyFactory> = {}
  for (const reg of regs) {
    for (const [name, f] of Object.entries(reg)) {
      if (Object.hasOwn(out, name)) throw new Error(`politique enregistrée deux fois : ${name}`)
      out[name] = f
    }
  }
  return out
}
export const POLICIES: Readonly<Record<string, PolicyFactory>> = mergeRegistries(reference, b1b3, b2b4b5)

// Une politique se nomme `nom` ou `nom:clé=valeur:clé=valeur` (ex. `b5:D=60`, `s1:k=120:verbe=frappe`).
export const parsePolicySpec = (
  spec: string,
): { readonly name: string; readonly params: Readonly<Record<string, string>> } => {
  const [name = '', ...rest] = spec.split(':')
  const params: Record<string, string> = {}
  for (const kv of rest) {
    const i = kv.indexOf('=')
    if (i <= 0)
      throw new Error(`paramètre de politique mal formé « ${kv} » dans « ${spec} » (attendu clé=valeur)`)
    params[kv.slice(0, i)] = kv.slice(i + 1)
  }
  if (name === '') throw new Error(`politique sans nom : « ${spec} »`)
  return { name, params }
}

export const makePolicy = (spec: string): Policy => {
  const { name, params } = parsePolicySpec(spec)
  const factory = POLICIES[name]
  if (!factory)
    throw new Error(`politique inconnue : ${name} (connues : ${Object.keys(POLICIES).join(', ')})`)
  return factory(params)
}

// ---------------------------------------------------------------------------------------------------------------
// Une partie.

export interface RunSpec {
  readonly wave: string
  readonly policy: string
  readonly variant: Variant
  readonly seed: number
  readonly weapon: WeaponId
  readonly latency: number // B4 I3 : commandes calculées au tick t, appliquées au tick t + latency
  readonly timeoutTicks: number // B1 CAP, B4 I5
  readonly timeoutFrom: 'start' | 't0' // B1 et B3 comptent depuis le tick 0, B4 depuis T0
  readonly tailTicks: number // ticks joués après la fin de vague (scènes de B5 : « mort + 180 »)
}

export const DEFAULT_SPEC: Omit<RunSpec, 'wave' | 'policy' | 'seed'> = {
  variant: 'A',
  weapon: 'couperet',
  latency: 0,
  timeoutTicks: 21_600,
  timeoutFrom: 'start',
  tailTicks: 0,
}

export interface RunResult {
  readonly spec: RunSpec
  readonly fini: boolean // la vague est vidée (toutes les créatures sont mortes)
  readonly timeout: boolean // plafond atteint avant la fin de vague
  readonly endTick: number // dernier tick joué
  readonly weaponAt: number | null // tick où l'arme demandée est en main (0 : dès le départ)
  readonly metrics: RunMetrics
}

export interface RunTrace {
  readonly events: readonly SimEvent[]
  readonly series: readonly SeriesLine[]
  readonly notes: readonly TickNote[]
  readonly commands: readonly PlayerCommands[] | null // commandes appliquées, une par step
}

// Spécification aux clés dans un ordre fixe : le JSON d'une partie ne dépend pas de la façon de la construire.
const canonical = (s: RunSpec): RunSpec => ({
  wave: s.wave,
  policy: s.policy,
  weapon: s.weapon,
  variant: s.variant,
  seed: s.seed,
  latency: s.latency,
  timeoutTicks: s.timeoutTicks,
  timeoutFrom: s.timeoutFrom,
  tailTicks: s.tailTicks,
})

export const playRun = (
  input: RunSpec,
  opts: { readonly keepCommands?: boolean; readonly policy?: Policy } = {},
): { readonly result: RunResult; readonly trace: RunTrace } => {
  const spec = canonical(input)
  // opts.policy : politique fournie directement (tests, bot dans le navigateur) ; sinon lue dans le registre.
  const policy = opts.policy ?? makePolicy(spec.policy)
  let w: World = createWorld({
    seed: spec.seed,
    wave: waveById(spec.wave),
    variant: spec.variant,
    families: FAMILIES,
    weapon: spec.weapon, // l'arme est en main dès le départ : aucune commande de changement à rejouer
  })
  const startWeapon = w.player.weapon
  const events: SimEvent[] = [...w.events]
  const series: SeriesLine[] = [seriesLine(w)]
  const notes: TickNote[] = tickNotes(w, IDLE_COMMANDS, w)
  const commands: PlayerCommands[] | null = opts.keepCommands ? [] : null
  let t0: number | null = events.find(isEngagement)?.tick ?? null
  let weaponAt: number | null = w.player.weapon === spec.weapon ? 0 : null
  let memory = policy.init(w)
  const pending: PlayerCommands[] = []
  let timeout = false
  for (;;) {
    const ended = w.wave.endedAt
    if (ended !== null) {
      if (w.tick >= ended + spec.tailTicks) break
    } else if (w.tick >= (spec.timeoutFrom === 't0' ? (t0 ?? 0) : 0) + spec.timeoutTicks) {
      timeout = true
      break
    }
    const [cmd, next] = policy.decide(w, memory)
    memory = next
    pending.push(cmd)
    // B4 I3 : les commandes calculées sur le monde du tick t s'appliquent au tick t + latency ; avant, IDLE.
    const delayed = pending.length > spec.latency ? (pending.shift() as PlayerCommands) : IDLE_COMMANDS
    // Les fronts des politiques (B3 I10) passent tels quels.
    const applied = delayed
    const after = step(w, applied)
    for (const e of after.events) events.push(e)
    series.push(seriesLine(after))
    for (const n of tickNotes(w, applied, after)) notes.push(n)
    commands?.push(applied)
    if (t0 === null && after.events.some(isEngagement)) t0 = after.tick
    if (weaponAt === null && after.player.weapon === spec.weapon) weaponAt = after.tick
    w = after
  }
  const metrics = reduceRun(events, { weapon: startWeapon, series, notes })
  return {
    result: { spec, fini: w.wave.endedAt !== null, timeout, endTick: w.tick, weaponAt, metrics },
    trace: { events, series, notes, commands },
  }
}

export const runSerial = (specs: readonly RunSpec[]): RunResult[] => specs.map((s) => playRun(s).result)

// Nom de fichier stable d'une partie : vague, politique, arme, variante, graine.
export const runKey = (s: RunSpec): string =>
  [s.wave, s.policy.replace(/[^A-Za-z0-9._=-]/g, '_'), s.weapon, s.variant, `s${s.seed}`].join('__')

// ---------------------------------------------------------------------------------------------------------------
// Plan d'exécution et arguments de la ligne de commande (partagés par scripts/sim.ts et scripts/bots.ts).

export interface Plan {
  readonly waves: readonly string[]
  readonly policies: readonly string[]
  readonly seeds: readonly number[]
  readonly variants: readonly Variant[]
  readonly weapons: readonly WeaponId[]
  readonly latency: number
  readonly timeoutTicks: number
  readonly timeoutFrom: 'start' | 't0'
  readonly tailTicks: number
}

// Ordre canonique : vague, politique, arme, variante, graine (l'ordre donné en argument).
export const expandPlan = (p: Plan): RunSpec[] =>
  p.waves.flatMap((wave) =>
    p.policies.flatMap((policy) =>
      p.weapons.flatMap((weapon) =>
        p.variants.flatMap((variant) =>
          p.seeds.map((seed) => ({
            wave,
            policy,
            weapon,
            variant,
            seed,
            latency: p.latency,
            timeoutTicks: p.timeoutTicks,
            timeoutFrom: p.timeoutFrom,
            tailTicks: p.tailTicks,
          })),
        ),
      ),
    ),
  )

// `1-100`, `1,2,3`, `1-5,9`.
export const parseSeeds = (s: string): number[] =>
  s.split(',').flatMap((part) => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    if (!m) throw new Error(`graines mal formées : « ${part} » (attendu 1-100 ou 1,2,3)`)
    const a = Number(m[1])
    const b = m[2] === undefined ? a : Number(m[2])
    if (b < a) throw new Error(`intervalle de graines vide : « ${part} »`)
    return Array.from({ length: b - a + 1 }, (_, i) => a + i)
  })

export const parseArgs = (argv: readonly string[]): Record<string, string> => {
  const out: Record<string, string> = {}
  const args = argv[0] === '--' ? argv.slice(1) : argv
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '--') continue
    if (!a.startsWith('--')) throw new Error(`argument inattendu : ${a}`)
    const eq = a.indexOf('=')
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1)
      continue
    }
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) out[a.slice(2)] = 'true'
    else {
      out[a.slice(2)] = v
      i++
    }
  }
  return out
}

const list = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '')

const int = (s: string | undefined, def: number, name: string): number => {
  if (s === undefined) return def
  const n = Number(s)
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${name} attend un entier positif ou nul, reçu « ${s} »`)
  return n
}

export const planFromArgs = (a: Readonly<Record<string, string>>): Plan => {
  const variants = list(a.variants ?? a.variant ?? DEFAULT_SPEC.variant)
  for (const v of variants) if (v !== 'A' && v !== 'B') throw new Error(`variante inconnue : ${v}`)
  const weapons = list(a.weapon ?? a.weapons ?? DEFAULT_SPEC.weapon)
  for (const w of weapons) if (w !== 'couperet' && w !== 'masse') throw new Error(`arme inconnue : ${w}`)
  const from = a['timeout-from'] ?? DEFAULT_SPEC.timeoutFrom
  if (from !== 'start' && from !== 't0')
    throw new Error(`--timeout-from attend start ou t0, reçu « ${from} »`)
  const waves = list(a.waves ?? a.wave ?? 'V1,V2,V3,V4,V5,V6')
  for (const w of waves) waveById(w)
  const policies = list(a.policies ?? a.policy ?? '')
  if (policies.length === 0) throw new Error('--policies est obligatoire')
  for (const p of policies) makePolicy(p)
  return {
    waves,
    policies,
    seeds: parseSeeds(a.seeds ?? a.seed ?? '1'),
    variants: variants as Variant[],
    weapons: weapons as WeaponId[],
    latency: int(a.latency, DEFAULT_SPEC.latency, 'latency'),
    timeoutTicks: int(a['timeout-ticks'], DEFAULT_SPEC.timeoutTicks, 'timeout-ticks'),
    timeoutFrom: from,
    tailTicks: int(a['tail-ticks'], DEFAULT_SPEC.tailTicks, 'tail-ticks'),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Résumé : distributions par case et appariement graine par graine (B1 §5, B3 §5.2, B4 §5, B5 §6).

export const B4_O7_HORDE = 15 // B4.O7 : pic d'au moins 15 créatures à 8 m

type Flat = { scalars: Map<string, number>; lists: Map<string, number[]> }

// Aplatit les métriques : nombres et booléens (1/0) en scalaires, listes de nombres en listes ; null ignoré.
const flatten = (v: unknown, path: string, out: Flat): void => {
  if (typeof v === 'number') out.scalars.set(path, v)
  else if (typeof v === 'boolean') out.scalars.set(path, v ? 1 : 0)
  else if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number')) out.lists.set(path, v as number[])
    else out.scalars.set(`${path}.length`, v.length)
  } else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) flatten(x, path === '' ? k : `${path}.${k}`, out)
  }
}

const sum = (rs: readonly RunResult[], f: (m: RunMetrics) => number): number =>
  rs.reduce((s, r) => s + f(r.metrics), 0)
const share = (rs: readonly RunResult[], f: (r: RunResult) => boolean): number | null =>
  ratio(rs.filter(f).length, rs.length)

export interface CaseSummary {
  readonly wave: string
  readonly policy: string
  readonly weapon: WeaponId
  readonly variant: Variant
  readonly n: number
  readonly finis: number // B1 G1
  readonly timeouts: number // B4.O8 « hors délai » quand le plafond compte depuis T0
  readonly Tdistincts: number // B1 G2
  readonly agregats: Readonly<Record<string, number | null>>
  readonly distributions: Readonly<Record<string, Distribution>> // une valeur par graine
  readonly regroupees: Readonly<Record<string, Distribution>> // listes de toutes les graines réunies
}

export interface PairSummary {
  readonly wave: string
  readonly weapon: WeaponId
  readonly variant: Variant
  readonly a: string
  readonly b: string
  readonly n: number
  readonly gagneA: number // B1 gagne(a, b)
  readonly gagneB: number
  readonly egalites: number
  readonly W: number | null // B1.O1 : gagne(a, b) / n
  readonly M: number | null // B1.O2 : médiane de T(a) / T(b)
  readonly Delta: number | null // B1.O3 : médiane de perte(b) − perte(a)
  readonly rT: { readonly median: number | null; readonly positifs: number } // B3 : (T_b − T_a) / T_b
  readonly dV: { readonly median: number | null; readonly positifs: number } // B3 : V_b − V_a
}

export interface VariantSummary {
  readonly wave: string
  readonly policy: string
  readonly weapon: WeaponId
  readonly n: number
  readonly O5: number | null // B4.O5 : médiane de D(A) / D(B)
  readonly O10: number | null // B4.O10 : médiane de corpsTemps(B) / corpsTemps(A)
}

export interface SeedRow {
  readonly wave: string
  readonly weapon: WeaponId
  readonly variant: Variant
  readonly seed: number
  readonly runs: Readonly<
    Record<
      string,
      {
        readonly T: number
        readonly fini: boolean
        readonly timeout: boolean
        readonly morts: number
        readonly perte: number
        readonly V: number
        readonly D: number | null
      }
    >
  >
}

export interface Summary {
  readonly cases: readonly CaseSummary[]
  readonly pairs: readonly PairSummary[]
  readonly variants: readonly VariantSummary[]
  readonly seeds: readonly SeedRow[]
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)]

const caseSummary = (rs: readonly RunResult[]): CaseSummary => {
  const first = rs[0] as RunResult
  const scalars = new Map<string, number[]>()
  const lists = new Map<string, number[]>()
  for (const r of rs) {
    const f: Flat = { scalars: new Map(), lists: new Map() }
    flatten(r.metrics, '', f)
    for (const [k, v] of f.scalars) scalars.set(k, [...(scalars.get(k) ?? []), v])
    for (const [k, v] of f.lists) lists.set(k, [...(lists.get(k) ?? []), ...v])
  }
  const distributions: Record<string, Distribution> = {}
  for (const k of [...scalars.keys()].sort()) distributions[k] = distribution(scalars.get(k) ?? [])
  const regroupees: Record<string, Distribution> = {}
  for (const k of [...lists.keys()].sort()) regroupees[k] = distribution(lists.get(k) ?? [])
  const acheves = sum(rs, (m) => m.b1.episodes.acheves)
  const recuperes = sum(rs, (m) => m.b1.episodes.recuperes)
  const charges = sum(rs, (m) => m.b3.O3a.charges)
  const achevements = sum(rs, (m) => m.b4.O9.achevements)
  return {
    wave: first.spec.wave,
    policy: first.spec.policy,
    weapon: first.spec.weapon,
    variant: first.spec.variant,
    n: rs.length,
    finis: rs.filter((r) => r.fini).length,
    timeouts: rs.filter((r) => r.timeout).length,
    Tdistincts: new Set(rs.map((r) => r.metrics.T)).size,
    agregats: {
      'b1.confort': share(rs, (r) => r.metrics.b1.confort),
      'b1.recup': ratio(recuperes, acheves + recuperes),
      'b3.partPA>=1': share(rs, (r) => r.metrics.b3.PA >= 1),
      'b3.partAB>=1': share(rs, (r) => r.metrics.b3.AB >= 1),
      'b3.partMC>=1': share(rs, (r) => r.metrics.b3.MC >= 1),
      'b3.PIj/PD': ratio(
        sum(rs, (m) => m.b3.PIj),
        sum(rs, (m) => m.b3.PD),
      ),
      'b3.PIc/PIj': ratio(
        sum(rs, (m) => m.b3.PIc),
        sum(rs, (m) => m.b3.PIj),
      ),
      'b3.O3a': ratio(
        sum(rs, (m) => m.b3.O3a.suiviesDos),
        charges,
      ),
      'b3.O3a.grainesAvecCharge': rs.filter((r) => r.metrics.b3.O3a.charges > 0).length,
      'b4.O4': ratio(
        sum(rs, (m) => m.b4.O4.relevementsDelai),
        sum(rs, (m) => m.b4.O4.chutesOrd),
      ),
      'b4.O7.graines>=15': rs.filter((r) => r.metrics.b4.O7.pic >= B4_O7_HORDE).length,
      'b4.O8.mortsJoueur': sum(rs, (m) => m.b4.O8.mortsJoueur),
      'b4.O9.partCoupentUnCri': ratio(
        sum(rs, (m) => m.b4.O9.coupentUnCri),
        achevements,
      ),
      'b5.O2.mortsAvant30': sum(rs, (m) => m.b5.O2.mortsAvant30),
      'b5.O2.mortsAvant30AvecCri': sum(rs, (m) => m.b5.O2.mortsAvant30AvecCri),
      'b5.O2.vivantsA30': sum(rs, (m) => m.b5.O2.vivantsA30),
      'b5.O2.criA30': sum(rs, (m) => m.b5.O2.criA30),
      'b5.O6.releve': sum(rs, (m) => m.b5.O6.releve),
      'b5.O6.priere': sum(rs, (m) => m.b5.O6.priere),
      'b5.O6.assemblage': sum(rs, (m) => m.b5.O6.assemblage),
      'b5.O6.absorption': sum(rs, (m) => m.b5.O6.absorption),
      'b5.O8.vocalisentMax': rs.reduce((x, r) => Math.max(x, r.metrics.b5.O8.vocalisentMax), 0),
      'b5.O9.groupes': sum(rs, (m) => m.b5.O9.groupes),
      'b5.O10.classe1': sum(rs, (m) => m.b5.O10.classe1),
      'b5.O10.classe2': sum(rs, (m) => m.b5.O10.classe2),
      'b2.S3.grainesAvecTStar': rs.filter((r) => r.metrics.b2.S3.tStar !== null).length,
    },
    distributions,
    regroupees,
  }
}

const gagne = (a: RunMetrics, b: RunMetrics): boolean =>
  a.b1.morts < b.b1.morts || (a.b1.morts === b.b1.morts && a.T < b.T)

export const summarize = (results: readonly RunResult[]): Summary => {
  const waves = uniq(results.map((r) => r.spec.wave))
  const policies = uniq(results.map((r) => r.spec.policy))
  const weapons = uniq(results.map((r) => r.spec.weapon))
  const variants = uniq(results.map((r) => r.spec.variant))
  const seeds = uniq(results.map((r) => r.spec.seed)).sort((a, b) => a - b)
  const index = new Map(results.map((r) => [runKey(r.spec), r]))
  const get = (wave: string, policy: string, weapon: WeaponId, variant: Variant, seed: number) =>
    index.get(runKey({ ...DEFAULT_SPEC, wave, policy, weapon, variant, seed }))

  const cases: CaseSummary[] = []
  const pairs: PairSummary[] = []
  const variantRows: VariantSummary[] = []
  const seedRows: SeedRow[] = []
  for (const wave of waves) {
    for (const policy of policies)
      for (const weapon of weapons)
        for (const variant of variants) {
          const rs = seeds.flatMap((s) => get(wave, policy, weapon, variant, s) ?? [])
          if (rs.length > 0) cases.push(caseSummary(rs))
        }
    for (const weapon of weapons)
      for (const variant of variants) {
        for (const a of policies)
          for (const b of policies) {
            if (a === b) continue
            const paired = seeds.flatMap((s) => {
              const ra = get(wave, a, weapon, variant, s)
              const rb = get(wave, b, weapon, variant, s)
              return ra && rb ? [[ra.metrics, rb.metrics] as const] : []
            })
            if (paired.length === 0) continue
            const gA = paired.filter(([x, y]) => gagne(x, y)).length
            const gB = paired.filter(([x, y]) => gagne(y, x)).length
            const rT = paired.map(([x, y]) => (y.T - x.T) / y.T)
            const dV = paired.map(([x, y]) => y.b3.V - x.b3.V)
            pairs.push({
              wave,
              weapon,
              variant,
              a,
              b,
              n: paired.length,
              gagneA: gA,
              gagneB: gB,
              egalites: paired.length - gA - gB,
              W: ratio(gA, paired.length),
              M: median(paired.map(([x, y]) => x.T / y.T)),
              Delta: median(paired.map(([x, y]) => y.b1.perte - x.b1.perte)),
              rT: { median: median(rT), positifs: rT.filter((v) => v > 0).length },
              dV: { median: median(dV), positifs: dV.filter((v) => v > 0).length },
            })
          }
        for (const seed of seeds) {
          const runs: Record<string, SeedRow['runs'][string]> = {}
          for (const policy of policies) {
            const r = get(wave, policy, weapon, variant, seed)
            if (r)
              runs[policy] = {
                T: r.metrics.T,
                fini: r.fini,
                timeout: r.timeout,
                morts: r.metrics.b1.morts,
                perte: r.metrics.b1.perte,
                V: r.metrics.b3.V,
                D: r.metrics.D,
              }
          }
          if (Object.keys(runs).length > 0) seedRows.push({ wave, weapon, variant, seed, runs })
        }
      }
    if (variants.includes('A') && variants.includes('B'))
      for (const policy of policies)
        for (const weapon of weapons) {
          const both = seeds.flatMap((s) => {
            const ra = get(wave, policy, weapon, 'A', s)
            const rb = get(wave, policy, weapon, 'B', s)
            return ra && rb ? [[ra.metrics, rb.metrics] as const] : []
          })
          if (both.length === 0) continue
          const dRatios = both.flatMap(([a, b]) =>
            a.D !== null && b.D !== null && b.D > 0 ? [a.D / b.D] : [],
          )
          const exposure = both.flatMap(([a, b]) =>
            a.b4.O10.corpsTemps > 0 ? [b.b4.O10.corpsTemps / a.b4.O10.corpsTemps] : [],
          )
          variantRows.push({
            wave,
            policy,
            weapon,
            n: both.length,
            O5: median(dRatios),
            O10: median(exposure),
          })
        }
  }
  return { cases, pairs, variants: variantRows, seeds: seedRows }
}
