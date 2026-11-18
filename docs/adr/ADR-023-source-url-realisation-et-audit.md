# ADR-023 : Source « URL » (étape 10b) — réalisation, limite mesurée et audit du code

## Statut
Accepté — 2026-11-18, avec la validation de l'étape 10b par l'auteur, après son essai sur le vrai compte (voir « Essai réel »). Réalise la partie 10b de l'ADR-020 (audit de conception). Le numéro 022 est pris par l'ADR de l'historique local (étape 11, branche `feat/etape-11`, non fusionnée) : cet ADR prend le suivant.

## Contexte
L'auteur a créé le compte de stockage **`sherlogjournaux`** (West Europe, `rg-sherlog`, Standard LRS, niveau Cool, accès anonyme désactivé, HTTPS obligatoire, TLS 1.2), un conteneur privé `journaux` et une règle CORS sur le service Blob (origine de production exacte, `GET`/`HEAD`/`OPTIONS`, en-têtes `*`, âge maximal 3 600 s). L'hôte exact est donc `sherlogjournaux.blob.core.windows.net` (ADR-020, Q3 levée). Q4 (limite de téléchargement) m'était laissée : elle est mesurée ci-dessous.

## Décision
- **Un seul compte, nommé en entier** (`ALLOWED_STORAGE_HOSTS` dans `src/sources/urlSource.ts`), jamais de joker. La CSP (`connect-src`) reçoit `https://sherlogjournaux.blob.core.windows.net` en plus de `'self'`, Anthropic et Ollama ; un test garde la liste de la CSP **égale** à celle du code et refuse tout joker. Ajouter un compte = modifier les deux, puis redéployer.
- **Vérification avant tout envoi** (`checkSourceUrl`) : https, ni identifiants (contrôlés **avant** l'hôte : dans `https://hôte-autorisé@autre.exemple/` le nom autorisé n'est que l'utilisateur), ni port, hôte **exactement** dans la liste (ce qui écarte les adresses IP, les autres comptes, les noms qui ressemblent, le point final), une adresse de **fichier** (pas d'un compte ni d'un conteneur). L'adresse n'est **jamais répétée** dans un refus, un échec ou un message : elle peut porter un jeton SAS. Le fragment est retiré.
- **Un seul émetteur.** Le téléchargement passe par `send` (`src/ai/request.ts`), le module qui n'envoie ni cookie ni référent ; l'option `redirect` y a été ajoutée (`'error'` pour cette source : une adresse avec jeton n'a aucune raison de rediriger ; sans effet pour les fournisseurs d'IA). Aucun nouvel appel `fetch` dans `src/` : la liste de l'ADR-017 ne change pas, une garde le vérifie.
- **Téléchargement borné** (`downloadLog`) : un fichier **annoncé** plus grand que la limite est refusé **avant d'être lu** (flux annulé) ; un fichier qui dépasse en route (taille non annoncée ou fausse, ou compressée) est **coupé** dès que la limite est franchie et **rien n'est gardé** ; l'annulation de l'utilisateur interrompt aussi une lecture en attente ; progression en octets reçus.
- **Un fichier comme un autre.** Le contenu est gardé en mémoire dans un `Blob`, puis donné au parcours existant sous la forme d'un `File` : lecture du début, préparation, analyse **sur clic** (ADR-020, U7). Rien n'est analysé ni envoyé à l'IA au téléchargement.
- **Saisie masquée.** L'adresse se saisit dans un champ `type="password"`, sans `<form>` (donc sans proposition d'enregistrement par le navigateur), `autocomplete="off"`. Pendant le téléchargement seuls l'hôte et le nom du fichier sont montrés ; une fois le fichier remis, le champ est vidé. L'adresse n'est ni stockée, ni mise dans l'historique, ni dans la barre d'adresse (garde sur `src/` : aucune API d'historique ni de navigation).
- **Chaque échec dit quoi faire** : jeton invalide ou expiré (avec le code), fichier introuvable, compte injoignable (**avec l'adresse du site à autoriser dans les règles CORS** et les méthodes), délai, rupture, limite (taille annoncée et limite). Annuler ne dit rien.

## Limite mesurée (ADR-020, Q4)
Mesurée dans Chrome (headless, poste de développement Windows) sous la CSP de production, par `E2E_DOWNLOAD_MEGABYTES=128,256,512,1024,2048 npm run e2e` avec la limite relevée le temps de la mesure : le réseau est remplacé par un flux qui fabrique le fichier 64 Kio par 64 Kio, et l'on mesure ce que fait la page : le garder dans un `Blob`, reconnaître le format, puis le lire entièrement dans le worker (« Analyser »).

| Taille | Téléchargement | Analyse | Tas JS (pic) | Mémoire de Chrome (croissance) |
|---:|---:|---:|---:|---:|
| 64 Mio | 0,4 à 0,5 s | 2,6 à 2,8 s | 28 Mio | 110 à 167 Mio |
| 128 Mio | 0,5 s | 4,6 s | 29 Mio | 210 Mio |
| 256 Mio | 0,8 s | 10,9 s | 19 Mio | 307 Mio |
| 512 Mio | 1,2 s | 18,4 s | 24 Mio | 606 Mio |
| 1 024 Mio | 2,3 s | 47 s | 16 Mio | 927 Mio |
| 2 048 Mio | 10 s | 80 s | 17 Mio | 2 009 Mio |

**Lecture.** Le tas JavaScript reste petit (le fichier n'y est pas gardé), mais **la mémoire du navigateur croît à peu près comme la taille du fichier** (le `Blob` est en mémoire) ; l'analyse, elle, est linéaire à ces tailles avec une dérive au-delà de 512 Mio. **Limite retenue : 256 Mio** (`MAX_DOWNLOAD_BYTES`) : environ 300 Mio de mémoire et une dizaine de secondes d'analyse, sur un poste ordinaire ; le relever est un changement d'une ligne, à faire sur une mesure du poste de l'auteur. Un fichier plus grand reste lisible en le choisissant comme **fichier local** (sans copie en mémoire). Refus d'un fichier annoncé trop grand : 6 à 17 ms ; coupure d'un fichier qui ne l'annonce pas : 30 à 65 ms.

## Audit du code contre l'ADR-020
Liste de contrôle de Sherlog (`CLAUDE.md`, adaptation 6). **Aucun point critique, majeur ni moyen dans le code de cette sous-étape** ; un point hors périmètre est signalé plus bas (audit des dépendances).

| # ADR-020 | Contrôle exigé | Constat | Preuve |
|---|---|---|---|
| T1, U1 | Pas de joker, compte exact | Respecté : un hôte exact, CSP égale à la liste du code | 2 tests de configuration ; mutation : joker ou hôte en trop → test rouge |
| T2 | `fetch` ajouté explicitement, sans cookie ni référent, délai, annulation | Respecté et **plus strict** : aucun nouvel émetteur, `send` réutilisé ; délai de 30 s sur les en-têtes, annulation y compris pendant l'attente | garde sur `src/` (6 mutations tuées : `fetch`, `fetchImpl`, historique, `window.open`, `location.replace`, champ en clair) ; e2e : requête sans `cookie`, `referer`, `authorization` |
| T3 | Noms non fiables rendus en texte | Respecté : nom décodé, sans caractères de contrôle, 200 caractères au plus ; rendu texte | tests ; test d'interface (`<img onerror>` reste du texte) |
| T4 | Rien lu ni analysé sans action ; limite dite | Respecté : rien ne part à la saisie ; téléchargement sur clic ; analyse sur un second clic ; limite dite avec taille et plafond | tests ; e2e (« saisir l'adresse n'envoie rien », « sans rien analyser ») |
| T5, U2 | Le jeton n'est jamais affiché, stocké, journalisé, ni dans un message | Respecté : champ masqué, vidé au succès, absent de tout message d'erreur, de l'écran, de l'adresse de la page, des stockages et du prompt (seul le nom du fichier y est, masqué comme pour un fichier local et visible dans l'aperçu) | tests de non-fuite sur chaque issue (au cœur et à l'écran) ; e2e : jeton absent de l'écran, de `location`, de `localStorage` et `sessionStorage` après chaque issue ; garde : aucune API d'historique |
| T6, U4 | Mémoire et durée bornées, mesurées | Respecté : limite 256 Mio **mesurée** (tableau), progression, annulation | e2e : 64 Mio de bout en bout, refus avant lecture, coupure en route |
| U3 | Schéma, identifiants, IP, port, redirection | Respecté : voir « Décision » ; `redirect: 'error'` | 83 tests du cœur, dont des adresses piégées (schémas, identifiants, ports, hôtes qui ressemblent) ; 32 mutations tuées ; e2e : une redirection n'est pas suivie et rien n'est lu |
| U5 | CORS : message explicite avec l'origine | Respecté | test ; e2e : sans règle CORS, l'écran donne l'adresse du site |
| U6 | Le type du contenu n'est pas une preuve | Respecté : le type n'est pas lu ; le contenu passe par la détection de format | par construction |
| U7 | Contenu en `Blob`, pas de `Range` | Respecté | e2e : lecture complète du fichier téléchargé |
| Routes, rôles | Inchangés | `routes` et `responseOverrides` inchangés | tests de configuration |

**Défauts trouvés et corrigés pendant l'étape.** (1) Cinq mutations d'abord survivantes, toutes tuées par un test ajouté : mot de passe seul dans l'adresse (`https://:mdp@…`), taille « 1.0 », limite par défaut non appliquée, adresse envoyée sans passer par la vérification, erreur inattendue avalée. (2) La remise du fichier (`onFile`) était dans le bloc qui attrape les erreurs : une exception de l'étape suivante aurait été présentée comme un échec de téléchargement ; elle en est sortie. (3) Sous Windows (système de fichiers insensible à la casse), `tests/urlSource.test.ts` et `tests/UrlSource.test.tsx` entraient en collision pour TypeScript : le premier est devenu `urlDownload.test.ts`.

**Risque résiduel accepté.** Un script injecté dans la page (XSS) pourrait lire le jeton **pendant qu'il est saisi** (même origine), comme il pourrait lire la clé d'IA (ADR-017), puis l'envoyer… seulement au compte nommé (la CSP) et, pour écrire, il faudrait un jeton en écriture, que l'application ne demande jamais et que le CORS (`GET`, `HEAD`, `OPTIONS`) n'autorise pas. Réduit par : CSP stricte, aucun HTML brut, jeton en lecture seule et de courte durée (conseil affiché), champ vidé dès que le fichier est là.

**Hors périmètre, décidé depuis (audit des dépendances) : ADR-024**, l'audit bloquant de la CI ne porte plus que sur les dépendances livrées. Constat d'origine : `npm run audit` (seuil « élevé ») **échouait** au moment de cette étape : 7 avis élevés, **tous dans des outils de développement** (`picomatch` ≤ 4.0.7, déni de service ReDoS par des motifs glob répétés, remonte à `vite`, `vitest`, `@vitejs/plugin-react`) ; `npm audit --omit=dev` indique **0 vulnérabilité** dans ce qui est livré. Aucune version corrigée de `picomatch` n'est publiée et le correctif proposé par npm est un retour en arrière majeur de `vitest` : je n'y touche pas. Cette étape n'a modifié ni `package.json` ni le verrou. L'étape « audit » du workflow CI étant bloquante avant le déploiement, **la décision est à l'auteur** : attendre un correctif, ou limiter l'audit de la CI aux dépendances livrées (`--omit=dev`).

**Mesuré.** 1 479 tests Vitest (14 mutations de l'écran tuées) ; **172 vérifications de bout en bout dans Chrome** sous la CSP de production (dont 21 pour la source URL : refus d'un compte ou d'un schéma non autorisé, requête sans cookie ni référent, préparation sans analyse, jeton absent de l'écran, de l'adresse et des stockages, jeton refusé, redirection non suivie, CORS manquant, annulation, 64 Mio, refus avant lecture, coupure en route) ; script principal à 106 Ko gzip (339 Ko bruts) pour un budget de 300 Ko gzip, sans dépendance ajoutée.

**Essai réel (2026-11-18, par l'auteur).** La version de cette branche, servie en local avec les en-têtes de production (`serve:dist`, `http://127.0.0.1:4175`), a téléchargé `journaux/sample.log` depuis le vrai compte `sherlogjournaux` avec un vrai lien SAS en lecture seule (généré dans le portail, jamais transmis à Claude). Une origine `http://127.0.0.1:4175` avait été ajoutée **temporairement** à la règle CORS du service Blob, puis **retirée** par l'auteur après l'essai. Résultat vu par l'auteur : fichier lu (14 entrées), analysé, aucune erreur de l'application dans la console.

**Non vérifié.**
- **Le site de production** avec un vrai lien (l'origine de production n'a été essayée qu'à travers la règle CORS, pas encore avec la page en ligne, qui n'a pas cette version) ; les réponses réelles d'Azure à un jeton expiré (403) ou à un fichier absent (404), et le débit d'un gros fichier.
- Les mesures de mémoire sont celles du **poste de développement** (Windows, Chrome headless, processus de ce navigateur seulement) ; elles diffèrent selon la machine. Le temps de téléchargement ne contient pas le réseau.
- Edge ; Firefox et Safari.
