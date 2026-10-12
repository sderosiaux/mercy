// Paramètres d'URL des outils de dev (B5 I5, B2 I3). main.ts lit déjà wave, seed et variant pour créer le monde ;
// ceux-ci ajoutent : scene (une scène de test de src/sim/waves.ts, prioritaire sur wave), policy (bot dans le
// navigateur, nom du registre de src/bots, paramètres compris : b5:D=60), until (tick où la partie se met en pause),
// aveugle (indice du testeur : ouvre le panneau du playtest A/B), panel=0 (panneau masqué au départ).
import type { GameStart } from '../game/host'
import { isWaveId } from '../sim/waves'

export interface DevParams {
  readonly wave: string | null
  readonly scene: string | null
  readonly seed: number | null
  readonly variant: 'A' | 'B' | null
  readonly policy: string | null
  readonly until: number | null
  readonly aveugle: number | null
  readonly panel: boolean
  readonly errors: readonly string[]
}

const intOrNull = (s: string | null, name: string, errors: string[], min: number): number | null => {
  if (s === null || s === '') return null
  const n = Number(s)
  if (!Number.isInteger(n) || n < min) {
    errors.push(`paramètre ${name} ignoré : entier ≥ ${min} attendu, reçu « ${s} »`)
    return null
  }
  return n
}

export const parseDevParams = (search: string): DevParams => {
  const p = new URLSearchParams(search)
  const errors: string[] = []
  const v = p.get('variant')
  const variant = v === 'A' || v === 'B' ? v : null
  if (v !== null && variant === null) errors.push(`paramètre variant ignoré : A ou B attendu, reçu « ${v} »`)
  const wave = p.get('wave')
  if (wave !== null && !isWaveId(wave)) errors.push(`vague inconnue : « ${wave} »`)
  const scene = p.get('scene')
  if (scene !== null && !isWaveId(scene)) errors.push(`scène inconnue : « ${scene} »`)
  const policy = p.get('policy')
  return {
    wave: wave !== null && isWaveId(wave) ? wave : null,
    scene: scene !== null && isWaveId(scene) ? scene : null,
    seed: intOrNull(p.get('seed'), 'seed', errors, 0),
    variant,
    policy: policy === null || policy.trim() === '' ? null : policy.trim(),
    until: intOrNull(p.get('until'), 'until', errors, 1),
    aveugle: intOrNull(p.get('aveugle'), 'aveugle', errors, 1),
    panel: p.get('panel') !== '0',
    errors,
  }
}

// Départ voulu par l'URL ; la scène l'emporte sur la vague, le reste retombe sur le départ de l'hôte.
export const startOfParams = (p: DevParams, host: GameStart): GameStart => ({
  wave: p.scene ?? p.wave ?? host.wave,
  seed: p.seed ?? host.seed,
  variant: p.variant ?? host.variant,
})

export const sameStart = (a: GameStart, b: GameStart): boolean =>
  a.wave === b.wave && a.seed === b.seed && a.variant === b.variant

// Paramètres d'une partie libre, pour qu'un rechargement rejoue la même partie. Jamais en mode aveugle.
export const searchOf = (s: GameStart, policy: string | null): string => {
  const q = new URLSearchParams({ wave: s.wave, seed: String(s.seed), variant: s.variant })
  if (policy !== null) q.set('policy', policy)
  return `?${q.toString()}`
}
