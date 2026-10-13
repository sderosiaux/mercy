// Valeurs du spec qui touchent au rendu et que src/sim/tuning.ts ne porte pas (requête C4 pour les y déplacer).
// Les valeurs de forme (épaisseurs, amplitudes) sont des choix de C4 et vivent dans les modules qui les utilisent.
import { ticks } from '../sim/index'

export const RENDER = {
  lisereHz: 1, // §7 L1 et D13 : le liseré ivoire, doré compris, bat à 1 Hz (réglage)
  sangFraisTicks: ticks(2), // §17 : sang frais en rouge vif pendant 2 s, puis rouge brun
  decalquesMax: 400, // §24, §17.1 : gouttelettes en vol et flaques qui s'étendent (le sang posé passe dans la couche du sol)
  mortsMax: 250, // §17, §24
  enfoncementTicks: ticks(3), // §26 : au-delà de 250 morts, les plus anciens s'enfoncent en 3 s
  camera: {
    fovDeg: 30, // §20 : environ 30° de champ vertical
    tiltDeg: 55, // §20 : inclinaison d'environ 55°
    yawDeg: 45, // §20 : rotation de 45°
    champM: 18, // §20 : environ 18 m de champ horizontal autour du joueur
    avanceMaxM: 2, // §20 : avance vers le curseur, 2 m au plus
    pousseeSentence: 0.1, // §18 : la caméra pousse de 10 % pendant une Sentence
  },
} as const
