// Mémoire du gore et des éclats, tirée des évènements de chaque pas : décalques de sang persistants (§17,
// plafond 400, les plus anciens s'effacent), éclats dorés d'un coup sur un Résistant à terre (L4), dernier coup
// qui touche (secousse, §8.1). Le monde ne garde pas cet historique ; le rendu le reconstruit, tick par tick.
import type { EntityId, SimEvent, Tick, Vec2, World } from '../sim/index'
import { RENDER } from './constants'

export interface Decal {
  readonly x: number
  readonly z: number
  readonly rot: number
  readonly size: number
  readonly born: Tick
}

export interface Spark {
  readonly id: EntityId
  readonly x: number
  readonly z: number
  readonly born: Tick
}

export const SPARK_TICKS = 14

const rot = (tick: number, k: number): number => {
  const s = Math.sin(tick * 91.7 + k * 13.3) * 43758.5453
  return (s - Math.floor(s)) * Math.PI * 2
}

export class GoreMemory {
  private decalList: Decal[] = []
  private sparkList: Spark[] = []
  private seen = -1
  lastHit: Tick | null = null

  // Nouvelle partie (laboratoire qui rejoue une scène depuis le tick 0) : tout l’historique repart de zéro.
  clear(): void {
    this.decalList = []
    this.sparkList = []
    this.seen = -1
    this.lastHit = null
  }

  get decals(): readonly Decal[] {
    return this.decalList
  }
  get sparks(): readonly Spark[] {
    return this.sparkList
  }

  // À appeler une fois par pas de simulation ; un tick déjà vu est ignoré.
  ingest(world: World): void {
    if (world.tick <= this.seen) return
    this.seen = world.tick
    const posOf = (id: EntityId): Vec2 | null => world.creatures.find((c) => c.id === id)?.pos ?? null
    for (const e of world.events) this.event(e, posOf, world)
    this.sparkList = this.sparkList.filter((s) => world.tick - s.born < SPARK_TICKS)
  }

  add(pos: Vec2, size: number, born: Tick): void {
    this.decalList.push({ x: pos.x, z: pos.z, rot: rot(born, this.decalList.length), size, born })
    if (this.decalList.length > RENDER.decalquesMax) {
      this.decalList.splice(0, this.decalList.length - RENDER.decalquesMax)
    }
  }

  private event(e: SimEvent, posOf: (id: EntityId) => Vec2 | null, world: World): void {
    switch (e.type) {
      case 'hit': {
        if (e.by === 'player' && e.target !== 'player') this.lastHit = e.tick
        const p = e.target === 'player' ? world.player.pos : posOf(e.target)
        if (p) this.add(p, 0.18 + Math.min(0.3, e.amount / 80), e.tick)
        break
      }
      case 'fell': {
        const p = posOf(e.id)
        // Les Abattus placés au tick 0 (scènes de test) ne saignent pas : aucun coup n'a eu lieu.
        if (p && e.tick > 0) this.add(p, 0.4, e.tick)
        break
      }
      case 'death': {
        const p = posOf(e.id)
        if (p) this.add(p, e.by === 'union' ? 0.3 : 0.5, e.tick)
        if (e.by === 'achevement' || e.by === 'variant-b') this.lastHit = e.tick
        break
      }
      case 'sever': {
        const p = posOf(e.owner)
        if (p) this.add(p, 0.6, e.tick)
        break
      }
      case 'burst': {
        const p = posOf(e.id)
        if (p) this.add(p, 1.1 + 0.3 * e.stage, e.tick)
        break
      }
      case 'clang': {
        const p = posOf(e.id)
        this.lastHit = e.tick
        if (p) this.sparkList.push({ id: e.id, x: p.x, z: p.z, born: e.tick })
        break
      }
      default:
        break
    }
  }
}
