import { describe, expect, it } from 'vitest'
import { DEFAULT_SPEC, playRun } from '../bots/harness'
import { IDLE_COMMANDS, type PlayerCommands, step, type World } from '../sim/index'
import { correspondence, LABEL_1, LABEL_2 } from './blind'
import { decodeCommand } from './commands'
import { crossCheckHarness } from './crosscheck'
import { createFakeHost } from './fake-host'
import { createSession } from './session'
import {
  createRunRecorder,
  initialWorld,
  parseTelemetry,
  replayTelemetry,
  type TelemetryFile,
  telemetryFileName,
  telemetryJson,
} from './telemetry'

// Joueur scripté qui touche à tous les champs des commandes, −0 compris (direction nulle et visée).
const human = (w: World): PlayerCommands => {
  const p = w.player
  const t = w.tick
  let best: World['creatures'][number] | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const c of w.creatures) {
    if (c.state.kind === 'mort' || c.state.kind === 'absorbe') continue
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z)
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  if (!best) return { ...IDLE_COMMANDS, aim: { x: -0, z: p.pos.z } }
  const dx = best.pos.x - p.pos.x
  const dz = best.pos.z - p.pos.z
  return {
    move: bestD > 1.8 ? { x: dx / bestD, z: dz / bestD } : { x: -0, z: -0 },
    aim: best.pos,
    strike: bestD <= 2.2,
    dodge: t % 97 === 0,
    sentence: t % 131 === 0,
    rite: t % 233 === 0 ? 'balayage' : null,
    swapWeapon: false,
  }
}

const roundTrip = (f: TelemetryFile): TelemetryFile => parseTelemetry(telemetryJson(f))

describe('télémétrie : enregistrement, export, rejeu', () => {
  it('le bot du navigateur joue la partie du banc, mesurée par le même code (V1, ref-frappeur)', () => {
    const host = createFakeHost({ wave: 'V1', seed: 1, variant: 'A' }, () => IDLE_COMMANDS)
    const session = createSession(host)
    session.restart({ start: { wave: 'V1', seed: 1, variant: 'A' }, politique: 'ref-frappeur', blind: null })
    let guard = 0
    while (host.world().wave.endedAt === null && guard++ < DEFAULT_SPEC.timeoutTicks) host.frame()
    host.frames(30) // le jeu continue après la fin de vague
    expect(host.world().wave.endedAt).not.toBeNull()
    const f = roundTrip(session.telemetry())
    // Même partie que playRun (pnpm sim) : commandes, évènements et métriques identiques jusqu'à la fin du banc.
    const check = crossCheckHarness(f, 'A')
    expect(check).toMatchObject({
      commandesIdentiques: true,
      evenementsIdentiques: true,
      metriquesIdentiques: true,
    })
    const { result } = playRun({ ...DEFAULT_SPEC, wave: 'V1', policy: 'ref-frappeur', seed: 1 })
    expect(f.meta.finVague).toBe(result.endTick)
    expect(f.meta.fin).toBe(result.endTick + 30)
    // Rejeu hors navigateur : même hash final.
    const r = replayTelemetry(f)
    expect(r.identique).toBe(true)
    expect(r.hashFinal).toBe(f.meta.hashFinal)
  })

  it('une partie au clavier (−0 compris) se rejoue jusqu’au même hash, évènements, série et métriques', () => {
    const host = createFakeHost({ wave: 'V2', seed: 3, variant: 'B' }, human)
    const session = createSession(host)
    host.frames(900)
    const f = roundTrip(session.telemetry())
    expect(f.commands).toHaveLength(900)
    expect(f.meta).toMatchObject({ vague: 'V2', graine: 3, variante: 'B', politique: null, arme: 'couperet' })
    expect(f.commands.some((c) => c[0] === '-0' || c[2] === '-0')).toBe(true)
    // Le point visé de chaque tick est dans le journal (B1 §12.6).
    expect(decodeCommand(f.commands[0]).aim).toEqual(
      human(initialWorld({ vague: 'V2', graine: 3, variante: 'B' })).aim,
    )
    const r = replayTelemetry(f)
    expect(r).toMatchObject({
      hashDepartIdentique: true,
      hashFinalIdentique: true,
      evenementsIdentiques: true,
      serieIdentique: true,
      notesIdentiques: true,
      metriquesIdentiques: true,
      identique: true,
    })
  })

  it('un journal altéré ne redonne pas le même hash', () => {
    const host = createFakeHost({ wave: 'V1', seed: 2, variant: 'A' }, human)
    const session = createSession(host)
    host.frames(400)
    const f = roundTrip(session.telemetry())
    // Tick 51 : hors de l'Esquive du tick 0 (pendant une Esquive, la direction est ignorée).
    const commands = f.commands.map((c, i) => (i === 50 ? ([1, 0, c[2], c[3], c[4], c[5]] as const) : c))
    const r = replayTelemetry({ ...f, commands })
    expect(r.hashFinalIdentique).toBe(false)
    expect(r.identique).toBe(false)
    expect(r.premierEcart).not.toBeNull()
    // Le premier point de contrôle après le tick altéré (51) est celui du tick 60.
    expect(r.premierTickDivergent).toBe(60)
    expect(r.pointsDeControleDivergents.slice(0, 2)).toEqual([60, 120])
    expect(r.diagnostic).toMatch(/ticks 60, 120.*même moteur JS, donc journal altéré/)
  })

  it('un monde initial différent est attribué au moteur JS, pas au journal', () => {
    const host = createFakeHost({ wave: 'V1', seed: 2, variant: 'A' }, human)
    const session = createSession(host)
    host.frames(130)
    const f = roundTrip(session.telemetry())
    expect(f.checkpoints.map(([t]) => t)).toEqual([0, 60, 120])
    expect(f.moteur).toMatch(/^Node v/)
    expect(replayTelemetry(f).premierTickDivergent).toBeNull()
    const other = replayTelemetry({ ...f, meta: { ...f.meta, hashDepart: 'autre-moteur' } })
    expect(other.identique).toBe(false)
    expect(other.diagnostic).toMatch(/monde initial différent/)
  })

  it('la série, les notes et les métriques sont celles du banc (seriesLine, tickNotes, reduceRun)', () => {
    const { trace, result } = playRun(
      { ...DEFAULT_SPEC, wave: 'V2', policy: 'ref-frappeur', seed: 5, variant: 'B' },
      { keepCommands: true },
    )
    let w = initialWorld({ vague: 'V2', graine: 5, variante: 'B' })
    const rec = createRunRecorder(w)
    // Rejoue les commandes du banc dans l'enregistreur, comme si elles venaient du navigateur.
    for (const c of trace.commands ?? []) {
      w = step(w, c)
      rec.record(c, w)
    }
    expect(JSON.stringify(rec.events())).toBe(JSON.stringify(trace.events))
    expect(JSON.stringify(rec.series())).toBe(JSON.stringify(trace.series))
    expect(JSON.stringify(rec.notes())).toBe(JSON.stringify(trace.notes))
    expect(JSON.stringify(rec.metrics())).toBe(JSON.stringify(result.metrics))
  })

  it('journal de B5 I2 : N et corps qui vocalisent, triés par distance puis id, à chaque tick', () => {
    const host = createFakeHost({ wave: 'S-sat', seed: 1, variant: 'A' }, () => IDLE_COMMANDS)
    const session = createSession(host)
    host.frames(40)
    const j = session.current().recorder.journal()
    expect(j.ticks).toHaveLength(41)
    expect(j.ticks[0]?.n).toBe(36)
    expect(j.ticks[0]?.vocal).toHaveLength(36)
    expect(j.events.filter((e) => e.type === 'fell' && e.tick === 0)).toHaveLength(36)
    for (const t of j.ticks) {
      for (let i = 1; i < t.vocal.length; i++) {
        const [ida, da] = t.vocal[i - 1] as readonly [number, number]
        const [idb, db] = t.vocal[i] as readonly [number, number]
        expect(da < db || (da === db && ida < idb)).toBe(true)
      }
    }
  })
})

describe('télémétrie à l’aveugle', () => {
  it('l’export n’écrit pas la variante ; le rejeu exige le fichier de correspondance', () => {
    const testeur = 2 // B A A B : le réglage 1 est B
    const host = createFakeHost({ wave: 'V1', seed: 1, variant: 'A' }, human)
    const session = createSession(host)
    session.restart({
      start: { wave: 'V1', seed: 1, variant: correspondence(testeur).reglages[LABEL_1] },
      politique: null,
      blind: {
        testeur,
        step: { index: 0, etape: 'echauffement', bloc: null, vague: 'V1', graine: 1, etiquette: LABEL_1 },
      },
    })
    host.frames(300)
    const json = telemetryJson(session.telemetry())
    const f = parseTelemetry(json)
    expect(f.meta).toMatchObject({
      aveugle: true,
      variante: null,
      testeur: 2,
      etape: 'echauffement',
      etiquette: LABEL_1,
    })
    expect(json).not.toMatch(/"variante":"[AB]"/)
    expect(telemetryFileName(f.meta)).toBe('mercy-t2-echauffement-V1-g1-reglage1-r1-f300.json')
    expect(() => replayTelemetry(f)).toThrow(/correspondance/)
    expect(() => replayTelemetry(f, { correspondence: correspondence(1) })).toThrow(/testeur/)
    const r = replayTelemetry(f, { correspondence: correspondence(testeur) })
    expect(r.variante).toBe('B')
    expect(r.identique).toBe(true)
    // La mauvaise variante ne retombe pas sur le même monde.
    const wrong = { ...correspondence(testeur), reglages: { [LABEL_1]: 'A', [LABEL_2]: 'B' } as const }
    expect(replayTelemetry(f, { correspondence: wrong }).identique).toBe(false)
  })
})
