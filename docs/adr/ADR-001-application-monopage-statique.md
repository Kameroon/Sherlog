# ADR-001 : Application monopage statique sur Azure Static Web Apps, sans API

## Statut
Accepté — 2026-11-06

## Contexte
Sherlog lit des logs qui peuvent contenir des secrets et des données personnelles, puis en extrait les erreurs. L'objectif est un coût nul et la garantie que
le contenu des logs ne passe jamais par un serveur de l'auteur.

## Décision
Application monopage statique : Vite, React et TypeScript strict, hébergée sur Azure Static Web Apps (plan Free), sans fonction serveur.

## Raisons
- Le traitement des logs reste dans le navigateur : aucun serveur à sécuriser, aucune donnée à héberger.
- Le plan Free couvre le besoin : hébergement statique mondial, certificats TLS, authentification GitHub et Microsoft préconfigurée.
- Un seul projet, une chaîne d'outils courante (Vite, Vitest, ESLint).

## Conséquences
- Positives : coût nul, surface d'attaque réduite, déploiement simple.
- Négatives : tout ce qui exige un serveur est hors périmètre (voir ADR-005).
- Versions épinglées exactement (`.npmrc`, `save-exact`). **TypeScript est en 6.0.3 et non en 7.0.2** : `typescript-eslint` 8.72 déclare `typescript <6.1.0`.
  À revoir quand TypeScript 7 sera supporté. `jsdom` est en 29.1.1 car la version 31 exige Node 22.22.2 alors que le moteur minimal du projet est Node 22.13.
- Alternative rejetée : application avec backend (sort du cadre gratuit, voir ADR-005).
