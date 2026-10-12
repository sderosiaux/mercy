// Cache par empreinte : chaque appel à un service (tâche Meshy, planche GPT Image) ou étape locale laisse un
// enregistrement (art/forge/<id>/etapes/<clé>.json) avec son empreinte, son id de tâche, ses crédits et l'empreinte
// de chaque fichier produit. Une étape dont l'empreinte n'a pas changé et dont les fichiers sont intacts ne
// rappelle rien. Une tâche Meshy déjà créée n'est jamais recréée : on reprend son attente, ou on retélécharge ses
// fichiers (lecture gratuite) s'ils ont disparu du disque.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fingerprint, sha256 } from './fingerprint'
import {
  CreateUncertainError,
  type MeshyClient,
  MeshyError,
  type MeshyTask,
  WaitTimeoutError,
} from './meshy/client'
import type { MeshyEndpoint, MeshyRequest } from './meshy/requests'

export type RecordStatus = 'cree' | 'reussi' | 'echoue' | 'incertain'

export interface OutputRef {
  readonly file: string // relatif à la racine du dépôt
  readonly sha256: string
}

export interface StageRecord {
  readonly key: string
  readonly fingerprint: string
  readonly status: RecordStatus
  readonly endpoint?: MeshyEndpoint
  readonly taskId?: string
  readonly estimatedCredits?: number
  readonly credits?: number | null // null : service qui ne rapporte pas son coût
  readonly outputs: Readonly<Record<string, OutputRef>>
  readonly meta?: Readonly<Record<string, unknown>>
  readonly updatedAt: string
}

export type StepOutcome = 'cache' | 'repris' | 'paye' | 'retelecharge' | 'local'

export interface StepResult {
  readonly record: StageRecord
  readonly outcome: StepOutcome
}

export interface ForgeStore {
  readonly root: string // racine du dépôt
  readonly assetId: string
  read(key: string): StageRecord | null
  list(): StageRecord[]
  write(record: StageRecord): void
  put(file: string, data: Uint8Array | string): OutputRef
  get(file: string): Uint8Array
  intact(record: StageRecord): boolean
  ledger(entry: Readonly<Record<string, unknown>>): void
  readLedger(): Readonly<Record<string, unknown>>[]
}

// Crédits Meshy réellement consommés (consumed_credits des tâches réussies), d'après le registre des coûts :
// il garde aussi les tâches dont l'enregistrement a été remplacé par une nouvelle empreinte.
export const spentCredits = (store: ForgeStore): { total: number; parCle: Record<string, number> } => {
  const parCle: Record<string, number> = {}
  let total = 0
  for (const e of store.readLedger()) {
    if (e.event !== 'reussi' || typeof e.credits !== 'number') continue
    const key = String(e.key)
    parCle[key] = (parCle[key] ?? 0) + e.credits
    total += e.credits
  }
  return { total, parCle }
}

export const cacheDirOf = (root: string, assetId: string): string =>
  join(root, 'art', 'forge', '.cache', assetId)

export const createStore = (
  root: string,
  assetId: string,
  now: () => Date = () => new Date(),
): ForgeStore => {
  // Enregistrements et registre des coûts : petits, versionnés avec la fiche (art/forge/<id>/etapes, couts.jsonl).
  // Un clone neuf sait ainsi quelles tâches existent déjà et ne repaie pas : il relit ou retélécharge.
  // Les gros binaires restent dans le cache ignoré par git (cacheDirOf).
  const dir = join(root, 'art', 'forge', assetId, 'etapes')
  const ledgerPath = join(root, 'art', 'forge', assetId, 'couts.jsonl')
  const recordPath = (key: string): string => join(dir, `${key}.json`)
  const abs = (file: string): string => join(root, file)
  return {
    root,
    assetId,
    read: (key) => {
      const p = recordPath(key)
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as StageRecord) : null
    },
    list: () =>
      existsSync(dir)
        ? readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as StageRecord)
        : [],
    write: (record) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(recordPath(record.key), `${JSON.stringify(record, null, 2)}\n`)
    },
    put: (file, data) => {
      mkdirSync(dirname(abs(file)), { recursive: true })
      writeFileSync(abs(file), data)
      return { file, sha256: sha256(typeof data === 'string' ? data : data) }
    },
    get: (file) => new Uint8Array(readFileSync(abs(file))),
    intact: (record) =>
      Object.values(record.outputs).every(
        (o) => existsSync(abs(o.file)) && sha256(readFileSync(abs(o.file))) === o.sha256,
      ),
    ledger: (entry) => {
      mkdirSync(dirname(ledgerPath), { recursive: true })
      appendFileSync(ledgerPath, `${JSON.stringify({ at: now().toISOString(), ...entry })}\n`)
    },
    readLedger: () => {
      if (!existsSync(ledgerPath)) return []
      return readFileSync(ledgerPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    },
  }
}

export const cacheFile = (assetId: string, name: string): string =>
  join('art', 'forge', '.cache', assetId, 'files', name)

export interface MeshyStepOptions {
  readonly store: ForgeStore
  readonly client: MeshyClient
  readonly key: string
  readonly request: MeshyRequest
  readonly force: boolean
  readonly now: () => Date
  // Télécharge et range les fichiers d'une tâche réussie ; renvoie les sorties à enregistrer.
  readonly collect: (task: MeshyTask) => Promise<Readonly<Record<string, OutputRef>>>
}

const stamp = (now: () => Date): string => now().toISOString()

export const stepFingerprint = (request: MeshyRequest): string =>
  fingerprint({ endpoint: request.endpoint, descriptor: request.descriptor })

export const runMeshyStep = async (o: MeshyStepOptions): Promise<StepResult> => {
  const { store, client, key, request } = o
  const fp = stepFingerprint(request)
  const rec = store.read(key)

  const finish = async (taskId: string, task: MeshyTask, outcome: StepOutcome): Promise<StepResult> => {
    const outputs = await o.collect(task)
    const credits = typeof task.consumed_credits === 'number' ? task.consumed_credits : null
    const record: StageRecord = {
      key,
      fingerprint: fp,
      status: 'reussi',
      endpoint: request.endpoint,
      taskId,
      estimatedCredits: request.estimatedCredits,
      credits,
      outputs,
      updatedAt: stamp(o.now),
    }
    store.write(record)
    if (outcome !== 'retelecharge') store.ledger({ key, taskId, event: 'reussi', credits })
    return { record, outcome }
  }

  const waitAndFinish = async (taskId: string, outcome: StepOutcome): Promise<StepResult> => {
    try {
      const task = await client.wait(request.endpoint, taskId)
      return await finish(taskId, task, outcome)
    } catch (e) {
      if (e instanceof MeshyError && e.kind === 'tache' && !(e instanceof WaitTimeoutError)) {
        store.write({
          key,
          fingerprint: fp,
          status: 'echoue',
          endpoint: request.endpoint,
          taskId,
          estimatedCredits: request.estimatedCredits,
          credits: 0, // FAILED : crédits rendus (doc Meshy)
          outputs: {},
          meta: { erreur: e.message },
          updatedAt: stamp(o.now),
        })
        store.ledger({ key, taskId, event: 'echoue', credits: 0, erreur: e.message })
      }
      throw e
    }
  }

  if (rec && rec.fingerprint === fp && !o.force) {
    if (rec.status === 'reussi' && store.intact(rec)) return { record: rec, outcome: 'cache' }
    if (rec.status === 'reussi' && rec.taskId) {
      const task = await client.get(request.endpoint, rec.taskId)
      if (task.status !== 'SUCCEEDED') throw new Error(`${key} : tâche ${rec.taskId} relue en ${task.status}`)
      return finish(rec.taskId, task, 'retelecharge')
    }
    if (rec.status === 'cree' && rec.taskId) return waitAndFinish(rec.taskId, 'repris')
    if (rec.status === 'incertain') {
      throw new Error(
        `${key} : la création précédente a peut-être réussi (tâche facturée, id inconnu). Vérifier la liste des tâches ` +
          `Meshy (${request.endpoint}) ; relancer avec --force pour recréer`,
      )
    }
  }

  // Avant d'envoyer : un enregistrement « incertain » survit à un arrêt brutal pendant la requête.
  store.write({
    key,
    fingerprint: fp,
    status: 'incertain',
    endpoint: request.endpoint,
    estimatedCredits: request.estimatedCredits,
    outputs: {},
    updatedAt: stamp(o.now),
  })
  let taskId: string
  try {
    taskId = await client.create(request.endpoint, request.body)
  } catch (e) {
    if (!(e instanceof CreateUncertainError)) {
      // 4xx : aucune tâche créée, rien n'a été facturé.
      store.write({
        key,
        fingerprint: fp,
        status: 'echoue',
        endpoint: request.endpoint,
        estimatedCredits: request.estimatedCredits,
        credits: 0,
        outputs: {},
        meta: { erreur: e instanceof Error ? e.message : String(e) },
        updatedAt: stamp(o.now),
      })
    }
    throw e
  }
  store.write({
    key,
    fingerprint: fp,
    status: 'cree',
    endpoint: request.endpoint,
    taskId,
    estimatedCredits: request.estimatedCredits,
    outputs: {},
    updatedAt: stamp(o.now),
  })
  store.ledger({ key, taskId, event: 'cree', estimatedCredits: request.estimatedCredits })
  return waitAndFinish(taskId, 'paye')
}

export interface LocalStepOptions {
  readonly store: ForgeStore
  readonly key: string
  readonly inputs: unknown // tout ce dont dépend la sortie
  readonly force: boolean
  readonly now: () => Date
  readonly paid?: boolean // appel à un service payant (GPT Image) : consigné au registre des coûts
  readonly produce: () => Promise<{
    readonly outputs: Readonly<Record<string, OutputRef>>
    readonly meta?: Readonly<Record<string, unknown>>
  }>
}

export const runLocalStep = async (o: LocalStepOptions): Promise<StepResult> => {
  const fp = fingerprint(o.inputs)
  const rec = o.store.read(o.key)
  if (rec && rec.fingerprint === fp && rec.status === 'reussi' && !o.force && o.store.intact(rec)) {
    return { record: rec, outcome: 'cache' }
  }
  const { outputs, meta } = await o.produce()
  const record: StageRecord = {
    key: o.key,
    fingerprint: fp,
    status: 'reussi',
    credits: o.paid ? null : 0,
    outputs,
    ...(meta ? { meta } : {}),
    updatedAt: stamp(o.now),
  }
  o.store.write(record)
  if (o.paid)
    o.store.ledger({ key: o.key, event: 'reussi', credits: null, note: 'coût non rapporté par le service' })
  return { record, outcome: o.paid ? 'paye' : 'local' }
}
