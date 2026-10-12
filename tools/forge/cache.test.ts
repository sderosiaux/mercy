// Empreintes et cache : une étape inchangée ne rappelle pas le service ; une tâche Meshy créée n'est jamais
// recréée (reprise, retéléchargement) ; une création incertaine bloque au lieu de payer deux fois.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cacheFile, createStore, type ForgeStore, runLocalStep, runMeshyStep, spentCredits } from './cache'
import { canonicalJson, fingerprint } from './fingerprint'
import { CreateUncertainError, type MeshyClient, MeshyError, type MeshyTask } from './meshy/client'
import type { MeshyRequest } from './meshy/requests'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const newStore = (): ForgeStore => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cache-'))
  roots.push(root)
  return createStore(root, 'essai', () => new Date('2026-10-11T00:00:00Z'))
}

const request = (body: Record<string, unknown> = { rig_task_id: 'r', action_ids: [1] }): MeshyRequest => ({
  endpoint: 'animations',
  body,
  descriptor: body,
  estimatedCredits: 3,
})

interface Counter {
  create: number
  get: number
  wait: number
  download: number
}

const fakeClient = (opts: { createError?: Error; waitError?: Error; status?: MeshyTask['status'] } = {}) => {
  const n: Counter = { create: 0, get: 0, wait: 0, download: 0 }
  let next = 0
  const task = (id: string): MeshyTask => ({
    id,
    status: opts.status ?? 'SUCCEEDED',
    consumed_credits: 3,
    result: { animation_glb_url: `https://assets.test/${id}` },
  })
  const client: MeshyClient = {
    create: async () => {
      n.create++
      if (opts.createError) throw opts.createError
      next++
      return `task-${next}`
    },
    get: async (_e, id) => {
      n.get++
      return task(id)
    },
    wait: async (_e, id) => {
      n.wait++
      if (opts.waitError) throw opts.waitError
      return task(id)
    },
    download: async (url) => {
      n.download++
      return new TextEncoder().encode(`glb:${url}`)
    },
    library: async () => [],
    balance: async () => 0,
  }
  return { client, n }
}

const step = (store: ForgeStore, client: MeshyClient, req = request(), force = false) =>
  runMeshyStep({
    store,
    client,
    key: 'anim-bib-0',
    request: req,
    force,
    now: () => new Date('2026-10-11T00:00:00Z'),
    collect: async (task) => ({
      glb: store.put(
        cacheFile('essai', 'anim.glb'),
        await client.download(String(task.result?.animation_glb_url)),
      ),
    }),
  })

describe('empreintes', () => {
  it('ne dépendent pas de l’ordre des clés, changent avec la moindre valeur', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}')
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }))
    expect(fingerprint({ a: 1, b: 2 })).not.toBe(fingerprint({ a: 1, b: 3 }))
    expect(fingerprint({ a: [1, 2] })).not.toBe(fingerprint({ a: [2, 1] }))
    expect(() => canonicalJson({ a: Number.NaN })).toThrow()
  })
})

describe('tâches Meshy en cache', () => {
  it('une étape inchangée ne rappelle pas le service', async () => {
    const store = newStore()
    const first = fakeClient()
    const r1 = await step(store, first.client)
    expect(r1.outcome).toBe('paye')
    expect(first.n).toEqual({ create: 1, get: 0, wait: 1, download: 1 })
    expect(r1.record).toMatchObject({ status: 'reussi', taskId: 'task-1', credits: 3 })
    const second = fakeClient()
    const r2 = await step(store, second.client)
    expect(r2.outcome).toBe('cache')
    expect(second.n).toEqual({ create: 0, get: 0, wait: 0, download: 0 })
  })

  it('une entrée changée crée une nouvelle tâche ; le registre garde le coût des deux', async () => {
    const store = newStore()
    await step(store, fakeClient().client)
    const again = fakeClient()
    const r = await step(store, again.client, request({ rig_task_id: 'r', action_ids: [1, 2] }))
    expect(r.outcome).toBe('paye')
    expect(again.n.create).toBe(1)
    expect(spentCredits(store).total).toBe(6)
  })

  it('--force recrée même si rien n’a changé', async () => {
    const store = newStore()
    await step(store, fakeClient().client)
    const forced = fakeClient()
    expect((await step(store, forced.client, request(), true)).outcome).toBe('paye')
    expect(forced.n.create).toBe(1)
  })

  it('une tâche créée mais pas finie est reprise, jamais recréée', async () => {
    const store = newStore()
    const timeout = fakeClient({ waitError: new MeshyError('attente dépassée', 'reseau') })
    await expect(step(store, timeout.client)).rejects.toThrow()
    expect(store.read('anim-bib-0')).toMatchObject({ status: 'cree', taskId: 'task-1' })
    const resume = fakeClient()
    const r = await step(store, resume.client)
    expect(r.outcome).toBe('repris')
    expect(resume.n).toMatchObject({ create: 0, wait: 1 })
    expect(r.record.taskId).toBe('task-1')
  })

  it('des fichiers disparus sont retéléchargés par une lecture gratuite de la tâche, sans la repayer', async () => {
    const store = newStore()
    await step(store, fakeClient().client)
    rmSync(join(store.root, cacheFile('essai', 'anim.glb')))
    const again = fakeClient()
    const r = await step(store, again.client)
    expect(r.outcome).toBe('retelecharge')
    expect(again.n).toMatchObject({ create: 0, get: 1, download: 1 })
  })

  it('une création incertaine (coupure, 5xx) bloque la relance au lieu de payer deux fois', async () => {
    const store = newStore()
    const cut = fakeClient({ createError: new CreateUncertainError('coupure', 'reseau') })
    await expect(step(store, cut.client)).rejects.toBeInstanceOf(CreateUncertainError)
    expect(store.read('anim-bib-0')?.status).toBe('incertain')
    const retry = fakeClient()
    await expect(step(store, retry.client)).rejects.toThrow(/peut-être réussi/)
    expect(retry.n.create).toBe(0)
    expect((await step(store, retry.client, request(), true)).outcome).toBe('paye')
  })

  it('un refus 4xx n’a rien créé : la relance recrée', async () => {
    const store = newStore()
    const refused = fakeClient({ createError: new MeshyError('400', 'requete', 400) })
    await expect(step(store, refused.client)).rejects.toThrow('400')
    expect(store.read('anim-bib-0')).toMatchObject({ status: 'echoue', credits: 0 })
    const retry = fakeClient()
    expect((await step(store, retry.client)).outcome).toBe('paye')
  })

  it('une tâche FAILED (crédits rendus) est consignée à 0 et recréée à la relance', async () => {
    const store = newStore()
    const failed = fakeClient({ waitError: new MeshyError('tâche task-1 FAILED', 'tache') })
    await expect(step(store, failed.client)).rejects.toThrow(/FAILED/)
    expect(store.read('anim-bib-0')).toMatchObject({ status: 'echoue', credits: 0, taskId: 'task-1' })
    const retry = fakeClient()
    expect((await step(store, retry.client)).outcome).toBe('paye')
    expect(retry.n.create).toBe(1)
  })
})

describe('étapes locales', () => {
  it('ne refont rien si l’empreinte et les fichiers sont intacts, refont sinon', async () => {
    const store = newStore()
    let runs = 0
    const local = (inputs: unknown) =>
      runLocalStep({
        store,
        key: 'assemblage',
        inputs,
        force: false,
        now: () => new Date(),
        produce: async () => {
          runs++
          return { outputs: { out: store.put('public/models/essai.glb', `v${runs}`) } }
        },
      })
    expect((await local({ a: 1 })).outcome).toBe('local')
    expect((await local({ a: 1 })).outcome).toBe('cache')
    expect(runs).toBe(1)
    expect((await local({ a: 2 })).outcome).toBe('local')
    store.put('public/models/essai.glb', 'altéré')
    expect((await local({ a: 2 })).outcome).toBe('local')
    expect(runs).toBe(3)
  })
})
