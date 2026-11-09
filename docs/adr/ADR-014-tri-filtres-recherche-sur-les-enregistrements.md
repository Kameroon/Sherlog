# ADR-014 : Tri, filtre de niveau et recherche calculés sur les enregistrements en mémoire

## Statut
Proposé — 2026-11-09, tranche 1 de l'étape 5b faite (tri, recherche, filtre de niveau). Passera à « Accepté » avec la validation de l'étape par l'auteur ; les statuts (tranche 2) y seront ajoutés.

## Contexte
La liste de l'étape 5 montre les erreurs enregistrées dans l'ordre de lecture. L'étape 5b ajoute le tri, la recherche plein texte et des filtres (`SPEC.md` §3). Un enregistrement (`ErrorRecord`) ne garde que la position de l'entrée, son heure, son niveau et le début de son message (300 caractères au plus) ; le texte entier et la pile sont relus du fichier à la demande (ADR-011, ADR-013).

## Décision
- **Calcul pur dans `src/core/errorView.ts`** : `buildErrorView(records, groups, options)` renvoie les **positions** des enregistrements à montrer, dans l'ordre voulu. Elle ne copie ni ne modifie les enregistrements. `ErrorBrowser` en tire la liste affichée ; `ErrorList` reste inchangée (elle reçoit les enregistrements déjà choisis et ordonnés).
- **La recherche porte sur l'heure, le niveau et le début du message**, sans tenir compte de la casse, avec une chaîne simple (pas d'expression régulière : pas de risque de ReDoS). **Elle ne cherche pas dans la pile** — choix de l'auteur du 2026-11-09 : chercher dans la pile obligerait à relire chaque entrée du fichier (jusqu'à 100 000) dans un worker, avec progression et annulation. L'écran le dit, sous le champ.
- **Tri** : un seul menu « Trier par » qui porte la clé et le sens (8 choix), donc aucun sens par défaut à deviner. Clés : ordre de lecture, heure, gravité (fatal / critique avant erreur), nombre d'identiques (`SPEC.md` : le badge « ×N identiques » est triable). Les égalités gardent l'ordre de lecture (tri stable). Les clés sont calculées une fois par erreur, pas à chaque comparaison.
- **Heure** : comparée **telle qu'elle est écrite** (date, heure, fraction de seconde ; le décalage `+01:00` n'est pas lu), comme la période de la préparation (ADR-012). Les erreurs sans heure exploitable restent **à la fin**, quel que soit le sens ; l'écran le dit quand ce tri est choisi.
- **Filtre de niveau** : un niveau tel qu'il est écrit dans le journal, proposé seulement s'il y en a au moins deux dans les erreurs enregistrées.
- **Sélection stable** : l'erreur sélectionnée est repérée par sa position dans la liste complète (son numéro dans le journal), donc elle reste sélectionnée quand l'ordre change. Si un filtre la cache, son détail reste affiché jusqu'à ce qu'on en choisisse une autre. Le numéro « Détail de l'erreur N » est ce numéro du journal, pas la place dans la liste triée.
- **Un nouveau tri, filtre ou texte repart du haut de la liste** (`key` de `ErrorList`). Aucun résultat : message et bouton « Réinitialiser » à la place de la liste.
- **Frappe fluide** : le champ de recherche répond tout de suite, la liste suit avec `useDeferredValue`.

## Raisons
- Pas de nouvelle lecture du fichier, pas de worker : tout se calcule sur ce qui est déjà en mémoire, en un temps mesuré court.
- Une fonction pure dans `core` se teste sans interface (ADR-003).

## Alternatives écartées
- **Recherche dans la pile** : voir ci-dessus ; à reprendre si l'usage montre qu'elle manque.
- **Deux contrôles (clé + sens)** : exige un sens par défaut par clé ; le menu unique est plus simple à lire et à tester.
- **Expression régulière saisie par l'utilisateur** : ReDoS, et rien ne le demande (même choix que pour les règles « ignorer »).
- **Index de recherche en mémoire** : consomme de la mémoire pour un gain inutile à 100 000 messages courts.

## Conséquences
- Les erreurs dont le message a été coupé à 300 caractères ne se trouvent que par leur début.
- Le tri par heure d'un journal sans date (console) compare des heures du jour : un journal qui passe minuit n'est pas remis dans l'ordre (comme pour la période).
- Quand la limite de 100 000 erreurs est atteinte, le tri et la recherche ne portent que sur les erreurs enregistrées, ce que le résumé dit déjà.

## Mesuré et non vérifié
**Mesuré** (Node, 100 000 enregistrements synthétiques de 250 caractères) : recherche 86 à 117 ms, tri par heure 142 ms, par gravité 26 ms, par nombre d'identiques 17 ms. **Chrome 156 sans interface, `npm run e2e`** (application construite sous la CSP de production, 100 000 erreurs enregistrées) : recherche d'un texte présent dans une erreur sur six, liste réduite en 177 ms ; tri par heure, liste réordonnée en 226 ms ; la page garde 200 lignes ; aucune erreur de console.

**Non vérifié :** l'aspect de la barre d'outils à l'écran (à regarder à la main), la saisie dans le champ avec un lecteur d'écran (annonce de « N erreurs affichées sur M »), Firefox et Safari, l'effet de `useDeferredValue` sur une machine lente.
