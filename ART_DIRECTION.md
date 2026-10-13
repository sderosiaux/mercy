# MERCY : direction artistique

Ce document fixe ce que l'image de MERCY doit être. Il complète GAME_SPEC.md §17 à §20 et l'emporte sur eux pour le rendu, sauf sur les sens de jeu des couleurs, qui restent intouchables.

Cible fixée le 2026-10-12 : du réalisme à la Diablo (Diablo II Resurrected, Diablo III : ce qu'un navigateur peut porter), dans une ambiance ultra sombre et gore. Le gore stylisé du §17 et les créatures en blocs de P0 ne sont plus la cible.

## Références

Les quatre planches de `art/concepts/` font foi pour la forme, la matière et l'ambiance :

| Planche | Ce qu'elle fixe |
|---|---|
| `key-art-la-fosse.png` | Le décor de La Fosse, la caméra haute, la lumière de torches dans le noir, la boue qui reflète |
| `bourreau-sheet.png` | Le Bourreau : capuche, masque de fer, tablier taché, chaînes, Couperet et masse à pointes, reliquaire à la ceinture |
| `creatures-souriant-recousu.png` | Le Souriant (masque blanc souriant planté dans la chair, cou trop long, maigreur) et le Recousu (corps cousus, bras-marteau de fer, couronne de pointes) |
| `creatures-porteur-confesseur-chirurgien.png` | Le Porteur (sac translucide qui luit de rouge), le Confesseur (chasuble or terni, halo vert, encensoir), le Chirurgien (bras démesurés, ceinture de scies et d'aiguilles) |

Les planches sont des images fixes générées. Leur limite connue : le filtre du générateur refuse le gore explicite. Le jeu, lui, montre ce que les planches ne peuvent pas montrer (section Gore).

## Les sens de jeu passent avant le réalisme

Le réalisme ne doit jamais coûter la lecture d'un corps (B2, contrat gelé). Ces règles du §17 tiennent dans le rendu réaliste :

- ivoire : un vivant à terre. Il porte un liseré lumineux ivoire, discret comme le contour de survol de Diablo, qui bat à 1 Hz ;
- or terni : un Résistant, liseré doré ;
- gris cadavérique : un mort, désaturé en 0,3 s, sans liseré, parfaitement immobile ;
- rouge vif : danger imminent (sac du Porteur au stade 3) et sang frais pendant 2 s, rien d'autre ;
- vert maladif : la prière.

Chaque changement de rendu repasse les mesures machine de B2 (écarts de couleur, immobilité des morts) avant d'être accepté.

## Lumière

Le noir domine. Les seules sources chaudes sont les torches, les chandelles et les braseros, et elles vacillent. Une lune froide très faible dessine les silhouettes au loin. Brouillard bas au sol, plus dense dans les creux. Ombres portées des torches, occlusion ambiante dans les recoins. Tonalité ACES, étalonnage froid et désaturé, vignettage marqué, grain de film léger. Le bloom ne sert qu'aux flammes, au halo de prière et à la lueur du sac.

## Matières

Boue humide qui reflète les flammes, terre tassée, os ivoire jauni, bois pourri, fer rouillé, cuir usé, tissu déchiré, or terni, chair (peau pâle, translucidité légère, coutures), eau stagnante verdâtre. Toutes en PBR (albédo, normale, rugosité), sans couleur de matière en dur hors de la palette.

## La Fosse

Une fosse commune circulaire, à ciel ouvert, la nuit, telle que la planche la montre : murs de terre où sont enchâssés crânes et os comme dans un ossuaire, pieux de bois, gibet portant une cloche rouillée, chandelles et offrandes sur les rebords de pierre, bannières religieuses déchirées, escalier de pierre qui descend, braseros sur pieux. Sur le bord, des silhouettes encapuchonnées immobiles regardent sans réagir : elles disent le principe 5 (le monde trouve ça normal) sans un mot.

## Gore

Le sang est le signe de la libération, et le jeu le célèbre (GAME_SPEC §17.1, qui fait foi). Physique, persistant, abondant : en cas de doute, plus de sang.

- chaque coup qui touche fait saigner selon les dégâts et l'arme : le tranchant projette des arcs et des gerbes dans la direction du coup, le contondant écrase et projette en étoile avec des éclats ;
- la libération, au coup fatal : une gerbe sort de la plaie, une flaque s'étend pendant l'agonie et après, une brume rouge traverse la lumière des torches. La Sentence en donne le plus ;
- un Abattu saigne sous lui et laisse une traînée quand il rampe ; un Membre arraché part dans une fontaine ; un sac de Porteur qui éclate arrose tout autour ;
- le sang frais est rouge vif et mouillé pendant 2 s, il brille sous les flammes ; puis il fonce vers le rouge brun et le noir, sèche, devient mat, et reste. Les flaques se rejoignent jusqu'à faire un lac ;
- le Bourreau se tache à chaque libération et garde son sang ;
- les morts restent au sol, gris, dans leur sang ;
- seul le Délaissé meurt presque sans sang : le contraste fait partie du ton.

## Créatures et Bourreau

Silhouettes lisibles en vue haute, même dans une foule (§17) : le Souriant est vertical et maigre, le masque blanc est son signal ; le Recousu est large et asymétrique ; le Porteur est une bosse lumineuse ; le Confesseur est un triangle surmonté d'un halo ; le Chirurgien est long et penché. Le Bourreau est sombre, son tablier et son arme accrochent la lumière.

La source des modèles 3D est une décision ouverte (page de décision du 2026-10-12, question 1). Tant qu'elle n'est pas prise, le rendu habille les créatures existantes en segments avec les matières de ce document.

## Caméra

Décision ouverte (même page, question 4) : garder le §20 (environ 18 m de champ) ou se rapprocher façon Diablo IV (environ 12 m). Le moteur garde la caméra paramétrable.
