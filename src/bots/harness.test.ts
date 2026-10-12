// Banc de bots : latence, fronts, fin de vague, plafonds, arme, mémoire, résumé apparié, et identité des sorties
// en série et en parallèle (worker threads).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IDLE_COMMANDS, type PlayerCommands } from '../sim/index'
import {
  DEFAULT_SPEC,
  makePolicy,
  mergeRegistries,
  POLICIES,
  parseArgs,
  parsePolicySpec,
  parseSeeds,
  planFromArgs,
  playRun,
  type RunResult,
  type RunSpec,
  runKey,
  summarize,
} from './harness'
import type { Policy } from './policy'

const spec = (patch: Partial<RunSpec> = {}): RunSpec => ({
  ...DEFAULT_SPEC,
  wave: 'V1',
  policy: 'ref-inerte',
  seed: 1,
  ...patch,
})

// Politique témoin : note dans le point visé le tick de décision (x) et sa mémoire (z), qui compte les appels.
const recorder: Policy<number> = {
  name: 'témoin',
  init: () => 0,
  decide: (w, m) => [{ ...IDLE_COMMANDS, aim: { x: w.tick, z: m } }, m + 1],
}

describe('registre et arguments', () => {
  it('réunit les politiques de référence et les lots C6b, C6c ; un nom en double est refusé', () => {
    expect(Object.keys(POLICIES)).toEqual(expect.arrayContaining(['ref-inerte', 'ref-frappeur']))
    const f = () => recorder as Policy
    expect(() => mergeRegistries({ a: f }, { b: f })).not.toThrow()
    expect(() => mergeRegistries({ a: f }, { a: f })).toThrow(/deux fois : a/)
  })
  it('nom de politique avec paramètres clé=valeur', () => {
    expect(parsePolicySpec('b5:D=60')).toEqual({ name: 'b5', params: { D: '60' } })
    expect(parsePolicySpec('s1:k=120:verbe=frappe')).toEqual({
      name: 's1',
      params: { k: '120', verbe: 'frappe' },
    })
    expect(parsePolicySpec('trieur')).toEqual({ name: 'trieur', params: {} })
    expect(() => parsePolicySpec('b5:D')).toThrow(/clé=valeur/)
    expect(() => makePolicy('inconnue')).toThrow(/politique inconnue/)
  })
  it('graines, arguments, plan', () => {
    expect(parseSeeds('1-3,7')).toEqual([1, 2, 3, 7])
    expect(() => parseSeeds('5-3')).toThrow()
    expect(() => parseSeeds('x')).toThrow()
    expect(parseArgs(['--', '--waves', 'V1,V2', '--raw', '--jobs=4'])).toEqual({
      waves: 'V1,V2',
      raw: 'true',
      jobs: '4',
    })
    const plan = planFromArgs(
      parseArgs([
        '--waves',
        'V2,V3',
        '--policies',
        'ref-inerte',
        '--seeds',
        '1-100',
        '--variants',
        'A,B',
        '--weapon',
        'couperet',
        '--latency',
        '12',
        '--timeout-ticks',
        '21600',
      ]),
    )
    expect(plan).toEqual({
      waves: ['V2', 'V3'],
      policies: ['ref-inerte'],
      seeds: Array.from({ length: 100 }, (_, i) => i + 1),
      variants: ['A', 'B'],
      weapons: ['couperet'],
      latency: 12,
      timeoutTicks: 21600,
      timeoutFrom: 'start',
      tailTicks: 0,
    })
    expect(() => planFromArgs({ policies: 'ref-inerte', waves: 'V9' })).toThrow(/vague inconnue/)
    expect(() => planFromArgs({ policies: 'ref-inerte', variants: 'C' })).toThrow(/variante/)
    expect(() => planFromArgs({ policies: 'ref-inerte', 'timeout-from': 'x' })).toThrow(/timeout-from/)
    expect(() => planFromArgs({})).toThrow(/--policies/)
  })
})

describe('une partie', () => {
  it('latence (B4 I3) : les commandes du tick t s’appliquent au tick t + 12, les 12 premiers ticks reçoivent IDLE', () => {
    const { trace } = playRun(spec({ latency: 12, timeoutTicks: 40 }), {
      keepCommands: true,
      policy: recorder as Policy,
    })
    const cmds = trace.commands as PlayerCommands[]
    expect(cmds).toHaveLength(40)
    for (let k = 0; k < 12; k++) expect(cmds[k]).toEqual(IDLE_COMMANDS)
    for (let k = 12; k < 40; k++) expect(cmds[k]?.aim).toEqual({ x: k - 12, z: k - 12 })
  })
  it('sans latence, la mémoire suit les ticks et les pressions passent telles quelles (B3 I10)', () => {
    const presser: Policy<number> = {
      name: 'presseur',
      init: () => 0,
      decide: (w, m) => [
        { ...IDLE_COMMANDS, aim: { x: w.tick, z: m }, dodge: true, sentence: true, rite: 'charge' },
        m + 1,
      ],
    }
    const { trace } = playRun(spec({ timeoutTicks: 30 }), { keepCommands: true, policy: presser as Policy })
    const cmds = trace.commands as PlayerCommands[]
    cmds.forEach((c, k) => {
      expect(c).toEqual({
        ...IDLE_COMMANDS,
        aim: { x: k, z: k },
        dodge: true,
        sentence: true,
        rite: 'charge',
      })
    })
    // Deux charges d'Esquive : la simulation prend chaque vrai comme une pression.
    expect(trace.events.filter((e) => e.type === 'player-dodge')).toHaveLength(2)
  })
  it('fin de vague détectée : T = premier tick où tout est mort ; --tail-ticks prolonge sans changer T', () => {
    const { result } = playRun(spec({ wave: 'S1', policy: 'ref-frappeur' }))
    expect(result.fini).toBe(true)
    expect(result.timeout).toBe(false)
    expect(result.metrics.T).toBe(result.endTick)
    const tail = playRun(spec({ wave: 'S1', policy: 'ref-frappeur', tailTicks: 180 })).result
    expect(tail.endTick).toBe(result.endTick + 180)
    expect(tail.metrics.T).toBe(result.metrics.T)
  })
  it('plafond : depuis le tick 0 (B1, B3) ou depuis T0 (B4 I5), drapeau timeout', () => {
    const fromStart = playRun(spec({ wave: 'S1', timeoutTicks: 50 })).result
    expect(fromStart).toMatchObject({ fini: false, timeout: true, endTick: 50 })
    expect(fromStart.metrics.T).toBe(50)
    expect(fromStart.metrics.T0).toBe(1) // alerte de proximité au tick 1
    const fromT0 = playRun(spec({ wave: 'S1', timeoutTicks: 50, timeoutFrom: 't0' })).result
    expect(fromT0).toMatchObject({ timeout: true, endTick: 51 })
    // Sans T0, le plafond compte depuis le tick 0 : la partie s'arrête quand même.
    expect(playRun(spec({ timeoutTicks: 30, timeoutFrom: 't0' })).result.endTick).toBe(30)
  })
  it("--weapon masse : l'arme est en main dès la création du monde, aucune commande de changement (B4, vérificateur)", () => {
    const masse = playRun(spec({ weapon: 'masse', timeoutTicks: 5 }), { keepCommands: true })
    expect(masse.result.weaponAt).toBe(0)
    expect(masse.trace.commands?.every((c) => !c.swapWeapon)).toBe(true)
    expect(masse.trace.events.some((e) => e.type === 'weapon-swap')).toBe(false)
    const couperet = playRun(spec({ timeoutTicks: 5 }), { keepCommands: true })
    expect(couperet.result.weaponAt).toBe(0)
  })
  it("faucheur-masse avec 12 ticks de latence garde la Masse toute la partie (plus d'oscillation d'arme)", () => {
    const r = playRun(
      spec({ wave: 'V2', policy: 'faucheur-masse', weapon: 'masse', latency: 12, timeoutTicks: 3000 }),
      {
        keepCommands: true,
      },
    )
    expect(r.trace.events.some((e) => e.type === 'weapon-swap')).toBe(false)
    expect(
      r.trace.events
        .filter((e) => e.type === 'hit' && e.by === 'player')
        .every((e) => e.type === 'hit' && e.damageType === 'contondant'),
    ).toBe(true)
  })
  it('déterministe : même spécification, même JSON', () => {
    const s = spec({ wave: 'V6', policy: 'ref-frappeur', seed: 4, variant: 'B' })
    expect(JSON.stringify(playRun(s).result)).toBe(JSON.stringify(playRun(s).result))
  })
  it('les évènements du monde initial sont dans le journal (S-sat : 36 fell au tick 0)', () => {
    const { trace } = playRun(spec({ wave: 'S-sat', timeoutTicks: 10 }))
    expect(trace.events.filter((e) => e.type === 'fell' && e.tick === 0)).toHaveLength(36)
    expect(trace.series[0]?.tick).toBe(0)
    expect(trace.series).toHaveLength(11)
  })
})

describe('résumé apparié', () => {
  const base = playRun(spec({ timeoutTicks: 5 })).result
  type Patch = { T: number; morts: number; perte: number; V: number; D?: number; corps?: number }
  // Une vraie partie dont on réécrit les seules mesures que le résumé apparie.
  const fake = (s: Partial<RunSpec>, p: Patch): RunResult => {
    const r = structuredClone(base) as unknown as {
      spec: RunSpec
      fini: boolean
      metrics: {
        T: number
        D: number | null
        b1: { morts: number; perte: number }
        b3: { V: number }
        b4: { O10: { corpsTemps: number } }
      }
    }
    r.spec = spec(s)
    r.fini = true
    r.metrics.T = p.T
    r.metrics.D = p.D ?? null
    r.metrics.b1.morts = p.morts
    r.metrics.b1.perte = p.perte
    r.metrics.b3.V = p.V
    r.metrics.b4.O10.corpsTemps = p.corps ?? 0
    return r as unknown as RunResult
  }
  const rows: [number, Patch, Patch][] = [
    [1, { T: 100, morts: 0, perte: 10, V: 10, D: 100, corps: 10 }, { T: 50, morts: 1, perte: 30, V: 30 }], // a : moins de morts
    [2, { T: 200, morts: 0, perte: 5, V: 5, D: 200, corps: 0 }, { T: 100, morts: 0, perte: 0, V: 0 }], // b : plus rapide
    [3, { T: 100, morts: 0, perte: 20, V: 20, D: 300, corps: 20 }, { T: 100, morts: 0, perte: 20, V: 20 }], // égalité
    [4, { T: 80, morts: 0, perte: 0, V: 0, D: 400, corps: 40 }, { T: 100, morts: 0, perte: 50, V: 50 }], // a gagne
  ]
  const resultsA = rows.flatMap(([seed, a, b]) => [
    fake({ policy: 'a', seed, variant: 'A' }, a),
    fake({ policy: 'b', seed, variant: 'A' }, b),
  ])
  // Variante B de la politique a : D(B) et corps-temps(B), graine par graine.
  const resultsB = [
    [1, 100, 5],
    [2, 100, 7],
    [3, 150, 20],
    [4, 0, 10],
  ].map(([seed, D, corps]) =>
    fake({ policy: 'a', seed: seed as number, variant: 'B' }, { T: 1, morts: 0, perte: 0, V: 0, D, corps }),
  )
  const s = summarize([...resultsA, ...resultsB])

  it('B1 : gagne(a, b), égalités, W, M = médiane T(a)/T(b), Δ = médiane perte(b) − perte(a)', () => {
    const p = s.pairs.find((x) => x.a === 'a' && x.b === 'b' && x.variant === 'A')
    expect(p).toMatchObject({ n: 4, gagneA: 2, gagneB: 1, egalites: 1, W: 0.5, M: 1.5, Delta: 10 })
  })
  it('B3 : rT(a/b) = (T_b − T_a) / T_b et dV(a/b) = V_b − V_a, médianes et graines positives', () => {
    const p = s.pairs.find((x) => x.a === 'a' && x.b === 'b' && x.variant === 'A')
    expect(p?.rT).toEqual({ median: -0.5, positifs: 1 })
    expect(p?.dV).toEqual({ median: 10, positifs: 2 })
  })
  it('B4.O5 et O10 : rapports appariés A/B (D(B) nul et corps-temps A nul écartés)', () => {
    const v = s.variants.find((x) => x.policy === 'a')
    expect(v).toMatchObject({ n: 4, O5: 2, O10: 0.5 })
  })
  it('cases : distributions par graine, finis, T distincts ; table appariée par graine', () => {
    const c = s.cases.find((x) => x.policy === 'a' && x.variant === 'A')
    expect(c).toMatchObject({ n: 4, finis: 4, Tdistincts: 3 })
    expect(c?.distributions.T).toMatchObject({ n: 4, median: 100, min: 80, max: 200 })
    const row = s.seeds.find((x) => x.seed === 1 && x.variant === 'A')
    expect(row?.runs.a).toMatchObject({ T: 100, morts: 0, perte: 10 })
    expect(row?.runs.b).toMatchObject({ T: 50, morts: 1, perte: 30 })
  })
  it('clé de fichier stable', () => {
    expect(runKey(spec({ wave: 'V5', policy: 'b5:D=60', variant: 'B', seed: 3 }))).toBe(
      'V5__b5_D=60__couperet__B__s3',
    )
  })
})

describe('exécution parallèle (worker threads) et exécution série', () => {
  it('produisent les mêmes fichiers JSON, identiques à playRun', { timeout: 120_000 }, () => {
    const tsx = join(process.cwd(), 'node_modules/.bin/tsx')
    const args = [
      'scripts/bots.ts',
      '--waves',
      'V1,V4,V6',
      '--policies',
      'ref-frappeur,ref-inerte',
      '--seeds',
      '1-3',
      '--variants',
      'A,B',
      '--latency',
      '6',
      '--timeout-ticks',
      '1500',
    ]
    const serial = mkdtempSync(join(tmpdir(), 'c6a-serie-'))
    const parallel = mkdtempSync(join(tmpdir(), 'c6a-parallele-'))
    execFileSync(tsx, [...args, '--jobs', '1', '--out', serial], { stdio: 'pipe' })
    execFileSync(tsx, [...args, '--jobs', '4', '--out', parallel], { stdio: 'pipe' })
    const files = readdirSync(join(serial, 'runs')).sort()
    expect(files).toHaveLength(3 * 2 * 2 * 3)
    expect(readdirSync(join(parallel, 'runs')).sort()).toEqual(files)
    for (const f of files) {
      expect(readFileSync(join(parallel, 'runs', f), 'utf8')).toBe(
        readFileSync(join(serial, 'runs', f), 'utf8'),
      )
    }
    expect(readFileSync(join(parallel, 'summary.json'), 'utf8')).toBe(
      readFileSync(join(serial, 'summary.json'), 'utf8'),
    )
    const one = spec({
      wave: 'V4',
      policy: 'ref-frappeur',
      seed: 2,
      variant: 'B',
      latency: 6,
      timeoutTicks: 1500,
    })
    expect(readFileSync(join(parallel, 'runs', `${runKey(one)}.json`), 'utf8')).toBe(
      `${JSON.stringify(playRun(one).result, null, 1)}\n`,
    )
  })
})
