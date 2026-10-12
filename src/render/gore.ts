// Mémoire du gore, tirée des évènements de chaque pas (§17, ART_DIRECTION « Gore ») : le monde ne garde pas cet
// historique, le rendu le reconstruit tick par tick, de façon déterministe (aucun tirage : tout dérive du tick et de
// l'id). Le rendu en est une fonction pure de l'horloge de rendu t.
// - chaque coup qui touche projette du sang dans la direction du coup : le tranchant laisse une traînée allongée,
//   le contondant une gerbe ronde et des éclats d'os ; gouttelettes en vol pendant une demi-seconde ;
// - le sang frais est rouge vif pendant 2 s, puis rouge brun, et reste (plafond de 400 décalques : les plus anciens
//   s'effacent) ;
// - une flaque grandit sous un corps qui tombe ou qui meurt ; une Sentence sur un corps muet ne saigne presque pas ;
// - un corps qui rampe laisse une traînée ;
// - un éclatement de Porteur projette des morceaux de chair qui retombent et restent ;
// - un coup sur un Résistant à terre fait jaillir un éclat doré (L4).
import type { EntityId, SimEvent, Tick, Vec2, World } from '../sim/index'
import { RENDER } from './constants'

export type DecalKind = 'eclat' | 'trainee' | 'flaque' | 'trace'

export interface Decal {
  readonly x: number
  readonly z: number
  readonly rot: number // direction (rad) : axe long de la traînée, de la trace
  readonly size: number // demi-largeur, m
  readonly born: Tick
  readonly kind: DecalKind
  readonly len: number // allongement (longueur / largeur)
  readonly grow: number // ticks pour atteindre la taille finale (flaques)
  readonly seed: number
}

export interface Spark {
  readonly id: EntityId
  readonly x: number
  readonly z: number
  readonly born: Tick
}

// Gouttelette en vol : balistique, disparaît à l'atterrissage (son décalque est déjà posé).
export interface Droplet {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly born: Tick
  readonly size: number
}

// Morceau (chair, os) : balistique, puis immobile au sol, jusqu'à la fin de la partie (plafond).
export interface Chunk {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly born: Tick
  readonly size: number
  readonly kind: 'chair' | 'os'
  readonly seed: number
}

export const SPARK_TICKS = 14
export const DROPLET_TICKS = 32
export const CHUNKS_MAX = 220
const GRAVITY = 9.8 // m/s²

// Bruit stable dans [0, 1) d'un (tick, k).
const h01 = (tick: number, k: number): number => {
  const s = Math.sin(tick * 91.7 + k * 13.3) * 43758.5453
  return s - Math.floor(s)
}

const rot = (tick: number, k: number): number => h01(tick, k) * Math.PI * 2

// Position d'une gouttelette ou d'un morceau au temps t (ticks), posée au sol à l'atterrissage.
export const ballistic = (
  p: Pick<Chunk, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'born'>,
  t: number,
): { x: number; y: number; z: number; landed: boolean } => {
  const age = Math.max(0, (t - p.born) / 60)
  // Atterrissage : y + vy·a − g·a²/2 = 0.
  const land = (p.vy + Math.sqrt(p.vy * p.vy + 2 * GRAVITY * Math.max(0, p.y))) / GRAVITY
  const a = Math.min(age, land)
  return {
    x: p.x + p.vx * a,
    y: Math.max(0, p.y + p.vy * a - (GRAVITY * a * a) / 2),
    z: p.z + p.vz * a,
    landed: age >= land,
  }
}

// Taille courante d'un décalque : une flaque grandit, le reste apparaît d'un coup.
export const decalScale = (d: Decal, t: number): number => {
  if (d.grow <= 0) return 1
  const k = Math.min(1, Math.max(0, (t - d.born) / d.grow))
  return 0.25 + 0.75 * (1 - (1 - k) * (1 - k))
}

// Sang frais : rouge vif pendant 2 s (§17).
export const isFresh = (d: Pick<Decal, 'born'>, t: number): boolean => t - d.born < RENDER.sangFraisTicks

export class GoreMemory {
  private decalList: Decal[] = []
  private sparkList: Spark[] = []
  private dropList: Droplet[] = []
  private chunkList: Chunk[] = []
  private readonly cried = new Set<EntityId>()
  private readonly trailFrom = new Map<EntityId, Vec2>()
  private seen = -1
  lastHit: Tick | null = null

  // Nouvelle partie (laboratoire qui rejoue une scène depuis le tick 0) : tout l'historique repart de zéro.
  clear(): void {
    this.decalList = []
    this.sparkList = []
    this.dropList = []
    this.chunkList = []
    this.cried.clear()
    this.trailFrom.clear()
    this.seen = -1
    this.lastHit = null
  }

  get decals(): readonly Decal[] {
    return this.decalList
  }
  get sparks(): readonly Spark[] {
    return this.sparkList
  }
  get droplets(): readonly Droplet[] {
    return this.dropList
  }
  get chunks(): readonly Chunk[] {
    return this.chunkList
  }

  // À appeler une fois par pas de simulation ; un tick déjà vu est ignoré.
  ingest(world: World): void {
    if (world.tick <= this.seen) return
    this.seen = world.tick
    const byId = new Map(world.creatures.map((c) => [c.id, c]))
    const posOf = (id: EntityId | 'player'): Vec2 | null =>
      id === 'player' ? world.player.pos : (byId.get(id)?.pos ?? null)
    for (const e of world.events) this.event(e, posOf)
    this.trails(world)
    this.sparkList = this.sparkList.filter((s) => world.tick - s.born < SPARK_TICKS)
    this.dropList = this.dropList.filter((d) => world.tick - d.born < DROPLET_TICKS)
  }

  add(
    pos: Vec2,
    size: number,
    born: Tick,
    kind: DecalKind = 'eclat',
    opts: { rot?: number; len?: number; grow?: number } = {},
  ): void {
    const n = this.decalList.length
    this.decalList.push({
      x: pos.x,
      z: pos.z,
      rot: opts.rot ?? rot(born, n),
      size,
      born,
      kind,
      len: opts.len ?? 1,
      grow: opts.grow ?? 0,
      seed: h01(born, n + 7) * 100,
    })
    if (this.decalList.length > RENDER.decalquesMax) {
      this.decalList.splice(0, this.decalList.length - RENDER.decalquesMax)
    }
  }

  private spray(
    at: Vec2,
    dir: number,
    tick: Tick,
    n: number,
    speed: number,
    spread: number,
    k0: number,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = dir + (h01(tick, k0 + i) - 0.5) * spread
      const v = speed * (0.5 + h01(tick, k0 + 20 + i))
      this.dropList.push({
        x: at.x,
        y: 0.7 + h01(tick, k0 + 40 + i) * 0.5,
        z: at.z,
        vx: Math.cos(a) * v,
        vy: 1 + h01(tick, k0 + 60 + i) * 2.2,
        vz: Math.sin(a) * v,
        born: tick,
        size: 0.025 + h01(tick, k0 + 80 + i) * 0.03,
      })
    }
  }

  private chunk(at: Vec2, tick: Tick, n: number, kind: 'chair' | 'os', speed: number, k0: number): void {
    for (let i = 0; i < n; i++) {
      const a = h01(tick, k0 + i) * Math.PI * 2
      const v = speed * (0.4 + h01(tick, k0 + 30 + i))
      this.chunkList.push({
        x: at.x,
        y: 0.6 + h01(tick, k0 + 50 + i) * 0.6,
        z: at.z,
        vx: Math.cos(a) * v,
        vy: 1.5 + h01(tick, k0 + 70 + i) * 3,
        vz: Math.sin(a) * v,
        born: tick,
        size: kind === 'os' ? 0.05 + h01(tick, k0 + 90 + i) * 0.05 : 0.07 + h01(tick, k0 + 90 + i) * 0.1,
        kind,
        seed: h01(tick, k0 + 110 + i),
      })
    }
    if (this.chunkList.length > CHUNKS_MAX) this.chunkList.splice(0, this.chunkList.length - CHUNKS_MAX)
  }

  // Traînée d'un corps qui rampe : un trait tous les 0,6 m parcourus à terre.
  private trails(world: World): void {
    for (const c of world.creatures) {
      if (c.state.kind !== 'abattu') {
        this.trailFrom.delete(c.id)
        continue
      }
      const from = this.trailFrom.get(c.id)
      if (!from) {
        this.trailFrom.set(c.id, c.pos)
        continue
      }
      const dx = c.pos.x - from.x
      const dz = c.pos.z - from.z
      const d = Math.hypot(dx, dz)
      if (d < 0.6) continue
      if (d < 2.5) {
        this.add({ x: (from.x + c.pos.x) / 2, z: (from.z + c.pos.z) / 2 }, 0.16, world.tick, 'trace', {
          rot: Math.atan2(dz, dx),
          len: (d / 0.32) * 1.1,
        })
      }
      this.trailFrom.set(c.id, c.pos)
    }
  }

  private event(e: SimEvent, posOf: (id: EntityId | 'player') => Vec2 | null): void {
    switch (e.type) {
      case 'hit': {
        if (e.by === 'player' && e.target !== 'player') this.lastHit = e.tick
        const p = posOf(e.target)
        if (!p) break
        const from = posOf(e.by)
        const dir = from ? Math.atan2(p.z - from.z, p.x - from.x) : rot(e.tick, 3)
        const size = 0.18 + Math.min(0.3, e.amount / 80)
        const k = this.decalList.length
        if (e.damageType === 'tranchant') {
          // Le tranchant éclabousse et coupe : traînée dans le sens du coup, au-delà du corps.
          const off = 0.35 + size
          this.add(
            { x: p.x + Math.cos(dir) * off, z: p.z + Math.sin(dir) * off },
            size * 0.7,
            e.tick,
            'trainee',
            {
              rot: dir,
              len: 3.2 + h01(e.tick, k) * 1.6,
            },
          )
          this.spray(p, dir, e.tick, 9, 3.2, 0.7, k * 3)
        } else if (e.damageType === 'contondant') {
          // Le contondant écrase et projette des éclats.
          this.add(
            { x: p.x + Math.cos(dir) * 0.25, z: p.z + Math.sin(dir) * 0.25 },
            size * 1.35,
            e.tick,
            'eclat',
            {
              rot: dir,
              len: 1.25,
            },
          )
          this.spray(p, dir, e.tick, 12, 2.2, 2.2, k * 3)
          this.chunk(p, e.tick, 2, 'os', 1.6, k * 5)
        } else {
          this.add(p, size, e.tick, 'eclat', { rot: dir })
          this.spray(p, dir, e.tick, 5, 1.8, 1.2, k * 3)
        }
        break
      }
      case 'fell': {
        const p = posOf(e.id)
        // Les Abattus placés au tick 0 (scènes de test) ne saignent pas : aucun coup n'a eu lieu.
        if (p && e.tick > 0) this.add(p, 0.42, e.tick, 'flaque', { grow: 240 })
        break
      }
      case 'cry-start':
        this.cried.add(e.id)
        break
      case 'death': {
        const p = posOf(e.id)
        if (p) {
          // Une Sentence sur un corps muet ne saigne presque pas (ART_DIRECTION, Gore).
          const quiet = e.by === 'sentence' && !this.cried.has(e.id)
          const size = quiet ? 0.18 : e.by === 'union' ? 0.32 : 0.62
          this.add(p, size, e.tick, 'flaque', { grow: quiet ? 120 : 360 })
        }
        if (e.by === 'achevement' || e.by === 'variant-b') this.lastHit = e.tick
        break
      }
      case 'sever': {
        const p = posOf(e.owner)
        if (p) {
          const d = rot(e.tick, 5)
          this.add(p, 0.5, e.tick, 'trainee', { rot: d, len: 2.4 })
          this.spray(p, d, e.tick, 10, 2.6, 1, this.decalList.length * 3)
        }
        break
      }
      case 'burst': {
        const p = posOf(e.id)
        if (p) {
          const stage = e.stage
          this.add(p, 1.1 + 0.3 * stage, e.tick, 'eclat', { len: 1 })
          for (let i = 0; i < 5; i++) {
            const a = rot(e.tick, 30 + i)
            const r = 1 + h01(e.tick, 40 + i) * (1 + stage)
            this.add({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 0.3, e.tick, 'trainee', {
              rot: a,
              len: 2.5,
            })
          }
          this.spray(p, 0, e.tick, 24, 3.5, Math.PI * 2, 500)
          this.chunk(p, e.tick, 8 + 3 * stage, 'chair', 2.2 + stage * 0.6, 600)
        }
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
