// Seule source de couleurs du rendu, du HUD, du laboratoire et de la visionneuse.
// Les couleurs du §17 portent un sens de jeu ; §30.10 réserve ivoire, or, gris et rouge vif à ces sens.
// Toute autre couleur (chair des familles, Bourreau, fonds du HUD) est choisie loin d'elles : les tests de
// palette.test.ts vérifient les écarts CIEDE2000 exigés par B2 (O1 à O4).

export const PALETTE = {
  // Ivoire jauni : vivant à terre (liseré des Abattus), os, Excroissances. Le liseré bat entre creux et crête.
  ivoire: { base: 0xe9d9a4, creux: 0xcdbb88, crete: 0xfbefc4 },
  // Os mat (halo du Confesseur hors prière) : famille ivoire, plus sombre que le liseré.
  os: 0xb5a885,
  // Or terni : Résistant (liseré doré, marques), ornement.
  or: { base: 0xb07a0c, creux: 0x9a6a08, crete: 0xc28c1c },
  // Gris cadavérique : mort (désaturation), brume, pierre. Jamais une créature vivante.
  gris: {
    cadaverique: 0x7a7c7a, // albédo d'un mort
    cadaveriqueClair: 0x8e908e, // parties claires d'un mort (masque, os, halo), toujours sans chroma
    cadaveriqueSombre: 0x6c6e6c, // sac, chasuble d'un mort
    pierre: 0x312f2c, // sol de l'arène
    pierreJoint: 0x262422, // joints des dalles
    brume: 0x8a8c8a,
  },
  // Rouge brun : sang ancien (décalques après 2 s). Télégraphes au sol (§18), plus clairs que le sang.
  rougeBrun: { sangAncien: 0x4a1e18, telegraphe: 0x8a3424 },
  // Rouge vif : danger imminent (12 derniers ticks d'un télégraphe, sac au stade 3), sang frais pendant 2 s.
  rougeVif: 0xe3261c,
  // Vert maladif : prière du Confesseur. Jamais dans l'interface.
  vertMaladif: 0x9cb83e,
  // Noir profond : architecture, vide.
  noir: 0x0a0909,

  // Sans sens réservé : chair des familles (C* ≥ 20 pour que le vivant reste saturé sous la lumière).
  chair: {
    souriant: 0xc07c6c,
    souriantMasque: 0xeeebe3,
    recousu: 0x8a5a80,
    couture: 0xd9b0a8,
    porteur: 0x9a5c6a,
    sac: 0x6c3a4a,
    sacLueur: 0xd0708c,
    confesseur: 0xb88070,
    chasuble: 0x5a3c74,
    chirurgien: 0xbc8676,
    tablier: 0x3a5a82,
    plaie: 0x6e1f24,
  },
  // Le Bourreau : cuir sombre bleuté et acier, distinct de toute créature.
  bourreau: { cuir: 0x2a3247, capuche: 0x1b2030, peau: 0x8a6a5c, acier: 0x8f99a6, manche: 0x3b2c22 },

  // Lumière neutre : une lumière teintée donnerait de la chroma aux morts (B2.O1).
  lumiere: { soleil: 0xffffff, ciel: 0xffffff, sol: 0xffffff },

  // Interface (§21) : ivoire sur noir, discrète.
  hud: { fond: 0x0a0909, encre: 0xe9d9a4, vie: 0x4a1e18, ferveur: 0xb07a0c, cadre: 0xe9d9a4 },

  // Constantes techniques, pas des couleurs vues : multiplicateur neutre des matières instanciées (la couleur
  // vient de chaque instance), fond de la passe d'identification (id 0, aucun rôle).
  technique: { neutre: 0xffffff, fondId: 0x000000 },

  // Instruments de mesure, hors de la palette du §17 (B2 §11 : marqueur des sondes).
  mesure: { marqueur: 0x1e5bff, fixation: 0xe9d9a4, ecran: 0x000000 },
} as const

export const hexCss = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

// Variables CSS du HUD, de la visionneuse et du laboratoire : aucune couleur écrite ailleurs.
export const cssVariables = (): string =>
  [
    `--ivoire: ${hexCss(PALETTE.ivoire.base)}`,
    `--or: ${hexCss(PALETTE.or.base)}`,
    `--rouge-brun: ${hexCss(PALETTE.rougeBrun.sangAncien)}`,
    `--rouge-vif: ${hexCss(PALETTE.rougeVif)}`,
    `--noir: ${hexCss(PALETTE.noir)}`,
    `--hud-fond: ${hexCss(PALETTE.hud.fond)}`,
    `--hud-encre: ${hexCss(PALETTE.hud.encre)}`,
    `--hud-vie: ${hexCss(PALETTE.hud.vie)}`,
    `--hud-ferveur: ${hexCss(PALETTE.hud.ferveur)}`,
    `--hud-cadre: ${hexCss(PALETTE.hud.cadre)}`,
    `--marqueur: ${hexCss(PALETTE.mesure.marqueur)}`,
    `--fixation: ${hexCss(PALETTE.mesure.fixation)}`,
    `--ecran: ${hexCss(PALETTE.mesure.ecran)}`,
  ].join(';\n  ')

// Mélange linéaire en sRGB 8 bits, arrondi : sert aux battements et au passage au gris.
export const mixHex = (a: number, b: number, t: number): number => {
  const k = Math.min(1, Math.max(0, t))
  const ch = (shift: number): number => {
    const x = (a >> shift) & 255
    const y = (b >> shift) & 255
    return Math.round(x + (y - x) * k)
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
