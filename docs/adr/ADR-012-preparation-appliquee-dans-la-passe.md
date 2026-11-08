# ADR-012 : La préparation est appliquée dans la passe d'analyse ; l'écran la montre sur le début du fichier

## Statut
Accepté — 2026-11-08 (étape 4b validée par l'auteur : règles « Ignorer », compteurs, aperçu, période, format). Les points « non vérifié » ci-dessous restent à lever.

## Contexte
La maquette « F · Préparer » garde tout le journal en mémoire (20 Mo au plus) et recalcule compteurs et aperçu à chaque réglage. L'application lit des fichiers de plusieurs centaines de Mo et ne garde que des positions (ADR-011) : recalculer sur tout le fichier à chaque réglage exigerait une lecture complète de plus à chaque fois, ce que l'étape 4 avait écarté.

## Décision
- **Une préparation est une donnée simple** (`Preparation`, `src/core/preparation.ts`), envoyée au worker avec la requête. Le fichier n'est jamais modifié.
- **Un seul filtre pour deux usages** : `createEntryFilter` décide, entrée par entrée, ce qui est écarté et tient ses comptes. La passe (`scanLog`) et l'aperçu (`previewHead`) l'utilisent tous les deux ; `scanLog` ne connaît que l'interface `EntryFilter`, pas ce qu'est une règle. Un test compare les compteurs de l'aperçu à ceux de `scanLog` sur chaque échantillon complet.
- **Une entrée écartée est lue et comptée, mais n'est ni une erreur, ni empreintée, et ne consomme pas la limite d'enregistrements.** `ScanResult` rend `ignored` (chaque entrée une fois) et `ignoredPerRule` (une entrée trouvée par deux règles compte pour les deux).
- **Règle « Ignorer » = texte seul**, comparé sans casse au texte retenu de l'entrée, pile comprise (au plus 1 Mio : pour une entrée plus longue, la règle ne voit que son début, et l'écran le dit). 200 caractères au plus par règle, 20 règles au plus ; règles vides ou en double refusées avec la raison. Jamais d'expression régulière : aucun risque de lenteur par motif.
- **L'écran de préparation travaille sur le début du fichier** : `readHead` garde les octets du premier Mio (déjà lus pour reconnaître le format) dans l'état de la page ; `previewHead` en tire compteurs et aperçu (60 lignes, coupées à 300 caractères) sans relire le fichier. Pour un texte collé ou un fichier ≤ 1 Mio, c'est le journal entier et les chiffres sont exacts. Sinon l'écran dit « calculés sur le début du fichier (X sur Y) » et le compte de chaque règle « dans le début » ; les chiffres exacts viennent avec l'analyse.
- **Période = deux bornes en texte** (`Period { from, to }`, dans la préparation) : `HH:MM` pour un format à heure seule (deux couples heure / minutes), `AAAA-MM-JJTHH:MM` pour un format avec date (deux champs date et heure). Borne vide = pas de limite ; la minute de fin est incluse jusqu'à sa dernière seconde. **L'heure est comparée telle qu'écrite dans le journal** : le décalage horaire (`+01:00`) n'est pas lu, et l'écran le dit. Une entrée dont l'horodatage ne peut pas être placé (aucun, ou une heure là où une date est attendue) est **gardée** : rien ne dit qu'elle est dehors.
- **Une période invalide est refusée, jamais devinée** : borne mal formée, heure avec date, **fin avant début** (un passage de minuit n'est pas géré, et l'écran le dit). Le filtre n'applique pas une période invalide, l'écran affiche la raison et interdit « Analyser », et la passe refuse une période invalide par un message d'échec au lieu de s'en passer en silence.
- **L'écran dit où le journal commence et finit** (premier et dernier horodatage tels qu'écrits, « le début du fichier va de… » sur un gros fichier) : sans cela, un champ de date ne dit pas dans quoi choisir.
- **Le format se choisit parmi les formats intégrés** (liste, pas de motif saisi : un motif mal écrit peut ralentir ou figer l'analyse, et il demande un échantillon réel). Le format reconnu est présélectionné et dit « reconnu » ; un autre choix le dit « choisi » et **l'aperçu est lu de nouveau avec lui**, sans relire le fichier (le début est gardé). Changer de format **garde les règles, oublie la période** (elle va avec son format) et efface le résultat d'une analyse.
- **Sans format, rien n'est lu** : un journal non reconnu dit pourquoi, offre la liste et attend ; ni compteurs ni aperçu ni analyse tant qu'aucun format n'est choisi. Un format dont **aucune ligne du début n'est une en-tête** est refusé avec le motif (« Aucune ligne du début ne correspond à ce format »), « Analyser » est interdit. Du JSON n'offre aucun choix (étape 3b).
- **Un journal qui mêle des formats est signalé, pas relu autrement** (décision de l'auteur, 2026-11-08) : le panneau Format dit « N lignes ressemblent à un autre format (…) : elles sont lues comme la suite de l'entrée qui les précède », pour les lignes qui ne sont pas une en-tête du format utilisé mais en sont une d'un autre format connu. La lecture ne change pas : un format à plusieurs motifs n'est pas fait. Le signalement porte sur le début du fichier (« du début » à l'écran sur un gros fichier), pas sur la passe complète.
- **« Analyser » n'est refusé que si le journal entier a été lu et que tout est écarté** (« Rien à analyser »). Sur un début seulement, si plus rien ne reste, l'écran le dit et laisse lancer l'analyse : le reste du fichier n'a pas été lu.
- **Le panneau reste à l'écran après l'analyse**, avec les chiffres exacts. Changer un réglage efface le résultat et ramène à « prêt » avec le message « relancez l'analyse » ; le focus n'est pas déplacé. Après l'analyse, le bouton « Analyser » n'est pas affiché : le résultat est à jour.

## Raisons
- **Le début plutôt qu'une passe de comptage** : une relecture complète à chaque règle coûterait plusieurs secondes sur 300 Mo pour un chiffre que l'analyse donne de toute façon.
- **Même filtre** : deux calculs séparés finiraient par diverger sans que personne le voie.
- **Texte seul** : la lenteur d'une expression saisie par l'utilisateur est un risque que le choix de format (étape 4b, tranche 3) évite aussi.

## Alternatives écartées
- **Passe de comptage complète au choix du fichier** : double la lecture et se refait à chaque réglage.
- **Préparation limitée aux fichiers ≤ 20 Mo (comme la maquette)** : retire la fonction là où elle sert le plus (écarter `/health` d'un gros journal).
- **Motifs par expression régulière** : inutile pour le besoin exprimé, et risque de lenteur.

## Conséquences
- Sur un gros fichier, avant l'analyse, les chiffres ne portent que sur le début : une règle dont les entrées n'apparaissent que plus loin affiche « 0 écartée dans le début ». C'est dit à l'écran, mais cela peut surprendre.
- `ScanRequest` porte la préparation ; `detectFormat` est devenu `readHead` (même lecture, mais les octets du début sont gardés, 1 Mio au plus en mémoire de la page).
- Deux champs s'ajoutent au résultat de la passe (`ignored`, `ignoredPerRule`).

## Mesuré et non vérifié
**Mesuré** (Node 22.20.0, Windows 11, fichier synthétique de 300 Mo, 2 374 922 entrées, un seul fil, blocs de 64 Kio) :
- Comptes exacts : la règle `/health` écarte 752 059 entrées, soit le nombre calculé par le générateur ; `payment` ajoute 19 792 entrées (toutes en erreur : 118 747 → 98 955 erreurs). Mémoire de pointe (RSS) : 71 Mo sans règle, 72 à 77 Mo avec une ou deux règles.
- Durée, 5 passages par configuration, entrelacés : sans règle 4,8 à 10,2 s (médiane 7,1 s) ; une règle 6,4 à 7,8 s (médiane 7,0 s) ; deux règles 6,1 à 7,8 s (médiane 6,6 s). La machine était bruyante : l'écart entre passages d'une même configuration dépasse l'effet des règles, dont **aucun surcoût n'est mesurable** sur ces essais.
- Chrome 156 (`npm run e2e`, 48 vérifications) : une période 12:06 à 12:06 sur l'extrait réel écarte 7 des 21 entrées, laisse 2 erreurs, et les chiffres exacts de l'analyse sont ceux de l'aperçu ; une période datée sur `sample.log` garde 2 entrées sur 14 ; une fin avant le début est refusée et l'analyse interdite. La règle `/health` sur un fichier de 64 Mo donne les compteurs exacts du générateur ; l'annulation garde la règle ; l'extrait réel de 21 lignes donne 15 écartées / 6 prêtes avec `/health` et 0 erreur.
- **Début hostile de 1 Mio** (Node, fil unique de la page, ce calcul n'est pas dans le worker) : 524 288 lignes presque vides, ou 524 288 fins de ligne CRLF seules, coûtent 0,5 à 0,7 s de lecture (`parseHead`, une fois par fichier et par format, la page est figée d'autant) ; ensuite chaque changement de règle coûte au plus 22 ms (20 règles de 30 caractères sur 34 952 entrées). Avant de séparer la lecture de l'application des règles, chaque changement coûtait 0,5 à 1,7 s. Un début normal (34 952 entrées) se lit en 58 ms. Mesuré sous Node, **non mesuré dans le navigateur**.
- Poids gzip de l'application : 80,1 Ko avec le choix du format (79,7 Ko avec la période, 78,3 Ko avec les règles seules, 74,9 Ko à l'étape 4), budget < 300 Ko.

**Non vérifié :**
- **Les formats mélangés sont signalés, pas traités** : un format choisi à la main lit tout le journal avec la même en-tête, et le signalement ne couvre que le début du fichier. Sur l'extrait réel `samples/real-mixed-formats.log`, le format console lit 5 entrées et **absorbe la ligne datée dans l'entrée précédente** (sans le signaler ; seule la ligne avant la première en-tête l'est) ; le format fichier lit 2 entrées. Décision ouverte (`SPEC.md` §8 point 4).
- Le rendu et la saisie du champ « date et heure » du navigateur (`datetime-local`) hors Chrome, et avec une autre langue de navigateur ; une période sur plusieurs jours pour un format à heure seule (non gérée) ; des journaux dont les entrées ont des décalages horaires différents (le décalage n'est pas lu).
- Le temps d'analyse **dans le navigateur** avec des règles sur 300 Mo (seul le comportement a été vérifié, pas la durée).
- Firefox, Safari, Opera ; le sélecteur de fichiers natif ; un lecteur d'écran (annonce des compteurs, des messages de refus et de l'invalidation).
- Un début de fichier dont la dernière entrée est coupée par la limite du premier Mio : ses compteurs de l'aperçu peuvent différer de l'analyse pour cette seule entrée.
- Des journaux réels volumineux.
