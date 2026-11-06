# ADR-008 : Journalisation côté client

## Statut
Accepté — 2026-11-06

## Contexte
Les skills du projet demandent des logs structurés, des logs de sécurité et un service de monitoring (Sentry ou équivalent). Sherlog analyse des logs qui contiennent des secrets
et des données personnelles, et manipule la clé de l'utilisateur.

## Décision
`console` en développement uniquement ; aucune télémétrie ; aucun service de monitoring tiers. Le contenu des logs analysés, les clés et les échanges avec le modèle ne sont jamais écrits dans la console.
Les erreurs sont **visibles par l'utilisateur** dans l'interface (états d'erreur explicites, `ErrorBoundary` sans détail technique), jamais avalées.

## Raisons
- Un service de monitoring enverrait à un tiers précisément ce que l'application promet de garder dans le navigateur.
- Une erreur de rendu peut citer du contenu de logs : l'afficher ou le journaliser le ferait fuiter.

## Conséquences
- Remplace les exigences de logging des skills `orchestrator`, `clean-code`, `frontend-architect` et `security-audit` (logs de sécurité sur accès refusé) pour ce projet.
- Les tests vérifient le comportement visible (état affiché), pas l'appel à un logger.
- Le diagnostic d'un problème en production repose sur la reproduction locale et sur les messages d'erreur affichés.
