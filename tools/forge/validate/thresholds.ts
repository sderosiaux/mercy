// Seuils de la validation. Ce sont des seuils de mesure de la Forge, pas des réglages de jeu.
//
// Unité de référence : le pixel le plus fin que le joueur peut voir. Caméra la plus proche envisagée
// (ART_DIRECTION, question 4 ouverte : 12 m de champ horizontal au lieu des 18 m du §20) sur le viewport le plus
// large des contrats (1440 px, B2) : 12 / 1440 = 8,3 mm au sol par pixel. Avec 18 m, le pixel vaut 12,5 mm : tout
// ce qui passe ici passe a fortiori à la caméra du §20.
export const PIXEL_M = 12 / 1440

// Boucle sans saut : l'écart de pose entre la dernière et la première image (déplacement maximal d'un os)
// ne dépasse pas 1,5 fois le pas ordinaire du clip (95e centile des déplacements d'une image à la suivante à
// 60 i/s), avec un plancher d'un demi-pixel. Raison : une couture de boucle ne se voit pas si elle n'est pas plus
// grande qu'un pas normal du même mouvement ; 1,5 laisse la marge des variations de vitesse dans le cycle. Le
// plancher couvre les boucles presque immobiles, où un demi-pixel est sous la rastérisation.
export const LOOP_STEP_FACTOR = 1.5
export const LOOP_FLOOR_M = 0.5 * PIXEL_M

// Pieds plantés : un pied est au sol quand sa hauteur est à moins de 2 cm de son point le plus bas du clip. Pendant
// un appui, il ne glisse pas de plus de 2 pixels (16,7 mm) : 1 pixel se perd dans le tremblement du vivant (§18),
// 2 pixels sont le plus petit déplacement de bord que B2 compte comme visible (B2.O6).
export const FOOT_CONTACT_M = 0.02
export const FOOT_SLIDE_MAX_M = 2 * PIXEL_M
export const MIN_CONTACT_FRAMES = 3

// Vitesse de lecture : un clip calé sur la simulation (impact au tick actif, fenêtre de Relèvement, foulée à la
// vitesse de marche) n'est pas joué à plus de 2 fois ni à moins de la moitié de sa vitesse : au-delà, le geste
// capturé ne se lit plus comme ce geste (accéléré, ou ralenti) ; il faut un autre clip, pas un étirement.
export const RATE_MIN = 0.5
export const RATE_MAX = 2

// Interruption (L7, demande de l'humain) : la réaction a pris la pose en 2 images au plus à 60 i/s. « Prise » :
// écart à la réaction jouée seule sous 1 mm (bruit numérique d'un fondu achevé).
export const INTERRUPT_MAX_FRAMES = 2
export const POSE_EPS_M = 0.001

// Mort (L4, §18, §30.3) : une pose figée ne bouge plus d'un millimètre, mesuré sur 10 s (600 images).
export const FREEZE_MAX_M = 0.001
export const FREEZE_FRAMES = 600

// Tremblement du vivant (§18, B2.O6) : mesuré, sans verdict. B2.O6 exige du rendu un déplacement de 2 px à
// 1024 × 768 dans chaque fenêtre de 30 images ; le tremblement procédural de C4 s'ajoute au clip. La galerie et
// le manifeste donnent ce que le clip apporte seul.
export const TREMBLE_WINDOW_FRAMES = 30

// Une créature qui avance d'elle-même dans une boucle (mouvement de racine) n'est pas « sur place » : la
// simulation la déplace déjà. Au-delà de 10 cm/s de dérive du bassin, la boucle est refusée.
export const ROOT_DRIFT_MAX_MPS = 0.1
