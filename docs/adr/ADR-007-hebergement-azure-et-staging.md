# ADR-007 : Hébergement Azure Static Web Apps en dérogation, staging par prévisualisation

## Statut
Accepté — 2026-11-06 (étape 0 validée) : prévisualisations et production vérifiées.

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
Faite le 2026-11-06 avec la pull request n°1 :
- Le mode « application non liée au dépôt, jeton de déploiement en secret GitHub » **crée bien** l'environnement de prévisualisation (`https://mango-plant-0313ba703-1.westeurope.4.azurestaticapps.net`) et le bot commente l'URL sur la pull request.
- La prévisualisation **est protégée** par les règles de routes de `staticwebapp.config.json` (tout anonyme est redirigé vers `/login/`).
- Le workflow complet (typecheck, lint, tests, build, audit, déploiement) s'exécute en environ une minute.
- Limite constatée : une invitation ne peut être créée que pour le domaine de production, qui renvoie 404 sur `/.auth/*` tant qu'aucun déploiement n'y a eu lieu. **La première fusion dans `main` est donc un prérequis pour inviter quelqu'un** ;
  le staging valide le refus et la protection, pas l'accès d'un invité (voir ADR-006).
- Production : déployée par le workflow après la fusion de la pull request n°1 (environnement par défaut « Ready » sur `main`), puis protégée comme la prévisualisation.
- Le flux a servi deux fois : prévisualisations des pull requests n°1 et n°2, chacune avec son URL commentée par le bot.
- Poids mesuré au build : environ 70 Ko gzip (JavaScript 70,07 Ko, CSS 0,78 Ko), base du budget de 300 Ko.
