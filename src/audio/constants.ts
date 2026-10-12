// Valeurs de règle du son (GAME_SPEC.md §19, §24, §26, L2, L4) et définitions de mesure du contrat B5.
// Aucune valeur « réglage » ici : celles de la simulation restent dans src/sim/tuning.ts.
import { TICK_HZ } from '../sim/index'

// B5 « Définitions communes » : quantum de 128 échantillons à 48 000 Hz.
export const BENCH_RATE = 48_000
export const QUANTUM = 128
export const QUANTUM_S = QUANTUM / BENCH_RATE
export const SILENCE_DB = -80

// §19 : 24 emplacements de cri, un par corps.
export const VOICE_SLOTS = 24
// B5.O8 (c) : rang garanti et rang au-delà duquel une voix tenue est forcément volée.
export const GUARANTEED_RANK = 20
export const MAX_HELD_RANK = 28

// §19 : « fondu d'au moins 80 ms » pour toute fin sans mort ; B5 mesure T30 ≥ 80 ms.
export const SOFT_END_MIN_S = 0.08
// Fondu des fins sans mort : rampe exponentielle de 0 à −60 dB, puis arrêt. T30 (de −10 à −40 dB) vaut la moitié
// de la durée, soit 150 ms nominaux. Marge mesurée : avec 240 ms (120 ms nominaux), un vol de voix de S-sat est
// tombé à 90,7 ms, les variations de niveau du cri d'un quantum à l'autre mangeant jusqu'à 30 ms. Pendant ce
// fondu, l'emplacement reste occupé (B5.O8 a) : 18 ticks ; sur S-sat, aucun corps des 20 premiers n'attend.
// Durée exacte : 112 quanta (298,7 ms). Au banc, l'instant d'un tick est arrondi au quantum supérieur, si bien que
// 18 ticks séparent deux instants de 112 ou 113 quanta ; un fondu de 300 ms (112,5 quanta) débordait de 1,33 ms
// sur la voix suivante du même emplacement une fois sur deux (B5.O8 a, 16 ticks à 25 voix au verdict B5 v2).
export const SOFT_FADE_S = (112 * QUANTUM) / BENCH_RATE
export const SOFT_FADE_FLOOR_DB = -60
// Changement de fichier d'une voix (halètement → cri → inspiration, étouffée ↔ libre) : fondu enchaîné à
// puissance constante, de la durée minimale d'une fin douce (aucune fin de fichier n'est plus brève).
export const XFADE_S = SOFT_END_MIN_S
// Coupure nette : rampe d'un quantum vers zéro, sous la limite de 2 quanta de B5.O3.
export const CUT_RAMP_S = QUANTUM / BENCH_RATE

// §8.2 et §19 : ambiance −6 dB pendant 0,4 s après la dernière mort d'une grappe.
export const DUCK_DB = -6
export const DUCK_HOLD_S = 0.4

// Ducking des autres voix (décision du concepteur du 2026-10-12, D-fix3, tour 2 de B5.O10) : après une mort, les voix
// des autres corps baissent aussi, sur un étage commun placé après les prises des emplacements (avant le bus des
// créatures). Ni coupure ni vol : la voix continue, son emplacement et son journal ne changent pas. Valeurs choisies
// par la mesure de O10 (rapport D-fix3) ; ce ne sont pas des valeurs du spec.
export const VOICE_DUCK_DB = -12
// Descente : la durée minimale d'une fin douce (§19, 80 ms). Seule la voix qui meurt tombe net au tick de la mort ;
// les autres descendent en fondu et ont atteint la profondeur avant la fenêtre de O10 (T_d + 100 ms).
export const VOICE_DUCK_ATTACK_S = SOFT_END_MIN_S
// Tenue : comme l'ambiance, jusqu'à 0,4 s après la dernière mort d'une grappe (fin de la fenêtre de O10).
export const VOICE_DUCK_HOLD_S = DUCK_HOLD_S
// Remontée en fondu, pour que les voix ne reviennent pas toutes d'un coup.
export const VOICE_DUCK_RELEASE_S = SOFT_END_MIN_S

// Marge du master (D-fix3). Les fichiers sont normalisés près de la pleine échelle (crêtes à −1 dBFS pour les
// halètements, le gargouillis, les coutures ; nappe pleine à N = 40) et sommés à gain 1 ; à moins d'un mètre, une
// voix n'est pas atténuée par la distance. Au banc de B5 (403 rendus), la crête du master montait jusqu'à +7,4 dBFS
// (115 rendus au-dessus de 0 dBFS), ce qui écrête en direct. Gain fixe du master : crête la plus haute mesurée
// ramenée sous −1 dBFS. Toutes les prises de mesure (emplacements, autres sources, créatures, nappe, ambiance) sont
// en amont : seul le niveau absolu du master change, réglé une fois par le volume du joueur (protocole B5 §11).
export const MASTER_DB = -8.5

// §26 : la nappe s'éteint en 2 s quand la zone est vidée.
export const NAPPE_OFF_S = 2
// Forme de l'extinction, u = temps écoulé / 2 s : la nappe garde l'essentiel de son niveau, puis s'éteint (gain 0
// exactement à 2 s). B5.O7 (d) demande le premier quantum silencieux dans [1,9 ; 2,1] s ; une rampe linéaire le fait
// tomber trop tôt dès que le fichier a des creux (mesuré : 1,885 s sur S1-cri).
export const nappeOffShape = (u: number): number => 1 - u ** 8
// §24 : au plus 40 créatures actives. La nappe a un niveau proportionnel à N, plein à 40.
export const N_MAX = 40

// Revue de code M5 : horizon du journal I1 en jeu (le banc garde tout). 300 s, la durée maximale d'une partie
// mesurée par les outils de dev (délai du mode aveugle, src/dev/blind.ts) : l'export de télémétrie d'une telle
// partie garde tout son journal audio ; au-delà, seules les 300 dernières secondes restent.
export const GAME_JOURNAL_TICKS = 300 * TICK_HZ

export const TICK_S = 1 / TICK_HZ
export const dbToGain = (db: number): number => 10 ** (db / 20)
export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : Number.NEGATIVE_INFINITY)
