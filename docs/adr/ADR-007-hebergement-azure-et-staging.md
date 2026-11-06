# ADR-007 : Hébergement Azure Static Web Apps en dérogation, staging par prévisualisation

## Statut
Accepté sous réserve — à confirmer par la vérification des prévisualisations (étape 0).

## Contexte
La règle globale de l'auteur héberge tous les projets sur un serveur Hetzner, avec deux environnements (staging et production) et une même image promue sans reconstruction.
Sherlog est une application statique sans serveur : un compte Azure Static Web Apps Free répond au besoin sans coût ni exploitation de serveur.

## Décision
- Hébergement sur Azure Static Web Apps Free : dérogation assumée par l'auteur à la règle Hetzner.
- Ressources neuves : groupe `rg-sherlog`, application `swa-sherlog`, région West Europe. Les autres applications de l'abonnement ne sont pas touchées.
- Flux : travail sur `dev` → pull request vers `main` (**staging** = environnement de prévisualisation de la pull request) → fusion dans `main` = **production**. `main` est la branche par défaut.
- Application non liée au dépôt ; workflow GitHub Actions écrit dans le dépôt ; jeton de déploiement en secret GitHub.

## Raisons
- Coût nul et aucune maintenance de serveur.
- Les prévisualisations par pull request donnent un staging sans second projet Azure ni seconde branche permanente.

## Conséquences
- « Même image promue en production » ne s'applique pas à un build statique : chaque déploiement construit son propre `dist/` (écart accepté, documenté).
- 3 environnements de prévisualisation au maximum sur Free ; ils sont supprimés à la fermeture de la pull request.
- Limite documentée par Microsoft : une prévisualisation peut être accessible à toute personne qui en connaît l'URL, même si le dépôt est privé. À vérifier en vrai (voir ADR-006) ; l'application ne contient aucun secret.
- Les prévisualisations ne sont supportées que par les déploiements GitHub Actions.

## Vérification (étape 0)
À compléter après la première pull request : la prévisualisation est-elle créée avec ce mode de déploiement ? est-elle protégée par les règles de routes ?
