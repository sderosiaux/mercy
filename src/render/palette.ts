// Seule source de couleurs du rendu, du HUD, du laboratoire et de la visionneuse.
// Les couleurs du §17 portent un sens de jeu ; §30.10 réserve ivoire, or, gris et rouge vif à ces sens.
// Toute autre couleur (chair des familles, Bourreau, fonds du HUD) est choisie loin d'elles : les tests de
// palette.test.ts vérifient les écarts CIEDE2000 exigés par B2 (O1 à O4).

export const PALETTE = {
  // Ivoire jauni : vivant à terre (liseré des Abattus), os, Excroissances. Le liseré bat entre creux et crête.
  ivoire: { base: 0xe9d9a4, creux: 0xcdbb88, crete: 0xfbefc4 },
  // Os mat (halo du Confesseur hors prière) : famille ivoire, plus sombre que le liseré.
  os: 0xb5a885, // réservé aux os (famille ivoire) : jamais sur une créature debout (audit §30.10)
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
  // Rouge brun : sang ancien (décalques après 2 s), qui fonce jusqu'au noir en séchant (§17.1). Télégraphes au sol
  // (§18), plus clairs que le sang.
  rougeBrun: { sangAncien: 0x4a1e18, sangNoir: 0x180908 },
  // Rouge vif : danger imminent (12 derniers ticks d'un télégraphe, sac au stade 3), sang frais pendant 2 s.
  rougeVif: 0xe3261c,
  // Vert maladif : prière du Confesseur. Jamais dans l'interface.
  vertMaladif: 0x9cb83e,
  // Noir profond : architecture, vide.
  noir: 0x0a0909,

  // Sans sens réservé : chair des familles (C* ≥ 20 pour que le vivant reste saturé sous la lumière).
  chair: {
    souriant: 0xc07c6c,
    souriantMasque: 0xd6d0c8, // porcelaine : blanche dans la nuit, ni ivoire sous les flammes (audit §30.10) ni bleue sous la lune
    recousu: 0xac7462,
    couture: 0xd9b0a8,
    porteur: 0x9c6658,
    sac: 0x6c3a4a,
    sacLueur: 0x8e2a3a, // cramoisi sombre : loin du rouge vif du stade 3 et de l'or
    confesseur: 0xb07074,
    chasuble: 0x5a3c74,
    chirurgien: 0xbc8676,
    tablier: 0x3a5a82,
    plaie: 0x6e1f24,
  },
  // Chair vivante des modèles de la Forge (E2) : même teinte que la chair des segments, chroma CIELAB × 1,4. Un corps
  // modélisé (ombres propres, plis, textures sombres) perd plus de chroma à l'écran qu'un segment plat : c'est la
  // cible vers laquelle le rendu déplace les matières ternes d'un vivant (classes.ts), pour qu'il ne se lise jamais
  // gris (B2.O1). Loin du rouge vif (chroma moitié moindre) et de l'or (teinte 40° contre 75°).
  chairModele: {
    souriant: 0xd1745f,
    recousu: 0xba6e55,
    porteur: 0xa9604d,
    confesseur: 0xc0676f,
    chirurgien: 0xca806b,
  },
  // Le Bourreau : cuir sombre bleuté, acier rouillé et taché de sang (loin du gris des morts, audit §30.10).
  bourreau: { cuir: 0x2a3247, capuche: 0x1b2030, peau: 0x8a6a5c, acier: 0x6e5046, manche: 0x3b2c22 },

  // Lumière (E1, ART_DIRECTION « Lumière ») : le noir domine ; seules sources chaudes, les flammes ; une lune froide
  // très faible. Les morts n'en prennent que la luminance (matière des morts, renderer) : aucune lumière teintée,
  // halo de prière compris, ne leur donne de chroma (B2.O1, arbitrage B3/B2).
  lumiere: {
    torche: 0xffa25a, // flamme de poix
    brasero: 0xff8c40, // braises
    chandelle: 0xffb46a, // cire
    reliquaire: 0xffa860, // chandelle du reliquaire, à la ceinture du Bourreau (planche bourreau-sheet)
    lune: 0x9fb4e0, // lune froide
    cielNuit: 0x2c3850, // ambiance hémisphérique, ciel
    solNuit: 0x0e0b09, // ambiance hémisphérique, sol
    neutre: 0xffffff, // lumière de jugement (galerie de la Forge, laboratoire) : sans chroma, pour lire formes et couleurs
  },

  // Flammes vues (émissives) : cœur et bord.
  flamme: { coeur: 0xffd89a, bord: 0xff5a14, braise: 0xc8320c },

  // Matières du décor et des corps (teintes multipliées par les albédos PBR de public/textures).
  matiere: {
    boue: 0x929088, // boue humide : teinte claire, multipliée par l'albédo brown_mud_03
    flaque: 0x2a3026, // eau stagnante verdâtre, très sombre
    terre: 0x958a7c, // murs de terre de l'ossuaire
    pierre: 0xc0bab4, // rebords, escalier
    bois: 0xb0a090, // pieux, gibet, planches
    fer: 0xc4b4aa, // fer rouillé
    cuir: 0x7a6656, // tablier, sangles, gants
    tissu: 0x6e5c4c, // robes, capuches, bannières, haillons
    osSale: 0x6e6452, // crânes et os de l'ossuaire : os terni et sale, loin de l'ivoire du liseré
    cire: 0xb8ac90, // chandelles
    corde: 0x6a5a40,
    silhouette: 0x4a4448, // spectateurs encapuchonnés du bord
  },

  // Vêtements des créatures vivantes : C* ≥ 20 (B2.O1 demande C* ≥ 15 sur le corps d'un vivant à l'écran).
  habit: {
    haillon: 0x7a4a30, // haillons du Souriant, du Porteur
    robeChirurgien: 0x5a4636, // robe sous le tablier
    capuche: 0x1c1a20, // capuche et cuir du Bourreau (très sombre : sous la chandelle, ni or ni ivoire)
    tablierBourreau: 0x6a5240, // tablier taché du Bourreau
    masqueFer: 0x463c36, // masque de fer du Bourreau, loin du gris des morts
    haloConfesseur: 0x5a4c42, // halo de fer du Confesseur hors prière : ni ivoire ni or (audit §30.10)
  },

  // Brouillard bas (ambiance lunaire) et étalonnage froid : teintes de l'ombre et de la lumière.
  brouillard: { ambiant: 0x232a38 },
  etalonnage: { ombres: 0x1e2a3a, lumieres: 0xfff2e0 },

  // Sang : chair à vif des éclats, os brisé des éclats contondants.
  gore: { chair: 0x5a1612, os: 0x9a8e78 },

  // Interface (§21) : ivoire sur noir, discrète. La Ferveur est du sang qui monte (§17.1, E7) : sang sombre au fond,
  // surface plus claire, reflet mouillé ; jamais le rouge vif (réservé, §30.10).
  hud: {
    fond: 0x0a0909,
    encre: 0xe9d9a4,
    vie: 0x4a1e18,
    ferveur: 0x6e1a14,
    ferveurFond: 0x260807,
    ferveurReflet: 0x9a3a2c,
    cadre: 0xe9d9a4,
  },

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
    `--hud-ferveur-fond: ${hexCss(PALETTE.hud.ferveurFond)}`,
    `--hud-ferveur-reflet: ${hexCss(PALETTE.hud.ferveurReflet)}`,
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
