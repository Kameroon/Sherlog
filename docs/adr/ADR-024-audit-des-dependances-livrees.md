# ADR-024 : L'audit bloquant de la CI porte sur les dépendances livrées

## Statut
Accepté — 2026-11-18, à la demande de l'auteur (« prépare ce changement dans une PR à part »), validé par lui (PR #28).

## Contexte
Le workflow `.github/workflows/azure-static-web-apps.yml` exécute `npm run audit` avant le déploiement ; l'étape est bloquante. Jusqu'à l'étape 10a, `npm audit --audit-level=high` réussissait (seul un avis modéré sur `minimatch`, dans l'outillage `eslint`, était signalé).

Le 2026-11-18, un avis de gravité **élevée** est apparu sur `picomatch` (GHSA-fc5q-39xc-vjpf : déni de service par expression régulière, CWE-1333, versions jusqu'à 4.0.7). `npm audit` compte alors 7 avis élevés : `picomatch` et les paquets qui en dépendent, `fdir`, `tinyglobby`, `vite`, `vitest`, `@vitejs/plugin-react`, `@typescript-eslint/typescript-estree`.

**Constats vérifiés ce jour :**
- Ils sont **tous dans les outils de développement** : `npm audit --omit=dev` indique **0 vulnérabilité**. Le seul paquet livré dans `dist/` est `react` / `react-dom` (`package.json`, section `dependencies`) ; `vite` et `vitest` ne tournent qu'à la construction et aux tests, sur des motifs de fichiers écrits par l'auteur du dépôt, non fournis par un utilisateur.
- **Aucune version corrigée de `picomatch` n'est publiée** (la dernière, 4.0.7, est dans l'intervalle touché).
- Le correctif que propose npm (`npm audit fix --force`) est un **retour en arrière majeur** de `vitest` (vers 3.1.4) et de `vite` (vers 6.2.7), qui contredit la pile décidée (versions épinglées, `CLAUDE.md`) : écarté.
- `npm audit fix --dry-run` échoue (erreur interne de npm, « Cannot read properties of null »).

## Décision
- **`npm run audit` (étape bloquante de la CI) ne regarde que ce qui est livré** : `npm audit --omit=dev --audit-level=high`. C'est ce qui peut atteindre un utilisateur ; il reste au même niveau (élevé) et à zéro tolérance.
- **`npm run audit:all`** garde l'audit complet, outillage compris : informatif, lancé à la main (par exemple aux étapes d'audit complet 10 et 11), non bloquant. Il échoue aujourd'hui, et c'est dit, pas caché.
- **Revoir cette décision** dès qu'une version corrigée de `picomatch` existe : mettre à jour le verrou, vérifier que `audit:all` réussit, et alors rendre l'audit complet de nouveau bloquant (la CI n'a qu'une ligne à changer : le script `audit`).

## Conséquences
- Un avis de gravité élevée dans une **dépendance livrée** bloque toujours le déploiement ; seuls les avis d'outillage de développement cessent de le bloquer.
- Risque accepté : un outil de développement compromis ou vulnérable n'arrêterait plus un déploiement. Atténué par les versions épinglées, le verrou (`npm ci`), les actions GitHub épinglées par empreinte, et par le fait que l'application construite ne contient pas ces outils.
- `package.json` : deux scripts (`audit` modifié, `audit:all` ajouté) ; le verrou et les dépendances ne changent pas.
