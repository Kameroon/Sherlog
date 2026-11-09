# ADR-021 : Source « dossier » (étape 10a) — réalisation et audit du code

## Statut
Proposé — 2026-11-09, en attente de la validation de l'étape 10a par l'auteur. Réalise la partie 10a de l'ADR-020 (audit de conception) ; 10b et 10c ne sont pas faites (voir « Ce qui reste »).

## Contexte
L'auteur a tranché le 2026-11-09 : **un seul niveau** (Q1) et **retenir le dossier pour le relire en un clic** (Q2). Le sélecteur de dossier n'a ni réseau ni secret : c'est la sous-étape la plus sûre, et la seule des trois qui ne dépend d'aucune donnée de l'auteur.

## Décision
- **Choisir un dossier** (Chrome et Edge) : bouton « Choisir un dossier », sur le clic seulement. Le dossier est demandé **en lecture seule** (`showDirectoryPicker({ mode: 'read' })`). Un navigateur sans l'API (Firefox, Safari) ne voit pas le bouton et lit pourquoi ; le choix d'un fichier reste possible.
- **Lister, puis choisir** (`src/sources/folder.ts`). Les fichiers sont listés **sur un seul niveau** (les sous-dossiers ne sont ni parcourus ni listés), au plus **1 000**, du plus récent au plus ancien, avec nom, taille et date. Rien d'un fichier n'est lu pour la liste. L'utilisateur clique « Lire » sur un fichier : ce fichier suit alors **le chemin d'un fichier choisi à la main** (lecture du début, préparation, analyse sur clic). Au-delà de 1 000, l'écran le dit et ne liste que les 1 000 premiers dans l'ordre du dossier, sans ouvrir les suivants ; les fichiers devenus illisibles pendant la liste sont comptés et dits, jamais cachés.
- **Retenir le dossier** (`src/store/folderStore.ts`). Après le choix, la poignée du dossier est gardée dans IndexedDB, **une par identité** (même cloisonnement que la clé, ADR-017) ; avec « Relire ce dossier » on retrouve la liste en un clic, et « Oublier ce dossier » l'efface. **La poignée ne donne aucun accès par elle-même** : le navigateur redemande l'autorisation à chaque session, et l'application ne le demande que depuis ce clic. Sans identité lue, le dossier n'est pas retenu (comme la clé) et l'écran le dit.
- **Les échecs sont dits.** Stockage refusé (« n'a pas pu être retenu », « n'a pas pu être oublié », « n'a pas pu être lu »), lecture refusée par le navigateur (sans chemin ni nom du dossier dans le message), dossier trop grand, fichiers illisibles : jamais un échec muet.
- **Types écrits ici** (`FolderHandle`, `FolderEntry`) : seuls les membres de lecture sont déclarés, `lib.dom` n'ayant ni le sélecteur ni les méthodes de permission ; aucune dépendance ajoutée.
- **Garde sur `src/`** (`tests/sourceGuards.test.ts`) : aucune API qui écrit ou ouvre des fichiers (`createWritable`, `removeEntry`, `getFileHandle`, `getDirectoryHandle`, `showSaveFilePicker`, `showOpenFilePicker`), jamais `mode: 'readwrite'`, `showDirectoryPicker` dans un seul module, `indexedDB` dans un seul module (cloisonné par identité).

## Audit du code contre l'ADR-020
Audit de la sous-étape 10a, liste de contrôle de Sherlog (`CLAUDE.md`, adaptation 6). **Aucun point critique, majeur ni moyen.**

| # ADR-020 | Contrôle exigé | Constat | Preuve |
|---|---|---|---|
| A1 | Lecture seule, aucune écriture | Respecté : mode `read`, types de lecture seule, aucune API d'écriture dans `src/` | 7 gardes sur `src/` (vérifiées en introduisant un appel interdit) ; test unitaire du mode ; e2e : le sélecteur reçoit `"mode":"read"`, jamais `readwrite` |
| A2 | Liste, puis choix ; rien lu avant | Respecté : la liste ne lit que nom, taille, date ; le fichier n'est donné au parcours existant qu'au clic « Lire » | tests d'intégration (aucune lecture avant le clic) ; e2e : rien demandé au navigateur avant le clic, aucune analyse après « Lire » |
| A3 | Un seul niveau, borné, dit | Respecté : 1 000 fichiers au plus, sous-dossiers ignorés, au-delà dit, suivants non ouverts ; **mesuré : 916 ms pour lister 1 000 fichiers** dans Chrome | 20 tests du cœur ; 11 mutations vérifiées ; e2e (1 001 fichiers réels) |
| A4 | Poignée gardée par identité, avec « Oublier » | Respecté : clé `folder:<identité>`, une poignée par identité, valeur relue validée (une valeur d'un autre genre n'est pas crue), oubli effectif ; **une vraie poignée survit au stockage et à un rechargement** | 17 tests du magasin, 6 mutations vérifiées ; e2e : la clé IndexedDB porte l'identité, « Relire » liste après rechargement, « Oublier » vide IndexedDB |
| A5 | Fichier modifié pendant la lecture | Déjà traité à l'étape 4 | tests existants |
| A6 | Navigateur sans l'API | Bouton absent, raison dite | test |
| T3 | Noms non fiables rendus en texte | Respecté | test : un nom `<img onerror>` reste du texte ; garde sur `src/` |
| T4 | Rien lu ni analysé sans action ; limite dite | Respecté (voir A2, A3) | idem |
| T5 | Aucun secret | Sans objet : aucun secret, aucun réseau ; aucun nom de dossier dans un message d'erreur | test |
| Réseau, CSP, routes, dépendances | Inchangés | `staticwebapp.config.json`, `package.json` et le verrou inchangés ; aucune nouvelle sortie réseau ; `npm audit` au seuil élevé : réussi | `git diff` ; `npm run audit` |

**Risque résiduel accepté.** Un script injecté dans la page (XSS) pourrait lire la poignée dans IndexedDB (même origine) et, **tant que l'utilisateur a autorisé le dossier pendant la session**, en lister et en lire les fichiers (en lecture seule, un niveau). Réduit par : CSP stricte, aucun HTML brut, autorisation redemandée à chaque session, lecture seule, bouton « Oublier ». Même ordre de risque que la clé d'IA gardée dans le navigateur (ADR-017).

**Défauts trouvés et corrigés pendant l'étape :** (1) le sélecteur du navigateur était lu **une seule fois** à la création, au lieu d'être cherché à chaque appel — trouvé par le test de bout en bout, qui installe son sélecteur après l'affichage ; (2) une transaction IndexedDB qui échoue pouvait laisser un rejet sans écouteur — les deux promesses sont maintenant attendues ensemble ; (3) un contrôle « c'est un fichier » n'était pas prouvé (redondant avec l'absence de `getFile`) — le test donne maintenant à un dossier une façon d'être lu, pour que seul son genre l'écarte.

**Mesuré.** 1 323 tests Vitest ; **151 vérifications de bout en bout dans Chrome** sous la CSP de production, dont le parcours dossier avec un **vrai `FileSystemDirectoryHandle`** (le dossier privé de l'origine de Chrome, avec de vrais fichiers) : liste, un seul niveau, lecture seule, stockage IndexedDB par identité, relecture après rechargement, lecture d'un fichier du dossier, oubli, 1 001 fichiers ; application à 103,7 Ko gzip (332,2 Ko bruts) pour un budget de 300 Ko gzip, sans dépendance ajoutée.

**Non vérifié.**
- **La vraie boîte de dialogue du navigateur** (non pilotable par un test) et **l'autorisation redemandée** (`prompt`) sur le poste de l'auteur : le dossier privé de l'origine est toujours autorisé. Le comportement « autorisation à redonner » est testé sur des poignées de test (`queryPermission` / `requestPermission` simulés), pas sur un vrai dossier du disque.
- **Un vrai dossier de journaux** de l'auteur (taille, nombre de fichiers, noms, verrous d'un autre programme qui écrit dedans).
- Edge ; Firefox et Safari (sans l'API, par conception).

## Ce qui reste de l'étape 10
- **10b (URL)** : bloquée. Elle exige les **comptes de stockage exacts** (`https://<compte>.blob.core.windows.net`, ADR-020 Q3), qui n'ont pas été donnés ; aucun n'est deviné. Q4 (limite de téléchargement) est laissée à ma décision : elle sera **mesurée** sur un fichier généré, comme à l'étape 4.
- **10c (Azure Monitor)** : bloquée. Elle exige l'étape 3b (profil structuré), un export réel, un enregistrement Entra et un workspace (ADR-020 Q5), non fournis.
