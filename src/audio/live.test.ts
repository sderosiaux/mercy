// Drapeau 9 de B5 : la mesure en direct (I4, runLive) libère son moteur et son mesureur à la fin de chaque passage,
// et ne redécode pas la banque à chaque appel. Web Audio de test (webaudio-fake.ts), boucle d'images simulée.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorld, FAMILIES, IDLE_COMMANDS } from '../sim/index'
import { WAVES } from '../sim/waves'
import { runLive } from './live'
import type { Manifest } from './manifest'
import {
  type FakeContext,
  FakeGainNode,
  FakeSourceNode,
  FakeWorkletNode,
  fakeFileBytes,
  installFakeWebAudio,
} from './webaudio-fake'

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../public/audio/manifest.json'), 'utf8'),
) as Manifest

let fake: ReturnType<typeof installFakeWebAudio>
let ctx: FakeContext

beforeEach(() => {
  fake = installFakeWebAudio()
  ctx = fake.ctx
  const byFile = new Map(manifest.files.map((e) => [e.file, e.frames]))
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest))
    const frames = byFile.get(url.replace(/^.*\/audio\//, ''))
    return frames === undefined ? new Response(null, { status: 404 }) : new Response(fakeFileBytes(frames))
  })
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) =>
    setTimeout(() => cb(performance.now()), 4),
  )
})
afterEach(() => {
  fake.restore()
  vi.unstubAllGlobals()
})

describe('mesure en direct I4 (drapeau 9 de B5)', () => {
  it('trois passages : une seule décodification de la banque, et chaque passage arrête et déconnecte tout ce qu’il a créé', async () => {
    const world0 = createWorld({ seed: 1, wave: WAVES.S1, variant: 'A', families: FAMILIES })
    for (let i = 0; i < 3; i++) {
      const first = ctx.nodes.length
      const r = await runLive(ctx as unknown as AudioContext, {
        world0,
        policy: () => IDLE_COMMANDS,
        ticks: 3,
        tailS: 0,
      })
      expect(r.frames.length).toBeGreaterThan(0)
      const mine = ctx.nodes.slice(first)
      const sources = mine.filter((n): n is FakeSourceNode => n instanceof FakeSourceNode)
      expect(sources.length).toBeGreaterThanOrEqual(2) // au moins le vent et la nappe du passage
      for (const s of sources) {
        expect(s.playingAt(ctx.currentTime)).toBe(false)
        expect(s.disconnected).toBe(true)
      }
      expect(mine.filter((n) => n instanceof FakeGainNode).every((n) => n.disconnected)).toBe(true)
      const meters = mine.filter((n): n is FakeWorkletNode => n instanceof FakeWorkletNode)
      expect(meters).toHaveLength(1)
      expect(meters[0]?.disconnected).toBe(true)
      expect(meters[0]?.port.closed).toBe(true)
    }
    expect(ctx.decodes).toBe(manifest.files.length)
  })
})
