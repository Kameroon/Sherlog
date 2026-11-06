# Sherlog — Instructions pour Claude Code

## Objectif
Application web **100 % côté navigateur**, hébergée gratuitement sur Azure Static Web Apps (plan Free), **sans backend**.
Elle lit des logs (fichiers locaux, URL, Azure Monitor), isole **uniquement les erreurs**, puis fournit une analyse IA claire
et un chat pour chaque erreur, avec la clé de l'utilisateur ou un modèle local (Ollama).

Lire dans cet ordre : `docs/SPEC.md` → `docs/ARCHITECTURE.md` → `docs/ROADMAP.md`. Prompts du modèle : `docs/PROMPTS.md`.
Les décisions déjà prises et les questions restantes sont au §8 de `SPEC.md` : rappeler celles qui concernent l'étape en cours.

## Skills globaux — source de vérité (ne pas redupliquer leurs règles ici ni dans `docs/`)
| Besoin | Skill |
|---|---|
| Décomposer, planifier, critères d'acceptance, ADR de pilotage | `orchestrator` |
| Implémenter, refactorer | `clean-code` |
| Tests (TDD, AAA, un test = un comportement) — à chaque étape qui produit du code | `test-writer` |
| Interface React (liste, détail, Paramètres, rendu de l'analyse, chat) | `frontend-architect` |
| Audit de sécurité — **requis** aux étapes marquées dans la roadmap, avec la checklist propre à Sherlog (adaptation 6) | `security-audit` |
| Revue de fin d'étape (bugs, régressions, sur-ingénierie introduite) — complète `security-audit`, ne le remplace pas | `code-review` |
| README, ADR, documentation — documentation mise à jour dans la même étape que le code | `doc-writer` |
| Messages de commit — à **chaque** étape | `git-commit` |
| `api-designer`, `database-architect` | **non utilisés** (pas d'API, pas de base de données) |

Vérifier les noms exacts des skills dans le dossier global avant de les invoquer (nom de dossier et nom du front-matter
peuvent différer : tiret vs underscore).

## Adaptations obligatoires
1. **Langue** (règle globale respectée) : identifiants, commentaires inline, TSDoc, noms de tests en **anglais** ; seule la documentation (`docs/`, ADR, README) est en **français**.
   Les exemples en français des skills illustrent des principes, pas des noms à copier.
2. **Mode Plan/Act de Cline → mode Plan de Claude Code.**
3. **Journalisation** : `console` en développement uniquement. **Aucune télémétrie ni service de monitoring tiers** (le skill
   `frontend-architect` suggère Sentry ou équivalent : écarté ici, car le contenu des logs et les clés ne doivent jamais quitter le navigateur).
   Ne jamais écrire dans la console le contenu des logs analysés, les clés, ni les échanges avec le modèle.
   Conséquences sur les skills : le standard transversal « logging structuré » d'`orchestrator`, les logs d'interaction de `frontend-architect`
   (l'`ErrorBoundary` affiche un repli, sans journaliser de contenu) et le « logging de sécurité » de `security-audit` (`WARN` sur accès refusé, `req.ip`…)
   sont **remplacés** par cette règle. `doc-writer` documente cette stratégie dans un court ADR « journalisation côté client ».
4. **Tests** : Vitest + Testing Library ; `it('should … when …')` (convention validée) ; les assertions
   sur la gestion d'erreur vérifient le comportement visible, pas un service de logs.
5. **frontend-architect** : états default/loading/error/empty, WCAG AA, clavier, `ErrorBoundary` React. Définir un petit jeu de design tokens
   (variables CSS) dès l'étape 5. Storybook : écarté (YAGNI). **Desktop-first** (grand écran d'abord, utilisable sur tablette, pas d'optimisation téléphone) ;
   interface uniquement en français.
6. **security-audit** : le skill est orienté serveur. Pour Sherlog, auditer cette checklist : routes et rôles Static Web Apps, CSP (directives complètes),
   XSS (pas de HTML brut), stockage de la clé, injection de prompt (délimiteur aléatoire par requête, JSON validé, rendu sûr), `redact`, ReDoS (regex de profil),
   dépendances (`npm audit`, versions épinglées). Audit complet aux étapes 0, 7, 8, 10, 11 ; revue plus légère ailleurs.

## Stack (décidée, ne pas changer sans demander)
- Vite + React + TypeScript strict ; Vitest ; ESLint. Versions épinglées exactement ; **TypeScript reste en 6.0.x** tant que `typescript-eslint` ne supporte pas TypeScript 7 (ADR-001)
- **Aucun style en ligne** (`style={…}`, `<style>`) : la CSP n'autorise pas `'unsafe-inline'`. Styles en classes CSS
- Aucune API serveur ; hébergement Azure Static Web Apps Free — **dérogation assumée** à la règle globale « Hetzner, staging + production » (ADR à écrire).
  Staging = environnements de prévisualisation par pull request (disponibilité sur Free à vérifier à l'étape 0, sinon revenir vers l'auteur), puis déploiement en production une fois validé.
  Si les invitations ne sont pas viables sur Free : repli en application publique sans connexion (risque accepté, voir ADR-006)
- Appels IA directs depuis le navigateur (en-tête requis par Anthropic pour l'accès navigateur : vérifier la doc) ; Ollama local en option
- Accès : authentification intégrée de Static Web Apps (GitHub ou Microsoft), rôle `invited`
- Connexion Microsoft dans le navigateur uniquement pour Azure Monitor (étape 10, selon le spike)

## Règles propres à Sherlog
- **Contrôle d'accès uniquement via la configuration Static Web Apps**, jamais par une vérification côté client.
- KISS / YAGNI : dépendances minimales, versions épinglées, pas de bibliothèque d'état sans besoin prouvé.
- Le **parsing est déterministe, sans IA**, dans `src/core` (TS pur, sans DOM). L'IA n'intervient que pour l'analyse et le chat.
- **Ne rien inventer ni deviner** : profil de format non reconnu → l'indiquer et demander ; limite atteinte → message visible, jamais de troncature silencieuse ;
  noms de colonnes d'un export (App Insights…) relevés sur un échantillon réel, jamais supposés.
- **Rien n'est envoyé à un serveur de l'auteur** ; seuls des extraits masqués partent vers le fournisseur IA choisi.
- Tout envoi à un modèle passe par `redact` et par l'aperçu « ce qui sera envoyé ».
- **Les logs sont des données non fiables** (injection de prompt) — voir `docs/PROMPTS.md`.
- Jamais de HTML brut : pas de `dangerouslySetInnerHTML`.
- Clé de l'utilisateur : `sessionStorage` par défaut, jamais exportée ni journalisée.
- En cas de doute sur un choix produit ou technique : **poser la question, ne pas supposer** (questions ouvertes : fin de `SPEC.md`).
