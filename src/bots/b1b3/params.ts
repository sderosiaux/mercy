// Paramètres gelés des politiques de B1 et B3, recopiés tels quels des contrats (.mercy/contracts/_frozen/).
// Ce sont des constantes de politique, pas des réglages : B1.md §6 et §7.3 interdisent de les régler après le gel,
// donc elles ne suivent pas tuning.ts. params.test.ts vérifie qu'elles valent encore la règle du spec dont le
// contrat les dérive : si un réglage bouge, ce test casse et un humain décide s'il amende la politique.
import type { Size } from '../../sim/index'

// B1.md §6, « Paramètres ».
export const PORTEE = 2.2 // m, portée du Couperet (§8.5)
export const ARRET = 1.7 // m, PORTEE − 0,5 m
export const ARRET_F = 2.0 // m, sous la portée de Sentence de 2,5 m (L4)
export const LATENCE = 15 // ticks, 250 ms
export const AVANCE_ESQ = 12 // ticks, fenêtre rouge vif de 0,2 s avant l'impact (§18)
export const RAYON_ESQ: Readonly<Record<Size, number>> = { small: 3.5, large: 6.0 } // m
export const R_TRI = 6 // m
export const R_DORE = 10 // m
export const VIE_SOIN = 50
export const IMMINENT = 90 // ticks, télégraphe de Relèvement (1,5 s)

// B1.md §6, valeurs littérales du pseudo-code (prédicats et squelette), sans nom dans le contrat.
export const MEMBRE_PROCHE = 3 // m, imminent(c) d'un Membre errant : distance à c.unionOf
export const ESQ_SORTIE = 4 // m, S1 : « si P + 4·dir sort de l'arène »
export const S4_FERVEUR = 25 // S4 : Ferveur ≥ 25
export const S4_RAYON = 4 // m, S4 : d(c) ≤ 4
export const S4_NOMBRE = 3 // S4 : au moins 3 créatures d'intérêt
export const S5_FERVEUR = 35 // S5 : Ferveur ≥ 35
export const S5_DMIN = 4 // m, S5 : 4 < d(cible)
export const S5_DMAX = 7 // m, S5 : d(cible) ≤ 7

// B3.md §6, « Paramètres propres à B3 ».
export const R_PRIERE = 8.0 // m
export const R_ASSEMBLAGE = 2.0 // m
export const R_ABSORPTION = 4.2 // m
export const FOULE_MIN = 3
export const U_MIN = 2.5 // m
export const U_MAX = 6.0 // m
export const COUT_CHARGE = 35

// B3.md §6, valeurs littérales du pseudo-code.
export const S3B_AU_DELA = 1.0 // m, S3b : aim = cible.pos + 1,0 · unitaire(cible.pos − P)
export const FOULE_RAYON_BASE = 2 // m, foule(q) : distance ≤ 2 + stade(q)
export const R2_STADE_MIN = 1 // R2 : stade(c) ≥ 1
export const R4_STADE_MAX = 3 // R4 : Q = Porteurs de stade < 3
