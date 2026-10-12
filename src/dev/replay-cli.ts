// Rejeu hors navigateur d'une télémétrie exportée par le panneau de dev ou window.__mercy.
//   pnpm exec tsx src/dev/replay-cli.ts <export.json> [--correspondance <fichier>] [--banc]
// Recrée le monde initial (vague, graine, variante), applique chaque commande enregistrée, et compare le hash
// final, les évènements, la série, les notes et les métriques au fichier. --correspondance : obligatoire pour un
// export à l'aveugle (B4 I7). --banc : pour une partie de bot, rejoue aussi la politique dans le banc (playRun,
// celui de `pnpm sim`) et compare. Sortie JSON. Code de sortie : 0 rejeu identique au bit près (tous les points de
// contrôle) ; 2 même hash final et mêmes mesures, avec un état intermédiaire différent ; 1 rejeu différent.
import { readFileSync } from 'node:fs'
import { parseArgs } from '../bots/harness'
import { parseCorrespondence } from './blind'
import { crossCheckHarness } from './crosscheck'
import { parseTelemetry, replayTelemetry, variantOf } from './telemetry'

// Seul --correspondance prend une valeur ; tout autre mot hors option est le fichier à rejouer.
const split = (argv: readonly string[]): { file: string | undefined; options: string[] } => {
  const options: string[] = []
  let file: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--') continue
    if (a.startsWith('--')) {
      options.push(a)
      const v = argv[i + 1]
      if (a === '--correspondance' && v !== undefined && !v.startsWith('--')) {
        options.push(v)
        i++
      }
    } else file ??= a
  }
  return { file, options }
}

const main = (): number => {
  const { file, options } = split(process.argv.slice(2))
  const args = parseArgs(options)
  if (file === undefined || args.help !== undefined) {
    console.log('pnpm exec tsx src/dev/replay-cli.ts <export.json> [--correspondance <fichier>] [--banc]')
    return file === undefined ? 1 : 0
  }
  const f = parseTelemetry(readFileSync(file, 'utf8'))
  const corrPath = args.correspondance
  const correspondence =
    corrPath !== undefined && corrPath !== 'true'
      ? parseCorrespondence(JSON.parse(readFileSync(corrPath, 'utf8')))
      : undefined
  const r = replayTelemetry(f, { correspondence })
  const banc =
    args.banc === 'true' && f.meta.politique !== null
      ? crossCheckHarness(f, variantOf(f, correspondence))
      : null
  const bancOk = banc === null || banc.identique
  // 0 : rejeu identique au bit près ; 2 : même hash final et mêmes mesures, mais un état intermédiaire diffère
  // (écart de moteur JS absorbé en cours de partie) ; 1 : rejeu différent.
  const code = !bancOk ? 1 : r.identique ? 0 : r.memeHashFinalEtMemesMesures ? 2 : 1
  console.log(
    JSON.stringify(
      {
        fichier: file,
        vague: f.meta.vague,
        graine: f.meta.graine,
        variante: r.variante,
        aveugle: f.meta.aveugle,
        politique: f.meta.politique,
        commandes: r.ticks,
        tickFinal: r.fin,
        hashEnregistre: f.meta.hashFinal,
        hashRejoue: r.hashFinal,
        rejeu: r,
        banc,
        identique: r.identique && bancOk,
        codeDeSortie: code,
      },
      null,
      2,
    ),
  )
  return code
}

try {
  process.exit(main())
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
