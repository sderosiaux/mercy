// Contrôle croisé d'une partie de bot jouée dans le navigateur avec la même partie jouée par le banc (playRun de
// src/bots/harness.ts, celui de `pnpm sim`) : mêmes commandes, mêmes évènements, mêmes métriques jusqu'à la fin
// commune. Prouve que le bot du navigateur et le banc jouent la même partie et sont mesurés par le même code.
import { DEFAULT_SPEC, playRun } from '../bots/harness'
import { reduceRun } from '../metrics/index'
import type { Variant } from '../sim/index'
import { encodeCommand } from './commands'
import type { TelemetryFile } from './telemetry'

export interface HarnessCheck {
  readonly commandeSim: string
  readonly finBanc: number
  readonly finNavigateur: number
  readonly comparesJusquAuTick: number
  readonly commandesIdentiques: boolean
  readonly evenementsIdentiques: boolean
  readonly metriquesIdentiques: boolean | null // null : le navigateur s'est arrêté avant la fin du banc
  readonly identique: boolean
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export const crossCheckHarness = (f: TelemetryFile, variante: Variant): HarnessCheck => {
  const policy = f.meta.politique
  if (policy === null) throw new Error('partie humaine : pas de politique à rejouer dans le banc')
  const spec = {
    ...DEFAULT_SPEC,
    wave: f.meta.vague,
    policy,
    seed: f.meta.graine,
    variant: variante,
    weapon: f.meta.arme,
  }
  const { result, trace } = playRun(spec, { keepCommands: true })
  const n = Math.min(result.endTick, f.meta.fin)
  const evB = f.events.filter((e) => e.tick <= n)
  const evH = trace.events.filter((e) => e.tick <= n)
  const cmdH = (trace.commands ?? []).slice(0, n).map(encodeCommand)
  const cmdB = f.commands.slice(0, n)
  // Métriques : sur le préfixe commun, seulement si le banc s'est arrêté dans la partie du navigateur.
  const metriques =
    result.endTick <= f.meta.fin
      ? same(
          reduceRun(evB, {
            weapon: f.meta.arme,
            series: f.series.slice(0, n + 1),
            notes: f.notes.filter((x) => x.tick <= n),
          }),
          result.metrics,
        )
      : null
  const commandes = same(cmdB, cmdH)
  const evenements = same(evB, evH)
  return {
    commandeSim: `pnpm sim -- --wave ${spec.wave} --policy ${spec.policy} --seed ${spec.seed} --variant ${spec.variant} --weapon ${spec.weapon}`,
    finBanc: result.endTick,
    finNavigateur: f.meta.fin,
    comparesJusquAuTick: n,
    commandesIdentiques: commandes,
    evenementsIdentiques: evenements,
    metriquesIdentiques: metriques,
    identique: commandes && evenements && metriques !== false,
  }
}
