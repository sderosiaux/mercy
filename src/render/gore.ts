// Mémoire du sang (§17.1 « Le sang, signe de la libération », ART_DIRECTION « Gore »), tirée des évènements de
// chaque pas : le monde ne garde pas cet historique, le rendu le reconstruit tick par tick, de façon déterministe
// (aucun tirage : tout dérive du tick et de l'id). Le rendu en est une fonction pure de l'horloge de rendu t.
// Aucune règle de simulation ne s'ajoute : tout sort des évènements existants.
// - chaque coup qui touche saigne selon ses dégâts et son arme : le tranchant projette un arc et une gerbe dans le
//   sens du coup, le contondant écrase en étoile, avec des éclats d'os ; les gouttelettes en vol retombent en
//   gouttes au sol ;
// - la libération, au coup fatal (début de l'agonie) : le corps rend son sang d'un coup, une gerbe sort de la plaie,
//   une flaque s'étend pendant l'agonie et continue quelques secondes, une brume rouge passe dans la lumière. La
//   Sentence en donne le plus ;
// - un Abattu saigne tant qu'il vit (flaque sous lui) et laisse une traînée quand il rampe ; un Membre arraché part
//   dans une fontaine ; un sac qui éclate arrose tout son rayon et trempe les corps qui en sortent ;
// - le sang frais est rouge vif pendant 2 s, puis fonce et sèche (goreview.ts) ; il ne s'efface pas pendant un
//   combat. Un décalque posé, vieux de 2 s et fini de s'étendre, passe dans la couche du sol (`absorbed`) qui
//   l'absorbe : le coût d'image ne dépend pas de la quantité accumulée. Le plafond de 400 (§24) ne porte que sur ce
//   qui vit encore à part : gouttelettes en vol, flaques qui s'étendent, sang des 2 dernières secondes ;
// - le Bourreau se tache à chaque libération et garde son sang, arme comprise ; sa mort ne le lave pas (L6) ;
// - un coup sur un Résistant à terre ne saigne pas : il sonne et jette un éclat doré (L4).
import type { Creature, EntityId, SimEvent, Tick, Vec2, World } from '../sim/index'
import { RENDER } from './constants'

export type DecalKind = 'eclat' | 'trainee' | 'flaque' | 'trace' | 'arc' | 'etoile' | 'goutte'

export interface Decal {
  readonly x: number
  readonly z: number
  readonly rot: number // direction (rad) : axe long de la traînée, de la trace, de l'arc
  readonly size: number // demi-largeur, m
  readonly born: Tick
  readonly kind: DecalKind
  readonly len: number // allongement (longueur / largeur)
  readonly grow: number // ticks pour atteindre la taille finale (flaques)
  readonly seed: number
  readonly until?: Tick // une flaque d'Abattu cesse de s'étendre quand il se relève ou meurt
  readonly depth: number // épaisseur relative (une flaque épaisse sèche en noir)
}

// Décalque absorbé par la couche du sol : sa forme finale (échelle figée) et son tick de naissance.
export interface Absorbed {
  readonly decal: Decal
  readonly scale: number
}

export interface Spark {
  readonly id: EntityId
  readonly x: number
  readonly z: number
  readonly born: Tick
}

// Gouttelette en vol : balistique, disparaît à l'atterrissage (sa goutte au sol est posée à cet instant).
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

// Bouffée de brume rouge (libération) : monte, s'étale et s'efface avant la fin des 2 s du sang frais.
export interface Mist {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly born: Tick
  readonly size: number
  readonly seed: number
}

// Tache de sang sur un corps vivant ou sur le Bourreau : niveau (0 à 1) ajouté à un tick.
interface StainStep {
  readonly born: Tick
  readonly level: number
}

export interface StainState {
  readonly old: number // niveau de sang ancien (plus de 2 s)
  readonly all: number // niveau total (sang frais compris)
}

export const SPARK_TICKS = 14
export const CHUNKS_MAX = 220
export const MIST_TICKS = 100 // < 2 s : la brume est du sang frais, elle s'éteint avant de pouvoir être ancienne
const DROPLET_MAX_TICKS = 90
const GRAVITY = 9.8 // m/s²
export const PLAYER_STAIN = -1 // clé des taches du Bourreau
// Couverture la plus haute. Le Bourreau peut finir couvert de sang, et le garde. Une créature vivante peut être
// trempée de sang frais (un sac qui éclate, une série de coups), mais ce qui en reste après 2 s se limite à des
// taches (`creatureOld`) : le sang séché est sombre, et un corps qui en serait couvert perdrait la chair qui le dit
// vivant (B2.O1 ; mesure E7 en S3 V6 graine 9 : chair du corps à C* 6 au lieu de 23, couverture sans limite).
export const STAIN_MAX = { player: 0.9, creature: 0.85, creatureOld: 0.25 } as const

// Bruit stable dans [0, 1) d'un (tick, k).
const h01 = (tick: number, k: number): number => {
  const s = Math.sin(tick * 91.7 + k * 13.3) * 43758.5453
  return s - Math.floor(s)
}

const rot = (tick: number, k: number): number => h01(tick, k) * Math.PI * 2

// Instant d'atterrissage (s) d'un corps lancé de la hauteur y à la vitesse verticale vy.
const landTime = (y: number, vy: number): number =>
  (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, y))) / GRAVITY

// Position d'une gouttelette ou d'un morceau au temps t (ticks), posée au sol à l'atterrissage.
export const ballistic = (
  p: Pick<Chunk, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'born'>,
  t: number,
): { x: number; y: number; z: number; landed: boolean } => {
  const age = Math.max(0, (t - p.born) / 60)
  const land = landTime(p.y, p.vy)
  const a = Math.min(age, land)
  return {
    x: p.x + p.vx * a,
    y: Math.max(0, p.y + p.vy * a - (GRAVITY * a * a) / 2),
    z: p.z + p.vz * a,
    landed: age >= land,
  }
}

// Taille courante d'un décalque : une flaque grandit (jusqu'à `until` pour celle d'un Abattu), le reste apparaît
// d'un coup.
export const decalScale = (d: Decal, t: number): number => {
  if (d.grow <= 0) return 1
  const tt = d.until === undefined ? t : Math.min(t, d.until)
  const k = Math.min(1, Math.max(0, (tt - d.born) / d.grow))
  return 0.25 + 0.75 * (1 - (1 - k) * (1 - k))
}

// Sang frais : rouge vif pendant 2 s (§17, §17.1).
export const isFresh = (d: Pick<Decal, 'born'>, t: number): boolean => t - d.born < RENDER.sangFraisTicks

// Tick à partir duquel un décalque ne change plus de forme ni n'est frais : il peut passer dans la couche du sol.
export const settledAt = (d: Decal): Tick =>
  Math.max(d.born + RENDER.sangFraisTicks, Math.min(d.until ?? Number.POSITIVE_INFINITY, d.born + d.grow))

const insideHost = (c: Creature): boolean =>
  c.state.kind === 'absorbe' || (c.state.kind === 'mort' && c.unionOf !== null && c.family !== 'membre')

export class GoreMemory {
  private decalList: Decal[] = []
  private absorbedList: Absorbed[] = []
  private sparkList: Spark[] = []
  private dropList: Droplet[] = []
  private chunkList: Chunk[] = []
  private mistList: Mist[] = []
  private readonly stains = new Map<number, { base: number; steps: StainStep[] }>()
  private readonly pools = new Map<EntityId, number>() // flaque d'un Abattu vivant (index de naissance)
  private readonly trailFrom = new Map<EntityId, Vec2>()
  private seen = -1
  private serial = 0
  generation = 0 // change à chaque nouvelle partie : la couche du sol repart de zéro
  lastHit: Tick | null = null

  // Nouvelle partie (laboratoire qui rejoue une scène depuis le tick 0, restart du jeu) : tout repart de zéro.
  clear(): void {
    this.decalList = []
    this.absorbedList = []
    this.sparkList = []
    this.dropList = []
    this.chunkList = []
    this.mistList = []
    this.stains.clear()
    this.pools.clear()
    this.trailFrom.clear()
    this.seen = -1
    this.serial = 0
    this.generation++
    this.lastHit = null
  }

  // Décalques encore à part (en train de s'étendre, ou frais) ; les autres sont dans `absorbed`.
  get decals(): readonly Decal[] {
    return this.decalList
  }
  get absorbed(): readonly Absorbed[] {
    return this.absorbedList
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
  get mists(): readonly Mist[] {
    return this.mistList
  }

  // Taches d'un corps (id) ou du Bourreau (PLAYER_STAIN) à l'horloge t.
  stain(id: number, t: number): StainState {
    const s = this.stains.get(id)
    if (!s) return { old: 0, all: 0 }
    let old = s.base
    let all = s.base
    for (const st of s.steps) {
      if (st.born > t) continue
      all += st.level
      if (t - st.born >= RENDER.sangFraisTicks) old += st.level
    }
    if (id === PLAYER_STAIN)
      return { old: Math.min(STAIN_MAX.player, old), all: Math.min(STAIN_MAX.player, all) }
    const o = Math.min(STAIN_MAX.creatureOld, old)
    return { old: o, all: Math.max(o, Math.min(STAIN_MAX.creature, all - old + o)) }
  }

  // À appeler une fois par pas de simulation ; un tick déjà vu est ignoré.
  ingest(world: World): void {
    if (world.tick <= this.seen) return
    this.seen = world.tick
    const byId = new Map(world.creatures.map((c) => [c.id, c]))
    const posOf = (id: EntityId | 'player'): Vec2 | null =>
      id === 'player' ? world.player.pos : (byId.get(id)?.pos ?? null)
    for (const e of world.events) this.event(e, world, byId, posOf)
    this.trails(world)
    this.sparkList = this.sparkList.filter((s) => world.tick - s.born < SPARK_TICKS)
    this.dropList = this.dropList.filter(
      (d) => world.tick - d.born < Math.min(DROPLET_MAX_TICKS, landTime(d.y, d.vy) * 60 + 1),
    )
    this.mistList = this.mistList.filter((m) => world.tick - m.born < MIST_TICKS)
    this.settle(world.tick)
    this.foldStains(world.tick)
  }

  // Ajoute un décalque (sang ancien des scènes du laboratoire, born dans le passé ; ou sang d'un évènement).
  add(
    pos: Vec2,
    size: number,
    born: Tick,
    kind: DecalKind = 'eclat',
    opts: { rot?: number; len?: number; grow?: number; depth?: number } = {},
  ): Decal {
    const n = this.serial++
    const d: Decal = {
      x: pos.x,
      z: pos.z,
      rot: opts.rot ?? rot(born, n),
      size,
      born,
      kind,
      len: opts.len ?? 1,
      grow: opts.grow ?? 0,
      seed: h01(born, n + 7) * 100 + n * 1e-3, // + n : deux décalques n'ont jamais la même graine
      depth: opts.depth ?? 0.5,
    }
    this.decalList.push(d)
    return d
  }

  // Passage dans la couche du sol : un décalque fini (frais depuis plus de 2 s, fini de s'étendre) au tick T − 1
  // (aucune image rendue entre T − 1 et T ne le montre encore en train de changer). Plafond de 400 (§24, §17.1) sur
  // les gouttelettes en vol et les flaques qui s'étendent : au-delà, les gouttelettes les plus anciennes s'arrêtent
  // (leur goutte au sol est déjà posée), puis les flaques les plus anciennes passent dans la couche à leur taille du
  // moment. Le sang frais posé (moins de 2 s) reste à part, pour que son âge soit exact au tick près.
  private settle(T: Tick): void {
    const keep: Decal[] = []
    for (const d of this.decalList) {
      if (settledAt(d) <= T - 1) this.absorbedList.push({ decal: d, scale: decalScale(d, T - 1) })
      else keep.push(d)
    }
    const growing = (d: Decal): boolean => d.grow > 0 && decalScale(d, T - 1) < 1 && d.until === undefined
    const pools = keep.filter(growing)
    const max = RENDER.decalquesMax
    if (pools.length + this.dropList.length > max) {
      const drop = Math.min(this.dropList.length, pools.length + this.dropList.length - max)
      this.dropList.sort((a, b) => a.born - b.born)
      this.dropList.splice(0, drop)
    }
    if (pools.length > max) {
      pools.sort((a, b) => a.born - b.born)
      const over = new Set(pools.slice(0, pools.length - max))
      for (const d of over) this.absorbedList.push({ decal: d, scale: decalScale(d, T - 1) })
      this.decalList = keep.filter((d) => !over.has(d))
      return
    }
    this.decalList = keep
  }

  // Les taches de plus de 2 s rejoignent la base (la liste reste courte).
  private foldStains(T: Tick): void {
    for (const s of this.stains.values()) {
      const old = s.steps.filter((st) => T - st.born >= RENDER.sangFraisTicks)
      if (old.length === 0) continue
      s.base += old.reduce((a, st) => a + st.level, 0)
      s.steps = s.steps.filter((st) => T - st.born < RENDER.sangFraisTicks)
    }
  }

  private addStain(id: number, born: Tick, level: number): void {
    const s = this.stains.get(id) ?? { base: 0, steps: [] }
    s.steps.push({ born, level })
    this.stains.set(id, s)
  }

  // Gouttelettes d'une gerbe ; une sur `every` laisse une goutte là où elle retombe, au tick où elle retombe.
  private spray(
    at: Vec2,
    y0: number,
    dir: number,
    tick: Tick,
    n: number,
    speed: number,
    spread: number,
    up: number,
    k0: number,
    every = 2,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = dir + (h01(tick, k0 + i) - 0.5) * spread
      const v = speed * (0.45 + h01(tick, k0 + 20 + i))
      const d: Droplet = {
        x: at.x,
        y: y0 + h01(tick, k0 + 40 + i) * 0.5,
        z: at.z,
        vx: Math.cos(a) * v,
        vy: up * (0.6 + h01(tick, k0 + 60 + i)),
        vz: Math.sin(a) * v,
        born: tick,
        size: 0.012 + h01(tick, k0 + 80 + i) * 0.02,
      }
      this.dropList.push(d)
      if (i % every !== 0) continue
      const lt = landTime(d.y, d.vy)
      this.add(
        { x: d.x + d.vx * lt, z: d.z + d.vz * lt },
        0.02 + d.size * 1.5,
        tick + Math.ceil(lt * 60),
        'goutte',
        { rot: Math.atan2(d.vz, d.vx), len: 1 + Math.min(1.2, Math.hypot(d.vx, d.vz) * 0.18), depth: 0.3 },
      )
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

  // Brume rouge de la libération : bouffées qui montent et s'étalent.
  private mist(at: Vec2, tick: Tick, n: number, k0: number): void {
    for (let i = 0; i < n; i++) {
      const a = rot(tick, k0 + i)
      const r = 0.15 + h01(tick, k0 + 10 + i) * 0.35
      this.mistList.push({
        x: at.x + Math.cos(a) * r,
        y: 0.5 + h01(tick, k0 + 20 + i) * 0.9,
        z: at.z + Math.sin(a) * r,
        vx: Math.cos(a) * (0.2 + h01(tick, k0 + 30 + i) * 0.4),
        vy: 0.25 + h01(tick, k0 + 40 + i) * 0.35,
        vz: Math.sin(a) * (0.2 + h01(tick, k0 + 30 + i) * 0.4),
        born: tick,
        size: 0.5 + h01(tick, k0 + 50 + i) * 0.6,
        seed: h01(tick, k0 + 60 + i),
      })
    }
  }

  // Traînée d'un corps qui rampe (Abattu, Membre errant) : un trait tous les 0,45 m parcourus à terre. Elle montre
  // vers quel support il va (L1).
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
      if (d < 0.45) continue
      if (d < 2.5) {
        const w = c.family === 'membre' ? 0.13 : 0.24
        this.add({ x: (from.x + c.pos.x) / 2, z: (from.z + c.pos.z) / 2 }, w, world.tick, 'trace', {
          rot: Math.atan2(dz, dx),
          len: (d / (2 * w)) * 1.15,
          depth: 0.6,
        })
      }
      this.trailFrom.set(c.id, c.pos)
    }
  }

  // La flaque d'un Abattu cesse de s'étendre quand il se relève, meurt, est avalé ou emporté.
  private stopPool(id: EntityId, tick: Tick): void {
    const n = this.pools.get(id)
    if (n === undefined) return
    this.pools.delete(id)
    const i = this.decalList.findIndex((d) => d.kind === 'flaque' && d.seed === n)
    const d = this.decalList[i]
    if (d && d.until === undefined) this.decalList[i] = { ...d, until: tick }
  }

  private event(
    e: SimEvent,
    world: World,
    byId: ReadonlyMap<EntityId, Creature>,
    posOf: (id: EntityId | 'player') => Vec2 | null,
  ): void {
    switch (e.type) {
      case 'hit': {
        if (e.by === 'player' && e.target !== 'player') this.lastHit = e.tick
        const p = posOf(e.target)
        if (!p) break
        const from = posOf(e.by)
        const dir = from ? Math.atan2(p.z - from.z, p.x - from.x) : rot(e.tick, 3)
        // Le sang suit les dégâts : 0,4 pour une égratignure, 1,6 au plus.
        const k = Math.min(1.6, Math.max(0.4, e.amount / 14))
        const k0 = this.serial * 3
        if (e.target === 'player') {
          // Le Bourreau saigne aussi, et se tache.
          this.add(p, 0.16 + 0.1 * k, e.tick, 'eclat', { rot: dir, depth: 0.3 })
          this.spray(p, 1.0, dir, e.tick, Math.round(5 + 4 * k), 1.6, 1.4, 1.6, k0)
          this.addStain(PLAYER_STAIN, e.tick, 0.015 * k)
          break
        }
        this.addStain(e.target, e.tick, 0.1 * k)
        if (e.damageType === 'tranchant') {
          // Le tranchant ouvre et projette : un arc en travers du coup, une traînée au-delà du corps, une gerbe.
          const off = 0.45 + 0.25 * k
          const at = { x: p.x + Math.cos(dir) * off, z: p.z + Math.sin(dir) * off }
          this.add(at, 0.42 + 0.3 * k, e.tick, 'arc', { rot: dir, len: 1, depth: 0.35 })
          this.add(
            { x: p.x + Math.cos(dir) * (off + 0.5), z: p.z + Math.sin(dir) * (off + 0.5) },
            0.16 + 0.1 * k,
            e.tick,
            'trainee',
            { rot: dir, len: 3.4 + h01(e.tick, k0) * 1.8, depth: 0.4 },
          )
          this.spray(p, 0.9, dir, e.tick, Math.round(10 + 12 * k), 3.6, 0.9, 1.8, k0)
        } else if (e.damageType === 'contondant') {
          // Le contondant écrase : une étoile autour du point d'impact, des éclats d'os, une gerbe en couronne.
          this.add(
            { x: p.x + Math.cos(dir) * 0.2, z: p.z + Math.sin(dir) * 0.2 },
            0.32 + 0.28 * k,
            e.tick,
            'etoile',
            { rot: dir, len: 1, depth: 0.55 },
          )
          this.spray(p, 0.8, dir, e.tick, Math.round(12 + 12 * k), 2.4, Math.PI * 2, 1.4, k0)
          this.chunk(p, e.tick, 2 + Math.round(k), 'os', 1.6, k0 * 5)
          this.chunk(p, e.tick, 1, 'chair', 1.4, k0 * 5 + 300)
        } else {
          this.add(p, 0.22 + 0.15 * k, e.tick, 'eclat', { rot: dir, depth: 0.4 })
          this.spray(p, 0.9, dir, e.tick, Math.round(6 + 6 * k), 2, 1.4, 1.5, k0)
        }
        break
      }
      case 'fell': {
        const p = posOf(e.id)
        // Les Abattus placés au tick 0 (scènes de test) ne saignent pas : aucun coup n'a eu lieu.
        if (!p || e.tick <= 0) break
        // Un Abattu saigne tant qu'il vit : la flaque grandit sous lui.
        const c = byId.get(e.id)
        const size = c?.family === 'membre' ? 0.26 : c?.size === 'large' ? 0.75 : 0.6
        const k0 = this.serial * 3
        const pool = this.add(p, size, e.tick, 'flaque', { grow: 720, depth: 0.8 })
        this.pools.set(e.id, pool.seed)
        this.spray(p, 0.6, rot(e.tick, k0), e.tick, 6, 1.2, Math.PI * 2, 1, k0)
        break
      }
      case 'rise':
        this.stopPool(e.id, e.tick)
        break
      case 'absorb':
      case 'assemble':
        for (const id of e.others) this.stopPool(id, e.tick)
        break
      case 'death': {
        this.stopPool(e.id, e.tick)
        const c = byId.get(e.id)
        const p = posOf(e.id)
        if (e.by === 'achevement' || e.by === 'variant-b') this.lastHit = e.tick
        if (e.by !== 'union') {
          // Le Bourreau se tache à chaque libération (§17.1) ; la Sentence, un rite, le tache le plus.
          this.addStain(PLAYER_STAIN, e.tick, e.by === 'sentence' ? 0.11 : 0.07)
        }
        if (!p || (c && insideHost(c))) break
        const pl = world.player.pos
        const dir = Math.atan2(p.z - pl.z, p.x - pl.x)
        const k0 = this.serial * 3 + 1000
        if (c?.family === 'membre') {
          // Un bras qui meurt avec son tout (L5) : il rend le peu de sang qui lui reste.
          this.add(p, 0.3, e.tick, 'flaque', { grow: 90, depth: 0.6 })
          this.spray(p, 0.3, rot(e.tick, 9), e.tick, 8, 1.2, Math.PI * 2, 1.2, k0)
          break
        }
        // La libération : le corps rend son sang d'un coup. La Sentence en donne le plus (une exécution, un rite).
        const big = e.by === 'sentence' ? 1.5 : e.by === 'variant-b' ? 1.2 : e.by === 'union' ? 0.75 : 1
        const large = c?.size === 'large' ? 1.25 : 1
        const s = big * large
        this.add(p, 1.1 * s, e.tick, 'flaque', { grow: 420, depth: 1 })
        this.add(
          { x: p.x + Math.cos(dir) * 0.7 * s, z: p.z + Math.sin(dir) * 0.7 * s },
          0.3 * s,
          e.tick,
          'trainee',
          { rot: dir, len: 4.2, depth: 0.7 },
        )
        // Gerbe : un jet qui sort de la plaie, vers le haut et dans le sens du coup.
        this.spray(p, 0.8, dir, e.tick, Math.round(36 * s), 3.2, 1.2, 3.4, k0, 3)
        // Et en couronne, plus bas.
        this.spray(p, 0.5, dir, e.tick, Math.round(18 * s), 1.6, Math.PI * 2, 1.6, k0 + 200, 3)
        if (e.by === 'sentence') {
          this.add(p, 0.6, e.tick, 'etoile', { rot: dir, depth: 0.8 })
          this.add(
            { x: p.x - Math.cos(dir) * 0.6, z: p.z - Math.sin(dir) * 0.6 },
            0.55,
            e.tick + 6,
            'flaque',
            { grow: 240, depth: 0.9 },
          )
        }
        this.mist(p, e.tick, Math.round(6 * s), k0 + 400)
        break
      }
      case 'sever': {
        const p = posOf(e.owner)
        if (!p) break
        // Un Membre arraché part dans une fontaine.
        const d = rot(e.tick, 5)
        const k0 = this.serial * 3 + 2000
        this.add(p, 0.4, e.tick, 'trainee', { rot: d, len: 2.8, depth: 0.6 })
        this.add(p, 0.35, e.tick, 'flaque', { grow: 150, depth: 0.7 })
        this.spray(p, 1.1, d, e.tick, 26, 1.4, Math.PI * 2, 4.2, k0, 2)
        this.mist(p, e.tick, 3, k0 + 100)
        break
      }
      case 'burst': {
        const p = posOf(e.id)
        if (!p) break
        // Un sac qui éclate arrose tout son rayon (§8.10 : 2 m + 1 m par stade) ; les corps qui en sortent sont
        // trempés.
        const stage = e.stage
        const R = 2 + stage
        const k0 = this.serial * 3 + 3000
        this.add(p, 1.1 + 0.3 * stage, e.tick, 'flaque', { grow: 120, depth: 1 })
        const n = 14 + 6 * stage
        for (let i = 0; i < n; i++) {
          const a = rot(e.tick, 30 + i)
          const r = R * Math.sqrt(0.08 + 0.92 * h01(e.tick, 40 + i))
          const kind: DecalKind = i % 3 === 0 ? 'trainee' : i % 3 === 1 ? 'eclat' : 'goutte'
          this.add(
            { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r },
            0.18 + 0.2 * h01(e.tick, 50 + i),
            e.tick,
            kind,
            {
              rot: a,
              len: kind === 'trainee' ? 2.5 : 1.2,
              depth: 0.5,
            },
          )
        }
        this.spray(p, 1, 0, e.tick, 40 + 10 * stage, 3.5, Math.PI * 2, 2.4, k0, 3)
        this.chunk(p, e.tick, 8 + 3 * stage, 'chair', 2.2 + stage * 0.6, 600)
        for (const id of e.others) this.addStain(id, e.tick, 0.8)
        for (const c of world.creatures) {
          if (c.id === e.id || e.others.includes(c.id)) continue
          if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) <= R) this.addStain(c.id, e.tick, 0.35)
        }
        if (Math.hypot(world.player.pos.x - p.x, world.player.pos.z - p.z) <= R)
          this.addStain(PLAYER_STAIN, e.tick, 0.08)
        break
      }
      case 'clang': {
        const p = posOf(e.id)
        this.lastHit = e.tick
        if (p) this.sparkList.push({ id: e.id, x: p.x, z: p.z, born: e.tick })
        break
      }
      case 'reset': {
        // L6 : ce qui n'est pas mort revient à son état d'origine, ses taches comprises ; le sang au sol et celui du
        // Bourreau restent (sa mort ne le lave pas).
        for (const id of [...this.stains.keys()]) if (id !== PLAYER_STAIN) this.stains.delete(id)
        for (const id of [...this.pools.keys()]) this.stopPool(id, e.tick)
        this.trailFrom.clear()
        break
      }
      default:
        break
    }
  }
}
