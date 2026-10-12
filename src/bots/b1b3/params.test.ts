// Les paramètres gelés valent encore la règle dont le contrat les dérive. Si un réglage de tuning.ts bouge, ce
// test casse : la politique ne suit pas d'elle-même (B1.md §7.3), un humain décide s'il l'amende.
import { describe, expect, it } from 'vitest'
import { CHANNEL_ACTIONS, FAMILIES, TUNING, ticks } from '../../sim/index'
import * as P from './params'

describe('paramètres de B1.md §6', () => {
  it('portées, arrêts, latences, rayons', () => {
    expect(P.PORTEE).toBe(TUNING.weapons.couperet.reach) // portée du Couperet (§8.5)
    expect(P.ARRET).toBeCloseTo(P.PORTEE - 0.5, 12)
    expect(P.ARRET_F).toBeLessThan(TUNING.sentence.range) // sous la portée de Sentence (L4)
    expect(P.LATENCE).toBe(ticks(0.25))
    expect(P.AVANCE_ESQ).toBe(ticks(0.2)) // fenêtre rouge vif (§18)
    expect(P.RAYON_ESQ.large).toBeGreaterThanOrEqual(TUNING.recousu.coupDeTete.rush) // couvre la ruée de 5 m
    expect(P.R_TRI).toBeCloseTo(TUNING.playerSpeed * 1.2, 12) // 1,2 s à 5 m/s
    expect(P.R_DORE).toBeCloseTo(TUNING.playerSpeed * 2, 12) // 2 s à 5 m/s
    expect(P.VIE_SOIN).toBe(TUNING.vieMax / 2)
    expect(P.IMMINENT).toBe(TUNING.relevementTelegraph) // télégraphe de Relèvement (L3)
  })
  it('littéraux du squelette : esquive, Balayage, Charge', () => {
    expect(P.ESQ_SORTIE).toBe(TUNING.dodge.distance)
    expect(P.S4_FERVEUR).toBe(TUNING.balayage.cost)
    expect(P.S4_RAYON).toBe(TUNING.balayage.radius)
    expect(P.S5_FERVEUR).toBe(TUNING.charge.cost)
    expect(P.S5_DMAX).toBe(TUNING.charge.length)
  })
})

describe('paramètres de B3.md §6', () => {
  it('rayons de support, Charge, foule', () => {
    expect(P.R_PRIERE).toBe(TUNING.confesseur.prayerRadius)
    expect(P.R_ASSEMBLAGE).toBe(TUNING.chirurgien.assembleRadius)
    // 3 m d'absorption + reptation pendant une période d'absorption (1,5 s à 0,8 m/s)
    expect(P.R_ABSORPTION).toBeCloseTo(
      TUNING.porteur.absorbRadius + (TUNING.abattuCrawl * TUNING.porteur.absorbEvery) / 60,
      12,
    )
    expect(P.COUT_CHARGE).toBe(TUNING.charge.cost)
    expect(P.U_MAX).toBe(TUNING.charge.length - P.S3B_AU_DELA) // vise 1 m derrière avec une Charge de 7 m
    expect(P.FOULE_RAYON_BASE).toBe(TUNING.porteur.burstBaseRadius) // rayon d'éclatement 2 + stade
    expect(P.R4_STADE_MAX).toBe(TUNING.porteur.maxStage)
  })
})

describe('« la définition de c.action est une canalisation »', () => {
  it('CHANNEL_ACTIONS coïncide avec les ActionDef de kind canalisation de toutes les familles', () => {
    const lus = new Set<string>()
    for (const f of Object.values(FAMILIES)) {
      for (const [name, def] of Object.entries(f?.actions ?? {})) {
        expect(CHANNEL_ACTIONS.has(name), `${f?.kind}.${name}`).toBe(def.kind === 'canalisation')
        if (def.kind === 'canalisation') lus.add(name)
      }
    }
    expect([...lus].sort()).toEqual([...CHANNEL_ACTIONS].sort())
  })
})
