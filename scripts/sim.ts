// pnpm sim -- --wave V3 --policy ref-frappeur --seed 7 --variant A [--weapon couperet] [--latency 0]
//             [--timeout-ticks 21600] [--timeout-from start|t0] [--tail-ticks 0] [--series] [--commands] [--out f.json]
// Joue une partie et sort ses évènements bruts (JSON), avec le résultat et les métriques de la partie.
import { writeFileSync } from 'node:fs'
import { expandPlan, parseArgs, planFromArgs, playRun } from '../src/bots/harness'

const main = (): void => {
  const args = parseArgs(process.argv.slice(2))
  if (args.help !== undefined) {
    console.log(
      'pnpm sim -- --wave V1 --policy ref-frappeur [--seed 1] [--variant A] [--weapon couperet] [--latency 0] ' +
        '[--timeout-ticks 21600] [--timeout-from start|t0] [--tail-ticks 0] [--series] [--commands] [--out f.json]',
    )
    return
  }
  const specs = expandPlan(planFromArgs(args))
  const spec = specs[0]
  if (specs.length !== 1 || !spec) {
    throw new Error(
      'pnpm sim joue une seule partie : une vague, une politique, une graine, une variante, une arme',
    )
  }
  const { result, trace } = playRun(spec, { keepCommands: args.commands === 'true' })
  const out = {
    ...result,
    events: trace.events,
    ...(args.series === 'true' ? { series: trace.series, notes: trace.notes } : {}),
    ...(args.commands === 'true' ? { commands: trace.commands } : {}),
  }
  const json = `${JSON.stringify(out)}\n`
  if (args.out !== undefined && args.out !== 'true') writeFileSync(args.out, json)
  else process.stdout.write(json)
}

try {
  main()
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
