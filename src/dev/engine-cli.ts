// Compare l'empreinte du moteur du navigateur (window.__mercy.engine.fingerprint(o), sauvée en JSON) à celle de Node,
// sur les mêmes parties. Dit si une télémétrie de ce navigateur se rejoue à l'identique dans ce Node.
//   pnpm exec tsx src/dev/engine-cli.ts <empreinte-navigateur.json>
import { readFileSync } from 'node:fs'
import {
  compareEngines,
  type EngineRow,
  engineFingerprint,
  type FingerprintRequest,
  mathProbe,
} from './engine'

interface Dump {
  readonly request: FingerprintRequest
  readonly moteur: string
  readonly rows: readonly EngineRow[]
  readonly math: Record<string, string[]>
}

const main = (): number => {
  const file = process.argv.slice(2).find((a) => a !== '--')
  if (file === undefined) {
    console.log('pnpm exec tsx src/dev/engine-cli.ts <empreinte-navigateur.json>')
    return 1
  }
  const browser = JSON.parse(readFileSync(file, 'utf8')) as Dump
  const node = { rows: engineFingerprint(browser.request), math: mathProbe() }
  const c = compareEngines(browser, node)
  console.log(
    JSON.stringify(
      { navigateur: browser.moteur, node: `${process.version} (V8 ${process.versions.v8})`, ...c },
      null,
      2,
    ),
  )
  return c.finDifferente === 0 && c.monde0Differents === 0 ? 0 : 1
}

try {
  process.exit(main())
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
