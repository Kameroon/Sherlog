# Sherlog

Application web 100 % côté navigateur qui lit des logs, isole uniquement les erreurs, puis propose une analyse par IA et un chat pour chacune.

> **État : étape 0 de la feuille de route.** Squelette, contrôle d'accès et déploiement. Aucune fonctionnalité d'analyse n'existe encore : la page affiche seulement l'identité de la personne connectée.

## Pourquoi ce projet existe
Retrouver la cause d'une erreur dans des fichiers de logs de plusieurs centaines de Mo est long. Sherlog extrait les erreurs de façon déterministe (sans IA), puis demande une analyse
au modèle de l'utilisateur. Rien n'est envoyé à un serveur de l'auteur : seuls des extraits masqués partent vers le fournisseur IA choisi.

## Démarrage rapide (< 5 minutes)
Prérequis : Node 22.13 ou plus récent.
```bash
npm ci
npm run dev        # http://localhost:5173
```
Hors Azure Static Web Apps, l'interface affiche « Identité indisponible » : c'est normal, `/.auth/me` n'existe qu'une fois déployé.

## Développement
| Commande | Rôle |
|---|---|
| `npm run typecheck` | Vérification TypeScript strict |
| `npm run lint` | ESLint, zéro avertissement toléré |
| `npm test` | Tests Vitest |
| `npm run build` | Construit `dist/` |
| `npm run audit` | `npm audit` au niveau high |

Essayer le contrôle d'accès en local (émulateur, qui peut différer du cloud) : `npm run build` puis `npx @azure/static-web-apps-cli@2.0.8 start ./dist` (version épinglée, le paquet n'est pas une dépendance du projet).

Conventions : code, TSDoc et commentaires en anglais, documentation en français ; tests nommés `it('should … when …')` ; aucun style en ligne (la CSP les bloque).
Les règles complètes sont dans `CLAUDE.md`, la spécification dans `docs/SPEC.md`, l'architecture dans `docs/ARCHITECTURE.md`, la feuille de route dans `docs/ROADMAP.md`, les décisions dans `docs/adr/`.

## Architecture
Application monopage statique (Vite + React + TypeScript strict). Le contrôle d'accès est appliqué par la configuration Static Web Apps (`public/staticwebapp.config.json`),
jamais par le code client. Détail : `docs/ARCHITECTURE.md`.

## Branches et déploiement
`dev` (travail) → pull request vers `main` → fusion = production.
Chaque pull request est déployée dans son propre environnement de prévisualisation (staging) par le workflow `.github/workflows/azure-static-web-apps.yml`, qui vérifie d'abord
typecheck, lint, tests, build et audit. Ne jamais pousser directement sur `main`.

## Stratégie de journalisation
`console` en développement uniquement, aucune télémétrie. Le contenu des logs analysés, les clés et les échanges avec le modèle ne sont jamais écrits dans la console. Voir ADR-008.

## Dépannage
- **« Identité indisponible » en local** : normal hors Azure Static Web Apps.
- **403 « Accès refusé » une fois déployé** : le compte est connecté mais n'a pas été invité.
- **Le workflow échoue à l'étape d'audit** : `npm audit` a trouvé une vulnérabilité de niveau high ; lire `npm audit` avant tout contournement.
