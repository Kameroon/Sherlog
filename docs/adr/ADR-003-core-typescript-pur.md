# ADR-003 : `core` en TypeScript pur, sans DOM ni React

## Statut
Accepté — 2026-11-06

## Contexte
Le parsing, l'empreinte et le masquage (`redact`) sont le cœur de la valeur de l'application et doivent être exécutables dans un Web Worker et dans des tests Node.

## Décision
`src/core` ne dépend ni du DOM, ni de React, ni d'API Web. Il est déterministe et sans IA.

## Raisons
- Testable en isolation et rapidement (TDD).
- Réutilisable dans le worker sans adaptation.
- Une empreinte fondée sur la chaîne normalisée elle-même, et non sur un hachage `crypto.subtle` (asynchrone, API Web), garde ce module synchrone.

## Conséquences
- Positives : tests simples, comportement reproductible.
- Négatives : les accès au disque et au réseau vivent hors de `core` (`sources/`, `workers/`).
