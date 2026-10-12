// Registre des politiques de B2, B4 et B5 (lot C6c). Le banc (src/bots/harness.ts) le réunit aux autres.
// Noms et paramètres (`nom:clé=valeur`, voir parsePolicySpec) :
//   B4 §6  faucheur-couperet, faucheur-masse
//   B2 §6  B2-immobile, négligent, B2-script:cible=<id>:mode=acheve|sentence|clang-puis-sentence
//   B5 §6  b5:D=0|60|inf, s1:k=<ticks>:verbe=frappe|sentence|aucun (ou s1:variante=S1-hal…), s-nappe, s-sat
import type { Policy, PolicyFactory } from '../policy'
import { immobile, negligent, SCRIPT_MODES, type ScriptMode, script } from './b2'
import { b5, S1_VARIANTES, s1, sNappe, sSat, VERBES, type Verbe } from './b5'
import { faucheur } from './faucheur'

type Params = Readonly<Record<string, string>>

const only = (name: string, params: Params, allowed: readonly string[]): void => {
  for (const k of Object.keys(params))
    if (!allowed.includes(k))
      throw new Error(
        `${name} : paramètre inconnu « ${k} »${allowed.length > 0 ? ` (attendus : ${allowed.join(', ')})` : ''}`,
      )
}

const natural = (name: string, key: string, v: string | undefined): number => {
  if (v === undefined) throw new Error(`${name} : paramètre ${key} obligatoire`)
  const n = Number(v)
  if (v.trim() === '' || !Number.isInteger(n) || n < 0)
    throw new Error(`${name} : ${key} attend un entier positif ou nul, reçu « ${v} »`)
  return n
}

const fixed =
  (name: string, policy: Policy): PolicyFactory =>
  (params) => {
    only(name, params, [])
    return policy
  }

// B5 §6 : D ∈ { 0, 60, ∞ } ticks.
const parseD = (v: string | undefined): number => {
  if (v === '0') return 0
  if (v === '60') return 60
  if (v === 'inf' || v === '∞' || v === 'Infinity') return Number.POSITIVE_INFINITY
  throw new Error(`b5 : D ∈ { 0, 60, inf } (B5 §6), reçu « ${v ?? ''} »`)
}

const parseS1 = (params: Params): { readonly k: number; readonly verbe: Verbe } => {
  only('s1', params, ['k', 'verbe', 'variante'])
  if (params.variante !== undefined) {
    if (params.k !== undefined || params.verbe !== undefined)
      throw new Error('s1 : variante exclut k et verbe')
    const v = S1_VARIANTES[params.variante]
    if (!v)
      throw new Error(
        `s1 : variante inconnue « ${params.variante} » (connues : ${Object.keys(S1_VARIANTES).join(', ')})`,
      )
    return v
  }
  const verbe = VERBES.find((x) => x === params.verbe)
  if (verbe === undefined)
    throw new Error(`s1 : verbe ∈ { ${VERBES.join(', ')} }, reçu « ${params.verbe ?? ''} »`)
  // S1-rel : k absent de la table, sans effet quand verbe = aucun.
  const k = verbe === 'aucun' && params.k === undefined ? 0 : natural('s1', 'k', params.k)
  return { k, verbe }
}

const parseMode = (v: string | undefined): ScriptMode => {
  const mode = SCRIPT_MODES.find((m) => m === v)
  if (mode === undefined)
    throw new Error(`B2-script : mode ∈ { ${SCRIPT_MODES.join(', ')} }, reçu « ${v ?? ''} »`)
  return mode
}

export const policies: Readonly<Record<string, PolicyFactory>> = {
  // B4 §6
  'faucheur-couperet': fixed('faucheur-couperet', faucheur('couperet') as Policy),
  'faucheur-masse': fixed('faucheur-masse', faucheur('masse') as Policy),
  // B2 §6
  'B2-immobile': fixed('B2-immobile', immobile as Policy),
  négligent: fixed('négligent', negligent as Policy),
  'B2-script': (params) => {
    only('B2-script', params, ['cible', 'mode'])
    return script(natural('B2-script', 'cible', params.cible), parseMode(params.mode)) as Policy
  },
  // B5 §6
  b5: (params) => {
    only('b5', params, ['D'])
    return b5(parseD(params.D)) as Policy
  },
  s1: (params) => {
    const { k, verbe } = parseS1(params)
    return s1(k, verbe) as Policy
  },
  's-nappe': fixed('s-nappe', sNappe as Policy),
  's-sat': fixed('s-sat', sSat as Policy),
}
