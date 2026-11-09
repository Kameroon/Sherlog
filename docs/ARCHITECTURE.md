# ARCHITECTURE — Sherlog

## Décisions structurantes
Justifications à consigner en ADR dans `docs/adr/` par `doc-writer` à l'étape 0 (pas de texte dupliqué ici) :
- **ADR-001** Application monopage statique (Vite + React + TypeScript strict) sur Azure Static Web Apps Free, sans API.
- **ADR-002** Appels IA directs depuis le navigateur avec la clé de l'utilisateur ; Ollama local en option (spike de l'étape 1 : Anthropic mesuré, Ollama partiellement).
- **ADR-003** `core` en TypeScript pur, sans DOM ni React : testable et réutilisable (d'où une empreinte sans `crypto.subtle`).
- **ADR-004** *(proposé : poids de MSAL et CORS mesurés à l'étape 1, connexion réelle à vérifier à l'étape 10c)* Azure Monitor depuis le navigateur.
- **ADR-005** Aucun backend : conséquences listées au §4 de `SPEC.md`.
- **ADR-006** Contrôle d'accès par l'authentification intégrée de Static Web Apps (GitHub/Microsoft) et rôle `invited`, avec la menace visée (testeurs acharnés) et le repli public si les invitations ne sont pas viables sur Free.
- **ADR-007** Hébergement Azure Static Web Apps : dérogation assumée à la règle globale Hetzner ; staging = prévisualisation par pull request, puis production.
- **ADR-008** Journalisation côté client : `console` en développement uniquement, aucune télémétrie (remplace les exigences de logs des skills).
- **ADR-009** Thème clair et sombre selon le système ; jetons et styles de base partagés (`public/login/base.css`) entre les pages publiques et l'application.
- **ADR-010** Le flux est découpé en lignes sur les octets avant d'être décodé : positions exactes, détection de profil sans deviner, limite de conservation provisoire.
- **ADR-012** La préparation (règles « ignorer », bientôt période et format) est appliquée dans la passe par un filtre unique ; l'écran de préparation montre ses chiffres sur le début du fichier (1 Mio), exacts après l'analyse.
- **ADR-013** Liste virtualisée par blocs, sans style calculé.
- **ADR-015** *(proposé)* Masquage par règles strictes qui ne devinent pas (`redact`) : contexte ou contrôle exigé, options pour les identifiants, dernier filet à l'envoi, durée bornée ; outil « Masquer » de la préparation (état à côté de la préparation, texte d'origine à la demande).
- **ADR-016** *(proposé)* Choix explicite des erreurs à envoyer (par empreinte, occurrence la plus récente) et aperçu du texte exact : masqué avant d'être coupé, coupure explicite, rien n'est envoyé.
- **ADR-017** *(proposé)* Fournisseurs d'IA (Anthropic par `fetch` et SSE, Ollama), clé de l'utilisateur (mémoire, onglet ou ordinateur, une copie, cloisonnée par identité), test de connexion sans contenu de journal, CSP limitée à deux adresses ; audit de sécurité complet de l'étape 7.
- **ADR-014** Tri, filtres (niveau, statut), recherche et statuts par empreinte calculés sur les enregistrements en mémoire (fonctions pures de `core`), sans relire le fichier ; la recherche ne couvre pas la pile ; statuts en session.
- **ADR-011** Lecture en une passe dans un worker, positions plutôt que texte, source = `Blob`, seuils mesurés.

## Structure (un seul projet)
```
sherlog/
├─ public/staticwebapp.config.json   routes de repli SPA + CSP
├─ scripts/      serve-dist (essai local sous la CSP de production), e2e (Chrome piloté par DevTools, sans dépendance) — hors application
├─ src/
│  ├─ core/      parsing (levels, profiles, lineSplitter, entryAssembler, detectProfile), empreinte (fingerprint), préparation (preparation, previewHead), vue de la liste (errorView : tri, recherche, filtres), statuts par empreinte (errorStatus), masquage (redact), texte envoyé (sendPayload), occurrence la plus récente (identicalErrors), regroupement des identiques (identicalErrors), Redactor — TS pur
│  ├─ sources/   readHead, readEntryText, readNeighbourLines, blobChunks, readFailure (étape 4) ; plus tard folder (File System Access), url, azure-monitor
│  ├─ ai/        provider (AiProvider, Message), request (envoi unique : ni cookie ni référent, délai, annulation), anthropic, ollama, streamLines, serverSentEvents, errors, failureMessage ; plus tard prompts (étape 8)
│  ├─ workers/   scan.worker.ts (coque), runScan, scanProtocol, startScanWorker
│  ├─ store/     aiSettings (clé et réglages du fournisseur, cloisonnés par identité) ; plus tard historique local (IndexedDB)
│  └─ ui/        composants React
└─ tests/        Vitest + Testing Library
```
Outillage : Vite, TypeScript strict, ESLint, Vitest. Pas de bibliothèque d'état tant que le besoin n'est pas prouvé.

## Abstractions
```ts
// Étape 4 : une source est un `Blob` (un `File`, ou du texte collé) — pas d'interface `LogSource` tant qu'une 2e source distincte n'existe pas (ADR-011).
//   lecture en flux : `blobChunks(blob)` ; relecture à la demande : `readEntryText(blob, { offset, length }, encoding)`, offset et length en octets ; lignes autour d'une entrée : `readNeighbourLines(blob, { offset, length }, encoding)` (10 lignes de part et d'autre, fenêtre de 64 Kio par côté).
interface AiProvider { stream(messages: Message[]): AsyncIterable<string> }  // anthropic, ollama
function redact(text: string, rules: RedactionRules): string  // pur
```
Pas d'abstraction sans deuxième implémentation réelle. L'étape 4, première à lire une source, n'a eu besoin que d'un `Blob` : l'interface `LogSource` n'existe pas (ADR-011) et reviendra, si besoin, aux étapes 10a à 10c.
Côté `core`, le parseur de l'étape 2 enchaîne `createLineSplitter` (octets → lignes avec positions) → `detectProfile` (premières lignes → profil, sans deviner) → `createEntryAssembler` (lignes → entrées) → `isErrorLevel` (filtre) → `fingerprint` (clé de regroupement d'une entrée en erreur : niveau, message normalisé par `normalizeMessage`, première frame applicative par `firstApplicationFrame`).

## Flux
1. **Collecte** : choisir un fichier ou coller du texte reconnaît le format sur le début (`readHead`, dont les octets sont gardés) et ouvre l'espace de préparation (format, règles, période ; compteurs et aperçu calculés sur ce début par `parseHead` puis `previewHead`), sans rien analyser ; « Analyser ce journal » lance `Blob` → worker (`scanLog` : découpage en entrées, filtre des niveaux d'erreur, empreinte) → liste à plat des entrées en erreur et table des empreintes en état de session.
   Le worker ne conserve que des positions et métadonnées (voir « Mémoire » au §3 de `SPEC.md`) ; le texte est relu par `readEntryText` (`Blob.slice`) à l'affichage du détail et à l'analyse.
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
- **CSP** : à l'étape 0 `connect-src 'self'` seulement. Domaines cibles, ajoutés par l'étape qui en a besoin : `https://api.anthropic.com` et `http://localhost:11434` (étape 7, **faits**, verrouillés par `tests/staticwebapp-config.test.ts`),
  `https://login.microsoftonline.com` et `https://api.loganalytics.azure.com` (étape 10c), `https://*.blob.core.windows.net` (étape 10b). Pas de `'unsafe-inline'` ni de `'unsafe-eval'` : aucun style en ligne dans le code.
  `base-uri`, `form-action` et `frame-ancestors` sont déclarés car ils ne retombent pas sur `default-src`. `http://localhost:11434` depuis une page HTTPS : mesuré à l'étape 1 dans Opera et dans Chrome avec cette CSP, à condition qu'Ollama autorise l'adresse du site (`OLLAMA_ORIGINS`) ; non vérifié dans Edge ni Firefox (ADR-002).
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
MSAL.js : mesuré à l'étape 1 à 68,74 Ko gzip (`@azure/msal-browser` 5.28.0), soit environ 139 Ko avec le JavaScript de l'application, sous le budget (ADR-004) ; il n'est ajouté qu'à l'étape 10c. Les prompts `.md` sont embarqués au build (`?raw`) : le bénéfice est la lisibilité et le diff, pas l'absence de rebuild.

## Écrans
Une page principale : sources, liste d'erreurs virtualisée par blocs (ADR-013), panneau de détail avec onglets Analyse et Chat (le détail existe depuis l'étape 5, les onglets arrivent aux étapes 8 et 9) ; les réglages du fournisseur et de la clé sont un panneau de l'étape « Envoyer à l'IA », pas une page (ADR-017).
Conception et accessibilité : `frontend-architect`.
