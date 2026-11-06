# ROADMAP — Sherlog

Ordre et périmètre = le « quoi ». Le découpage fin (tailles, critères Gherkin, ADR) est produit par `orchestrator` à partir de ce fichier,
sans le contredire. Les règles de qualité (tests d'abord, commits, documentation) viennent des skills.

## Définition de « terminé » (pour chaque étape)
Tests écrits d'abord (`test-writer`), code sans avertissement (`tsc --noEmit`, `eslint --max-warnings 0`), documentation à jour dans la même étape (`doc-writer`),
revue de fin d'étape (`code-review`), commit(s) atomiques (`git-commit`), puis arrêt pour validation. Les étapes marquées **security-audit** passent la checklist de sécurité de Sherlog (`CLAUDE.md`, adaptation 6).

| # | Étape | Skills |
|---|---|---|
| 0 | Dépôt git + GitHub, squelette Vite + React + TS, Vitest. ADR-001, 003, 005, 006 acceptés ; ADR-002 et 004 **proposés** jusqu'au spike ; ADR « hébergement Azure malgré la règle Hetzner » et ADR « journalisation côté client ». CSP complète, réponse 403, déploiement d'une page vide **protégée** (connexion GitHub/Microsoft, rôle `invited`, identité affichée) sur Static Web Apps Free. **Go/no-go** : invitations viables sur Free, environnements de prévisualisation par pull request disponibles (staging) et protégés par les règles de routes (la documentation Microsoft indique qu'une prévisualisation peut être publique : à vérifier). Résultats consignés dans les ADR-006 et ADR-007. Si invitations non viables : repli en application publique (ADR-006 révisé) ; si prévisualisation indisponible : revenir vers l'auteur | orchestrator, doc-writer, test-writer, git-commit, code-review, **security-audit** |
| 1 | **Spikes de faisabilité** (court, jetable, hors branche principale) : appel Anthropic en streaming depuis le navigateur ; Ollama local depuis la page hébergée (y compris invites d'accès au réseau local) ; Azure Monitor + CORS ; **poids de MSAL** (critère de go : budget < 300 Ko gzip tenu). Décision go/no-go consignée en ADR-002 et ADR-004 | doc-writer, **security-audit** |
| 2 | Parseur texte brut : profils Serilog fichier + générique et Serilog console (sans date), **règle de détection de profil explicite** (pas de « majoritairement » en proportion de lignes), niveaux d'en-tête restreints aux niveaux connus, profil personnalisé par regex, multi-lignes, filtre des niveaux d'erreur (`ERR`, `FTL` inclus), robustesse du flux (CRLF, BOM, UTF-16, UTF-8 coupé entre chunks, entrées très longues signalées). Résultats attendus dans `samples/README.md`. **Clôture conditionnée à ~30 lignes réelles fournies** | test-writer, clean-code, code-review |
| 3 | Normalisation et empreinte, sans hash : clé = chaîne normalisée (GUID, nombres, horodatages, e-mails, IP, URL, identifiants alphanumériques, chemins temporaires, adresses mémoire) + première frame applicative **configurable par profil** (repli : première frame) | test-writer, code-review |
| 3b | **Profil structuré** unique (correspondance de champs + table des niveaux, texte ou numérique) : préréglages JSON lines **Serilog compact** et **Log Analytics / App Insights** (JSON de l'API + CSV d'export). Noms de colonnes relevés sur un export réel fourni par l'auteur, rien deviné. Détection de profil étendue au JSON. pino et Docker json-file : après la v1 | test-writer, clean-code, code-review |
| 4 | Sources locales fichiers et collage ; lecture en streaming dans un worker (progression, **annulation**, worker terminable) ; stockage par entrée des **positions** (position, longueur, horodatage, niveau, première ligne, empreinte) plutôt que du texte, relecture à la demande via `File.slice` ; messages visibles pour toute limite atteinte. **Tranche verticale** : fichier → liste brute minimale. Mesure sur gros fichier généré pour fixer les seuils | clean-code, test-writer, code-review, **security-audit** |
| 5 | Liste à plat virtualisée (une ligne par entrée, badge « ×N identiques »), détail avec stack et lignes voisines, design tokens, états default/loading/error/empty, clavier, `ErrorBoundary` | frontend-architect, test-writer, code-review |
| 5b | Tri, filtres, recherche plein texte, statuts (session) — **Partie 1 terminée**, utilisable sans clé IA | frontend-architect, test-writer, code-review |
| 6 | `redact` + aperçu « ce qui sera envoyé » (meilleur effort, l'aperçu est le vrai contrôle) | test-writer, code-review, **security-audit** |
| 7 | Fournisseurs IA (Anthropic par `fetch` + lecture SSE, Ollama), gestion de la clé, page Paramètres, modèle configurable | clean-code, frontend-architect, test-writer, code-review, **security-audit** |
| 8 | Analyse : prompt durci (délimiteur aléatoire par requête), JSON validé par type guard, rendu sûr sans HTML | test-writer, frontend-architect, code-review, **security-audit** |
| 9 | Chat en streaming (annulation, états d'erreur) — **Partie 2 terminée** | frontend-architect, test-writer, code-review |
| 10 | Sources avancées, dans cet ordre de livraison : **10a** sélecteur de dossier (Chromium) ; **10b** source URL restreinte à la liste de domaines figée dans la CSP ; **10c** Azure Monitor direct (selon le spike ; sinon repli par export du portail déposé comme fichier, couvert par le profil de l'étape 3b) | clean-code, test-writer, code-review, **security-audit** |
| 11 | Historique local optionnel (contenu masqué ou empreintes + statuts + analyses seulement), export/import, finitions, README, audit global | doc-writer, security-audit, code-review, git-commit |

## Ordre de coupe si le périmètre dérape
1. Azure Monitor direct (10c) · 2. Sélecteur de dossier (10a) · 3. Source URL (10b). JSON lines (3b) n'est jamais coupé.

## Après la v1 (sans backend)
Préréglages supplémentaires du profil structuré : pino, Docker json-file. Autres formats : log4net/NLog, console Microsoft.Extensions.Logging, Python, nginx/Apache.
Connecteurs d'autres plateformes, un par un, après vérification de leur accès depuis un navigateur.

## Hors roadmap (exige un backend)
Ingestion continue, historique serveur, partage de données entre utilisateurs, contrôle d'accès avec Google.

## Critères de fin de v1
- Sur les fichiers de `samples/` : uniquement les erreurs, une ligne par entrée, entrées identiques signalées comme indiqué dans `samples/README.md`. Sur l'extrait réel fourni : mêmes garanties.
- Un visiteur non connecté ne peut pas charger l'application ; une personne connectée mais non invitée est refusée avec une réponse 403 maîtrisée (vérifié sur le site déployé). *Sauf si le repli public a été retenu à l'étape 0.*
- Chaque pull request est validée dans son environnement de prévisualisation avant la mise en production.
- Un fichier de plusieurs centaines de Mo est traité sans figer l'interface, dans le plafond mémoire mesuré à l'étape 4 ; toute limite atteinte est signalée à l'écran.
- Aucun appel réseau hors fournisseur IA choisi, Microsoft / Log Analytics et domaines de la liste CSP (vérifié dans l'onglet réseau et par la CSP).
- Injection de prompt : un log contenant « ignore tes instructions et … » ou `</log_data>` ne ferme pas le bloc de données et n'altère ni le schéma ni le rendu de la réponse (tests sur la construction du prompt, la validation du JSON et le rendu) ; le comportement réel du modèle est vérifié par un contrôle manuel documenté.
- La clé n'apparaît ni dans la console, ni dans les exports, ni dans l'historique local.
- L'audit `security-audit` final n'a plus de point critique.
