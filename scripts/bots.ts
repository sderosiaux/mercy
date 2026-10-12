// pnpm bots -- --waves V2,V3 --policies a,b --seeds 1-100 --variants A,B --weapon couperet --latency 12
//              --timeout-ticks 21600 [--timeout-from start|t0] [--tail-ticks 0] [--jobs N] [--raw] --out <dossier>
// Une sortie JSON par (vague, politique, arme, variante, graine) dans <dossier>/runs/, plus <dossier>/summary.json
// (distributions médiane, p10, p90 et appariement graine par graine). Les parties sont réparties sur des worker
// threads ; le résultat ne dépend pas de --jobs (le fichier se relance lui-même comme worker).
import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { isMainThread, parentPort, Worker } from 'node:worker_threads'
import {
  expandPlan,
  parseArgs,
  planFromArgs,
  playRun,
  type RunResult,
  type RunSpec,
  type RunTrace,
  runKey,
  summarize,
} from '../src/bots/harness'

interface Job {
  readonly index: number
  readonly spec: RunSpec
  readonly raw: boolean
}
interface Done {
  readonly index: number
  readonly result: RunResult
  readonly trace: RunTrace | null
}

const work = (job: Job): Done => {
  const { result, trace } = playRun(job.spec, { keepCommands: job.raw })
  return { index: job.index, result, trace: job.raw ? trace : null }
}

const runPool = (jobs: readonly Job[], n: number, onDone: (d: Done) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    let next = 0
    let finished = 0
    let failed = false
    const workers: Worker[] = []
    const feed = (w: Worker): void => {
      const job = jobs[next++]
      if (job) w.postMessage(job)
    }
    for (let i = 0; i < Math.min(n, jobs.length); i++) {
      const w = new Worker(new URL(import.meta.url))
      workers.push(w)
      w.on('message', (d: Done) => {
        onDone(d)
        finished++
        if (finished === jobs.length) {
          for (const x of workers) void x.terminate()
          resolve()
        } else feed(w)
      })
      w.on('error', (e) => {
        if (failed) return
        failed = true
        for (const x of workers) void x.terminate()
        reject(e)
      })
      feed(w)
    }
    if (jobs.length === 0) resolve()
  })

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  if (args.help !== undefined) {
    console.log(
      'pnpm bots -- --policies a,b [--waves V1,…] [--seeds 1-100] [--variants A,B] [--weapon couperet] ' +
        '[--latency 0] [--timeout-ticks 21600] [--timeout-from start|t0] [--tail-ticks 0] [--jobs N] [--raw] --out <dossier>',
    )
    return
  }
  const out = args.out
  if (out === undefined || out === 'true') throw new Error('--out <dossier> est obligatoire')
  const plan = planFromArgs(args)
  const specs = expandPlan(plan)
  const raw = args.raw === 'true'
  const jobsArg = args.jobs === undefined ? availableParallelism() : Number(args.jobs)
  if (!Number.isInteger(jobsArg) || jobsArg < 1)
    throw new Error(`--jobs attend un entier ≥ 1, reçu « ${args.jobs} »`)
  const runsDir = join(out, 'runs')
  mkdirSync(runsDir, { recursive: true })
  const results: (RunResult | undefined)[] = specs.map(() => undefined)
  const save = (d: Done): void => {
    results[d.index] = d.result
    const key = runKey(d.result.spec)
    writeFileSync(join(runsDir, `${key}.json`), `${JSON.stringify(d.result, null, 1)}\n`)
    if (d.trace) writeFileSync(join(runsDir, `${key}.raw.json`), `${JSON.stringify(d.trace)}\n`)
  }
  const jobs: Job[] = specs.map((spec, index) => ({ index, spec, raw }))
  const started = Date.now()
  if (jobsArg === 1) for (const j of jobs) save(work(j))
  else await runPool(jobs, jobsArg, save)
  const all = results.filter((r): r is RunResult => r !== undefined)
  if (all.length !== specs.length) throw new Error(`${specs.length - all.length} partie(s) sans résultat`)
  const summary = summarize(all)
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify({ plan, summary }, null, 1)}\n`)

  const f = (v: number | null | undefined, d = 0): string =>
    v === null || v === undefined ? '-' : v.toFixed(d)
  console.log(
    'vague  politique            arme      var  n   finis  plafond  T méd [p10 ; p90]        perte méd  morts méd',
  )
  for (const c of summary.cases) {
    const T = c.distributions.T
    const perte = c.distributions['b1.perte']
    const morts = c.distributions['b1.morts']
    console.log(
      [
        c.wave.padEnd(6),
        c.policy.padEnd(20),
        c.weapon.padEnd(9),
        c.variant.padEnd(4),
        String(c.n).padEnd(3),
        String(c.finis).padEnd(6),
        String(c.timeouts).padEnd(8),
        `${f(T?.median)} [${f(T?.p10)} ; ${f(T?.p90)}]`.padEnd(24),
        f(perte?.median, 1).padEnd(10),
        f(morts?.median, 1),
      ].join(' '),
    )
  }
  for (const p of summary.pairs) {
    if (p.a > p.b) continue
    console.log(
      `${p.wave} ${p.weapon} ${p.variant} ${p.a} contre ${p.b} : n=${p.n} gagne=${p.gagneA}/${p.gagneB} ` +
        `égalités=${p.egalites} W=${f(p.W, 2)} M=${f(p.M, 2)} Δperte=${f(p.Delta, 1)} rT=${f(p.rT.median, 2)} dV=${f(p.dV.median, 1)}`,
    )
  }
  console.log(
    `${specs.length} partie(s), ${jobsArg === 1 ? 'série' : `${jobsArg} workers`}, ${((Date.now() - started) / 1000).toFixed(1)} s → ${out}`,
  )
}

if (isMainThread) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
} else {
  parentPort?.on('message', (job: Job) => parentPort?.postMessage(work(job)))
}
