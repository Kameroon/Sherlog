# ADR-017 : Fournisseurs d'IA, clé de l'utilisateur et test de connexion

## Statut
Accepté — 2026-11-09, avec la validation de l'étape 7 par l'auteur. Complète l'ADR-002 (qui décide le principe des appels directs) : celui-ci décide ce qui est réalisé à l'étape 7.

## Contexte
L'étape 7 donne à Sherlog sa première sortie réseau : un fournisseur d'IA choisi par l'utilisateur, avec sa clé (Anthropic) ou son modèle local (Ollama). Le prompt durci qui range le journal dans des données (délimiteur aléatoire, JSON validé) est l'étape 8 : tant qu'il n'existe pas, **aucun mot d'un journal ne doit partir**. Décisions de l'auteur du 2026-11-09 : réglages dans l'étape 4 plutôt qu'une page à part ; « Tester la connexion » seulement ; « se souvenir de ma clé » avec avertissement ; modèle en champ libre, Haiku 5.5 au départ, liste des modèles installés pour Ollama.

## Décision
- **Où.** Un panneau « Fournisseur d'IA » dans le panneau « Envoi à l'IA », visible seulement une fois l'analyse terminée avec au moins une erreur (`SPEC.md` §3). Pas de page Paramètres ni de routage. L'étape 4 du parcours devient l'étape courante à ce moment ; le bouton « Envoyer à l'IA » reste désactivé et le dit : l'envoi des erreurs choisies arrive avec l'analyse (étape 8).
- **Ce que le test envoie.** Anthropic : une phrase fixe (`Réponds uniquement par le mot : OK`, 16 jetons au plus), lue en flux, jamais un mot d'un journal. Ollama : seulement `GET /api/tags` (liste des modèles installés) ; aucun modèle n'est chargé, ce qui ralentirait le poste (ADR-002).
- **Appels** (`src/ai/`). `fetch` sans SDK. Un seul module d'envoi (`request.ts`) pose ce qui ne doit jamais varier : pas de cookie (`credentials: 'omit'`), pas de référent, pas de cache, un délai pour obtenir la réponse (30 s), l'annulation par l'appelant. Tout échec devient une `AiRequestError` d'un type connu (clé refusée, accès refusé, modèle absent, demande refusée, limite, indisponible, réseau, délai, flux interrompu, réponse inattendue, annulée), traduit en français par `failureMessage`. Un flux qui s'arrête avant son dernier événement (`message_stop` chez Anthropic, `done: true` chez Ollama) est un échec « interrompu », jamais une réponse plus courte prise pour entière. Lecture par lignes bornée à 1 million de caractères.
- **Clé.** Saisie dans un champ `password` que le navigateur ne remplit pas ; vérifiée dans sa forme (ASCII visible, sans espace, 512 caractères au plus) et **jamais sur son début** (`sk-ant-` n'est pas exigé : le fournisseur seul dit si elle est valide). Gardée en mémoire tant que l'utilisateur ne l'enregistre pas ; enregistrée, elle est **en `sessionStorage` par défaut** (disparaît avec l'onglet) ou, sur case « Me souvenir de ma clé sur cet ordinateur » et après un avertissement, en `localStorage`. **Une seule copie** : l'autre emplacement est vidé. Jamais réaffichée (le champ reste vide, un texte dit qu'une clé est enregistrée) ; ce que le fournisseur répond en est expurgé avant d'être montré ; jamais dans un message d'erreur, la console ni un export.
- **Cloisonnement par identité.** Clés et réglages portent l'identité de l'utilisateur (`fournisseur/identifiant`) dans leur nom de stockage : un autre invité du même navigateur ne les lit pas (`SPEC.md` §2). Si l'identité n'est pas lue (point de terminaison en panne, hors Static Web Apps), un nom partagé sert et « se souvenir » est refusé : rien ne survit à l'onglet.
- **Modèle.** Anthropic : champ libre, `claude-haiku-5-5` au départ (le plus léger, l'explication n'en demande pas plus) ; seule la forme est vérifiée (lettres, chiffres, `. _ - : /`, 100 caractères au plus), l'existence est la réponse du test. Ollama : liste des modèles installés lue sur le poste, choix dans la liste ; un modèle choisi puis désinstallé est signalé. Fournisseur et modèles (non secrets) sont gardés en `localStorage`, validés champ par champ à la lecture.
- **CSP.** `connect-src 'self' https://api.anthropic.com http://localhost:11434` : exactement ces deux adresses, sans joker, verrouillé par un test. Seule modification de `staticwebapp.config.json` ; routes, rôles et autres directives inchangés.
- **Information de l'utilisateur** (`SPEC.md` §6). Le panneau dit toujours où partiraient les extraits : « vers Anthropic (api.anthropic.com), avec votre clé » ou « restent sur cet ordinateur : envoyés à Ollama (localhost:11434) ».
- **Interface `AiProvider`** : `stream(messages, { signal })`, deux implémentations. Le flux d'Ollama et celui d'Anthropic sont écrits et testés dès maintenant, mais seul celui d'Anthropic est exercé par le test de connexion ; celui d'Ollama sera consommé par l'analyse (étape 8).

## Conséquences
- Le test réel contre Anthropic (clé de l'auteur) n'a **pas** été fait à cette étape : le test de bout en bout joue les fournisseurs au niveau réseau (voir ci-dessous). Les en-têtes et le flux Anthropic ont été mesurés au spike (ADR-002) ; l'auteur peut le refaire dans le panneau avec une clé dédiée.
- La clé est exposée à un XSS tant qu'elle est en mémoire de la page ou en stockage : CSP stricte, pas de HTML brut, clé dédiée avec plafond de dépense, recommandés à l'écran.
- La CSP autorise l'adresse d'Anthropic à tout script de la page : un script injecté pourrait y envoyer des données, mais seulement avec une clé qui n'est pas celle de l'utilisateur et sur le compte de l'attaquant. Risque résiduel accepté, réduit par l'absence de script ou de style en ligne.
- `http://localhost:11434` est contacté depuis une page HTTPS : accepté par les navigateurs pour `localhost` (mesuré, ADR-002) ; un autre programme du poste qui écouterait sur ce port répondrait au test (il ne reçoit rien de sensible : une requête de liste, sans clé).

## Audit de sécurité de l'étape 7 (2026-11-09)
Audit complet, liste de contrôle de Sherlog (`CLAUDE.md`, adaptation 6). **Aucun point critique, majeur ni moyen.** Un défaut mineur trouvé et corrigé en cours d'étape ; trois limites connues.

| Point | Constat | Preuve |
|---|---|---|
| Routes et rôles | Inchangés : `/*` réservé à `invited`, repli 401 → connexion, 403 → page interdite | `git diff` du fichier de configuration : une seule ligne (la CSP) ; `tests/staticwebapp-config.test.ts` |
| CSP | Directives complètes présentes ; `connect-src` exactement `'self'`, Anthropic, Ollama local ; aucun joker, `unsafe-inline` ni `unsafe-eval` | 3 tests de configuration ; une requête vers `example.com` est refusée dans Chrome et n'atteint aucun fournisseur (e2e) |
| Rien ne part sans action | Saisir ou enregistrer une clé, changer de fournisseur ou de modèle n'envoie rien ; seul « Tester la connexion » envoie, et pas un mot du journal | e2e dans Chrome : 0 requête avant le clic, corps de la requête = la phrase fixe sans le texte du journal ; test unitaire du corps exact |
| Ce qui part avec la requête | Clé, version, accès navigateur ; **ni cookie ni référent** | en-têtes relevés dans Chrome (e2e) et dans les tests |
| Stockage de la clé | `sessionStorage` par défaut, `localStorage` sur demande après avertissement, une copie, cloisonné par identité, jamais réaffichée, jamais dans les réglages | 24 tests de stockage (chaque garde-fou vérifié par mutation) ; e2e : emplacement, absence de la clé à l'écran et dans les réglages |
| Fuite de la clé | Absente des messages d'erreur, de la console (aucun `console` dans `src/`) et de ce que le fournisseur répond (expurgée) | tests sur chaque chemin d'échec ; garde sur les sources |
| XSS | Aucun HTML brut, `eval`, style en ligne ; la réponse d'un fournisseur et son explication d'erreur sont rendues comme du texte | garde sur `src/` (`tests/sourceGuards.test.ts`) |
| Sorties réseau | `fetch` seulement dans `ai/request.ts` et dans la lecture de l'identité ; ni `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` | garde sur `src/`, vérifié en faisant échouer le test par une violation volontaire |
| Injection de prompt | Hors périmètre : aucun journal n'est envoyé à cette étape ; traitée à l'étape 8 (le test de connexion n'a pas d'entrée non fiable) | — |
| `redact` | Non modifié ; non sollicité (le test n'envoie aucun journal) | — |
| ReDoS | Deux expressions régulières ancrées, sans imbrication de répétitions, sur des chaînes bornées (512 et 100 caractères) ; le découpage des lignes n'en utilise aucune | lecture ; bornes testées |
| Dépendances | Aucune ajoutée, `package.json` et verrou inchangés ; `npm audit` au seuil élevé : réussi, seul l'avis modéré préexistant sur `minimatch` (outillage `eslint`) | `npm run audit` |
| Mémoire | Ligne sans fin et corps d'erreur : ligne bornée à 1 Mcar ; le corps d'une réponse d'erreur est lu en entier (réponses de quelques centaines d'octets des deux fournisseurs ; non borné) | tests de la limite de ligne |

**Défaut trouvé et corrigé :** la liste des modèles d'un test Ollama abandonné (changement de fournisseur pendant le test) était gardée avant la vérification d'annulation. Corrigé, test ajouté (rouge puis vert, mutation vérifiée). **Défaut trouvé et corrigé :** `fetch` appelé comme méthode d'un objet lève « Illegal invocation » dans un vrai navigateur, ce que des faux `fetch` en flèche ne montraient pas ; le faux `fetch` des tests refuse désormais cet appel, comme le navigateur.

**Mesuré.** 1 061 tests Vitest (Node et jsdom), 107 vérifications de bout en bout dans Chrome 156 sans interface, sous la CSP de production : en-têtes réellement envoyés, requête, refus d'une autre adresse, enregistrement et oubli de la clé, liste des modèles d'Ollama. Poids de l'application : 94,9 Ko gzip (303,4 Ko bruts), sans dépendance ajoutée, contre un budget de 300 Ko gzip. Toutes les mutations de garde-fou (flux, clé, expurgation, stockage, annulation, identité) font échouer au moins un test.

**Non vérifié.**
- **Un appel réel à Anthropic avec une vraie clé depuis le panneau** : le test de bout en bout joue le fournisseur au niveau réseau (DevTools). Le comportement réel a été mesuré au spike de l'étape 1 (ADR-002), avec une page de test, pas avec ce panneau.
- Ollama réel depuis le panneau (les réponses sont jouées) ; Edge, Firefox et Safari ; une éventuelle invite d'accès au réseau local de Chrome ou d'Edge (ADR-002).
- Les erreurs réelles autres que 401 (limite, surcharge, erreur au milieu d'un flux) : classées d'après la documentation et testées sur des réponses fabriquées.
- Le modèle `claude-haiku-5-5` n'a pas été appelé : son existence est la réponse du test de connexion.

## Questions restantes
- Faut-il borner la lecture du corps d'une réponse d'erreur (aujourd'hui entière) ? Non nécessaire avec les deux fournisseurs connus ; proposé : non, à reprendre si un fournisseur est ajouté.
