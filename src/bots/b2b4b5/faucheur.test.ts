// B4 §6 : une situation construite par règle du pseudo-code (R0 à R9), commande attendue. Plus les deux
// interdits de lecture (Chair, riseAt avant le télégraphe) et le passage par le banc.
import { describe, expect, it } from 'vitest'
import {
  type Action,
  CHANNEL_ACTIONS,
  FAMILIES,
  type PlayerAction,
  type PlayerCommands,
  PORTEUR_STAGE_KEY,
  type SpawnDef,
  TUNING,
  type Vec2,
  type World,
} from '../../sim/index'
import { creature, scene, withCreature, withPlayer } from '../../sim/testing'
import { DEFAULT_SPEC, playRun } from '../harness'
import { decideFaucheur, ecart, faucheur, faucheurRule } from './faucheur'

const v = (x: number, z: number): Vec2 => ({ x, z })
const S = (family: SpawnDef['family'], x: number, z: number, patch: Partial<SpawnDef> = {}): SpawnDef => ({
  family,
  pos: v(x, z),
  ...patch,
})
const hostile = (x: number, z: number, family: SpawnDef['family'] = 'souriant'): SpawnDef =>
  S(family, x, z, { state: 'hostile' })
const abattu = (x: number, z: number, cicatrices: 0 | 3 = 0): SpawnDef =>
  S('souriant', x, z, { state: 'abattu', cicatrices })
const rituel = (x: number, z: number): SpawnDef => S('souriant', x, z, { state: 'rituel' })
const mort = (x: number, z: number): SpawnDef => S('souriant', x, z, { state: 'mort' })

// Joueur en (0, 0), face à +x, Couperet, 100 de Vie, Ferveur 0, deux charges d'Esquive, tick 0.
const W = (spawns: readonly SpawnDef[]): World => scene(spawns, { families: FAMILIES })
const decide = (w: World, arme: 'couperet' | 'masse' = 'couperet'): PlayerCommands => decideFaucheur(arme, w)
const rule = (w: World, arme: 'couperet' | 'masse' = 'couperet'): string => faucheurRule(arme, w)

const BASE = (w: World): PlayerCommands => ({
  move: v(0, 0),
  aim: v(w.player.pos.x + Math.cos(w.player.facing), w.player.pos.z + Math.sin(w.player.facing)),
  strike: false,
  dodge: false,
  sentence: false,
  rite: null,
  swapWeapon: false,
})

const attaque = (name: string, activeAt: number): Action => ({
  name,
  kind: 'attaque',
  start: 0,
  activeAt,
  end: activeAt + 30,
  target: null,
  limb: null,
})
const priere: Action = {
  name: 'priere',
  kind: 'canalisation',
  start: 0,
  activeAt: 150,
  end: 150,
  target: null,
  limb: null,
}
const playerAction = (kind: PlayerAction['kind']): PlayerAction => ({ kind, start: 0, end: 30 })
const close = (a: Vec2, b: Vec2): void => {
  expect(a.x).toBeCloseTo(b.x, 9)
  expect(a.z).toBeCloseTo(b.z, 9)
}

describe('notations', () => {
  it('écart(a, b) = |a − b| ramené dans [0, π]', () => {
    expect(ecart(0, Math.PI / 3)).toBeCloseTo(Math.PI / 3)
    expect(ecart(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2)
    expect(ecart(0, 2 * Math.PI)).toBeCloseTo(0)
    expect(ecart(-Math.PI / 2, Math.PI / 2)).toBeCloseTo(Math.PI)
  })
})

describe('R0 arme', () => {
  it('demande la Masse tant qu’aucune créature hostile n’est à 15 m ou moins', () => {
    const libre = W([hostile(15.5, 0), rituel(3, 0)])
    expect(decide(libre, 'masse').swapWeapon).toBe(true)
    expect(decide(W([hostile(14.9, 0)]), 'masse').swapWeapon).toBe(false)
    expect(decide(withPlayer(libre, { weapon: 'masse' }), 'masse').swapWeapon).toBe(false)
    expect(decide(libre, 'couperet').swapWeapon).toBe(false)
  })
  it('swapWeapon accompagne la règle retenue, quelle qu’elle soit (ici R1)', () => {
    const w = withPlayer(W([]), { action: playerAction('esquive') })
    expect(rule(w, 'masse')).toBe('R1')
    expect(decide(w, 'masse')).toEqual({ ...BASE(w), swapWeapon: true })
  })
})

describe('R1 action en cours', () => {
  it.each(['esquive', 'sentence', 'balayage', 'charge'] as const)('%s → BASE', (kind) => {
    const w = withPlayer(W([hostile(1, 0), abattu(0, 1)]), {
      action: playerAction(kind),
      facing: Math.PI / 2,
    })
    expect(rule(w)).toBe('R1')
    expect(decide(w)).toEqual(BASE(w))
    close(decide(w).aim, v(0, 1)) // P + (cos f, sin f)
  })
  it('une Frappe en cours ne bloque pas : la règle suivante s’applique', () => {
    const w = withPlayer(W([hostile(1, 0)]), { action: playerAction('frappe') })
    expect(rule(w)).toBe('R7')
    expect(decide(w).strike).toBe(true)
  })
})

describe('R2 soin', () => {
  const w0 = W([abattu(2.4, 0), abattu(0, 2), hostile(1, -1)])
  it('Vie ≤ 45 et un Abattu ordinaire libre à 2,5 m : Sentence sur le plus proche', () => {
    const w = withPlayer(w0, { vie: 45 })
    expect(rule(w)).toBe('R2')
    expect(decide(w)).toEqual({ ...BASE(w), aim: v(0, 2), sentence: true })
  })
  it('Vie 46 : pas de soin', () => {
    expect(rule(withPlayer(w0, { vie: 46 }))).not.toBe('R2')
  })
  it('un corps réservé ou trop loin ne compte pas', () => {
    let w = withPlayer(W([abattu(2.6, 0), abattu(0, 2)]), { vie: 10 })
    const c2 = creature(w, 2)
    if (c2.state.kind !== 'abattu') throw new Error('fixture')
    w = withCreature(w, 2, { state: { ...c2.state, claimedBy: 'player' } })
    expect(rule(w)).not.toBe('R2')
  })
  it('l’égalité de distance va au plus petit id', () => {
    const w = withPlayer(W([abattu(0, 2), abattu(2, 0)]), { vie: 40 })
    expect(decide(w).aim).toEqual(v(0, 2))
  })
})

describe('R3 esquive', () => {
  const menace = (w: World, id: number, name: string, activeAt = 10): World =>
    withCreature(w, id, { action: attaque(name, activeAt) })
  it('une grande menace (Marteau de Recousu au télégraphe, à portée + 0,5 m) : roulade à l’opposé', () => {
    const w = menace(W([hostile(2.9, 0, 'recousu')]), 1, 'marteau')
    expect(rule(w)).toBe('R3')
    const out = decide(w)
    expect(out.dodge).toBe(true)
    close(out.move, v(-1, 0))
    close(out.aim, v(-1, 0))
    expect(out.strike || out.sentence || out.rite !== null).toBe(false)
  })
  it('hors de portée + 0,5 m, ou hors du télégraphe, ce n’est pas une menace', () => {
    expect(rule(menace(W([hostile(3.1, 0, 'recousu')]), 1, 'marteau'))).not.toBe('R3')
    expect(rule(menace(W([hostile(2.9, 0, 'recousu')]), 1, 'marteau', 0))).not.toBe('R3') // tick actif
    expect(rule(menace(W([hostile(2.9, 0, 'recousu')]), 1, 'marteau', -5))).not.toBe('R3') // récupération
  })
  it('une petite menace seule ne fait pas rouler ; deux, oui ; une seule à Vie ≤ 30, oui', () => {
    const une = menace(W([hostile(2, 0)]), 1, 'morsure')
    expect(rule(une)).not.toBe('R3')
    expect(rule(withPlayer(une, { vie: 30 }))).toBe('R3')
    expect(rule(withPlayer(une, { vie: 31 }))).not.toBe('R3')
    const deux = menace(menace(W([hostile(1, 0), hostile(0, 1)]), 1, 'morsure'), 2, 'morsure')
    expect(rule(deux)).toBe('R3')
    const s = Math.SQRT1_2
    close(decide(deux).move, v(-s, -s)) // unit(P − barycentre), barycentre (0,5 ; 0,5)
  })
  it('un Porteur hostile au stade 3 à 6 m ou moins fait rouler, même sans attaque', () => {
    const at = (d: number, stade: number) =>
      withCreature(W([hostile(0, d, 'porteur')]), 1, { familyData: { [PORTEUR_STAGE_KEY]: stade } })
    expect(rule(at(5.9, 3))).toBe('R3')
    close(decide(at(5.9, 3)).move, v(0, -1))
    expect(rule(at(6.1, 3))).not.toBe('R3')
    expect(rule(at(5.9, 2))).not.toBe('R3')
  })
  it('sans charge d’Esquive, pas de roulade', () => {
    const w = withPlayer(menace(W([hostile(2.9, 0, 'recousu')]), 1, 'marteau'), { dodgeCharges: 0 })
    expect(rule(w)).not.toBe('R3')
  })
  it('barycentre sur le joueur : unit retombe sur (cos(f + π/2), sin(f + π/2))', () => {
    const w = menace(menace(W([hostile(1, 0), hostile(-1, 0)]), 1, 'morsure'), 2, 'morsure')
    close(decide(w).move, v(0, 1))
    close(decide(withPlayer(w, { facing: Math.PI / 2 })).move, v(-1, 0))
  })
})

describe('R4 Résistant à terre', () => {
  it('Sentence sur le Résistant libre le plus proche à 2,5 m ou moins', () => {
    const w = W([abattu(2.4, 0, 3), abattu(0, 2.45, 3), hostile(1, -1)])
    expect(rule(w)).toBe('R4')
    expect(decide(w)).toEqual({ ...BASE(w), aim: v(2.4, 0), sentence: true })
  })
  it('à 2,6 m, non', () => {
    expect(rule(W([abattu(2.6, 0, 3)]))).not.toBe('R4')
  })
  it('R2 passe avant : à Vie ≤ 45, l’ordinaire est sentencié d’abord', () => {
    const w = withPlayer(W([abattu(1, 0, 3), abattu(0, 2)]), { vie: 40 })
    expect(rule(w)).toBe('R2')
    expect(decide(w).aim).toEqual(v(0, 2))
  })
})

describe('R5 canalisation', () => {
  const pretre = (x: number, z: number, state: 'hostile' | 'abattu' = 'hostile'): World =>
    withCreature(W([S('confesseur', x, z, { state })]), 1, { action: priere })
  it('à portée de l’arme : frappe le canalisateur', () => {
    const w = pretre(2.1, 0)
    expect(rule(w)).toBe('R5')
    expect(decide(w)).toEqual({ ...BASE(w), aim: v(2.1, 0), strike: true })
  })
  it('portée de l’arme de la politique : 2,3 m frappe à la Masse (2,4 m), pas au Couperet (2,2 m)', () => {
    const w = withPlayer(pretre(2.3, 0), { weapon: 'masse' })
    expect(decide(w, 'masse').strike).toBe(true)
    expect(decide(withPlayer(pretre(2.3, 0), {}), 'couperet').strike).toBe(false)
  })
  it('un Confesseur qui prie à terre compte aussi', () => {
    expect(rule(pretre(2, 0, 'abattu'))).toBe('R5')
  })
  it('de 3 à 7 m avec 35 de Ferveur : Charge vers lui', () => {
    const w = withPlayer(pretre(0, 5), { ferveur: 35 })
    expect(decide(w)).toEqual({ ...BASE(w), aim: v(0, 5), rite: 'charge' })
    expect(decide(withPlayer(pretre(0, 3), { ferveur: 35 })).rite).toBe('charge')
    expect(decide(withPlayer(pretre(0, 7), { ferveur: 35 })).rite).toBe('charge')
  })
  it('sinon, marche vers lui et frappe seulement si un Hostile ou un Abattu ordinaire est dans l’arc', () => {
    for (const w of [
      withPlayer(pretre(0, 5), { ferveur: 34 }),
      withPlayer(pretre(0, 2.9), { ferveur: 35 }),
      withPlayer(pretre(0, 7.1), { ferveur: 35 }),
    ]) {
      const out = decide(w)
      expect(rule(w)).toBe('R5')
      expect(out.rite).toBeNull()
      expect(out.strike).toBe(false)
      close(out.move, v(0, 1))
      expect(out.aim).toEqual(creature(w, 1).pos)
    }
    const avecCorps = withCreature(W([S('confesseur', 0, 5, { state: 'hostile' }), abattu(0.5, 1.5)]), 1, {
      action: priere,
    })
    expect(decide(avecCorps).strike).toBe(true)
    const horsArc = withCreature(W([S('confesseur', 0, 5, { state: 'hostile' }), abattu(1.5, -0.5)]), 1, {
      action: priere,
    })
    expect(decide(horsArc).strike).toBe(false)
  })
})

describe('R6 Balayage', () => {
  const w4 = W([hostile(3.9, 0), hostile(0, 3.9), abattu(-3, 0), hostile(0, -3), abattu(0, 3, 3)])
  it('25 de Ferveur et 4 Hostiles ou Abattus ordinaires à 4 m : Balayage', () => {
    const w = withPlayer(w4, { ferveur: 25 })
    expect(rule(w)).toBe('R6')
    expect(decide(w)).toEqual({ ...BASE(w), rite: 'balayage' })
  })
  it('24 de Ferveur, ou 3 cibles seulement (un Résistant ne compte pas) : non', () => {
    expect(rule(withPlayer(w4, { ferveur: 24 }))).not.toBe('R6')
    const trois = W([hostile(3.9, 0), hostile(0, 3.9), abattu(-3, 0), abattu(0, -3, 3)])
    expect(rule(withPlayer(trois, { ferveur: 100 }))).not.toBe('R6')
  })
})

describe('R7 frappe', () => {
  // Hostiles à 2 m du joueur, à l’angle donné en degrés.
  const at = (deg: number, d = 2): SpawnDef =>
    hostile(d * Math.cos((deg * Math.PI) / 180), d * Math.sin((deg * Math.PI) / 180))
  it('vise le candidat dont l’arc prend le plus de cibles', () => {
    // Arc de 120° : 50° voit 0° et 100° (total 3) ; 0° et 100° ne se voient pas (total 2).
    const w = W([at(0), at(100), at(50)])
    expect(rule(w)).toBe('R7')
    expect(decide(w)).toEqual({ ...BASE(w), aim: creature(w, 3).pos, strike: true })
  })
  it('à total égal, le plus de corps ; puis la plus courte distance ; puis le plus petit id', () => {
    // 120° (id 1, à 1 m) et 160° (id 2, à 1,5 m) : total 2, corps 0. 0° (id 3, à 2 m) et un corps à 40°
    // (id 4, à 2,1 m) : total 2, corps 1. Le corps l’emporte sur la distance, puis la distance départage 3 et 4.
    const corps = W([
      at(120, 1),
      at(160, 1.5),
      at(0, 2),
      abattu(2.1 * Math.cos((40 * Math.PI) / 180), 2.1 * Math.sin((40 * Math.PI) / 180)),
    ])
    expect(decide(corps).aim).toEqual(creature(corps, 3).pos)
    const dist = W([hostile(2, 0), hostile(-1.5, 0)])
    expect(decide(dist).aim).toEqual(v(-1.5, 0))
    const id = W([hostile(0, 2), hostile(0, -2)])
    expect(decide(id).aim).toEqual(v(0, 2))
  })
  it('sans Hostile ni Abattu ordinaire à 9 m, les cibles sont les créatures en Rituel', () => {
    const w = W([rituel(2, 0)])
    expect(decide(w)).toEqual({ ...BASE(w), aim: v(2, 0), strike: true })
    // Un Hostile à 8 m : le Rituel à portée n’est plus une cible, le faucheur va vers l’Hostile (R8 c).
    const w2 = W([rituel(2, 0), hostile(0, 8)])
    expect(rule(w2)).toBe('R8')
    expect(decide(w2).aim).toEqual(v(0, 8))
    // Un Hostile à 9,5 m ne compte pas dans E.
    expect(rule(W([rituel(2, 0), hostile(0, 9.5)]))).toBe('R7')
  })
  it('un Résistant à terre n’est jamais une cible de frappe ; un mort non plus', () => {
    expect(rule(W([abattu(2.6, 0, 3), mort(1, 0)]))).toBe('R8')
  })
})

describe('R8 déplacement', () => {
  const riseAt = (w: World, id: number, r: number): World => {
    const c = creature(w, id)
    if (c.state.kind !== 'abattu') throw new Error('fixture')
    return withCreature(w, id, { state: { ...c.state, riseAt: r } })
  }
  it('a. un corps dont le télégraphe de Relèvement est visible, à 8 m : riseAt minimal, puis id', () => {
    let w = W([abattu(3, 0), abattu(0, 7.9), abattu(0, -7.5), hostile(5, 0)])
    w = riseAt(riseAt(riseAt(w, 1, 1000), 2, TUNING.relevementTelegraph), 3, TUNING.relevementTelegraph)
    expect(rule(w)).toBe('R8')
    const out = decide(w)
    expect(out.aim).toEqual(v(0, 7.9)) // riseAt égal pour 2 et 3 : id 2
    close(out.move, v(0, 1))
    expect(out.strike || out.sentence || out.dodge || out.rite !== null).toBe(false)
  })
  it('a. riseAt − t > T_TEL (télégraphe pas encore visible) ou au-delà de 8 m : pas dans la liste a', () => {
    let w = W([abattu(3, 0), abattu(0, 7.9), abattu(0, 8.1)])
    w = riseAt(riseAt(w, 2, TUNING.relevementTelegraph + 1), 3, 10)
    expect(decide(w).aim).toEqual(v(3, 0)) // liste b
  })
  it('b. un Abattu ordinaire à 4 m passe avant les Hostiles', () => {
    expect(decide(W([hostile(3, 0), abattu(0, 3.9)])).aim).toEqual(v(0, 3.9))
  })
  it('c. sinon l’Hostile le plus proche', () => {
    expect(decide(W([abattu(0, 4.1), hostile(6, 0), hostile(0, -5)])).aim).toEqual(v(0, -5))
  })
  it('d. sinon l’Abattu ordinaire le plus proche', () => {
    expect(decide(W([abattu(0, 9), abattu(6, 0), abattu(3, 0, 3), rituel(0, -3)])).aim).toEqual(v(6, 0))
  })
  it('e. sinon le Résistant à terre le plus proche', () => {
    expect(decide(W([abattu(0, 9, 3), abattu(6, 0, 3), rituel(0, -3)])).aim).toEqual(v(6, 0))
  })
  it('f. sinon la créature en Rituel la plus proche', () => {
    const w = W([rituel(0, 9), rituel(6, 0), mort(3, 0)])
    expect(decide(w)).toEqual({ ...BASE(w), move: v(1, 0), aim: v(6, 0) })
  })
})

describe('R9 rien à faire', () => {
  it('aucune créature, ou seulement des morts : BASE', () => {
    for (const w of [W([]), W([mort(1, 0), mort(5, 5)])]) {
      expect(rule(w)).toBe('R9')
      expect(decide(w)).toEqual(BASE(w))
    }
  })
})

describe('ce que la politique ne lit pas', () => {
  // États rencontrés en jouant V2 (avec Porteur), sans latence : 400 ticks échantillonnés tous les 7 ticks.
  const states = (wave: string, n: number): World[] => {
    const out: World[] = []
    const policy = faucheur('couperet')
    playRun(
      { ...DEFAULT_SPEC, wave, policy: 'faucheur-couperet', seed: 3, timeoutTicks: n },
      {
        policy: {
          ...policy,
          decide: (w) => {
            if (w.tick % 7 === 0) out.push(w)
            return policy.decide(w, null)
          },
        },
      },
    )
    return out
  }
  const ws = states('V2', 400)
  it('la Chair d’une créature (§21) : même décision quelle que soit la Chair', () => {
    expect(ws.length).toBeGreaterThan(50)
    for (const w of ws) {
      const autre: World = { ...w, creatures: w.creatures.map((c) => ({ ...c, chair: (c.id * 7919) % 97 })) }
      expect(decideFaucheur('couperet', autre)).toEqual(decideFaucheur('couperet', w))
    }
  })
  it('riseAt avant que le télégraphe de Relèvement soit visible : même décision', () => {
    let modifies = 0
    for (const w of ws) {
      const autre: World = {
        ...w,
        creatures: w.creatures.map((c) => {
          if (
            c.state.kind !== 'abattu' ||
            c.state.riseAt === null ||
            c.state.riseAt - w.tick <= TUNING.relevementTelegraph
          )
            return c
          modifies++
          return { ...c, state: { ...c.state, riseAt: c.state.riseAt + 1000 } }
        }),
      }
      expect(decideFaucheur('couperet', autre)).toEqual(decideFaucheur('couperet', w))
    }
    expect(modifies).toBeGreaterThan(0)
  })
})

describe('au banc', () => {
  it('faucheur-couperet et faucheur-masse jouent V1 avec la latence de 12 ticks, de façon déterministe', () => {
    for (const [policy, weapon] of [
      ['faucheur-couperet', 'couperet'],
      ['faucheur-masse', 'masse'],
    ] as const) {
      const spec = {
        ...DEFAULT_SPEC,
        wave: 'V1',
        policy,
        weapon,
        seed: 1,
        latency: 12,
        timeoutTicks: 18_000,
        timeoutFrom: 't0' as const,
      }
      const a = playRun(spec)
      const b = playRun(spec)
      expect(a.result).toEqual(b.result)
      expect(a.trace.events.some((e) => e.type === 'player-impact')).toBe(true)
      expect(a.result.weaponAt).not.toBeNull()
    }
  })
})

describe('canal(c) et CHANNEL_ACTIONS', () => {
  it('canal(c) lit c.action.kind comme le pseudo-code ; les actions de ce genre sont exactement CHANNEL_ACTIONS', () => {
    const names = Object.values(FAMILIES).flatMap((f) =>
      Object.entries(f?.actions ?? {}).flatMap(([name, def]) => (def.kind === 'canalisation' ? [name] : [])),
    )
    expect(new Set(names)).toEqual(new Set(CHANNEL_ACTIONS))
  })
})
