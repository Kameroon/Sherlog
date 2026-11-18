# ADR-020 : Sources avancées (dossier, URL, Azure Monitor) — audit de sécurité de conception

## Statut
Proposé — 2026-11-09, à la demande de l'auteur (« un audit de sécurité complet sur les sources avancées »). **Audit de conception** : aucune des trois sources n'est écrite. Il fixe les menaces, les contrôles obligatoires et les décisions à prendre **avant** le code ; l'audit du code (`security-audit`, `CLAUDE.md` adaptation 6) se fera à la fin de chaque sous-étape et vérifiera ce tableau ligne par ligne. Rien n'est coché en feuille de route.

## Contexte
Jusqu'ici, un journal arrive par un fichier ou un collage que l'utilisateur donne lui-même, et le seul réseau est celui des deux fournisseurs d'IA (ADR-017). Les trois sources de l'étape 10 changent deux choses : **de nouvelles sorties réseau** (URL, Microsoft) et **de nouveaux secrets** (jeton SAS dans une URL, jeton Microsoft). Une adresse autorisée par la CSP à un script injecté est un canal pour sortir des données ; un secret de plus est un secret de plus à ne jamais montrer, stocker ni journaliser. Les règles de fond ne changent pas : le journal reste une donnée non fiable, rien n'est lu, analysé ni envoyé sans une action de l'utilisateur, aucune télémétrie, la clé et les jetons ne vont qu'à leur propre service.

## Constats de l'audit de conception
Étiquettes : **constat** (vérifié dans le dépôt), **risque** (déduit de la conception), **non vérifié**.

### Transversal
| # | Constat | Gravité si non traité | Contrôle exigé |
|---|---|---|---|
| T1 | **Constat** : `ARCHITECTURE.md` prévoit `https://*.blob.core.windows.net` dans `connect-src`. Un joker autorise **n'importe quel compte de stockage Azure**, y compris celui d'un attaquant : un script injecté (XSS) y enverrait ce que la page lit. | Élevée | Pas de joker. Les comptes de stockage autorisés sont écrits **un par un** (`https://<compte>.blob.core.windows.net`), `connect-src` reste une liste exacte, verrouillée par un test (comme à l'étape 7). Ajouter un compte = modifier la configuration et redéployer (déjà dit au `SPEC.md` §3). |
| T2 | **Constat** : le test `sourceGuards` n'autorise `fetch` que dans `ai/request.ts` et `auth/clientPrincipal.ts`. Les sources distantes en ajouteront. | Moyenne | Étendre la liste **explicitement**, module par module (`sources/urlSource.ts`, `sources/azureMonitor.ts`), jamais par un motif large ; chaque module envoie sans cookie ni référent, avec délai et annulation. |
| T3 | **Risque** : tout nom, toute URL, toute valeur qui vient de la source (nom de fichier ou de dossier, hôte, colonne Azure) est une donnée non fiable. | Moyenne | Rendu en texte seul (déjà garanti : aucun HTML brut dans `src/`, testé). |
| T4 | **Risque** : une source lit plus que ce que l'utilisateur croit (dossier entier, tout un container, toute une période). | Moyenne | Chaque source **liste puis laisse choisir** ; rien n'est lu ni analysé avant le clic de l'utilisateur ; toute limite atteinte est **dite** (jamais de coupe silencieuse, `CLAUDE.md`). |
| T5 | **Risque** : de nouveaux secrets (SAS, jeton Microsoft) dans la console, un message d'erreur, le stockage, l'historique ou la requête vers l'IA. | Élevée | Jamais affichés après saisie, jamais écrits dans un stockage, expurgés de tout message d'erreur (comme la clé d'IA), absents du prompt (le journal seul y part, masqué) ; gardes sur `src/` et tests de non-fuite par source. |
| T6 | **Risque** : mémoire et durée (gros fichiers, gros dossiers, gros résultats). | Moyenne | Bornes mesurées sur des données générées (comme à l'étape 4), flux annulable, progression, limite dite. |
| T7 | **Constat** : l'identité Static Web Apps (GitHub ou Microsoft) n'est pas celle d'Azure Monitor. | Faible | L'écran dit quel compte Microsoft est connecté à Azure Monitor, distinct de l'identité de l'application. |

### 10a — Sélecteur de dossier (Chromium)
| # | Risque | Gravité | Contrôle exigé |
|---|---|---|---|
| A1 | Écriture sur le disque de l'utilisateur. | Élevée | Mode **lecture seule** (`showDirectoryPicker({ mode: 'read' })`) ; aucun appel d'écriture (`createWritable`, `removeEntry`) : garde sur `src/`. |
| A2 | Lecture d'un dossier sensible choisi par erreur, ou lecture de tout le dossier. | Moyenne | Le navigateur demande lui-même l'autorisation ; l'application **liste les fichiers** (noms, tailles, dates), l'utilisateur en **choisit un**, rien n'est lu avant. |
| A3 | Dossier énorme ou imbriqué (déni de service local). | Moyenne | Liste **d'un seul niveau** (pas de récursion) et bornée (nombre d'entrées dit s'il est dépassé) ; la liste se fait par itération, annulable. **Décision demandée** (Q1). |
| A4 | Poignée de dossier gardée pour « relire en un clic » : lisible par un script injecté tant que la permission est accordée. | Moyenne | Gardée seulement **si l'auteur le veut** (Q2), en IndexedDB **cloisonnée par identité** (comme la clé, ADR-017), jamais exportée ; le navigateur redemande la permission à chaque session ; bouton « Oublier ce dossier ». |
| A5 | Fichier modifié ou supprimé pendant la lecture. | Faible | Déjà traité à l'étape 4 (`File` relu par `slice`, message « fichier modifié, déplacé »). |
| A6 | Navigateurs sans l'API (Firefox, Safari). | Faible | Le bouton n'est pas proposé et le dit ; le choix d'un fichier reste possible (`SPEC.md` §7). |

### 10b — Source URL (liste de domaines figée)
| # | Risque | Gravité | Contrôle exigé |
|---|---|---|---|
| U1 | **Joker du domaine** (voir T1) : sortie vers n'importe quel compte. | Élevée | Comptes exacts, sans joker (Q3 : lesquels ?). |
| U2 | **L'URL contient un secret** (jeton SAS : `?sig=…`) : visible à l'écran, dans l'historique du navigateur, dans un message d'erreur, dans l'en-tête `Referer`. | Élevée | Champ masqué à la saisie ; **l'hôte seul** est montré ensuite ; l'URL n'est **jamais** stockée ni dans l'historique de l'application ; `referrerPolicy: 'no-referrer'` (déjà la règle de l'application) ; la partie secrète est retirée de tout message d'erreur. |
| U3 | URL détournée : autre schéma, hôte hors liste, identifiants dans l'URL (`https://x@hôte`), adresse IP, port inhabituel, redirection vers un autre hôte. | Moyenne | Validation **avant** l'envoi (HTTPS seul, hôte **exactement** dans la liste, ni identifiants, ni IP, ni port) avec un message clair ; la **CSP reste l'application réelle** de la liste (elle contrôle aussi les redirections) ; `redirect: 'error'` : une URL SAS n'a aucune raison de rediriger. |
| U4 | Téléchargement énorme ou sans fin. | Moyenne | Flux borné **par une limite mesurée** (Q4), progression, annulation ; si la taille annoncée dépasse, refus **avant** de télécharger ; au-delà en cours de route, arrêt et message. |
| U5 | CORS non autorisé côté stockage : échec muet du navigateur. | Faible | Message explicite (« le compte de stockage doit autoriser l'adresse de ce site ») avec l'origine à autoriser, comme pour Ollama (ADR-017). |
| U6 | Contenu servi avec un type inattendu (HTML au lieu d'un journal). | Faible | Le type n'est pas une preuve : le contenu passe par la détection de format (« format non reconnu » est dit) ; aucun contenu n'est jamais interprété. |
| U7 | Le fichier téléchargé doit être relu à la demande (détail, lignes autour) comme un fichier local. | — | Contenu gardé en mémoire dans un `Blob` (même chemin que le texte collé) : la limite de U4 en est la borne. Pas de requêtes `Range` à la relecture (inutile : KISS). |

### 10c — Azure Monitor direct
| # | Risque | Gravité | Contrôle exigé |
|---|---|---|---|
| M1 | **Dépendance non satisfaite** : le résultat de l'API est un tableau (colonnes, lignes) qui exige le **profil structuré de l'étape 3b**, **non faite**, et un **export réel** fourni par l'auteur (noms de colonnes jamais supposés). | Bloquant | 10c ne démarre pas avant 3b. Le repli (exporter du portail et déposer le fichier) reste la voie par défaut et ne dépend que de 3b. |
| M2 | Jeton Microsoft volé (XSS). | Élevée | Jeton en **mémoire seulement** (cache MSAL en mémoire : **non vérifié**, le spike a mesuré `sessionStorage`, ADR-004), portée **minimale en lecture** (`Data.Read` : valeur exacte **non vérifiée**), jamais écrit, jamais journalisé, jamais envoyé ailleurs qu'à `login.microsoftonline.com` et `api.loganalytics.azure.com`, jamais dans le prompt. |
| M3 | Autorité trop large (`common`) : n'importe quel locataire peut se connecter. | Moyenne | Autorité **du locataire de l'auteur** (identifiant de locataire en configuration publique), enregistrement Entra de type application monopage avec **URI de redirection exacts** (production seulement, ADR-004 : les prévisualisations changent d'URL), sans joker. |
| M4 | `frame-src` pour le renouvellement silencieux du jeton : une directive de plus, qui élargit la page. | Moyenne | **Pas de renouvellement silencieux** : connexion par fenêtre contextuelle à la demande, jeton d'environ une heure ; à l'expiration, l'écran le dit et redemande. Donc pas de `frame-src`. À confirmer par essai réel (**non vérifié**). |
| M5 | Requête KQL construite avec du texte non fiable. | Moyenne | Aucune requête libre : la table vient d'une **liste fixe**, la période de champs **validés** (comme la période de la préparation), jamais de concaténation d'une valeur de l'extérieur. |
| M6 | Résultat très gros : limites de l'API (lignes, octets) et pagination. | Moyenne | Plafond **dit** à l'écran (« résultat plafonné à N lignes »), jamais coupé en silence (`SPEC.md` §3) ; limites réelles **non vérifiées**. |
| M7 | Données personnelles dans les logs Azure. | Moyenne | Même chemin que toute source : masquage, aperçu du texte exact, clic pour envoyer (étapes 6 et 8). |
| M8 | Navigateur partagé : jeton ou compte resté ouvert. | Moyenne | Mémoire seulement ; bouton « Se déconnecter d'Azure Monitor » ; rien ne survit à l'onglet. |
| M9 | En-tête `Cross-Origin-Opener-Policy` : la fenêtre contextuelle de connexion exige que `window.opener` reste joignable. | Faible | Ne pas ajouter de COOP `same-origin` ; test de configuration qui le garantit. |

## Décisions prises (2026-11-09) et décisions encore ouvertes
- **Q1 — décidée : un seul niveau.** **Q2 — décidée : retenir le dossier** (cloisonné par identité, avec « Oublier »). Réalisées en 10a : ADR-021.
- **Q3 — décidée (2026-11-17) : le compte `sherlogjournaux`**, créé par l'auteur. **Q4 — décidée : 256 Mio**, mesurée sur un fichier généré. Réalisées en 10b : ADR-023. **Q5 — OUVERTE** : ni 3b, ni export réel, ni enregistrement Entra, ni workspace ; 10c bloquée.

## Décisions à prendre avant le code (texte d'origine)
- **Q1 — Dossier : un seul niveau ou récursif ?** Proposé : **un seul niveau** (KISS, borne simple ; les journaux sont d'ordinaire dans un dossier plat).
- **Q2 — Dossier : retenir le dossier pour le relire en un clic (`SPEC.md` §4, « relecture rapide d'un dossier déjà autorisé »), ou le redemander à chaque fois ?** Proposé : **le retenir**, cloisonné par identité, avec « Oublier » ; sinon rien à stocker.
- **Q3 — URL : quels comptes de stockage exactement ?** Aucune adresse n'est devinée : le nom de chaque compte (`https://<compte>.blob.core.windows.net`) est donné par l'auteur ; sans cela, 10b n'est pas livrable. Conseil à afficher : jeton SAS en lecture seule, de courte durée.
- **Q4 — URL : limite de taille d'un téléchargement ?** Proposé : à **mesurer** sur un fichier généré, comme à l'étape 4 (la valeur sera consignée avec ses chiffres).
- **Q5 — Azure Monitor : 3b d'abord, avec un export réel.** 10c suppose : l'étape 3b faite, un **export réel** fourni par l'auteur, un **enregistrement Microsoft Entra** (identifiant d'application, identifiant de locataire) et un workspace avec des données. Sans eux, 10c reste au stade de la conception (c'est le premier élément à couper si le périmètre dérape, `ROADMAP.md`).

## Ordre proposé
**10a** (aucun réseau, aucun secret : le plus sûr et le plus utile pour un poste Windows) → **10b** (dès que les comptes sont donnés) → **3b** (profil structuré, avec l'export réel) → **10c**. Chaque sous-étape : tests d'abord, mutations sur les garde-fous, test de bout en bout dans Chrome, **audit du code contre ce tableau**, ADR de réalisation, arrêt pour validation. Rien n'est mis en production sans l'accord explicite de l'auteur pour la pull request.

## Ce que cet audit n'a pas pu vérifier
- Le comportement réel de MSAL (cache en mémoire, portée, fenêtre contextuelle, consentement, compte personnel) : aucun enregistrement Entra ni workspace n'a été disponible (ADR-004).
- Les limites réelles de l'API Log Analytics (lignes, octets, pagination) et celles d'un téléchargement depuis Blob Storage avec un jeton SAS.
- L'API de sélection de dossier sur le poste de l'auteur (Chrome ou Edge récents : disponible, mais non essayée ici).
