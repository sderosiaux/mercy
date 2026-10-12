// Assemblage local : un seul GLB par personnage (public/models/<id>.glb), un clip par état de la fiche, nommé
// par l'état, étiqueté (extras.mercy : type, boucle, repère d'impact). Le repère d'une attaque est celui de la
// fiche s'il est posé, sinon le pic d'allonge mesuré de son effecteur.
import { runLocalStep, type StageRecord } from '../cache'
import { type Glb, parseGlb, writeGlb } from '../gltf/glb'
import { appendAnimation, type ClipTag, retagAnimations, stripRootDrift } from '../gltf/merge'
import { type ClipSpec, producedClips } from '../schema'
import { measuredImpact } from '../validate/checks'
import { loadRig } from '../validate/rig'
import { type ForgeContext, line, modelFile, type StepLine } from './context'
import { updateManifest } from './manifest'
import { libraryKeys } from './meshy'

export const ASSEMBLY_VERSION = 1

const tag = (spec: ClipSpec, impactS?: number): ClipTag => ({
  name: spec.etat,
  extras: {
    mercy: {
      etat: spec.etat,
      type: spec.type,
      boucle: spec.boucle,
      ...(impactS !== undefined ? { impactS } : {}),
      ...(spec.debutS !== undefined ? { debutS: spec.debutS } : {}),
    },
  },
})

// Noms des clips dans un fichier à plusieurs actions : le nom de bibliothèque, suffixé de l'id quand deux actions
// du même paquet ont le même nom (doc Animation API).
const libraryNames = (specs: readonly ClipSpec[], ids: readonly number[]): Map<string, ClipSpec> => {
  const out = new Map<string, ClipSpec>()
  for (const id of ids) {
    const spec = specs.find((s) => s.source.kind === 'bibliotheque' && s.source.actionId === id)
    if (spec?.source.kind !== 'bibliotheque') continue
    const name = out.has(spec.source.nom) ? `${spec.source.nom}_${id}` : spec.source.nom
    out.set(name, spec)
  }
  return out
}

export interface AssembleInputs {
  readonly rig: StageRecord
  readonly bibliotheque: readonly StageRecord[]
  readonly applications: ReadonlyMap<string, StageRecord>
}

export const assembleClips = (ctx: ForgeContext, inputs: AssembleInputs): Glb => {
  const specs = producedClips(ctx.sheet)
  const glbOf = (r: StageRecord): Glb => parseGlb(ctx.store.get(r.outputs.glb?.file as string))
  const chunks = libraryKeys(ctx)
  let base: Glb | null = null
  inputs.bibliotheque.forEach((rec, i) => {
    const names = libraryNames(specs, chunks[i]?.ids ?? [])
    const src = glbOf(rec)
    const found = new Set((src.json.animations ?? []).map((a) => a.name ?? ''))
    const missing = [...names.keys()].filter((n) => !found.has(n))
    if (missing.length > 0) {
      throw new Error(
        `clips ${missing.join(', ')} absents de ${rec.key} (présents : ${[...found].join(', ')})`,
      )
    }
    if (base === null)
      base = retagAnimations(src, (name) => (names.has(name) ? tag(names.get(name) as ClipSpec) : null))
    else {
      ;(src.json.animations ?? []).forEach((a, j) => {
        const spec = names.get(a.name ?? '')
        if (spec && base) base = appendAnimation(base, src, j, tag(spec))
      })
    }
  })
  let out: Glb = base ?? retagAnimations(glbOf(inputs.rig), () => null)
  for (const spec of specs) {
    if (spec.source.kind !== 'mouvement') continue
    const rec = inputs.applications.get(spec.etat)
    if (!rec) throw new Error(`mouvement ${spec.etat} non appliqué`)
    out = appendAnimation(out, glbOf(rec), 0, tag(spec))
  }
  const names = new Set((out.json.animations ?? []).map((a) => a.name))
  const absent = specs.filter((s) => !names.has(s.etat)).map((s) => s.etat)
  if (absent.length > 0) throw new Error(`assemblage incomplet : ${absent.join(', ')}`)
  return out
}

export const stripDrifts = (ctx: ForgeContext, glb: Glb): Glb =>
  producedClips(ctx.sheet)
    .filter((s) => s.retirerDerive)
    .reduce((g, s) => stripRootDrift(g, s.etat), glb)

// Pose les repères d'impact manquants, mesurés sur le modèle assemblé.
export const placeImpacts = async (ctx: ForgeContext, glb: Glb): Promise<Glb> => {
  const attacks = producedClips(ctx.sheet).filter((s) => s.type === 'attaque')
  if (attacks.length === 0) return glb
  const rig = await loadRig(glb, { hauteurM: ctx.sheet.hauteurM, stripTextures: true })
  const impacts = new Map<string, number>()
  for (const spec of attacks) {
    if (spec.impactS !== undefined) {
      impacts.set(spec.etat, spec.impactS)
      continue
    }
    const clip = rig.clips.find((c) => c.name === spec.etat)
    const at = clip ? measuredImpact(rig, ctx.sheet, spec, clip) : null
    if (at !== null) impacts.set(spec.etat, at)
  }
  const specs = producedClips(ctx.sheet)
  return retagAnimations(glb, (name) => {
    const spec = specs.find((s) => s.etat === name)
    return spec ? tag(spec, impacts.get(name)) : null
  })
}

export const runAssemble = async (ctx: ForgeContext, inputs: AssembleInputs): Promise<StepLine> => {
  const target = modelFile(ctx.sheet)
  const r = await runLocalStep({
    store: ctx.store,
    key: 'assemblage',
    inputs: {
      version: ASSEMBLY_VERSION,
      clips: producedClips(ctx.sheet),
      os: ctx.sheet.os ?? null,
      hauteurM: ctx.sheet.hauteurM,
      rig: inputs.rig.outputs.glb?.sha256,
      bibliotheque: inputs.bibliotheque.map((b) => b.outputs.glb?.sha256),
      applications: [...inputs.applications].map(([k, v]) => [k, v.outputs.glb?.sha256]),
    },
    force: ctx.force,
    now: ctx.now,
    produce: async () => {
      const glb = await placeImpacts(ctx, stripDrifts(ctx, assembleClips(ctx, inputs)))
      return { outputs: { glb: ctx.store.put(target, writeGlb(glb)) } }
    },
  })
  updateManifest(ctx, { glb: r.record.outputs.glb?.sha256 ?? null })
  return line(r.record, r.outcome)
}
