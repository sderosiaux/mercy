// Visionneuse du test des 3 s (B2 §11, I7) : croix de fixation 1,0 s, capture avec marqueurs 3,0 s, écran noir,
// saisie des réponses, export JSON. Les captures et leurs sondes viennent d'un manifeste (fichiers choisis ou URL).
// L'horloge murale sert ici à mesurer l'exposition réelle, qui est consignée dans l'export.
import { cssVariables } from '../render/palette'
import {
  ANSWERS,
  type Answer,
  type Capture,
  CONSIGNE,
  captureOrder,
  EXPOSURE_MS,
  FIXATION_MS,
  MARKER,
  markerCenter,
  type Record_,
  type Session,
  tally,
} from './session'

const root = document.getElementById('viewer')
if (!root) throw new Error('#viewer absent')

const style = document.createElement('style')
style.textContent = `
:root { ${cssVariables()}; }
html, body { margin: 0; height: 100%; background: var(--ecran); color: var(--hud-encre); overflow: hidden;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
#viewer { position: fixed; inset: 0; display: grid; place-items: center; }
.panel { max-width: 62ch; line-height: 1.6; font-size: 16px; }
.panel h1 { font-weight: normal; font-size: 26px; margin: 0 0 12px; }
.panel label { display: block; margin: 14px 0 4px; font-style: italic; }
.panel input[type=number] { width: 6ch; font: inherit; background: var(--noir); color: var(--hud-encre);
  border: 1px solid var(--hud-cadre); padding: 4px 8px; }
.panel .warn { color: var(--rouge-vif); }
button { font: inherit; background: var(--noir); color: var(--hud-encre); border: 1px solid var(--hud-cadre);
  padding: 6px 14px; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--hud-encre); outline-offset: 2px; }
button[aria-pressed=true] { background: var(--hud-encre); color: var(--noir); }
button:disabled { opacity: 0.35; cursor: default; }
.cross { font-size: 64px; color: var(--fixation); line-height: 1; }
.stage { position: relative; }
.stage img { display: block; }
.stage svg { position: absolute; inset: 0; }
.answers { display: grid; gap: 14px; }
.row { display: flex; gap: 10px; align-items: center; }
.row .num { width: 3ch; font-size: 20px; }
textarea { width: min(80ch, 90vw); height: 30vh; background: var(--noir); color: var(--hud-encre); font: 12px monospace; }
`
document.head.append(style)

const params = new URLSearchParams(location.search)
const clear = (): void => root.replaceChildren()
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = '') => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (text) e.textContent = text
  return e
}

const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r))

// Attend une durée en images : renvoie la durée réelle et le nombre d'images affichées.
const holdFor = async (ms: number): Promise<{ ms: number; frames: number }> => {
  const t0 = await frame()
  let frames = 1
  let now = t0
  while (now - t0 < ms - 8) {
    now = await frame()
    frames++
  }
  return { ms: now - t0, frames }
}

const loadImage = async (src: string): Promise<HTMLImageElement> => {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

const stage = (c: Capture, img: HTMLImageElement): HTMLElement => {
  const s = el('div', { class: 'stage' })
  img.width = c.width
  img.height = c.height
  img.style.width = `${c.width}px`
  img.style.height = `${c.height}px`
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', String(c.width))
  svg.setAttribute('height', String(c.height))
  for (const p of c.probes) {
    const m = markerCenter(p, c.width, c.height)
    const circle = document.createElementNS(ns, 'circle')
    circle.setAttribute('cx', String(m.x))
    circle.setAttribute('cy', String(m.y))
    circle.setAttribute('r', String(MARKER.diameter / 2))
    circle.setAttribute('fill', 'none')
    circle.setAttribute('stroke', 'var(--marqueur)')
    circle.setAttribute('stroke-width', String(MARKER.stroke))
    const digit = document.createElementNS(ns, 'text')
    digit.setAttribute('x', String(m.x))
    digit.setAttribute('y', String(m.y))
    digit.setAttribute('fill', 'var(--marqueur)')
    digit.setAttribute('font-size', String(MARKER.digit))
    digit.setAttribute('font-family', 'sans-serif')
    digit.setAttribute('text-anchor', 'middle')
    digit.setAttribute('dominant-baseline', 'central')
    digit.textContent = String(p.n)
    svg.append(circle, digit)
  }
  s.append(img, svg)
  return s
}

const ask = (c: Capture): Promise<Record<number, Answer>> =>
  new Promise((resolve) => {
    clear()
    const box = el('div', { class: 'panel answers' })
    const chosen: Record<number, Answer> = {}
    const next = el('button', { disabled: '' }, 'Image suivante')
    for (const p of [...c.probes].sort((a, b) => a.n - b.n)) {
      const row = el('div', { class: 'row', role: 'group', 'aria-label': `Corps ${p.n}` })
      row.append(el('span', { class: 'num' }, String(p.n)))
      const buttons = ANSWERS.map((a) => {
        const b = el('button', { 'aria-pressed': 'false' }, a)
        b.addEventListener('click', () => {
          chosen[p.n] = a
          for (const o of buttons) o.setAttribute('aria-pressed', String(o === b))
          if (c.probes.every((q) => chosen[q.n])) next.removeAttribute('disabled')
        })
        return b
      })
      row.append(...buttons)
      box.append(row)
    }
    next.addEventListener('click', () => resolve(chosen))
    box.append(next)
    root.append(box)
  })

const runSession = async (session: Session, observer: number, resolveImage: (s: string) => string) => {
  const records: Record_[] = []
  const order = captureOrder(session.captures.length, observer)
  const sequence: { c: Capture; training: boolean }[] = [
    ...session.training.map((c) => ({ c, training: true })),
    ...order.map((i) => ({ c: session.captures[i] as Capture, training: false })),
  ]
  for (const { c, training } of sequence) {
    const img = await loadImage(resolveImage(c.image))
    clear()
    root.append(el('div', { class: 'cross', 'aria-hidden': 'true' }, '+'))
    await holdFor(FIXATION_MS)
    clear()
    root.append(stage(c, img))
    const shown = await holdFor(EXPOSURE_MS)
    clear()
    await frame()
    const answers = await ask(c)
    for (const p of c.probes) {
      records.push({
        capture: c.id,
        training,
        probe: p.n,
        entity: p.entity ?? null,
        truth: p.truth,
        answer: answers[p.n] ?? 'Je ne sais pas',
        shownMs: Math.round(shown.ms * 10) / 10,
        shownFrames: shown.frames,
      })
    }
  }
  const result = {
    session: session.id,
    observer,
    order: order.map((i) => session.captures[i]?.id),
    finishedAt: new Date().toISOString(),
    records,
    tally: tally(records),
  }
  clear()
  const panel = el('div', { class: 'panel' })
  panel.append(el('h1', {}, 'Merci, le test est terminé.'))
  const json = JSON.stringify(result, null, 2)
  const link = el('a', { download: `b2-h1-observateur-${observer}.json` }, 'Enregistrer les réponses (JSON)')
  link.setAttribute('href', URL.createObjectURL(new Blob([json], { type: 'application/json' })))
  link.style.color = 'var(--ivoire)'
  const area = el('textarea', { id: 'export', readonly: '' })
  area.value = json
  panel.append(link, area)
  root.append(panel)
}

// Écran d'accueil : numéro d'observateur, manifeste et images, consigne à lire mot pour mot.
const setup = (): void => {
  const panel = el('div', { class: 'panel' })
  panel.append(
    el('h1', {}, 'Test des 3 secondes'),
    el('p', {}, `Consigne à lire : « ${CONSIGNE} »`),
    el('label', { for: 'observer' }, "Numéro d'observateur"),
  )
  const observer = el('input', {
    id: 'observer',
    type: 'number',
    min: '0',
    value: params.get('observer') ?? '0',
  })
  const files = el('input', { id: 'files', type: 'file', multiple: '', accept: '.json,.png' })
  const status = el('p', { id: 'status' })
  const start = el('button', { id: 'start', disabled: '' }, 'Commencer')
  panel.append(observer, el('label', { for: 'files' }, 'Manifeste et captures (PNG)'), files, status, start)
  root.append(panel)

  let session: Session | null = null
  let resolveImage: (s: string) => string = (s) => s
  const ready = (s: Session, resolver: (x: string) => string): void => {
    session = s
    resolveImage = resolver
    const too = [...s.training, ...s.captures].filter((c) => c.width > innerWidth || c.height > innerHeight)
    status.textContent = `${s.captures.length} captures, ${s.training.length} d'entraînement.`
    if (too.length) {
      status.append(
        el(
          'span',
          { class: 'warn' },
          ` L'écran est plus petit que ${too.length} capture(s) : agrandis la fenêtre.`,
        ),
      )
    }
    start.removeAttribute('disabled')
  }
  files.addEventListener('change', async () => {
    const list = [...(files.files ?? [])]
    const manifest = list.find((f) => f.name.endsWith('.json'))
    if (!manifest) {
      status.textContent = 'Choisis aussi le manifeste JSON.'
      return
    }
    const urls = new Map(list.map((f) => [f.name, URL.createObjectURL(f)]))
    ready(JSON.parse(await manifest.text()) as Session, (s) => urls.get(s.split('/').pop() ?? s) ?? s)
  })
  const url = params.get('session')
  if (url) {
    void fetch(url)
      .then((r) => r.json())
      .then((s: Session) => ready(s, (x) => new URL(x, new URL(url, location.href)).href))
  }
  start.addEventListener('click', () => {
    if (session) void runSession(session, Number(observer.value) || 0, resolveImage)
  })
}

setup()
