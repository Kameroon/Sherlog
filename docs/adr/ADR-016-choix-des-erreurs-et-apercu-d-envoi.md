# ADR-016 : Choix explicite des erreurs à envoyer et aperçu du texte exact

## Statut
Accepté — 2026-11-09, avec la validation par l'auteur de l'étape 6 entière (tranche 3 : choix des erreurs et aperçu d'envoi).

## Contexte
`SPEC.md` §3 et §6 demandent qu'après l'analyse locale l'utilisateur coche les erreurs à faire expliquer (aucune d'office), consulte **le texte exact qui serait envoyé, toujours masqué**, avec un avertissement si aucun masquage n'est actif, et décide d'envoyer ou non ; `redact` reste le dernier filet. L'envoi lui-même (fournisseur, clé) est l'étape 7 et le prompt durci l'étape 8 : cette tranche construit et montre ce qui partirait, sans rien envoyer.

## Décision
- **Le choix se fait par empreinte** (`ErrorBrowser`, état de session comme les statuts) : la case « Faire expliquer cette erreur par l'IA » est dans le détail, décochée par défaut, et vaut pour toutes les erreurs identiques (l'analyse vaut pour elles, `SPEC.md` §3). Les lignes de la liste portent une pastille texte « À envoyer ». Un panneau « Envoi à l'IA » liste les erreurs choisies (« Tout retirer » à partir de deux).
- **Quelle occurrence part** : la plus récente de l'empreinte (`latestOccurrence`, `SPEC.md` §3) — le plus grand horodatage, la dernière lue à égalité. **Sans date dans le format** (console), les heures du jour ne se comparent pas (un journal passe minuit) : la dernière lue part, et l'écran le dit (« ce format n'a pas de date »). Idem quand aucune heure n'est exploitable. Le détail et le panneau indiquent l'occurrence retenue. `timeKey` quitte `errorView` pour un module commun.
- **Le texte exact est construit par `buildSendPayload`** (fonction pure de `core`) selon le gabarit de `docs/PROMPTS.md` §2 : occurrences (première, dernière), fichier, erreur, contexte avant, contexte après. **Il est tout ce qui vient du journal** : les consignes au modèle et le délimiteur aléatoire par requête sont ceux de l'étape 8 ; le panneau le dit. Le texte exact de la requête complète ne peut donc pas être montré avant l'étape 8.
- **Masquer avant de couper.** Tout est masqué d'abord (entrée, contexte avant et après chacun comme un seul texte, nom de fichier), avec `rulesForSending` : les règles choisies et **toujours** celles cochées d'office. Ensuite seulement le texte est coupé à `MAX_INPUT_CHARS` (12 000, provisoire) : une coupure ne peut pas tomber dans un secret et en laisser partir une partie (test réglé pour que la coupure tombe cinq caractères dans le mot de passe).
- **Politique de coupure explicite** : l'entrée est gardée avant tout contexte ; le reste est partagé entre les deux côtés, un côté court cédant sa place à l'autre ; chaque côté garde les lignes **les plus proches** de l'erreur, entières (seule une ligne unique plus grande que la place est coupée) ; le texte ne dépasse jamais la limite. La note « Note : le contenu a été tronqué à N caractères. » est ajoutée quand quelque chose est coupé, **y compris** quand l'entrée avait déjà été coupée à la lecture (limite de 1 Mio de l'ADR-011).
- **Le nom de fichier est masqué sans son extension**, qu'on remet ensuite : `export-jane@acme.com.log` finirait sinon par `.log`, que la règle e-mail prend pour un nom de fichier (son garde-fou contre les faux positifs, ADR-015) et laisserait passer l'adresse.
- **Lecture à la demande, masquage à l'affichage.** Le panneau ne lit le fichier (entrée et 10 lignes de chaque côté) que lorsque l'utilisateur clique « Voir le texte exact » ; le masquage est appliqué au rendu, donc un changement des cases dans la préparation se voit tout de suite, sans relire. Une réponse qui arrive après la fermeture ou un autre choix est écartée. **Corrigé à la revue** : `readText` et `readNeighbours` de `useLogScan` dépendaient de tout l'état, et changer une case de masquage crée un nouvel état : chaque changement relisait le fichier (une fois pour le détail, une fois pour chaque texte exact ouvert), et le test d'origine, qui donnait des lecteurs stables, ne le voyait pas. Ils ne dépendent plus que de la source et de l'encodage ; un test d'intégration compte les lectures.
- **Tout ce qui part est masqué, l'en-tête compris** : les heures « première » et « dernière » sont le texte que le format a capturé ; les formats intégrés ne capturent que des chiffres, mais un motif personnalisé pourrait capturer n'importe quoi, et `redact` est le dernier filet.
- **Transparence** : le panneau affiche les masquages appliqués (ceux de l'ADR-015 qui valent à l'envoi), le nombre de données masquées dans le texte, et, si aucune case n'est cochée dans la préparation, un avertissement qui dit que seuls les masquages automatiques s'appliquent.
- **Rien ne part** : le bouton « Envoyer à l'IA » est désactivé et dit que le fournisseur (Anthropic ou Ollama) se choisit à l'étape suivante et que rien n'a été envoyé.

## Raisons
- Un choix par empreinte suit ce que `SPEC.md` décide (l'analyse vaut pour les identiques) et évite d'envoyer N fois la même erreur.
- Construire le texte dans `core` le rend testable sans interface et réutilisable tel quel par l'étape 8, qui n'a plus qu'à l'entourer des consignes.

## Alternatives écartées
- **Cases dans les lignes de la liste** : la liste est virtualisée par blocs (ADR-013), des cases dans chaque ligne compliquent le clavier ; la case est dans le détail, la marque dans la ligne suffit.
- **Choisir une occurrence précise** : non demandé ; la plus récente est ce que la spec prescrit.
- **Couper d'abord, masquer ensuite** : plus simple, mais laisse partir le début d'un secret coupé.
- **Montrer la requête complète** : impossible avant l'étape 8 (délimiteur aléatoire, consignes).

## Conséquences
- Le **détail de l'erreur** (étape 5) montre toujours le texte d'origine relu du fichier, mot de passe compris : il reste sur l'écran de l'utilisateur et ne part nulle part. La spec parle de masquage « à l'écran » pour l'espace de préparation ; **l'auteur a tranché le 2026-11-09 de ne pas masquer le détail** : il montre le journal tel qu'il est, le contrôle de ce qui part étant le panneau « Envoi à l'IA ».
- Les lignes autour sont masquées dans le texte envoyé (validé par l'auteur, ADR-013), mais restent montrées telles quelles dans le détail (« Voir les lignes autour »).
- `MAX_INPUT_CHARS` (12 000) est **validée par l'auteur le 2026-11-09**, mais non mesurée sur un modèle réel : à reprendre à l'étape 7 ou 8 si les réponses réelles le demandent.
- L'occurrence « la plus récente » d'un journal sans date est la dernière lue : ce peut ne pas être la plus récente en temps. Avec date, les heures se comparent **telles qu'écrites** (le décalage `+01:00` n'est pas lu, comme pour la période et le tri, ADR-012 et ADR-014) : au passage à l'heure d'hiver, `02:30 +02:00` puis `02:10 +01:00` donnent pour plus récente la première, alors que la seconde l'est en temps réel.

## Mesuré et non vérifié
**Mesuré** : 19 tests de `buildSendPayload` (mise en page, masquage, coupure, paire de caractères UTF-16), 7 de `latestOccurrence`, 23 de l'interface (choix, occurrence, texte exact, avertissements, lecture en échec). Chrome 156 sans interface, `npm run e2e` (78 vérifications) sur un texte collé qui contient une adresse e-mail et deux adresses IP, dont une dans la ligne qui suit l'erreur : le texte exact les masque toutes, le balisage collé reste du texte, aucune erreur n'est choisie d'office, l'envoi est désactivé et le dit ; console sans erreur.

**Non vérifié :** la valeur de `MAX_INPUT_CHARS` sur un modèle réel ; la lecture au lecteur d'écran du panneau et de la case ; un journal réel dont l'erreur a des lignes autour très longues.
