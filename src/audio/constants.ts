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
export const SOFT_FADE_S = 0.3
export const SOFT_FADE_FLOOR_DB = -60
// Changement de fichier d'une voix (halètement → cri → inspiration, étouffée ↔ libre) : fondu enchaîné à
// puissance constante, de la durée minimale d'une fin douce (aucune fin de fichier n'est plus brève).
export const XFADE_S = SOFT_END_MIN_S
// Coupure nette : rampe d'un quantum vers zéro, sous la limite de 2 quanta de B5.O3.
export const CUT_RAMP_S = QUANTUM / BENCH_RATE

// §8.2 et §19 : ambiance −6 dB pendant 0,4 s après la dernière mort d'une grappe.
export const DUCK_DB = -6
export const DUCK_HOLD_S = 0.4

// §26 : la nappe s'éteint en 2 s quand la zone est vidée.
export const NAPPE_OFF_S = 2
// Forme de l'extinction, u = temps écoulé / 2 s : la nappe garde l'essentiel de son niveau, puis s'éteint (gain 0
// exactement à 2 s). B5.O7 (d) demande le premier quantum silencieux dans [1,9 ; 2,1] s ; une rampe linéaire le fait
// tomber trop tôt dès que le fichier a des creux (mesuré : 1,885 s sur S1-cri).
export const nappeOffShape = (u: number): number => 1 - u ** 8
// §24 : au plus 40 créatures actives. La nappe a un niveau proportionnel à N, plein à 40.
export const N_MAX = 40

export const TICK_S = 1 / TICK_HZ
export const dbToGain = (db: number): number => 10 ** (db / 20)
export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : Number.NEGATIVE_INFINITY)
