# ADR-011 : Lire une source en une passe dans un worker, garder des positions plutôt que du texte

## Statut
Proposé — 2026-11-07. Passe à « Accepté » avec la validation de l'étape 4 par l'auteur.

## Contexte
L'étape 4 branche le cœur (étapes 2 et 3) sur l'application : choisir un fichier ou coller du texte, lire plusieurs centaines de Mo sans figer la page, ne pas garder le texte des entrées en mémoire, relire une entrée à la demande, signaler toute limite. La règle validée avec la maquette de préparation s'applique : **rien n'est analysé ni envoyé sans un clic de l'utilisateur** (`SPEC.md` §3).

## Décision
- **Une source est un `Blob`** : un `File` en est un, et le texte collé devient `new Blob([texte])`. L'interface `LogSource` esquissée dans `ARCHITECTURE.md` n'est pas écrite : une seule implémentation réelle (YAGNI). Elle reviendra si deux sources distinctes l'exigent (étapes 10a à 10c).
- **Choisir un fichier ne lit que son début** (`DETECTION_HEAD_BYTES` = 1 Mio) pour reconnaître le format et l'encodage (`src/sources/detectFormat.ts`). Rien n'est conservé ni analysé. Un format JSON ou non reconnu est affiché avec sa raison ; le choix manuel est l'étape 4b.
- **L'analyse est une seule passe, lancée par « Analyser ce journal »**, dans un worker (`src/core/scanLog.ts` pour la logique, `src/workers/` pour la coque). Le profil reconnu est passé par son identifiant ; il n'y a donc aucune fenêtre de lignes à garder dans la passe.
- **Par erreur, on garde une position, pas un texte** : `offset`, `length`, horodatage, niveau, `lineCount`, première ligne coupée à 300 caractères (marquée `…` à l'écran) et l'identifiant de son empreinte. Les clés d'empreinte sont dédoublonnées (table clé → identifiant). Le texte se relit avec `Blob.slice` (`src/sources/readEntryText.ts`).
- **Annulation = `worker.terminate()`** ; le worker est aussi terminé à la fin, au retour au choix et au démontage de la page. Les erreurs partent par lots de 500 et la progression au plus toutes les 100 ms.
- **Flux lu avec `getReader()`**, pas par `for await` : l'itération asynchrone d'un `ReadableStream` n'existe pas dans tous les navigateurs pris en charge.
- **Mémoire et affichage bornés, à l'audit de sécurité** : la partie « message » d'une clé d'empreinte est coupée à 1 000 caractères (sinon la mémoire suit la taille du fichier quand les lignes d'erreur sont longues et toutes différentes) ; la relecture d'une entrée (`readEntryText`) lit au plus 1 Mio et dit « Cette entrée fait N Mio : seul son début (1 Mio) est affiché » (sinon un seul vidage de plusieurs centaines de Mo après une ligne d'erreur plante l'onglet).
- **Le worker est un script du même site** (`worker-src 'self'`, déjà dans la CSP), jamais un worker en ligne (`blob:` est interdit par la CSP).
- **Seuils** (constantes nommées, chacune signalée à l'écran quand elle est atteinte) :

| Constante | Valeur | Rôle |
|---|---|---|
| `MAX_ERROR_RECORDS` | 100 000 | erreurs enregistrées ; au-delà elles sont comptées, pas enregistrées |
| `MAX_FIRST_LINE_CHARS` | 300 | longueur de première ligne gardée dans un enregistrement |
| `MAX_DISPLAYED_ERRORS` | 200 | lignes affichées (la liste n'est virtualisée qu'à l'étape 5) |
| `MAX_RETAINED_BYTES` | 1 Mio (inchangé) | texte gardé par ligne ou par entrée (ADR-010) |
| `DETECTION_HEAD_BYTES` | 1 Mio | début lu pour reconnaître le format |
| `MAX_MESSAGE_KEY_CHARS` | 1 000 | message normalisé gardé dans une clé d'empreinte |
| `MAX_ENTRY_TEXT_BYTES` | 1 Mio | texte relu pour une entrée affichée |

## Raisons
- **100 000 enregistrements** : environ 280 octets chacun, soit 26 Mo dans le worker et autant dans la page. Sans limite, un fichier de 1 065 393 erreurs coûte 274 Mo dans le worker seul, que la page copie ensuite.
- **Une seule passe** : une 2e lecture complète d'un fichier de plusieurs centaines de Mo n'apporte rien à l'étape 4. L'étape 4b décidera d'une relecture quand elle aura des règles « ignorer » et « période » à appliquer.
- **Début de fichier seulement pour la reconnaissance** : un préfixe qui satisfait un en-tête (qui se termine par `.*`) prouve que la ligne entière le satisfait ; une coupure au milieu de la dernière ligne est sans effet.
- **Plafond d'affichage visible** : afficher 100 000 lignes figerait la page ; la virtualisation est prévue à l'étape 5, le plafond est dit à l'écran.

## Alternatives écartées
- **Deux passes (lecture qui compte, puis analyse qui conserve)** : double la lecture pour préparer une étape qui n'existe pas encore.
- **Détecter le profil dans le flux** : oblige à garder les 50 premières lignes, jusqu'à 50 Mio si elles font 1 Mio chacune.
- **Interface `LogSource`** : voir plus haut.
- **`for await` sur le flux** : non pris en charge partout.

## Conséquences
- **Limites visibles** : erreurs non enregistrées, lignes non affichées, entrées très longues (empreinte calculée sur leur début) sont dites à l'écran, jamais tues.
- La page recopie la liste des enregistrements à chaque lot reçu (`useLogScan`) : acceptable à 100 000 enregistrements (mesuré ci-dessous), à revoir si la limite augmente.
- Un fichier modifié ou déplacé après son choix donne un message clair à la relecture (`NotFoundError`, `NotReadableError`) ; la lecture en cours se termine alors en échec explicite.
- **Un worker qui ne démarre pas devient un message** (revue de fin d'étape) : le navigateur refuse la création de façon synchrone (`SecurityError` observé dans Chrome pour une adresse hors du site) ou signale un script introuvable par un événement `error` sans texte. Les deux donnent « L'analyse n'a pas pu démarrer dans ce navigateur (nom de l'erreur) » ou « Le traitement n'a pas pu démarrer (script introuvable ou refusé) », avec retour au choix du journal ; l'écran ne reste jamais sur « Analyse en cours ».
- Au-delà de `MAX_ERROR_RECORDS`, les erreurs suivantes sont comptées sans être empreintes : le nombre d'erreurs distinctes est alors un minimum, écrit « au moins N distinctes ».
- Le focus clavier suit les étapes (nom du journal, résultat, message d'échec) et la zone `role="status"` ne contient qu'un texte fixe : le pourcentage, qui change dix fois par seconde, reste hors de la zone annoncée. Vérifié par tests et dans Chrome (élément ayant le focus) ; **non vérifié avec un lecteur d'écran**.
- L'étape 4b insérera la préparation entre « prêt » et « analyse en cours » sans changer ce découpage.

## Mesuré et non vérifié
Les fichiers de mesure sont **synthétiques** (6 modèles de messages, pile de 6 lignes, générés par un script jetable non versionné). Ils ne remplacent pas de vrais gros journaux.

**Mesuré — Node 22.20.0, Windows 11, un seul fil, blocs de 64 Kio** (`scanLog` seul, lecture par `fs`) :

| Fichier | Taille | Entrées / erreurs | Durée | Pic mémoire (RSS) | Gardé en mémoire |
|---|---|---|---|---|---|
| normal | 300 Mo | 2 374 922 / 118 747 | 5,3 à 6,1 s (≈ 50-56 Mo/s) | 93 à 98 Mo | 26,5 Mo (100 000 enregistrements, limite atteinte) |
| unique (messages tous différents) | 100 Mo | 794 464 / 39 724, 39 724 empreintes | 3,0 s | 81 Mo | 14,7 Mo (≈ 388 o par enregistrement) |
| all-errors | 100 Mo | 1 065 393 / 1 065 393 | 3,4 s | 96 Mo | 26,4 Mo |
| all-errors **sans limite** | 100 Mo | 1 065 393 enregistrées | 9,9 s | 357 Mo | 274 Mo |

**Mesuré — Chrome 156.0.8078.80 sans interface, application construite servie avec la CSP de production** (fichier envoyé au vrai champ par le protocole DevTools) :

| Fichier | Reconnaissance | Analyse | Tas de la page | Annulation |
|---|---|---|---|---|
| normal 300 Mo | 265 ms | 15,8 s (≈ 19 Mo/s) | 25 Mo | retour en 13 ms |
| all-errors 100 Mo | 238 ms | 11,8 s | 37 Mo | retour en 20 ms |
| unique 100 Mo | — | 8,4 s | 20 Mo | — |

Constats du même essai : aucune erreur de CSP ni de worker ; progression croissante (30 relevés sur 300 Mo) ; rien d'analysé avant le clic ; aucun résultat après une annulation ; texte collé contenant `<img onerror=…>` affiché comme du texte, sans élément `img` dans la page ; relecture d'une entrée depuis le fichier correcte. Seule alerte : `404` sur `/.auth/me`, normal hors Azure.

**Mesuré — fichiers hostiles de l'audit de sécurité (Node 22.20.0), avant puis après correction** :

| Cas | Avant | Après |
|---|---|---|
| 200 erreurs de 1 Mio toutes différentes (200 Mo) | ≈ 200 Mio de clés gardées dans le worker (tas 605 Mo, dont ≈ 400 Mo du fichier de test lui-même) | clés ≈ 1 Ko chacune (tas 405 Mo, tout ou presque est le fichier de test) ; pic RSS 860 → 677 Mo |
| une seule entrée de 200 Mio, relue par « Voir le texte » | 200 Mio lus et rendus ; RSS 873 Mo ; 0,33 s | 1 024 Ko rendus, `cut` vrai ; RSS 284 Mo ; instantané |

Le pic de mémoire du premier cas inclut le fichier construit en mémoire par le script de mesure ; seule la différence avant/après est interprétable. Dans le navigateur, l'effet n'a pas été relevé.

Ce parcours est versionné dans `scripts/e2e/` (`npm run e2e`, 17 vérifications, fichier de 64 Mo généré à chaque exécution, comptes attendus exacts) : il reste exécutable à la main, il n'est pas encore branché dans le workflow de CI (décision à prendre : le workflow actuel ne le lance pas, et rien n'a été vérifié sur ce point).

**Non vérifié :**
- Firefox, Safari, Edge et Opera (le navigateur de l'auteur) : seul Chrome a été exercé ; le sélecteur de fichiers natif n'a pas été utilisé (le champ a reçu le fichier par DevTools).
- La mémoire du **worker dans le navigateur** (seul le tas de la page a été relevé).
- Le rendu de plus de 200 lignes : le plafond de 200 n'est pas issu d'une mesure de rendu, il sera remplacé par la virtualisation de l'étape 5.
- Un fichier qui change réellement pendant la lecture (le cas est simulé en test) ; un disque ou un partage réseau lents.
- De vrais gros journaux, et `TextDecoder('utf-16be')` dans les navigateurs (hérité de l'ADR-010).
