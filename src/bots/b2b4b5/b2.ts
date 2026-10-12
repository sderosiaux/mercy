// B2 « Lire un corps », §6 du contrat gelé (.mercy/contracts/_frozen/B2.md) : `B2-immobile`, `négligent` et
// `B2-script(cible, mode)`. Toutes déterministes ; arme : Couperet (celle du départ, aucune ne demande le changement).
// Notations du contrat : `dist` euclidienne au sol ; `norm(v)` = v / |v|, et (0, 0) si |v| = 0 ;
// `debout(c)` = état `rituel` ou `hostile` ; IDLE(w) vise la position du joueur.
import { type Creature, dhypot, type PlayerCommands, type Vec2, type World } from '../../sim/index'
import type { Policy } from '../policy'

const dist = (a: Vec2, b: Vec2): number => dhypot(a.x - b.x, a.z - b.z)
const norm = (v: Vec2): Vec2 => {
  const l = dhypot(v.x, v.z)
  return l === 0 ? { x: 0, z: 0 } : { x: v.x / l, z: v.z / l }
}
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z })
const debout = (c: Creature): boolean => c.state.kind === 'rituel' || c.state.kind === 'hostile'

export const IDLE = (w: World): PlayerCommands => ({
  move: { x: 0, z: 0 },
  aim: w.player.pos,
  strike: false,
  dodge: false,
  sentence: false,
  rite: null,
  swapWeapon: false,
})

// Valeurs du pseudo-code.
const NEGLIGENT_ARRET = 1.8 // m : s'arrête de marcher
const NEGLIGENT_FRAPPE = 2.2 // m : frappe
const SCRIPT_RETOUR = 0.2 // m : retrait jusqu'à O
const SCRIPT_APPROCHE = 1.5 // m : distance de travail
const SCRIPT_LIMITE = 120 // ticks après le début de l'action : au-delà, scène invalide

// B2-immobile(w) : retour IDLE(w)
export const immobile: Policy<null> = {
  name: 'B2-immobile',
  init: () => null,
  decide: (w) => [IDLE(w), null],
}

// négligent(w) : frappe ce qui est debout, ne s'occupe jamais des corps.
export const decideNegligent = (w: World): PlayerCommands => {
  const p = w.player
  const C = w.creatures.filter(debout)
  if (C.length === 0) return IDLE(w)
  // t ← élément de C qui minimise (dist(p.pos, c.pos), c.id), ordre lexicographique.
  let t = C[0] as Creature
  for (const c of C) {
    const dc = dist(p.pos, c.pos)
    const dt = dist(p.pos, t.pos)
    if (dc < dt || (dc === dt && c.id < t.id)) t = c
  }
  const d = dist(p.pos, t.pos)
  return {
    move: d > NEGLIGENT_ARRET ? norm(minus(t.pos, p.pos)) : { x: 0, z: 0 },
    aim: t.pos,
    strike: d <= NEGLIGENT_FRAPPE,
    dodge: false,
    sentence: false,
    rite: null,
    swapWeapon: false,
  }
}

export const negligent: Policy<null> = {
  name: 'négligent',
  init: () => null,
  decide: (w) => [decideNegligent(w), null],
}

// B2-script(cible, mode)
export type ScriptMode = 'acheve' | 'sentence' | 'clang-puis-sentence'
export const SCRIPT_MODES: readonly ScriptMode[] = ['acheve', 'sentence', 'clang-puis-sentence']

export interface ScriptMemory {
  readonly clangVu: boolean
  readonly debutAction: number | null
  // O = (0, 0) en (u, v) : l'origine des coordonnées de scène est la position initiale du joueur (B2 §5).
  readonly O: Vec2
}

// « Scène invalide, arrêt, rapport (défaut de sim ou de script, pas échec de B2) » : la partie s'arrête sur cette
// erreur, que le lanceur rapporte.
export class SceneInvalide extends Error {
  override readonly name = 'SceneInvalide'
}

export const decideScript = (
  cible: number,
  mode: ScriptMode,
  w: World,
  m0: ScriptMemory,
): readonly [PlayerCommands, ScriptMemory] => {
  // à chaque tick, avant la décision : m.clangVu ← m.clangVu ∨ (∃ e ∈ w.events : e.type = 'clang' ∧ e.id = cible)
  let m: ScriptMemory = {
    ...m0,
    clangVu: m0.clangVu || w.events.some((e) => e.type === 'clang' && e.id === cible),
  }
  const T = w.creatures.find((c) => c.id === cible)
  if (!T)
    throw new SceneInvalide(`B2-script(${cible}, ${mode}) : créature ${cible} absente au tick ${w.tick}`)
  const p = w.player
  const O = m.O
  // si T.state.kind = 'mort' : retrait, puis immobilité
  if (T.state.kind === 'mort') {
    if (dist(p.pos, O) > SCRIPT_RETOUR) return [{ ...IDLE(w), move: norm(minus(O, p.pos)) }, m]
    return [IDLE(w), m]
  }
  const d = dist(p.pos, T.pos)
  if (d > SCRIPT_APPROCHE) return [{ ...IDLE(w), move: norm(minus(T.pos, p.pos)), aim: T.pos }, m]
  if (m.debutAction === null) m = { ...m, debutAction: w.tick }
  const debut = m.debutAction as number
  if (w.tick - debut > SCRIPT_LIMITE)
    throw new SceneInvalide(
      `B2-script(${cible}, ${mode}) : plus de ${SCRIPT_LIMITE} ticks depuis le début de l'action (tick ${debut}), ` +
        `cible encore ${T.state.kind} au tick ${w.tick}`,
    )
  switch (mode) {
    case 'acheve':
      return [{ ...IDLE(w), aim: T.pos, strike: true }, m]
    case 'sentence':
      return [{ ...IDLE(w), aim: T.pos, sentence: p.action === null }, m]
    case 'clang-puis-sentence':
      return m.clangVu
        ? [{ ...IDLE(w), aim: T.pos, sentence: p.action === null }, m]
        : [{ ...IDLE(w), aim: T.pos, strike: true }, m]
  }
}

export const script = (cible: number, mode: ScriptMode): Policy<ScriptMemory> => ({
  name: `B2-script:cible=${cible}:mode=${mode}`,
  // mémoire m, initialisée à { clangVu : faux, debutAction : null }
  init: (w) => ({ clangVu: false, debutAction: null, O: w.player.pos }),
  decide: (w, m) => decideScript(cible, mode, w, m),
})
