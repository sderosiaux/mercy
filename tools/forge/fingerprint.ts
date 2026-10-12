// Empreintes : SHA-256 d'une sérialisation canonique (clés triées, récursif). Deux entrées égales en valeur ont
// la même empreinte quel que soit l'ordre de leurs clés ; tout changement de valeur la change.
import { createHash } from 'node:crypto'

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`nombre non fini : ${value}`)
    if (value === undefined) throw new Error('undefined dans une empreinte')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')

export const fingerprint = (value: unknown): string => sha256(canonicalJson(value))
