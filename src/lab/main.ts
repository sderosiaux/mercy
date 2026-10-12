// Laboratoire de rendu : charge une scène de test par paramètre d'URL et expose les instruments de B2 §12
// (I1 passe d'identification, I2 rendu piloté, I4 poses) sur window.__lab.
// Paramètres : scene (S1a… ; absent : liste), tick (avance jusqu'à ce tick puis s'arrête), play=1 (temps réel),
// hud=0, label=0, shake=1, aa=0.
import {
  createHud,
  createRenderer,
  decodeId,
  HUD_BAND_PX,
  type Lab,
  type PixelImage,
  PLAYER_ID,
  ROLE,
  ROLE_NAMES,
  srgbToLab,
} from '../render/index'
import { actionPhase, type PlayerAction, step, TUNING, type World } from '../sim/index'
import { type Candidate, drawProbes, MARKER, markerCenter } from '../viewer/session'
import { auditFrame } from './audit'
import { i1Fidelity } from './fidelity'
import { readFrame, referenceAccumulator, summarize } from './measure'
import { InvalidScene } from './policies'
import { type LabScene, SCENES, sceneById } from './scenes'

const params = new URLSearchParams(location.search)
// Références de couleur imposées à l'audit (E6) : `refs=L,a,b;L,a,b;L,a,b` (ivoire ; or ; gris).
const givenRefs = (): { ivoire: Lab; or: Lab; gris: Lab } | undefined => {
  const r = (params.get('refs') ?? '').split(';').map((x) => x.split(',').map(Number))
  const lab = (v: number[] | undefined): Lab => ({ L: v?.[0] ?? 0, a: v?.[1] ?? 0, b: v?.[2] ?? 0 })
  return r.length === 3 && r.every((v) => v.length === 3 && v.every(Number.isFinite))
    ? { ivoire: lab(r[0]), or: lab(r[1]), gris: lab(r[2]) }
    : undefined
}
// Instrument (E6) : `arme=masse` met la Masse en main du Bourreau au départ de la scène (audit, captures).
const armed = (w: World): World =>
  params.get('arme') === 'masse' ? { ...w, player: { ...w.player, weapon: 'masse' } } : w
// Couleurs du laboratoire : variables CSS de la palette (style.ts), jamais en dur.
const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const app = document.getElementById('lab')
if (!app) throw new Error('#lab absent')

const listScenes = (): void => {
  const nav = document.createElement('nav')
  nav.className = 'lab-list'
  nav.innerHTML = `<h1>Laboratoire de rendu</h1><p>Scènes de test (B2 §5, D12). Ajoute <code>&amp;tick=120</code>
    pour figer une image, <code>&amp;play=1</code> pour le temps réel.</p><ul>${SCENES.map(
      (s) => `<li><a href="?scene=${s.id}">${s.id}</a> ${s.title}</li>`,
    ).join('')}</ul>`
  app.append(nav)
}

const toDataUrl = (img: PixelImage): string => {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d absent')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return c.toDataURL('image/png')
}

// Phase d'un geste du Bourreau à l'image t : anticipation avant le tick d'impact, impact, récupération.
const playerPhase = (a: PlayerAction, t: number): string =>
  a.activeAt === undefined
    ? 'geste'
    : t < a.activeAt
      ? 'anticipation'
      : t === a.activeAt
        ? 'impact'
        : 'récupération'

// Gestes à anticipation du Bourreau dans une partie simulée à part (sans rendu) : début, tick d'impact prévu, tick
// de l'évènement player-impact de la simulation, et l'action qui le coupe avant son impact s'il y en a une.
interface Gesture {
  readonly kind: string
  readonly start: number
  readonly activeAt: number
  impact: number | null
  cutAt: number | null
  cutBy: string | null
}
const playerGestures = (scene: LabScene, to: number): Gesture[] => {
  let w = armed(scene.world())
  const pol = scene.policy()
  const out: Gesture[] = []
  let cur: Gesture | null = null
  while (w.tick < to) {
    w = step(w, pol(w))
    const a = w.player.action
    if (
      cur &&
      cur.cutAt === null &&
      (!a || a.start !== cur.start) &&
      cur.impact === null &&
      w.tick < cur.activeAt
    ) {
      cur.cutAt = w.tick
      cur.cutBy = a?.kind ?? 'repos'
    }
    if (a && a.activeAt !== undefined && (!cur || cur.start !== a.start)) {
      cur = { kind: a.kind, start: a.start, activeAt: a.activeAt, impact: null, cutAt: null, cutBy: null }
      out.push(cur)
    }
    const hit = w.events.find((e) => e.type === 'player-impact')
    if (hit && cur && cur.impact === null && cur.cutAt === null && hit.tick >= cur.start)
      cur.impact = hit.tick
  }
  return out
}

const run = async (scene: LabScene): Promise<void> => {
  const canvas = document.createElement('canvas')
  canvas.className = 'lab-canvas'
  app.append(canvas)
  // Qualité (`qualite=haute|basse`) et caméra (`camera=p20|proche`) : lues par le rendu dans l'URL.
  const renderer = createRenderer(canvas, {
    pixelRatio: 1,
    shake: params.get('shake') === '1',
    shadows: params.get('ombres') !== '0', // ombres=0 : mesure du coût des ombres
    antialias: params.get('aa') === '1', // mesure par défaut : couverture identique à la passe d'identification
    preserveDrawingBuffer: true,
  })
  // Textures chargées et environnement capturé avant toute image mesurée.
  await renderer.ready()
  const hud = params.get('hud') === '0' ? null : createHud(app)
  const label = document.createElement('div')
  label.className = 'lab-label'
  if (params.get('label') !== '0') app.append(label)

  let policy = scene.policy()
  let world: World = armed(scene.world())
  let prev: World = world
  let error: string | null = null
  // Les décalques de la scène sont du sang ancien (rouge brun), posés avant le tick 0.
  const seedGore = (): void => {
    renderer.debug.clearGore()
    for (const d of scene.decals ?? []) renderer.debug.addDecal(d.pos, d.size, d.born ?? -1000)
    renderer.observe(world)
  }
  const reset = (): void => {
    policy = scene.policy()
    world = armed(scene.world())
    prev = world
    error = null
    seedGore()
  }
  renderer.setAim(scene.aim ?? null)
  // Instruments I2 par l'URL : masquer des entités (hide=3,7) ou n'en montrer qu'une (isolate=12).
  const urlIds = (k: string): number[] => (params.get(k) ?? '').split(',').filter(Boolean).map(Number)
  if (params.get('hide')) renderer.debug.hide(urlIds('hide'))
  if (params.get('isolate')) renderer.debug.isolate(urlIds('isolate')[0] ?? null)
  seedGore()

  const stepOnce = (): void => {
    if (error) return
    try {
      prev = world
      world = step(world, policy(world))
      renderer.observe(world)
    } catch (e) {
      error = e instanceof InvalidScene ? `scène invalide : ${e.message}` : String(e)
    }
  }
  const draw = (alpha = 1): void => {
    renderer.render(world, prev, alpha)
    hud?.update(world)
    label.textContent = `${scene.title} · tick ${world.tick}${error ? ` · ${error}` : ''}`
  }
  const goto = (tick: number): void => {
    if (tick < world.tick) reset()
    while (world.tick < tick && !error) stepOnce()
    draw()
  }

  let playing = false
  let raf = 0
  const frames: { interval: number; cpu: number; sim: number }[] = []
  const repeat = Math.max(1, Number(params.get('repeat') ?? '1'))
  const play = (): void => {
    if (playing) return
    playing = true
    let last = performance.now()
    let acc = 0
    const tick = (now: number): void => {
      if (!playing) return
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      acc += dt
      const s0 = performance.now()
      let n = 0
      while (acc >= 1 / 60 && n < 5) {
        stepOnce()
        acc -= 1 / 60
        n++
      }
      const simMs = performance.now() - s0
      // repeat > 1 : charge GPU multipliée, pour borner la marge quand l’intervalle est plafonné par la synchro verticale.
      for (let r = 0; r < repeat; r++) draw(Math.min(1, acc * 60))
      frames.push({ interval: dt * 1000, cpu: renderer.debug.stats().cpuMs, sim: simMs })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  }
  const pause = (): void => {
    playing = false
    cancelAnimationFrame(raf)
  }
  window.addEventListener('resize', () => draw())

  // Moments clés d'une créature, par une partie simulée à part (sans rendu), puis planche de vignettes rendues.
  const strip = (id: number, to: number) => {
    let w = armed(scene.world())
    const pol = scene.policy()
    let firstAttack: { start: number; activeAt: number; name: string } | null = null
    let cut: number | null = null
    let cutAction: string | null = null
    let death: number | null = null
    let fell: number | null = null
    while (w.tick < to && death === null) {
      w = step(w, pol(w))
      const c = w.creatures.find((x) => x.id === id)
      const a = c?.action
      if (!firstAttack && a && a.kind === 'attaque')
        firstAttack = { start: a.start, activeAt: a.activeAt, name: a.name }
      for (const e of w.events) {
        if (e.type === 'action-interrupted' && e.id === id && cut === null) {
          cut = e.tick
          cutAction = e.action
        }
        if (e.type === 'fell' && e.id === id && fell === null) fell = e.tick
        if (e.type === 'death' && e.id === id) death = e.tick
      }
    }
    const rows: { title: string; ticks: number[] }[] = []
    // Le Bourreau (E3) : ses gestes à anticipation (Frappe, Balayage), avec le tick d'impact de la simulation
    // (évènement player-impact), et un geste coupé avant son impact.
    const gestures = id === PLAYER_ID ? playerGestures(scene, to) : []
    for (const g of gestures) {
      const head = `${g.kind} (début ${g.start}, activeAt ${g.activeAt}`
      if (g.cutAt !== null) {
        rows.push({
          title: `${head}) coupée par ${g.cutBy} au tick ${g.cutAt} ; player-impact : ${g.impact ?? 'aucun'}`,
          ticks: [g.start, g.cutAt - 1, g.cutAt, g.cutAt + 1, g.cutAt + 2],
        })
        continue
      }
      rows.push({
        title: `${head}) : anticipation`,
        ticks: [-1, 0, 1, 2, 3].map((k) => g.start + k),
      })
      rows.push({
        title: `${head}) : impact, player-impact au tick ${g.impact ?? 'aucun'}`,
        ticks: [-1, 0, 1, 2, 4].map((k) => g.activeAt + k),
      })
    }
    if (firstAttack)
      rows.push({
        title: `impact (${firstAttack.name}, tick actif ${firstAttack.activeAt})`,
        ticks: [-2, -1, 0, 1, 2].map((k) => (firstAttack?.activeAt ?? 0) + k),
      })
    if (cut !== null)
      rows.push({
        title: `coup qui coupe ${cutAction} (tick ${cut})`,
        ticks: [-1, 0, 1, 2, 3].map((k) => (cut ?? 0) + k),
      })
    if (death !== null)
      rows.push({ title: `mort (tick ${death})`, ticks: [-1, 0, 1, 2, 30].map((k) => (death ?? 0) + k) })
    // Ticks imposés (ticks=70,79,…) : une rangée de plus, par cinq.
    const forced = (params.get('ticks') ?? '').split(',').filter(Boolean).map(Number)
    for (let k = 0; k < forced.length; k += 5)
      rows.push({ title: 'ticks demandés', ticks: forced.slice(k, k + 5) })
    const T = 220
    const out = document.createElement('canvas')
    out.className = 'lab-canvas'
    out.width = T * 5
    out.height = rows.length * (T + 22)
    out.style.width = `${out.width}px`
    out.style.height = `${out.height}px`
    out.style.inset = 'auto'
    out.style.left = '0'
    out.style.top = '0'
    const ctx = out.getContext('2d')
    const frames: unknown[] = []
    rows.forEach((row, r) => {
      if (ctx) {
        ctx.fillStyle = cssVar('--hud-fond')
        ctx.fillRect(0, r * (T + 22), out.width, 22)
        ctx.fillStyle = cssVar('--hud-encre')
        ctx.font = '13px serif'
        ctx.fillText(row.title, 6, r * (T + 22) + 15)
      }
      row.ticks.forEach((t, k) => {
        goto(t)
        const c = world.creatures.find((x) => x.id === id)
        const img = renderer.debug.readPixels()
        // Le Bourreau (PLAYER_ID) ou une créature ; à défaut, le centre de l'image.
        const at = id === PLAYER_ID ? world.player.pos : c?.pos
        const [cx, cy] = at ? renderer.debug.project(at.x, 0.8, at.z) : [img.width / 2, img.height / 2]
        const x0 = Math.round(Math.min(Math.max(0, cx - T / 2), img.width - T))
        const y0 = Math.round(Math.min(Math.max(0, cy - T / 2), img.height - T))
        const tile = new ImageData(T, T)
        for (let y = 0; y < T; y++)
          tile.data.set(
            img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + T) * 4),
            y * T * 4,
          )
        ctx?.putImageData(tile, k * T, r * (T + 22) + 22)
        const f = renderer.debug.anim(id)
        const a = c?.action
        const pa = id === PLAYER_ID ? world.player.action : null
        const impactHere = world.events.some((e) => e.type === 'player-impact')
        const label =
          id === PLAYER_ID
            ? `t=${t}${pa ? ` ${pa.kind} ${playerPhase(pa, t)}` : ' —'}${impactHere ? ' IMPACT' : ''}`
            : `t=${t}${a ? ` ${a.name} ${actionPhase(a, t)}` : ''} ${c?.state.kind ?? ''}`
        if (ctx) {
          ctx.fillStyle = cssVar('--hud-encre')
          ctx.font = '12px serif'
          ctx.fillText(label, k * T + 5, r * (T + 22) + 36)
          const main = f?.layers.slice().sort((p, q2) => q2.weight - p.weight)[0]
          if (main) ctx.fillText(`${main.clip} ${main.time.toFixed(3)} s`, k * T + 5, r * (T + 22) + 50)
        }
        frames.push({
          row: r,
          tick: t,
          state: c?.state.kind,
          player:
            id === PLAYER_ID
              ? {
                  action: pa
                    ? { kind: pa.kind, start: pa.start, activeAt: pa.activeAt ?? null, end: pa.end }
                    : null,
                  impactEvent: impactHere,
                }
              : undefined,
          action: a
            ? { name: a.name, start: a.start, activeAt: a.activeAt, end: a.end, phase: actionPhase(a, t) }
            : null,
          layers: f?.layers.map((l) => ({
            clip: l.clip,
            time: Math.round(l.time * 1000) / 1000,
            weight: Math.round(l.weight * 1000) / 1000,
          })),
        })
      })
    })
    app.append(out)
    return {
      id,
      firstAttack,
      cut,
      cutAction,
      fell,
      death,
      gestures,
      rows: rows.map((r) => r.title),
      frames,
    }
  }

  const q = (xs: number[], p: number): number => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? (s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] as number) : Number.NaN
  }

  const api = {
    scenes: SCENES.map((s) => s.id),
    info: () => ({
      scene: scene.id,
      tick: world.tick,
      gpu: renderer.debug.gpu(),
      canvas: [canvas.width, canvas.height],
      dpr: window.devicePixelRatio,
      error,
      player: { pos: world.player.pos, vie: world.player.vie, action: world.player.action?.kind ?? null },
      states: Object.fromEntries(
        world.creatures.map((c) => [c.id, c.state.kind === 'mort' ? `mort@${c.state.at}` : c.state.kind]),
      ),
    }),
    goto,
    step: (n = 1) => {
      for (let i = 0; i < n; i++) stepOnce()
      draw()
      return world.tick
    },
    render: () => draw(),
    play,
    pause,
    world: () => world,
    // I2 : pixels du canvas sans le HUD DOM, en PNG.
    capture: () => toDataUrl(renderer.debug.readPixels()),
    // I1 : passe d'identification encodée (R = id >> 8, G = id & 255, B = rôle), en PNG.
    idImage: () => toDataUrl(renderer.debug.idPass()),
    idSummary: () => {
      const img = renderer.debug.idPass()
      const out: Record<string, Record<string, number>> = {}
      for (let i = 0; i < img.data.length; i += 4) {
        const { id, role } = decodeId(img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0)
        const key = id === PLAYER_ID ? 'joueur' : String(id)
        const r = ROLE_NAMES[role] ?? String(role)
        const e = out[key] ?? {}
        e[r] = (e[r] ?? 0) + 1
        out[key] = e
      }
      return out
    },
    poses: () => renderer.debug.poses(),
    isolate: (id: number | null) => {
      renderer.debug.isolate(id)
      draw()
    },
    hide: (ids: number[]) => {
      renderer.debug.hide(ids)
      draw()
    },
    setShake: (on: boolean) => renderer.debug.setShake(on),
    setTelegraphs: (on: boolean) => {
      renderer.debug.setTelegraphs(on)
      draw()
    },
    // I1 fidèle à l'image (E4) : télégraphes et entités, image courante (fidelity.ts).
    fidelity: (minPx = 150) => i1Fidelity(renderer, minPx),
    stats: () => renderer.debug.stats(),
    blood: () => renderer.debug.bloodLayer(), // couche du sol (E7)
    read: () => readFrame(renderer.debug.readPixels(), renderer.debug.idPass(), world),
    // Mouvement sur une plage de ticks (B2.O5 pixels, O6.2) : pixels changés d'un mort, XOR des masques d'un vivant.
    // Masques creux (indices de pixels triés) : XOR = |A| + |B| - 2 |A ∩ B|.
    motion: (ids: number[], from: number, to: number) => {
      goto(from)
      const masks = new Map<number, Int32Array[]>()
      const colors = new Map<number, Uint32Array[]>()
      for (const id of ids) {
        masks.set(id, [])
        colors.set(id, [])
      }
      for (let t = from; t <= to; t++) {
        if (t > from) {
          stepOnce()
          draw()
        }
        const idImg = renderer.debug.idPass()
        const col = renderer.debug.readPixels()
        const idx = new Map<number, number[]>()
        const cols = new Map<number, number[]>()
        for (const id of ids) {
          idx.set(id, [])
          cols.set(id, [])
        }
        for (let p = 0, i = 0; i < idImg.data.length; p++, i += 4) {
          const id = ((idImg.data[i] ?? 0) << 8) | (idImg.data[i + 1] ?? 0)
          const list = idx.get(id)
          if (!list) continue
          list.push(p)
          cols
            .get(id)
            ?.push(
              (((col.data[i] ?? 0) << 16) | ((col.data[i + 1] ?? 0) << 8) | (col.data[i + 2] ?? 0)) >>> 0,
            )
        }
        for (const id of ids) {
          masks.get(id)?.push(Int32Array.from(idx.get(id) ?? []))
          colors.get(id)?.push(Uint32Array.from(cols.get(id) ?? []))
        }
      }
      const inter = (a: Int32Array, b: Int32Array): number => {
        let i = 0
        let j = 0
        let n = 0
        while (i < a.length && j < b.length) {
          const x = a[i] as number
          const y = b[j] as number
          if (x === y) {
            n++
            i++
            j++
          } else if (x < y) i++
          else j++
        }
        return n
      }
      const out: Record<number, { minWindowXor: number; changedPixels: number; maskPixels: number }> = {}
      for (const id of ids) {
        const ms = masks.get(id) ?? []
        const cs = colors.get(id) ?? []
        let minWindowXor = Number.POSITIVE_INFINITY
        for (let s = 0; s + 29 < ms.length; s++) {
          const a = ms[s] as Int32Array
          let best = 0
          for (let k = s + 1; k <= s + 29; k++) {
            const b = ms[k] as Int32Array
            best = Math.max(best, a.length + b.length - 2 * inter(a, b))
          }
          minWindowXor = Math.min(minWindowXor, best)
        }
        // Pixels qui changent : masque différent, ou même pixel de couleur différente, par rapport à la 1re image.
        let changed = 0
        const m0 = ms[0] as Int32Array
        const c0 = cs[0] as Uint32Array
        for (let k = 1; k < ms.length; k++) {
          const mk = ms[k] as Int32Array
          const ck = cs[k] as Uint32Array
          const common = inter(m0, mk)
          changed += m0.length + mk.length - 2 * common
          let i = 0
          let j = 0
          while (i < m0.length && j < mk.length) {
            const x = m0[i] as number
            const y = mk[j] as number
            if (x === y) {
              if (c0[i] !== ck[j]) changed++
              i++
              j++
            } else if (x < y) i++
            else j++
          }
        }
        out[id] = { minWindowXor, changedPixels: changed, maskPixels: m0.length }
      }
      return out
    },
    // Temps de frame en temps réel sur n images : intervalle entre images, CPU du rendu, CPU de la simulation.
    perf: (n = 300): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        frames.length = 0
        play()
        const wait = (): void => {
          if (frames.length < n) {
            setTimeout(wait, 100)
            return
          }
          pause()
          const fs = frames.slice(10) // les premières images chargent les shaders
          const s = renderer.debug.stats()
          resolve({
            frames: fs.length,
            intervalMs: {
              p50: q(
                fs.map((f) => f.interval),
                0.5,
              ),
              p95: q(
                fs.map((f) => f.interval),
                0.95,
              ),
              max: q(
                fs.map((f) => f.interval),
                1,
              ),
            },
            renderCpuMs: {
              p50: q(
                fs.map((f) => f.cpu),
                0.5,
              ),
              p95: q(
                fs.map((f) => f.cpu),
                0.95,
              ),
              max: q(
                fs.map((f) => f.cpu),
                1,
              ),
            },
            simCpuMs: {
              p50: q(
                fs.map((f) => f.sim),
                0.5,
              ),
              p95: q(
                fs.map((f) => f.sim),
                0.95,
              ),
              max: q(
                fs.map((f) => f.sim),
                1,
              ),
            },
            drawCalls: s.calls,
            triangles: s.triangles,
            instances: s.instances,
            decals: s.decals,
            bodies: s.bodies,
            creatures: {
              nonMortes: world.creatures.filter((c) => c.state.kind !== 'mort').length,
              mortes: world.creatures.filter((c) => c.state.kind === 'mort').length,
            },
            gpu: renderer.debug.gpu(),
            canvas: [canvas.width, canvas.height],
          })
        }
        wait()
      }),
  }
  ;(window as unknown as { __lab: typeof api }).__lab = api

  const target = Number(params.get('tick') ?? '0')
  goto(Number.isFinite(target) ? target : 0)
  if (params.get('play') === '1') play()
  document.body.dataset.ready = '1'

  // view=ids : la passe d'identification en fausses couleurs calculées (rôle sur le rouge, id sur vert et bleu),
  // posée sur le canvas, pour la regarder ; la mesure lit l'encodage brut (idImage, idSummary).
  if (params.get('view') === 'ids') {
    const img = renderer.debug.idPass()
    const over = document.createElement('canvas')
    over.className = 'lab-canvas'
    over.width = img.width
    over.height = img.height
    const ctx = over.getContext('2d')
    if (ctx) {
      const out = new ImageData(img.width, img.height)
      for (let i = 0; i < img.data.length; i += 4) {
        const { id, role } = decodeId(img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0)
        out.data[i] = role * 40
        out.data[i + 1] = id === 0 ? 0 : 60 + ((id * 67) % 196)
        out.data[i + 2] = id === 0 ? 0 : 60 + ((id * 151) % 196)
        out.data[i + 3] = 255
      }
      ctx.putImageData(out, 0, 0)
      app.append(over)
    }
  }

  // Tâche sans console : le résultat JSON s'écrit dans #lab-out (lu par un navigateur piloté).
  const task = params.get('task')
  if (task) {
    const nums = (k: string): number[] => (params.get(k) ?? '').split(',').filter(Boolean).map(Number)
    const publish = (v: unknown): void => {
      const pre = document.createElement('pre')
      pre.id = 'lab-out'
      pre.className = 'lab-out'
      pre.textContent = JSON.stringify(v)
      app.append(pre)
    }
    const from = world.tick
    const jobs: Record<string, () => unknown> = {
      info: api.info,
      models: () => renderer.debug.models(),
      // Séquence image par image (E2) : moments clés d'une créature (id, 1 par défaut) — impact de sa première
      // attaque, coup qui coupe une attaque, mort — rendus tick par tick et posés en planche ; les clips, instants et
      // poids de chaque image sont publiés à côté.
      strip: () => strip(Number(params.get('id') ?? '1'), Number(params.get('to') ?? '900')),
      // B2 I2 : la même paire de mondes rendue deux fois donne la même image (couleur et identification).
      same: () => {
        const diff = (a: PixelImage, b: PixelImage): number => {
          let n = 0
          for (let i = 0; i < a.data.length; i += 4)
            if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2])
              n++
          return n
        }
        const c1 = renderer.debug.readPixels()
        const c2 = renderer.debug.readPixels()
        const i1 = renderer.debug.idPass()
        const i2 = renderer.debug.idPass()
        return { colorDiff: diff(c1, c2), idDiff: diff(i1, i2) }
      },
      // Agonie image par image (E7) : `task=agonie&id=<id>[&to=<tick max>][&taille=<px>][&avant=2][&apres=6]`. Trouve
      // le tick de la mort de l'entité dans une partie simulée à part, rend chaque tick de T − avant à
      // T + TUNING.agonie + apres (rendu piloté, alpha = 1), recadré autour du corps, et publie la planche (PNG) et, par
      // image : tick, état, passage au gris, clip principal, hauteur du plus haut segment (m), pixels de liseré,
      // déplacement écran maximal d'un coin de segment depuis l'image T − 1 (px). Les morts de la même image (Union)
      // sont listées et suivies de la même façon.
      agonie: () => {
        const id = Number(params.get('id') ?? '1')
        const to = Number(params.get('to') ?? '900')
        const size = Number(params.get('taille') ?? '200')
        const before = Number(params.get('avant') ?? '2')
        const after = Number(params.get('apres') ?? '6')
        let w = armed(scene.world())
        const pol = scene.policy()
        let death: { tick: number; by: string } | null = null
        let union: number[] = []
        while (w.tick < to && death === null) {
          w = step(w, pol(w))
          const d = w.events.find((e) => e.type === 'death' && e.id === id)
          if (d && d.type === 'death') {
            death = { tick: d.tick, by: d.by }
            union = w.events.flatMap((e) => (e.type === 'death' && e.id !== id ? [e.id] : []))
          }
        }
        if (!death) return { erreur: `aucune mort de ${id} avant le tick ${to}` }
        const T = death.tick
        const A = TUNING.agonie
        const followed = [id, ...union]
        const ticks: number[] = []
        for (let t = T - before; t <= T + A + after; t++) ticks.push(t)
        const cols = 7
        const rowsN = Math.ceil(ticks.length / cols)
        const out = document.createElement('canvas')
        out.width = size * cols
        out.height = rowsN * (size + 18)
        const ctx = out.getContext('2d')
        if (ctx) {
          ctx.fillStyle = cssVar('--hud-fond')
          ctx.fillRect(0, 0, out.width, out.height)
        }
        const ref = new Map<number, number[]>()
        const frames: unknown[] = []
        let center: readonly [number, number] | null = null
        ticks.forEach((t, k) => {
          goto(t)
          const img = renderer.debug.readPixels()
          const ids = renderer.debug.idPass()
          const poses = renderer.debug.poses()
          const c = world.creatures.find((x) => x.id === id)
          // Cadrage sur la position au sol du corps à chaque image : la caméra peut bouger (poussée de la Sentence,
          // retrait du joueur), le corps reste au centre de sa vignette.
          if (c) center = renderer.debug.project(c.pos.x, 0.5, c.pos.z) as [number, number]
          const [cx, cy] = center ?? [img.width / 2, img.height / 2]
          const S = Math.min(size, img.width, img.height)
          const x0 = Math.round(Math.min(Math.max(0, cx - S / 2), img.width - S))
          const y0 = Math.round(Math.min(Math.max(0, cy - S / 2), img.height - S))
          const tile = new ImageData(S, S)
          for (let y = 0; y < S; y++)
            tile.data.set(
              img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + S) * 4),
              y * S * 4,
            )
          const col = k % cols
          const row = Math.floor(k / cols)
          ctx?.putImageData(tile, col * size, row * (size + 18) + 18)
          const per: Record<number, unknown> = {}
          for (const fid of followed) {
            const e = world.creatures.find((x) => x.id === fid)
            const p = poses.find((x) => x.id === fid)
            const flat = p ? p.segments.flatMap((s) => s.corners.flatMap((q) => [q[0], q[1]])) : []
            if (t === T - 1) ref.set(fid, flat)
            const r0 = ref.get(fid)
            let disp = 0
            if (r0 && r0.length === flat.length)
              for (let i = 0; i < flat.length; i += 2)
                disp = Math.max(
                  disp,
                  Math.hypot((flat[i] ?? 0) - (r0[i] ?? 0), (flat[i + 1] ?? 0) - (r0[i + 1] ?? 0)),
                )
            let rim = 0
            let body = 0
            for (let i = 0; i < ids.data.length; i += 4) {
              const dd = decodeId(ids.data[i] ?? 0, ids.data[i + 1] ?? 0, ids.data[i + 2] ?? 0)
              if (dd.id !== fid) continue
              if (dd.role === ROLE.lisere) rim++
              else body++
            }
            const top = p ? Math.max(...p.segments.map((s) => s.matrix[13] ?? 0)) : null
            const f = renderer.debug.anim(fid)
            const main = f?.layers.slice().sort((a2, b2) => b2.weight - a2.weight)[0]
            per[fid] = {
              etat: e?.state.kind ?? null,
              gris:
                e?.state.kind === 'mort'
                  ? Math.min(1, Math.max(0, (t - e.state.at) / A))
                  : e?.state.kind === undefined
                    ? null
                    : 0,
              clip: main ? `${main.clip}@${main.time.toFixed(3)}` : null,
              hautM: top === null ? null : Math.round(top * 1000) / 1000,
              lisere: rim,
              pixels: body,
              deplPx: Math.round(disp * 100) / 100,
            }
          }
          frames.push({ t, k: t - T, per })
          if (ctx) {
            ctx.fillStyle = cssVar('--hud-encre')
            ctx.font = '12px serif'
            const e = per[id] as { etat: string; gris: number | null } | undefined
            ctx.fillText(
              `t=${t} (T${t - T >= 0 ? '+' : ''}${t - T}) ${e?.etat ?? ''}${e?.gris !== null && e?.gris !== undefined && e.etat === 'mort' ? ` gris ${e.gris.toFixed(2)}` : ''}`,
              col * size + 4,
              row * (size + 18) + 13,
            )
          }
        })
        return {
          scene: scene.id,
          id,
          death: T,
          by: death.by,
          union,
          agonie: A,
          frames,
          png: out.toDataURL('image/png'),
        }
      },
      // Diagnostic : dernière pose calculée d'un corps (clips, instants, poids).
      anim: () => renderer.debug.anim(Number(params.get('id') ?? '1')),
      // Vignettes (E6) : `task=vignettes&ticks=…&taille=<px>[&sub=<n>]` : pour chaque tick (n sous-images par tick,
      // alpha = k/n), l'image recadrée autour du Bourreau (PNG en data URL), l'arme tenue et le geste.
      vignettes: () => {
        const size = Number(params.get('taille') ?? '360')
        const sub = Math.max(1, Number(params.get('sub') ?? '1'))
        const out: unknown[] = []
        for (const t of nums('ticks')) {
          goto(t)
          for (let k = sub === 1 ? sub : 1; k <= sub; k++) {
            draw(k / sub)
            const img = renderer.debug.readPixels()
            const p = world.player.pos
            const pp = prev.player.pos
            const a = k / sub
            const [cx, cy] = renderer.debug.project(pp.x + (p.x - pp.x) * a, 0.9, pp.z + (p.z - pp.z) * a)
            const S = Math.min(size, img.width, img.height)
            const x0 = Math.round(Math.min(Math.max(0, cx - S / 2), img.width - S))
            const y0 = Math.round(Math.min(Math.max(0, cy - S / 2), img.height - S))
            const c = document.createElement('canvas')
            c.width = S
            c.height = S
            const tile = new ImageData(S, S)
            for (let y = 0; y < S; y++)
              tile.data.set(
                img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + S) * 4),
                y * S * 4,
              )
            c.getContext('2d')?.putImageData(tile, 0, 0)
            const act = world.player.action
            const wp = renderer.debug.weapon()
            out.push({
              t: prev.tick + (world.tick - prev.tick) * a,
              weapon: world.player.weapon,
              held: wp?.weapon ?? null,
              action: act ? `${act.kind} ${playerPhase(act, world.tick)}` : null,
              impact: world.events.some((e) => e.type === 'player-impact'),
              swap: world.events.some((e) => e.type === 'weapon-swap'),
              sim: world.player.facing,
              shown: wp?.facing ?? null,
              png: c.toDataURL('image/png'),
            })
          }
        }
        return out
      },
      // Arme en main et orientation, tick par tick (E6) : `task=armes&tick=<de>&to=<à>[&sub=<n>]`. Pour chaque image
      // (n sous-images par tick, alpha = k/n, comme le jeu entre deux ticks) : prise, bout et tranchant de l'arme
      // (monde), orientation affichée et de la simulation, geste, arme, clip principal, impact.
      armes: () => {
        const to = Number(params.get('to') ?? from + 60)
        const sub = Math.max(1, Number(params.get('sub') ?? '1'))
        const out: unknown[] = []
        for (let t = from; t <= to; t++) {
          goto(t)
          for (let k = sub === 1 ? sub : 1; k <= sub; k++) {
            draw(k / sub)
            const wp = renderer.debug.weapon()
            const f = renderer.debug.anim(PLAYER_ID)
            const main = f?.layers.slice().sort((p, q2) => q2.weight - p.weight)[0]
            const a = world.player.action
            out.push({
              t: prev.tick + (world.tick - prev.tick) * (k / sub),
              sim: world.player.facing,
              shown: wp?.facing ?? null,
              pos: [world.player.pos.x, world.player.pos.z].map((x) => Math.round(x * 1000) / 1000),
              weapon: world.player.weapon,
              held: wp?.weapon ?? null,
              action: a ? { kind: a.kind, start: a.start, activeAt: a.activeAt ?? null, end: a.end } : null,
              impact: world.events.some((e) => e.type === 'player-impact'),
              swap: world.events.some((e) => e.type === 'weapon-swap'),
              clip: main ? `${main.clip}@${main.time.toFixed(3)}` : null,
              grip: wp?.grip.map((x) => Math.round(x * 1000) / 1000) ?? null,
              tip: wp?.tip.map((x) => Math.round(x * 1000) / 1000) ?? null,
              edge: wp?.edge.map((x) => Math.round(x * 1000) / 1000) ?? null,
            })
          }
        }
        return out
      },
      // Diagnostic : déciles de L*, C* et teinte des pixels `corps` d'une entité (id).
      cstats: () => {
        const id = Number(params.get('id') ?? '1')
        const col = renderer.debug.readPixels()
        const ids = renderer.debug.idPass()
        const L: number[] = []
        const C: number[] = []
        const H: number[] = []
        for (let i = 0; i < ids.data.length; i += 4) {
          const d = decodeId(ids.data[i] ?? 0, ids.data[i + 1] ?? 0, ids.data[i + 2] ?? 0)
          if (d.id !== id || d.role !== ROLE.corps) continue
          const lab = srgbToLab(col.data[i] ?? 0, col.data[i + 1] ?? 0, col.data[i + 2] ?? 0)
          L.push(lab.L)
          C.push(Math.hypot(lab.a, lab.b))
          H.push(((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360)
        }
        const dec = (xs: number[]) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => Math.round(q(xs, p) * 10) / 10)
        return { id, n: L.length, L: dec(L), C: dec(C), hue: dec(H) }
      },
      // Pixels (x, y) : couleur du canvas, id et rôle de la passe d'identification (diagnostic).
      pixel: () => {
        const xs = nums('x')
        const ys = nums('y')
        const col = renderer.debug.readPixels()
        const ids = renderer.debug.idPass()
        return xs.map((x, k) => {
          const y = ys[k] ?? 0
          const i = (y * col.width + x) * 4
          const { id, role } = decodeId(ids.data[i] ?? 0, ids.data[i + 1] ?? 0, ids.data[i + 2] ?? 0)
          return {
            x,
            y,
            rgb: [col.data[i], col.data[i + 1], col.data[i + 2]],
            id,
            role: ROLE_NAMES[role] ?? role,
          }
        })
      },
      ids: api.idSummary,
      read: api.read,
      poses: () => api.poses().map((p) => ({ id: p.id, segments: p.segments.length })),
      motion: () => api.motion(nums('ids'), from, Number(params.get('to') ?? from + 179)),
      // Sondes du test des 3 s (B2 §11) pour l'image courante : barycentres lus sur la passe d'identification.
      probes: () => {
        const img = renderer.debug.idPass()
        const acc = new Map<number, { n: number; sx: number; sy: number }>()
        for (let p = 0, i = 0; i < img.data.length; p++, i += 4) {
          const { id } = decodeId(img.data[i] ?? 0, img.data[i + 1] ?? 0, 0)
          if (id === 0 || id === PLAYER_ID) continue
          const a = acc.get(id) ?? { n: 0, sx: 0, sy: 0 }
          a.n++
          a.sx += p % img.width
          a.sy += Math.floor(p / img.width)
          acc.set(id, a)
        }
        const candidates: Candidate[] = []
        for (const c of world.creatures) {
          const a = acc.get(c.id)
          if (!a || (c.state.kind !== 'abattu' && c.state.kind !== 'mort')) continue
          const truth = c.state.kind === 'mort' ? 'Mort' : c.resistant ? 'Résistant' : 'Abattu'
          candidates.push({ entity: c.id, truth, x: a.sx / a.n, y: a.sy / a.n, visible: a.n })
        }
        const hudTop = img.height - (hud ? HUD_BAND_PX : 0)
        const r = MARKER.diameter / 2 + MARKER.stroke
        const eligible = (c: Candidate): boolean => {
          const m = markerCenter({ n: 1, x: c.x, y: c.y, truth: c.truth }, img.width, img.height)
          return m.y + r < hudTop && m.y - r >= 0 && m.x - r >= 0 && m.x + r <= img.width
        }
        const n = Number(params.get('n') ?? '1')
        const kind = params.get('kind') === 'S3' ? 'S3' : 'S1S2'
        const id = `${scene.id}-t${world.tick}-${img.width}x${img.height}`
        return {
          id,
          image: `${id}.png`,
          width: img.width,
          height: img.height,
          probes: drawProbes(candidates, n, kind, eligible),
          candidates: candidates.length,
        }
      },
      // B2.O6.1 par I4 : pour chaque entité, pire fenêtre de 30 images du plus grand déplacement d'un coin projeté.
      tremble: () => {
        const to = Number(params.get('to') ?? from + 179)
        const series = new Map<number, number[][]>()
        for (let t = from; t <= to; t++) {
          if (t > from) {
            stepOnce()
            draw()
          }
          for (const p of renderer.debug.poses()) {
            const flat = p.segments.flatMap((s) => s.corners.flatMap((c) => [c[0], c[1]]))
            series.set(p.id, [...(series.get(p.id) ?? []), flat])
          }
        }
        const out: Record<number, number> = {}
        for (const [id, frames] of series) {
          let worst = Number.POSITIVE_INFINITY
          for (let s = 0; s + 29 < frames.length; s++) {
            const a = frames[s] as number[]
            let best = 0
            for (let k = s + 1; k <= s + 29; k++) {
              const b = frames[k] as number[]
              if (b.length !== a.length) continue
              for (let i = 0; i < a.length; i += 2)
                best = Math.max(
                  best,
                  Math.hypot((b[i] ?? 0) - (a[i] ?? 0), (b[i + 1] ?? 0) - (a[i + 1] ?? 0)),
                )
            }
            worst = Math.min(worst, best)
          }
          out[id] = Math.round(worst * 100) / 100
        }
        return out
      },
      // screenToGround : chaque position de créature, projetée à l'écran puis ramenée au sol, en m d'écart.
      stg: () => {
        let worst = 0
        for (const c of world.creatures) {
          const [x, y] = renderer.debug.project(c.pos.x, 0, c.pos.z)
          const g = renderer.screenToGround(x, y)
          worst = Math.max(worst, Math.hypot(g.x - c.pos.x, g.z - c.pos.z))
        }
        return { creatures: world.creatures.length, maxErrorM: worst }
      },
      // Audit §30 (E1) : créatures debout sans ivoire ni or, acier du Bourreau, télégraphes contre le sang et les morts.
      // `refs=L,a,b;L,a,b;L,a,b` (ivoire ; or ; gris, ceux de B2) : références imposées (E6) ; sinon celles de l'image.
      audit: () => auditFrame(renderer, world, givenRefs()),
      // Audit du Bourreau et de son arme image après image (E6) : `task=auditbourreau&tick=<de>&to=<à>&every=<n>`.
      auditbourreau: () => {
        const to = Number(params.get('to') ?? from + 60)
        const every = Math.max(1, Number(params.get('every') ?? '1'))
        const out: unknown[] = []
        for (let t = from; t <= to; t += every) {
          goto(t)
          const a = auditFrame(renderer, world, givenRefs())
          const { hits: _h, ...weapon } = a.weapon
          out.push({
            t,
            weapon: world.player.weapon,
            action: world.player.action?.kind ?? null,
            bourreau: a.player,
            arme: weapon,
            hits: a.weapon.hits.slice(0, 6),
          })
        }
        return out
      },
      // I1 fidèle à l'image (E4) : `task=fidelite&tick=54` (télégraphes sur les morts, entités masquées une à une).
      fidelite: () => i1Fidelity(renderer, Number(params.get('min') ?? '150')),
      // Temps de frame complet (CPU + GPU) : chaque image est rendue puis on attend la fin du travail du GPU (lecture
      // d’un pixel). Pas plafonné par la synchro verticale, contrairement à perf.
      frametime: () => {
        const n = Number(params.get('frames') ?? '240')
        const ms: number[] = []
        for (let i = 0; i < n; i++) {
          stepOnce()
          draw()
          ms.push(renderer.debug.syncFrameMs())
        }
        const fs = ms.slice(10)
        const s = renderer.debug.stats()
        return {
          frames: fs.length,
          frameMs: { p50: q(fs, 0.5), p95: q(fs, 0.95), max: q(fs, 1) },
          stats: s,
          lights: renderer.debug.lights().length,
          creatures: {
            nonMortes: world.creatures.filter((c) => c.state.kind !== 'mort').length,
            mortes: world.creatures.filter((c) => c.state.kind === 'mort').length,
          },
          gpu: renderer.debug.gpu(),
          canvas: [canvas.width, canvas.height],
        }
      },
      // Taux de visibilité (B2 §5) : pixels visibles / pixels de l'entité rendue seule.
      visibility: () => {
        const count = (img: PixelImage): Map<number, number> => {
          const m = new Map<number, number>()
          for (let i = 0; i < img.data.length; i += 4) {
            const { id } = decodeId(img.data[i] ?? 0, img.data[i + 1] ?? 0, 0)
            if (id !== 0) m.set(id, (m.get(id) ?? 0) + 1)
          }
          return m
        }
        const all = count(renderer.debug.idPass())
        const out: Record<number, { visible: number; alone: number; rate: number }> = {}
        for (const c of world.creatures) {
          renderer.debug.isolate(c.id)
          const alone = count(renderer.debug.idPass()).get(c.id) ?? 0
          const visible = all.get(c.id) ?? 0
          out[c.id] = { visible, alone, rate: alone ? Math.round((visible / alone) * 1000) / 1000 : 0 }
        }
        renderer.debug.isolate(null)
        draw()
        return out
      },
      // Références sur [refFrom ; refTo], puis pire valeur de chaque observable sur [from ; to], toutes les `every` images.
      b2: () => {
        const every = Number(params.get('every') ?? '6')
        const refFrom = Number(params.get('refFrom') ?? '0')
        const refTo = Number(params.get('refTo') ?? '179')
        const to = Number(params.get('to') ?? '268')
        const acc = referenceAccumulator()
        for (let t = refFrom; t <= refTo; t += every) {
          goto(t)
          acc.add(renderer.debug.readPixels(), renderer.debug.idPass(), world)
        }
        const refs = acc.result()
        const readings = []
        for (let t = from; t <= to; t += every) {
          goto(t)
          readings.push(readFrame(renderer.debug.readPixels(), renderer.debug.idPass(), world, refs))
        }
        const gaps = readings[0]?.refGaps
        return { refs, refGaps: gaps, frames: readings.length, entities: summarize(readings) }
      },
    }
    if (task === 'perf') void api.perf(Number(params.get('frames') ?? '300')).then(publish)
    else publish(jobs[task]?.() ?? { erreur: `tâche inconnue : ${task}` })
  }
}

const id = params.get('scene')
const scene = id ? sceneById(id) : undefined
if (scene) void run(scene)
else listScenes()
