// Câblage de P0 (C8) : écran titre, boucle à pas fixe, entrées ou bot, simulation, rendu, HUD, audio.
// Paramètres d'URL : wave (V1 par défaut), seed (1), variant (A).
import { createAudio } from './audio/engine'
import type { CommandSource, GameHost, GameStart } from './game/host'
import { advance, initialLoop, type LoopState } from './game/loop'
import { createInput } from './input/input'
import { createHud, createRenderer, cssVariables, SCREEN_RIGHT } from './render/index'
import { createWorld, FAMILIES, type PlayerCommands, step, type Variant, type World } from './sim/index'
import { isWaveId, waveById } from './sim/waves'

// Gel d'image au coup du joueur (§8.1) : 50 ms au Couperet, 90 ms à la Masse. Rendu seulement.
const HIT_FREEZE_MS = { couperet: 50, masse: 90 } as const

const params = new URLSearchParams(location.search)
const startOf = (): GameStart => {
  const wave = params.get('wave') ?? 'V1'
  const seed = Number(params.get('seed') ?? '1')
  const variant: Variant = params.get('variant') === 'B' ? 'B' : 'A'
  return { wave: isWaveId(wave) ? wave : 'V1', seed: Number.isFinite(seed) ? seed : 1, variant }
}

const newWorld = (s: GameStart): World =>
  createWorld({ seed: s.seed, variant: s.variant, wave: waveById(s.wave), families: FAMILIES })

const canvas = document.getElementById('view') as HTMLCanvasElement
const shell = document.body
shell.style.cssText = `${cssVariables()}; margin:0; overflow:hidden; background: var(--noir);`
canvas.style.cssText = 'display:block; width:100vw; height:100vh;'

const renderer = createRenderer(canvas, { antialias: false }) // pas de MSAA en P0 (ruling C4 R9)
const hud = createHud(shell)
const input = createInput(canvas, renderer.screenToGround)
const audio = createAudio({ screenRight: SCREEN_RIGHT })

let current = startOf()
let world = newWorld(current)
let prev = world
let loop: LoopState = initialLoop
let running = false
let paused = false
let frozenUntil = 0
let source: CommandSource | null = null
let filter: ((c: PlayerCommands) => PlayerCommands) | null = null
const stepListeners = new Set<(w: World, c: PlayerCommands) => void>()
const frameListeners = new Set<(ms: number) => void>()

const host: GameHost = {
  world: () => world,
  start: () => current,
  restart: (next) => {
    current = next
    world = newWorld(next)
    prev = world
    loop = initialLoop
    renderer.debug.clearGore() // pas de sang de la partie précédente (requête C7 R4)
    audio.reset() // le moteur audio repart à zéro avec le tick (requête C7 R3)
  },
  setCommandSource: (s) => {
    source = s
  },
  setCommandFilter: (f) => {
    filter = f
  },
  setPaused: (p) => {
    paused = p
  },
  stepOnce: () => {
    simulate()
    renderer.render(world, prev, 1)
    hud.update(world)
  },
  onStep: (l) => {
    stepListeners.add(l)
    return () => stepListeners.delete(l)
  },
  onFrame: (l) => {
    frameListeners.add(l)
    return () => frameListeners.delete(l)
  },
  renderer,
  audio,
}

const playerStruck = (w: World): boolean => w.events.some((e) => e.type === 'hit' && e.by === 'player')

const simulate = (): PlayerCommands => {
  const raw = source ? source(world) : input.sample()
  const commands = filter ? filter(raw) : raw
  prev = world
  world = step(world, commands)
  renderer.setAim(commands.aim)
  renderer.observe(world)
  audio.update(world, world.player.pos) // après chaque step (requête C5 R2)
  for (const l of stepListeners) l(world, commands)
  return commands
}

let lastFrame: number | null = null
const frame = (now: number): void => {
  requestAnimationFrame(frame)
  if (!running) return
  if (lastFrame !== null) for (const l of frameListeners) l(now - lastFrame)
  lastFrame = now
  const r = advance(loop, now, document.hidden || paused)
  loop = r.state
  for (let i = 0; i < r.steps && !paused; i++) {
    simulate() // la pause est relue entre deux pas (requête C7 R7)
    if (playerStruck(world)) frozenUntil = now + HIT_FREEZE_MS[world.player.weapon]
  }
  if (now < frozenUntil) return
  renderer.render(world, prev, r.alpha)
  hud.update(world)
}

const title = document.createElement('div')
title.style.cssText =
  'position:fixed; inset:0; display:grid; place-items:center; background: var(--noir); color: var(--ivoire); font-family: Georgia, serif;'
title.innerHTML = `<div style="text-align:center"><h1 style="font-weight:400; letter-spacing:.2em">MERCY</h1>
  <p>P0 · La Fosse · vague ${current.wave} · graine ${current.seed}</p>
  <button style="font: inherit; padding:.6em 2em; background:none; color: inherit; border:1px solid currentColor; cursor:pointer">Entrer</button></div>`
shell.appendChild(title)
title.querySelector('button')?.addEventListener('click', async () => {
  await audio.resume() // l'audio ne démarre qu'après un geste (§24)
  title.remove()
  running = true
})

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && running) paused = !paused
  if (e.code === 'Enter' && running && world.wave.endedAt !== null) host.restart(current)
})

requestAnimationFrame(frame)

// Outils de dev (C7) : absents du build de production.
if (import.meta.env.DEV) void import('./dev/index').then(({ installDev }) => installDev(host))

export { host }
