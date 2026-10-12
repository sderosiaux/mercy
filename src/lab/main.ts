// Laboratoire de rendu : charge une scène de test par paramètre d'URL et expose les instruments de B2 §12
// (I1 passe d'identification, I2 rendu piloté, I4 poses) sur window.__lab.
// Paramètres : scene (S1a… ; absent : liste), tick (avance jusqu'à ce tick puis s'arrête), play=1 (temps réel),
// hud=0, label=0, shake=1, aa=0.
import {
  createHud,
  createRenderer,
  decodeId,
  HUD_BAND_PX,
  type PixelImage,
  PLAYER_ID,
  ROLE_NAMES,
} from '../render/index'
import { step, type World } from '../sim/index'
import { type Candidate, drawProbes, MARKER, markerCenter } from '../viewer/session'
import { readFrame, referenceAccumulator, summarize } from './measure'
import { InvalidScene } from './policies'
import { type LabScene, SCENES, sceneById } from './scenes'

const params = new URLSearchParams(location.search)
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

const run = (scene: LabScene): void => {
  const canvas = document.createElement('canvas')
  canvas.className = 'lab-canvas'
  app.append(canvas)
  const renderer = createRenderer(canvas, {
    pixelRatio: 1,
    shake: params.get('shake') === '1',
    antialias: params.get('aa') === '1', // mesure par défaut : couverture identique à la passe d'identification
    preserveDrawingBuffer: true,
  })
  const hud = params.get('hud') === '0' ? null : createHud(app)
  const label = document.createElement('div')
  label.className = 'lab-label'
  if (params.get('label') !== '0') app.append(label)

  let policy = scene.policy()
  let world: World = scene.world()
  let prev: World = world
  let error: string | null = null
  // Les décalques de la scène sont du sang ancien (rouge brun), posés avant le tick 0.
  const seedGore = (): void => {
    renderer.debug.clearGore()
    for (const d of scene.decals ?? []) renderer.debug.addDecal(d.pos, d.size, -1000)
    renderer.observe(world)
  }
  const reset = (): void => {
    policy = scene.policy()
    world = scene.world()
    prev = world
    error = null
    seedGore()
  }
  renderer.setAim(scene.aim ?? null)
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
    stats: () => renderer.debug.stats(),
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
if (scene) run(scene)
else listScenes()
