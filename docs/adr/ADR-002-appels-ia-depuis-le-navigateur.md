# ADR-002 : Appels IA directs depuis le navigateur avec la clé de l'utilisateur

## Statut
Accepté pour Anthropic ; Ollama accepté comme option, avec des vérifications restantes — 2026-11-06 (résultats du spike de l'étape 1, à valider par l'auteur avec l'étape).

## Contexte
L'analyse et le chat nécessitent un modèle de langage. Sans backend, l'application ne peut pas détenir de clé : chaque utilisateur apporte la sienne.

## Décision
Appels directs depuis le navigateur vers l'API Anthropic avec la clé de l'utilisateur, ou vers Ollama en local.
Appel par `fetch` et lecture du flux SSE, sans SDK. Clé en `sessionStorage` par défaut, jamais journalisée ni exportée.

Anthropic :
- en-têtes envoyés : `x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json` et **`anthropic-dangerous-direct-browser-access: true`**, sans lequel la réponse n'est pas lisible par la page ;
- la requête n'envoie ni `temperature`, ni `top_p`, ni `top_k` : la version d'API `2026-10-21` les supprime et renvoie une erreur 400 si l'un d'eux est présent.

Ollama : option, jamais obligatoire. L'utilisateur doit autoriser l'adresse du site côté Ollama (`OLLAMA_ORIGINS`) ; l'écran Paramètres (étape 7) le lui explique et propose « Tester la connexion ».

## Raisons
- Aucune clé ni aucun log ne transitent par un serveur de l'auteur.
- Pas de SDK : économie de poids dans le budget de 300 Ko gzip.

## Conséquences
- La clé est exposée à un éventuel XSS : CSP stricte, pas de HTML brut, clé dédiée avec plafond de dépense recommandée à l'utilisateur.
- L'en-tête d'accès navigateur d'Anthropic **n'apparaît pas dans la documentation officielle lue** (pages « API overview » et « Versions ») : son fonctionnement est mesuré, pas documenté. Un changement côté Anthropic casserait les appels : l'écran Paramètres doit afficher une erreur explicite (« Tester la connexion ») plutôt qu'un échec muet.
- La CSP de production doit contenir `https://api.anthropic.com` et `http://localhost:11434` dans `connect-src` (ajoutés à l'étape 7, pas avant).
- Chaque utilisateur d'Ollama autorise l'adresse de **production** de l'application : une origine non autorisée est refusée avec un 403. Les URL de prévisualisation changent à chaque pull request et ne sont pas concernées.
- Ollama est une option : le poste de l'auteur ralentit fortement dès qu'un modèle est chargé, ce qui ne doit pas en faire un chemin recommandé par défaut.

## Résultats du spike (étape 1, 2026-11-06)
Étiquettes : **mesuré** (commande ou observation faite), **documenté** (documentation officielle lue), **non vérifié**.

### Anthropic
- **Mesuré, `curl`, origine de production :** la pré-vérification du `POST /v1/messages` autorise `anthropic-dangerous-direct-browser-access` (`access-control-allow-origin: *`). Un POST avec fausse clé et cet en-tête renvoie un 401 JSON avec `access-control-allow-origin: *` ; sans l'en-tête, la réponse ne porte aucun en-tête CORS.
- **Mesuré, navigateur** (Opera 139.0.6053.22, page de test servie en HTTPS par une prévisualisation, clé dédiée saisie par l'auteur) :
  - vraie clé, en-tête envoyé : 200 `text/event-stream` ; premier texte à 774,7 ms ; 2 fragments réseau et 5 événements de texte ; 1 057,7 ms au total ; les nombres 1 à 20 reçus ;
  - fausse clé, en-tête envoyé : 401 lisible par la page (`authentication_error`, `invalid x-api-key`, `request_id`) en 122,0 ms ;
  - vraie clé, en-tête absent : `TypeError: Failed to fetch`. La cause (CORS) est déduite des en-têtes `curl` ci-dessus ; la Console du navigateur n'a pas été consultée.
- **Mesuré, Chrome** (navigateur indiqué par l'auteur ; version installée relevée sur le poste : 156.0.8078.80), même page, vraie clé, en-tête envoyé : 200 `text/event-stream` ; premier texte à 1 159,6 ms ; 2 fragments réseau et 5 événements de texte ; 1 436,1 ms au total ; les nombres 1 à 20 reçus. Le comportement est identique à celui d'Opera, aux délais près.
- **Documenté :** `anthropic-version` obligatoire, dernière version `2026-10-21` (page « Versions »), `temperature`/`top_p`/`top_k` supprimés dans cette version.
- **Non vérifié :** Edge, Firefox et Safari ; l'en-tête absent et la fausse clé dans Chrome (seul l'essai nominal y a été fait) ; réponse longue (la réponse testée tenait en 20 lignes, la finesse du flux sur un long texte n'est pas mesurée) ; erreurs autres que 401 (limite de débit, surcharge, erreur au milieu d'un flux) ; saisie de la clé dans l'écran Paramètres réel.

### Ollama (0.40.14, poste Windows de l'auteur)
- **Mesuré, `curl`, configuration par défaut :** `GET /api/tags` et pré-vérification du `POST /api/chat` avec l'origine de la prévisualisation répondent **403**.
- **Mesuré, `curl`, après définition de `OLLAMA_ORIGINS` pour cette origine et redémarrage d'Ollama :** `GET` 200, pré-vérification 204, `POST` sur un modèle inexistant 404, tous avec `Access-Control-Allow-Origin` égal à l'origine autorisée. L'origine de production, non listée, reste en 403.
- **Mesuré, navigateur (Opera 139, page de test HTTPS) :** `GET http://localhost:11434/api/tags` 200 en 120,6 ms ; `POST /api/chat` sur un modèle inexistant : 404 en 23,6 ms, corps d'erreur `model 'sherlog-modele-absent' not found` lisible par la page, donc pré-vérification du `POST` JSON passée. Le premier essai, avant `OLLAMA_ORIGINS`, avait échoué (`TypeError: Failed to fetch`). Une page HTTPS peut donc appeler `http://localhost` avec la CSP prévue ; aucune invite du navigateur n'a été signalée par l'auteur.
- **Mesuré, Chrome** (156.0.8078.80, même page) : avec `OLLAMA_ORIGINS` autorisant l'origine, `GET /api/tags` 200 en 158,7 ms et `POST /api/chat` sur un modèle inexistant 404 en 16,8 ms avec erreur lisible. Avec la variable retirée (configuration par défaut, 403 mesuré par `curl`), le `GET` échoue en `TypeError: Failed to fetch` après 2 085,8 ms et le `POST` aussi : l'échec est conforme au refus d'Ollama, il n'établit rien de plus sur Chrome. Aucune invite d'autorisation de Chrome n'a été signalée par l'auteur.
- **Documenté :** Ollama écoute `127.0.0.1:11434` ; origines autorisées par défaut `127.0.0.1` et `0.0.0.0` ; `OLLAMA_ORIGINS` en ajoute (variable de compte sous Windows, puis redémarrage d'Ollama) (`docs.ollama.com/faq`). Des articles de blog décrivent une autorisation « Local Network Access » dans Chrome depuis la version 142 (loopback depuis la 145) : Chrome 156 a été testé et l'auteur n'a signalé aucune invite, mais l'absence d'invite n'a pas été observée de façon contrôlée (aucune capture ni vérification dédiée).
- **Non vérifié :** le streaming de vrais jetons (aucun modèle n'a été chargé : le poste ralentit) ; Edge, Firefox et Safari ; une éventuelle invite d'autorisation de Chrome ou d'Edge (non signalée, non contrôlée) ; l'adresse `127.0.0.1` à la place de `localhost`.
- À noter : ouvrir `http://localhost:11434/api/tags` directement dans un onglet n'est pas un test CORS (aucune origine n'est envoyée) ; seules les mesures faites depuis la page de test comptent ici.
