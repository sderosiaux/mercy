// Outils de construction de scènes pour les tests et le banc de bots. Aucune règle de jeu ici.
import { souriant } from './families/souriant'
import type {
  Creature,
  EventOf,
  FamilyModule,
  FamilyRegistry,
  Player,
  PlayerCommands,
  SimEvent,
  SpawnDef,
  Variant,
  Vec2,
  WaveDef,
  World,
} from './types'
import { vec } from './vec'
import { createWorld, step } from './world'

export const IDLE: PlayerCommands = {
  move: vec(0, 0),
  aim: vec(1, 0),
  strike: false,
  dodge: false,
  sentence: false,
  rite: null,
  swapWeapon: false,
}

export const cmd = (patch: Partial<PlayerCommands> = {}): PlayerCommands => ({ ...IDLE, ...patch })

export const testWave = (spawns: readonly SpawnDef[], playerStart: Vec2 = vec(0, 0)): WaveDef => ({
  id: 'test',
  test: true,
  playerStart,
  spawns,
  jitter: { posM: 0, ritualPhase: false },
})

export const scene = (
  spawns: readonly SpawnDef[],
  opts: { seed?: number; variant?: Variant; families?: FamilyRegistry; playerStart?: Vec2 } = {},
): World =>
  createWorld({
    seed: opts.seed ?? 1,
    variant: opts.variant ?? 'A',
    wave: testWave(spawns, opts.playerStart),
    families: { souriant, ...opts.families },
  })

// Chirurgie d'état pour les tests : place le monde dans une situation précise sans passer par le jeu.
export const withPlayer = (w: World, patch: Partial<Player>): World => ({
  ...w,
  player: { ...w.player, ...patch },
})
export const withCreature = (w: World, id: number, patch: Partial<Creature>): World => ({
  ...w,
  creatures: w.creatures.map((c) => (c.id === id ? { ...c, ...patch } : c)),
})

export interface Run {
  readonly world: World
  readonly events: readonly SimEvent[]
}

export const run = (
  w: World,
  n: number,
  commands: PlayerCommands | ((w: World) => PlayerCommands) = IDLE,
): Run => {
  let world = w
  const events: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    world = step(world, typeof commands === 'function' ? commands(world) : commands)
    events.push(...world.events)
  }
  return { world, events }
}

export const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): EventOf<T>[] =>
  events.filter((e) => e.type === type) as EventOf<T>[]

export const creature = (w: World, id: number): Creature => {
  const c = w.creatures.find((x) => x.id === id)
  if (!c) throw new Error(`créature ${id} absente`)
  return c
}

// Familles factices pour tester les règles génériques sans dépendre des familles de la phase C.
// Mannequin : grande créature à un bras qui frappe le joueur.
export const mannequin = (opts: { channel?: boolean; support?: boolean } = {}): FamilyModule => ({
  kind: 'recousu',
  size: 'large',
  isSupport: opts.support ?? false,
  base: { chair: 160, speed: 0, limbs: [{ id: 'brasDroit', hp: 40 }] },
  actions: {
    coup: { kind: 'attaque', telegraphTicks: 54, recoverTicks: 30, limb: 'brasDroit', reach: 3, arcDeg: 120 },
    priere: { kind: 'canalisation', telegraphTicks: 0, recoverTicks: 0, channelTicks: 150, reach: 8 },
  },
  decide: (world, self) => {
    const arm = self.limbs.find((l) => l.id === 'brasDroit')
    if (opts.channel) return { kind: 'act', action: 'priere' }
    if (arm?.state === 'ok') return { kind: 'act', action: 'coup', target: world.player.pos }
    return { kind: 'idle' }
  },
  resolve: (_w, self, action) =>
    action.name === 'coup'
      ? [
          {
            kind: 'damage',
            area: { kind: 'cone', origin: self.pos, facing: self.facing, reach: 3, arcDeg: 120 },
            amount: 22,
            source: 'creature',
            abatSmall: false,
            staggerLarge: 0,
            hitsCreatures: false,
          },
        ]
      : [],
})

// Support inerte : attire les corps (L1), ne fait rien d'autre.
export const poteau: FamilyModule = {
  kind: 'confesseur',
  size: 'small',
  isSupport: true,
  base: { chair: 40, speed: 0, limbs: [] },
  actions: {},
  decide: () => ({ kind: 'idle' }),
  resolve: () => [],
}
