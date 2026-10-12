// Types publics de la simulation. Voir .mercy/plan.md, « Interfaces figées » et « Révision après gel ».
// Tout est en lecture seule : step() ne modifie jamais le monde qu'on lui passe.

export type EntityId = number
export type Tick = number
export type Vec2 = { readonly x: number; readonly z: number }
export type Variant = 'A' | 'B'
export type WeaponId = 'couperet' | 'masse'
export type DamageType = 'tranchant' | 'contondant'
export type FamilyKind = 'souriant' | 'recousu' | 'porteur' | 'confesseur' | 'chirurgien' | 'membre'
export type Size = 'small' | 'large'
export type RngState = readonly [number, number, number, number]

export type CreatureState =
  | { readonly kind: 'rituel' }
  | { readonly kind: 'hostile'; readonly alertedAt: Tick }
  | {
      readonly kind: 'abattu'
      readonly since: Tick
      readonly riseAt: Tick | null // null : ne se relève jamais seul (Membre errant)
      readonly cryAt: Tick | null // null : ne crie pas (Membre errant)
      readonly claimedBy: EntityId | 'player' | null // réservé par une Sentence ou une opération
    }
  | { readonly kind: 'absorbe'; readonly into: EntityId; readonly cryAt: Tick | null }
  | { readonly kind: 'mort'; readonly at: Tick }

export type LimbState = 'ok' | 'severed' | 'broken'
export interface LimbDef {
  readonly id: string
  readonly hp: number
}
export interface Limb {
  readonly id: string
  readonly hp: number
  readonly hpMax: number
  readonly state: LimbState
}

export type ActionKind = 'attaque' | 'canalisation' | 'autre'
export type ActionPhase = 'telegraphe' | 'active' | 'recuperation' | 'canalisation'

export interface ActionDef {
  readonly kind: ActionKind
  readonly telegraphTicks: number // attaque : ticks avant le tick actif
  readonly recoverTicks: number
  readonly channelTicks?: number // canalisation : durée totale, résolue au dernier tick
  readonly limb?: string // membre qui porte l'attaque (§8.4)
  readonly reach: number // m, lisible par les bots
  readonly arcDeg?: number
}

export interface Action {
  readonly name: string
  readonly kind: ActionKind
  readonly start: Tick
  readonly activeAt: Tick // attaque : tick d'impact ; canalisation : tick de résolution
  readonly end: Tick
  readonly target: EntityId | Vec2 | null
  readonly limb: string | null
}

export interface SpawnRecord {
  readonly pos: Vec2
  readonly facing: number
  readonly state: 'rituel' | 'hostile' | 'abattu' | 'mort'
  readonly cicatrices: 0 | 1 | 2 | 3
  readonly group: number | null
  readonly ritualPhase: number
}

export interface Creature {
  readonly id: EntityId
  readonly family: FamilyKind
  readonly size: Size
  readonly pos: Vec2
  readonly facing: number // radians, 0 = +x, sens trigonométrique vers +z
  readonly chair: number
  readonly chairMax: number
  readonly cicatrices: 0 | 1 | 2 | 3
  readonly resistant: boolean
  readonly state: CreatureState
  readonly unionOf: EntityId | null // L5 : le tout dont cette créature est une partie
  readonly limbs: readonly Limb[]
  readonly action: Action | null
  readonly stunnedUntil: Tick // vacillement : aucune décision ni action avant ce tick
  readonly spawn: SpawnRecord | null // null : créée en combat, retirée par L6
  readonly group: number | null // groupe de Rituel (phase partagée pour le rendu)
  readonly ritualPhase: number // [0, 1)
  readonly familyData: Readonly<Record<string, number>>
}

export type PlayerActionKind = 'frappe' | 'esquive' | 'sentence' | 'balayage' | 'charge'
export interface PlayerAction {
  readonly kind: PlayerActionKind
  readonly start: Tick
  readonly end: Tick
  readonly comboStep?: 0 | 1 | 2
  readonly target?: EntityId
  readonly dir?: Vec2
  readonly perfectDone?: boolean
  readonly charged?: readonly EntityId[] // Charge : créatures déjà touchées
  readonly impact?: {
    readonly debout: readonly EntityId[]
    readonly abattusOrd: readonly EntityId[]
    readonly abattusRes: readonly EntityId[]
    readonly mortsDansZone: number
  }
}

export type BufferedCommand = 'dodge' | 'sentence' | 'balayage' | 'charge'

export interface Player {
  readonly pos: Vec2
  readonly facing: number
  readonly vie: number
  readonly ferveur: number
  readonly lastFerveurGain: Tick
  readonly weapon: WeaponId
  readonly comboStep: 0 | 1 | 2
  readonly dodgeCharges: number
  readonly dodgeRechargeAt: Tick | null
  readonly invulnerableUntil: Tick
  readonly action: PlayerAction | null
  readonly buffer: { readonly cmd: BufferedCommand; readonly until: Tick; readonly aim: Vec2 } | null
  readonly deaths: number
  readonly spawnPos: Vec2
}

export interface PlayerCommands {
  readonly move: Vec2 // direction, norme 0 ou 1
  readonly aim: Vec2 // point visé au sol
  readonly strike: boolean // maintenu
  readonly dodge: boolean // front montant
  readonly sentence: boolean // front montant
  readonly rite: 'balayage' | 'charge' | null // front montant
  readonly swapWeapon: boolean // front montant
}

export type Area =
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number }
  | {
      readonly kind: 'cone'
      readonly origin: Vec2
      readonly facing: number
      readonly reach: number
      readonly arcDeg: number
    }

export type Effect =
  | {
      readonly kind: 'damage'
      readonly area: Area
      readonly amount: number
      readonly source: 'creature' | 'burst'
      readonly abatSmall: boolean // éclatement : abat toute petite créature ordinaire
      readonly staggerLarge: number // ticks de vacillement des grandes créatures et Résistants
      readonly hitsCreatures: boolean
      readonly knockback?: number // projette le joueur touché, en m, à l'opposé du centre de la zone
    }
  | { readonly kind: 'raise'; readonly ids: readonly EntityId[] }
  | { readonly kind: 'absorb'; readonly id: EntityId }
  | { readonly kind: 'expelAll'; readonly cause: 'dos' | 'contact' | 'delai' }
  | { readonly kind: 'assemble'; readonly ids: readonly EntityId[] }
  | { readonly kind: 'repair'; readonly id: EntityId }
  | {
      readonly kind: 'alert'
      readonly center: Vec2
      readonly radius: number
      readonly cause: 'burst' | 'bark'
    }
  | { readonly kind: 'selfAbattu' }
  | { readonly kind: 'setData'; readonly key: string; readonly value: number }
  | { readonly kind: 'dashSelf'; readonly to: Vec2 } // ruée : la créature se déplace d'un coup

export type Intent =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'moveTo'
      readonly target: Vec2
      readonly speedFactor?: number
      readonly keepFacing?: number
    }
  | { readonly kind: 'act'; readonly action: string; readonly target?: EntityId | Vec2 }

export interface FamilyModule {
  readonly kind: FamilyKind
  readonly size: Size
  readonly isSupport: boolean
  readonly base: { readonly chair: number; readonly speed: number; readonly limbs: readonly LimbDef[] }
  readonly actions: Readonly<Record<string, ActionDef>>
  // Pour une créature Hostile, libre (pas d'action en cours, pas vacillante). Aussi appelé pour une créature
  // Abattue si canActWhileDown est vrai (Confesseur qui prie à terre).
  decide(world: World, self: Creature): Intent
  // Au tick actif d'une attaque, ou au dernier tick d'une canalisation.
  resolve(world: World, self: Creature, action: Action): readonly Effect[]
  readonly canActWhileDown?: boolean
  // Appelé à chaque tick pour une créature non morte et non absorbée (compteurs, stades). Jamais de mort.
  tick?(world: World, self: Creature): readonly Effect[]
  // Hook appelé quand le joueur touche la créature : le Porteur éclate si le coup vient de dos.
  onPlayerHit?(world: World, self: Creature, from: Vec2): readonly Effect[]
}

export type FamilyRegistry = Readonly<Partial<Record<FamilyKind, FamilyModule>>>

export interface SpawnDef {
  readonly family: FamilyKind
  readonly pos: Vec2
  readonly facing?: number
  readonly state?: 'rituel' | 'hostile' | 'abattu' | 'mort' // abattu et mort : scènes test seulement (D12)
  readonly cicatrices?: 0 | 1 | 2 | 3
  readonly group?: number
}

export interface WaveDef {
  readonly id: string
  readonly test: boolean
  readonly playerStart: Vec2
  readonly spawns: readonly SpawnDef[]
  readonly jitter: { readonly posM: number; readonly ritualPhase: boolean }
}

export interface WaveRuntime {
  readonly id: string
  readonly test: boolean
  readonly endedAt: Tick | null // premier tick où toutes les créatures sont mortes
}

export interface World {
  readonly tick: Tick
  readonly seed: number
  readonly rng: RngState
  readonly variant: Variant
  readonly player: Player
  readonly creatures: readonly Creature[] // triées par id croissant
  readonly nextId: EntityId
  readonly events: readonly SimEvent[] // évènements produits par le dernier step
  readonly wave: WaveRuntime
  readonly families: FamilyRegistry
}

export type SimEvent =
  | {
      readonly type: 'hit'
      readonly tick: Tick
      readonly target: EntityId | 'player'
      readonly amount: number
      readonly damageType: DamageType | 'creature' | 'burst'
      readonly by: EntityId | 'player'
    }
  | { readonly type: 'fell'; readonly tick: Tick; readonly id: EntityId }
  | { readonly type: 'cry-start'; readonly tick: Tick; readonly id: EntityId }
  | {
      readonly type: 'cry-stop'
      readonly tick: Tick
      readonly id: EntityId
      readonly cause: 'death' | 'rise' | 'reset'
    }
  | { readonly type: 'rise-telegraph'; readonly tick: Tick; readonly id: EntityId }
  | {
      readonly type: 'rise'
      readonly tick: Tick
      readonly id: EntityId
      readonly cicatrices: number
      readonly cause: 'delai' | 'priere' | 'chirurgien'
    }
  | {
      readonly type: 'death'
      readonly tick: Tick
      readonly id: EntityId
      readonly by: 'achevement' | 'sentence' | 'union' | 'variant-b'
    }
  | { readonly type: 'clang'; readonly tick: Tick; readonly id: EntityId }
  | {
      readonly type: 'alert'
      readonly tick: Tick
      readonly id: EntityId
      readonly cause: 'damage' | 'proximity' | 'cry' | 'burst' | 'bark'
    }
  | { readonly type: 'sentence-start'; readonly tick: Tick; readonly target: EntityId }
  | { readonly type: 'sentence-none'; readonly tick: Tick }
  | {
      readonly type: 'action-start' | 'action-hit' | 'action-end'
      readonly tick: Tick
      readonly id: EntityId
      readonly action: string
    }
  | {
      readonly type: 'action-interrupted'
      readonly tick: Tick
      readonly id: EntityId
      readonly action: string
      readonly by: 'player' | 'burst' | 'creature'
    }
  | {
      readonly type: 'sever' | 'break'
      readonly tick: Tick
      readonly owner: EntityId
      readonly limb: string
      readonly member?: EntityId
    }
  | {
      readonly type: 'reattach'
      readonly tick: Tick
      readonly owner: EntityId
      readonly limb: string
      readonly member: EntityId | null
      readonly by: 'contact' | EntityId
    }
  | {
      readonly type: 'absorb' | 'expel' | 'prayer-complete'
      readonly tick: Tick
      readonly id: EntityId
      readonly others: readonly EntityId[]
    }
  | {
      readonly type: 'assemble'
      readonly tick: Tick
      readonly id: EntityId
      readonly others: readonly EntityId[]
      readonly created: EntityId
    }
  | {
      readonly type: 'burst'
      readonly tick: Tick
      readonly id: EntityId
      readonly others: readonly EntityId[]
      readonly cause: 'dos' | 'contact' | 'delai'
      readonly stage: number
    }
  | {
      readonly type: 'player-impact'
      readonly tick: Tick
      readonly source: 'frappe' | 'balayage' | 'charge'
      readonly comboStep?: 0 | 1 | 2
      readonly debout: readonly EntityId[]
      readonly abattusOrd: readonly EntityId[]
      readonly abattusRes: readonly EntityId[]
      readonly mortsDansZone: number
    }
  | { readonly type: 'player-rite'; readonly tick: Tick; readonly rite: 'balayage' | 'charge' }
  | { readonly type: 'player-dodge' | 'player-perfect-dodge' | 'player-death' | 'reset'; readonly tick: Tick }
  | { readonly type: 'weapon-swap'; readonly tick: Tick; readonly weapon: WeaponId }
  | {
      readonly type: 'heal'
      readonly tick: Tick
      readonly amount: number
      readonly source: 'sentence' | 'reset'
    }
  | { readonly type: 'ferveur'; readonly tick: Tick; readonly delta: number; readonly source: string }
  | { readonly type: 'wave-end'; readonly tick: Tick }

// Évènement d'un type donné, y compris quand une variante regroupe plusieurs types (`'sever' | 'break'`).
export type EventOf<T extends SimEvent['type']> = SimEvent extends infer E
  ? E extends { readonly type: infer U }
    ? T extends U
      ? E & { readonly type: T }
      : never
    : never
  : never
