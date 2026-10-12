// Hash d'une sérialisation canonique : clés triées, fonctions ignorées. Sert au rejeu (déterminisme).

const canonical = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : JSON.stringify(String(v))
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
  if (typeof v === 'function') return ''
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v instanceof Set) return canonical([...v].sort())
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => typeof o[k] !== 'function' && o[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

// cyrb53 : hash 53 bits, suffisant pour comparer des rejeux.
const cyrb53 = (str: string, seed = 0): string => {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

export const hashValue = (v: unknown): string => cyrb53(canonical(v))
