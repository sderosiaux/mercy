// Valeurs de règle du son (GAME_SPEC.md §19, §24, §26, L2, L4) et définitions de mesure du contrat B5.
// Aucune valeur « réglage » ici : celles de la simulation restent dans src/sim/tuning.ts.
import { TICK_HZ, TUNING } from '../sim/index'

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
// Ticks pendant lesquels un emplacement en fondu reste occupé : le fondu, arrondi au tick supérieur (18).
export const FADE_TICKS = Math.ceil(SOFT_FADE_S * TICK_HZ)
export const SOFT_FADE_FLOOR_DB = -60
// Changement de fichier d'une voix (halètement → cri → inspiration, étouffée ↔ libre) : fondu enchaîné à
// puissance constante, de la durée minimale d'une fin douce (aucune fin de fichier n'est plus brève).
export const XFADE_S = SOFT_END_MIN_S
// Rampe anti-clic d'un quantum (arrêt d'une lecture déjà à zéro, bords du ducking de l'ambiance).
export const CUT_RAMP_S = QUANTUM / BENCH_RATE

// Agonie (L4, §19, §30.3 ; décision du concepteur du 2026-10-12) : la durée est un réglage de la simulation, partagé
// avec le rendu (TUNING.agonie, 24 ticks). À la mort, la voix s'étrangle en râle dès l'image du coup, les autres
// sources de la créature s'éteignent, et tout s'est tu à la fin de l'agonie.
export const AGONIE_TICKS = TUNING.agonie
export const AGONIE_S = AGONIE_TICKS / TICK_HZ
// Fin programmée de tout ce qui sonne encore de la créature : un quantum avant la fin de l'agonie. Au banc, l'instant
// du tick d + 24 tombe exactement 150 quanta après celui du tick d (800 échantillons par tick) ; le quantum qui
// commence à T_d + 0,4 s est donc silencieux, et l'emplacement est libre pour la voix suivante.
export const AGONIE_END_S = AGONIE_S - QUANTUM_S
// Pistes d'agonie (option 2 de l'orchestrateur, 2026-10-12) : les râles jouent hors des 24 emplacements de voix, une piste
// par mort audible pendant l'agonie. Au plus 24 morts audibles par tick (rang ≤ 24) ; le nombre de pistes borne les
// râles simultanés sur 24 ticks. Valeur choisie par la mesure (rapport D-agonie-audio), pas une valeur du spec.
export const AGONY_LANES = 32
// Les valeurs qui suivent ne sont pas dans le spec : ce sont des choix de lecture, consignés ici.
// Passage au râle : la couche vivante (halètement, cri, inspiration, cri étouffé) descend à zéro en STRANGLE_S dans son
// emplacement, depuis son gain réel, pendant que sa vitesse de lecture tombe (le cri « s'étrangle », §8.2) ; elle est
// éteinte bien avant la fin du premier quart de l'agonie (B5.O3 a). Le râle démarre à T_d sur sa piste et monte en
// AGONY_ATTACK_S : il est à pleine voix dans l'image du coup (B5.O3 b : à L_1 − 10 dB avant T_d + 6 quanta).
export const STRANGLE_S = 0.06
export const STRANGLE_RATE = 0.75 // −5 demi-tons à la fin du fondu
export const AGONY_ATTACK_S = 2 * QUANTUM_S
// Le râle tient, puis s'éteint : décroissance exponentielle jusqu'à −60 dB à la fin programmée, puis zéro. Elle commence
// peu après la fin du premier quart de l'agonie : le niveau décroît de quart en quart (B5.O3 c) et le râle s'entend
// encore dans la seconde moitié (O3 d). Mesuré sur les 15 râles : de 0,12 à 0,13 s, tous passent ces deux critères aux
// vitesses 0,94, 1 et 1,06 ; plus tôt, un râle qui décroît de lui-même passe sous L_1 − 30 dB avant la seconde moitié ;
// plus tard, un râle qui enfle passe au-dessus de L_1 dans le deuxième quart.
export const AGONY_DECAY_FROM_S = 0.125
// Vitesse de lecture du râle tirée de (graine, id) dans [1 − 0,06 ; 1 + 0,06] (±1 demi-ton) : deux corps tués dans la
// même image avec le même fichier ne s'additionnent pas en phase (une horde ne meurt pas à l'unisson). B5 I3 : jamais
// Math.random.
export const AGONY_RATE_SPREAD = 0.06
// Gain (dB) que le lecteur applique au râle, t secondes après l'image du coup : montée en AGONY_ATTACK_S, tenue,
// décroissance exponentielle jusqu'à −60 dB à la fin programmée, puis silence. Même forme que
// l'automatisation de graph.ts ; sert à mesurer et à régler les fichiers de râle tels qu'on les entend (o11.ts).
export const agonyEnvelopeDb = (t: number): number => {
  if (t < 0 || t >= AGONIE_END_S) return Number.NEGATIVE_INFINITY
  if (t < AGONY_ATTACK_S) {
    const g = Math.sin((Math.PI / 2) * (t / AGONY_ATTACK_S))
    return g > 0 ? 20 * Math.log10(g) : Number.NEGATIVE_INFINITY
  }
  if (t < AGONY_DECAY_FROM_S) return 0
  return (SOFT_FADE_FLOOR_DB * (t - AGONY_DECAY_FROM_S)) / (AGONIE_END_S - AGONY_DECAY_FROM_S)
}

// §8.2 et §19 : nappe et ambiance −10 dB de la mort jusqu'à 0,4 s après la fin du râle (fin de l'agonie). La tenue après
// la dernière mort d'une grappe vaut donc l'agonie plus 0,4 s. −6 dB à l'origine ; −10 dB depuis la décision du
// 2026-10-12 (B5 A22), sur la mesure de O10 par grappe (classe 1 : 87,4 % à −6 dB, 91,7 % simulés à −10 dB).
export const DUCK_DB = -10
export const DUCK_HOLD_S = 0.4
export const DUCK_HOLD_AFTER_DEATH_S = AGONIE_S + DUCK_HOLD_S

// Ducking des autres voix (décision du concepteur du 2026-10-12, D-fix3, tour 2 de B5.O10) : après une mort, les voix
// des autres corps baissent aussi, sur un étage commun placé après les prises des emplacements (avant le bus des
// créatures). Ni coupure ni vol : la voix continue, son emplacement et son journal ne changent pas. Valeurs choisies
// par la mesure de O10 (rapport D-fix3) ; ce ne sont pas des valeurs du spec.
export const VOICE_DUCK_DB = -12
// Descente en 40 ms (rampe linéaire en amplitude ; −11 dB atteints à 38 ms) : la profondeur est atteinte pendant que la
// couche vivante du mort s'éteint encore (STRANGLE_S), donc mesurable sur le bus des voix même quand le mort était la
// seule voix (B5.O5 g : −11 dB avant T_premier + A_g/4). Mesuré au banc avec 80 ms : la couche vivante se taisait à
// 60 ms, avant que l'étage n'atteigne −11 dB, et la profondeur n'apparaissait qu'avec la voix suivante. Ce n'est pas
// une fin : la voix continue, baissée.
export const VOICE_DUCK_ATTACK_S = 0.04
// Tenue : comme l'ambiance, jusqu'à 0,4 s après la fin du râle de la dernière mort d'une grappe. Le râle lui-même
// n'est pas baissé : il ne passe pas par l'étage des voix (graph.ts).
export const VOICE_DUCK_HOLD_S = DUCK_HOLD_AFTER_DEATH_S
// Remontée en fondu, pour que les voix ne reviennent pas toutes d'un coup.
export const VOICE_DUCK_RELEASE_S = SOFT_END_MIN_S

// Marge du master (D-fix3). Les fichiers sont normalisés près de la pleine échelle (crêtes à −1 dBFS pour les
// halètements, le gargouillis, les coutures ; nappe pleine à N = 40) et sommés à gain 1 ; à moins d'un mètre, une
// voix n'est pas atténuée par la distance. Au banc de B5 (403 rendus), la crête du master montait jusqu'à +7,4 dBFS
// (115 rendus au-dessus de 0 dBFS), ce qui écrête en direct. Gain fixe du master : crête la plus haute mesurée
// ramenée sous −1 dBFS. Toutes les prises de mesure (emplacements, autres sources, créatures, nappe, ambiance) sont
// en amont : seul le niveau absolu du master change, réglé une fois par le volume du joueur (protocole B5 §11).
// −8,5 dB avant l'agonie ; les râles, qui ne sont pas baissés par la mise à mort, ajoutent jusqu'à 1,4 dB en crête
// (D-agonie-audio, 403 rendus : +0,27 dBFS sur V6 graine 1, 12 râles ensemble) : −10 dB ramènent la crête sous −1 dBFS.
export const MASTER_DB = -10

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
