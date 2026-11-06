# ARCHITECTURE — Sherlog

## Décisions structurantes
Justifications à consigner en ADR dans `docs/adr/` par `doc-writer` à l'étape 0 (pas de texte dupliqué ici) :
- **ADR-001** Application monopage statique (Vite + React + TypeScript strict) sur Azure Static Web Apps Free, sans API.
- **ADR-002** *(proposé jusqu'au spike de l'étape 1)* Appels IA directs depuis le navigateur avec la clé de l'utilisateur ; Ollama local en option.
- **ADR-003** `core` en TypeScript pur, sans DOM ni React : testable et réutilisable (d'où une empreinte sans `crypto.subtle`).
- **ADR-004** *(proposé jusqu'au spike de l'étape 1)* Azure Monitor depuis le navigateur.
- **ADR-005** Aucun backend : conséquences listées au §4 de `SPEC.md`.
- **ADR-006** Contrôle d'accès par l'authentification intégrée de Static Web Apps (GitHub/Microsoft) et rôle `invited`, avec la menace visée (testeurs acharnés) et le repli public si les invitations ne sont pas viables sur Free.
- **ADR-007** Hébergement Azure Static Web Apps : dérogation assumée à la règle globale Hetzner ; staging = prévisualisation par pull request, puis production.
- **ADR-008** Journalisation côté client : `console` en développement uniquement, aucune télémétrie (remplace les exigences de logs des skills).

## Structure (un seul projet)
```
sherlog/
├─ public/staticwebapp.config.json   routes de repli SPA + CSP
├─ src/
│  ├─ core/      parsing, empreinte, Redactor, types — TS pur
│  ├─ sources/   file, folder (File System Access), url, azure-monitor
│  ├─ ai/        AiProvider, anthropic, ollama, prompts
│  ├─ workers/   parse.worker.ts
│  ├─ store/     état de session + historique local (IndexedDB)
│  └─ ui/        composants React
└─ tests/        Vitest + Testing Library
```
Outillage : Vite, TypeScript strict, ESLint, Vitest. Pas de bibliothèque d'état tant que le besoin n'est pas prouvé.

## Abstractions
```ts
interface LogSource {                                          // file, folder, url, azure-monitor, paste
  lines(): AsyncIterable<{ text: string; offset: number }>     // lecture unique, en streaming
  readRange(offset: number, length: number): Promise<string>   // relecture à la demande (détail, lignes voisines)
}
interface AiProvider { stream(messages: Message[]): AsyncIterable<string> }  // anthropic, ollama
function redact(text: string, rules: RedactionRules): string  // pur
```
Pas d'abstraction sans deuxième implémentation réelle.

## Flux
1. **Collecte** : `LogSource` → worker (découpage en entrées, filtre des niveaux d'erreur, empreinte) → liste à plat des entrées en erreur et index des empreintes en état de session.
   Le worker ne conserve que des positions et métadonnées (voir « Mémoire » au §3 de `SPEC.md`) ; le texte est relu par `readRange` (`File.slice`) à l'affichage du détail et à l'analyse.
   Pour le collage et les résultats Azure, le texte reste en mémoire. Le worker est annulable et terminable (regex de profil saisie par l'utilisateur).
2. **Analyse** : erreur (occurrence la plus récente de son empreinte) + contexte → `redact` → aperçu → `AiProvider` → JSON validé, rattaché à l'empreinte.
3. **Chat** : historique + contexte → réponse en streaming.
4. **Historique local** (optionnel) : écriture IndexedDB, export/import JSON.

## Configuration
`staticwebapp.config.json` (point de départ à valider et ajuster à l'étape 0) :
```json
{
  "routes": [ { "route": "/*", "allowedRoles": ["invited"] } ],
  "responseOverrides": {
    "401": { "redirect": "/.auth/login/github?post_login_redirect_uri=.referrer", "statusCode": 302 },
    "403": { "rewrite": "/forbidden.html", "statusCode": 403 }
  },
  "navigationFallback": { "rewrite": "/index.html", "exclude": ["/assets/*"] },
  "globalHeaders": {
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' https://api.anthropic.com http://localhost:11434 https://login.microsoftonline.com https://api.loganalytics.azure.com https://*.blob.core.windows.net; worker-src 'self'; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  }
}
```
`base-uri`, `form-action` et `frame-ancestors` sont déclarés car ils ne retombent pas sur `default-src`. `'unsafe-inline'` (styles) et `blob:` (worker) sont retirés par défaut : ne les rétablir
que si le build l'exige, avec justification. `http://localhost:11434` depuis une page HTTPS dépend du navigateur (spike de l'étape 1). `/forbidden.html` doit rester accessible à une personne connectée non invitée.
Le rôle `invited` est attribué par invitation depuis le portail Azure. À valider à l'étape 0 : la compatibilité d'une règle `/*` avec les routes de connexion `/.auth/*`,
le fournisseur de redirection par défaut (GitHub ou Microsoft), le fonctionnement des invitations sur le plan Free, et la lecture de l'identité via `/.auth/me`.
Réglages applicatifs (valeurs par défaut dans le code) : niveaux d'erreur, profils de format, `maxInputChars`, règles de masquage.
Vérifier dans la documentation officielle : l'API du SDK Anthropic en mode navigateur, la bibliothèque d'authentification Microsoft pour application monopage, la syntaxe exacte des en-têtes de Static Web Apps.

## Déploiement
Dépôt GitHub relié à Static Web Apps (plan Free) ; le workflow de CI exécute `tsc --noEmit`, `eslint --max-warnings 0`, tests, build et `npm audit` avant déploiement.
Le jeton de déploiement est un secret GitHub, jamais dans le dépôt. Chaque pull request est déployée dans son environnement de prévisualisation (staging, disponibilité sur Free à vérifier à l'étape 0),
validée, puis fusionnée pour déployer en production.

## Budget de dépendances (objectif < 300 Ko gzip, à mesurer)
Appel Anthropic par `fetch` + lecture SSE manuelle (pas de SDK), validation de la réponse par type guard écrit à la main, texte pré-formaté pour l'analyse et le chat en v1 (pas de bibliothèque Markdown tant que le besoin n'est pas prouvé).
MSAL.js uniquement si le spike le juge compatible avec le budget. Les prompts `.md` sont embarqués au build (`?raw`) : le bénéfice est la lisibilité et le diff, pas l'absence de rebuild.

## Écrans
Une page principale : sources, liste d'erreurs, panneau de détail avec onglets Analyse et Chat ; une page Paramètres (fournisseur, clé).
Conception et accessibilité : `frontend-architect`.
