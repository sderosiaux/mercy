import { describe, expect, it } from 'vitest'
import { CreateUncertainError, createMeshyClient, MAX_WAIT_MS, MeshyError, WaitTimeoutError } from './client'

interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body?: unknown
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const harness = (script: ((call: Call) => Response | Error)[]) => {
  const calls: Call[] = []
  const sleeps: number[] = []
  let clock = 1_000_000
  const fetch = (async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    }
    calls.push(call)
    const step = script.shift()
    if (!step) throw new Error(`appel inattendu ${url}`)
    const r = step(call)
    if (r instanceof Error) throw r
    return r
  }) as unknown as typeof globalThis.fetch
  const client = createMeshyClient({
    apiKey: 'msy_test',
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
  })
  return { client, calls, sleeps, advance: (ms: number) => (clock += ms) }
}

describe('client Meshy', () => {
  it('crée une tâche : POST JSON, jeton Bearer, renvoie l’id', async () => {
    const h = harness([() => json(200, { result: 'task-1' })])
    expect(await h.client.create('rigging', { input_task_id: 'm', height_meters: 1.8 })).toBe('task-1')
    expect(h.calls[0]).toMatchObject({
      url: 'https://api.meshy.ai/openapi/v1/rigging',
      method: 'POST',
      headers: { Authorization: 'Bearer msy_test', 'Content-Type': 'application/json' },
      body: { input_task_id: 'm', height_meters: 1.8 },
    })
  })

  it('4xx à la création : aucune tâche créée, erreur typée', async () => {
    const h = harness([() => json(402, { message: 'no credits' })])
    const err = await h.client.create('rigging', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MeshyError)
    expect(err).not.toBeInstanceOf(CreateUncertainError)
    expect((err as MeshyError).kind).toBe('credits')
  })

  it('5xx ou coupure à la création : création incertaine, jamais renvoyée', async () => {
    const h = harness([() => json(503, {})])
    await expect(h.client.create('rigging', {})).rejects.toBeInstanceOf(CreateUncertainError)
    const h2 = harness([() => new TypeError('socket hang up')])
    await expect(h2.client.create('rigging', {})).rejects.toBeInstanceOf(CreateUncertainError)
    expect(h2.calls).toHaveLength(1)
  })

  it('attend la fin en respectant Retry-After, traverse 429 et 5xx, renvoie la tâche réussie', async () => {
    const h = harness([
      () =>
        json(200, { id: 't', status: 'PENDING', progress: 0, created_at: 1_000_000 }, { 'retry-after': '3' }),
      () => json(429, {}, { 'retry-after': '7' }),
      () => json(502, {}),
      () => new TypeError('reset'),
      () => json(200, { id: 't', status: 'IN_PROGRESS', progress: 50 }),
      () => json(200, { id: 't', status: 'SUCCEEDED', progress: 100, consumed_credits: 5 }),
    ])
    const task = await h.client.wait('rigging', 't')
    expect(task.consumed_credits).toBe(5)
    expect(h.sleeps).toEqual([3000, 7000, 5000, 5000, 5000])
    expect(h.calls.every((c) => c.method === 'GET' && c.url.endsWith('/rigging/t'))).toBe(true)
  })

  it('FAILED ou CANCELED : erreur de tâche avec son message', async () => {
    const h = harness([
      () => json(200, { id: 't', status: 'FAILED', task_error: { message: 'pose estimation failed' } }),
    ])
    await expect(h.client.wait('rigging', 't')).rejects.toThrow(/pose estimation failed/)
  })

  it('au-delà de 60 min après created_at : on garde l’id (WaitTimeoutError), sans recréer', async () => {
    const h = harness([
      () =>
        json(
          200,
          { id: 't', status: 'IN_PROGRESS', created_at: 1_000_000 - MAX_WAIT_MS + 1000 },
          { 'retry-after': '1' },
        ),
      () => json(200, { id: 't', status: 'IN_PROGRESS' }, { 'retry-after': '1' }),
    ])
    const err = await h.client.wait('rigging', 't').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WaitTimeoutError)
    expect((err as WaitTimeoutError).taskId).toBe('t')
    expect(h.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('télécharge un fichier signé sans en-tête d’authentification', async () => {
    const h = harness([() => new Response(Uint8Array.from([1, 2, 3]), { status: 200 })])
    expect([...(await h.client.download('https://assets.meshy.ai/x/model.glb?Expires=1'))]).toEqual([1, 2, 3])
    expect(h.calls[0]?.headers).toEqual({})
  })

  it('lit la bibliothèque d’animations filtrée par ids, et le solde', async () => {
    const h = harness([
      () => json(200, [{ action_id: 178, name: 'Hit_Reaction' }]),
      () => json(200, { balance: 420, monthly_credits: 400, permanent_credits: 20 }),
    ])
    expect(await h.client.library([178, 0])).toEqual([{ action_id: 178, name: 'Hit_Reaction' }])
    expect(h.calls[0]?.url).toBe('https://api.meshy.ai/openapi/v1/animations/library?action_ids=178,0')
    expect(await h.client.balance()).toBe(420)
  })
})
