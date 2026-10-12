// Client HTTP Meshy. Règles de la doc (llms-full.txt, « Instructions for Large Language Models ») suivies ici :
// - une création qui échoue en 4xx n'a créé aucune tâche ; en 5xx ou sur coupure réseau, elle a pu en créer une
//   (déjà facturée, pas de clé d'idempotence) : on ne la renvoie jamais seuls (CreateUncertainError) ;
// - on attend `Retry-After` entre deux lectures (5 s sinon), 429 et 5xx en lecture ne sont pas des échecs ;
// - on attend jusqu'à 60 min après `created_at` ; au-delà, on garde l'id et on reprendra plus tard ;
// - seul FAILED (crédits rendus) ou CANCELED est un échec de tâche ;
// - les fichiers expirent après 3 jours : on télécharge dès la réussite.
import { MESHY_BASE, type MeshyEndpoint } from './requests'

export type MeshyStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'

export interface MeshyTask {
  readonly id: string
  readonly status: MeshyStatus
  readonly progress?: number
  readonly created_at?: number
  readonly consumed_credits?: number
  readonly task_error?: { readonly message?: string } | null
  readonly model_urls?: Readonly<Record<string, string>>
  readonly result?: Readonly<Record<string, unknown>> | null
}

export type MeshyErrorKind =
  | 'requete'
  | 'auth'
  | 'credits'
  | 'moderation'
  | 'limite'
  | 'serveur'
  | 'reseau'
  | 'tache'

export class MeshyError extends Error {
  constructor(
    message: string,
    readonly kind: MeshyErrorKind,
    readonly status?: number,
  ) {
    super(message)
  }
}

// La création a peut-être eu lieu : ne pas recréer sans vérifier la liste des tâches (ou --force).
export class CreateUncertainError extends MeshyError {}

export class WaitTimeoutError extends MeshyError {
  constructor(
    readonly taskId: string,
    status: MeshyStatus,
  ) {
    super(
      `tâche ${taskId} encore ${status} après 60 min : relancer la commande reprendra cette tâche`,
      'tache',
    )
  }
}

export interface MeshyDeps {
  readonly apiKey: string
  readonly fetch: typeof fetch
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly base?: string
  readonly log?: (msg: string) => void
}

export interface LibraryEntry {
  readonly action_id: number
  readonly name: string
}

export interface MeshyClient {
  create(endpoint: MeshyEndpoint, body: Readonly<Record<string, unknown>>): Promise<string>
  get(endpoint: MeshyEndpoint, id: string): Promise<MeshyTask>
  wait(endpoint: MeshyEndpoint, id: string): Promise<MeshyTask>
  download(url: string): Promise<Uint8Array>
  library(actionIds: readonly number[]): Promise<readonly LibraryEntry[]>
  balance(): Promise<number>
}

export const DEFAULT_POLL_MS = 5000
export const MAX_WAIT_MS = 60 * 60 * 1000

const kindOf = (status: number): MeshyErrorKind =>
  status === 401
    ? 'auth'
    : status === 402
      ? 'credits'
      : status === 403
        ? 'moderation'
        : status === 429
          ? 'limite'
          : status >= 500
            ? 'serveur'
            : 'requete'

const retryAfterMs = (res: Response): number => {
  const h = res.headers.get('retry-after')
  const s = h === null ? Number.NaN : Number(h)
  return Number.isFinite(s) && s >= 0 ? s * 1000 : DEFAULT_POLL_MS
}

const errorText = async (res: Response): Promise<string> => {
  try {
    const t = await res.text()
    return t.slice(0, 300)
  } catch {
    return ''
  }
}

export const createMeshyClient = (deps: MeshyDeps): MeshyClient => {
  const base = deps.base ?? MESHY_BASE
  const auth = { Authorization: `Bearer ${deps.apiKey}` }
  const log = deps.log ?? (() => {})

  const create: MeshyClient['create'] = async (endpoint, body) => {
    let res: Response
    try {
      res = await deps.fetch(`${base}/${endpoint}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new CreateUncertainError(`POST ${endpoint} : coupure réseau (${String(e)})`, 'reseau')
    }
    if (res.status >= 500) {
      throw new CreateUncertainError(
        `POST ${endpoint} : ${res.status} ${await errorText(res)}`,
        'serveur',
        res.status,
      )
    }
    if (!res.ok) {
      throw new MeshyError(
        `POST ${endpoint} : ${res.status} ${await errorText(res)}`,
        kindOf(res.status),
        res.status,
      )
    }
    const json = (await res.json()) as { result?: unknown }
    if (typeof json.result !== 'string' || json.result === '') {
      throw new CreateUncertainError(`POST ${endpoint} : réponse sans id de tâche`, 'serveur', res.status)
    }
    return json.result
  }

  const getOnce = async (
    endpoint: MeshyEndpoint,
    id: string,
  ): Promise<{ task?: MeshyTask; waitMs: number }> => {
    let res: Response
    try {
      res = await deps.fetch(`${base}/${endpoint}/${id}`, { method: 'GET', headers: auth })
    } catch {
      return { waitMs: DEFAULT_POLL_MS }
    }
    if (res.status === 429 || res.status >= 500) return { waitMs: retryAfterMs(res) }
    if (!res.ok) {
      throw new MeshyError(
        `GET ${endpoint}/${id} : ${res.status} ${await errorText(res)}`,
        kindOf(res.status),
        res.status,
      )
    }
    return { task: (await res.json()) as MeshyTask, waitMs: retryAfterMs(res) }
  }

  const get: MeshyClient['get'] = async (endpoint, id) => {
    for (;;) {
      const r = await getOnce(endpoint, id)
      if (r.task) return r.task
      await deps.sleep(r.waitMs)
    }
  }

  const wait: MeshyClient['wait'] = async (endpoint, id) => {
    const started = deps.now()
    let deadline = started + MAX_WAIT_MS
    let lastStatus: MeshyStatus = 'PENDING'
    for (;;) {
      const r = await getOnce(endpoint, id)
      if (r.task) {
        const t = r.task
        lastStatus = t.status
        if (typeof t.created_at === 'number' && t.created_at > 0) deadline = t.created_at + MAX_WAIT_MS
        if (t.status === 'SUCCEEDED') return t
        if (t.status === 'FAILED' || t.status === 'CANCELED') {
          throw new MeshyError(`tâche ${id} ${t.status} : ${t.task_error?.message ?? ''}`, 'tache')
        }
        log(`${endpoint}/${id} ${t.status} ${t.progress ?? 0} %`)
      }
      if (deps.now() >= deadline) throw new WaitTimeoutError(id, lastStatus)
      await deps.sleep(r.waitMs)
    }
  }

  const download: MeshyClient['download'] = async (url) => {
    // URL signée de assets.meshy.ai : pas d'en-tête d'authentification.
    const res = await deps.fetch(url, { method: 'GET' })
    if (!res.ok)
      throw new MeshyError(
        `téléchargement ${res.status} : ${url.split('?')[0]}`,
        kindOf(res.status),
        res.status,
      )
    return new Uint8Array(await res.arrayBuffer())
  }

  const library: MeshyClient['library'] = async (actionIds) => {
    const q = actionIds.length > 0 ? `?action_ids=${actionIds.join(',')}` : ''
    const res = await deps.fetch(`${base}/animations/library${q}`, { method: 'GET', headers: auth })
    if (!res.ok)
      throw new MeshyError(`GET animations/library : ${res.status}`, kindOf(res.status), res.status)
    return (await res.json()) as LibraryEntry[]
  }

  const balance: MeshyClient['balance'] = async () => {
    const res = await deps.fetch(`${base}/balance`, { method: 'GET', headers: auth })
    if (!res.ok) throw new MeshyError(`GET balance : ${res.status}`, kindOf(res.status), res.status)
    const json = (await res.json()) as { balance?: unknown }
    if (typeof json.balance !== 'number')
      throw new MeshyError('GET balance : réponse sans balance', 'serveur')
    return json.balance
  }

  return { create, get, wait, download, library, balance }
}
