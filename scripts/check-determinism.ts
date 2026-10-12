// Porte de déterminisme.
// Partie 1 : dans src/sim, src/metrics et src/bots (hors tests), interdit ce qui dépend de l'hôte : hasard hors du
// PRNG du monde, horloges, minuteries, DOM, Web Audio, globales de l'hôte, et la trigonométrie native, approximée par
// le moteur JS (Chrome et Node diffèrent parfois au dernier bit ; src/sim/dmath.ts calcule en + − × ÷ et √). Les bots
// suivent la règle de la simulation : dev/crosscheck.ts rejoue dans Node une partie de bot jouée dans le navigateur.
// Partie 2 : chaque journal figé de fixtures/inputs, rejoué 100 fois dans ce processus puis une fois dans un processus
// Node séparé, donne le même hash final. Un état caché au niveau module ou une valeur propre au processus ferait
// diverger les deux. Les journaux, ensemble, font agir les cinq familles du registre.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createWorld,
  FAMILIES,
  type FamilyKind,
  hashWorld,
  type PlayerCommands,
  type SimEvent,
  step,
  type Variant,
  type WaveDef,
} from '../src/sim/index'

const SCANNED = ['src/sim', 'src/metrics', 'src/bots']
const ALLOW = new Set(['src/sim/dmath.ts'])
const BANNED: readonly (readonly [RegExp, string])[] = [
  [/Math\.random\b/, 'utiliser le PRNG du monde (rng.ts)'],
  [/\bMath\s*\[/, 'accès indirect à Math : écrire Math.<nom> (sinon ce contrôle ne le voit pas)'],
  [/\bDate\s*\(|\bDate\.now\b/, "pas d'horloge murale"],
  [/\bperformance\b/, "pas d'horloge murale"],
  [
    /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\b/,
    'pas de minuterie : le temps est le tick',
  ],
  [/\bcrypto\b/, 'utiliser le PRNG du monde'],
  [
    /\b(window|document|navigator|localStorage|sessionStorage)\b/,
    'pas de DOM : ce code tourne aussi dans Node',
  ],
  [
    /\b(AudioContext|OfflineAudioContext|webkitAudioContext)\b/,
    "pas de Web Audio : l'audio lit les évènements",
  ],
  [/\bglobalThis\b/, "pas d'accès aux globales de l'hôte"],
  [/\bprocess\b/, "pas d'accès au processus Node"],
  [
    /Math\.(sin|cos|tan|asin|acos|atan|atan2|hypot|pow|exp|expm1|log|log2|log10|log1p|cbrt|sinh|cosh|tanh)\b/,
    'approximé par le moteur JS : utiliser dsin, dcos, datan2, dhypot, dpowInt (src/sim/index.ts)',
  ],
  [/[\w)\]]\s*\*\*\s*[\w(]/, '** passe par Math.pow : utiliser dpowInt'],
]

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })

const scan = (): number => {
  let bad = 0
  for (const file of SCANNED.flatMap(walk).filter((f) => !ALLOW.has(f))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) return
        const code = line.replace(/(^|\s)\/\/.*$/, '') // commentaire de fin de ligne (pas « http:// »)
        for (const [re, why] of BANNED) {
          if (re.test(code)) {
            console.error(`${file}:${i + 1}: ${re.source} : ${why}\n    ${line.trim()}`)
            bad++
          }
        }
      })
  }
  return bad
}

interface Log {
  readonly seed: number
  readonly variant: Variant
  readonly wave: WaveDef
  readonly commands: readonly PlayerCommands[]
}

const FIXTURES = 'fixtures/inputs'
const readLogs = (): { readonly name: string; readonly log: Log }[] =>
  readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({ name, log: JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Log }))

// Rejeu avec le registre du jeu. `onEvents` reçoit les évènements de chaque tick et la famille de chaque id.
const replay = (
  log: Log,
  onEvents?: (events: readonly SimEvent[], family: Map<number, FamilyKind>) => void,
) => {
  let w = createWorld({ seed: log.seed, variant: log.variant, wave: log.wave, families: FAMILIES })
  const family = new Map<number, FamilyKind>()
  for (const c of log.commands) {
    w = step(w, c)
    if (onEvents) {
      for (const k of w.creatures) family.set(k.id, k.family)
      onEvents(w.events, family)
    }
  }
  return hashWorld(w)
}

// Une famille agit : une de ses créatures commence une action, absorbe un corps ou éclate.
const actorOf = (e: SimEvent): number | null =>
  e.type === 'action-start' || e.type === 'absorb' || e.type === 'burst' ? e.id : null

const CHILD_FLAG = '--rejeu-seul'

if (process.argv.includes(CHILD_FLAG)) {
  // Processus séparé : un rejeu de chaque journal, hashs sur la sortie standard.
  console.log(JSON.stringify(Object.fromEntries(readLogs().map(({ name, log }) => [name, replay(log)]))))
  process.exit(0)
}

const bad = scan()
if (bad > 0) {
  console.error(`\n${bad} violation(s) de déterminisme`)
  process.exit(1)
}
console.log(`déterminisme (interdits) : propre (${SCANNED.join(', ')})`)

const REPLAYS = 100
const logs = readLogs()
if (logs.length < 3) {
  console.error(`il faut au moins 3 journaux dans ${FIXTURES}, trouvé ${logs.length}`)
  process.exit(1)
}
const acting = new Set<FamilyKind>()
const local: Record<string, string> = {}
for (const { name, log } of logs) {
  const hashes = new Set<string>()
  hashes.add(
    replay(log, (events, family) => {
      for (const e of events) {
        const id = actorOf(e)
        const f = id === null ? undefined : family.get(id)
        if (f) acting.add(f)
      }
    }),
  )
  for (let r = 1; r < REPLAYS; r++) hashes.add(replay(log))
  if (hashes.size !== 1) {
    console.error(`${name} : ${hashes.size} hashs différents sur ${REPLAYS} rejeux`)
    process.exit(1)
  }
  local[name] = [...hashes][0] as string
  console.log(`rejeu ${name} : ${REPLAYS} × ${log.commands.length} ticks, hash ${local[name]}`)
}

const missing = Object.keys(FAMILIES).filter((f) => !acting.has(f as FamilyKind))
if (missing.length > 0) {
  console.error(`aucun journal de ${FIXTURES} ne fait agir : ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`familles qui agissent dans les journaux : ${[...acting].sort().join(', ')}`)

const child = JSON.parse(
  execFileSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), CHILD_FLAG], {
    encoding: 'utf8',
    maxBuffer: 1 << 20,
  }),
) as Record<string, string>
const diverging = logs.filter(({ name }) => child[name] !== local[name])
for (const { name } of diverging) {
  console.error(`${name} : hash ${local[name]} ici, ${child[name] ?? 'absent'} dans un processus séparé`)
}
if (diverging.length > 0) process.exit(1)
console.log(`rejeu dans un processus séparé : ${logs.length} journaux, mêmes hashs`)
