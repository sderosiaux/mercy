// Fiche d'asset de la Forge (art/forge/<id>/asset.json) : type et vérification à l'exécution.
// Une fiche décrit un personnage de bout en bout : planche à demander à GPT Image, modèle Meshy, squelette, et la
// table « état ou action du jeu → clip ». Les temps viennent de la simulation (ActionDef des familles, TUNING) :
// une fiche ne porte jamais un chiffre de jeu en dur.
import { FAMILIES, type FamilyKind, TICK_HZ, TUNING } from '../../src/sim/index'
import librarySnapshot from './meshy/library-snapshot.json'

export type Famille = Exclude<FamilyKind, 'membre'> | 'bourreau'
export type Effecteur = 'tete' | 'mainDroite' | 'mainGauche' | 'piedDroit' | 'piedGauche'
export type ClipType =
  | 'boucle'
  | 'attaque'
  | 'canalisation'
  | 'reaction'
  | 'transition'
  | 'figee'
  | 'procedurale'
export type MotionMode = 'prime' | 'swift'

export type ClipSource =
  | { readonly kind: 'bibliotheque'; readonly actionId: number; readonly nom: string }
  | {
      readonly kind: 'mouvement'
      readonly prompt: string
      readonly dureeS: number
      readonly mode: MotionMode
    }
  | { readonly kind: 'aucune' }

// Temps d'un clip dans la simulation. `action` : l'ActionDef de la famille (télégraphe, récupération,
// canalisation) ; sinon des chemins dans TUNING, en ticks. `impact: 'debut'` : le coup part au tick de départ.
export type ClipTemps =
  | { readonly action: string }
  | { readonly impact?: string; readonly fenetre: readonly string[] }

export interface ClipSpec {
  readonly etat: string
  readonly type: ClipType
  readonly source: ClipSource
  readonly boucle: boolean
  readonly surPlace: boolean
  readonly locomotion?: { readonly vitesse: string }
  readonly temps?: ClipTemps
  readonly effecteur?: Effecteur
  readonly impactS?: number
  readonly debutS?: number
  // Retire la dérive horizontale du bassin (mouvement de racine) à l'assemblage : un mouvement généré qui avance
  // devient « sur place », la simulation déplace la créature. Le balancement est gardé, seule la tendance part.
  readonly retirerDerive?: boolean
  readonly note: string
}

export interface AssetSheet {
  readonly id: string
  readonly nom: string
  readonly famille: Famille
  // Hauteur de jeu en mètres. null : absente du spec et de TUNING, demandée (requête F1) ; l'étape rig attend.
  readonly hauteurM: number | null
  readonly reference: { readonly planche: string; readonly zone: string }
  readonly planche: {
    readonly prompt: string
    readonly taille: string
    readonly qualite: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto'
    readonly modele: 'sunburst' | 'flare'
  }
  readonly modele: {
    readonly source: 'multi-image' | 'image'
    readonly aiModel: 'meshy-6-lite' | 'meshy-6' | 'meshy-7.1' | 'latest'
    readonly textureResolution: '2k' | '4k' | '8k'
    readonly pbr: boolean
    readonly texturePrompt?: string
  }
  // null : budget absent du spec (§24 ne donne que des plafonds de scène), demandé (requête F1).
  readonly budgets: { readonly triangles: number | null; readonly texturePx: number | null }
  readonly squelette: 'humanoide'
  readonly os?: Readonly<Partial<Record<Effecteur, string>>>
  readonly interruption: { readonly reaction: string } | null
  readonly clips: readonly ClipSpec[]
}

export class SchemaError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`fiche invalide :\n- ${issues.join('\n- ')}`)
  }
}

const FAMILLES: readonly Famille[] = [
  'bourreau',
  'souriant',
  'recousu',
  'porteur',
  'confesseur',
  'chirurgien',
]
const EFFECTEURS: readonly Effecteur[] = ['tete', 'mainDroite', 'mainGauche', 'piedDroit', 'piedGauche']
const CLIP_TYPES: readonly ClipType[] = [
  'boucle',
  'attaque',
  'canalisation',
  'reaction',
  'transition',
  'figee',
  'procedurale',
]
const SANS_CLIP: ReadonlySet<ClipType> = new Set(['figee', 'procedurale'])
const JAMAIS_EN_BOUCLE: ReadonlySet<ClipType> = new Set(['attaque', 'reaction', 'transition'])

interface LibraryAction {
  readonly id: number
  readonly nom: string
}
const LIBRARY: ReadonlyMap<number, string> = new Map(
  (librarySnapshot.actions as readonly LibraryAction[]).map((a) => [a.id, a.nom]),
)
export const libraryName = (id: number): string | undefined => LIBRARY.get(id)

// Valeur numérique de TUNING à un chemin pointé (« souriant.speed », « weapons.couperet.period »).
export const tuningAt = (path: string): number | undefined => {
  let cur: unknown = TUNING
  for (const key of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(key in cur)) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : undefined
}

export interface ResolvedTemps {
  readonly impactTicks: number | null // null : pas d'impact (canalisation, transition)
  readonly fenetreTicks: number
  readonly origine: string
}

export const resolveTemps = (sheet: AssetSheet, clip: ClipSpec): ResolvedTemps | null => {
  const t = clip.temps
  if (!t) return null
  if ('action' in t) {
    const def = sheet.famille === 'bourreau' ? undefined : FAMILIES[sheet.famille]?.actions[t.action]
    if (!def) throw new Error(`${sheet.id}/${clip.etat} : action ${t.action} absente de la famille`)
    if (def.kind === 'canalisation') {
      return {
        impactTicks: null,
        fenetreTicks: def.channelTicks ?? 0,
        origine: `sim:${sheet.famille}.${t.action}`,
      }
    }
    return {
      impactTicks: def.telegraphTicks,
      fenetreTicks: def.telegraphTicks + def.recoverTicks,
      origine: `sim:${sheet.famille}.${t.action}`,
    }
  }
  const fenetre = t.fenetre.reduce((s, p) => s + (tuningAt(p) ?? Number.NaN), 0)
  const impact = t.impact === undefined ? null : t.impact === 'debut' ? 0 : (tuningAt(t.impact) ?? Number.NaN)
  const paths = [...(t.impact === undefined ? [] : [`impact ${t.impact}`]), ...t.fenetre]
  return { impactTicks: impact, fenetreTicks: fenetre, origine: `TUNING:${paths.join('+')}` }
}

export const ticksToS = (ticks: number): number => ticks / TICK_HZ

// Clips à produire (ni figés ni procéduraux), dans l'ordre de la fiche.
export const producedClips = (sheet: AssetSheet): readonly ClipSpec[] =>
  sheet.clips.filter((c) => c.source.kind !== 'aucune')

// ---------------------------------------------------------------- vérification

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

class Checker {
  readonly issues: string[] = []
  fail(path: string, msg: string): void {
    this.issues.push(`${path} : ${msg}`)
  }
  str(o: Obj, k: string, path: string, opts: { max?: number; re?: RegExp; optional?: boolean } = {}): string {
    const v = o[k]
    if (v === undefined && opts.optional) return ''
    if (typeof v !== 'string' || v.trim() === '') {
      this.fail(`${path}.${k}`, 'texte non vide attendu')
      return ''
    }
    if (opts.max !== undefined && v.length > opts.max)
      this.fail(`${path}.${k}`, `au plus ${opts.max} caractères`)
    if (opts.re && !opts.re.test(v)) this.fail(`${path}.${k}`, `forme attendue ${opts.re}`)
    return v
  }
  oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[], path: string): T {
    const v = o[k]
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.fail(`${path}.${k}`, `une valeur parmi ${allowed.join(', ')}`)
      return allowed[0] as T
    }
    return v as T
  }
  bool(o: Obj, k: string, path: string): boolean {
    if (typeof o[k] !== 'boolean') this.fail(`${path}.${k}`, 'booléen attendu')
    return o[k] === true
  }
  num(o: Obj, k: string, path: string, min: number, max: number, opts: { int?: boolean } = {}): number {
    const v = o[k]
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (opts.int && !Number.isInteger(v))
    ) {
      this.fail(`${path}.${k}`, `${opts.int ? 'entier' : 'nombre'} entre ${min} et ${max} attendu`)
      return min
    }
    return v
  }
  obj(o: Obj, k: string, path: string): Obj {
    const v = o[k]
    if (!isObj(v)) {
      this.fail(`${path}.${k}`, 'objet attendu')
      return {}
    }
    return v
  }
}

const ETAT_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/
const TAILLE_RE = /^(\d+)x(\d+)$/

const checkTaille = (c: Checker, taille: string, path: string): void => {
  const m = TAILLE_RE.exec(taille)
  if (!m) return
  const w = Number(m[1])
  const h = Number(m[2])
  if (w % 16 !== 0 || h % 16 !== 0) c.fail(path, 'largeur et hauteur divisibles par 16 (GPT Image)')
  if (w / h < 1 / 3 || w / h > 3) c.fail(path, 'rapport entre 1:3 et 3:1 (GPT Image)')
}

const checkSource = (c: Checker, clip: Obj, type: ClipType, path: string): ClipSource => {
  const s = c.obj(clip, 'source', path)
  const kind = c.oneOf(s, 'kind', ['bibliotheque', 'mouvement', 'aucune'] as const, `${path}.source`)
  if (SANS_CLIP.has(type) !== (kind === 'aucune')) {
    c.fail(`${path}.source.kind`, `un clip ${type} ${SANS_CLIP.has(type) ? 'n’a pas' : 'a'} de source`)
  }
  if (kind === 'bibliotheque') {
    const actionId = c.num(s, 'actionId', `${path}.source`, 0, 100000, { int: true })
    const nom = c.str(s, 'nom', `${path}.source`)
    const attendu = LIBRARY.get(actionId)
    if (attendu === undefined)
      c.fail(`${path}.source.actionId`, `${actionId} absent de la bibliothèque Meshy`)
    else if (attendu !== nom)
      c.fail(`${path}.source.nom`, `l’action ${actionId} s’appelle ${attendu}, pas ${nom}`)
    return { kind, actionId, nom }
  }
  if (kind === 'mouvement') {
    const prompt = c.str(s, 'prompt', `${path}.source`, { max: 400 })
    const dureeS = c.num(s, 'dureeS', `${path}.source`, 2, 10)
    if (!Number.isInteger(dureeS * 2)) c.fail(`${path}.source.dureeS`, 'par pas de 0,5 s (Text to Motion)')
    const mode = c.oneOf(s, 'mode', ['prime', 'swift'] as const, `${path}.source`)
    return { kind, prompt, dureeS, mode }
  }
  return { kind: 'aucune' }
}

const checkTuningPath = (c: Checker, p: unknown, path: string): string => {
  if (typeof p !== 'string' || tuningAt(p) === undefined) {
    c.fail(path, `chemin TUNING numérique attendu, reçu ${JSON.stringify(p)}`)
    return ''
  }
  return p
}

const checkTemps = (
  c: Checker,
  clip: Obj,
  famille: Famille,
  type: ClipType,
  path: string,
): ClipTemps | undefined => {
  if (clip.temps === undefined) {
    if (type === 'attaque') c.fail(`${path}.temps`, 'une attaque porte ses temps (action ou TUNING)')
    return undefined
  }
  const t = c.obj(clip, 'temps', path)
  if ('action' in t) {
    const action = c.str(t, 'action', `${path}.temps`)
    const def = famille === 'bourreau' ? undefined : FAMILIES[famille]?.actions[action]
    if (!def) c.fail(`${path}.temps.action`, `${action} n’est pas une action de la famille ${famille}`)
    else if (type === 'attaque' && def.kind !== 'attaque')
      c.fail(`${path}.temps.action`, `${action} n’est pas une attaque`)
    else if (type === 'canalisation' && def.kind !== 'canalisation') {
      c.fail(`${path}.temps.action`, `${action} n’est pas une canalisation`)
    }
    return { action }
  }
  const rawFenetre = t.fenetre
  if (!Array.isArray(rawFenetre) || rawFenetre.length === 0) {
    c.fail(`${path}.temps.fenetre`, 'liste non vide de chemins TUNING')
    return undefined
  }
  const fenetre = rawFenetre.map((p, i) => checkTuningPath(c, p, `${path}.temps.fenetre[${i}]`))
  let impact: string | undefined
  if (t.impact !== undefined)
    impact = t.impact === 'debut' ? 'debut' : checkTuningPath(c, t.impact, `${path}.temps.impact`)
  if (type === 'attaque' && impact === undefined)
    c.fail(`${path}.temps.impact`, 'une attaque porte son impact')
  return impact === undefined ? { fenetre } : { impact, fenetre }
}

const checkClip = (c: Checker, raw: unknown, famille: Famille, path: string): ClipSpec | null => {
  if (!isObj(raw)) {
    c.fail(path, 'objet attendu')
    return null
  }
  const etat = c.str(raw, 'etat', path, { re: ETAT_RE })
  const type = c.oneOf(raw, 'type', CLIP_TYPES, path)
  const source = checkSource(c, raw, type, path)
  const boucle = c.bool(raw, 'boucle', path)
  if (type === 'boucle' && !boucle) c.fail(`${path}.boucle`, 'un clip de type boucle boucle')
  if (JAMAIS_EN_BOUCLE.has(type) && boucle) c.fail(`${path}.boucle`, `un clip ${type} ne boucle pas`)
  const surPlace = c.bool(raw, 'surPlace', path)
  const note = c.str(raw, 'note', path)
  const out: {
    -readonly [K in keyof ClipSpec]: ClipSpec[K]
  } = { etat, type, source, boucle, surPlace, note }
  if (raw.locomotion !== undefined) {
    const l = c.obj(raw, 'locomotion', path)
    out.locomotion = { vitesse: checkTuningPath(c, l.vitesse, `${path}.locomotion.vitesse`) }
    if (surPlace) c.fail(`${path}.surPlace`, 'une locomotion avance : ses pieds ne restent pas plantés')
  }
  const temps = checkTemps(c, raw, famille, type, path)
  if (temps) out.temps = temps
  if (raw.effecteur !== undefined) out.effecteur = c.oneOf(raw, 'effecteur', EFFECTEURS, path)
  if (raw.impactS !== undefined) out.impactS = c.num(raw, 'impactS', path, 0.001, 60)
  if (raw.debutS !== undefined) out.debutS = c.num(raw, 'debutS', path, 0, 60)
  if (raw.retirerDerive !== undefined) out.retirerDerive = c.bool(raw, 'retirerDerive', path)
  if (type === 'attaque' && out.effecteur === undefined && out.impactS === undefined) {
    c.fail(path, 'une attaque nomme son effecteur (repère mesuré) ou son impactS (repère posé)')
  }
  return out
}

export const parseAsset = (raw: unknown): AssetSheet => {
  const c = new Checker()
  if (!isObj(raw)) throw new SchemaError(['la fiche doit être un objet JSON'])
  const id = c.str(raw, 'id', 'fiche', { re: /^[a-z][a-z0-9-]*$/ })
  const nom = c.str(raw, 'nom', 'fiche')
  const famille = c.oneOf(raw, 'famille', FAMILLES, 'fiche')
  const hauteurM = raw.hauteurM === null ? null : c.num(raw, 'hauteurM', 'fiche', 0.3, 12)

  const ref = c.obj(raw, 'reference', 'fiche')
  const reference = {
    planche: c.str(ref, 'planche', 'fiche.reference', { re: /^art\/concepts\/[^/]+\.png$/ }),
    zone: c.str(ref, 'zone', 'fiche.reference'),
  }

  const pl = c.obj(raw, 'planche', 'fiche')
  const taille = c.str(pl, 'taille', 'fiche.planche', { re: TAILLE_RE })
  checkTaille(c, taille, 'fiche.planche.taille')
  const planche = {
    prompt: c.str(pl, 'prompt', 'fiche.planche', { max: 1500 }),
    taille,
    qualite: c.oneOf(
      pl,
      'qualite',
      ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] as const,
      'fiche.planche',
    ),
    modele: c.oneOf(pl, 'modele', ['sunburst', 'flare'] as const, 'fiche.planche'),
  }

  const mo = c.obj(raw, 'modele', 'fiche')
  const modele: { -readonly [K in keyof AssetSheet['modele']]: AssetSheet['modele'][K] } = {
    source: c.oneOf(mo, 'source', ['multi-image', 'image'] as const, 'fiche.modele'),
    aiModel: c.oneOf(
      mo,
      'aiModel',
      ['meshy-6-lite', 'meshy-6', 'meshy-7.1', 'latest'] as const,
      'fiche.modele',
    ),
    textureResolution: c.oneOf(mo, 'textureResolution', ['2k', '4k', '8k'] as const, 'fiche.modele'),
    pbr: c.bool(mo, 'pbr', 'fiche.modele'),
  }
  if (mo.texturePrompt !== undefined)
    modele.texturePrompt = c.str(mo, 'texturePrompt', 'fiche.modele', { max: 800 })

  const bu = c.obj(raw, 'budgets', 'fiche')
  const budgets = {
    triangles:
      bu.triangles === null ? null : c.num(bu, 'triangles', 'fiche.budgets', 100, 300000, { int: true }),
    texturePx:
      bu.texturePx === null ? null : c.num(bu, 'texturePx', 'fiche.budgets', 64, 8192, { int: true }),
  }
  const squelette = c.oneOf(raw, 'squelette', ['humanoide'] as const, 'fiche')

  let os: Partial<Record<Effecteur, string>> | undefined
  if (raw.os !== undefined) {
    const o = c.obj(raw, 'os', 'fiche')
    os = {}
    for (const [k, v] of Object.entries(o)) {
      if (!(EFFECTEURS as readonly string[]).includes(k))
        c.fail(`fiche.os.${k}`, `clé parmi ${EFFECTEURS.join(', ')}`)
      else if (typeof v !== 'string' || v === '') c.fail(`fiche.os.${k}`, 'nom d’os attendu')
      else os[k as Effecteur] = v
    }
  }

  const rawClips = raw.clips
  const clips: ClipSpec[] = []
  if (!Array.isArray(rawClips) || rawClips.length === 0) c.fail('fiche.clips', 'liste non vide attendue')
  else {
    rawClips.forEach((rc, i) => {
      const clip = checkClip(c, rc, famille, `fiche.clips[${i}]`)
      if (clip) clips.push(clip)
    })
  }
  const seen = new Set<string>()
  const actions = new Set<number>()
  for (const clip of clips) {
    if (seen.has(clip.etat)) c.fail('fiche.clips', `état ${clip.etat} en double`)
    seen.add(clip.etat)
    if (clip.source.kind === 'bibliotheque') {
      if (actions.has(clip.source.actionId)) {
        c.fail(
          'fiche.clips',
          `action ${clip.source.actionId} demandée deux fois (Meshy refuse les ids en double)`,
        )
      }
      actions.add(clip.source.actionId)
    }
  }

  let interruption: AssetSheet['interruption'] = null
  if (raw.interruption !== null) {
    const it = c.obj(raw, 'interruption', 'fiche')
    const reaction = c.str(it, 'reaction', 'fiche.interruption')
    const target = clips.find((k) => k.etat === reaction)
    if (!target) c.fail('fiche.interruption.reaction', `${reaction} n’est pas un état de la fiche`)
    else if (target.type !== 'reaction')
      c.fail('fiche.interruption.reaction', `${reaction} n’est pas un clip de réaction`)
    interruption = { reaction }
  }

  if (c.issues.length > 0) throw new SchemaError(c.issues)
  const sheet: AssetSheet = {
    id,
    nom,
    famille,
    hauteurM,
    reference,
    planche,
    modele,
    budgets,
    squelette,
    interruption,
    clips,
    ...(os ? { os } : {}),
  }
  return sheet
}
