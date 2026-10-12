# MERCY : spécification de la tranche verticale

Source : `MERCY_GDD_v0.1.md` (vision du jeu complet, texte tronqué en section 7).
Périmètre : tranche verticale. Un Acte I resserré, un archétype (le Bourreau), un boss (la Mère des Bienheureux). Durée visée d'une première partie : 70 à 90 minutes.
Plateforme : navigateur, ordinateur de bureau, souris + clavier, 3D isométrique.

Pour tout ce qu'elle couvre, cette spec fait autorité sur le GDD. Le GDD reste la vision des cinq actes. Les valeurs chiffrées marquées « réglage » sont des points de départ à ajuster en test. Les règles, elles, font partie du contrat (section 30).

La tranche doit prouver quatre hypothèses :

1. Un monde où rien ne meurt peut produire un hack & slash plus riche que Diablo au lieu d'un Diablo plus lent.
2. Le corps à terre, disputé entre le joueur et les ennemis, suffit à créer des décisions dans chaque combat.
3. L'horreur peut tenir sans textures réalistes, par le mouvement, les proportions, le son et la lumière.
4. Donner la mort peut être à la fois l'acte le plus brutal et le plus tendre du jeu, sans jauge de morale.

---

## 0. Écarts avec le GDD v0.1

| GDD v0.1 | Cette spec | Raison |
|---|---|---|
| Les ennemis ordinaires meurent directement | Tout ce qui tombe est Abattu. Un coup de plus achève les ordinaires | Le monde est immortel. Si les monstres meurent seuls, le Porte-Mort n'a rien de singulier en jeu. Les corps à terre deviennent la ressource que le joueur et les ennemis se disputent |
| Sentence réservée aux élites vulnérables | Sentence possible sur tout Abattu, obligatoire sur les Résistants, seule source de soin en combat | La Sentence gagne une raison d'exister hors élites. L'Achèvement reste plus rapide, donc le rythme tient |
| Quatre archétypes | Bourreau seul | Le Bourreau éprouve les plus gros risques : impact, démembrement, Sentence |
| Loot aléatoire, sets, légendaires | Trois armes placées et quatre Stigmates | Le loot aléatoire est un système connu qui ne prouve rien de neuf ici. Les Stigmates changent des règles, pas des chiffres |
| Transformation visuelle du héros (4.4) | Devient le système de progression : on gagne un Stigmate en donnant la Sentence à une élite | Un système au lieu de deux |
| Potions (convention du genre, le GDD n'en parle pas) | Aucune potion | La Miséricorde devient la survie |
| Ennemis indifférents, suppliants (section 6) | Loi d'Indifférence (alerte au bruit seulement) et Délaissés | Des règles plutôt que des scripts |
| Créatures fusionnées (3.5) | Loi d'Union : un tout et ses parties partagent une seule mort | Rend la fusion jouable et prépare le boss |
| Gore réaliste extrême | Gore stylisé. L'horreur passe par le mouvement, la silhouette, le son et la lumière | Navigateur et géométrie produite par code : le réalisme de texture est hors de portée, la mise en scène ne l'est pas |
| Le joueur renaît au Reliquaire | « Seule la mort est permanente » : tout ce qui n'est pas mort revient | La loi du monde devient le modèle de sauvegarde |

---

## 1. Concept

Un hack & slash isométrique où rien ne meurt sauf par ta main : chaque ennemi que tu fais tomber reste un corps que le monde peut relever, recoudre ou faire exploser, jusqu'à ce que tu lui donnes la mort.

## 2. Fantasme du joueur

Je suis la seule fin possible dans un monde qui recycle tout. Je frappe pour faire tomber, je tue pour faire taire.

En termes de jeu : je contrôle un combattant lourd et rapide, et je gère en continu un stock de corps qui crient, rampent et reviennent. Ma puissance se mesure au silence que je laisse derrière moi.

## 3. Expérience visée

Rythme d'une rencontre :

```
observation calme (les créatures prient, fauchent, ne me voient pas)
  -> choix de l'ouverture (qui, où, à quel bruit)
  -> chaos (les corps tombent, crient, rampent vers ceux qui les réparent)
  -> tri (qui finir d'abord, qui laisser, qui sentencier pour me soigner)
  -> silence
```

Le silence final récompense et informe à la fois. Une zone vidée se tait complètement.

Rythme de la tranche : fausse quiétude (village) -> puissance (les Blés) -> malaise (l'Hospice) -> maîtrise sous pression (l'Église) -> révélation (la Mère).

## 4. Principes de design

1. Rien ne meurt sauf par le Porte-Mort. Ni les explosions, ni les chutes, ni les pièges. Aucune exception.
2. Le corps à terre est la ressource centrale. Toute famille d'ennemis importante en fait quelque chose.
3. Le silence est à la fois la récompense et l'information. Un cri qui s'étrangle en râle puis se tait signifie toujours une mort donnée.
4. Diablo d'abord. Les hordes tombent vite. La profondeur vient des corps et des combinaisons de familles, jamais d'ennemis-éponges.
5. Le monde trouve l'anormal normal. Les créatures ne réagissent qu'au bruit et au contact, jamais à ce qu'elles voient : un Chirurgien peut continuer d'opérer un cadavre.
6. Miséricorde et tactique vont dans le même sens. Donner la mort à un suppliant prive aussi l'ennemi de munitions. Le jeu n'a pas de jauge de morale.

---

## 5. Boucle de jeu

Boucle courte (2 à 5 secondes) :

```
frapper -> le corps tombe (Abattu) -> il halète, puis crie
   -> l'achever (un coup, silence)
   -> ou lui donner la Sentence (plus lent, soigne)
   -> ou l'ignorer (il rampe vers un support, il se relève plus fort)
```

Boucle de rencontre (30 secondes à 3 minutes) :

```
repérer (Indifférents, corps présents, supports)
  -> ouvrir le combat
  -> abattre (Frappe, Rites)
  -> trier les corps (achever, sentencier, couper le support)
  -> silence -> avancer
```

Boucle de zone (10 à 20 minutes) :

```
traverser la zone -> élite -> Sentence d'élite -> Stigmate -> Reliquaire (nouveau Rite, choix des Stigmates)
```

## 6. Contrôles et verbes

| Entrée | Verbe | Rôle |
|---|---|---|
| WASD (ZQSD en AZERTY) | Se déplacer | 5 m/s |
| Souris | Viser | Le personnage frappe vers le curseur |
| Clic gauche (maintenu = enchaîne) | Frappe | Combo de 3 coups. Génère la Ferveur |
| Espace | Esquive | Roulade, invulnérable, 2 charges |
| F | Sentence | Donner la mort à un Abattu proche du curseur |
| Clic droit | Rite : Balayage | Coût 25 Ferveur. Disponible dès le départ |
| A (AZERTY) / Q (QWERTY) | Rite : Charge | Coût 35. Débloqué au Reliquaire 2 |
| R | Rite : Glas | Coût 100. Débloqué au Reliquaire 3 |
| E | Interagir | Reliquaire, ramasser une arme |
| X | Changer d'arme | Seulement si aucune créature hostile à moins de 15 m |
| Échap | Pause | Registre, options |

Les touches sont lues par position physique : le même schéma marche en AZERTY et en QWERTY. Le déplacement au clic façon Diablo II est écarté. L'esquive et la lecture des télégraphes de boss exigent un contrôle direct du mouvement.

---

## 7. Lois du monde

Sept lois. Tout le reste du jeu en découle.

### L1. Chair et Abattu

- Règle : les dégâts réduisent la Chair. À 0, la créature devient Abattue. Elle ne meurt pas.
- Condition : Chair ≤ 0, quelle que soit la source (arme, explosion, chute, Rite).
- Changement d'état : elle tombe, n'attaque plus, ne bloque plus les déplacements. Elle rampe à 0,8 m/s vers le support ennemi non mort le plus proche à moins de 12 m (Chirurgien, Confesseur, Porteur, Mère), même si ce support est lui-même à terre. Sans support à portée, elle se tord sur place.
- Conséquence visible : pose au sol, liseré ivoire qui pulse comme un battement (1 Hz, réglage ; le liseré doré des Résistants bat de la même façon), plaies visibles.
- Usage joueur : un Abattu ne fait pas de dégâts, mais rien n'est réglé.
- Interactions : L2, L3, L4, toutes les familles « support ».
- Cas limites : une explosion projette un Abattu de 2 à 4 m, il reste Abattu. Les dégâts reçus par un Abattu ne changent pas sa Chair. S'ils viennent du joueur et que l'Abattu est ordinaire, ils l'achèvent (L4).

### L2. Cri

- Règle : un Abattu halète pendant 0,5 s, puis crie en continu.
- Changement d'état : le cri alerte les créatures en Rituel à moins de 8 m (L7).
- Conséquence visible et audible : voix spatialisée propre à chaque corps. Le joueur localise les Abattus à l'oreille.
- Usage joueur : achever dans la demi-seconde garde le combat discret. Laisser crier un corps attire volontairement un groupe.
- Interactions : L7, Stigmate Auréole, Délaissés (ils chuchotent, rayon d'alerte nul).
- Cas limites : au-delà de 24 voix simultanées, les plus lointaines se fondent dans la nappe de chœur de zone (section 19). Les règles d'alerte s'appliquent toujours à tous les corps.

### L3. Relèvement et Cicatrices

- Règle : un Abattu ordinaire se relève après 6 s, un Résistant après 8 s (réglage).
- Télégraphe : pendant les 1,5 dernières secondes, le corps plante ses mains et pousse. Le cri devient une longue inspiration.
- Changement d'état : Chair et membres restaurés, +1 Cicatrice (maximum 3). Chaque Cicatrice multiplie la Chair max par 1,5 et la taille par 1,08, ajoute une couture visible et un membre remis au mauvais endroit.
- À 3 Cicatrices, la créature devient Résistante (marques dorées). Les coups ne l'achèvent plus, seule la Sentence la tue.
- Accélérateurs : la prière du Confesseur relève sur-le-champ, le Chirurgien recoud. Les deux ajoutent aussi une Cicatrice.
- Usage joueur : ignorer un corps se paie plus tard. Une horde négligée produit ses propres élites.
- Cas limites : les Délaissés ne se relèvent jamais seuls. Une créature à 3 Cicatrices ne grandit plus.

### L4. La Mort

- Règle : seul le Porte-Mort donne la mort, de deux façons.
- Achèvement : toute instance de dégâts du joueur (Frappe, Rite, Ruade) sur un Abattu ordinaire le tue. Instantané, silencieux, +4 Ferveur.
- Sentence (F) : sur tout Abattu (ordinaire, Résistant, Délaissé) à moins de 2,5 m du joueur, le plus proche du curseur. Le joueur glisse jusqu'à la cible et joue une exécution. Il est invulnérable pendant l'animation, mais le monde continue autour de lui.

| Cible | Durée | Soin | Ferveur | Bonus |
|---|---|---|---|---|
| Ordinaire | 0,6 s | 8 % Vie | +10 | |
| Résistant | 1,0 s | 30 % Vie | +40 | Stigmate (élite nommée, la première fois), derniers mots (créatures nommées) |
| Délaissé | 0,8 s, animation douce, presque sans sang | 0 | 0 | Derniers mots, entrée au Registre |

- Conséquence visible : la mort ouvre une agonie courte (réglage : 0,4 s). Dans l'image du coup, le liseré s'éteint et le cri s'étrangle en râle ; pendant l'agonie, le corps s'effondre (debout, il tombe ; à terre, un dernier spasme) et passe au gris cadavérique. À la fin de l'agonie, le râle s'est tu et le corps ne bouge plus du tout. Les marques dorées d'un Résistant passent au gris avec le reste. Il reste au sol comme décor, définitivement, et ne bloque personne.
- Rien ne relève un mort. Aucun support ne peut l'utiliser.
- Cas limites : une explosion de Porteur déclenchée par le joueur n'achève personne (la source est le Porteur). Un coup sur un Résistant Abattu produit un son métallique et un éclat doré, sans effet.

### L5. Union

- Règle : une créature et ses parties partagent une seule mort.
- Sont des parties : les Membres errants détachés d'elle, les corps absorbés dans le sac d'un Porteur, les corps assemblés en Recousu par un Chirurgien, les fidèles nés de la Mère, les Gisants reliés à elle.
- Donner la mort au tout tue toutes ses parties, où qu'elles soient. Elles entrent en agonie dans la même image : leurs cris s'étranglent ensemble en râles, elles s'effondrent et grisent ensemble, puis se taisent et se figent ensemble.
- Donner la mort à une partie ne tue que cette partie. Le tout ne pourra plus la récupérer, mais le Relèvement fait repousser les membres perdus.
- Usage joueur : abattre un Porteur chargé puis l'achever fait taire tout ce qu'il porte. Tuer un Recousu immobilise ses bras coupés.

### L6. Seule la mort est permanente

- Règle : quand le Porte-Mort meurt, son corps se reconstitue au dernier Reliquaire touché. Toute créature qui n'est pas morte revient à son état et à sa position d'origine, Cicatrices comprises. Toute créature morte reste morte.
- Le joueur garde ses armes, ses Stigmates, ses Rites et son Registre. La Ferveur retombe à 0.
- Rien ne réapparaît jamais par ailleurs. Une zone vidée reste vide et silencieuse.
- Les créatures créées en cours de combat (Recousus assemblés, fidèles de la Mère) disparaissent à la réinitialisation.

### L7. Indifférence

- États : Rituel -> Hostile. Le retour en Rituel n'arrive qu'avec la réinitialisation de L6.
- Une créature en Rituel devient Hostile si : elle subit des dégâts ; le joueur passe à moins de 2,5 m (6 m pour la Mère) ; elle entend un cri d'Abattu (8 m) ; elle entend un bruit fort (explosion de Porteur 15 m, Cloche 25 m, invective d'un Confesseur hostile 10 m, porte de la nef 30 m).
- Aucun déclencheur visuel. Une créature en Rituel peut assister à une exécution silencieuse à 5 m et continuer de prier.
- Transition : la tête pivote d'un coup sec vers le joueur (0,4 s), puis la créature attaque.
- Interruption, règle commune : les petites créatures (Souriant, Porteur, Confesseur, Chirurgien, Membre errant) sont interrompues par n'importe quel coup. Les grandes (Recousu, Veilleur, élites grandes, Mère) ne le sont que par le 3e coup d'une arme contondante, la Charge, la rupture d'une Excroissance ou le sectionnement du membre qui attaque. Toute canalisation (prière, opération, Berceuse) est interrompue par n'importe quel coup qui touche la créature, quelle que soit sa taille, même si ce coup ne change pas sa Chair (coup métallique sur un Résistant, éclatement sur un Abattu).

---

## 8. Mécaniques

### 8.1 Combat du Bourreau

Frappe (clic gauche) : combo de 3 coups vers le curseur. Le 3e coup est lourd et repousse. Les caractéristiques dépendent de l'arme (8.5). Chaque coup qui touche gèle l'image 50 à 90 ms selon le poids de l'arme et secoue légèrement la caméra (option désactivable).

Esquive (Espace) : roulade de 4 m dans la direction du mouvement (vers le curseur si immobile), 0,3 s d'invulnérabilité, 2 charges, 1,5 s de recharge par charge. Esquive parfaite : si une attaque ennemie aurait touché pendant les 0,2 premières secondes, +10 Ferveur et gel de 80 ms.

Rites :

| Rite | Touche | Coût | Effet | Raison d'être |
|---|---|---|---|---|
| Balayage | Clic droit | 25 | Rotation à 360°, rayon 4 m, 25 dégâts du type de l'arme. Achève les Abattus ordinaires touchés | Nettoyer foule et corps d'un geste |
| Charge | A/Q | 35 | Ruée de 7 m en 0,35 s, 30 dégâts à tout ce qui est sur la ligne, repousse sur les côtés de 2 m. Traverse les créatures. Interrompt toute canalisation | Atteindre un support derrière une foule, passer dans le dos d'un Porteur |
| Glas | R | 100 | Frappe au sol (rayon 5 m, 40 dégâts), puis Sentence en chaîne sur jusqu'à 8 Abattus à moins de 8 m, Résistants compris, 0,25 s par corps, invulnérable, +5 % Vie par corps | Moment de pic : transformer un champ de corps en silence |

Chaque Rite a 0,8 s de récupération (animation), pas de temps de recharge.

### 8.2 Sentence

Définie en L4. Ce qui compte pour le joueur :

- Sur un ordinaire, la Sentence est un choix : l'Achèvement est plus rapide et donne de la Ferveur, la Sentence soigne mais immobilise 0,6 s dans un combat qui continue.
- Sur un Résistant, elle est obligatoire et la fenêtre dure 8 s.
- Sur un Délaissé, elle ne rapporte rien en combat. Elle rapporte un nom, une phrase, et prive les supports d'un corps.
- Animations par combinaison : type d'arme (tranchant, contondant) × taille (petite, grande), plus Délaissé, plus Mère. La règle sonore est identique partout : le cri s'étrangle en râle dès l'image du coup fatal et se tait à la fin de l'agonie, et l'ambiance baisse de 6 dB jusqu'à 0,4 s après la fin du râle pour que le silence s'entende.

### 8.3 Ferveur

Jauge de 0 à 100.

| Source | Gain |
|---|---|
| Coup de Frappe qui touche | +2 par créature, plafond +6 par coup |
| Achèvement | +4 |
| Sentence ordinaire / Résistant | +10 / +40 |
| Esquive parfaite | +10 |

Après 4 s sans gain, la Ferveur baisse de 10 par seconde. Elle ne sert qu'aux Rites. Elle récompense l'enchaînement : le joueur qui achève vite et sentencie les élites au bon moment vit en Balayage permanent ; celui qui hésite reste à la Frappe.

### 8.4 Anatomie

Deux règles génériques, placées créature par créature.

Membre (grandes créatures seulement) : chaque membre a ses propres PV. Les dégâts infligés à une grande créature pendant qu'un membre attaque s'appliquent aussi à ce membre.

- Arme tranchante, PV du membre à 0 : le membre est sectionné et devient un Membre errant, petit Abattu ordinaire qui rampe à 1,2 m/s vers son propriétaire et se recoud au contact en 1 s. Un coup l'achève.
- Arme contondante, PV du membre à 0 : le membre est brisé. Il pend, l'attaque correspondante disparaît jusqu'au prochain Relèvement. Pas de Membre errant.
- Une créature privée de tous ses membres d'attaque passe à son attaque de secours (Coup de tête du Recousu).

Excroissance : plaque d'os ou ornement doré avec ses propres PV. Tant qu'au moins une Excroissance tient, la Chair de la créature subit −60 % de dégâts. Multiplicateurs contre les Excroissances : contondant ×2, tranchant ×0,5, explosion de Porteur ×3. À la rupture, la créature vacille 2 s (ce qui interrompt une grande créature) et projette des éclats. Fissures en trois stades visibles.

Le choix d'arme change donc la forme du combat. Le Couperet désarme vite mais crée des corps à gérer (Membres errants). La Masse désarme pour longtemps, proprement, et casse les carapaces.

### 8.5 Armes

| Arme | Type | Coup (dégâts / durée) | 3e coup | Arc / portée | Particularité | Où |
|---|---|---|---|---|---|---|
| Couperet du Bourreau | Tranchant | 12 / 0,35 s | 18, recul 1 m | 120° / 2,2 m | Sectionne | Départ |
| Masse de la Confrérie | Contondant | 20 / 0,55 s | 30, recul 3 m, interrompt les grandes | 100° / 2,4 m | Brise, ×2 sur Excroissances | Hospice, réserve |
| Cloche de la Dernière Aube | Contondant | 26 / 0,70 s | 40, recul 3 m, interrompt les grandes | 150° / 2,8 m | Chaque Sentence sonne : les créatures ordinaires à ≤ 50 % de Chair dans un rayon de 6 m deviennent Abattues, et tout ce qui est en Rituel à moins de 25 m devient Hostile | Clocher (optionnel) |

Les dégâts par seconde sont proches (34 à 37, réglage). Les armes diffèrent par le comportement, pas par la puissance. Le recul de la Masse a un prix : il éparpille les Abattus, plus durs à achever d'un même geste.

### 8.6 Stigmates

On les obtient en donnant la Sentence à une élite nommée. Trois emplacements. On les équipe et on les retire aux Reliquaires seulement. Chaque Stigmate est visible sur le modèle du Bourreau et change une règle, avec un prix.

| Stigmate | Source | Effet | Prix | Règle touchée |
|---|---|---|---|---|
| Os du Veilleur (dos, plaques osseuses) | Veilleur des Blés | L'Esquive devient une Ruade de 3 m qui abat toute petite créature ordinaire traversée et achève les Abattus traversés. Dégâts subis −25 % | La Ruade n'a pas d'invulnérabilité | L'esquive passe de la défense à l'attaque |
| Coutures du Recousu (bras recousu) | Frère Gaspard | Les Abattus et Membres errants à moins de 10 m rampent vers toi au lieu des supports | Chaque corps accroché (< 1 m) te ralentit de 8 %, jusqu'à −40 % | Inversion de L1 : les corps viennent à toi |
| Auréole du Confesseur (halo déformé) | Père Anselme | Sentence possible jusqu'à 6 m (canalisation 1 s, sans invulnérabilité, interrompue si tu es touché). Les Abattus à moins de 6 m de toi ne crient pas | Les Achèvements ne donnent plus de Ferveur | L2 et L4 |
| Ventre de la Nourrice (ventre gonflé, bouches) | La Nourrice (optionnelle) | Chaque Achèvement soigne 2 % | Les Sentences sur ordinaires ne soignent plus | Le soin passe de la Sentence à l'Achèvement |

Sans les zones optionnelles, le joueur obtient trois Stigmates pour trois emplacements, et peut quand même laisser un emplacement vide (l'Os est un vrai pari). Avec l'ossuaire, il doit choisir trois Stigmates parmi quatre.

### 8.7 Vie et soin

Vie : 100. Aucune régénération, aucune potion. On se soigne par la Sentence (8 % ou 30 %), le Glas (5 % par corps), le Stigmate Ventre, et le retour complet à chaque Reliquaire.

Conséquence voulue : le joueur blessé cherche des corps à terre. Quand la Vie est basse, on achète sa survie au prix de quelques dixièmes de seconde immobiles au milieu du combat.

### 8.8 Reliquaires

Châsses dorées contenant un crâne. Toucher (E) : point de reconstitution, Vie pleine, sauvegarde, écran des Stigmates. Quatre dans la tranche. Les Rites Charge et Glas se réveillent aux Reliquaires 2 et 3 : carte au nom du Rite, icône qui s'allume, pas de texte d'explication.

### 8.9 Derniers mots et Registre

Les Délaissés, les Gisants, les élites et la Mère ont un nom et une dernière phrase, affichée en sous-titre au moment de leur Sentence. C'est le seul canal de lore de la tranche, avec quelques répliques d'Anselme et de la Mère.

Le Registre (menu pause) liste le total des morts données et, pour les créatures nommées, le nom et la phrase entendue. Une créature nommée achevée par un coup plutôt que par une Sentence entre au Registre sans phrase, avec la mention « sans un mot ». Le joueur apprend ainsi que la façon de tuer compte, sans qu'on le lui dise.

### 8.10 Bestiaire de la tranche

| Famille | Taille | Chair | Vitesse | Attaques (dégâts, télégraphe) | Rapport aux corps | Rituel | Signature de mouvement |
|---|---|---|---|---|---|---|---|
| Souriant | Petite | 20 | 4,5 m/s | Morsure en fente (6, 0,4 s : la tête bascule à 90°) | Fournit les corps | Danse, fauche, mange, en synchronie parfaite | Buste immobile, jambes trop rapides. Abattu, il garde son sourire et rampe sur le dos |
| Recousu | Grande | 160 | 2,5 m/s | Marteau, bras droit (22, 0,9 s, cône 2,5 m). Empoignade, bras gauche (1,0 s, saisie puis projection à 4 m, 15). Coup de tête si plus de bras (18, ruée 5 m) | Ses bras deviennent des Membres errants. Il peut naître de corps assemblés | Debout, se balance, recoud sa propre peau | Le bras traîne en retard, puis fouette |
| Porteur | Petite | 60 | 2 m/s (3 au stade 3) | Bousculade (5). Éclatement (voir dessous) | Absorbe les Abattus ordinaires et les Délaissés | Mange des corps | Se tourne toujours pour garder son sac loin du joueur |
| Confesseur | Petite | 40 | 3 m/s | Bâton (8). Prière (canalisation 2,5 s) | Relève les Abattus | Prie devant un autel, bénit les Délaissés | Garde 7 à 10 m. Continue de prier une fois Abattu |
| Chirurgien | Petite | 50 | 4 m/s | Scalpel (10), seulement acculé | Recoud et assemble | Soigne des Délaissés sur des lits | Long, penché, fuit le joueur à moins de 4 m |
| Délaissé | Petite | n/a | 0 | Aucune | Est un corps | Gît, chuchote | Abattu permanent : pas de Relèvement autonome, pas de cri |

Porteur. Sac sur le dos, en trois stades. Tant que son sac n'est pas plein, il marche vers l'Abattu le plus proche à moins de 12 m, en pivotant à 90°/s au plus (réglage) pour garder son sac loin du joueur. Il absorbe un Abattu ordinaire ou un Délaissé à moins de 3 m toutes les 1,5 s, jusqu'à 3. Un corps absorbé garde une voix étouffée dans le sac jusqu'à sa mort (agonie commune, L5) ou son expulsion. Au stade 3, il marche sur le joueur et éclate au contact ou après 4 s. Un coup porté dans son dos (arc arrière de 120°) fait éclater le sac sur-le-champ, à son stade actuel. De face, les coups touchent son corps.

Éclatement : rayon 2 m + 1 m par stade. Dégâts : 10 + 10 par stade, au joueur comme aux créatures. Toute petite créature ordinaire dans le rayon est abattue, quelle que soit sa Chair. Les grandes créatures et les Résistants subissent les dégâts, vacillent 1,5 s, et leurs Excroissances prennent ×3. Les corps absorbés sont expulsés en Abattus, le Porteur vide tombe Abattu. D'après L5, abattre un Porteur chargé de face puis l'achever tue tout ce qu'il contient.

Confesseur. S'il y a au moins 2 Abattus à moins de 8 m (lui-même compris s'il est à terre), il canalise une Prière de 2,5 s : un halo vert maladif grandit, le chant monte. À la fin, tous les Abattus ordinaires à moins de 8 m se relèvent avec +1 Cicatrice, Délaissés compris (ils se relèvent en Souriants hostiles). Les Résistants restent à terre, sauf sous la prière d'Anselme. Recharge 10 s, qui part aussi quand la prière est interrompue. Une prière interrompue ne se coupe jamais net : le chant s'éteint en fondu (au moins 80 ms) sur un son d'étranglement distinct. Il peut prier en étant lui-même Abattu, et sa prière le relève avec les autres. Son invective hostile alerte à 10 m. Il parle pendant le combat.

Chirurgien. Priorités quand il est Hostile : (a) recoudre un Membre errant à un Recousu proche ou relever sur-le-champ un Recousu Abattu (+1 Cicatrice) ; (b) assembler deux ou trois Abattus ordinaires ou Délaissés situés à moins de 2 m les uns des autres en un Recousu de 80 Chair par corps consommé ; (c) garder ses distances. Chaque opération est une canalisation de 3 s, accompagnée d'un bruit de scie qui monte.

### 8.11 Élites

Toutes sont Résistantes. Une barre d'élite s'affiche en haut de l'écran quand le combat commence.

| Élite | Base | Chair | Excroissances | Spécificités | Stigmate |
|---|---|---|---|---|---|
| Le Veilleur des Blés | Unique, grande | 600 | 2 genouillères d'os (150 PV) | Immobile, pivote. Fauchage (bras-faux, 2,0 s, arc de 180° sur 12 m, 35, renverse 1 s). Piétinement (1,5 s, rayon 4 m, 25). Lancer de corps (saisit un Abattu à moins de 6 m, le lance sur le joueur, 1,2 s, 20, zone de 2 m, le corps reste Abattu à l'arrivée). Une genouillère rompue : il s'agenouille 4 s sans attaquer | Os |
| Frère Gaspard | Recousu | 400 | Aucune | 3 bras : Marteau, Empoignade, bras de Chirurgien greffé (estoc 0,5 s, 12). Deux Chirurgiens attitrés le recousent | Coutures |
| Père Anselme | Confesseur | 200 | Chasuble dorée (100 PV) | Prière de rayon 12 m, canalisation 2 s, qui relève aussi les Résistants. Prie en étant Abattu. Déjà rencontré au village | Auréole |
| La Nourrice | Porteur, grande | 250 | Aucune | Sac de 5 stades, absorbe à 5 m toutes les 1 s. Après l'éclatement, elle reste debout et recommence. En Rituel, elle mange, éclate et recommence en boucle | Ventre |

---

## 9. Matrice d'interactions

| Système A | Système B | Résultat |
|---|---|---|
| Abattu (L1) | Cri (L2) | Le combat se propage par le bruit. Un combat propre reste petit |
| Abattu | Confesseur | Un champ de corps devient une vague relevée d'un coup. Tuer le Confesseur ou vider le champ d'abord |
| Abattu | Chirurgien | Trois petits corps deviennent une brute. Le tri des corps décide de la composition de la horde |
| Abattu | Porteur | Les corps chargent une bombe. Le joueur peut la désamorcer (abattre de face, achever : L5) ou l'utiliser (frapper dans le dos près d'une foule) |
| Éclatement de Porteur | Créatures ordinaires | La menace abat aussi les ennemis. Un obstacle devient un outil |
| Éclatement | Excroissance | ×3 : un Porteur bien placé brise la carapace d'une élite |
| Charge | Porteur | La Charge traverse : elle met le joueur dans le dos du Porteur |
| Charge | Confesseur, Chirurgien | Elle interrompt une canalisation derrière une foule |
| Relèvement (L3) | Cicatrices | Négliger fabrique des Résistants que seule la Sentence tue |
| Tranchant | Membres | Désarme vite, crée des Membres errants (plus de corps, plus de Ferveur à prendre) |
| Membre errant | Chirurgien | Il recoud au lieu d'assembler. Couper sans achever nourrit le support |
| Contondant | Excroissance | Casse les carapaces, mais le recul éparpille les corps |
| Union (L5) | Recousu assemblé | L'achever tue les corps dont il est fait |
| Union | Mère | Sa mort fait taire la crypte entière |
| Sentence | Vie | Seul soin en combat : le joueur blessé va chercher des corps |
| Sentence | Cloche | Chaque mort donnée abat les blessés autour, et réveille tout à 25 m |
| Délaissés | Supports | Les suppliants sont des munitions ennemies. Leur donner la mort avant le combat désarme la salle |
| Indifférence (L7) | Exécution silencieuse | On peut tuer sous les yeux d'une créature en Rituel sans qu'elle réagisse |
| Coutures | Supports | Les corps rampent vers toi, plus vers eux. Les Chirurgiens n'ont plus rien à opérer |
| Coutures | Balayage | Les corps se regroupent autour de toi pour un Balayage, mais te ralentissent |
| Os (Ruade) | Foule de Souriants | Traverser une foule l'abat, sans invulnérabilité |
| Auréole | Cri | Une bulle de silence autour de toi : les combats ne se propagent plus |
| Ventre | Achèvement | Le soin passe du geste lent au geste rapide |
| L6 | Préparation | Les Délaissés et Gisants tués avant une mort restent morts : chaque tentative de boss part d'un terrain plus propre |

---

## 10. Progression

La minute 60 diffère de la minute 5 parce que le joueur ne lit plus le même champ de bataille. À la minute 5, il voit des ennemis. À la minute 60, il voit des corps, des supports, des distances de cri et des munitions.

Échelle de compréhension :

| Étape | Ce que le joueur comprend | Où |
|---|---|---|
| 1 | Donner la mort fait taire. Le monde le remarque à peine | Village, Jehanne |
| 2 | Ce qui tombe ne meurt pas | Les Blés, premier combat |
| 3 | Un coup de plus finit. Le silence | Les Blés |
| 4 | Ignorés, ils reviennent, recousus et plus forts | Les Blés |
| 5 | Le bruit attire, je choisis mes combats | Les Blés |
| 6 | Les corps nourrissent l'ennemi (Porteur), et sa bombe abat aussi mes ennemis | Les Blés, moulin |
| 7 | Certains ne meurent que par la Sentence | Veilleur |
| 8 | Les corps se démontent et se remontent | Hospice |
| 9 | Tuer le tout fait taire les parties (Union) | Hospice, Recousu |
| 10 | Ma miséricorde désarme l'ennemi (Délaissés, Chirurgiens) | Hospice, dortoirs |
| 11 | Un Stigmate retourne une règle ennemie contre lui | Après Gaspard |
| 12 | Même à terre, certains agissent (Confesseur) | Église |
| 13 | Le bruit est une arme à double tranchant | Clocher, Cloche |
| 14 | Le boss est un corps fait de corps : tout ce que je sais s'applique à une seule créature | Crypte |

Ce qui change au fil de la tranche :

| Axe | Début | Fin |
|---|---|---|
| Verbes | Frappe, Esquive, Sentence, Balayage | + Charge, Glas, 3 Stigmates qui modifient des verbes |
| Armes | Couperet | Couperet, Masse, Cloche (optionnelle) |
| Familles par combat | 1 | 3 ou 4 qui se combinent |
| Rôle des corps | Obstacle | Ressource disputée, munition, bombe, soin |
| Ton | Fête, coucher de soleil | Crypte, silence total |
| Apparence du Bourreau | Humaine | Jusqu'à 3 mutations visibles |

Pas d'expérience ni de niveaux de personnage. Pas de bonus en pourcentage. Les chiffres du joueur ne bougent qu'à travers les armes et les Stigmates.

---

## 11. Structure des niveaux

Zones construites à la main, reliées en ligne, avec des boucles internes et deux branches optionnelles. Pas de génération procédurale dans la tranche.

```
Z0 Sainte-Miséricorde (R1, sans combat)
  -> Z1 Les Blés (Veilleur) -> R2 [Charge]
  -> Z2 L'Hospice (Masse, Frère Gaspard) -> R3 [Glas]
  -> Z3 L'Église et ses souterrains (Père Anselme)
        + branche Clocher (Cloche, optionnelle)
        + branche Ossuaire (La Nourrice, optionnelle)
  -> R4 -> Z4 La Crypte de la Mère (boss)
  -> Épilogue (retour sur la place)
```

Contraintes communes : depuis chaque Reliquaire, le retour jusqu'à l'élite suivante prend moins de 90 s de marche. Chaque zone a un point de repère visible de loin (Veilleur, clocher, cheminée de l'hospice) parce qu'il n'y a pas de minicarte. Chaque zone a un plan de beauté (section 17).

---

## 12. Niveaux représentatifs

### Z0. Sainte-Miséricorde, la fête

- État de départ : crépuscule, place du village, musique de fête. Douze Souriants dansent en cercle, parfaitement synchronisés. Une bannière « DCC ». Le Père Anselme se tient sur le parvis. Quatre Délaissés : Jehanne sous une table, trois dans les ruelles. Les armes ne peuvent pas sortir ici (le Bourreau garde la lame au dos).
- Ce que le joueur croit : une fête de village un peu étrange.
- Élément nouveau : la Sentence.
- Première expérience probable : Jehanne rampe vers lui et chuchote « Toi… tu sens la fin. Je t'en prie. » Seule invite textuelle du jeu : « F ».
- Découverte : Jehanne se tait d'un coup. La musique s'arrête au milieu d'une mesure. Les danseurs s'immobilisent et tournent la tête vers le joueur, tous en même temps. Trois secondes de silence, puis la musique reprend et la danse aussi, comme si rien ne s'était passé. Sous-titre : « Sept cents ans. Merci. »
- Interaction intéressante : les trois autres Délaissés des ruelles. Le joueur découvre que la Sentence marche sur n'importe quel corps à terre et que chacun laisse une phrase.
- Surprise possible : Anselme : « Tu as fait taire Jehanne. La Mère voudra te voir. » L'église est scellée par une porte de chair cousue.
- Test de maîtrise : aucun.
- État final : Reliquaire 1 touché, sortie nord vers les Blés.
- Ce que le joueur comprend : il donne une mort que personne d'autre ne peut donner, et le monde trouve ça à peine digne d'attention.

### Z1. Les Blés

- État de départ : trois parcelles de blé au soleil couchant, un moulin, un pont. Au loin, le Veilleur, silhouette d'épouvantail géant. Sa tête suit le joueur dès 40 m.
- Ce que le joueur croit : un Diablo. On tape, ça meurt.
- Élément nouveau : L1, L2, L3, puis le Porteur.
- Parcelle 1 : deux groupes de 3 Souriants fauchent, à 14 m l'un de l'autre. Première expérience probable : le joueur frappe un Souriant. Il tombe, halète, crie. Son groupe se retourne. Le second groupe ne bouge pas (hors des 8 m), sauf si un corps a été projeté vers lui.
- Découverte (vers 1 min de combat) : un Souriant laissé à terre se relève avec une couture et un bras mal placé. En frappant un corps par hasard, le joueur entend le silence. Il comprend l'Achèvement.
- Parcelle 2 : 8 Souriants et un Porteur qui broute deux Délaissés près d'une meule. Pendant le combat, le Porteur avale les corps, son sac gonfle, son gargouillis monte en hauteur. Il éclate et abat tout le monde, Souriants compris.
- Moulin : 6 Souriants, 1 Porteur, 2 Délaissés. Le joueur peut désormais provoquer l'éclatement exprès (de dos), ou abattre le Porteur de face et l'achever pour faire taire tout ce qu'il contient.
- Le pont, combat d'élite : le Veilleur et 6 Souriants moissonneurs en Rituel, 1 Porteur. Le Fauchage lui donne une allonge énorme, l'esquive se lit au télégraphe de 2 s. Les cris rameutent les moissonneurs, et leurs corps à terre deviennent ses projectiles. Avec le Couperet seul, briser les genouillères est lent (×0,5). Un Porteur qui éclate à ses pieds les brise d'un coup (×3).
- Surprise : le Veilleur lance un corps encore vivant, qui crie pendant son vol.
- Test de maîtrise : vaincre le Veilleur en gardant le champ propre (pas de munitions) ou en utilisant le Porteur.
- État final : Sentence du Veilleur (1 s, Stigmate Os, derniers mots : « J'ai regardé le blé pousser sept cents fois. »). Reliquaire 2, la Charge se réveille.
- Ce que le joueur comprend : le corps à terre est l'unité de base du jeu.

### Z2. L'Hospice

- État de départ : cloître carré avec un jardin, quatre ailes : deux dortoirs (16 Délaissés dans des lits), une salle d'opérations, une réserve, une chapelle. 5 Chirurgiens font leur ronde entre les lits. 6 Recousus, 12 Souriants (soignants).
- Ce que le joueur croit : il sait gérer les corps.
- Élément nouveau : le Chirurgien, le Recousu, les membres.
- Première expérience probable : le joueur coupe un bras de Recousu. Le bras rampe vers son maître et se recoud.
- Découverte : achever le Recousu immobilise ses bras coupés (L5). Ensuite, dans le dortoir, un Chirurgien Hostile assemble trois patients en un Recousu sous les yeux du joueur.
- Interaction intéressante : si le joueur entre dans un dortoir sans faire de bruit, il peut donner la mort aux patients un par un. Les Chirurgiens en Rituel continuent leur ronde et opèrent même les cadavres. Chaque patient tué, c'est un nom au Registre et un corps de moins pour l'assemblage. Ça coûte du temps. Une erreur de bruit transforme le dortoir en atelier de Recousus.
- Réserve : la Masse. Premier vrai choix d'arme.
- Chapelle, combat d'élite : Frère Gaspard et ses deux Chirurgiens. Les tuer d'abord, ou les ignorer et sectionner vite, en sachant que chaque bras coupé est un bras qu'ils recousent.
- Surprise : le bras de Chirurgien greffé à Gaspard. Le joueur reconnaît une famille dans une autre.
- Test de maîtrise : vaincre Gaspard sans qu'un seul bras soit recousu.
- État final : Stigmate Coutures, Reliquaire 3, le Glas se réveille. Un passage souterrain mène à l'église.
- Ce que le joueur comprend : sa miséricorde est aussi une stratégie, et les ennemis ont une économie dont il peut couper les vivres.

### Z3. L'Église et ses souterrains

- État de départ : arrivée par la sacristie. Deux bas-côtés, la nef, deux branches (escalier du clocher vers le haut, ossuaire vers le bas).
- Élément nouveau : le Confesseur.
- Bas-côté A : 2 Confesseurs et 8 Souriants. Première expérience probable : le joueur abat la horde, les Confesseurs prient, tout se relève avec une Cicatrice. Découverte : n'importe quel coup interrompt la prière, et la Charge passe à travers la foule pour l'interrompre.
- Bas-côté B : 1 Confesseur, 1 Porteur, 6 Souriants, 1 Recousu. Combinaisons : l'éclatement du Porteur abat le Confesseur. Le Confesseur à terre continue de prier, et sa prière relève les corps que l'éclatement vient de disperser.
- Clocher (optionnel) : escalier en spirale, 2 Confesseurs et 6 Souriants qui sonnent en Rituel. En haut, la Cloche de la Dernière Aube.
- Ossuaire (optionnel) : murs d'os, 8 Délaissés, la Nourrice qui mange, éclate et recommence. Le joueur observe le cycle et engage juste après un éclatement, sac vide. Stigmate Ventre.
- Nef, combat d'élite : le Père Anselme prêche devant 14 Délaissés couchés sur les bancs. La seule entrée est une porte de bronze qui grince : un bruit fort qui porte à 30 m. Anselme passe Hostile dès qu'elle s'ouvre (« Te voilà. »), donc aucune préparation silencieuse n'est possible. Sa prière de 12 m relève les Délaissés en Souriants. Le joueur choisit en temps réel : foncer sur Anselme (qui prie même à terre), ou vider les bancs (Balayage, Glas).
- Surprise : la nef dorée est le plan le plus beau de la tranche, et le combat le plus chargé en corps.
- Test de maîtrise : vaincre Anselme en ne le laissant achever qu'une seule prière au plus.
- État final : Stigmate Auréole, descente vers la crypte, Reliquaire 4.
- Ce que le joueur comprend : le combat se gagne sur les corps autant que sur les ennemis debout.

### Z4. La Crypte de la Mère (boss)

Arène circulaire de 30 m. Piliers d'os. Douze alcôves, un Gisant dans chacune : Délaissés reliés à la Mère par des cordons de chair (ses parties, L5). Au centre, la Mère des Bienheureux assise, 6 m, couverte d'ornements de reliquaire. Un seul rai de lumière tombe sur elle.

Ouverture. La Mère est Indifférente. Elle parle avec tendresse (« Approche. Tu as la voix de mon premier enfant. »). Elle ne devient Hostile que si on la frappe ou si le joueur passe à moins de 6 m. Le joueur peut d'abord donner la mort aux Gisants, un par un. Elle commente sans bouger (« Tu fais taire mes petits… »). Ça ne coûte que du temps, et tout Gisant tué reste mort même si le joueur meurt (L6). Chaque Gisant a ses derniers mots, et ensemble ils racontent ce qu'elle est.

Phase 1, Bénédiction (Chair 1200 → 720). Assise, elle pivote. Trois ornements-Excroissances de 150 PV : reliquaire de poitrine (accessible de face), retable dorsal (de dos), couronne (accessible seulement quand elle se penche). Deux bras fusionnés de 60 PV.
- Étreinte : les bras balaient 7 m devant elle sur 120°, 1,2 s, 25.
- Enfantement : toutes les 15 s, 4 fidèles (Souriants, ses parties) sortent de son ventre.
- Appel : toutes les 20 s, une plainte maternelle (instantanée, pas une canalisation). Pendant 6 s, tous les Abattus et Gisants de la crypte rampent vers elle à 2 m/s. Chaque corps qui la touche fusionne et lui rend 4 % de Chair.

Phase 2, Communion (720 → 300). Elle se lève, 8 m.
- Chute : elle bascule en avant, 2,0 s, ligne de 10 × 3 m, 40. Elle reste penchée 2 s : la couronne est accessible.
- Libation : elle absorbe un Abattu à moins de 6 m par seconde, chaque corps devient une pustule. À 4 pustules, une onde annulaire s'étend jusqu'à 12 m en 1,5 s (30, à franchir en esquivant). Les pustules tombent ensuite en fidèles Abattus.
- Enfantement toutes les 12 s. L'Étreinte continue.

Phase 3, Révélation (à 300). Les ornements restants éclatent, la carapace s'ouvre. Le grand corps s'affaisse : c'était un vêtement de corps cousus. Il devient la Dépouille, un énorme Abattu Résistant immobile qui pleure par toutes ses bouches (partie de la Mère). Il en sort la Mère véritable : 3,5 m, pâle, longiligne, des bras trop longs, 6 m/s, Chair 400, pas d'Excroissance. La musique se coupe ; on n'entend plus que sa respiration et ses pas.
- Bond : une ombre au sol 0,6 s, puis elle saute sur la position du joueur, 20, rayon 3 m.
- Griffes : 3 coups, télégraphe 0,4 s, 10 chacun.
- Berceuse : canalisation de 3 s. Si elle aboutit, tous les Abattus de la crypte se relèvent (+1 Cicatrice) et la Dépouille récupère un ornement. N'importe quel coup l'interrompt (L7).

Fin. À 0, la Mère véritable tombe Abattue (Résistante) et rampe vers la Dépouille à 2 m/s. Si elle l'atteint avant la Sentence, elle y rentre : la forme Bienheureuse revient avec 360 de Chair et un ornement, et à 300 la Révélation recommence avec une Mère véritable à 200 de Chair. Le joueur a donc intérêt à la combattre loin de la Dépouille.

La Dépouille est un corps, donc le joueur peut lui donner la Sentence. C'est la récompense de qui a compris les lois : la Mère véritable perd sa retraite. Le prix : c'est la seule Sentence de la tranche qui dure 2 s sans invulnérabilité, pendant que la Mère véritable attaque. D'après L5, tuer cette partie ne tue pas la Mère. Sentence unique de 2,5 s. D'après L5, la Dépouille, les fidèles, les membres et les Gisants restants meurent dans la même image. Quatre secondes de silence total. Derniers mots : « Ce n'est pas une maladie, mon enfant. C'est ce que nous devenons tous. Toi aussi, tu… »

- Ce que le joueur croit en entrant : un grand ennemi à user.
- Ce qu'il comprend en sortant : toutes les lois de la tranche s'appliquent à une seule créature. Ce qu'il a appris sur les corps était la clé du boss.
- Durée visée d'une tentative réussie : 6 à 9 minutes.

Épilogue. Retour sur la place. La fête continue, les danseurs sourient, la musique joue. Carte de fin de tranche.

---

## 13. Difficulté et apprentissage

Une seule difficulté. Cibles de réglage pour un joueur d'ARPG sans expérience de MERCY : 2 à 6 morts sur la tranche, au moins une contre le Veilleur ou la Mère, aucune dans la parcelle 1.

Une seule invite textuelle (F devant Jehanne). Tout le reste s'apprend par le contexte :

| Mécanique | Comment le joueur l'apprend |
|---|---|
| Abattu, Relèvement | Le premier Souriant laissé à terre se relève pendant le premier combat |
| Achèvement | Il arrive par accident au premier enchaînement de coups ; le silence le signale |
| Balayage | L'icône pulse la première fois que la Ferveur atteint 25 |
| Bruit, alerte | Parcelle 1 : deux groupes séparés par plus que le rayon de cri |
| Porteur comme outil | Parcelle 2 : il éclate de lui-même au milieu de la foule |
| Résistant | Le Veilleur : coups sans effet sur lui à terre (son métallique), liseré doré, la Sentence marche |
| Membres, Union | Premier Recousu de l'Hospice |
| Prière | Bas-côté A : la prière relève un champ que le joueur croyait réglé |

Les 10 premières minutes, simulées :

```
00:00 écran titre, clic « Entrer » (débloque l'audio)
00:10 route vers la vallée, cloches lointaines. Un corps dans le fossé gémit ; un villageois l'enjambe
01:00 place : danse synchronisée, détails de travers (cous trop longs, sourires sculptés)
01:30 Jehanne rampe. Invite « F »
01:45 Sentence. Silence, têtes qui tournent, la fête reprend
02:10 Anselme parle. L'église est scellée. Reliquaire 1
02:30 ruelles : 3 Délaissés optionnels, le joueur généralise la Sentence
04:00 porte nord. Les Blés, le Veilleur au loin tourne la tête
04:30 premier coup. Le Souriant tombe et crie, son groupe se retourne
04:50 un corps se relève, recousu
05:05 un coup sur un corps à terre : silence. Le joueur comprend
05:40 Ferveur à 25, l'icône du clic droit pulse. Premier Balayage
06:30 parcelle 2 : le Porteur mange les corps, son gargouillis monte
07:10 éclatement : tout le monde tombe, Souriants compris
08:00 le joueur nettoie les corps éparpillés avant qu'ils se relèvent
09:00 moulin : premier éclatement provoqué exprès, ou premier Porteur chargé abattu de face
10:00 la tête du Veilleur suit le joueur à 40 m
```

Temps morts surveillés : la marche de 00:10 à 01:00 (la limiter à 50 s, avec au moins trois détails à regarder) et le trajet après le Veilleur (pas de couloir vide de plus de 20 s dans toute la tranche).

## 14. Échec et reprise

L'échec, c'est la mort du Porte-Mort, à 0 Vie. Animation de reconstitution au Reliquaire : les os se ressoudent en 2 s, passable d'un clic. L6 s'applique. Aucune autre pénalité : pas de perte d'objets, pas de monnaie à récupérer.

Le coût de la mort est donc le trajet de retour, plus le travail non fini (tout ce qui était seulement abattu revient). Le progrès réel se compte en morts données. Le joueur prudent achève derrière lui. Contre la Mère, les Gisants tués restent morts : chaque tentative rend la suivante plus propre.

Frictions mineures prévues : un Relèvement avec Cicatrice est un revers local, pas un échec. Aucun piège ne tue d'un coup. Le joueur ne peut pas se retrouver bloqué : aucune porte ne dépend d'une ressource consommable.

## 15. Courbe de surprise

| Moment | Surprise | Type |
|---|---|---|
| 01:45 | Une mort fait taire la fête, qui reprend aussitôt | Sensorielle, narrative |
| 04:00 | Le Veilleur tourne la tête à 40 m | Échelle |
| 04:50 | Ce qui tombe se relève, recousu | Règle |
| 07:10 | La bombe ennemie abat les ennemis | Systémique (l'obstacle devient un outil) |
| ~16:00 | Le Veilleur lance des corps vivants | Systémique |
| ~22:00 | Un bras coupé rampe vers son maître | Mécanique |
| ~23:00 | Achever le maître fige ses bras | Règle (Union) |
| ~28:00 | Un Chirurgien assemble trois patients en une brute | Systémique, morale |
| ~32:00 | Un Chirurgien opère un cadavre sans s'en apercevoir | Ton (principe 5) |
| ~40:00 | Coutures : les corps rampent vers toi | Inversion de règle |
| ~48:00 | Un Confesseur à terre continue de prier | Exception |
| ~55:00 | La Cloche : chaque mort donnée sonne et réveille tout | Règle à double tranchant |
| ~70:00 | La Mère laisse tuer ses enfants en parlant doucement | Comportement |
| ~76:00 | La géante était un vêtement de corps, la vraie Mère est maigre et rapide | Échelle, perspective |
| ~80:00 | Une Sentence fait taire une salle entière | Union à grande échelle, sensorielle |

Rien n'est révélé deux fois. Chaque surprise étend une loi déjà connue au lieu d'en inventer une.

## 16. Monde et narration

N'apparaît que ce qui change l'expérience de jeu :

- Le Porte-Mort ne parle pas. Les autres lui parlent.
- Trois canaux : derniers mots (Sentence), répliques d'Anselme et de la Mère, environnement (corps enjambés, bannière « DCC », lits entretenus autour de corps qui ne marchent plus).
- Les habitants ne traitent jamais la situation comme horrible. Le ton des dialogues est calme, courtois, parfois tendre.
- Révélation de l'Acte I (GDD) : ce n'est pas une maladie, c'est ce que devient tout immortel. Elle arrive par morceaux (Gisants, Veilleur, Gaspard) et se referme sur la dernière phrase de la Mère.
- Le mystère du Porte-Mort (pourquoi il se reconstitue tout en donnant la mort) est posé par la reconstitution elle-même, sans aucun texte.
- Hors tranche : actes II à V, choix final, Église et Créateur.

## 17. Direction artistique

Contrainte : pas d'artiste dans la boucle. Les créatures sont des assemblages de segments rigides articulés, générés par code. Cette contrainte sert le design : le démembrement devient naturel (on détache un segment) et les Recousus sont littéralement des assemblages.

Règles de couleur. Chaque couleur a un sens de jeu :

| Couleur | Sens de jeu | Jamais pour |
|---|---|---|
| Ivoire jauni | Vivant à terre (liseré des Abattus), os, Excroissances | Décor neutre en grande surface |
| Or terni | Résistant, élite, ornement, Reliquaire | Objets sans importance |
| Gris cadavérique | Mort (désaturation à la mort), brume, pierre | Créatures vivantes |
| Rouge brun | Sang ancien, décalques de sol après 2 s | Signaux |
| Rouge vif | Danger imminent (dernières 0,2 s d'un télégraphe, sac de Porteur au stade 3) et sang frais pendant 2 s | Tout le reste |
| Vert maladif | Prière du Confesseur, eaux, crypte | Interface |
| Noir profond | Architecture, vide | |

Lumière : une source dominante par zone, ombres franches, brouillard en profondeur. Les Blés : soleil rasant. L'Hospice : fenêtres froides et bougies. L'Église : rais dorés. La Crypte : vert bioluminescent et un seul rai sur la Mère.

Silhouettes, lisibles en vue isométrique dans une foule :

| Créature | Forme |
|---|---|
| Souriant | Verticale et fine, tête trop ronde, masque-sourire blanc |
| Recousu | Large, asymétrique, coutures claires |
| Porteur | Bosse dorsale translucide qui luit selon le stade |
| Confesseur | Triangle (chasuble) surmonté d'un halo |
| Chirurgien | Long, penché, bras démesurés, tablier |
| Veilleur | Croix d'épouvantail de 7 m |
| Mère | Pyramide dorée assise, puis ligne verticale pâle |

Matières : chair humide (spéculaire forte, fausse diffusion sous la surface), os mat ivoire, or terni métallique, pierre poreuse.

Gore stylisé : décalques de sang persistants (plafond 400 par zone, les plus anciens s'effacent), segments qui se détachent avec une physique simple, blessures par segment (teinte, entaille). Les morts restent au sol (plafond 250 par zone, rendus en instances). Le gore varie : un Délaissé meurt presque sans sang.

Plans de beauté : la mer de blé au couchant avec la silhouette du Veilleur, le jardin du cloître, la nef aux rais dorés, la Mère assise sous son rai de lumière.

Interface : voir section 21. Typographie à empattements, ivoire sur noir, discrète.

## 18. Animation et mouvement

L'animation est procédurale d'abord (cinématique inverse, rotations indépendantes du buste, oscillateurs partagés). Deux règles communiquent l'état :

- Tout ce qui vit tremble. Même immobile, une créature vivante a un micro-mouvement. Un mort, son agonie finie, est parfaitement immobile. L'absence de mouvement signale la mort aussi sûrement que la couleur.
- La synchronie signale l'Indifférence. Un groupe en Rituel bouge sur une phase commune (danse, fauche, prière). Passé Hostile, chaque créature retrouve sa propre phase. Une foule qui se désynchronise est une foule qui attaque.

Télégraphes : anticipation exagérée avec une pose « fausse » propre à chaque famille. Le Souriant bascule la tête à 90°, le bras du Recousu traîne puis fouette, le Veilleur arme lentement mais ses mains partent vite. Les zones d'attaque au sol sont peintes en rouge brun, puis passent en rouge vif 0,2 s avant l'impact. Elles se dessinent toujours au-dessus des décalques de sang.

Abattus : rampent avec des mouvements propres à chaque famille (le Souriant sur le dos, le Recousu sur les coudes). Relèvement : les mains se plantent 1,5 s avant.

Sentences : courtes, la caméra pousse de 10 %, gel au coup fatal, puis l'agonie du corps (L4) et son immobilité totale.

Bourreau : poids lisible, chaque coup a une anticipation et une récupération. Les Stigmates modifient sa silhouette (plaques dorsales, troisième bras recousu, halo, ventre) sans masquer sa direction ni son arme.

## 19. Son et musique

Le son porte de l'information de jeu :

| Signal | Information |
|---|---|
| Halètement puis cri, spatialisé | Un Abattu, sa position, le risque d'alerte |
| Cri étranglé en râle puis silence, ambiance −6 dB jusqu'à 0,4 s après la fin du râle | Une mort donnée |
| Le cri se change en inspiration | Relèvement dans 1,5 s |
| Gargouillis du Porteur qui monte d'un ton par stade | Stade du sac |
| Chant du Confesseur qui s'élève | Progression de la prière |
| Scie du Chirurgien qui accélère | Progression de l'opération |
| Grincement de coutures | Recousu proche |
| Nappe de chœur de zone | Nombre de créatures vivantes dans la zone. Une zone vidée n'a plus que le vent |
| Glas de la Cloche | Alerte à 25 m |
| Fredonnement de berceuse | Phase 3 de la Mère, Berceuse en cours |

Musique : la fête du village est diégétique. En combat, un bourdon et des percussions dont l'intensité suit le nombre de créatures Hostiles et Abattues. Le boss a un chœur en phases 1 et 2, puis la musique se coupe en phase 3.

Impacts d'armes distincts par type (tranchant : chair fendue ; contondant : os qui craque, sourd).

Budget de voix : 24 emplacements de cri au plus, un par corps (halètement, cri et inspiration compris), priorité aux plus proches, le reste part dans la nappe. Les sons de support (chant, scie, gargouillis) ont leur propre budget et ne passent jamais dans la nappe.

Règles de fin : à la mort, la voix de la créature passe au râle dans l'image du coup et se tait à la fin de l'agonie ; ses autres sources (gargouillis, chant, scie, coutures) s'éteignent pendant l'agonie. Rien de la créature ne sonne après la fin de l'agonie. Toute autre fin de son (relèvement, prière interrompue, absorption, voix volée par le budget, réinitialisation) se fait en fondu d'au moins 80 ms, sans râle : seul un râle signifie une mort donnée. L'atténuation de −6 dB porte sur la nappe et l'ambiance (et, depuis le 2026-10-12, les autres voix de cri, −12 dB, jamais le râle), ne s'empile pas, et dure de la première mort d'une grappe jusqu'à 0,4 s après la fin du dernier râle. L'auditeur est le joueur.

## 20. Caméra

Isométrique fixe : perspective à focale longue (environ 30° de champ vertical), inclinaison d'environ 55°, rotation de 45°, pas de rotation par le joueur. Distance fixe : environ 18 m de champ horizontal autour du joueur en combat. La caméra s'élargit pour les arènes d'élite et de boss, et pousse légèrement pendant les Sentences. Les murs et piliers entre la caméra et le joueur se découpent ou deviennent transparents. Le joueur reste au centre, avec une légère avance vers le curseur (2 m au plus).

## 21. Interface

Affichage permanent :

- En bas à gauche : Vie (barre ivoire, remplissage rouge brun).
- En bas à droite : Ferveur (barre or).
- En bas au centre : les 3 Rites (icône, touche, coût ; grisés si la Ferveur manque), 2 pastilles d'Esquive.
- En haut : barre d'élite ou de boss pendant le combat (nom, Chair, segments d'Excroissances).

Volontairement absents : chiffres de dégâts, minicarte, barres de vie au-dessus des ordinaires. L'état d'un ordinaire se lit à sa posture et à ses plaies (à 50 % de Chair : plaie ouverte et boitement).

Ciblage de Sentence : quand un Abattu est à portée près du curseur, son liseré s'intensifie et un sceau apparaît au sol sous lui (ivoire, or pour un Résistant). F sans cible ne fait rien, avec un léger son mat.

Écran du Reliquaire : 3 emplacements, Stigmates possédés, arme équipée. Pause : Reprendre, Registre, Options (volumes, secousses de caméra, taille des sous-titres), Quitter. Sous-titres pour toute parole, en bas au centre.

## 22. Sauvegarde

Un seul emplacement, stockage local du navigateur. Contenu : dernier Reliquaire touché ; identifiants des créatures placées qui sont mortes ; armes possédées et équipée ; Stigmates possédés et équipés ; Rites débloqués ; Registre ; drapeaux narratifs (Jehanne, Gisants). Les créatures créées en combat ne sont pas sauvegardées.

Déclencheurs : contact d'un Reliquaire, chaque mort donnée (regroupées sur 2 s), chaque ramassage. Au chargement, le joueur apparaît au dernier Reliquaire et L6 s'applique.

## 23. Rejouabilité

Limitée dans la tranche, et c'est assumé : la tranche prouve des lois, pas une économie de fin de jeu. Ce qui donne envie de rejouer : les trois armes et les combinaisons de Stigmates (l'Os change le combat de boss), le Registre (noms et phrases manqués), les défis que les joueurs se fixeront (aucun Achèvement, Sentences seulement ; aucun Relèvement). Hors tranche : nouvelle partie+, loot, génération procédurale (questions ouvertes, section 27).

Comportements émergents attendus, à observer en test :

- Tirer un groupe en laissant volontairement crier un corps, puis l'amener sur un Porteur.
- Pousser un Porteur dans une foule à la Masse avant qu'il éclate.
- Utiliser la Charge pour passer dans le dos d'un Porteur.
- Vider les dortoirs en silence avant chaque combat (le « pacifisme miséricordieux »).
- Farmer de la Ferveur sur les Membres errants. Ça se limite tout seul : chaque Relèvement rapproche la créature de 3 Cicatrices.

## 24. Contraintes techniques qui touchent au design

- Navigateurs de bureau récents (Chrome, Edge, Firefox, Safari), WebGL2. Pas de mobile, pas de serveur, pas de réseau.
- 60 i/s visés, 30 au minimum, sur une puce graphique intégrée récente (Apple M1, Intel Iris Xe) en 1080p, avec au plus 40 créatures actives, 250 morts au sol et 400 décalques. Ces plafonds sont des plafonds de design : aucune rencontre n'en demande plus.
- Le moteur 3D est au choix de l'implémenteur.
- L'audio du navigateur ne démarre qu'après une action de l'utilisateur : l'écran titre exige un clic, et la scène de Jehanne ne doit jamais commencer avant.
- Géométrie des créatures produite par code (segments). Physique simple (cinématique et intégration de Verlet pour les segments détachés). Pas de moteur physique complet obligatoire.
- Chargement initial en moins de 20 s sur une connexion domestique.
- Résolution de 1280 × 720 à 2560 × 1440, l'interface s'adapte.

## 25. Contenu requis

Zones : 5 (Z0 à Z4) et 2 branches (clocher, ossuaire).

Créatures : Souriant (et sa variante fidèle de la Mère), Recousu (et sa variante assemblée, composition visuelle de 2 ou 3 corps), Porteur (3 stades de sac), Confesseur, Chirurgien, Délaissé (3 poses), Membre errant (bras), Veilleur, Frère Gaspard, Père Anselme (PNJ puis élite), La Nourrice, la Mère (forme Bienheureuse, Dépouille, Mère véritable), Jehanne.

Joueur : Bourreau, 3 armes, 4 greffes de Stigmates.

Animations de Sentence : tranchant × petite, tranchant × grande, contondant × petite, contondant × grande, Résistant × 2 types d'arme, Délaissé, Auréole (à distance), Mère. Le Glas réutilise les versions courtes.

Audio, entièrement généré (ElevenLabs pour les sons et les voix, Lyria pour la musique) : banque de voix de cri (au moins 12 voix distinctes), halètements, inspirations de Relèvement, impacts par type d'arme, gargouillis du Porteur (3 hauteurs), chant du Confesseur, scie, coutures, bois du Veilleur, berceuse de la Mère, musique de fête, bourdons de combat, chœur de boss, Glas, vent par zone.

Texte : environ 40 derniers mots (Jehanne, Délaissés, Gisants, élites, Mère), environ 30 répliques (Anselme, Confesseurs, Mère).

## 26. Cas limites

| Situation | Règle |
|---|---|
| Deux Abattus à égale distance du curseur | La Sentence vise le plus proche du joueur |
| Abattu en pleine phase de Relèvement (mains plantées) | Encore Abattu : achevable, sentenciable, jusqu'à ce qu'il soit debout |
| Joueur touché pendant une Sentence | Invulnérable (sauf Sentence à distance de l'Auréole) |
| Le Porteur éclate pendant qu'un Chirurgien opère à côté | L'opération est interrompue, les corps sont dispersés |
| Prière sur un Résistant Abattu | Relevé (Anselme seulement : les Confesseurs ordinaires ne relèvent pas les Résistants) |
| Prière sur des Délaissés | Ils se relèvent en Souriants hostiles avec 1 Cicatrice |
| Porteur et Abattu Résistant | Il n'absorbe que les ordinaires et les Délaissés |
| Le maître d'un Membre errant est Abattu | Le membre rampe vers lui et se recoud quand même |
| Le maître est tué alors que son membre est dans un sac de Porteur | Le membre meurt dans le sac (L5), le sac perd un stade |
| Coutures et Appel de la Mère | À moins de 10 m du joueur, les Coutures l'emportent ; au-delà, l'Appel |
| Glas sans aucun Abattu à portée | Frappe au sol seulement, coût entier |
| Glas : plus de 8 Abattus | Les 8 plus proches, Résistants d'abord |
| Changement d'arme en combat | Impossible, l'icône X est grisée |
| Ruade (Os) dans une grande créature ou un Résistant | Elle s'arrête au contact, 10 dégâts, pas d'abattage |
| Sentence de la Dépouille | 2 s, sans invulnérabilité, interrompue si le joueur est touché ; la Mère véritable n'a plus de retraite |
| Abattu projeté hors de la zone jouable | Replacé au point jouable le plus proche |
| Plafond de 250 morts atteint | Les plus anciens s'enfoncent dans le sol pendant 3 s, hors champ si possible |
| Mort du joueur pendant la phase 3 | Toute la Mère est réinitialisée. Les Gisants tués restent morts |
| Rechargement de page en plein combat | Équivaut à une mort sans animation (L6) |
| Une créature en Rituel voit une exécution | Aucune réaction (L7) |
| Le joueur sentencie le dernier Abattu d'une zone | La nappe de chœur s'éteint en 2 s, il ne reste que le vent |

## 27. Inconnues et risques

```
QUESTION OUVERTE : le double coup (abattre puis achever) est-il satisfaisant ou laborieux dans les grandes hordes ?
Réponses possibles : A. garder tel quel / B. un excédent de dégâts ≥ 50 % de la Chair max achève directement / C. le Balayage achève tout ce qu'il abat
Pourquoi c'est important : c'est le cœur de la boucle courte ; si c'est une corvée, le jeu perd le « Diablo d'abord »
Penchant actuel : A, avec B prête comme variante de repli
Ce qui tranchera : prototype P0, mesure de la perception de corvée et du temps par combat
```

```
QUESTION OUVERTE : la préparation par la miséricorde (dortoirs, Gisants) est gratuite. Est-ce une stratégie dominante sans décision ?
Réponses possibles : A. la garder gratuite (le choix, c'est d'y penser) / B. ajouter un coût (une ronde de Chirurgien qui finit par entendre) / C. limiter le nombre de Gisants tuables avant le réveil
Pourquoi c'est important : une action toujours optimale cesse d'être un choix
Penchant actuel : A dans la tranche, puisque la nef d'Anselme casse déjà le motif
Ce qui tranchera : est-ce que les testeurs la vivent comme une découverte ou comme une corvée ?
```

```
QUESTION OUVERTE : l'horreur tient-elle avec des créatures en segments générés par code ?
Réponses possibles : A. oui grâce au mouvement, au son et à la lumière / B. il faut des modèles sculptés / C. il faut changer de plateforme
Pourquoi c'est important : si les créatures font rire, le jeu s'effondre
Penchant actuel : A
Ce qui tranchera : prototype P1, test à l'aveugle (section 28)
```

Décidé (2026-10-11) : tous les sons sont générés. ElevenLabs produit les cris, halètements, effets et voix (génération de sons, voix `eleven_v3`) ; Gemini Lyria produit la musique. Pas de banque libre de droits, pas de synthèse procédurale comme son du jeu, même dans les prototypes. Un script de génération versionné fige les fichiers dans le dépôt avec un manifeste (id, prompt, modèle, durée). La lecture, la spatialisation, la coupure et le mixage restent dans le moteur du jeu. Reste ouvert : les derniers mots seront-ils dits (voix ElevenLabs) ou seulement écrits avec un chuchotement ? À trancher à l'écoute en P1.

Questions qui ne concernent que le jeu complet, à trancher après la tranche :

- Modèle de loot : aléatoire avec affixes, ou objets placés plus Stigmates étendus ?
- Zones à la main ou générées ?
- Les trois autres archétypes face aux lois : un Vicaire à distance qui achève de loin rend-il le tri des corps trivial ? Un Fossoyeur à chaînes qui tire les corps rend-il les Coutures redondantes ?
- Le village peut-il devenir un champ de bataille ?
- Manette.
- Niveau de gore et classification, option de réduction.

Risques principaux, par ordre :

1. Le double coup ressenti comme une corvée (variante B prête).
2. L'horreur qui tourne au comique.
3. La lisibilité : distinguer Abattu, mort et Résistant dans une mêlée de 15 corps (ivoire, gris, or, plus mouvement et immobilité).
4. Les performances avec 250 corps et 400 décalques dans un navigateur.
5. La surcharge cognitive à 4 familles par combat (limiter à 3 familles, plus une élite, au plus).

## 28. Plan de prototype

P0, « La Fosse ». Ce qu'il prouve : les lois L1 à L5 sont amusantes et lisibles.

- Arène grise de 30 × 30 m, créatures en blocs et segments sans finition.
- Bourreau : Frappe, Esquive, Sentence, Balayage, Charge. Couperet et Masse.
- Souriants, Porteur, Confesseur, Chirurgien, Recousu. Vagues scénarisées de complexité croissante.
- Cris spatialisés générés par ElevenLabs, râle puis silence à la mort (agonie, L4).
- Mesures : part des corps relevés, délai avant le premier Achèvement volontaire, nombre d'éclatements de Porteur provoqués exprès, prières interrompues, temps par vague.
- Critères d'abandon : si les testeurs gagnent confortablement sans jamais s'occuper des corps, la pression de Relèvement est trop faible (raccourcir les délais, plus de supports). Si plus de la moitié décrivent le nettoyage des corps comme une corvée, passer à la variante B.

P1, « Les Blés ». Ce qu'il prouve : l'horreur par le mouvement et le son, et le premier quart d'heure.

- Z0 et Z1 complètes avec éclairage, brouillard, animations procédurales, sons définitifs ou proches.
- Test à l'aveugle : on demande aux testeurs de décrire les créatures en trois mots, sans orienter la question.
- Critère d'abandon : si « drôle », « ridicule » ou « cheap » reviennent chez plus d'un testeur sur trois, revoir la direction des créatures avant de construire l'Hospice.

Ensuite seulement : Z2, Z3, Z4.

## 29. Critères de validation

```
RÉUSSITE : un nouveau joueur achève un Abattu volontairement dans les 2 minutes qui suivent son premier combat, sans texte.
ÉCHEC : la majorité des joueurs ne remarquent pas que les corps se relèvent avant le Veilleur.
```

```
RÉUSSITE : dans la parcelle 2 ou au moulin, au moins la moitié des joueurs provoquent ou exploitent un éclatement de Porteur au milieu d'une foule.
ÉCHEC : le Porteur n'est perçu que comme un danger à fuir.
```

```
RÉUSSITE : face au Veilleur, les joueurs donnent la Sentence dès sa première chute.
ÉCHEC : ils frappent le corps doré jusqu'à ce qu'il se relève, deux fois de suite.
```

```
RÉUSSITE : à l'Hospice, au moins un joueur sur trois tue des patients avant d'engager un Chirurgien, sans qu'on le lui suggère.
ÉCHEC : personne ne fait le lien entre les Délaissés et les Recousus assemblés.
```

```
RÉUSSITE : après le bas-côté A, les joueurs ciblent ou interrompent les Confesseurs en priorité.
ÉCHEC : la prière reste une surprise subie après trois rencontres.
```

```
RÉUSSITE : interrogés après la tranche, les joueurs citent le silence (le cri qui s'étrangle puis se tait) comme un souvenir marquant.
ÉCHEC : personne ne mentionne le son.
```

```
RÉUSSITE : dans une mêlée de 15 corps, un observateur distingue Abattu, mort et Résistant sur une capture d'écran en moins de 3 s.
ÉCHEC : confusion entre Abattu et mort.
```

```
RÉUSSITE : 60 i/s tenus sur M1 au combat le plus chargé (nef d'Anselme, combat de la Mère).
ÉCHEC : moins de 30 i/s.
```

```
RÉUSSITE : la tranche se termine en 70 à 90 minutes pour un joueur d'ARPG, avec 2 à 6 morts.
ÉCHEC : plus de 10 morts au même endroit, ou moins de 45 minutes.
```

## 30. Contrat d'implémentation

L'agent qui construit ce jeu ne doit pas réinterpréter ces points :

1. Aucune créature ne meurt sans une action du joueur : Achèvement ou Sentence. Les dégâts sur une créature debout ne tuent jamais, quelle que soit leur source : à 0 de Chair, elle tombe Abattue.
2. Un Abattu ordinaire meurt à la première instance de dégâts du joueur. Un Abattu Résistant ne meurt que par la Sentence (ou le Glas).
3. La mort ouvre une agonie courte (réglage : 0,4 s) : la voix s'étrangle en râle et se tait, les autres sons de la créature s'éteignent, le corps s'effondre. À la fin de l'agonie, plus aucun son ni mouvement ne vient du corps. Le vivant n'est jamais parfaitement immobile.
4. Les créatures en Rituel ne réagissent qu'aux dégâts, à la proximité (2,5 m) et au bruit. Jamais à ce qu'elles voient.
5. Les Abattus non achevés se relèvent avec une Cicatrice. À 3 Cicatrices, la créature est Résistante.
6. Union : la mort d'un tout tue toutes ses parties dans la même image.
7. Quand le joueur meurt, tout ce qui n'est pas mort revient à son état d'origine, et rien de ce qui est mort ne revient.
8. Pas de potions, pas de régénération. En combat, on se soigne par la Sentence, le Glas ou le Stigmate Ventre.
9. Les Stigmates changent des règles et ont un prix. Pas de bonus en pourcentage sans contrepartie, pas de niveaux, pas d'expérience.
10. Les couleurs ivoire, or, gris et rouge vif sont réservées aux sens définis en section 17.
11. Une seule invite textuelle de tutoriel (F devant Jehanne). Tout le reste s'apprend par le jeu.
12. Pas de chiffres de dégâts, pas de minicarte, pas de barre de vie au-dessus des créatures ordinaires.
13. Les télégraphes restent lisibles par-dessus le gore, dans tous les cas.
14. Les valeurs marquées « réglage » peuvent bouger. Les règles ci-dessus, non.

---

## Écarts d'implémentation et précisions

- 2026-10-12 (gel des contrats P0) : précisions D1 à D13 écrites dans L1, L4, L7, §8.10 et §19. Recharge du Confesseur après interruption, Confesseur à terre compté, rayon de prière de 8 m, rotation du Porteur à 90°/s, Porteur qui va chercher les corps, voix étouffée des corps absorbés, fondu des fins sans mort, coup sans effet qui interrompt une canalisation, budget propre des sons de support, liseré à 1 Hz, morts qui ne bloquent pas.
- 2026-10-12 : variante B (§27), si elle est testée ou retenue : elle s'applique à toutes les instances de dégâts du joueur (Frappe, Balayage, Charge), sur la Chair max courante (Cicatrices comprises), et une mort par variante B rapporte +4 Ferveur comme un Achèvement.
- 2026-10-12 : des scènes de test réservées au développement peuvent placer des créatures Abattues ou mortes dès le premier tick, sans évènement de mort. Jamais dans une vague jouée ni en jeu : le §30.1 porte sur les morts en jeu.
- 2026-10-12 : P0 sera testé par le concepteur seul (§28 prévoyait le concepteur plus 3 à 5 joueurs). Les verdicts humains qui exigent plusieurs testeurs (test des 3 s du §29, règle A/B du §28) restent non concluants en P0 ; l'avis du concepteur est rapporté à part, comme indication.

- 2026-10-12 (phase B) : un corps qui reçoit une Sentence avant d'avoir commencé à crier reste muet jusqu'à sa mort. Une exécution sur un corps frais est donc silencieuse, comme le veut l'exemple de L7. Un Membre errant ne crie jamais : il n'a pas de voix.
- 2026-10-12 (phase B) : le +2 de Ferveur par créature touchée ne vaut que pour la Frappe (§8.3). Le Balayage et la Charge ne rapportent de la Ferveur que par les Achèvements qu'ils provoquent.
- 2026-10-12 (phase C) : un sac de Porteur n'avale jamais un Membre errant. Le cas du §26 « membre mort dans le sac » ne peut donc pas se produire en P0 ; le stade du sac suit son contenu à chaque tick.
- 2026-10-12 (phase C) : l'éclatement provoqué par un coup s'applique après tous les dégâts de ce coup. Un même geste n'achève jamais ce que l'éclatement qu'il déclenche vient d'abattre (L4).
- 2026-10-12 (phase C) : un corps avalé par un Porteur ou assemblé par un Chirurgien perd sa canalisation en cours (un Confesseur qui priait à terre).
- 2026-10-12 (phase C) : les zones de télégraphe au sol sont rouge brun, puis rouge vif pendant les 0,2 dernières secondes (§18). C'est la seule exception au « jamais pour des signaux » du rouge brun (§17) : la règle du §18, plus précise, l'emporte.
- 2026-10-12 (phase C) : P0 se rend sans anticrénelage multi-échantillons, pour que les mesures au pixel de B2 portent sur l'image que voit le joueur. À revoir en P1.
- 2026-10-12 (phase D) : une Charge est un seul geste du début à la fin de la ruée : elle n'achève jamais un corps que l'éclatement qu'elle a déclenché vient d'abattre, même aux ticks suivants.
- 2026-10-12 (phase D) : le délai de 4 s du Porteur au stade 3 ne court que debout ; abattu, il est suspendu ; relevé, il repart de zéro.
- 2026-10-12 (phase D) : la Sentence passe avant une opération de Chirurgien : elle reprend le corps réservé (même un Recousu Résistant) et interrompt l'opération. Un corps réservé qu'un éclatement déplace perd sa réservation, et l'opération qui le visait est interrompue.
- 2026-10-12 (phase D) : quand une réservation tombe tout près ou après l'heure du Relèvement, le Relèvement est repoussé pour que son télégraphe de 1,5 s ait toujours lieu.
- 2026-10-12 (décision du concepteur) : la variante B est retenue, sans test comparé (un seul testeur). Un excédent de dégâts d'au moins 50 % de la Chair max achève directement ; le double coup reste le cas des coups plus faibles. Le jeu démarre en B ; `?variant=A` reste disponible pour comparer. Conséquence à surveiller : une créature tuée debout passe dans l'image du coup à sa pose au sol, sans effondrement, puisque la mort ne bouge plus (§18, §30.3).
- 2026-10-12 (décision du concepteur) : la Frappe et le Balayage du Bourreau ont une anticipation de 5 ticks (réglable par arme, de l'ordre de 4 à 6) entre la commande et l'impact (§18). La durée totale du geste ne change pas : la récupération raccourcit d'autant. Une Esquive pendant l'anticipation annule le coup.
- 2026-10-12 (décision du concepteur) : la Charge ne pousse plus un Porteur sur le côté. Il reste en place et dans son orientation ; le Bourreau le traverse et se retrouve dans son dos. C'est l'intention de la décision D4, que la poussée latérale empêchait.
- 2026-10-12 (décision du concepteur) : le halo du Confesseur n'est vert que pendant une prière ; hors prière, il est de fer sombre. Le vert maladif garde son seul sens (§17), contre la planche de concept qui le montre vert en permanence.
- 2026-10-12 (décision du concepteur) : les couleurs des modèles importés suivent d'abord leurs textures ; l'étalonnage de l'image ne désature plus ce que le contrat B2 n'exige pas de désaturer. Les seuils de lisibilité de B2 ne bougent pas.
- 2026-10-12 (décision du concepteur) : quand on achève un corps qui crie, le mix doit se creuser (B5.O10). Si la retouche des fichiers d'impact et de cri ne suffit pas, le ducking d'une mise à mort baisse aussi les autres voix de cri pendant quelques centaines de millisecondes (§8.2 élargi).
- 2026-10-12 (décision du concepteur, après son premier jeu) : la mort n'est plus une coupure sèche. Elle ouvre une agonie courte (réglage : 0,4 s) : le cri s'étrangle en râle dès l'image du coup, le corps s'effondre et grisit, puis silence et immobilité. Remplace la coupure nette du principe 3, de L4, du §19 et du §30.3, et l'immobilité dès l'image du coup du §18. La mort elle-même reste instantanée dans la simulation : au tick du coup, la créature est morte et n'agit plus ; l'agonie est de la présentation. Raison : en jeu, la coupure de tout (cri, son, mouvement) dans la même image se lisait comme trop rapide et étrange. La valeur 0,4 s est un choix de l'orchestrateur dans la fourchette proposée (0,3 à 0,5 s).
- 2026-10-12 (décision du concepteur) : le Bourreau fait face à sa direction de marche quand il se déplace, se tourne vers le curseur au début d'un geste (Frappe, Balayage, Charge, Sentence), et garde son orientation à l'arrêt. Il ne regarde plus le curseur en marchant.
- 2026-10-12 (décision du concepteur) : la lumière s'applique normalement aux créatures ; aucun éclairage d'appoint ne les rend lisibles dans le noir. Dans le noir, un Abattu se lit par son liseré ivoire et un vivant par son mouvement ; ce qui est dans le noir se devine.
