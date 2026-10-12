# MERCY
**Game Design Specification | V0.1**

*Death was the last mercy.*

**Genre:** Dark Fantasy Action RPG / Hack & Slash / Survival Horror Atmosphere  
**Perspective:** Isometric 3D  
**Mode:** Solo, avec un personnage principal personnalisable  
**Durée cible:** 25 à 35 heures pour la campagne, rejouabilité importante  
**Références :** Diablo II, Diablo IV, Scorn, Blasphemous, Darkwood, Berserk, Bloodborne, Hellraiser

---

# 1. Vision du jeu

## 1.1. Le concept

Il y a 700 ans, Dieu a exaucé la plus ancienne prière de l'humanité : ne plus jamais mourir.

Au début, ce fut un miracle.

Les maladies ont cessé de tuer. Les vieillards ont survécu. Les soldats sont revenus de batailles impossibles. Les rois ont régné pendant des siècles.

Puis les corps ont commencé à se dégrader.

Les os ont continué de pousser. Les blessures se sont refermées incorrectement. Les organes ont fusionné. Les corps incapables de fonctionner sont restés conscients.

Aujourd'hui, le monde est une civilisation d'immortels condamnés à vivre dans des corps qui ne leur appartiennent plus.

Les hommes ont construit des religions autour de leurs difformités. Les mutations sont devenues sacrées. La souffrance est devenue une preuve de foi.

**Le joueur incarne une anomalie : un être capable de donner une mort définitive.**

Il est considéré comme un monstre par ceux qui profitent du Miracle, et comme un sauveur par ceux qui en souffrent.

Son aventure commence lorsqu'il arrive dans un village où les habitants célèbrent le 700e anniversaire de leur immortalité.

## 1.2. North Star

> Un Diablo-like viscéral où chaque région semble sortie d'un cauchemar inédit, où les combats sont brutalement satisfaisants, et où la mort des ennemis peut être le seul acte de compassion.

Le joueur doit constamment osciller entre :

- **Puissance :** massacrer des hordes de monstres avec des capacités spectaculaires.
- **Répulsion :** affronter des créatures anatomiquement dérangeantes, grotesques et parfois difficiles à regarder.
- **Curiosité :** explorer des endroits impossibles, découvrir ce qui est arrivé aux habitants.
- **Malaise :** réaliser que les ennemis conservent souvent une conscience humaine et que la frontière entre monstre et victime n'existe presque plus.

## 1.3. Les cinq principes de design

**1. Diablo d'abord.** Des contrôles immédiats, du loot, des builds variés, des donjons et des combats contre des hordes. Le jeu ne doit jamais sacrifier le plaisir du hack & slash pour devenir un simulateur de marche horrifique.

**2. Une horreur physique.** Les monstres ont du poids, des mouvements dérangeants, des anatomies cohérentes avec leur transformation. Les armes causent des dégâts qui semblent réellement affecter leurs corps.

**3. Le monde est anormal, ses habitants le trouvent normal.** Un personnage peut discuter calmement alors qu'une créature grotesque se déplace derrière lui. Les dialogues ne cherchent pas constamment à rappeler que la situation est horrible.

**4. Chaque zone doit provoquer une découverte.** Un décor monumental, une créature impossible, un comportement humain choquant, un boss mémorable ou une révélation narrative.

**5. La beauté rend l'horreur plus forte.** Certaines cathédrales, statues, vallées et salles doivent être magnifiques. Leur beauté rend leurs détails monstrueux encore plus dérangeants.

---

# 2. Direction artistique

## 2.1. Identité générale

**Gothique religieux + horreur anatomique + Renaissance décadente.**

Un monde médiéval autrefois riche et cultivé, lentement transformé par sept siècles d'immortalité.

L'architecture reste reconnaissable : villages, manoirs, châteaux, monastères, cathédrales et cryptes.

Cependant, la matière organique envahit progressivement les constructions.

Les colonnes ressemblent à des os. Des surfaces de marbre semblent respirer. Des portes se ferment comme des paupières. Des statues pleurent une substance épaisse. Des cloches vibrent comme des organes vivants.

On doit croire qu'il s'agit d'une civilisation qui a réellement existé avant le désastre.

## 2.2. Palette

| Couleur | Utilisation |
|---|---|
| Noir profond | Architecture, ombres, profondeur |
| Gris cadavérique | Peau, brume, pierre |
| Ivoire jauni | Os, reliques, objets sacrés |
| Rouge brun | Sang ancien, surfaces organiques |
| Or terni | Statues, religieux, équipement |
| Vert maladif | Eaux stagnantes, maladies, catacombes |
| Rouge vif | Sang frais, coups puissants, événements dramatiques |

**Règle :** le rouge vif doit attirer immédiatement le regard. Éviter de saturer chaque décor de sang rouge.

## 2.3. Design des créatures

Toutes les créatures doivent conserver une trace visible de leur humanité.

Une posture familière, des vêtements ordinaires, une expression, une voix, un geste quotidien.

Leurs mutations doivent répondre à une logique identifiable :

- **Croissance infinie :** os, dents et membres qui continuent de pousser.
- **Guérison incorrecte :** chairs fusionnées, membres recollés au mauvais endroit.
- **Union religieuse :** plusieurs individus volontairement réunis dans un seul organisme.
- **Adaptation :** corps transformés pour survivre à des siècles de souffrance.
- **Dévotion :** organes et parties du corps modelés pour imiter des figures sacrées.

Éviter les simples zombies, les monstres avec dix bras sans logique et les démons génériques à cornes.

Leurs silhouettes doivent être identifiables en combat isométrique, même lorsqu'ils apparaissent en groupe.

## 2.4. Animations et malaise

Les mouvements sont une signature du jeu.

Exemples :

- Un ennemi se déplace normalement, puis son torse tourne indépendamment de ses jambes.
- Une grande créature marche très lentement, tandis que ses mains avancent à une vitesse anormale.
- Un ennemi tombe, semble vouloir ramasser quelque chose, puis utilise soudain cette posture pour attaquer.
- Une procession de corps avance en parfaite synchronisation, comme si elle formait un seul individu.
- Un personnage non hostile continue de sourire alors que sa mâchoire se disloque pendant une conversation.

**Règle artistique :** éviter que tous les monstres grognent, courent et sautent sur le joueur. Certains sont silencieux, certains parlent et certains semblent ignorer complètement sa présence.

## 2.5. Gore et violence

Le jeu vise une violence graphique extrême et un rendu physique convaincant.

Les armes lourdes écrasent, les lames démembrent, les attaques perforantes traversent les corps, les pouvoirs occultes provoquent des transformations brutales.

Les créatures présentent des blessures persistantes durant les combats. Les explosions projettent des fragments organiques. Les corps restent visibles après les affrontements et racontent ce qui s'est passé.

Chaque famille d'armes possède une signature :

| Arme | Signature visuelle |
|---|---|
| Épées et haches | Coupures nettes, démembrements, projections |
| Masses et marteaux | Écrasements, fractures, impacts lourds |
| Lances et piques | Perforations, empalements, corps repoussés |
| Chaînes et crochets | Attraction brutale, arrachements, déséquilibre |
| Pouvoirs sacrés | Chair qui se calcifie, se fissure ou se consume |
| Pouvoirs organiques | Mutations violentes, ruptures, déformations |

Le gore doit varier. Une mort silencieuse avec très peu de sang peut être plus marquante qu'une explosion.

---

# 3. Gameplay principal

## 3.1. Structure

MERCY est un Action RPG isométrique classique.

Le joueur contrôle un personnage unique, explore un monde hostile, tue des ennemis, récupère de l'équipement et développe ses capacités.

**Boucle principale :**

Explorer une région → Affronter des groupes d'ennemis → Découvrir des lieux et des secrets → Récupérer du loot → Débloquer des capacités → Vaincre un boss → Accéder à une région plus dangereuse.

Le rythme alterne entre des combats intenses et des moments d'exploration plus calmes, dans lesquels le joueur peut observer les horreurs du monde.

## 3.2. Combat

Le combat doit être **rapide, violent, nerveux et immédiatement satisfaisant**.

Le joueur doit pouvoir affronter de nombreux ennemis, les regrouper, les repousser et les éliminer avec des capacités complémentaires.

Les attaques doivent transmettre :

- La masse et l'impact des armes.
- La résistance physique des ennemis.
- La brutalité des coups finaux.
- La différence entre une petite créature fragile et un monstre de plusieurs tonnes.

Les attaques puissantes peuvent déséquilibrer les ennemis ou interrompre leurs actions. Les créatures lourdes demandent davantage de préparation.

Les ennemis ordinaires meurent rapidement lorsque le joueur maîtrise son build. Les élites, mini-boss et boss imposent davantage de lecture, de déplacement et de précision.

La caméra conserve une bonne visibilité sur les combats. Les effets de sang et les animations ne doivent jamais masquer durablement les attaques dangereuses.

## 3.3. La mécanique de Miséricorde

**La Miséricorde est la signature de MERCY.**

Les ennemis ordinaires meurent directement. Certains monstres d'élite et boss peuvent entrer dans un état de vulnérabilité particulier.

À cet instant, le joueur peut déclencher une *Sentence* : une exécution spectaculaire qui leur accorde la mort définitive.

Chaque type d'arme et de créature possède des variantes de Sentence.

La Sentence :

- Termine immédiatement un ennemi vulnérable.
- Produit une animation courte et particulièrement brutale.
- Déclenche un effet lié au build : explosion, récupération de vie, malédiction de zone, onde de choc.
- Offre une récompense supplémentaire sur certaines catégories d'ennemis.

**Particularité sonore :** lorsqu'une créature obtient enfin la mort, ses cris et les bruits organiques cessent instantanément.

Ce silence contraste avec la brutalité de l'exécution.

Les Sentences sont facultatives pour la plupart des rencontres, afin de préserver le rythme du combat.

## 3.4. Le système de Ferveur

La Ferveur représente l'intensité du personnage pendant un combat.

Elle augmente lorsque le joueur frappe, enchaîne des ennemis, esquive une attaque dangereuse ou réussit une Sentence.

Il peut la dépenser pour déclencher ses capacités les plus destructrices.

L'objectif est de récompenser les joueurs agressifs et les combats fluides.

La Ferveur ne doit pas imposer des périodes d'attente trop longues entre les affrontements.

## 3.5. Les états anatomiques

Les monstres réagissent aux dégâts selon leur anatomie.

Certains ennemis possèdent des propriétés spécifiques :

- Des excroissances osseuses peuvent se briser et exposer une zone fragile.
- Des créatures fusionnées peuvent perdre leur coordination lorsqu'une partie de leur corps est détruite.
- Les monstres qui se régénèrent peuvent reconstituer certains organes.
- Des ennemis religieux peuvent continuer de combattre quelques instants après avoir reçu un coup qui devrait être fatal.

Le joueur n'a pas besoin d'effectuer des attaques chirurgicales sur chaque ennemi. Ces comportements enrichissent naturellement les combats et deviennent particulièrement importants contre les élites et boss.

---

# 4. Personnage, builds et compétences

## 4.1. Le protagoniste

Le joueur incarne **Le Porte-Mort**, un être capable de mettre fin à l'immortalité.

Il personnalise son apparence, ses armes, ses équipements et ses compétences.

L'histoire ne force pas le personnage à être héroïque ou cruel. Sa présence est ambiguë : il apporte la délivrance en massacrant des êtres qui ne peuvent pas mourir.

À chaque mort du joueur, son corps est reconstitué auprès d'un ancien Reliquaire. Contrairement aux autres immortels, il conserve la capacité de donner la mort.

L'origine de cette contradiction constitue un mystère central de la campagne.

## 4.2. Archétypes

Le joueur sélectionne une voie initiale, puis développe son style grâce aux équipements et talents.

### Le Bourreau
**Combat rapproché, destruction, puissance physique.**

Utilise de grandes armes et exploite les ennemis vulnérables.

Capacités : écrasements, balayages, charges, fractures, exécutions en chaîne.

Fantaisie de gameplay : traverser une horde en pulvérisant physiquement les ennemis.

### Le Pénitent
**Sacrifice, sang, malédictions.**

Sacrifie une partie de sa vitalité pour renforcer ses attaques et déclencher des pouvoirs occultes.

Capacités : saignements, zones maudites, explosions organiques, récupération de vie.

Fantaisie de gameplay : devenir plus dangereux à mesure que les combats deviennent chaotiques.

### Le Vicaire
**Pouvoirs sacrés, suppression, destruction à distance.**

Utilise des prières interdites et des reliques religieuses comme armes.

Capacités : sceaux, rayons de lumière maladive, condamnations de zone, chaînes sacrées.

Fantaisie de gameplay : détruire des hordes en utilisant le pouvoir religieux responsable de leur condition.

### Le Fossoyeur
**Contrôle, chaînes, pièges, attaques de zone.**

Exploite les positions des ennemis et le terrain.

Capacités : crochets, attraction, entraves, fosses, attaques à large portée.

Fantaisie de gameplay : regrouper de nombreux ennemis, puis les détruire en une seule attaque dévastatrice.

## 4.3. Équipement et loot

MERCY reprend les fondations d'un loot-based ARPG :

- Armes et armures aux propriétés variées.
- Équipement rare et légendaire.
- Objets uniques capables de transformer les compétences.
- Sets thématiques.
- Possibilités d'amélioration et de personnalisation.
- Builds spécialisés dans les dégâts, le contrôle, la survie ou les Sentences.

Chaque équipement légendaire possède une identité visuelle reconnaissable.

**Exemples :**

**La Cloche de la Dernière Aube**  
Chaque Sentence provoque une onde qui fragilise les ennemis proches.

**Le Manteau des Cent Martyrs**  
Plusieurs visages déformés apparaissent sur l'armure. Les dégâts subis renforcent temporairement les attaques sacrées.

**Le Croc du Confesseur**  
Les ennemis touchés par une attaque puissante répandent une malédiction à proximité.

**La Couronne du Premier Saint**  
Transforme la capacité ultime du Vicaire en apparition d'une immense figure sacrée qui condamne une zone entière.

## 4.4. Transformation du personnage

L'équipement et certains choix de progression modifient progressivement l'apparence du héros.

Un Bourreau peut voir ses bras recouverts d'excroissances osseuses. Un Vicaire peut développer un halo déformé. Un Pénitent peut présenter des marques organiques mouvantes.

Le joueur peut conserver une apparence plus humaine ou rechercher des transformations particulièrement grotesques.

Ces mutations doivent renforcer l'identité du build sans rendre le personnage illisible.

---

# 5. Monde et campagne

Le jeu comprend cinq actes, chacun doté d'une identité artistique, d'une ambiance et d'un bestiaire propres.

## Acte I : Le Village des Bienheureux

**Ambiance : folk horror, campagne médiévale, fausse tranquillité.**

Le personnage arrive dans une vallée isolée, où une fête célèbre les 700 ans du Miracle.

Les villageois sourient et accueillent les étrangers. Les maisons sont entretenues. Les champs sont cultivés. Les cloches sonnent.

Pourtant, certaines silhouettes derrière les fenêtres présentent des anatomies impossibles. Les habitants ignorent les personnes déformées qui gisent dans les rues.

Le joueur explore :

- Le village de Sainte-Miséricorde.
- Des fermes et champs recouverts d'organismes inconnus.
- Une forêt où des silhouettes humaines semblent pousser parmi les arbres.
- Un hospice dans lequel des corps sont conservés depuis plusieurs siècles.
- L'église locale et ses souterrains.

**Boss : La Mère des Bienheureux**

Une figure religieuse gigantesque, composée de corps fusionnés. Elle accueille le personnage avec douceur, comme si elle le connaissait depuis toujours.

Pendant le combat, elle invoque des fidèles et modifie son propre corps. Sa dernière phase dévoile une créature entièrement différente, dissimulée sous les ornements religieux.

**Révélation :** les habitants ne sont pas victimes d'une maladie. Leur état représente l'évolution naturelle de l'immortalité.

## Acte II : Les Fosses de la Miséricorde

**Ambiance : catacombes, horreur souterraine, obscurité et claustrophobie.**

Sous les royaumes existent des réseaux de fosses communes.

Pendant des siècles, les populations ont enterré ceux dont les corps ne pouvaient plus fonctionner.

Ils sont toujours vivants.

Le joueur traverse des cavernes immenses, des ossuaires et des lieux où les corps se sont progressivement agglomérés.

L'architecture devient plus organique.

**Lieux :**

- Une nécropole aux milliers de niches.
- Une fosse verticale traversant plusieurs niveaux souterrains.
- Des galeries remplies d'organismes immobiles.
- Un ancien laboratoire religieux consacré à l'étude du Miracle.

**Boss : Le Dernier Fossoyeur**

Un gardien immortel qui a passé plusieurs siècles à enterrer les vivants. Son corps est devenu une structure gigantesque de chaînes, d'os et d'outils.

**Révélation :** l'Église connaît parfaitement les conséquences du Miracle et empêche volontairement sa disparition.

## Acte III : La Cité des Saints

**Ambiance : grandeur religieuse, Renaissance, décadence baroque.**

Le joueur atteint la capitale de la foi.

Une ville immense, ornée d'or, de marbre et de statues. Les habitants les plus riches et puissants se sont volontairement transformés en figures sacrées.

La noblesse considère les mutations comme une expression de pureté.

La beauté domine les premières impressions. Les détails deviennent progressivement insupportables.

**Lieux :**

- Des palais transformés en sanctuaires.
- Une place publique dominée par des statues organiques.
- Des ateliers fabriquant des reliques vivantes.
- Une bibliothèque renfermant les témoignages des premiers immortels.
- Une cathédrale gigantesque.

**Boss : Le Chœur des Mille**

Une assemblée de chanteurs immortels fusionnés dans une seule entité. Le boss utilise des attaques sonores et des mouvements synchronisés.

**Révélation :** le Miracle n'était pas un cadeau. Il résultait d'une intervention humaine sur une puissance incompréhensible.

## Acte IV : Le Ventre du Miracle

**Ambiance : body horror absolue, architecture vivante, cauchemar anatomique.**

Le personnage pénètre dans les structures profondes qui alimentent le Miracle.

Les constructions humaines disparaissent progressivement.

Les couloirs respirent. Les murs se contractent. Le sol semble réagir aux combats.

Le joueur ne sait plus exactement s'il explore un bâtiment, une créature ou une réalité complètement différente.

**Lieux :**

- Un immense réseau de chambres organiques.
- Des salles suspendues dans une cavité gigantesque.
- Une rivière de substance vivante.
- Des structures anatomiques dont la fonction reste incompréhensible.
- Le Sanctuaire du Premier Miracle.

**Boss : Le Premier Immortel**

Le premier être humain ayant reçu le Miracle, devenu une créature monumentale, partiellement fusionnée avec l'architecture du sanctuaire.

**Révélation :** la Mort n'a pas été détruite. Elle a été retirée du monde et emprisonnée dans un réceptacle.

## Acte V : Le Créateur

**Ambiance : apocalypse sacrée, beauté impossible, révélation cosmique.**

Le joueur accède au cœur du Miracle.

Contrairement aux zones précédentes, certaines salles semblent presque parfaites : marbre blanc, immenses espaces silencieux, lumière irréelle.

Puis les structures se révèlent vivantes.

Le dernier acte confronte le joueur aux véritables origines de l'immortalité.

**Boss final : Le Créateur**

Une entité immense qui maintient artificiellement le monde en vie.

L'affrontement commence dans un espace presque vide, silencieux et magnifique.

Progressivement, l'environnement entier se transforme en organisme monstrueux.

Le boss ne cherche pas uniquement à tuer le joueur. Il tente de le convaincre que la Mort représente une catastrophe pire que l'immortalité.

**Révélation finale :** le protagoniste n'est pas un humain ordinaire. Il est le réceptacle de la Mort, arrachée au monde il y a sept siècles.

**Choix final :**

1. Libérer la Mort et rendre les êtres vivants mortels, avec des conséquences immédiates et imprévisibles.
2. Conserver la Mort en soi, condamnant le monde à poursuivre son existence tout en recherchant une autre solution.

Aucune conclusion ne doit présenter une réponse moralement évidente.

---

# 6. Bestiaire

Les familles de monstres doivent présenter des comportements distincts et une silhouette identifiable.

| Créature | Description | Combat |
|---|---|---|
| Les Souriants | Villageois aux expressions figées et aux articulations anormales | Ennemis rapides attaquant en groupe |
| Les Recousus | Individus réparés des centaines de fois, composés de membres mal assemblés | Brutes lentes et résistantes |
| Les Porteurs | Corps hypertrophiés transportant des excroissances instables | Explosions et zones dangereuses |
| Les Confesseurs | Religieux déformés, capables de parler et de prier | Malédictions et soutien des autres ennemis |
| Les Dévots | Fidèles ayant volontairement fusionné | Créatures collectives aux attaques coordonnées |
| Les Veilleurs | Géants presque immobiles qui observent le joueur | Attaques très puissantes après une longue préparation |
| Les Chirurgiens | Praticiens immortels obsédés par la réparation des corps | Régénération et modification des autres monstres |
| Les Saints | Humains transformés en figures sacrées monstrueuses | Élites puissants, comportements uniques |

## Règles de comportement

Les ennemis ne doivent pas tous reconnaître le joueur immédiatement comme une menace.

Certains continuent de prier, travaillent, se nourrissent ou restent immobiles jusqu'à ce que le joueur les dérange.

Certains ennemis parlent pendant le combat.

D'autres supplient le joueur de leur accorder la mort.

Certaines créatures agressives peuvent hésiter ou manifester des comportements presque humains lorsqu'elles sont affaiblies.

Les familles d'ennemis peuvent apparaître ensemble et créer des interactions : un Chirurgien répare un Recousu, un Confesseur renforce des Souriants, un Porteur devient dangereux au milieu d'une foule.

---

# 7. Boss et rencontres majeures

Chaque boss doit constituer une découverte visuelle et mécanique.

**Design attendu :**

- Une silhouette impossible à confondre.
- Un comportement caractéristique.
- Des attaques compréhensibles malgré son anatomie grotesque.
- Une transformation importante au cours du combat.
- Une mort visuellement et émotionnellement mémorable.

Le joueur doit pouvoir reconnaître un boss à partir d

<!-- TRONQUÉ : le texte source fourni s'arrête ici, au milieu de la section 7. Sections suivantes absentes. -->
