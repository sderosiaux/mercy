// pnpm forge <id> [--stage concept|model|rig|anim|post|validate|all] [--force] [--dry-run]
// Sortie standard : un résumé JSON sur une ligne. Progression (attente des tâches) sur la sortie d'erreur.
// Codes : 0 fait, 1 erreur ou validation refusée, 2 bloqué (clé absente, entrée manquante, valeur demandée).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createStore } from './cache'
import { spawnRunner } from './gptimage'
import { createMeshyClient } from './meshy/client'
import { parseAsset } from './schema'
import { type ForgeContext, STAGES, type StageName } from './stages/context'
import { runForge } from './stages/pipeline'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const fail = (code: number, message: string): never => {
  process.stdout.write(`${JSON.stringify({ erreur: message })}\n`)
  process.exit(code)
}

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    allowPositionals: true,
    options: {
      stage: { type: 'string', default: 'all' },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const id = positionals[0]
  if (!id)
    return fail(
      1,
      'usage : pnpm forge <id> [--stage concept|model|rig|anim|post|validate|all] [--force] [--dry-run]',
    )
  const stage = values.stage as string
  if (stage !== 'all' && !(STAGES as readonly string[]).includes(stage))
    return fail(1, `étape inconnue : ${stage}`)
  const file = join(ROOT, 'art', 'forge', id, 'asset.json')
  if (!existsSync(file)) return fail(1, `fiche absente : art/forge/${id}/asset.json`)
  const sheet = parseAsset(JSON.parse(readFileSync(file, 'utf8')))
  if (sheet.id !== id) return fail(1, `la fiche art/forge/${id} porte l'id ${sheet.id}`)

  const apiKey = process.env.MESHY_API_KEY
  const log = (msg: string): void => {
    process.stderr.write(`${msg}\n`)
  }
  const ctx: ForgeContext = {
    root: ROOT,
    sheet,
    store: createStore(ROOT, id),
    force: values.force === true,
    dryRun: values['dry-run'] === true,
    now: () => new Date(),
    meshy: apiKey
      ? createMeshyClient({
          apiKey,
          fetch: globalThis.fetch,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          now: () => Date.now(),
          log,
        })
      : null,
    runImage: spawnRunner,
    log,
  }
  const stages: StageName[] = stage === 'all' ? [...STAGES] : [stage as StageName]
  const summary = await runForge(ctx, stages)
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  const statuses = summary.etapes.map((e) => e.statut)
  const failed = statuses.some((s) => s === 'erreur' || s === 'refuse')
  // À blanc, une étape « bloquée » faute d'étape précédente est le plan attendu, pas un échec.
  process.exitCode = failed ? 1 : statuses.includes('bloque') && !ctx.dryRun ? 2 : 0
}

main().catch((e: unknown) => fail(1, e instanceof Error ? e.message : String(e)))
