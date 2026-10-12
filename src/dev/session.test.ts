import { describe, expect, it } from 'vitest'
import type { AudioLog } from '../audio/index'
import { IDLE_COMMANDS, type PlayerCommands, type World } from '../sim/index'
import { BLIND_TIMEOUT_TICKS, LABEL_2 } from './blind'
import { crossCheckHarness } from './crosscheck'
import { createFakeHost } from './fake-host'
import { audioSlice, createSession, isExported, type Run } from './session'
import { parseTelemetry, replayTelemetry, telemetryJson } from './telemetry'

const V1 = { wave: 'V1', seed: 1, variant: 'A' } as const

// Marche vers la créature non morte la plus proche, puis reste là sans frapper : déclenche T0 (alerte de proximité)
// et ne finit jamais la vague.
const walkAndWait = (w: World): PlayerCommands => {
  const p = w.player.pos
  const c = w.creatures.find((x) => x.state.kind !== 'mort')
  if (!c) return IDLE_COMMANDS
  const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z)
  return d > 1.5
    ? { ...IDLE_COMMANDS, move: { x: (c.pos.x - p.x) / d, z: (c.pos.z - p.z) / d } }
    : IDLE_COMMANDS
}

describe('session de dev', () => {
  it('reconnaît un redémarrage fait hors des outils (touche Entrée) et garde les deux parties rejouables', () => {
    const host = createFakeHost(V1, walkAndWait)
    const session = createSession(host)
    host.frames(120)
    host.restart({ wave: 'V2', seed: 4, variant: 'B' }) // comme main.ts, sans passer par la session
    host.frames(80)
    expect(session.current().rang).toBe(2)
    expect(session.previous()?.rang).toBe(1)
    const runs = session.runs()
    expect(runs.map((r) => [r.rang, r.vague, r.fin])).toEqual([
      [1, 'V1', 120],
      [2, 'V2', 80],
    ])
    for (const run of [session.previous() as Run, session.current()]) {
      const f = parseTelemetry(telemetryJson(session.telemetry(run)))
      expect(f.meta.rejouable).toBe(true)
      expect(replayTelemetry(f).identique).toBe(true)
    }
  })

  it('le bot repart d’une mémoire neuve quand la partie redémarre hors des outils', () => {
    const host = createFakeHost(V1, () => IDLE_COMMANDS)
    const session = createSession(host)
    session.restart({ start: V1, politique: 'ref-frappeur', blind: null })
    host.frames(200)
    host.restart(V1) // Entrée de main.ts : même départ, nouvel objet
    host.frames(400)
    const f = parseTelemetry(telemetryJson(session.telemetry()))
    expect(f.meta.politique).toBe('ref-frappeur')
    expect(crossCheckHarness(f, 'A').identique).toBe(true)
  })

  it('une politique inconnue ne touche à rien', () => {
    const host = createFakeHost(V1, walkAndWait)
    const session = createSession(host)
    host.frames(10)
    expect(() => session.restart({ start: V1, politique: 'pas-une-politique', blind: null })).toThrow(
      /inconnue/,
    )
    expect(host.world().tick).toBe(10)
    expect(session.current().rang).toBe(1)
  })

  it('une partie qui n’a pas joué n’est pas archivée', () => {
    const host = createFakeHost(V1, walkAndWait)
    const session = createSession(host)
    session.restart({ start: { ...V1, seed: 2 }, politique: null, blind: null })
    expect(session.current().rang).toBe(1)
    expect(session.runs()).toHaveLength(1)
  })

  it('B2 I3 : joue jusqu’au tick demandé, au tick près, puis reste en pause', () => {
    const host = createFakeHost(V1, walkAndWait)
    const session = createSession(host)
    session.driveTo(47)
    expect(host.isPaused()).toBe(true)
    host.frames(10, 100) // images de 100 ms : 6 pas dus, 5 au plus par image
    expect(host.world().tick).toBe(47)
    expect(session.driving()).toBeNull()
    host.frames(5)
    expect(host.world().tick).toBe(47)
    session.step(3)
    expect(host.world().tick).toBe(50)
    session.runTo(75)
    expect(host.world().tick).toBe(75)
    session.setPaused(false)
    host.frames(5)
    expect(host.world().tick).toBe(80)
    expect(replayTelemetry(parseTelemetry(telemetryJson(session.telemetry()))).identique).toBe(true)
  })

  it('mode aveugle : 300 s après T0 sans fin de vague, pause et partie hors délai', () => {
    const host = createFakeHost(V1, walkAndWait)
    const ended: [number, string][] = []
    const session = createSession(host, { onRunEnd: (r, why) => ended.push([r.rang, why]) })
    session.restart({
      start: { wave: 'V2', seed: 2, variant: 'B' },
      politique: null,
      blind: {
        testeur: 1,
        step: { index: 3, etape: 'bloc', bloc: 2, vague: 'V2', graine: 2, etiquette: LABEL_2 },
      },
    })
    let guard = 0
    while (!host.isPaused() && guard++ < 25_000) host.frame()
    const run = session.current()
    const t0 = run.recorder.t0() as number
    expect(t0).not.toBeNull()
    expect(run.horsDelai).toBe(true)
    expect(host.world().tick).toBe(t0 + BLIND_TIMEOUT_TICKS)
    expect(host.world().wave.endedAt).toBeNull()
    expect(ended).toEqual([[1, 'hors-delai']])
    const f = parseTelemetry(telemetryJson(session.telemetry()))
    expect(f.meta).toMatchObject({ horsDelai: true, bloc: 2, etiquette: LABEL_2, variante: null })
  })

  it('outils branchés en cours de partie : la partie est marquée non rejouable', () => {
    const host = createFakeHost(V1, walkAndWait)
    host.frames(30)
    const session = createSession(host)
    host.frames(30)
    const f = parseTelemetry(telemetryJson(session.telemetry()))
    expect(f.meta.rejouable).toBe(false)
    expect(f.meta.debut).toBe(30)
    expect(() => replayTelemetry(f)).toThrow(/non rejouable/)
  })

  it('temps de frame : remis à zéro à chaque partie, ignorés pendant une pause des outils', () => {
    const host = createFakeHost(V1, walkAndWait)
    const session = createSession(host)
    host.frames(3, 20)
    expect(session.frames.stats()).toMatchObject({ n: 3, max: 20 })
    session.setPaused(true)
    host.frames(3, 50)
    expect(session.frames.stats().n).toBe(3)
    session.driveTo(host.world().tick + 2) // joué par les outils : les images comptent
    host.frames(2, 20)
    expect(session.frames.stats().n).toBe(5)
    host.frames(2, 20) // arrivé au tick : de nouveau en pause
    expect(session.frames.stats().n).toBe(5)
    session.restart({ start: V1, politique: null, blind: null })
    expect(session.frames.stats().n).toBe(0)
    expect(session.previous()?.frames?.n).toBe(5)
  })

  it('un export fait en cours de partie ne couvre pas la suite', () => {
    const host = createFakeHost(V1, walkAndWait)
    const session = createSession(host)
    host.frames(10)
    const run = session.current()
    run.exporteAuTick = session.telemetry(run).meta.fin
    expect(isExported(run)).toBe(true)
    host.frames(5)
    expect(isExported(run)).toBe(false)
    expect(session.runs()[0]?.exporte).toBe(false)
  })

  it('journal audio : seules les entrées écrites pendant la partie', () => {
    const log: AudioLog = { sources: [], frames: [], oneshots: [], ducks: [], nappe: [], warnings: ['a'] }
    const mark = { sources: 0, frames: 0, oneshots: 0, ducks: 0, nappe: 0, warnings: 1 }
    log.warnings.push('b')
    expect(audioSlice(log, mark)?.warnings).toEqual(['b'])
    expect(audioSlice(null, mark)).toBeNull()
  })
})
