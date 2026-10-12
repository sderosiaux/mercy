// Chaîne complète sur un Meshy simulé au niveau HTTP (fetch) et un GPT Image simulé (le script écrit une planche
// synthétique) : ce qu'on vérifie, c'est la Forge (requêtes, cache, assemblage, validation, manifeste), pas Meshy.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bancSheetRaw } from '../banc'
import { cacheFile, createStore } from '../cache'
import { buildFigure, type ClipDef } from '../gltf/build'
import { hit, idle, rise, strike, walkInPlace, walkWithRootMotion } from '../gltf/fixtures'
import { writeGlb } from '../gltf/glb'
import type { CommandRunner } from '../gptimage'
import { encodePng } from '../image/png'
import { syntheticSheet } from '../image/synthetic'
import { createMeshyClient } from '../meshy/client'
import { parseAsset } from '../schema'
import type { ForgeContext } from './context'
import { readManifest } from './manifest'
import { runForge } from './pipeline'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const sheetRaw = (relevementPrompt = 'rise'): Record<string, unknown> => ({
  ...bancSheetRaw(),
  clips: [
    {
      etat: 'rituel',
      type: 'boucle',
      source: { kind: 'bibliotheque', actionId: 0, nom: 'Idle' },
      boucle: true,
      surPlace: true,
      note: 'n',
    },
    {
      etat: 'marche',
      type: 'boucle',
      source: { kind: 'bibliotheque', actionId: 669, nom: 'Slow_Orc_Walk_inplace' },
      boucle: true,
      surPlace: false,
      locomotion: { vitesse: 'souriant.speed' },
      note: 'n',
    },
    {
      etat: 'course',
      type: 'boucle',
      source: { kind: 'mouvement', prompt: 'walk-root', dureeS: 2, mode: 'prime' },
      boucle: true,
      surPlace: false,
      locomotion: { vitesse: 'souriant.speed' },
      retirerDerive: true,
      note: 'n',
    },
    {
      etat: 'attaque',
      type: 'attaque',
      source: { kind: 'mouvement', prompt: 'strike', dureeS: 2, mode: 'prime' },
      boucle: false,
      surPlace: true,
      temps: { action: 'morsure' },
      effecteur: 'mainDroite',
      note: 'n',
    },
    {
      etat: 'reaction',
      type: 'reaction',
      source: { kind: 'bibliotheque', actionId: 178, nom: 'Hit_Reaction' },
      boucle: false,
      surPlace: true,
      note: 'n',
    },
    {
      etat: 'relevement',
      type: 'transition',
      source: { kind: 'mouvement', prompt: relevementPrompt, dureeS: 2, mode: 'swift' },
      boucle: false,
      surPlace: false,
      temps: { fenetre: ['relevementTelegraph'] },
      note: 'n',
    },
    { etat: 'mort', type: 'figee', source: { kind: 'aucune' }, boucle: false, surPlace: false, note: 'n' },
  ],
})

const bare = (c: ClipDef): ClipDef => ({ name: c.name, duration: c.duration, pose: c.pose }) // Meshy ne pose pas d'extras
const LIBRARY: Record<number, ClipDef> = {
  0: bare(idle('Idle')),
  669: bare(walkInPlace('Slow_Orc_Walk_inplace')),
  178: bare(hit('Hit_Reaction')),
}
const MOTIONS: Record<string, ClipDef> = {
  'walk-root': bare(walkWithRootMotion('Armature|clip0', 1.5)),
  strike: bare(strike('Armature|clip0')),
  rise: bare(rise('Armature|clip0')),
  'rise slower': bare(rise('Armature|clip0', 2)),
}
const CREDITS: Record<string, (body: Record<string, unknown>) => number> = {
  'multi-image-to-3d': () => 30,
  rigging: () => 5,
  animations: (b) => (Array.isArray(b.action_ids) ? 3 * b.action_ids.length : 3),
  'text-to-motion': (b) => (b.mode === 'prime' ? 10 : 3),
}

// Meshy simulé : POST crée, GET rend la tâche réussie, les URL d'assets rendent des GLB construits en code.
const fakeMeshy = () => {
  const tasks = new Map<string, { endpoint: string; body: Record<string, unknown> }>()
  const calls: { method: string; path: string }[] = []
  let n = 0
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const glbFor = (id: string): Uint8Array => {
    const t = tasks.get(id)
    if (!t) throw new Error(`tâche ${id} inconnue`)
    if (t.endpoint !== 'animations') return writeGlb(buildFigure({ clips: [] }))
    if (Array.isArray(t.body.action_ids)) {
      return writeGlb(
        buildFigure({ clips: (t.body.action_ids as number[]).map((a) => LIBRARY[a] as ClipDef) }),
      )
    }
    const motion = tasks.get(String(t.body.motion_task_id))
    return writeGlb(buildFigure({ clips: [MOTIONS[String(motion?.body.prompt)] as ClipDef] }))
  }
  const fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: `${u.host}${u.pathname}` })
    if (u.host === 'assets.test') return new Response(glbFor(u.pathname.slice(1)).slice())
    const path = u.pathname.replace('/openapi/v1/', '')
    if (method === 'POST') {
      const id = `t${++n}`
      tasks.set(id, { endpoint: path, body: JSON.parse(String(init?.body)) })
      return json({ result: id })
    }
    if (path === 'animations/library') {
      const ids = (u.searchParams.get('action_ids') ?? '').split(',').map(Number)
      return json(ids.map((a) => ({ action_id: a, name: LIBRARY[a]?.name })))
    }
    const [endpoint, id] = path.split('/') as [string, string]
    const t = tasks.get(id)
    const asset = `https://assets.test/${id}`
    return json({
      id,
      status: 'SUCCEEDED',
      consumed_credits: CREDITS[endpoint]?.(t?.body ?? {}) ?? 0,
      model_urls: { glb: asset },
      result: { rigged_character_glb_url: asset, animation_glb_url: asset, motion_url: asset },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls, posts: () => calls.filter((c) => c.method === 'POST') }
}

const fakeImage = () => {
  let runs = 0
  const runner: CommandRunner = async (cmd) => {
    runs++
    const out = cmd.args[2] as string
    const { writeFileSync } = await import('node:fs')
    writeFileSync(out, encodePng(syntheticSheet()))
    return { code: 0, stdout: `Saved: ${out}`, stderr: '' }
  }
  return { runner, runs: () => runs }
}

const context = (
  root: string,
  raw: Record<string, unknown>,
  meshy: ReturnType<typeof fakeMeshy> | null,
  image: ReturnType<typeof fakeImage>,
  dryRun = false,
): ForgeContext => ({
  root,
  sheet: parseAsset(raw),
  store: createStore(root, 'banc'),
  force: false,
  dryRun,
  now: () => new Date('2026-10-11T12:00:00Z'),
  meshy: meshy
    ? createMeshyClient({ apiKey: 'msy_test', fetch: meshy.fetch, sleep: async () => {}, now: () => 0 })
    : null,
  runImage: image.runner,
  log: () => {},
})

const newRoot = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'forge-chaine-'))
  roots.push(r)
  return r
}

describe('chaîne complète, concept → modèle → rig → animations → GLB → validation', () => {
  it('produit le GLB, le rapport et le manifeste, puis ne repaie rien au second passage', async () => {
    const root = newRoot()
    const m1 = fakeMeshy()
    const i1 = fakeImage()
    const s1 = await runForge(context(root, sheetRaw(), m1, i1), [
      'concept',
      'model',
      'rig',
      'anim',
      'validate',
    ])
    expect(s1.etapes.map((e) => [e.etape, e.statut])).toEqual([
      ['concept', 'fait'],
      ['model', 'fait'],
      ['rig', 'fait'],
      ['anim', 'fait'],
      ['validate', 'fait'],
    ])
    expect(i1.runs()).toBe(1)
    // modèle, rig, un paquet de bibliothèque (3 actions), 3 mouvements et leurs 3 applications
    expect(m1.posts().map((p) => p.path.replace('api.meshy.ai/openapi/v1/', ''))).toEqual([
      'multi-image-to-3d',
      'rigging',
      'animations',
      'text-to-motion',
      'animations',
      'text-to-motion',
      'animations',
      'text-to-motion',
      'animations',
    ])
    expect(s1.creditsMeshy.total).toBe(30 + 5 + 9 + (10 + 3) + (10 + 3) + (3 + 3))
    expect(existsSync(join(root, 'public/models/banc.glb'))).toBe(true)
    const report = JSON.parse(readFileSync(join(root, 'art/forge/banc/validation.json'), 'utf8'))
    expect(report.bilan.verdict).toBe('valide')
    const course = report.controles.find(
      (c: { controle: string; clip?: string }) => c.controle === 'sur-place' && c.clip === 'course',
    )
    expect(course.verdict).toBe('ok') // dérive de racine retirée à l'assemblage
    const manifest = readManifest(root).assets.banc
    expect(manifest).toMatchObject({
      glb: 'models/banc.glb',
      validation: { verdict: 'valide' },
      credits: { meshy: s1.creditsMeshy.total },
    })
    expect(manifest?.clips.map((c) => c.name)).toEqual([
      'rituel',
      'marche',
      'course',
      'attaque',
      'reaction',
      'relevement',
    ])
    expect(manifest?.clips.find((c) => c.name === 'attaque')?.impactS).toBeGreaterThan(0)
    expect(manifest?.recetteGlobale?.interruptionFadeS).toBeCloseTo(2 / 60, 3)

    const m2 = fakeMeshy()
    const i2 = fakeImage()
    const s2 = await runForge(context(root, sheetRaw(), m2, i2), [
      'concept',
      'model',
      'rig',
      'anim',
      'validate',
    ])
    expect(m2.calls).toEqual([])
    expect(i2.runs()).toBe(0)
    expect(s2.etapes.flatMap((e) => e.pas.map((p) => p.issue)).every((x) => x === 'cache')).toBe(true)
    expect(s2.creditsMeshy.total).toBe(s1.creditsMeshy.total)
  })

  it('ne repaie que ce qui a changé : un prompt de mouvement modifié → ce mouvement et son application', async () => {
    const root = newRoot()
    await runForge(context(root, sheetRaw(), fakeMeshy(), fakeImage()), [
      'concept',
      'model',
      'rig',
      'anim',
      'validate',
    ])
    const m = fakeMeshy()
    const s = await runForge(context(root, sheetRaw('rise slower'), m, fakeImage()), [
      'concept',
      'model',
      'rig',
      'anim',
      'validate',
    ])
    expect(m.posts().map((p) => p.path.replace('api.meshy.ai/openapi/v1/', ''))).toEqual([
      'text-to-motion',
      'animations',
    ])
    const anim = s.etapes.find((e) => e.etape === 'anim')
    expect(anim?.pas.filter((p) => p.issue === 'paye').map((p) => p.cle)).toEqual([
      'mouvement-relevement',
      'applique-relevement',
    ])
    expect(anim?.pas.find((p) => p.cle === 'assemblage')?.issue).toBe('local')
  })

  it('retélécharge un fichier disparu du cache sans repayer la tâche', async () => {
    const root = newRoot()
    const m = fakeMeshy() // le même serveur : il connaît les tâches déjà créées
    await runForge(context(root, sheetRaw(), m, fakeImage()), ['concept', 'model', 'rig'])
    rmSync(join(root, cacheFile('banc', 'rig.glb')))
    m.calls.length = 0
    const s = await runForge(context(root, sheetRaw(), m, fakeImage()), ['rig'])
    expect(s.etapes[0]).toMatchObject({ etape: 'rig', statut: 'fait' })
    expect(m.posts()).toEqual([])
    expect(m.calls.map((c) => c.method)).toEqual(['GET', 'GET']) // relire la tâche, retélécharger le fichier
    expect(s.etapes[0]?.pas[0]?.issue).toBe('retelecharge')
  })

  it('un clone neuf (cache binaire absent, enregistrements versionnés présents) ne repaie rien', async () => {
    const root = newRoot()
    const m = fakeMeshy()
    const all = ['concept', 'model', 'rig', 'anim', 'validate'] as const
    await runForge(context(root, sheetRaw(), m, fakeImage()), all)
    rmSync(join(root, 'art/forge/.cache'), { recursive: true, force: true })
    m.calls.length = 0
    const image = fakeImage()
    const s = await runForge(context(root, sheetRaw(), m, image), all)
    expect(s.etapes.map((e) => e.statut)).toEqual(['fait', 'fait', 'fait', 'fait', 'fait'])
    expect(m.posts()).toEqual([])
    expect(image.runs()).toBe(0)
    const issues = s.etapes.flatMap((e) => e.pas.map((p) => p.issue))
    expect(issues).not.toContain('paye')
    expect(issues).toContain('retelecharge')
  })

  it('sans MESHY_API_KEY : la planche est faite, le modèle est bloqué et marqué non vérifié', async () => {
    const root = newRoot()
    const s = await runForge(context(root, sheetRaw(), null, fakeImage()), [
      'concept',
      'model',
      'rig',
      'anim',
      'validate',
    ])
    expect(s.etapes.map((e) => [e.etape, e.statut])).toEqual([
      ['concept', 'fait'],
      ['model', 'bloque'],
    ])
    expect(s.etapes[1]?.detail).toMatch(/MESHY_API_KEY absente.*non vérifié/)
    expect(existsSync(join(root, 'art/forge/banc/planche-modele.png'))).toBe(true)
    expect(existsSync(join(root, cacheFile('banc', 'vue-dos.png')))).toBe(true)
  })

  it('à blanc (--dry-run) : estime le coût complet sans appeler aucun service', async () => {
    const root = newRoot()
    const m = fakeMeshy()
    const i = fakeImage()
    const s = await runForge(context(root, sheetRaw(), m, i, true), [
      'concept',
      'model',
      'rig',
      'anim',
      'validate',
    ])
    expect(m.calls).toEqual([])
    expect(i.runs()).toBe(0)
    expect(s.estimation).toMatchObject({
      model: 30,
      rig: 5,
      anim: 3 * 3 + 2 * (10 + 3) + (3 + 3),
      requetesBibliotheque: 1,
    })
  })
})
