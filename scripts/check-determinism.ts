// Interdit les API non déterministes dans src/sim. Le rejeu et les bots en dépendent.
// Inspiré de ~/code/games/cabin-37/scripts/check-determinism.ts, sans l'interdit de trigonométrie :
// P0 exige le rejeu dans un même moteur, pas entre moteurs.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createWorld, hashWorld, type PlayerCommands, souriant, step, type WaveDef } from '../src/sim/index'

const SIM_DIR = 'src/sim'
const BANNED: readonly (readonly [RegExp, string])[] = [
  [/Math\.random\b/, 'utiliser le PRNG du monde (rng.ts)'],
  [/Date\.now\b|new Date\(/, "pas d'horloge murale dans la simulation"],
  [/performance\.now\b/, "pas d'horloge murale dans la simulation"],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\b/, 'pas de minuterie : le temps est le tick'],
  [/\bcrypto\.(getRandomValues|randomUUID)\b/, 'utiliser le PRNG du monde'],
]

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })

let bad = 0
for (const file of walk(SIM_DIR)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return
      for (const [re, why] of BANNED) {
        if (re.test(line)) {
          console.error(`${file}:${i + 1}: ${re.source} : ${why}\n    ${line.trim()}`)
          bad++
        }
      }
    })
}
if (bad > 0) {
  console.error(`\n${bad} violation(s) de déterminisme`)
  process.exit(1)
}
console.log('déterminisme (interdits) : propre')

// Partie 2 : chaque journal figé, rejoué 100 fois, donne le même hash final.
const FIXTURES = 'fixtures/inputs'
const REPLAYS = 100
const logs = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))
if (logs.length < 3) {
  console.error(`il faut au moins 3 journaux dans ${FIXTURES}, trouvé ${logs.length}`)
  process.exit(1)
}
for (const name of logs) {
  const log = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    seed: number
    variant: 'A' | 'B'
    wave: WaveDef
    commands: PlayerCommands[]
  }
  const hashes = new Set<string>()
  for (let r = 0; r < REPLAYS; r++) {
    let w = createWorld({ seed: log.seed, variant: log.variant, wave: log.wave, families: { souriant } })
    for (const c of log.commands) w = step(w, c)
    hashes.add(hashWorld(w))
  }
  if (hashes.size !== 1) {
    console.error(`${name} : ${hashes.size} hashs différents sur ${REPLAYS} rejeux`)
    process.exit(1)
  }
  console.log(`rejeu ${name} : ${REPLAYS} × ${log.commands.length} ticks, hash ${[...hashes][0]}`)
}
