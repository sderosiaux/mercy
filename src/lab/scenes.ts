// Scènes de test du laboratoire de rendu (B2 §5 « Scènes », D12) : S1 et ses variantes, S2, une scène de supports
// (Confesseur en prière, Porteur au stade 3), une scène de télégraphes, une galerie et la scène de charge du §24.
// Coordonnées de B2 : (u, v) en mètres, u vers la droite de l'écran, v vers le haut, converties par uvToGround.
import { uvToGround } from '../render/camera'
import {
  createWorld,
  type FamilyKind,
  type FamilyRegistry,
  PORTEUR_STAGE_KEY,
  type SpawnDef,
  type Variant,
  type Vec2,
  type World,
} from '../sim/index'
import { testWave, withCreature } from '../sim/testing'
import { LAB_FAMILIES, LAB_FAMILIES_QUIET } from './families'
import { b2Script, immobile, negligent, type Policy } from './policies'

export interface LabScene {
  readonly id: string
  readonly title: string
  readonly world: () => World
  readonly policy: () => Policy
  readonly decals?: readonly { readonly pos: Vec2; readonly size: number }[]
  readonly aim?: Vec2 // curseur posé, pour montrer le sceau de Sentence
}

type State = NonNullable<SpawnDef['state']>
type Slot = readonly [number, number, FamilyKind, State, 0 | 1 | 2 | 3]

// B2 §5, table S1 : slots s1 à s15 (ids 1 à 15), orientation du slot k = (k × 0,82) mod 2π.
export const S1_SLOTS: readonly Slot[] = [
  [-6, 4, 'souriant', 'mort', 0],
  [-2, 4, 'confesseur', 'mort', 0],
  [2, 4, 'souriant', 'abattu', 3],
  [6, 4, 'souriant', 'abattu', 3],
  [0, 5, 'souriant', 'abattu', 0],
  [-6, 0, 'souriant', 'abattu', 1],
  [-5.4, 0.4, 'souriant', 'mort', 0],
  [-3, -1.5, 'recousu', 'abattu', 2],
  [5, 0, 'souriant', 'abattu', 2],
  [5.8, 0.6, 'recousu', 'abattu', 3],
  [5.8, -0.6, 'recousu', 'mort', 0],
  [-6, -4, 'souriant', 'abattu', 0],
  [-2, -4, 'porteur', 'mort', 0],
  [2, -4, 'recousu', 'abattu', 0],
  [6, -4, 'souriant', 'mort', 3],
]

const slotSpawns = (slots: readonly Slot[], mirror = false): SpawnDef[] =>
  slots.map(([u, v, family, state, cicatrices], i) => ({
    family,
    pos: uvToGround(mirror ? -u : u, v),
    facing: ((i + 1) * 0.82) % (2 * Math.PI),
    state,
    cicatrices,
  }))

const build = (
  spawns: readonly SpawnDef[],
  opts: { families?: FamilyRegistry; variant?: Variant; seed?: number } = {},
): World =>
  createWorld({
    seed: opts.seed ?? 1,
    variant: opts.variant ?? 'A',
    wave: testWave(spawns, { x: 0, z: 0 }),
    families: opts.families ?? LAB_FAMILIES_QUIET,
  })

const s2Spawns = (): SpawnDef[] => [
  ...slotSpawns(S1_SLOTS),
  ...Array.from({ length: 8 }, (_, k): SpawnDef => {
    const th = (k * Math.PI) / 4
    return { family: 'souriant', pos: uvToGround(7 * Math.cos(th), 7 * Math.sin(th)), state: 'hostile' }
  }),
]

// Générateur déterministe pour les scènes peuplées (aucun tirage du navigateur).
const hash01 = (i: number, k: number): number => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return s - Math.floor(s)
}

const perfWorld = (): World => {
  const kinds: FamilyKind[] = [
    'souriant',
    'souriant',
    'souriant',
    'recousu',
    'porteur',
    'confesseur',
    'chirurgien',
  ]
  const spawns: SpawnDef[] = []
  // 250 morts, partout dans l'arène.
  for (let i = 0; i < 250; i++) {
    spawns.push({
      family: kinds[i % kinds.length] as FamilyKind,
      pos: { x: (hash01(i, 1) * 2 - 1) * 13.5, z: (hash01(i, 2) * 2 - 1) * 13.5 },
      facing: hash01(i, 3) * 6.28,
      state: 'mort',
      cicatrices: (i % 4) as 0 | 1 | 2 | 3,
    })
  }
  // 40 créatures non mortes : 24 debout (Rituel et Hostiles), 16 à terre.
  for (let i = 0; i < 40; i++) {
    const r = 3 + hash01(i, 4) * 9
    const a = hash01(i, 5) * 6.28
    spawns.push({
      family: kinds[i % kinds.length] as FamilyKind,
      pos: { x: Math.cos(a) * r, z: Math.sin(a) * r },
      facing: hash01(i, 6) * 6.28,
      state: i < 12 ? 'rituel' : i < 24 ? 'hostile' : 'abattu',
      cicatrices: i % 7 === 0 ? 3 : 0,
      group: i < 12 ? 1 : undefined,
    })
  }
  return build(spawns, { families: LAB_FAMILIES })
}

const perfDecals = (): { pos: Vec2; size: number }[] =>
  Array.from({ length: 400 }, (_, i) => ({
    pos: { x: (hash01(i, 7) * 2 - 1) * 13, z: (hash01(i, 8) * 2 - 1) * 13 },
    size: 0.3 + hash01(i, 9) * 0.5,
  }))

// Supports (arbitrage B3/B2 de _index.md) : Confesseur en prière et Porteur au stade 3 au milieu des corps de S1.
const supportsWorld = (): World => {
  const spawns: SpawnDef[] = [
    ...slotSpawns(S1_SLOTS),
    { family: 'confesseur', pos: uvToGround(-3.5, 2), facing: 0.5, state: 'hostile' },
    { family: 'porteur', pos: uvToGround(3.2, -1.8), facing: 2.6, state: 'hostile' },
  ]
  let w = build(spawns, { families: LAB_FAMILIES })
  w = withCreature(w, 17, { familyData: { [PORTEUR_STAGE_KEY]: 3 } })
  return w
}

// Télégraphes : Souriants Hostiles autour du joueur, sur des décalques de sang ; un Recousu arme son Marteau.
const telegraphWorld = (): World => {
  const spawns: SpawnDef[] = [
    ...[0, 1, 2, 3, 4].map(
      (k): SpawnDef => ({
        family: 'souriant',
        pos: uvToGround(1.9 * Math.cos(k * 1.256), 1.9 * Math.sin(k * 1.256)),
        state: 'hostile',
      }),
    ),
    { family: 'recousu', pos: uvToGround(0, -3.2), facing: Math.PI / 2, state: 'hostile' },
    { family: 'souriant', pos: uvToGround(-1.3, 1.1), facing: 2, state: 'abattu' },
  ]
  return build(spawns, { families: LAB_FAMILIES })
}
const telegraphDecals = (): { pos: Vec2; size: number }[] =>
  Array.from({ length: 30 }, (_, i) => ({
    pos: uvToGround((hash01(i, 11) * 2 - 1) * 3.5, (hash01(i, 12) * 2 - 1) * 3.5),
    size: 0.4 + hash01(i, 13) * 0.4,
  }))

// Galerie : chaque famille dans chaque état, en colonnes (debout Rituel, Hostile, Abattu, Résistant, mort).
const galleryWorld = (): World => {
  const fams: FamilyKind[] = ['souriant', 'recousu', 'porteur', 'confesseur', 'chirurgien']
  const cols: { state: State; cic: 0 | 1 | 2 | 3 }[] = [
    { state: 'rituel', cic: 0 },
    { state: 'hostile', cic: 1 },
    { state: 'abattu', cic: 0 },
    { state: 'abattu', cic: 3 },
    { state: 'mort', cic: 3 },
  ]
  const spawns: SpawnDef[] = []
  fams.forEach((family, r) => {
    cols.forEach((col, k) => {
      spawns.push({
        family,
        pos: uvToGround(-6 + k * 3, 4.6 - r * 2.3),
        facing: -Math.PI / 4,
        state: col.state,
        cicatrices: col.cic,
        group: col.state === 'rituel' ? 1 : undefined,
      })
    })
  })
  spawns.push({ family: 'membre', pos: uvToGround(-6, -7), facing: 0.3, state: 'abattu' })
  return build(spawns, { families: LAB_FAMILIES_QUIET })
}

export const SCENES: readonly LabScene[] = [
  {
    id: 'S1a',
    title: 'S1a · Fosse figée, joueur immobile',
    world: () => build(slotSpawns(S1_SLOTS)),
    policy: () => immobile,
  },
  {
    id: 'S1b',
    title: 'S1b · Achèvement de s12',
    world: () => build(slotSpawns(S1_SLOTS)),
    policy: () => b2Script(12, 'acheve'),
  },
  {
    id: 'S1c',
    title: 'S1c · Sentence de s14',
    world: () => build(slotSpawns(S1_SLOTS)),
    policy: () => b2Script(14, 'sentence'),
  },
  {
    id: 'S1d',
    title: 'S1d · Coup métallique puis Sentence de s4',
    world: () => build(slotSpawns(S1_SLOTS)),
    policy: () => b2Script(4, 'clang-puis-sentence'),
  },
  {
    id: 'S1e',
    title: 'S1e · Supports à terre',
    world: () =>
      build([
        { family: 'confesseur', pos: uvToGround(-6, 3), facing: 0.82, state: 'abattu' },
        { family: 'porteur', pos: uvToGround(6, 3), facing: 1.64, state: 'abattu' },
        { family: 'chirurgien', pos: uvToGround(0, -4), facing: 2.46, state: 'abattu' },
      ]),
    policy: () => immobile,
  },
  {
    id: 'S1m',
    title: 'S1 en miroir (entraînement du test des 3 s)',
    world: () => build(slotSpawns(S1_SLOTS, true)),
    policy: () => immobile,
  },
  {
    id: 'S2a',
    title: 'S2a · Fosse et 8 Souriants, variante A',
    world: () => build(s2Spawns()),
    policy: () => negligent,
  },
  {
    id: 'S2b',
    title: 'S2b · Fosse et 8 Souriants, variante B',
    world: () => build(s2Spawns(), { variant: 'B' }),
    policy: () => negligent,
  },
  {
    id: 'supports',
    title: 'Confesseur en prière et Porteur au stade 3 parmi les corps',
    world: supportsWorld,
    policy: () => immobile,
  },
  {
    id: 'telegraphes',
    title: 'Télégraphes au sol sur le sang',
    world: telegraphWorld,
    policy: () => immobile,
    decals: telegraphDecals(),
    aim: uvToGround(-1.3, 1.1),
  },
  { id: 'galerie', title: 'Galerie des familles et des états', world: galleryWorld, policy: () => immobile },
  {
    id: 'charge',
    title: '§24 : 40 créatures, 250 morts, 400 décalques',
    world: perfWorld,
    policy: () => negligent,
    decals: perfDecals(),
  },
]

export const sceneById = (id: string): LabScene | undefined => SCENES.find((s) => s.id === id)
