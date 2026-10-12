import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FAMILIES, TUNING } from '../../src/sim/index'
import { bancSheetRaw } from './banc'
import { parseAsset, producedClips, resolveTemps, SchemaError } from './schema'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const P0 = ['bourreau', 'souriant', 'recousu', 'porteur', 'confesseur', 'chirurgien']

const fiche = (id: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, 'art', 'forge', id, 'asset.json'), 'utf8'))

const issuesOf = (raw: unknown): string[] => {
  try {
    parseAsset(raw)
    return []
  } catch (e) {
    if (e instanceof SchemaError) return [...e.issues]
    throw e
  }
}

const mutate = (f: (raw: Record<string, unknown>) => void): Record<string, unknown> => {
  const raw = structuredClone(bancSheetRaw())
  f(raw)
  return raw
}
const clipsOf = (raw: Record<string, unknown>) => raw.clips as Record<string, unknown>[]

describe('fiches des six personnages de P0', () => {
  it('existent, sont valides et portent leur id', () => {
    const dirs = readdirSync(join(ROOT, 'art', 'forge')).filter((d) => !d.startsWith('.'))
    expect(dirs.sort()).toEqual([...P0].sort())
    for (const id of P0) expect(parseAsset(fiche(id)).id).toBe(id)
  })

  it('pointent une planche de référence qui existe', () => {
    for (const id of P0) expect(existsSync(join(ROOT, parseAsset(fiche(id)).reference.planche))).toBe(true)
  })

  it('couvrent chaque action de la simulation de leur famille', () => {
    for (const id of P0.filter((x) => x !== 'bourreau')) {
      const s = parseAsset(fiche(id))
      const fam = FAMILIES[s.famille as keyof typeof FAMILIES]
      const covered = new Set(
        s.clips.flatMap((c) => (c.temps && 'action' in c.temps ? [c.temps.action] : [])),
      )
      expect([...covered].sort(), id).toEqual(Object.keys(fam?.actions ?? {}).sort())
    }
  })

  it('portent les états communs des créatures : Rituel, chute, reptation, Relèvement, mort figée, réaction', () => {
    for (const id of P0.filter((x) => x !== 'bourreau')) {
      const s = parseAsset(fiche(id))
      const etats = s.clips.map((c) => c.etat)
      expect(
        etats.some((e) => e.startsWith('rituel.')),
        id,
      ).toBe(true)
      for (const e of [
        'alerte',
        'chute',
        'abattu.reptation',
        'abattu.torsion',
        'relevement',
        'mort',
        'reaction',
      ]) {
        expect(etats, `${id} ${e}`).toContain(e)
      }
      expect(s.clips.find((c) => c.etat === 'mort')?.type).toBe('figee')
      expect(s.interruption?.reaction).toBe('reaction')
    }
  })

  it('calent le Relèvement sur son télégraphe de 90 ticks', () => {
    for (const id of P0.filter((x) => x !== 'bourreau')) {
      const s = parseAsset(fiche(id))
      const rel = s.clips.find((c) => c.etat === 'relevement')
      expect(rel && resolveTemps(s, rel)?.fenetreTicks).toBe(TUNING.relevementTelegraph)
      expect(TUNING.relevementTelegraph).toBe(90)
    }
  })

  it('tirent les temps des attaques de la simulation (télégraphe = tick actif)', () => {
    const s = parseAsset(fiche('souriant'))
    const morsure = s.clips.find((c) => c.etat === 'attaque.morsure')
    expect(morsure && resolveTemps(s, morsure)).toMatchObject({
      impactTicks: TUNING.souriant.morsure.telegraph,
    })
    const r = parseAsset(fiche('recousu'))
    const marteau = r.clips.find((c) => c.etat === 'attaque.marteau')
    expect(marteau && resolveTemps(r, marteau)).toMatchObject({
      impactTicks: TUNING.recousu.marteau.telegraph,
      fenetreTicks: TUNING.recousu.marteau.telegraph + TUNING.recousu.marteau.recover,
    })
  })

  it("portent les hauteurs et budgets décidés par l'orchestrateur (requêtes F1-1 et F1-2, 2026-10-12)", () => {
    const attendu: Record<string, { h: number; tri: number; tex: number }> = {
      bourreau: { h: 1.95, tri: 25000, tex: 2048 },
      souriant: { h: 1.85, tri: 10500, tex: 2048 },
      recousu: { h: 2.15, tri: 18000, tex: 2048 },
      porteur: { h: 1.6, tri: 10500, tex: 2048 },
      confesseur: { h: 1.8, tri: 10500, tex: 2048 },
      chirurgien: { h: 2.05, tri: 10500, tex: 2048 },
    }
    for (const id of P0) {
      const s = parseAsset(fiche(id))
      const a = attendu[id]
      expect(a).toBeDefined()
      expect(s.hauteurM).toBe(a?.h)
      expect(s.budgets).toEqual({ triangles: a?.tri, texturePx: a?.tex })
    }
  })

  it('produisent des clips (ni figés ni procéduraux) avec une source', () => {
    for (const id of P0) {
      for (const c of producedClips(parseAsset(fiche(id)))) expect(c.source.kind).not.toBe('aucune')
    }
  })
})

describe('vérification de la fiche', () => {
  it('accepte la fiche du banc', () => {
    expect(issuesOf(bancSheetRaw())).toEqual([])
  })

  it('refuse un action_id dont le nom ne correspond pas à la bibliothèque Meshy', () => {
    const raw = mutate((r) => {
      ;(clipsOf(r)[3] as Record<string, unknown>).source = {
        kind: 'bibliotheque',
        actionId: 178,
        nom: 'Idle',
      }
    })
    expect(issuesOf(raw).join()).toMatch(/178 s’appelle Hit_Reaction/)
  })

  it('refuse deux fois la même action de bibliothèque (Meshy refuse les ids en double)', () => {
    const raw = mutate((r) => {
      ;(clipsOf(r)[0] as Record<string, unknown>).source = {
        kind: 'bibliotheque',
        actionId: 178,
        nom: 'Hit_Reaction',
      }
      ;(clipsOf(r)[3] as Record<string, unknown>).source = {
        kind: 'bibliotheque',
        actionId: 178,
        nom: 'Hit_Reaction',
      }
    })
    expect(issuesOf(raw).join()).toMatch(/demandée deux fois/)
  })

  it('refuse un mouvement hors des bornes de Text to Motion (2 à 10 s par 0,5 s, 400 caractères)', () => {
    const tooShort = mutate((r) => {
      ;(clipsOf(r)[0] as Record<string, unknown>).source = {
        kind: 'mouvement',
        prompt: 'x',
        dureeS: 1.5,
        mode: 'prime',
      }
    })
    expect(issuesOf(tooShort).join()).toMatch(/dureeS/)
    const offStep = mutate((r) => {
      ;(clipsOf(r)[0] as Record<string, unknown>).source = {
        kind: 'mouvement',
        prompt: 'x',
        dureeS: 2.3,
        mode: 'prime',
      }
    })
    expect(issuesOf(offStep).join()).toMatch(/pas de 0,5 s/)
    const long = mutate((r) => {
      ;(clipsOf(r)[0] as Record<string, unknown>).source = {
        kind: 'mouvement',
        prompt: 'x'.repeat(401),
        dureeS: 2,
        mode: 'prime',
      }
    })
    expect(issuesOf(long).join()).toMatch(/400 caractères/)
  })

  it('refuse une attaque sans temps, sans repère ni effecteur, ou liée à une action absente de la famille', () => {
    const noTemps = mutate((r) => {
      delete (clipsOf(r)[2] as Record<string, unknown>).temps
    })
    expect(issuesOf(noTemps).join()).toMatch(/une attaque porte ses temps/)
    const noMarker = mutate((r) => {
      delete (clipsOf(r)[2] as Record<string, unknown>).effecteur
    })
    expect(issuesOf(noMarker).join()).toMatch(/effecteur/)
    const wrongAction = mutate((r) => {
      ;(clipsOf(r)[2] as Record<string, unknown>).temps = { action: 'marteau' }
    })
    expect(issuesOf(wrongAction).join()).toMatch(/marteau n’est pas une action de la famille souriant/)
  })

  it('refuse un chemin TUNING qui ne mène pas à un nombre', () => {
    const raw = mutate((r) => {
      ;(clipsOf(r)[4] as Record<string, unknown>).temps = { fenetre: ['relevement.inexistant'] }
    })
    expect(issuesOf(raw).join()).toMatch(/chemin TUNING numérique/)
  })

  it('refuse une boucle qui ne boucle pas, une attaque qui boucle, un clip figé avec une source', () => {
    const raw = mutate((r) => {
      ;(clipsOf(r)[0] as Record<string, unknown>).boucle = false
      ;(clipsOf(r)[2] as Record<string, unknown>).boucle = true
      ;(clipsOf(r)[5] as Record<string, unknown>).source = { kind: 'bibliotheque', actionId: 0, nom: 'Idle' }
    })
    const issues = issuesOf(raw).join('\n')
    expect(issues).toMatch(/un clip de type boucle boucle/)
    expect(issues).toMatch(/un clip attaque ne boucle pas/)
    expect(issues).toMatch(/un clip figee n’a pas de source/)
  })

  it('refuse une réaction d’interruption qui n’est pas un clip de réaction de la fiche', () => {
    const raw = mutate((r) => {
      r.interruption = { reaction: 'rituel' }
    })
    expect(issuesOf(raw).join()).toMatch(/n’est pas un clip de réaction/)
  })

  it('refuse une taille de planche que GPT Image n’accepte pas', () => {
    const raw = mutate((r) => {
      ;(r.planche as Record<string, unknown>).taille = '1500x1000'
    })
    expect(issuesOf(raw).join()).toMatch(/divisibles par 16/)
  })

  it('refuse les états en double', () => {
    const raw = mutate((r) => {
      ;(clipsOf(r)[1] as Record<string, unknown>).etat = 'rituel'
    })
    expect(issuesOf(raw).join()).toMatch(/état rituel en double/)
  })
})
