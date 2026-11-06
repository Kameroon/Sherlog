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
- **ADR-009** Thème clair et sombre selon le système ; jetons et styles de base partagés (`public/login/base.css`) entre les pages publiques et l'application.

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
Fichier réel : `public/staticwebapp.config.json` (copié dans `dist/` par Vite). Il est verrouillé par `tests/staticwebapp-config.test.ts`.
```json
{
  "routes": [
    { "route": "/login/*", "allowedRoles": ["anonymous"] },
    { "route": "/forbidden/*", "allowedRoles": ["authenticated"] },
    { "route": "/*", "allowedRoles": ["invited"] }
  ],
  "responseOverrides": {
    "401": { "redirect": "/login/", "statusCode": 302 },
    "403": { "rewrite": "/forbidden/index.html", "statusCode": 403 }
  },
  "globalHeaders": { "Content-Security-Policy": "…", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }
}
```
- **Ordre des règles** : la première qui correspond gagne ; `/*` est donc toujours en dernier. Les pages publiques vivent dans `/login/` et `/forbidden/` avec leur propre CSS (le reste du site n'est servi qu'aux invités) ; les jetons de conception sont dans `/login/base.css`, que l'application charge aussi (ADR-009).
- **Pas de `navigationFallback`** : la documentation précise que les règles de route ne s'appliquent pas aux requêtes qui le déclenchent ; un chemin inexistant servirait `index.html` à un anonyme.
  Si un routage côté client devient nécessaire, utiliser le fragment d'URL (`#/parametres`), qui ne génère aucune requête serveur.
- **Ne jamais bloquer** `/.auth/login/*` par une règle : les invitations cesseraient de fonctionner.
- **CSP** : à l'étape 0 `connect-src 'self'` seulement. Domaines cibles, ajoutés par l'étape qui en a besoin : `https://api.anthropic.com` et `http://localhost:11434` (étape 7),
  `https://login.microsoftonline.com` et `https://api.loganalytics.azure.com` (étape 10c), `https://*.blob.core.windows.net` (étape 10b). Pas de `'unsafe-inline'` ni de `'unsafe-eval'` : aucun style en ligne dans le code.
  `base-uri`, `form-action` et `frame-ancestors` sont déclarés car ils ne retombent pas sur `default-src`. `http://localhost:11434` depuis une page HTTPS dépend du navigateur (spike de l'étape 1).
- **Invitations** : rôle `invited` attribué depuis le portail Azure ou `az staticwebapp users invite` ; GitHub s'invite par nom d'utilisateur, Microsoft par adresse e-mail ; 25 invitations au maximum sur Free.
  Les résultats de la vérification déployée sont consignés dans l'ADR-006.
Réglages applicatifs (valeurs par défaut dans le code) : niveaux d'erreur, profils de format, `maxInputChars`, règles de masquage.
Vérifier dans la documentation officielle : l'API du SDK Anthropic en mode navigateur, la bibliothèque d'authentification Microsoft pour application monopage, la syntaxe exacte des en-têtes de Static Web Apps.

## Déploiement
Application Azure Static Web Apps (plan Free) **non liée** au dépôt ; le workflow `.github/workflows/azure-static-web-apps.yml` exécute `tsc --noEmit`, `eslint --max-warnings 0`, tests, build et `npm audit`,
puis envoie seulement `dist/` (`skip_app_build`). Le jeton de déploiement est le secret GitHub `AZURE_STATIC_WEB_APPS_API_TOKEN`, jamais dans le dépôt.
Flux : travail sur `dev` → pull request vers `main` (environnement de prévisualisation = staging, 3 maximum sur Free, supprimé à la fermeture) → fusion = production. Voir ADR-007.

## Budget de dépendances (objectif < 300 Ko gzip, à mesurer)
Appel Anthropic par `fetch` + lecture SSE manuelle (pas de SDK), validation de la réponse par type guard écrit à la main, texte pré-formaté pour l'analyse et le chat en v1 (pas de bibliothèque Markdown tant que le besoin n'est pas prouvé).
MSAL.js uniquement si le spike le juge compatible avec le budget. Les prompts `.md` sont embarqués au build (`?raw`) : le bénéfice est la lisibilité et le diff, pas l'absence de rebuild.

## Écrans
Une page principale : sources, liste d'erreurs, panneau de détail avec onglets Analyse et Chat ; une page Paramètres (fournisseur, clé).
Conception et accessibilité : `frontend-architect`.
