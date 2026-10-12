// Outils de dev (C7) : télémétrie rejouable, playtest A/B à l'aveugle, bot dans le navigateur, window.__mercy.
// Point d'entrée : installDev(host) depuis src/main.ts, en dev seulement. Branchement prévu dans main.ts :
//   if (import.meta.env.DEV) void import('./dev/index').then(({ installDev }) => installDev(host))
// L'import dynamique sous import.meta.env.DEV sort tout src/dev du build de production.
import { POLICIES } from '../bots/harness'
import type { GameHost, GameStart } from '../game/host'
import type { Variant } from '../sim/index'
import { isWaveId } from '../sim/waves'
import { type BlindStep, blindSteps, correspondence, correspondenceFileName } from './blind'
import { createMercyApi, exposeMercy } from './mercy'
import { createPanel } from './panel'
import { createSession, isExported, type Run, type RunSetup } from './session'
import { telemetryFileName, telemetryJson } from './telemetry'
import { parseDevParams, sameStart, searchOf, startOfParams } from './url'

export interface DevOptions {
  readonly search?: string // défaut : location.search
  readonly panel?: boolean // défaut : true (masquable par la touche ² ou `, ou panel=0 dans l'URL)
  readonly target?: HTMLElement // défaut : document.body
}

export interface DevHandle {
  dispose(): void
}

const download = (name: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const installDev = (host: GameHost, options: DevOptions = {}): DevHandle => {
  if (!import.meta.env.DEV) return { dispose: () => {} }
  const params = parseDevParams(options.search ?? location.search)
  let blind: { testeur: number; steps: readonly BlindStep[]; index: number } | null = null

  const exportRun = (run: Run): string => {
    const f = session.telemetry(run)
    const name = telemetryFileName(f.meta)
    download(name, telemetryJson(f))
    run.exporteAuTick = f.meta.fin
    return name
  }

  const session = createSession(host, {
    // Mode aveugle : chaque partie est exportée à sa fin (vague finie, hors délai) ou quand on la quitte.
    onRunEnd: (run) => {
      if (run.setup.blind !== null && !isExported(run)) exportRun(run)
      refresh()
    },
    onRunLeave: (run) => {
      if (run.setup.blind !== null && !isExported(run) && run.recorder.commands().length > 0) exportRun(run)
    },
    onChange: () => refresh(),
  })

  const restartFree = (o: {
    wave: string
    seed?: number
    variant?: Variant
    policy?: string | null
  }): void => {
    if (!isWaveId(o.wave)) throw new Error(`vague ou scène inconnue : ${o.wave}`)
    const seed = o.seed ?? 1
    if (!Number.isInteger(seed) || seed < 0) throw new Error(`graine invalide : ${o.seed}`)
    const start: GameStart = { wave: o.wave, seed, variant: o.variant ?? 'A' }
    const politique = o.policy ?? null
    session.restart({ start, politique, blind: null })
    host.setCommandFilter(null)
    host.renderer.debug.clearGore()
    history.replaceState(null, '', searchOf(start, politique))
  }

  const blindSetup = (): RunSetup => {
    const b = blind as NonNullable<typeof blind>
    const step = b.steps[b.index] as BlindStep
    const order = correspondence(b.testeur)
    const variant = order.reglages[step.etiquette]
    return {
      start: { wave: step.vague, seed: step.graine, variant },
      politique: null,
      blind: { testeur: b.testeur, step },
    }
  }

  const startBlindStep = (): void => {
    session.restart(blindSetup())
    host.setCommandFilter((c) => ({ ...c, swapWeapon: false })) // B4 §11 : Couperet seul (requête C7 R5)
    session.setPaused(false) // une partie hors délai a laissé le jeu en pause
    host.renderer.debug.clearGore()
    history.replaceState(null, '', location.pathname)
  }

  const guard = (f: () => void): void => {
    try {
      panel?.error(null)
      f()
    } catch (e) {
      panel?.error(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  const panel =
    (options.panel ?? true)
      ? createPanel(document, options.target ?? document.body, {
          restart: (o) => guard(() => restartFree(o)),
          togglePause: () => guard(() => session.setPaused(!session.paused())),
          step: () => guard(() => session.step(1)),
          exportRun: () => guard(() => void exportRun(session.current())),
          startBlind: (t) =>
            guard(() => {
              const steps = blindSteps(t)
              download(correspondenceFileName(t), `${JSON.stringify(correspondence(t), null, 2)}\n`)
              blind = { testeur: t, steps, index: 0 }
              panel?.showBlind()
              startBlindStep()
            }),
          blindRestart: () => guard(() => startBlindStep()),
          blindNext: () =>
            guard(() => {
              if (!blind) return
              if (blind.index + 1 >= blind.steps.length)
                throw new Error('session terminée : les 4 blocs sont joués')
              blind.index++
              startBlindStep()
            }),
          policies: () => Object.keys(POLICIES),
        })
      : null

  const refresh = (): void => {
    if (!panel) return
    const run = session.current()
    const w = host.world()
    if (blind !== null && run.setup.blind !== null) {
      panel.updateBlind({
        testeur: blind.testeur,
        step: run.setup.blind.step,
        etat: run.horsDelai ? 'hors délai (300 s)' : w.wave.endedAt !== null ? 'vague finie' : 'en cours',
        exporte: isExported(run),
        armeChangee: run.recorder.events().some((e) => e.type === 'weapon-swap'),
      })
      return
    }
    if (blind !== null) return
    panel.updateFree({
      rang: run.rang,
      tick: w.tick,
      hash: api.hash(),
      finVague: w.wave.endedAt,
      politique: run.setup.politique,
      paused: session.paused(),
      driving: session.driving(),
      frames: session.frames.stats(),
    })
  }

  const api = createMercyApi({
    host,
    session,
    exportRun: (which = 'courante') => {
      const r = which === 'courante' ? session.current() : session.previous()
      if (r === null) throw new Error('aucune partie précédente')
      return exportRun(r)
    },
    restart: restartFree,
    blind: () => blind !== null,
  })
  const unexpose = exposeMercy(window, api)

  // ---- Paramètres d'URL ----
  const errors = [...params.errors]
  if (params.aveugle !== null) {
    panel?.showBlindReady(params.aveugle)
  } else {
    const start = startOfParams(params, host.start())
    panel?.showFree({ ...start, policy: params.policy })
    const needsRestart = !sameStart(start, host.start()) || params.policy !== null || host.world().tick !== 0
    if (needsRestart) {
      try {
        session.restart({ start, politique: params.policy, blind: null })
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    // B2 I3 : jouer jusqu'à un tick donné, puis pause. La partie démarre au clic de l'écran titre.
    if (params.until !== null) session.driveTo(params.until)
  }
  if (errors.length > 0) panel?.error(errors.join(' ; '))
  if (panel && !params.panel) panel.toggle()

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Backquote' && panel) panel.toggle()
  }
  addEventListener('keydown', onKey)
  const timer = setInterval(refresh, 250)
  refresh()

  return {
    dispose: () => {
      clearInterval(timer)
      removeEventListener('keydown', onKey)
      session.dispose()
      host.setCommandSource(null)
      panel?.dispose()
      unexpose()
    },
  }
}
