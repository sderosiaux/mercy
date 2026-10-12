// Étiquette réelle des touches lues par position physique (audit, §6) : KeyQ s'affiche « A » sur un clavier AZERTY.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchKeyLabel } from './hud'

type Listener = (e: KeyboardEvent) => void

const stubWindow = (layout: Record<string, string> | null) => {
  const listeners: Listener[] = []
  vi.stubGlobal('addEventListener', (type: string, l: Listener) => {
    if (type === 'keydown') listeners.push(l)
  })
  vi.stubGlobal('removeEventListener', (_: string, l: Listener) => {
    const i = listeners.indexOf(l)
    if (i >= 0) listeners.splice(i, 1)
  })
  vi.stubGlobal(
    'navigator',
    layout ? { keyboard: { getLayoutMap: () => Promise.resolve(new Map(Object.entries(layout))) } } : {},
  )
  return {
    press: (code: string, key: string) => {
      for (const l of [...listeners]) l({ code, key } as KeyboardEvent)
    },
    count: () => listeners.length,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('étiquette des touches physiques', () => {
  it('lit la disposition du clavier quand le navigateur la donne (AZERTY : KeyQ → A)', async () => {
    stubWindow({ KeyQ: 'a', KeyX: 'x' })
    const seen: string[] = []
    watchKeyLabel('KeyQ', (k) => seen.push(k))
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['A'])
  })

  it('sans disposition, apprend la lettre à la première frappe sur la touche', () => {
    const w = stubWindow(null)
    const seen: string[] = []
    const stop = watchKeyLabel('KeyQ', (k) => seen.push(k))
    w.press('KeyW', 'z')
    w.press('KeyQ', 'a')
    expect(seen).toEqual(['A'])
    stop()
    expect(w.count()).toBe(0)
  })

  it('ignore les touches sans lettre (Maj, flèches)', () => {
    const w = stubWindow(null)
    const seen: string[] = []
    watchKeyLabel('KeyQ', (k) => seen.push(k))
    w.press('KeyQ', 'Shift')
    expect(seen).toEqual([])
  })
})
