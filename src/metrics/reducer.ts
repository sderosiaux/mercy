// Réducteur pur : (évènements, contexte) => métriques d'une partie. Partagé par le banc de bots et la
// télémétrie humaine (C7). Chaque mesure porte le nom que lui donne son contrat (.mercy/contracts/_frozen/B1 à B5).
// Le contexte apporte ce qu'un évènement ne porte pas : la série par tick (series.ts) et les notes d'état
// (notes.ts). Les définitions recopiées des contrats sont citées à côté de chaque calcul.
import type { SimEvent, WeaponId } from '../sim/index'
import { TUNING } from '../sim/index'
import { type DeathCause, isEngagement, type TickNote } from './notes'
import type { SeriesLine } from './series'
import { ratio } from './stats'

// Paramètres de mesure fixés par les contrats.
export const CONFORT_VIE = 50 // B1 : confort(r) exige vieFin ≥ 50
export const PRAYER_ACTION = 'priere' // B3 I5 : nom de l'action de prière (CHANNEL_ACTIONS)
export const PIC_WINDOW = 21 // B3 PIc : interruption précédée d'une Charge dans [t − 21, t]
export const O3A_WINDOW = 120 // B3 O3a : Charge suivie d'un éclatement de dos dans les 120 ticks
export const HALF_SECOND = 30 // B5 O2 : fell + 30 (le halètement de L2, 0,5 s)
export const VOICE_BUDGET = 24 // B5 O8 : 24 emplacements de voix (§19)
export const CLASS1_MAX_VOICES = 4 // B5 O10 : classe 1 de 1 à 4 voix actives, classe 2 à partir de 5
export const S3_FROM = 600 // B2 S3 : t* cherché dans [600 ; 3600]
export const S3_TO = 3600
export const S3_BODIES = 15 // B2 S3 : au moins 15 corps à 6 m, dont 4 Abattus et 4 morts
export const S3_MIN_EACH = 4

export interface RunContext {
  // Arme en main au tick 0. B4 : la première action reçoit la durée nominale d'un coup de l'arme équipée,
  // celle-ci ou la dernière prise par un `weapon-swap` avant cette action.
  readonly weapon: WeaponId
  readonly series: readonly SeriesLine[] // ligne du monde initial (tick 0), puis une par step
  readonly notes: readonly TickNote[]
}

export type Phase = 'haletement' | 'cri' | 'inspiration' | 'aucune'
type PhaseCounts = Record<Phase, number>

export interface ResistantFall {
  readonly tick: number
  readonly combatIndex: number
  readonly id: number
  readonly clangs: number
  readonly fProche: boolean
  readonly issue: 'releve' | 'mort' | 'reset' | 'fin'
  readonly manquee: boolean
}

export interface RunMetrics {
  readonly fini: boolean // B1 fini(r)
  readonly T: number // B1 T(r) : premier tick où tout est mort, sinon dernier tick joué (CAP)
  readonly T0: number | null // B4 T0
  readonly TS: number | null // B4 T_S
  readonly D: number | null // B4 D = T_S − T0
  readonly b1: {
    readonly morts: number
    readonly degats: number
    readonly soins: number
    readonly perte: number
    readonly vieFin: number
    readonly confort: boolean
    readonly episodes: { readonly acheves: number; readonly recuperes: number; readonly exclus: number }
    readonly O7: { readonly donnees: number; readonly viseesEnCombat: number; readonly part: number | null }
    readonly O8: {
      readonly premierFell: number | null
      readonly premierAchevementVise: number | null
      readonly delai: number | null
    }
  }
  readonly b2: {
    readonly S3: { readonly tStar: number | null }
    readonly O8: {
      readonly tempsCombat: number
      readonly O8a: readonly number[] // indices de temps de combat des F sur un mort
      readonly O8b: readonly number[] // indices de temps de combat des frappes de sondage
      readonly O8c: readonly ResistantFall[] // chutes de Résistant avec au moins un clang
    }
  }
  readonly b3: {
    readonly V: number
    readonly M: number
    readonly PD: number
    readonly PA: number
    readonly PIj: number
    readonly CR: number
    readonly AB: number
    readonly ECd: number
    readonly ECc: number
    readonly ECt: number
    readonly AEP: readonly number[]
    readonly MC: number
    readonly VB: number
    readonly CH: number
    readonly PIc: number
    readonly RP: number
    readonly O3a: { readonly charges: number; readonly suiviesDos: number }
  }
  readonly b4: {
    readonly O1: {
      readonly part: number | null
      readonly ticks: { readonly utile: number; readonly nettoyage: number; readonly sentence: number }
    }
    readonly impacts: { readonly utile: number; readonly nettoyage: number; readonly vide: number }
    readonly mortsDonnees: number
    readonly O2: number | null
    readonly O3: { readonly queues: readonly number[]; readonly rompues: number; readonly ouvertes: number }
    readonly O4: {
      readonly chutesOrd: number
      readonly relevementsDelai: number
      readonly part: number | null
    }
    readonly O6: { readonly variantB: number; readonly part: number | null }
    readonly O7: { readonly pic: number }
    readonly O8: { readonly mortsJoueur: number }
    readonly O9: {
      readonly crisParAchevement: readonly number[]
      readonly achevements: number
      readonly coupentUnCri: number
      readonly partCoupentUnCri: number | null
    }
    readonly O10: { readonly corpsTemps: number }
    readonly balayages: number
    readonly balayagesParMinute: number | null
    readonly delaisAchevement: readonly number[]
  }
  readonly b5: {
    readonly O2: {
      readonly mortsAvant30: number
      readonly mortsAvant30AvecCri: number
      readonly mortsA30: number
      readonly vivantsA30: number
      readonly criA30: number
      readonly ecartsA30: { readonly sentence: number; readonly expulse: number; readonly autre: number }
    }
    readonly D1: Readonly<Record<DeathCause, PhaseCounts>>
    readonly O6: {
      readonly releve: number
      readonly priere: number
      readonly assemblage: number
      readonly absorption: number
    }
    readonly O7: { readonly nMax: number; readonly valeursN: number }
    readonly O8: { readonly vocalisentMax: number; readonly ticksSatures: number }
    readonly O9: { readonly groupes: number }
    readonly O10: { readonly classe1: number; readonly classe2: number }
  }
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
  const l = m.get(k)
  if (l) l.push(v)
  else m.set(k, [v])
}
const addTo = <K>(m: Map<K, Set<number>>, k: K, ids: readonly number[]): void => {
  const s = m.get(k) ?? new Set<number>()
  for (const id of ids) s.add(id)
  m.set(k, s)
}
const count = (events: readonly SimEvent[], pred: (e: SimEvent) => boolean): number =>
  events.reduce((n, e) => n + (pred(e) ? 1 : 0), 0)
const emptyPhases = (): PhaseCounts => ({ haletement: 0, cri: 0, inspiration: 0, aucune: 0 })

export const reduceRun = (events: readonly SimEvent[], ctx: RunContext): RunMetrics => {
  const { series, notes } = ctx
  const lastLine = series[series.length - 1]
  const endTick = lastLine?.tick ?? 0
  const lineAt = (t: number): SeriesLine | undefined =>
    series[t]?.tick === t ? series[t] : series.find((l) => l.tick === t)

  // ---- Bornes de la partie (B1 §5, B4 §5) ----
  const endedAt = events.find((e) => e.type === 'wave-end')?.tick ?? null
  const fini = endedAt !== null
  const T = endedAt ?? endTick
  const T0 = events.find(isEngagement)?.tick ?? null
  const TS = endedAt
  const D = TS !== null && T0 !== null ? TS - T0 : null

  // ---- Index des notes ----
  const chuteNote = new Map<string, Extract<TickNote, { kind: 'chute' }>>()
  const deathNotes: Extract<TickNote, { kind: 'mort' }>[] = []
  const fPresses = new Map<number, number[]>() // id de Résistant → ticks où F a été pressée près de lui
  for (const n of notes) {
    if (n.kind === 'chute') chuteNote.set(`${n.tick}:${n.id}`, n)
    else if (n.kind === 'mort') deathNotes.push(n)
    else if (n.kind === 'f') for (const id of n.resistantsProches) push(fPresses, id, n.tick)
  }

  // Temps de combat (B2.O8) : ticks où la vague contient au moins une créature non morte.
  const combatIndexAt = new Map<number, number>()
  let combat = 0
  for (const l of series) {
    if (l.tick >= 1 && l.nonMorts >= 1) combat++
    combatIndexAt.set(l.tick, combat)
  }
  const combatIndex = (t: number): number => combatIndexAt.get(t) ?? combat

  // ---- Index des évènements par tick (B3 AEP, B3 RP, B5 O2) ----
  const fellAt = new Map<number, Set<number>>()
  const burstHitAt = new Map<number, Set<number>>()
  const expelAt = new Map<number, Set<number>>()
  const riseAt = new Map<string, number>() // `${tick}:${id}` → cicatrices
  for (const e of events) {
    if (e.type === 'fell') addTo(fellAt, e.tick, [e.id])
    else if (e.type === 'hit' && e.damageType === 'burst' && e.target !== 'player')
      addTo(burstHitAt, e.tick, [e.target])
    else if (e.type === 'expel') addTo(expelAt, e.tick, e.others)
    else if (e.type === 'rise') riseAt.set(`${e.tick}:${e.id}`, e.cicatrices)
  }

  // ---- Passe unique sur les évènements ----
  // B1 épisodes de corps.
  const openEpisode = new Set<number>()
  let acheves = 0
  let recuperes = 0
  let exclus = 0
  const closeRecup = (id: number): void => {
    if (openEpisode.delete(id)) recuperes++
  }
  // B4.O4 : la dernière chute de chaque id était-elle celle d'une créature ordinaire (hors Membre errant) ?
  const lastFallOrd = new Map<number, boolean>()
  let chutesOrd = 0
  let relevementsDelai = 0
  // B4.O9 : cris actifs au début du tick (avant le geste du joueur, premier sous-pas).
  const crying = new Set<number>()
  let cryingAtTickStart = new Set<number>()
  let currentTick = -1
  const crisParAchevement: number[] = []
  let coupentUnCri = 0
  // B4 délais fell → death des Achèvements.
  const downSince = new Map<number, number>()
  const delaisAchevement: number[] = []
  // B5 D1 : phase de la voix à la mort.
  const down = new Set<number>()
  const telegraph = new Set<number>()
  const phaseAtDeath = new Map<string, Phase>()
  const cryStoppedByDeath = new Set<string>()
  const D1: Record<DeathCause, PhaseCounts> = {
    achevement: emptyPhases(),
    sentence: emptyPhases(),
    union: emptyPhases(),
    'variant-b': emptyPhases(),
  }
  // B5 O2 : épisodes de halètement.
  interface Breath {
    readonly fell: number
    readonly id: number
    readonly expelled: boolean
    cryStart: number | null
    sentencedAt: number | null
    end: { readonly tick: number; readonly death: boolean } | null
  }
  const breaths: Breath[] = []
  const openBreath = new Map<number, Breath>()
  // B2.O8c : chutes de Résistant.
  interface ResFall {
    readonly tick: number
    readonly id: number
    clangs: number
    issue: ResistantFall['issue'] | null
    closedAt: number
  }
  const resFalls: ResFall[] = []
  const openResFall = new Map<number, ResFall>()
  const closeResFall = (id: number, issue: ResistantFall['issue'], tick: number): void => {
    const r = openResFall.get(id)
    if (!r) return
    r.issue = issue
    r.closedAt = tick
    openResFall.delete(id)
  }
  const unionTicks = new Set<number>()

  for (const e of events) {
    if (e.tick !== currentTick) {
      currentTick = e.tick
      cryingAtTickStart = new Set(crying)
    }
    switch (e.type) {
      case 'fell': {
        if (!openEpisode.has(e.id)) openEpisode.add(e.id)
        const note = chuteNote.get(`${e.tick}:${e.id}`)
        const ord = note !== undefined && note.family !== 'membre' && !note.resistant
        lastFallOrd.set(e.id, ord)
        if (ord) chutesOrd++
        downSince.set(e.id, e.tick)
        down.add(e.id)
        telegraph.delete(e.id) // corps expulsé : son Relèvement repart de zéro
        if (note?.family !== 'membre') {
          // Corps avalé puis expulsé : sa chute précédente se termine ici, sans mort.
          const previous = openBreath.get(e.id)
          if (previous) previous.end = { tick: e.tick, death: false }
          const b: Breath = {
            fell: e.tick,
            id: e.id,
            expelled: expelAt.get(e.tick)?.has(e.id) ?? false,
            cryStart: null,
            sentencedAt: null,
            end: null,
          }
          breaths.push(b)
          openBreath.set(e.id, b)
        }
        if (note?.resistant) {
          const r: ResFall = { tick: e.tick, id: e.id, clangs: 0, issue: null, closedAt: endTick }
          resFalls.push(r)
          openResFall.set(e.id, r)
        }
        break
      }
      case 'sever':
        if (e.member !== undefined) {
          if (!openEpisode.has(e.member)) openEpisode.add(e.member)
          downSince.set(e.member, e.tick)
        }
        break
      case 'death': {
        if (openEpisode.delete(e.id)) acheves++
        const key = `${e.tick}:${e.id}`
        const phase: Phase = cryStoppedByDeath.has(key)
          ? telegraph.has(e.id)
            ? 'inspiration'
            : 'cri'
          : down.has(e.id) || openBreath.has(e.id)
            ? 'haletement'
            : 'aucune'
        phaseAtDeath.set(key, phase)
        D1[e.by][phase]++
        if (e.by === 'achevement') {
          const others = new Set(cryingAtTickStart)
          const wasCrying = others.delete(e.id)
          crisParAchevement.push(others.size)
          if (wasCrying) coupentUnCri++
          const since = downSince.get(e.id)
          if (since !== undefined) delaisAchevement.push(e.tick - since)
        }
        if (e.by === 'union') unionTicks.add(e.tick)
        down.delete(e.id)
        telegraph.delete(e.id)
        crying.delete(e.id)
        const b = openBreath.get(e.id)
        if (b) {
          b.end = { tick: e.tick, death: true }
          openBreath.delete(e.id)
        }
        closeResFall(e.id, 'mort', e.tick)
        break
      }
      case 'rise': {
        closeRecup(e.id)
        if (e.cause === 'delai' && lastFallOrd.get(e.id) === true) relevementsDelai++
        down.delete(e.id)
        telegraph.delete(e.id)
        const b = openBreath.get(e.id)
        if (b) {
          b.end = { tick: e.tick, death: false }
          openBreath.delete(e.id)
        }
        closeResFall(e.id, 'releve', e.tick)
        break
      }
      case 'prayer-complete':
        for (const id of e.others) closeRecup(id)
        break
      case 'absorb':
      case 'assemble':
        for (const id of e.others) {
          closeRecup(id)
          telegraph.delete(id) // dans un sac ou un Recousu, plus de Relèvement en cours
        }
        break
      case 'reattach':
        if (e.member !== null) closeRecup(e.member)
        break
      case 'reset':
        exclus += openEpisode.size
        openEpisode.clear()
        down.clear()
        telegraph.clear()
        for (const b of openBreath.values()) b.end = { tick: e.tick, death: false }
        openBreath.clear()
        for (const id of [...openResFall.keys()]) closeResFall(id, 'reset', e.tick)
        break
      case 'cry-start': {
        crying.add(e.id)
        const b = openBreath.get(e.id)
        if (b && b.cryStart === null) b.cryStart = e.tick
        break
      }
      case 'cry-stop':
        crying.delete(e.id)
        if (e.cause === 'death') cryStoppedByDeath.add(`${e.tick}:${e.id}`)
        break
      case 'rise-telegraph':
        telegraph.add(e.id)
        break
      case 'sentence-start': {
        const b = openBreath.get(e.target)
        if (b && b.sentencedAt === null) b.sentencedAt = e.tick
        break
      }
      case 'clang': {
        const r = openResFall.get(e.id)
        if (r) r.clangs++
        break
      }
    }
  }
  exclus += openEpisode.size
  for (const id of [...openResFall.keys()]) closeResFall(id, 'fin', endTick)

  // ---- B1 ----
  const morts = count(events, (e) => e.type === 'player-death')
  const degats = events.reduce((s, e) => s + (e.type === 'hit' && e.target === 'player' ? e.amount : 0), 0)
  const resetTicks = new Set(events.filter((e) => e.type === 'reset').map((e) => e.tick))
  let soins = 0
  for (let i = 1; i < series.length; i++) {
    const cur = series[i] as SeriesLine
    const prev = series[i - 1] as SeriesLine
    if (!resetTicks.has(cur.tick)) soins += Math.max(0, cur.vie - prev.vie)
  }
  const vieFin = lineAt(T)?.vie ?? lastLine?.vie ?? 0
  const donnees = deathNotes.filter((n) => n.by === 'achevement' || n.by === 'sentence')
  const viseesEnCombat = donnees.filter((n) => n.visee && n.enCombat).length
  const premierFell = events.find((e) => e.type === 'fell')?.tick ?? null
  const premierAchevementVise = deathNotes.find((n) => n.by === 'achevement' && n.visee)?.tick ?? null

  // ---- B3 ----
  const PD = count(events, (e) => e.type === 'action-start' && e.action === PRAYER_ACTION)
  const PA = count(events, (e) => e.type === 'prayer-complete')
  const pij = events.filter(
    (e) => e.type === 'action-interrupted' && e.action === PRAYER_ACTION && e.by === 'player',
  )
  const chargeTicks = events.filter((e) => e.type === 'player-rite' && e.rite === 'charge').map((e) => e.tick)
  const bursts = events.filter((e) => e.type === 'burst')
  const dosBursts = bursts.filter((e) => e.cause === 'dos')
  const AEP = dosBursts.map((b) => {
    const fell = fellAt.get(b.tick) ?? new Set<number>()
    const hit = burstHitAt.get(b.tick) ?? new Set<number>()
    const expelled = expelAt.get(b.tick) ?? new Set<number>()
    return [...fell].filter((id) => hit.has(id) && !expelled.has(id) && id !== b.id).length
  })
  let CR = 0
  let RP = 0
  let AB = 0
  let MC = 0
  for (const e of events) {
    if (e.type === 'prayer-complete') {
      CR += e.others.length
      RP += e.others.filter((id) => riseAt.get(`${e.tick}:${id}`) === 3).length
    } else if (e.type === 'absorb') AB += e.others.length
    else if (e.type === 'assemble') MC += e.others.length
    else if (e.type === 'rise' && e.cause === 'chirurgien') MC++
    else if (e.type === 'reattach' && typeof e.by === 'number') MC++
  }
  const VB = events.reduce(
    (s, e) => s + (e.type === 'hit' && e.target === 'player' && e.damageType === 'burst' ? e.amount : 0),
    0,
  )
  const PIc = pij.filter((e) => chargeTicks.some((c) => c >= e.tick - PIC_WINDOW && c <= e.tick)).length
  const suiviesDos = chargeTicks.filter((c) =>
    dosBursts.some((b) => b.tick >= c && b.tick <= c + O3A_WINDOW),
  ).length

  // ---- B4 ----
  // Actions du joueur dans la fenêtre d'engagement [T0 ; T_S] (fin de partie si la vague n'est pas vidée).
  const engagementEnd = TS ?? endTick
  type Cls = 'utile' | 'nettoyage' | 'vide' | 'sentence'
  const actions: { tick: number; cls: Cls }[] = []
  if (T0 !== null) {
    for (const e of events) {
      if (e.tick < T0 || e.tick > engagementEnd) continue
      if (e.type === 'sentence-start') actions.push({ tick: e.tick, cls: 'sentence' })
      else if (e.type === 'player-impact') {
        const cls: Cls = e.debout.length > 0 ? 'utile' : e.abattusOrd.length > 0 ? 'nettoyage' : 'vide'
        actions.push({ tick: e.tick, cls })
      }
    }
  }
  // Arme équipée à la première action : celle du départ, sauf changement d'arme avant elle.
  const firstTick = actions[0]?.tick ?? 0
  const equipped = events.reduce<WeaponId>(
    (w, e) => (e.type === 'weapon-swap' && e.tick <= firstTick ? e.weapon : w),
    ctx.weapon,
  )
  const nominal = TUNING.weapons[equipped].period
  const alloc = actions.map((a, k) =>
    k === 0 ? nominal : a.tick - (actions[k - 1] as { tick: number }).tick,
  )
  if (actions.length > 0) {
    const lastIdx = actions.length - 1
    alloc[lastIdx] = (alloc[lastIdx] as number) + engagementEnd - (actions[lastIdx] as { tick: number }).tick
  }
  // Les ticks d'un impact vide passent à l'action non vide suivante (à défaut, à la précédente).
  const owned = alloc.map(() => 0)
  for (let k = 0; k < actions.length; k++) {
    let target = k
    while (target < actions.length && actions[target]?.cls === 'vide') target++
    if (target >= actions.length) {
      target = k
      while (target >= 0 && actions[target]?.cls === 'vide') target--
    }
    if (target >= 0) owned[target] = (owned[target] as number) + (alloc[k] as number)
  }
  const o1Ticks = { utile: 0, nettoyage: 0, sentence: 0 }
  actions.forEach((a, k) => {
    if (a.cls !== 'vide') o1Ticks[a.cls] += owned[k] as number
  })
  const o1Total = o1Ticks.utile + o1Ticks.nettoyage + o1Ticks.sentence
  const impacts = {
    utile: actions.filter((a) => a.cls === 'utile').length,
    nettoyage: actions.filter((a) => a.cls === 'nettoyage').length,
    vide: actions.filter((a) => a.cls === 'vide').length,
  }
  const deaths = events.filter((e) => e.type === 'death')
  const mortsDonnees = deaths.filter((e) => e.by !== 'union').length
  const variantB = deaths.filter((e) => e.by === 'variant-b').length

  // O3 : queues de fin de combat, lues dans la série.
  const queues: number[] = []
  let rompues = 0
  let open: number | null = null
  let prevHostiles = 0
  for (const l of series) {
    if (open !== null) {
      if (l.hostiles > 0) {
        rompues++
        open = null
      } else if (l.abattusOrd === 0) {
        queues.push(l.tick - open)
        open = null
      }
    } else if (prevHostiles >= 1 && l.hostiles === 0 && l.abattusOrd >= 1) {
      open = l.tick
    }
    prevHostiles = l.hostiles
  }
  const balayages = count(events, (e) => e.type === 'player-rite' && e.rite === 'balayage')

  // ---- B5 ----
  let mortsAvant30 = 0
  let mortsAvant30AvecCri = 0
  let mortsA30 = 0
  let vivantsA30 = 0
  let criA30 = 0
  const ecartsA30 = { sentence: 0, expulse: 0, autre: 0 }
  for (const b of breaths) {
    const at30 = b.fell + HALF_SECOND
    if (b.end?.death && b.end.tick < at30) {
      mortsAvant30++
      if (b.cryStart !== null && b.cryStart <= b.end.tick) mortsAvant30AvecCri++
    } else if (b.end?.death && b.end.tick === at30) {
      mortsA30++
    } else if ((b.end === null || b.end.tick > at30) && endTick >= at30) {
      vivantsA30++
      if (b.cryStart === at30) criA30++
      else if (b.sentencedAt !== null && b.sentencedAt < at30) ecartsA30.sentence++
      else if (b.expelled) ecartsA30.expulse++
      else ecartsA30.autre++
    }
  }
  let classe1 = 0
  let classe2 = 0
  for (const n of donnees) {
    const phase = phaseAtDeath.get(`${n.tick}:${n.id}`)
    if (n.rang !== 1 || (phase !== 'cri' && phase !== 'inspiration')) continue
    if (n.vocalisentAvant <= CLASS1_MAX_VOICES) classe1++
    else classe2++
  }

  // ---- B2 ----
  const tStar =
    series.find(
      (l) =>
        l.tick >= S3_FROM &&
        l.tick <= S3_TO &&
        l.abattus6 + l.morts6 >= S3_BODIES &&
        l.abattus6 >= S3_MIN_EACH &&
        l.morts6 >= S3_MIN_EACH,
    )?.tick ?? null
  const O8a: number[] = []
  const O8b: number[] = []
  for (const n of notes) {
    if (n.kind === 'f-vide' && n.mortProche) O8a.push(combatIndex(n.tick))
    else if (n.kind === 'frappe' && n.sondage) O8b.push(combatIndex(n.tick))
  }
  const O8c: ResistantFall[] = resFalls
    .filter((r) => r.clangs >= 1)
    .map((r) => {
      const fProche = (fPresses.get(r.id) ?? []).some((t) => t >= r.tick && t <= r.closedAt)
      const issue = r.issue ?? 'fin'
      return {
        tick: r.tick,
        combatIndex: combatIndex(r.tick),
        id: r.id,
        clangs: r.clangs,
        fProche,
        issue,
        manquee: issue === 'releve' && r.clangs >= 2 && !fProche,
      }
    })

  return {
    fini,
    T,
    T0,
    TS,
    D,
    b1: {
      morts,
      degats,
      soins,
      perte: degats - soins,
      vieFin,
      confort: fini && morts === 0 && vieFin >= CONFORT_VIE,
      episodes: { acheves, recuperes, exclus },
      O7: { donnees: donnees.length, viseesEnCombat, part: ratio(viseesEnCombat, donnees.length) },
      O8: {
        premierFell,
        premierAchevementVise,
        delai:
          premierFell !== null && premierAchevementVise !== null ? premierAchevementVise - premierFell : null,
      },
    },
    b2: {
      S3: { tStar },
      O8: { tempsCombat: combat, O8a, O8b, O8c },
    },
    b3: {
      V: degats,
      M: morts,
      PD,
      PA,
      PIj: pij.length,
      CR,
      AB,
      ECd: dosBursts.length,
      ECc: bursts.filter((e) => e.cause === 'contact').length,
      ECt: bursts.filter((e) => e.cause === 'delai').length,
      AEP,
      MC,
      VB,
      CH: chargeTicks.length,
      PIc,
      RP,
      O3a: { charges: chargeTicks.length, suiviesDos },
    },
    b4: {
      O1: { part: ratio(o1Ticks.nettoyage, o1Total), ticks: o1Ticks },
      impacts,
      mortsDonnees,
      O2: ratio(impacts.nettoyage, mortsDonnees),
      O3: { queues, rompues, ouvertes: open === null ? 0 : 1 },
      O4: { chutesOrd, relevementsDelai, part: ratio(relevementsDelai, chutesOrd) },
      O6: { variantB, part: ratio(variantB, mortsDonnees) },
      O7: { pic: series.reduce((m, l) => Math.max(m, l.horde8), 0) },
      O8: { mortsJoueur: morts },
      O9: {
        crisParAchevement,
        achevements: crisParAchevement.length,
        coupentUnCri,
        partCoupentUnCri: ratio(coupentUnCri, crisParAchevement.length),
      },
      O10: { corpsTemps: series.reduce((s, l) => s + l.abattusOrd, 0) },
      balayages,
      balayagesParMinute: D !== null && D > 0 ? balayages / (D / 3600) : null,
      delaisAchevement,
    },
    b5: {
      O2: { mortsAvant30, mortsAvant30AvecCri, mortsA30, vivantsA30, criA30, ecartsA30 },
      D1,
      O6: {
        releve: count(events, (e) => e.type === 'rise'),
        priere: CR,
        assemblage: events.reduce((s, e) => s + (e.type === 'assemble' ? e.others.length : 0), 0),
        absorption: AB,
      },
      O7: {
        nMax: series.reduce((m, l) => Math.max(m, l.nonMorts), 0),
        valeursN: new Set(series.map((l) => l.nonMorts)).size,
      },
      O8: {
        vocalisentMax: series.reduce((m, l) => Math.max(m, l.vocalisent), 0),
        ticksSatures: series.filter((l) => l.vocalisent > VOICE_BUDGET).length,
      },
      O9: { groupes: unionTicks.size },
      O10: { classe1, classe2 },
    },
  }
}
