// Scènes de test du laboratoire de rendu (B2 §5 « Scènes », D12) : S1 et ses variantes, S2, une scène de supports
// (Confesseur en prière, Porteur au stade 3), une scène de télégraphes, une galerie et la scène de charge du §24.
// Coordonnées de B2 : (u, v) en mètres, u vers la droite de l'écran, v vers le haut, converties par uvToGround.
import { uvToGround } from '../render/camera'
import {
  createWorld,
  FAMILIES,
  type FamilyKind,
  type FamilyRegistry,
  PORTEUR_STAGE_KEY,
  type SpawnDef,
  type Variant,
  type Vec2,
  type World,
} from '../sim/index'
import { poteau, testWave, withCreature } from '../sim/testing'
import { LAB_FAMILIES, LAB_FAMILIES_QUIET } from './families'
import { b2Script, immobile, negligent, type Policy } from './policies'
import {
  armesPolicy,
  armesWorld,
  bourreauSequencePolicy,
  bourreauSequenceWorld,
  SEQUENCE_FAMILIES,
  sequencePolicy,
  sequenceWorld,
} from './sequences'

export interface LabScene {
  readonly id: string
  readonly title: string
  readonly world: () => World
  readonly policy: () => Policy
  readonly decals?: readonly { readonly pos: Vec2; readonly size: number; readonly born?: number }[] // born : tick (sang frais), sinon ancien
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

// Modèles de la Forge (E2) : chaque famille dans chaque état, toutes inertes (aucune ne bouge ni n'attaque), plus
// les quatre stades du sac du Porteur et un Confesseur en prière, debout et à terre.
const INERT: FamilyRegistry = {
  souriant: { ...poteau, kind: 'souriant' },
  recousu: { ...poteau, kind: 'recousu', size: 'large' },
  porteur: { ...poteau, kind: 'porteur' },
  confesseur: poteau,
  chirurgien: { ...poteau, kind: 'chirurgien' },
}
const modelsWorld = (): World => {
  const fams: FamilyKind[] = ['souriant', 'recousu', 'porteur', 'confesseur', 'chirurgien']
  const cols: { state: State; cic: 0 | 1 | 2 | 3 }[] = [
    { state: 'rituel', cic: 0 },
    { state: 'hostile', cic: 2 },
    { state: 'abattu', cic: 0 },
    { state: 'abattu', cic: 3 },
    { state: 'mort', cic: 3 },
  ]
  const spawns: SpawnDef[] = []
  fams.forEach((family, r) => {
    cols.forEach((col, k) => {
      spawns.push({
        family,
        pos: uvToGround(-6 + k * 3, 5.2 - r * 2.6),
        facing: -Math.PI / 4,
        state: col.state,
        cicatrices: col.cic,
        group: col.state === 'rituel' ? 1 + r : undefined,
      })
    })
  })
  // Stades du sac (0 à 3), Confesseurs en prière (debout, à terre).
  for (let s = 0; s < 4; s++)
    spawns.push({
      family: 'porteur',
      pos: uvToGround(9.5, 5.2 - s * 2.6),
      facing: -Math.PI / 4,
      state: 'hostile',
    })
  spawns.push({ family: 'confesseur', pos: uvToGround(9.5, -5.2), facing: -Math.PI / 4, state: 'hostile' })
  spawns.push({ family: 'confesseur', pos: uvToGround(-9.5, 5.2), facing: -Math.PI / 4, state: 'abattu' })
  let w = build(spawns, { families: { ...INERT, confesseur: LAB_FAMILIES.confesseur } })
  for (let s = 0; s < 4; s++) w = withCreature(w, 26 + s, { familyData: { [PORTEUR_STAGE_KEY]: s } })
  return w
}

// Détails des modèles (E2), au plus près du Bourreau : stades du sac (0 à 3), Confesseur en prière debout et à terre,
// Recousu Résistant debout (marques dorées) au bras droit tranché, et son Membre errant.
const detailsWorld = (): World => {
  const spawns: SpawnDef[] = [0, 1, 2, 3].map(
    (s): SpawnDef => ({
      family: 'porteur',
      pos: uvToGround(-3 + s * 2, 2.2),
      facing: -Math.PI / 4,
      state: 'hostile',
    }),
  )
  spawns.push({ family: 'confesseur', pos: uvToGround(-3, -1.6), facing: -Math.PI / 4, state: 'hostile' })
  spawns.push({ family: 'confesseur', pos: uvToGround(-0.8, -2.2), facing: 0.6, state: 'abattu' })
  spawns.push({
    family: 'recousu',
    pos: uvToGround(2.2, -1.4),
    facing: -Math.PI / 4,
    state: 'hostile',
    cicatrices: 3,
  })
  spawns.push({ family: 'membre', pos: uvToGround(3.6, -2.8), facing: 0.4, state: 'abattu' })
  let w = build(spawns, { families: { ...INERT, confesseur: LAB_FAMILIES.confesseur } })
  for (let s = 0; s < 4; s++) w = withCreature(w, 1 + s, { familyData: { [PORTEUR_STAGE_KEY]: s } })
  const rec = w.creatures.find((c) => c.family === 'recousu')
  if (rec)
    w = withCreature(w, rec.id, {
      limbs: [
        { id: 'brasDroit', hp: 0, hpMax: 40, state: 'severed' },
        { id: 'brasGauche', hp: 40, hpMax: 40, state: 'ok' },
      ],
    })
  const mem = w.creatures.find((c) => c.family === 'membre')
  if (mem && rec) w = withCreature(w, mem.id, { unionOf: rec.id, familyData: { limbIndex: 0 } })
  return w
}

// La Fosse (E1) : tableau proche de la planche key-art-la-fosse, au coin haut de l'arène pour voir les murs, la
// palissade, les torches, l'escalier. Bourreau au centre, Souriants en Rituel, Recousu, Confesseur en prière,
// Porteur au stade 2, morts et Abattus dans la boue, sang ancien. `fosse-combat` : le même tableau, le Bourreau frappe.
const FOSSE_AT = { x: -8.5, z: -10.5 }
const fosseSpawns = (): SpawnDef[] => {
  const at = (dx: number, dz: number) => ({ x: FOSSE_AT.x + dx, z: FOSSE_AT.z + dz })
  const out: SpawnDef[] = []
  const ring = [
    [2.2, -1.0],
    [1.0, 2.6],
    [-2.4, 1.6],
    [3.4, 1.8],
    [-1.2, -2.8],
  ] as const
  for (const [dx, dz] of ring) {
    out.push({ family: 'souriant', pos: at(dx, dz), facing: Math.atan2(-dz, -dx), state: 'rituel', group: 1 })
  }
  out.push({ family: 'recousu', pos: at(-3.6, -2.4), facing: 0.6, state: 'rituel', group: 2 })
  out.push({ family: 'confesseur', pos: at(4.4, -3.2), facing: 2.4, state: 'hostile' })
  out.push({ family: 'porteur', pos: at(-4.2, 3.4), facing: -0.8, state: 'hostile' })
  const dead: [number, number, FamilyKind][] = [
    [1.6, 4.4, 'souriant'],
    [-2.6, 4.8, 'souriant'],
    [5.2, 0.6, 'souriant'],
    [-0.4, -4.6, 'recousu'],
    [3.0, 4.8, 'souriant'],
  ]
  dead.forEach(([dx, dz, family], k) => {
    out.push({ family, pos: at(dx, dz), facing: k * 1.3, state: 'mort', cicatrices: (k % 2) as 0 | 1 })
  })
  out.push({ family: 'souriant', pos: at(-1.5, 3.4), facing: 2.2, state: 'abattu', cicatrices: 1 })
  out.push({ family: 'souriant', pos: at(5.6, -1.6), facing: 0.4, state: 'abattu', cicatrices: 3 })
  return out
}
const fosseWorld = (): World => {
  const w = createWorld({
    seed: 3,
    variant: 'A',
    wave: testWave(fosseSpawns(), FOSSE_AT),
    families: LAB_FAMILIES,
  })
  return withCreature(w, 8, { familyData: { [PORTEUR_STAGE_KEY]: 2 } })
}
const fosseDecals = (): { pos: Vec2; size: number }[] =>
  Array.from({ length: 26 }, (_, i) => ({
    pos: { x: FOSSE_AT.x + (hash01(i, 21) * 2 - 1) * 6, z: FOSSE_AT.z + (hash01(i, 22) * 2 - 1) * 6 },
    size: 0.25 + hash01(i, 23) * 0.45,
  }))

// Audit §30.13 (E1) : télégraphes réels (familles du jeu) sur du sang frais et sur des morts. Recousu A arme une
// Empoignade (cercle de 1,8 m autour de lui), Recousu B un Marteau dont le cône couvre six morts. Impact au tick 60 ;
// rouge brun avant le tick 48, rouge vif ensuite.
const AUDIT_A = uvToGround(0.2, 3.1)
const AUDIT_B = uvToGround(-3.6, -1.2)
const auditWorld = (): World => {
  const toPlayer = (p: Vec2) => Math.atan2(-p.z, -p.x)
  const spawns: SpawnDef[] = [
    { family: 'recousu', pos: AUDIT_A, facing: toPlayer(AUDIT_A), state: 'hostile' },
    { family: 'recousu', pos: AUDIT_B, facing: toPlayer(AUDIT_B), state: 'hostile' },
  ]
  const fB = toPlayer(AUDIT_B)
  for (let k = 0; k < 6; k++) {
    const a = fB + (k - 2.5) * 0.17
    const r = 1.0 + (k % 3) * 0.55
    spawns.push({
      family: 'souriant',
      pos: { x: AUDIT_B.x + Math.cos(a) * r, z: AUDIT_B.z + Math.sin(a) * r },
      facing: k * 1.1,
      state: 'mort',
    })
  }
  let w = createWorld({
    seed: 5,
    variant: 'A',
    wave: testWave(spawns, { x: 0, z: 0 }),
    families: { ...FAMILIES },
  })
  const act = (name: string, limb: string, target: Vec2) => ({
    name,
    kind: 'attaque' as const,
    start: 0,
    activeAt: 60,
    end: 60 + 48,
    target,
    limb,
  })
  w = withCreature(w, 1, { action: act('empoignade', 'brasGauche', { x: 0, z: 0 }) })
  w = withCreature(w, 2, { action: act('marteau', 'brasDroit', { x: 0, z: 0 }) })
  return w
}
const auditDecals = (): { pos: Vec2; size: number; born: number }[] =>
  Array.from({ length: 24 }, (_, i) => ({
    pos: uvToGround((hash01(i, 31) * 2 - 1) * 4, (hash01(i, 32) * 2 - 1) * 4),
    size: 0.35 + hash01(i, 33) * 0.35,
    born: 20,
  }))

// Bord proche de la caméra (§20) : le Bourreau au pied du mur, côté écran bas ; le mur et la palissade entre la
// caméra et lui se découpent.
const bordWorld = (): World =>
  createWorld({
    seed: 4,
    variant: 'A',
    wave: testWave(
      [
        { family: 'souriant', pos: uvToGround(-2, -12), facing: 1, state: 'rituel', group: 1 },
        { family: 'souriant', pos: uvToGround(2.2, -11.5), facing: 2, state: 'mort' },
      ],
      uvToGround(0, -13.2),
    ),
    families: LAB_FAMILIES_QUIET,
  })

export const SCENES: readonly LabScene[] = [
  {
    id: 'bord',
    title: 'Bord de la fosse, côté caméra : découpe du mur (§20)',
    world: bordWorld,
    policy: () => immobile,
  },
  {
    id: 'audit-telegraphes',
    title: 'Audit §30.13 : Empoignade et Marteau réels sur du sang frais et sur des morts',
    world: auditWorld,
    policy: () => immobile,
    decals: auditDecals(),
  },
  {
    id: 'fosse',
    title: 'La Fosse (E1) : tableau de la planche',
    world: fosseWorld,
    policy: () => immobile,
    decals: fosseDecals(),
  },
  {
    id: 'fosse-combat',
    title: 'La Fosse (E1) : le Bourreau frappe ce qui est debout',
    world: fosseWorld,
    policy: () => negligent,
    decals: fosseDecals(),
  },
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
    id: 'modeles',
    title: 'Modèles de la Forge (E2) : familles, états, stades du sac, prière',
    world: modelsWorld,
    policy: () => immobile,
  },
  {
    id: 'details',
    title: 'Détails (E2) : stades du sac, prière, marques, bras tranché et Membre errant',
    world: detailsWorld,
    policy: () => immobile,
  },
  ...SEQUENCE_FAMILIES.map(
    (f): LabScene => ({
      id: `seq-${f}`,
      title: `Séquence (E2) : ${f} frappe, est coupé, est abattu puis achevé`,
      world: () => sequenceWorld(f),
      policy: sequencePolicy,
    }),
  ),
  {
    id: 'seq-bourreau',
    title: 'Séquence (E3) : Frappe du Bourreau, Frappe coupée par une Esquive, Balayage',
    world: bourreauSequenceWorld,
    policy: bourreauSequencePolicy,
  },
  {
    id: 'armes',
    title:
      'Armes en main et orientation (E6) : Couperet, Masse, changements, demi-tour, Sentence, rites, marche',
    world: armesWorld,
    policy: armesPolicy,
  },
  {
    id: 'charge',
    title: '§24 : 40 créatures, 250 morts, 400 décalques',
    world: perfWorld,
    policy: () => negligent,
    decals: perfDecals(),
  },
]

export const sceneById = (id: string): LabScene | undefined => SCENES.find((s) => s.id === id)
