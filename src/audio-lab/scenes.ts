// Scènes de B5 §6 (contrat gelé) pour le banc audio : S1 (5 variantes), S-nappe, S-sat. Rien n'est redéfini ici
// (revue de code D1) : les scènes sont celles de src/sim/waves.ts, les politiques celles de src/bots/b2b4b5/b5.ts,
// comme pour le banc du jeu (window.__mercy.audio.renderOffline). Seule la durée de rendu de chaque scène, qui est
// du protocole de mesure (§6, colonne « Fin du rendu »), vit dans ce fichier.
import { decideS1, decideSNappe, decideSSat, S_SAT_FIN, S1_VARIANTES } from '../bots/b2b4b5/b5'
import { createWorld, FAMILIES, type PlayerCommands, step, type World } from '../sim/index'
import { WAVES } from '../sim/waves'

// Variantes de S1, dans l'ordre de la table du §6.
export const S1_VARIANTS: readonly string[] = Object.keys(S1_VARIANTES)
export const isS1Variant = (id: string): boolean => Object.hasOwn(S1_VARIANTES, id)

export interface SceneDef {
  readonly label: string
  readonly world0: World
  readonly policy: (w: World) => PlayerCommands
  readonly ticks: number
}

// Même monde de départ que le banc du jeu (src/dev/telemetry.ts, initialWorld) : registre complet, variante A.
const sceneWorld = (scene: 'S1' | 'S-nappe' | 'S-sat', seed: number): World =>
  createWorld({ seed, wave: WAVES[scene], variant: 'A', families: FAMILIES })

const firstTick = (
  w0: World,
  policy: (w: World) => PlayerCommands,
  max: number,
  pred: (w: World) => boolean,
): number => {
  let w = w0
  for (let i = 0; i < max; i++) {
    if (pred(w)) return w.tick
    w = step(w, policy(w))
  }
  throw new Error('condition de fin jamais atteinte')
}

// Fin du rendu (§6) : mort + 180 ticks ; S1-rel : chute + 420.
export const s1Scene = (variant: string, seed = 1): SceneDef => {
  const params = S1_VARIANTES[variant]
  if (!params) throw new Error(`variante de S1 inconnue : ${variant}`)
  const world0 = sceneWorld('S1', seed)
  const policy = (w: World) => decideS1(params.k, params.verbe, w)
  if (params.verbe === 'aucun') {
    const fell = firstTick(world0, policy, 10_000, (w) => w.events.some((e) => e.type === 'fell'))
    return { label: variant, world0, policy, ticks: fell + 420 }
  }
  const death = firstTick(world0, policy, 10_000, (w) => w.events.some((e) => e.type === 'death'))
  return { label: variant, world0, policy, ticks: death + 180 }
}

// Fin : N = 0 et t ≥ dernier + 180.
export const sNappeScene = (seed = 1): SceneDef => {
  const world0 = sceneWorld('S-nappe', seed)
  const end = firstTick(world0, decideSNappe, 20_000, (w) => {
    const alive = w.creatures.some((c) => c.state.kind !== 'mort')
    const morts = w.creatures.flatMap((c) => (c.state.kind === 'mort' ? [c.state.at] : []))
    return !alive && w.tick >= Math.max(0, ...morts) + 180
  })
  return { label: 'S-nappe', world0, policy: decideSNappe, ticks: end }
}

// Fin à t = 265, avant les inspirations de t = 270.
export const sSatScene = (seed = 1): SceneDef => ({
  label: 'S-sat',
  world0: sceneWorld('S-sat', seed),
  policy: decideSSat,
  ticks: S_SAT_FIN,
})
