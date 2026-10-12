// Panneau de dev (DOM). Couleurs : uniquement les variables CSS de src/render/palette.ts (cssVariables), celles du
// HUD. Deux modes : libre (vague ou scène, graine, variante, politique, redémarrer, pause, pas, export) et aveugle
// (B4 §11, I7 : n'affiche que « Réglage 1 » ou « Réglage 2 », jamais la variante).
import { cssVariables } from '../render/palette'
import { variantOrDefault } from '../sim/index'
import { SCENE_IDS, WAVE_IDS } from '../sim/waves'
import { type BlindStep, blindSteps } from './blind'

export interface FreeStatus {
  readonly rang: number
  readonly tick: number
  readonly hash: string
  readonly finVague: number | null
  readonly politique: string | null
  readonly paused: boolean
  readonly driving: number | null
  readonly frames: {
    readonly n: number
    readonly p50: number | null
    readonly p95: number | null
    readonly max: number | null
  }
}

export interface BlindStatus {
  readonly testeur: number
  readonly step: BlindStep
  readonly etat: 'en cours' | 'vague finie' | 'hors délai (300 s)'
  readonly exporte: boolean
  readonly armeChangee: boolean
}

export interface PanelActions {
  restart(o: { wave: string; seed: number; variant: 'A' | 'B'; policy: string | null }): void
  togglePause(): void
  step(): void
  exportRun(): void
  startBlind(testeur: number): void
  blindRestart(): void
  blindNext(): void
  policies(): readonly string[]
}

export interface Panel {
  showFree(defaults: { wave: string; seed: number; variant: 'A' | 'B'; policy: string | null }): void
  showBlindReady(testeur: number | null): void
  showBlind(): void
  updateFree(s: FreeStatus): void
  updateBlind(s: BlindStatus): void
  error(msg: string | null): void
  toggle(): void
  readonly root: HTMLElement
  dispose(): void
}

const CSS = `
.mercy-dev { position: fixed; top: 12px; right: 12px; z-index: 20; width: 300px; box-sizing: border-box;
  padding: 10px 12px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--hud-encre); background: var(--hud-fond); border: 1px solid var(--hud-cadre); }
.mercy-dev[hidden] { display: none; }
.mercy-dev h2 { margin: 0 0 8px; font: inherit; letter-spacing: .12em; text-transform: uppercase; opacity: .8; }
.mercy-dev label { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 6px; margin: 4px 0; }
.mercy-dev input, .mercy-dev select { font: inherit; color: inherit; background: var(--hud-fond);
  border: 1px solid var(--hud-cadre); padding: 2px 4px; min-width: 0; }
.mercy-dev .row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
.mercy-dev button { font: inherit; color: inherit; background: none; border: 1px solid var(--hud-cadre);
  padding: 3px 8px; cursor: pointer; transition: opacity .15s; }
.mercy-dev button:hover { opacity: .7; }
.mercy-dev .status { white-space: pre-wrap; opacity: .85; margin-top: 6px; }
.mercy-dev .error { margin-top: 6px; font-style: italic; text-decoration: underline; }
.mercy-dev .error:empty { display: none; }
.mercy-dev hr { border: 0; border-top: 1px solid var(--hud-cadre); opacity: .4; margin: 10px 0; }
.mercy-dev .reglage { font: 28px/1.2 Georgia, serif; letter-spacing: .06em; margin: 6px 0 2px; }
.mercy-dev .hint { opacity: .6; }
`

const el = <K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const e = doc.createElement(tag)
  Object.assign(e, props)
  for (const c of children) e.append(c)
  return e
}

const fmt = (x: number | null): string => (x === null ? '–' : x.toFixed(1))

export const createPanel = (doc: Document, parent: HTMLElement, actions: PanelActions): Panel => {
  const style = el(doc, 'style', { textContent: CSS })
  const root = el(doc, 'div', { className: 'mercy-dev' })
  root.setAttribute('style', cssVariables())
  root.setAttribute('data-mercy-dev', '')
  // Les touches tapées dans le panneau ne vont pas au jeu (le clavier du jeu écoute la fenêtre et bloque WASD).
  const stop = (e: Event) => e.stopPropagation()
  root.addEventListener('keydown', stop)
  root.addEventListener('keyup', stop)
  const body = el(doc, 'div')
  const errorLine = el(doc, 'div', { className: 'error' })
  root.append(body, errorLine)
  parent.append(style, root)

  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = el(doc, 'button', { type: 'button', textContent: label })
    b.addEventListener('click', () => {
      b.blur() // Espace (Esquive) ne doit pas réactiver le bouton
      onClick()
    })
    return b
  }

  let freeStatus: HTMLElement | null = null
  let pauseButton: HTMLButtonElement | null = null
  let blindView: { reglage: HTMLElement; where: HTMLElement; status: HTMLElement } | null = null

  const showFree: Panel['showFree'] = (d) => {
    blindView = null
    const wave = el(doc, 'select')
    const groups: [string, readonly string[]][] = [
      ['Vagues', WAVE_IDS],
      ['Scènes de test', SCENE_IDS],
    ]
    for (const [label, ids] of groups) {
      const g = el(doc, 'optgroup', { label })
      for (const id of ids) g.append(el(doc, 'option', { value: id, textContent: id }))
      wave.append(g)
    }
    wave.value = d.wave
    const seed = el(doc, 'input', { type: 'number', min: '0', step: '1', value: String(d.seed) })
    const variant = el(doc, 'select')
    for (const v of ['A', 'B']) variant.append(el(doc, 'option', { value: v, textContent: v }))
    variant.value = d.variant
    const listId = 'mercy-dev-policies'
    const list = el(doc, 'datalist', { id: listId })
    for (const p of actions.policies()) list.append(el(doc, 'option', { value: p }))
    const policy = el(doc, 'input', { type: 'text', value: d.policy ?? '', placeholder: 'clavier et souris' })
    policy.setAttribute('list', listId)
    const testeur = el(doc, 'input', { type: 'number', min: '1', step: '1', value: '1' })
    pauseButton = button('Pause', () => actions.togglePause())
    freeStatus = el(doc, 'div', { className: 'status' })
    body.replaceChildren(
      el(doc, 'h2', {}, ['MERCY · dev']),
      el(doc, 'label', {}, ['Vague, scène', wave]),
      el(doc, 'label', {}, ['Graine', seed]),
      el(doc, 'label', {}, ['Variante', variant]),
      el(doc, 'label', {}, ['Politique', policy]),
      list,
      el(doc, 'div', { className: 'row' }, [
        button('Redémarrer', () =>
          actions.restart({
            wave: wave.value,
            seed: Number(seed.value),
            variant: variantOrDefault(variant.value),
            policy: policy.value.trim() === '' ? null : policy.value.trim(),
          }),
        ),
        pauseButton,
        button('+1 tick', () => actions.step()),
        button('Exporter la télémétrie', () => actions.exportRun()),
      ]),
      freeStatus,
      el(doc, 'hr'),
      el(doc, 'label', {}, ['Testeur n°', testeur]),
      el(doc, 'div', { className: 'row' }, [
        button('Mode aveugle…', () => actions.startBlind(Number(testeur.value))),
      ]),
      el(doc, 'div', { className: 'hint' }, ['² ou ` : masquer le panneau']),
    )
  }

  const showBlindReady: Panel['showBlindReady'] = (t) => {
    blindView = null
    freeStatus = null
    const testeur = el(doc, 'input', { type: 'number', min: '1', step: '1', value: String(t ?? 1) })
    body.replaceChildren(
      el(doc, 'h2', {}, ['Playtest à l’aveugle']),
      el(doc, 'label', {}, ['Testeur n°', testeur]),
      el(doc, 'div', { className: 'status' }, [
        'La correspondance entre réglages et variantes part dans un fichier séparé, à ouvrir après le codage des réponses.',
      ]),
      el(doc, 'div', { className: 'row' }, [
        button('Écrire la correspondance et commencer', () => actions.startBlind(Number(testeur.value))),
      ]),
    )
  }

  const showBlind: Panel['showBlind'] = () => {
    freeStatus = null
    const reglage = el(doc, 'div', { className: 'reglage' })
    const where = el(doc, 'div')
    const status = el(doc, 'div', { className: 'status' })
    blindView = { reglage, where, status }
    body.replaceChildren(
      el(doc, 'h2', {}, ['Playtest']),
      reglage,
      where,
      status,
      el(doc, 'div', { className: 'row' }, [
        button('Recommencer', () => actions.blindRestart()),
        button('Étape suivante', () => actions.blindNext()),
        button('Exporter', () => actions.exportRun()),
      ]),
    )
  }

  return {
    root,
    showFree,
    showBlindReady,
    showBlind,
    updateFree: (s) => {
      if (pauseButton) pauseButton.textContent = s.paused ? 'Reprendre' : 'Pause'
      if (!freeStatus) return
      freeStatus.textContent = [
        `partie ${s.rang} · tick ${s.tick}${s.finVague === null ? '' : ` · vague finie au tick ${s.finVague}`}`,
        `hash ${s.hash}`,
        `commandes : ${s.politique ?? 'clavier et souris'}${s.driving === null ? '' : ` · jusqu'au tick ${s.driving}`}`,
        `images (${s.frames.n}) p50 ${fmt(s.frames.p50)} · p95 ${fmt(s.frames.p95)} · max ${fmt(s.frames.max)} ms`,
      ].join('\n')
    },
    updateBlind: (s) => {
      if (!blindView) return
      blindView.reglage.textContent = s.step.etiquette
      const total = blindSteps(s.testeur).length - 1
      blindView.where.textContent =
        s.step.etape === 'echauffement'
          ? `Testeur ${s.testeur} · échauffement · ${s.step.vague}`
          : `Testeur ${s.testeur} · bloc ${s.step.bloc} · ${s.step.vague} · étape ${s.step.index}/${total}`
      blindView.status.textContent = [
        s.etat,
        s.exporte ? 'télémétrie exportée' : null,
        s.armeChangee ? 'arme changée : hors protocole (Couperet seul)' : null,
      ]
        .filter((x) => x !== null)
        .join(' · ')
    },
    error: (msg) => {
      errorLine.textContent = msg ?? ''
    },
    toggle: () => {
      root.hidden = !root.hidden
    },
    dispose: () => {
      root.remove()
      style.remove()
    },
  }
}
