# ADR-013 : Liste des erreurs virtualisée par blocs, sans style calculé

## Statut
Accepté — 2026-11-08, avec la validation par l'auteur des trois tranches de l'étape 5 (liste, badge « ×N identiques », détail, jetons, lignes autour).

## Contexte
La liste de l'étape 4 n'affichait que 200 erreurs, avec un bouton « Voir le texte » dans chaque ligne (ADR-011 : « le plafond sera remplacé par la virtualisation de l'étape 5 »). L'étape 5 doit montrer **toutes** les erreurs enregistrées, jusqu'à 100 000, sans une ligne de page par erreur. Les bibliothèques de virtualisation, comme une virtualisation écrite à la main, positionnent les lignes par des styles calculés en script (`style={{ height }}`, `transform`, variables CSS) ; la règle du projet l'interdit (la CSP n'autorise pas `'unsafe-inline'`).

## Décision
- **Virtualisation par blocs de hauteur fixe** (`ErrorList`, `ROWS_PER_CHUNK` = 50) : la liste est découpée en blocs de 50 lignes qui ont tous la même hauteur, donnée par la classe CSS (`--row-height`). Les blocs proches de la fenêtre contiennent de vraies lignes, les autres sont un espace vide de la hauteur d'un bloc (même hauteur par classe). **Le dernier bloc, partiel, est toujours réel.** Aucun style n'est calculé : le script lit seulement `scrollTop`, `clientHeight` et la hauteur mesurée du premier bloc (la hauteur d'une ligne suit la taille du texte, elle est mesurée, pas supposée).
- **Une ligne = une seule ligne de texte** : heure, niveau, badge « ×N identiques », message ; les points de suspension coupent un message long. Le texte entier est dans le détail.
- **Le message n'est plus la première ligne entière** : `ErrorRecord.message` est ce qui suit l'horodatage et le niveau (le texte de l'en-tête, groupe `msg` du format ; la première ligne entière si le format n'en a pas). Constaté sur une capture : avec un format daté, la première ligne commence par l'horodatage, déjà montré dans sa colonne, et le message utile disparaissait derrière les points de suspension. `MAX_MESSAGE_CHARS` = 300 remplace `MAX_FIRST_LINE_CHARS`.
- **Motif listbox** : le focus reste sur la liste (une ligne démontée perdrait le sien), `aria-activedescendant` désigne la ligne active, dont le bloc est toujours monté ; chaque option dit sa place (`aria-setsize`, `aria-posinset`). Flèches, Début, Fin, Page ↑ / ↓ déplacent la ligne active ; Entrée, Espace ou un clic la sélectionnent, ce qui ouvre son détail. Se déplacer ne relit pas le fichier.
- **« ×N identiques »** : `summariseIdentical` regroupe en une passe les erreurs enregistrées par empreinte (nombre, première et dernière **dans l'ordre de lecture**, pas dans l'ordre du temps). Pas de badge pour une erreur unique. Quand la limite des 100 000 est atteinte, les comptes portent sur les erreurs enregistrées, ce que l'avertissement du résumé dit déjà.
- **Détail** : l'entrée sélectionnée est relue depuis le fichier (`readEntryText`, 1 Mio au plus, coupure dite) ; chargement, échec de lecture et réponse arrivée après un autre choix sont traités. Pour une erreur qui a des jumelles, il dit « N erreurs identiques parmi les erreurs enregistrées » (« Au moins N » quand la limite de 100 000 est atteinte) avec la première et la dernière **dans l'ordre de lecture** (heure telle qu'écrite ou « sans heure », et leur numéro dans la liste).
- **Un détail qui plante ne prend pas la liste avec lui** : `ErrorBoundary` a une variante locale (`scope="panel"`, repli court « Ce panneau n'a pas pu s'afficher », sans le message de l'erreur ni contenu de journal) ; choisir une autre erreur repart de zéro.
- **Annonces** : le focus reste sur la liste quand on sélectionne (pour continuer aux flèches) ; un texte caché annonce « Détail de l'erreur N affiché » une fois la lecture finie, et « Lignes autour de l'erreur N affichées » quand les lignes autour sont arrivées (rien en cas d'échec : l'alerte parle). Le texte du détail est un point d'arrêt au clavier (région nommée) juste après la liste.
- **Lignes autour** (« Voir les lignes autour », à la demande, jamais au choix d'une erreur) : `readNeighbourLines` relit **10 lignes avant et 10 lignes après** l'entrée. Ce sont les lignes **du fichier**, quelle que soit l'entrée à laquelle elles appartiennent (autres erreurs, avertissements, pile de l'entrée précédente) ; l'écran le dit. Chaque côté est lu dans une **fenêtre de 64 Kio** (`MAX_NEIGHBOUR_BYTES`) avec `Blob.slice`, car une ligne peut être aussi longue que le fichier. La ligne que la fenêtre coupe est **écartée**, jamais montrée en partie ; si cela laisse moins de 10 lignes alors que le fichier continue, le côté concerné affiche « Lecture limitée aux 64 Kio qui précèdent / suivent l'erreur : il peut manquer des lignes ». Au bord du fichier, l'écran dit « Aucune ligne avant / après : l'erreur est au début / à la fin du journal » (pas de message de limite, rien ne manque). Le bouton montre et masque (`aria-expanded`) ; masquer démonte le panneau, et si l'erreur change alors que le panneau reste monté, la réponse de l'ancienne erreur est écartée (garde testée par mutation : sans elle, deux tests échouent). Les lignes sont du texte (`pre`), jamais du balisage. La lecture suit l'encodage du journal (UTF-8, UTF-16 avec fenêtre alignée sur une unité de code, CRLF).
- **Jetons** (ADR-009, étendus) : fond d'erreur, ligne sélectionnée, badge, hauteur de ligne, définis dans les deux thèmes, contrastes mesurés dans l'en-tête de `base.css`. La couleur en dur ajoutée à l'aperçu en 4b devient un jeton.

## Raisons
- Une virtualisation à styles calculés contredit la règle du projet ; les blocs la respectent en gardant l'essentiel du gain (150 à 250 lignes dans la page pour 100 000).
- Une hauteur de ligne fixe est ce qui permet de sauter les lignes sans les mesurer une à une.

## Alternatives écartées
- **Bibliothèque de virtualisation** : dépendance en plus, et styles calculés.
- **Styles calculés par `element.style`** (que la CSP ne viserait pas, à ma connaissance) : serait compatible avec la CSP, à ma connaissance (non vérifié ici), mais pas avec la règle écrite du projet ; non retenu tant que les blocs suffisent.
- **Garder le plafond de 200 lignes** : cache des erreurs enregistrées.

## Conséquences
- Le message d'une ligne est tronqué par CSS ; la ligne n'est donc pas un moyen de lire un message de 300 caractères : c'est le détail.
- Un bloc vide garde la hauteur d'un bloc plein : une hauteur de ligne qui changerait selon la ligne (retour à la ligne, police) casserait le saut. Elle est fixe par classe.
- Les lignes autour ignorent la préparation (règles « Ignorer », période) : elles montrent le fichier tel qu'il est, y compris des lignes que l'utilisateur a écartées de l'analyse. Le masquage avant envoi à l'IA (étape 6) devra s'appliquer à elles aussi.
- La fenêtre de 64 Kio est une valeur provisoire, comme les autres plafonds de lecture ; si la fenêtre commence exactement au début d'une ligne, cette ligne entière est écartée par prudence (le message de limite reste exact : des lignes peuvent manquer).
- Hauteur totale de la liste : 100 000 lignes × 2,75 rem. À un zoom ou une taille de texte très grands (de l'ordre de 400 %), cette hauteur approche les limites de hauteur d'élément de certains navigateurs (non vérifié).

## Mesuré et non vérifié
**Mesuré** (Chrome 156.0.8078.80 sans interface, `npm run e2e` (58 vérifications), application construite sous la CSP de production, fichier synthétique de 14 Mo qui donne plus de 100 000 erreurs, 100 000 enregistrées) :
- 200 lignes et 3 544 nœuds dans la page pour 100 000 erreurs (dont 2 000 blocs vides) ; première ligne affichée dès la fin de l'analyse (1 ms) ;
- touche Fin : 22 à 50 ms jusqu'à la 100 000e erreur dans la page ; Page ↑ : 17 à 25 ms ; saut de l'ascenseur au milieu : 49 à 53 ms (deux images dessinées comprises) ;
- tas JavaScript de la page : 32 à 55 Mo selon le passage (ramasse-miettes) avec les 100 000 enregistrements ;
- aucune violation de la CSP, console sans erreur ;
- lignes autour (même exécution, `npm run e2e`, 62 vérifications) : sur la dernière erreur du fichier de 14 Mo, 10 lignes avant, toutes des lignes du fichier ; sur un texte collé, aucune ligne avant et la ligne suivante après. Tests unitaires (Node, Vitest) : lecture identique aux lignes du fichier pour chaque erreur de l'échantillon réaliste en UTF-8, UTF-8 CRLF, UTF-16 LE et BE ; fenêtres coupées au milieu d'un caractère UTF-8 ou d'une unité UTF-16 ; une ligne plus longue que la fenêtre. Le temps de lecture n'a pas été mesuré (deux lectures de 64 Kio au plus).

**Non vérifié :**
- Firefox, Safari, Opera ; un lecteur d'écran (annonce de la ligne active, de « 12 sur 100 000 », des badges) ; la hauteur maximale d'un élément à un très grand zoom ; la liste sur un écran étroit (colonnes empilées, non essayées à la main).
- Les annonces du lecteur d'écran du détail (« affiché », nombre d'erreurs identiques) et des lignes autour (« affichées », bouton déplié, lecture en cours, avertissement de limite) : les textes existent et sont testés, leur rendu par un vrai lecteur d'écran ne l'est pas ; l'aspect des lignes autour à l'écran n'a pas été regardé à la main.
- Des journaux réels volumineux.
