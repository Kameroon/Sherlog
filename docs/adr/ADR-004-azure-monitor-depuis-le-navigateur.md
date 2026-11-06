# ADR-004 : Lecture d'Azure Monitor depuis le navigateur

## Statut
Proposé — 2026-11-06 : les deux critères techniques de go (poids de MSAL, CORS de l'API Log Analytics) sont atteints ; la connexion réelle n'a pas pu être testée faute de workspace et d'enregistrement Entra. Décision d'acceptation reportée à ce test (étape 10c).

## Contexte
Les logs d'Application Insights et Log Analytics sont une source réelle. Sans backend, la lecture passe par une connexion Microsoft dans le navigateur.

## Décision (proposée)
Connexion Microsoft dans le navigateur (enregistrement d'application Microsoft Entra gratuit), jeton gardé en mémoire avec une portée minimale en lecture, requête sur une période.

## Raisons
- Évite à l'utilisateur l'export manuel depuis le portail.

## Conséquences
- L'API renvoie des tables (colonnes et lignes) : il faut un profil structuré, comme pour l'export CSV du portail (étape 3b). Les noms de colonnes sont relevés sur un export réel.
- Un consentement administrateur peut être exigé selon le locataire.
- Repli : export depuis le portail déposé comme fichier. C'est le premier élément coupé si le périmètre dérape.
- La CSP de production doit contenir `https://login.microsoftonline.com` et `https://api.loganalytics.azure.com` dans `connect-src` (ajoutés à l'étape 10c, pas avant). Le renouvellement silencieux d'un jeton par MSAL peut en outre exiger une directive `frame-src` : à vérifier avec la connexion réelle.

## Résultats du spike (étape 1, 2026-11-06)
Étiquettes : **mesuré**, **documenté**, **non vérifié**.

### Poids de MSAL — critère de go atteint
- **Mesuré :** `@azure/msal-browser` 5.28.0 (épinglé), Vite 8.3.6, projet de mesure isolé hors dépôt dont l'entrée instancie `PublicClientApplication` et appelle `loginPopup` et `acquireTokenSilent` : JavaScript 272,63 Ko, **68,74 Ko gzip**. `npm audit` : 0 vulnérabilité sur ce projet de mesure.
- **Mesuré :** le JavaScript de l'application (étape 0) pèse 70,07 Ko gzip. La somme, environ **138,8 Ko gzip** de JavaScript (plus 0,78 Ko de CSS), est une addition de deux builds séparés, pas un build combiné ; elle laisse une marge importante sous le budget de 300 Ko.

### CORS — critère de go atteint
- **Mesuré, `curl`, origine de production :** l'API `https://api.loganalytics.azure.com` répond à la pré-vérification (204) et à une requête réelle (200) avec `Access-Control-Allow-Origin: *`, en-têtes `authorization`, `content-type` et `x-api-key` autorisés. Le point de jeton `login.microsoftonline.com/common/oauth2/v2.0/token` répond à la pré-vérification d'un POST (200, `Access-Control-Allow-Origin: *`).
- **Mesuré, navigateur** (Opera 139.0.6053.22, page de test HTTPS) : `POST` JSON avec `x-api-key: DEMO_KEY` sur `DEMO_WORKSPACE` (espace de démonstration public de Microsoft) : 200 en 1 170,5 ms, corps lisible : `tables[0]` de nom `PrimaryResult`, colonnes `Category` (string) et `count_` (long), `rows` vide pour cette requête. La forme exacte des lignes n'a donc pas été observée.
- **Mesuré, Chrome** (navigateur indiqué par l'auteur ; version installée relevée : 156.0.8078.80), même page, même requête : 200 en 1 094,9 ms (premier essai) puis 1 955,3 ms (second essai), même corps. Le CORS de l'API Log Analytics fonctionne donc dans Opera et dans Chrome.
- **Documenté :** la page Microsoft Learn sur l'accès à l'API ne mentionne pas le CORS : le comportement est mesuré, pas documenté.
- **Non vérifié :** le CORS de l'API avec un jeton Entra (la clé de démonstration suit un autre chemin d'authentification) ; la pré-vérification du point de jeton dans un navigateur (MSAL n'a pas été exécuté).

### Documenté, non encore mis à l'épreuve
- Le point `api.loganalytics.azure.com` exige une authentification Microsoft Entra ; une application doit disposer de la permission déléguée `Data.Read` de l'API Log Analytics, et l'utilisateur d'un rôle de lecture (par exemple « Reader ») sur le workspace (`learn.microsoft.com/azure/azure-monitor/logs/api/access-api`).

### Non vérifié (aucun workspace ni enregistrement Entra disponibles)
- Connexion réelle : fenêtre contextuelle (`loginPopup`) et jeton obtenu.
- Valeur exacte de la portée demandée en flux délégué pour une application monopage.
- Consentement administrateur selon le locataire ; comportement avec un compte Microsoft personnel.
- Stockage du jeton par MSAL : l'essai de poids utilisait `sessionStorage` ; l'option « mémoire seulement » voulue par cette décision n'a pas été vérifiée.
- URI de redirection : chaque pull request a une URL de prévisualisation différente ; seule l'URL de production est stable.
- Ressource Application Insights (au lieu d'un workspace Log Analytics) ; limites de taille et pagination des résultats de l'API.
