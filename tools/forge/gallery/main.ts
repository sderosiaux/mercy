// Galerie de la Forge (forge.html) : pour chaque personnage, sa fiche, sa planche de modèle à côté de la planche
// de référence, le modèle et chaque clip joués dans la lumière de la DA (tour du modèle ou caméra du jeu), et le
// rapport de validation. C'est ici que l'humain juge ce que les mesures ne disent pas.
import { type AnimationClip, Group, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bancFigure, bancSheet } from '../banc'
import { estimateAsset } from '../estimate'
import { writeGlb } from '../gltf/glb'
import type { ClipRecipe } from '../playback'
import { type AssetSheet, type ClipSpec, resolveTemps } from '../schema'
import { type CheckResult, type ValidationReport, validate } from '../validate/checks'
import { loadRig } from '../validate/rig'
import { type GalleryAsset, loadAssets } from './data'
import { type CameraMode, type LightMode, Viewer, type ViewerState } from './viewer'

type Child = Node | string | null | undefined | false
const h = (
  tag: string,
  attrs: Record<string, string | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElement => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v)
    else el.setAttribute(k, v)
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

const BANC = 'banc-essai'
const verdictClass = (v: string): string =>
  v === 'ok' || v === 'valide' ? 'ok' : v === 'echec' || v === 'refuse' ? 'echec' : 'nm'
const fmt = (x: number | undefined, unit?: string): string =>
  x === undefined
    ? ''
    : `${Math.abs(x) < 0.01 && x !== 0 ? x.toExponential(1) : Math.round(x * 1000) / 1000}${unit ? ` ${unit}` : ''}`

const sourceLabel = (c: ClipSpec): string =>
  c.source.kind === 'bibliotheque'
    ? `Meshy #${c.source.actionId} ${c.source.nom}`
    : c.source.kind === 'mouvement'
      ? `Text to Motion ${c.source.dureeS} s (${c.source.mode}) : ${c.source.prompt}`
      : c.type === 'figee'
        ? 'aucune : pose figée'
        : 'aucune : procédural'

const tempsLabel = (sheet: AssetSheet, c: ClipSpec): string => {
  const t = resolveTemps(sheet, c)
  if (!t) return c.locomotion ? `foulée → ${c.locomotion.vitesse}` : ''
  const impact = t.impactTicks === null ? '' : `impact ${t.impactTicks} t · `
  return `${impact}fenêtre ${t.fenetreTicks} t (${t.origine})`
}

interface PageModel {
  readonly id: string
  readonly titre: string
  readonly sousTitre: string
  readonly sheet: AssetSheet
  readonly planche: string | null
  readonly reference: string | null
  readonly rapport: ValidationReport | null
  readonly credits: number | null
  readonly banner: string | null
  readonly load: (() => Promise<{ root: Object3D; clips: AnimationClip[] }>) | null
}

const bancPage = async (): Promise<PageModel> => {
  const sheet = bancSheet()
  const glb = bancFigure()
  const rig = await loadRig(glb, { hauteurM: sheet.hauteurM, stripTextures: false })
  const rapport = validate(sheet, glb, rig)
  const bytes = writeGlb(glb)
  return {
    id: BANC,
    titre: "Banc d'essai",
    sousTitre: 'figurine construite en code, validée dans cette page',
    sheet,
    planche: null,
    reference: null,
    rapport,
    credits: null,
    banner:
      "Ce n'est pas un asset du jeu : c'est la figurine des tests (tools/forge/gltf/build.ts). Elle montre la " +
      'recette de lecture, la caméra, la lumière et le rapport tels qu’ils s’appliqueront aux modèles Meshy.',
    load: async () => {
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(0) as ArrayBuffer, '')
      return { root: gltf.scene, clips: gltf.animations }
    },
  }
}

const assetPage = (a: GalleryAsset): PageModel | null => {
  if (!a.sheet) return null
  const glb = a.manifeste?.glb
  return {
    id: a.id,
    titre: a.sheet.nom,
    sousTitre: `${a.sheet.famille} · ${a.sheet.clips.length} états`,
    sheet: a.sheet,
    planche: a.planche,
    reference: a.reference,
    rapport: a.rapport,
    credits: a.manifeste?.credits.meshy ?? null,
    banner: null,
    load: glb
      ? async () => {
          const gltf = await new GLTFLoader().loadAsync(`/${glb}`)
          return { root: gltf.scene, clips: gltf.animations }
        }
      : null,
  }
}

// ---------------------------------------------------------------- composants

const stagePills = (a: GalleryAsset | null, p: PageModel): HTMLElement => {
  const pill = (cls: string, text: string) => h('span', { class: `pill ${cls}` }, text)
  const hasModel = p.load !== null
  return h(
    'div',
    { class: 'stages' },
    pill(
      p.planche || p.id === BANC ? 'ok' : 'prevu',
      `Planche ${p.planche ? 'faite' : p.id === BANC ? 'sans objet' : 'à faire'}`,
    ),
    pill(hasModel ? 'ok' : 'prevu', `Modèle ${hasModel ? 'présent' : 'à faire (Meshy)'}`),
    p.rapport
      ? pill(verdictClass(p.rapport.bilan.verdict), `Validation ${p.rapport.bilan.verdict}`)
      : pill('prevu', 'Validation à faire'),
    pill('', `Crédits Meshy ${p.credits ?? (a ? 0 : 'sans objet')}`),
  )
}

const boardsCard = (p: PageModel): HTMLElement =>
  h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', {}, 'Planches'),
      h('span', { class: 'hint' }, 'modèle (GPT Image) · référence (DA)'),
    ),
    h(
      'div',
      { class: 'card-body' },
      p.id === BANC
        ? h(
            'div',
            { class: 'empty' },
            'La figurine de banc n’a pas de planche : elle est construite en code.',
          )
        : h(
            'div',
            { class: 'boards' },
            h(
              'figure',
              {},
              p.planche
                ? h('img', { src: p.planche, alt: `planche de modèle de ${p.titre}` })
                : h(
                    'div',
                    { class: 'empty' },
                    'Pas encore de planche. ',
                    h('code', {}, `pnpm forge ${p.id} --stage concept`),
                  ),
              h('figcaption', {}, 'Planche de modèle : face, profil, dos, A-pose'),
            ),
            h(
              'figure',
              {},
              p.reference
                ? h('img', { src: p.reference, alt: 'planche de référence' })
                : h('div', { class: 'empty' }, 'Référence absente'),
              h(
                'figcaption',
                {},
                `Référence : ${p.sheet.reference.planche.split('/').pop()} (${p.sheet.reference.zone})`,
              ),
            ),
          ),
    ),
  )

const reportCard = (p: PageModel): HTMLElement => {
  const r = p.rapport
  const body = r
    ? h(
        'div',
        {},
        h(
          'div',
          { class: 'card-body' },
          h(
            'div',
            { class: 'stages', style: 'margin-left:0' },
            h('span', { class: 'pill ok' }, `${r.bilan.ok} ok`),
            h('span', { class: 'pill echec' }, `${r.bilan.echec} échec(s)`),
            h('span', { class: 'pill nm' }, `${r.bilan.nonMesurable} non mesurable(s)`),
            h(
              'span',
              { class: 'pill' },
              `${r.triangles} triangles · ${r.os} os · échelle ×${r.echelle.facteur}`,
            ),
          ),
        ),
        h(
          'div',
          { class: 'scroll' },
          h(
            'table',
            {},
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                ...['Contrôle', 'Clip', 'Verdict', 'Mesure', 'Seuil', 'Détail'].map((t) => h('th', {}, t)),
              ),
            ),
            h(
              'tbody',
              {},
              ...r.controles.map((c: CheckResult) =>
                h(
                  'tr',
                  {},
                  h('td', {}, c.controle),
                  h('td', { class: 'mono' }, c.clip ?? ''),
                  h('td', {}, h('span', { class: `pill ${verdictClass(c.verdict)}` }, c.verdict)),
                  h('td', { class: 'mono' }, fmt(c.mesure, c.unite)),
                  h('td', { class: 'mono' }, fmt(c.seuil, c.unite)),
                  h('td', { class: 'note' }, c.detail),
                ),
              ),
            ),
          ),
        ),
      )
    : h(
        'div',
        { class: 'card-body' },
        h(
          'div',
          { class: 'empty' },
          'Pas de rapport : la validation mesure le GLB produit par l’étape anim. ',
          h('code', {}, `pnpm forge ${p.id} --stage validate`),
        ),
      )
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', {}, 'Validation'),
      h('span', { class: 'hint' }, 'mesures, aucun avis'),
    ),
    body,
  )
}

const sheetCard = (p: PageModel): HTMLElement => {
  const s = p.sheet
  const est = estimateAsset(s)
  const kv = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)]
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', {}, 'Fiche'),
      h('span', { class: 'hint mono' }, `art/forge/${s.id}/asset.json`),
    ),
    h(
      'div',
      { class: 'card-body' },
      h(
        'dl',
        { class: 'kv' },
        ...kv('Hauteur', s.hauteurM === null ? 'en attente (requête F1)' : `${s.hauteurM} m`),
        ...kv(
          'Budgets',
          `${s.budgets.triangles === null ? 'triangles en attente' : `${s.budgets.triangles} triangles`} · ${s.budgets.texturePx === null ? 'texture en attente' : `texture ${s.budgets.texturePx} px`}${s.budgets.triangles === null || s.budgets.texturePx === null ? ' (requête F1)' : ''}`,
        ),
        ...kv(
          'Modèle Meshy',
          `${s.modele.source}, ${s.modele.aiModel}, ${s.modele.textureResolution}${s.modele.pbr ? ', PBR' : ''}, A-pose`,
        ),
        ...kv(
          'Interruption',
          s.interruption
            ? `réaction « ${s.interruption.reaction} »`
            : 'aucune (le joueur n’est pas interrompu)',
        ),
        ...kv(
          'Coût estimé',
          `${est.total} crédits (modèle ${est.model}, rig ${est.rig}, animations ${est.anim})`,
        ),
      ),
    ),
  )
}

const clipsCard = (
  p: PageModel,
  recipes: ReadonlyMap<string, ClipRecipe>,
  onPick: (etat: string) => void,
): HTMLElement => {
  const rows = p.sheet.clips.map((c) => {
    const rec = recipes.get(c.etat)
    const tr = h(
      'tr',
      { class: rec ? 'clickable' : '', 'data-etat': c.etat },
      h('td', { class: 'mono' }, c.etat),
      h('td', {}, c.type),
      h('td', { class: 'note' }, sourceLabel(c)),
      h('td', {}, c.boucle ? 'oui' : ''),
      h('td', { class: 'mono' }, tempsLabel(p.sheet, c)),
      h(
        'td',
        { class: 'mono' },
        rec ? `×${fmt(rec.rate)}${rec.startS ? ` dès ${fmt(rec.startS)} s` : ''}` : '',
      ),
      h('td', { class: 'note' }, c.note),
    )
    if (rec) tr.addEventListener('click', () => onPick(c.etat))
    return tr
  })
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', {}, 'États et clips'),
      h('span', { class: 'hint' }, 'cliquer un clip produit pour le jouer'),
    ),
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...['État', 'Type', 'Source', 'Boucle', 'Temps de la simulation', 'Recette', 'Règle servie'].map(
              (t) => h('th', {}, t),
            ),
          ),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
  )
}

// ---------------------------------------------------------------- page

let viewer: Viewer | null = null

// Liens profonds (pour l'humain et les captures) : #<id>?cam=jeu&light=neutre&clip=<état>
const renderPage = async (
  main: HTMLElement,
  a: GalleryAsset | null,
  p: PageModel,
  q: URLSearchParams,
): Promise<void> => {
  viewer?.dispose()
  viewer = null
  main.replaceChildren()
  const recipes = new Map<string, ClipRecipe>((p.rapport?.clips ?? []).map((c) => [c.etat, c.recette]))

  const stage = h('div', { class: 'stage' }, h('div', { class: 'vignette' }), h('div', { class: 'grain' }))
  const label = h('div', { class: 'stage-label' })
  stage.append(label)
  const timeHead = h('div', { class: 'head' })
  const timeImpact = h('div', { class: 'impact' })
  const timeline = h('div', { class: 'timeline' }, timeImpact, timeHead)
  const timeText = h('div', { class: 'time' })
  const hitBtn = h('button', { class: 'btn', type: 'button' }, 'Frapper') as HTMLButtonElement
  const dieBtn = h('button', { class: 'btn warn', type: 'button' }, 'Mourir') as HTMLButtonElement
  const replayBtn = h('button', { class: 'btn', type: 'button' }, 'Rejouer') as HTMLButtonElement
  const fullBtn = h('button', { class: 'btn', type: 'button' }, 'Plein écran') as HTMLButtonElement
  let camMode: CameraMode = q.get('cam') === 'jeu' ? 'jeu' : 'tour'
  let lightMode: LightMode = q.get('light') === 'neutre' ? 'neutre' : 'da'
  let current: string | null = null
  const seg = <T extends string>(
    options: [T, string][],
    initial: T,
    onChange: (v: T) => void,
  ): HTMLElement => {
    const el = h('div', { class: 'seg' })
    for (const [v, text] of options) {
      const b = h('button', { type: 'button', class: v === initial ? 'on' : '' }, text)
      b.addEventListener('click', () => {
        for (const x of el.children) x.classList.remove('on')
        b.classList.add('on')
        onChange(v)
      })
      el.append(b)
    }
    return el
  }
  const updateLabel = (): void => {
    label.textContent = `${camMode === 'jeu' ? 'caméra du jeu (§20)' : 'tour du modèle'} · ${lightMode === 'da' ? 'lumière de la DA' : 'lumière neutre (B2)'}${current ? ` · ${current}` : ''}`
  }
  const controls = h(
    'div',
    { class: 'controls' },
    seg<CameraMode>(
      [
        ['tour', 'Tour du modèle'],
        ['jeu', 'Caméra du jeu §20'],
      ],
      camMode,
      (v) => {
        camMode = v
        viewer?.setCamera(v)
        updateLabel()
      },
    ),
    seg<LightMode>(
      [
        ['da', 'Lumière DA'],
        ['neutre', 'Neutre'],
      ],
      lightMode,
      (v) => {
        lightMode = v
        viewer?.setLight(v)
        updateLabel()
      },
    ),
    replayBtn,
    hitBtn,
    dieBtn,
    timeline,
    timeText,
    fullBtn,
  )
  fullBtn.addEventListener('click', () => void stage.requestFullscreen?.())

  const head = h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h1', {}, p.titre), h('div', { class: 'sub' }, p.sousTitre)),
    stagePills(a, p),
  )
  const left = h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', {}, 'Scène'),
        h('span', { class: 'hint' }, 'lecture à 60 i/s, recette de la validation'),
      ),
      stage,
      controls,
    ),
    clipsCard(p, recipes, (etat) => {
      current = etat
      viewer?.play(etat)
      updateLabel()
      for (const tr of main.querySelectorAll('tr[data-etat]'))
        tr.classList.toggle('current', tr.getAttribute('data-etat') === etat)
    }),
  )
  const right = h('div', {}, boardsCard(p), sheetCard(p))
  const report = reportCard(p)
  report.classList.add('wide')
  main.append(
    ...(p.banner ? [head, h('div', { class: 'banner' }, p.banner)] : [head]),
    h('div', { class: 'grid' }, left, right),
    report,
  )
  updateLabel()

  if (!p.load) {
    stage.append(
      h(
        'div',
        { class: 'stage-empty' },
        h(
          'div',
          {},
          h('strong', {}, 'Pas encore de modèle'),
          h(
            'p',
            {},
            'Étape suivante : le modèle Meshy (clé MESHY_API_KEY), puis rig, animations et validation.',
          ),
          h('p', {}, h('code', {}, `pnpm forge ${p.id} --stage all`)),
          h(
            'p',
            {},
            p.sheet.hauteurM === null
              ? 'Bloquants connus : hauteur et budgets de la fiche, en attente (requête F1).'
              : '',
          ),
        ),
      ),
    )
    for (const b of [hitBtn, dieBtn, replayBtn]) b.disabled = true
    return
  }
  viewer = new Viewer(stage)
  viewer.setCamera(camMode)
  viewer.setLight(lightMode)
  const { root, clips } = await p.load()
  const group = new Group()
  group.add(root)
  viewer.setModel({
    root: group,
    clips,
    hauteurM: p.sheet.hauteurM,
    recipes,
    reaction: p.sheet.interruption?.reaction ?? null,
  })
  const asked = q.get('clip')
  const first =
    (asked && clips.some((c) => c.name === asked) ? asked : null) ??
    p.sheet.clips.find((c) => recipes.has(c.etat))?.etat ??
    clips[0]?.name ??
    null
  const playFirst = (etat: string | null) => {
    if (!etat) return
    current = etat
    viewer?.play(etat)
    updateLabel()
    for (const tr of main.querySelectorAll('tr[data-etat]'))
      tr.classList.toggle('current', tr.getAttribute('data-etat') === etat)
  }
  playFirst(first)
  replayBtn.addEventListener('click', () => playFirst(current))
  hitBtn.disabled = !p.sheet.interruption
  hitBtn.addEventListener('click', () => {
    if (viewer?.hit()) {
      current = p.sheet.interruption?.reaction ?? current
      updateLabel()
    }
  })
  dieBtn.addEventListener('click', () => viewer?.die())
  viewer.onState((s: ViewerState) => {
    const d = Math.max(s.duration, 1e-6)
    timeHead.style.left = `${Math.min(100, (s.time / d) * 100)}%`
    timeImpact.style.display = s.impactS === null ? 'none' : 'block'
    if (s.impactS !== null) timeImpact.style.left = `${(s.impactS / d) * 100}%`
    timeText.textContent = `${s.time.toFixed(2)} / ${s.duration.toFixed(2)} s${s.frozen ? ' · figé' : ''}`
  })
  // Pour les captures : un drapeau quand la scène est prête.
  ;(window as unknown as { __forgeReady?: string }).__forgeReady = p.id
}

const nav = (assets: readonly GalleryAsset[], active: string): HTMLElement => {
  const item = (id: string, name: string, dots: string[], mark: string) =>
    h(
      'li',
      {},
      h(
        'a',
        { href: `#${id}`, class: id === active ? 'active' : '' },
        h('span', { class: 'nav-mark' }, mark),
        h('span', { class: 'nav-label' }, name),
        h('span', { class: 'nav-meta' }, ...dots.map((d) => h('span', { class: `dot ${d}` }))),
      ),
    )
  return h(
    'ul',
    { class: 'nav' },
    h('li', { class: 'nav-section' }, 'Personnages de P0'),
    ...assets.map((a) =>
      item(
        a.id,
        a.sheet?.nom ?? `${a.id} (fiche invalide)`,
        [
          a.planche ? 'ok' : '',
          a.manifeste?.glb ? 'ok' : '',
          a.rapport ? verdictClass(a.rapport.bilan.verdict) : '',
        ],
        (a.sheet?.nom.replace(/^L[ea]s? /, '') ?? a.id).slice(0, 2),
      ),
    ),
    h('li', { class: 'nav-section' }, 'Outils'),
    item(BANC, "Banc d'essai", ['ok', 'ok', 'ok'], 'Bn'),
  )
}

const boot = async (): Promise<void> => {
  const app = document.getElementById('forge') as HTMLElement
  const assets = await loadAssets()
  const side = h('aside', { class: 'side' })
  const main = h('main', { class: 'main' })
  app.replaceChildren(h('div', { class: 'app' }, side, main))
  const shell = app.firstElementChild as HTMLElement
  const route = async (): Promise<void> => {
    const [rawId, query] = location.hash.slice(1).split('?')
    const id = rawId || 'souriant'
    const toggle = h('button', { class: 'toggle', type: 'button', title: 'Replier la barre' }, '‹')
    toggle.addEventListener('click', () => shell.classList.toggle('collapsed'))
    side.replaceChildren(
      h(
        'div',
        { class: 'side-head' },
        h('div', { class: 'brand' }, 'La Forge', h('small', {}, 'MERCY · assets 3D')),
        toggle,
      ),
      nav(assets, id),
      h('div', { class: 'side-foot' }, 'Points : planche · modèle · validation'),
    )
    const a = assets.find((x) => x.id === id) ?? null
    const page = id === BANC ? await bancPage() : a ? assetPage(a) : null
    if (!page) {
      main.replaceChildren(
        h('div', { class: 'empty' }, a?.erreur ? `Fiche invalide : ${a.erreur}` : `Aucune fiche « ${id} ».`),
      )
      return
    }
    await renderPage(main, a, page, new URLSearchParams(query ?? ''))
  }
  window.addEventListener('hashchange', () => void route())
  await route()
}

void boot()
