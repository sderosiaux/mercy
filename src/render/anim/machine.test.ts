// Machine d'états d'animation, sur de vrais mondes de la simulation (familles du jeu) : l'impact du clip tombe au
// tick actif, la réaction coupe en 2 images, la mort joue son agonie puis se fige, le Rituel est synchrone, la
// locomotion suit le chemin parcouru, la chute touche le sol à la fin du halètement.
import { describe, expect, it } from 'vitest'
import {
  type Creature,
  FAMILIES,
  type FamilyKind,
  type PlayerCommands,
  step,
  TICK_HZ,
  TUNING,
  type World,
} from '../../sim/index'
import { cmd, scene, withCreature, withPlayer } from '../../sim/testing'
import {
  AGONY_FALL_RATE_MAX,
  agonyFrame,
  agonyKind,
  animate,
  type Catalog,
  type ClipInfo,
  collapseClip,
  deathFrame,
  diedLying,
  fallRecipe,
  type Layer,
  type MachineInput,
  REACTION_PARTIAL,
} from './machine'
import { AnimMemory, PLAYER_TRACK } from './memory'
import { type ClipRecipe, clipTimeAt, FRAME_S } from './playback'

const r = (
  name: string,
  boucle: boolean,
  impactS: number | null = null,
  rate = 1,
  startS = 0,
): ClipRecipe => ({
  name,
  boucle,
  impactS,
  startS,
  rate,
})

// Catalogue du Souriant tel que le manifeste le décrit (durées des clips du GLB).
const SOURIANT: Catalog = new Map<string, ClipInfo>([
  ['rituel.danse', { recipe: r('rituel.danse', true), duration: 3.5 }],
  ['rituel.fauche', { recipe: r('rituel.fauche', true), duration: 3.967 }],
  ['course', { recipe: r('course', true, null, 1.683), duration: 1.483 }],
  ['attaque.morsure', { recipe: r('attaque.morsure', false, 0.417, 1.0425), duration: 1.967 }],
  ['reaction', { recipe: r('reaction', false), duration: 1.633 }],
  ['chute', { recipe: r('chute', false), duration: 3.5, settleS: 2.23 }],
  ['abattu.reptation', { recipe: r('abattu.reptation', true, null, 1.8), duration: 0.967 }],
  ['abattu.torsion', { recipe: r('abattu.torsion', true), duration: 3.033 }],
  ['relevement', { recipe: r('relevement', false, null, 1.311), duration: 1.967 }],
])

const RECOUSU: Catalog = new Map<string, ClipInfo>([
  ['marche', { recipe: r('marche', true, null, 5.197), duration: 5.5 }],
  ['attaque.marteau', { recipe: r('attaque.marteau', false, 1.15, 1.278), duration: 2.967 }],
  ['attaque.empoignade', { recipe: r('attaque.empoignade', false, 1.167, 1.167), duration: 2.967 }],
  ['reaction', { recipe: r('reaction', false), duration: 1.167 }],
  ['chute', { recipe: r('chute', false), duration: 2.5, settleS: 0.97 }],
  ['abattu.torsion', { recipe: r('abattu.torsion', true), duration: 3.3 }],
])

const input = (_w: World, mem: AnimMemory, c: Creature, t: number, catalog: Catalog): MachineInput => ({
  family: c.family,
  id: c.id,
  catalog,
  track: mem.track(c.id),
  t,
  groupPhase: c.ritualPhase,
  group: c.group,
  alertedAt: c.state.kind === 'hostile' ? c.state.alertedAt : null,
  toPlayer: 0,
})

const layer = (ls: readonly Layer[], clip: string): Layer | undefined => ls.find((l) => l.clip === clip)

// Une partie : chaque monde est observé comme le fait le rendu (renderer.observe après chaque step).
const play = (w0: World, policy: (w: World) => PlayerCommands, until: (w: World) => boolean, max = 600) => {
  const mem = new AnimMemory()
  let w = w0
  mem.observe(w)
  const worlds = [w]
  while (!until(w) && w.tick < max) {
    w = step(w, policy(w))
    mem.observe(w)
    worlds.push(w)
  }
  return { mem, w, worlds }
}

const face = (family: FamilyKind, x = 1.3, extra: Partial<Creature> = {}): World => {
  let w = scene([{ family, pos: { x, z: 0 }, facing: Math.PI, state: 'hostile' }], { families: FAMILIES })
  const c = w.creatures[0] as Creature
  w = withCreature(w, c.id, extra)
  return w
}

describe('calage des attaques', () => {
  it("le repère d'impact du clip tombe au tick actif de l'action de la simulation", () => {
    const { mem, w } = play(
      face('souriant'),
      () => cmd(),
      (x) => (x.creatures[0]?.action?.activeAt ?? -1) === x.tick,
    )
    const c = w.creatures[0] as Creature
    expect(c.action?.name).toBe('morsure')
    const f = animate(input(w, mem, c, w.tick, SOURIANT))
    const l = layer(f.layers, 'attaque.morsure')
    expect(l?.weight).toBe(1)
    expect(l?.time).toBeCloseTo(0.417, 9)
  })
  it('un télégraphe réglé autrement déplace la vitesse, pas l’impact', () => {
    const { w } = play(
      face('souriant'),
      () => cmd(),
      (x) => x.creatures[0]?.action !== null,
    )
    const c = w.creatures[0] as Creature
    const a = c.action
    if (!a) throw new Error('pas d’action')
    // Même action, télégraphe allongé de 12 ticks (un autre réglage) : l'impact suit.
    const longer = withCreature(w, c.id, { action: { ...a, activeAt: a.activeAt + 12, end: a.end + 12 } })
    const mem = new AnimMemory()
    mem.observe(longer)
    const c2 = longer.creatures[0] as Creature
    const f = animate(input(longer, mem, c2, a.activeAt + 12, SOURIANT))
    expect(layer(f.layers, 'attaque.morsure')?.time).toBeCloseTo(0.417, 9)
  })
})

describe('réaction interrompante', () => {
  const hitPolicy = (w: World): PlayerCommands => {
    const c = w.creatures[0]
    const a = c?.action
    return a && a.kind === 'attaque' && w.tick === a.start + 6
      ? cmd({ strike: true, aim: c.pos })
      : cmd({ aim: c?.pos })
  }
  it('petite créature : réaction pleine 2 images après le coup, attaque coupée', () => {
    const { mem, worlds } = play(face('souriant', 1.3, { chair: 20 }), hitPolicy, (x) =>
      x.events.some((e) => e.type === 'action-interrupted'),
    )
    const w = worlds.at(-1) as World
    const hit = w.tick
    const c = w.creatures[0] as Creature
    const at = (dt: number) => animate(input(w, mem, c, hit + dt, SOURIANT))
    expect(layer(at(0).layers, 'reaction')).toBeUndefined()
    expect(layer(at(1).layers, 'reaction')?.weight).toBeCloseTo(0.5, 9)
    expect(layer(at(2).layers, 'reaction')?.weight).toBe(1)
    expect(layer(at(2).layers, 'attaque.morsure')).toBeUndefined()
  })
  it('grande créature non interrompue : réaction partielle, l’attaque continue et frappe à son tick', () => {
    const { mem, worlds } = play(
      face('recousu', 1.6),
      (w) => {
        const c = w.creatures[0]
        const a = c?.action
        return a && a.kind === 'attaque' && w.tick === a.start + 6
          ? cmd({ strike: true, aim: c.pos })
          : cmd({ aim: c?.pos })
      },
      (x) => x.events.some((e) => e.type === 'hit' && e.target === x.creatures[0]?.id),
    )
    const w = worlds.at(-1) as World
    expect(w.events.some((e) => e.type === 'action-interrupted')).toBe(false)
    const c = w.creatures[0] as Creature
    const a = c.action
    if (!a) throw new Error('attaque attendue')
    const f = animate(input(w, mem, c, w.tick + 2, RECOUSU))
    expect(layer(f.layers, 'reaction')?.weight).toBeCloseTo(REACTION_PARTIAL, 9)
    // À l'impact (plus de 12 + 8 ticks après le coup), seule l'attaque : son repère tombe au tick actif.
    const impact = animate(input(w, mem, c, a.activeAt, RECOUSU))
    const name = `attaque.${a.name === 'coupDeTete' ? 'coup-de-tete' : a.name}`
    const info = RECOUSU.get(name) as ClipInfo
    expect(layer(impact.layers, name)?.time).toBeCloseTo(info.recipe.impactS as number, 9)
  })
})

describe('mort et agonie (L4, TUNING.agonie)', () => {
  const A = TUNING.agonie
  const chuteOf = (l: readonly Layer[]): Layer | undefined => layer(l, 'chute')

  it('à terre : au coup, la pose du vivant ; pendant l’agonie, un dernier spasme ; ensuite, plus rien', () => {
    // Souriant à terre (placé), achevé par le joueur.
    let w = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, facing: 0, state: 'abattu' }], {
      families: FAMILIES,
    })
    const id = (w.creatures[0] as Creature).id
    const mem = new AnimMemory()
    mem.observe(w)
    while (w.creatures[0]?.state.kind !== 'mort' && w.tick < 200) {
      w = step(w, cmd({ strike: w.player.action === null, aim: (w.creatures[0] as Creature).pos }))
      mem.observe(w)
    }
    const c = w.creatures[0] as Creature
    expect(c.state.kind).toBe('mort')
    const at = c.state.kind === 'mort' ? c.state.at : -1
    expect(diedLying(mem.track(id), at)).toBe(true)
    expect(agonyKind(mem.track(id), at)).toBe('spasme')
    // Image du coup : la pose est celle que le vivant avait au tick de la mort.
    const living = animate(input(w, mem, c, at, SOURIANT))
    const first = agonyFrame(input(w, mem, c, at, SOURIANT), at, at)
    expect(first.layers).toEqual(living.layers)
    expect(first.tremble).toBe(living.tremble)
    // Pendant l'agonie, le corps bouge (le clip couché avance, le spasme monte).
    const mid = agonyFrame(input(w, mem, c, at, SOURIANT), at, at + A / 2)
    expect(mid.layers).not.toEqual(first.layers)
    expect(mid.tremble).toBeGreaterThan(living.tremble)
    // La fin de l'agonie est la pose figée : sans tremblement, et identique ensuite, quoi que la mémoire observe.
    const frozen = deathFrame(input(w, mem, c, at, SOURIANT), at)
    expect(frozen).toEqual(agonyFrame(input(w, mem, c, at, SOURIANT), at, at + A))
    expect(frozen.tremble).toBe(0)
    expect(agonyFrame(input(w, mem, c, at, SOURIANT), at, at + A + 500)).toEqual(frozen)
    for (let k = 0; k < 60; k++) {
      w = step(w, cmd())
      mem.observe(w)
    }
    expect(deathFrame(input(w, mem, w.creatures[0] as Creature, at, SOURIANT), at)).toEqual(frozen)
  })

  it('tué pendant sa chute : il finit de tomber pendant l’agonie, sans sauter à sa pose finale', () => {
    let w = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, facing: Math.PI, state: 'hostile' }], {
      families: FAMILIES,
    })
    w = withCreature(w, 1, { chair: 10 })
    const mem = new AnimMemory()
    mem.observe(w)
    while (w.creatures[0]?.state.kind !== 'mort' && w.tick < 200) {
      w = step(w, cmd({ strike: w.player.action === null, aim: (w.creatures[0] as Creature).pos }))
      mem.observe(w)
    }
    const c = w.creatures[0] as Creature
    const at = c.state.kind === 'mort' ? c.state.at : -1
    const since = mem.track(1)?.segments.find((s) => s.key.kind === 'down')?.from ?? -1
    expect(at - since).toBeLessThan(TUNING.criDelai) // achevé avant de toucher le sol
    const settle = (SOURIANT.get('chute') as ClipInfo).settleS as number
    const t0 = chuteOf(agonyFrame(input(w, mem, c, at, SOURIANT), at, at).layers)?.time ?? 0
    const t1 = chuteOf(agonyFrame(input(w, mem, c, at, SOURIANT), at, at + A / 2).layers)?.time ?? 0
    expect(t0).toBeLessThan(settle) // encore en l'air dans l'image du coup
    expect(t1).toBeGreaterThan(t0)
    expect(t1).toBeLessThan(settle)
    const end = deathFrame(input(w, mem, c, at, SOURIANT), at)
    expect(chuteOf(end.layers)?.time).toBeCloseTo(settle, 9) // au sol à la fin de l'agonie
    expect(chuteOf(end.layers)?.weight).toBe(1)
  })

  it('tué debout (variante B) : il tombe pendant l’agonie, de sa pose vivante jusqu’au sol', () => {
    let w = scene([{ family: 'souriant', pos: { x: 1.3, z: 0 }, facing: Math.PI, state: 'hostile' }], {
      families: FAMILIES,
      variant: 'B',
    })
    w = withCreature(w, 1, { chair: 1 })
    const mem = new AnimMemory()
    mem.observe(w)
    while (w.creatures[0]?.state.kind !== 'mort' && w.tick < 200) {
      w = step(w, cmd({ strike: w.player.action === null, aim: (w.creatures[0] as Creature).pos }))
      mem.observe(w)
    }
    const c = w.creatures[0] as Creature
    expect(c.state.kind).toBe('mort')
    const at = c.state.kind === 'mort' ? c.state.at : -1
    expect(agonyKind(mem.track(1), at)).toBe('effondrement')
    expect(collapseClip(SOURIANT)).toBe('chute') // le catalogue de test n'a pas de mort debout
    const first = agonyFrame(input(w, mem, c, at, SOURIANT), at, at)
    expect(chuteOf(first.layers)).toBeUndefined() // image du coup : la pose vivante, pas encore de chute
    const end = deathFrame(input(w, mem, c, at, SOURIANT), at)
    const settle = (SOURIANT.get('chute') as ClipInfo).settleS as number
    expect(end.layers).toEqual([{ clip: 'chute', time: settle, weight: 1 }])
    expect(end.tremble).toBe(0)
    // La descente tient dans l'agonie, à AGONY_FALL_RATE_MAX au plus.
    const mid = chuteOf(agonyFrame(input(w, mem, c, at, SOURIANT), at, at + A / 2).layers)
    expect(mid?.time).toBeCloseTo(settle - (AGONY_FALL_RATE_MAX * A) / 2 / TICK_HZ, 9)
  })

  it('un mort sans passé (placé mort) repose à la fin de sa chute, sans agonie', () => {
    const w = scene([{ family: 'souriant', pos: { x: 3, z: 0 }, facing: 0, state: 'mort' }], {
      families: FAMILIES,
    })
    const mem = new AnimMemory()
    mem.observe(w)
    const c = w.creatures[0] as Creature
    expect(agonyKind(mem.track(c.id), 0)).toBe('aucune')
    const f = deathFrame(input(w, mem, c, 0, SOURIANT), 0)
    expect(f.layers).toEqual([{ clip: 'chute', time: 3.5, weight: 1 }])
    expect(f.tremble).toBe(0)
    expect(agonyFrame(input(w, mem, c, 0, SOURIANT), 0, 0)).toEqual(f)
  })
})

describe('chute', () => {
  it('le corps touche le sol à la fin du halètement (L2), à au plus × 2', () => {
    const info = SOURIANT.get('chute') as ClipInfo
    const fr = fallRecipe(info)
    expect(fr.rate).toBeLessThanOrEqual(2)
    const t = clipTimeAt({ ...info.recipe, ...fr }, info.duration, TUNING.criDelai / TICK_HZ, true)
    expect(t).toBeCloseTo(info.settleS as number, 9)
    const rec = RECOUSU.get('chute') as ClipInfo
    const fr2 = fallRecipe(rec)
    expect(fr2.startS).toBe(0) // 0,97 s : × 1,94 suffit, rien n'est sauté
    expect(clipTimeAt({ ...rec.recipe, ...fr2 }, rec.duration, TUNING.criDelai / TICK_HZ, true)).toBeCloseTo(
      0.97,
      9,
    )
  })
})

describe('Rituel et locomotion', () => {
  it('un groupe en Rituel joue le même clip au même instant ; Hostiles, chacun sa phase', () => {
    const w = scene(
      [
        { family: 'souriant', pos: { x: 5, z: 0 }, facing: 0, state: 'rituel', group: 3 },
        { family: 'souriant', pos: { x: 7, z: 0 }, facing: 0, state: 'rituel', group: 3 },
      ],
      { families: FAMILIES },
    )
    const mem = new AnimMemory()
    mem.observe(w)
    const [a, b] = w.creatures as [Creature, Creature]
    const phase = a.ritualPhase
    const fa = animate({ ...input(w, mem, a, 37, SOURIANT), groupPhase: phase })
    const fb = animate({ ...input(w, mem, b, 37, SOURIANT), groupPhase: phase })
    expect(fa.layers).toEqual(fb.layers)
    expect(fa.layers[0]?.clip.startsWith('rituel.')).toBe(true)
  })
  it('la course avance avec le chemin parcouru ; immobile, le clip ne défile pas', () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 9, z: 0 }, facing: Math.PI, state: 'hostile' }], {
      families: FAMILIES,
    })
    const { mem, w } = play(
      w0,
      () => cmd(),
      (x) => x.tick >= 40,
    )
    const c = w.creatures[0] as Creature
    const f1 = animate(input(w, mem, c, w.tick - 1, SOURIANT))
    const f2 = animate(input(w, mem, c, w.tick, SOURIANT))
    const l1 = layer(f1.layers, 'course')
    const l2 = layer(f2.layers, 'course')
    expect(l1).toBeDefined()
    // Un tick de course à 4,5 m/s, à la vitesse de lecture du manifeste.
    const expected = (TUNING.souriant.speed * FRAME_S * 1.683) / TUNING.souriant.speed
    const d = ((((l2?.time ?? 0) - (l1?.time ?? 0)) % 1.483) + 1.483) % 1.483
    expect(d).toBeCloseTo(expected, 6)
  })
})

describe('pureté', () => {
  it('même mémoire, même horloge : même pose', () => {
    const { mem, w } = play(
      face('souriant'),
      () => cmd(),
      (x) => x.tick >= 50,
    )
    const c = w.creatures[0] as Creature
    const a = animate(input(w, mem, c, 49.5, SOURIANT))
    const b = animate(input(w, mem, c, 49.5, SOURIANT))
    expect(a).toEqual(b)
  })
})

describe('Bourreau', () => {
  const BOURREAU: Catalog = new Map<string, ClipInfo>([
    ['repos', { recipe: r('repos', true), duration: 4 }],
    ['course', { recipe: r('course', true, null, 1.812), duration: 0.733 }],
    ['frappe.couperet.1', { recipe: r('frappe.couperet.1', false, 0.567, 1, 0.567), duration: 1.5 }],
    ['frappe.couperet.2', { recipe: r('frappe.couperet.2', false, 0.783, 1, 0.783), duration: 3.167 }],
    ['frappe.masse.1', { recipe: r('frappe.masse.1', false, 1.55, 1, 1.55), duration: 1.8 }],
    ['balayage', { recipe: r('balayage', false, 1.6, 1, 1.6), duration: 5.667 }],
    ['esquive', { recipe: r('esquive', false, null, 4.222, 0), duration: 1.267 }],
    [
      'sentence.tranchant.petite',
      { recipe: r('sentence.tranchant.petite', false, 1.633, 2.722, 0), duration: 1.967 },
    ],
  ])
  const pin = (_w: World, mem: AnimMemory, t: number): MachineInput => ({
    family: 'bourreau',
    id: PLAYER_TRACK,
    catalog: BOURREAU,
    track: mem.track(PLAYER_TRACK),
    t,
    groupPhase: 0,
    group: null,
    alertedAt: null,
    toPlayer: 0,
  })
  const timeOf = (f: { layers: readonly Layer[] }, clip: string): number =>
    layer(f.layers, clip)?.time ?? Number.NaN
  const weightOf = (f: { layers: readonly Layer[] }, clip: string): number =>
    layer(f.layers, clip)?.weight ?? 0
  // Tick d'impact d'un geste du joueur dans la simulation : celui de son évènement `player-impact`.
  const impactTick = (worlds: readonly World[]): number | null =>
    worlds.flatMap((x) => x.events).find((e) => e.type === 'player-impact')?.tick ?? null

  // E3 : la simulation frappe `windup` ticks après le début du geste (PlayerAction.activeAt).
  for (const weapon of ['couperet', 'masse'] as const) {
    it(`frappe (${weapon}) : anticipation pendant les ${TUNING.weapons[weapon].windup} ticks, repère d'impact au tick d'impact de la simulation`, () => {
      const w0 = withPlayer(
        scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, facing: Math.PI, state: 'hostile' }], {
          families: FAMILIES,
        }),
        { weapon },
      )
      const { mem, w, worlds } = play(
        w0,
        (x) => cmd({ strike: x.player.action === null && x.tick === 0, aim: { x: 1.2, z: 0 } }),
        (x) => x.events.some((e) => e.type === 'player-impact'),
      )
      const a = worlds.find((x) => x.player.action?.kind === 'frappe')?.player.action
      expect(a?.activeAt).toBe((a?.start ?? 0) + TUNING.weapons[weapon].windup)
      if (!a || a.activeAt === undefined) return
      expect(impactTick(worlds)).toBe(a.activeAt)
      const clip = `frappe.${weapon}.1`
      const impactS = (BOURREAU.get(clip) as ClipInfo).recipe.impactS as number
      // Pendant l'anticipation, le clip avance image par image vers son repère sans l'atteindre ; il y est au tick
      // d'impact, à vitesse 1 (celle du manifeste).
      const times = [...Array(a.activeAt - a.start + 1).keys()].map((k) => {
        const f = animate(pin(w, mem, a.start + k))
        expect(weightOf(f, clip)).toBe(1)
        return timeOf(f, clip)
      })
      for (let k = 1; k < times.length; k++)
        expect(times[k] as number).toBeGreaterThan(times[k - 1] as number)
      expect(times.slice(0, -1).every((x) => x < impactS)).toBe(true)
      expect(times.at(-1)).toBeCloseTo(impactS, 9)
      expect((times[1] as number) - (times[0] as number)).toBeCloseTo(FRAME_S, 9)
    })
  }

  it("balayage : repère d'impact au tick d'impact de la simulation, anticipation avant", () => {
    const w0 = withPlayer(
      scene([{ family: 'souriant', pos: { x: 3, z: 0 }, facing: Math.PI, state: 'rituel' }], {
        families: FAMILIES,
      }),
      { ferveur: 30 },
    )
    const { mem, w, worlds } = play(
      w0,
      (x) => cmd({ rite: x.tick === 0 ? 'balayage' : null }),
      (x) => x.events.some((e) => e.type === 'player-impact'),
    )
    const a = worlds.find((x) => x.player.action?.kind === 'balayage')?.player.action
    expect(a?.activeAt).toBeGreaterThan(a?.start ?? 0)
    if (!a || a.activeAt === undefined) return
    expect(impactTick(worlds)).toBe(a.activeAt)
    expect(timeOf(animate(pin(w, mem, a.activeAt - 1)), 'balayage')).toBeLessThan(1.6)
    expect(timeOf(animate(pin(w, mem, a.activeAt)), 'balayage')).toBeCloseTo(1.6, 9)
  })

  it("une Esquive pendant l'anticipation coupe le geste en 2 images, sans jamais montrer l'impact", () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 5, z: 0 }, facing: Math.PI, state: 'rituel' }], {
      families: FAMILIES,
    })
    // Frappe commandée au tick 0 (geste à partir du tick 1), Esquive commandée au tick 2 (esquive au tick 3).
    const { mem, w, worlds } = play(
      w0,
      (x) => cmd({ strike: x.tick === 0, dodge: x.tick === 2, aim: { x: 5, z: 0 } }),
      (x) => x.tick >= 12,
    )
    const frappe = worlds.find((x) => x.player.action?.kind === 'frappe')?.player.action
    const esquive = worlds.find((x) => x.player.action?.kind === 'esquive')?.player.action
    expect(frappe?.activeAt).toBeDefined()
    if (!frappe || !esquive || frappe.activeAt === undefined) return
    expect(esquive.start).toBeLessThan(frappe.activeAt)
    expect(impactTick(worlds)).toBeNull()
    const clip = 'frappe.couperet.1'
    const atCut = timeOf(animate(pin(w, mem, esquive.start)), clip)
    expect(atCut).toBeLessThan(0.567)
    // Fondu de la recette d'interruption : 0, 1/2, 1 ; le geste coupé reste figé où l'Esquive l'a pris.
    expect([0, 1, 2].map((k) => weightOf(animate(pin(w, mem, esquive.start + k)), 'esquive'))).toEqual([
      0, 0.5, 1,
    ])
    for (let t = frappe.start; t <= frappe.activeAt + 2; t++) {
      const f = animate(pin(w, mem, t))
      if (weightOf(f, clip) > 0) expect(timeOf(f, clip)).toBeLessThanOrEqual(atCut)
    }
  })
  it('une Sentence est calée sur sa durée : la mort tombe au repère d’impact', () => {
    let w = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, facing: 0, state: 'abattu' }], {
      families: FAMILIES,
    })
    const mem = new AnimMemory()
    mem.observe(w)
    w = step(w, cmd({ sentence: true, aim: { x: 1.2, z: 0 } }))
    mem.observe(w)
    while (w.player.action?.kind !== 'sentence' && w.tick < 30) {
      w = step(w, cmd({ aim: { x: 1.2, z: 0 } }))
      mem.observe(w)
    }
    const a = w.player.action
    expect(a?.kind).toBe('sentence')
    if (!a) return
    const f = animate(pin(w, mem, a.end))
    expect(layer(f.layers, 'sentence.tranchant.petite')?.time).toBeCloseTo(1.633, 6)
  })
})
