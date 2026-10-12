// Politiques de B2 §6, recopiées du contrat gelé pour piloter les scènes du laboratoire dans le navigateur.
// C6 en porte la version de référence (src/bots) ; celle-ci ne sert qu'au rendu des scènes S1 et S2.
import { IDLE_COMMANDS, type PlayerCommands, type Vec2, type World } from '../sim/index'

export type Policy = (w: World) => PlayerCommands

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.z)
  return l === 0 ? { x: 0, z: 0 } : { x: v.x / l, z: v.z / l }
}
const idle = (w: World): PlayerCommands => ({ ...IDLE_COMMANDS, aim: w.player.pos })

export const immobile: Policy = (w) => idle(w)

// Frappe ce qui est debout, ne s'occupe jamais des corps.
export const negligent: Policy = (w) => {
  const p = w.player
  const standing = w.creatures.filter((c) => c.state.kind === 'rituel' || c.state.kind === 'hostile')
  if (standing.length === 0) return idle(w)
  let t = standing[0]
  for (const c of standing) {
    if (!t) break
    const dc = dist(p.pos, c.pos)
    const dt = dist(p.pos, t.pos)
    if (dc < dt || (dc === dt && c.id < t.id)) t = c
  }
  if (!t) return idle(w)
  const d = dist(p.pos, t.pos)
  return {
    ...IDLE_COMMANDS,
    move: d > 1.8 ? norm({ x: t.pos.x - p.pos.x, z: t.pos.z - p.pos.z }) : { x: 0, z: 0 },
    aim: t.pos,
    strike: d <= 2.2,
  }
}

export type ScriptMode = 'acheve' | 'sentence' | 'clang-puis-sentence'

export class InvalidScene extends Error {}

// B2-script(cible, mode) : mémoire propre à une partie.
export const b2Script = (cible: number, mode: ScriptMode): Policy => {
  const m: { clangVu: boolean; debutAction: number | null } = { clangVu: false, debutAction: null }
  const O = { x: 0, z: 0 }
  return (w) => {
    m.clangVu = m.clangVu || w.events.some((e) => e.type === 'clang' && e.id === cible)
    const T = w.creatures.find((c) => c.id === cible)
    const p = w.player
    if (!T) throw new InvalidScene(`cible ${cible} absente`)
    if (T.state.kind === 'mort') {
      if (dist(p.pos, O) > 0.2) return { ...idle(w), move: norm({ x: O.x - p.pos.x, z: O.z - p.pos.z }) }
      return idle(w)
    }
    const d = dist(p.pos, T.pos)
    if (d > 1.5) return { ...idle(w), move: norm({ x: T.pos.x - p.pos.x, z: T.pos.z - p.pos.z }), aim: T.pos }
    if (m.debutAction === null) m.debutAction = w.tick
    if (w.tick - m.debutAction > 120)
      throw new InvalidScene(`B2-script(${cible}, ${mode}) : plus de 120 ticks`)
    switch (mode) {
      case 'acheve':
        return { ...idle(w), aim: T.pos, strike: true }
      case 'sentence':
        return { ...idle(w), aim: T.pos, sentence: p.action === null }
      case 'clang-puis-sentence':
        return m.clangVu
          ? { ...idle(w), aim: T.pos, sentence: p.action === null }
          : { ...idle(w), aim: T.pos, strike: true }
    }
  }
}
