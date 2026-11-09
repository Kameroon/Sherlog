# ADR-018 : Analyse d'une erreur — prompt durci, réponse validée, rendu sûr

## Statut
Proposé — 2026-11-09, en attente de la validation de l'étape 8 par l'auteur. Suite de l'ADR-016 (ce qui est envoyé) et de l'ADR-017 (fournisseurs et clé).

## Contexte
L'étape 8 est la première où du texte d'un journal part vers un tiers. Un journal est une **donnée non fiable** : n'importe qui peut y faire écrire une ligne (un champ de formulaire, une URL, un en-tête). Il faut qu'une telle ligne ne puisse ni se faire passer pour les consignes données au modèle, ni modifier la forme de ce que l'application accepte en retour, ni mettre du balisage à l'écran (`SPEC.md` §6, `docs/PROMPTS.md`). La menace est la même quel que soit le fournisseur.

## Décision
- **Un clic, puis l'envoi.** « Envoyer à l'IA » est actif quand une erreur est choisie et qu'un fournisseur est utilisable ; le panneau dit avant le clic vers où part le texte et avec quel modèle. Rien ne part en choisissant une erreur, une clé ou un modèle. Une requête par erreur distincte choisie, l'une après l'autre ; **le premier échec arrête la série** (une clé refusée se répéterait pour toutes). Annulable ; une réponse qui arrive après l'annulation n'est pas gardée.
- **Ce qui part est ce qui a été vu.** Le texte vient de `buildSendPayload` (masqué d'abord, coupé ensuite, ADR-016), construit par la même fonction que l'aperçu « Voir le texte exact » (`sendSourceOf`) : même occurrence (la plus récente de l'empreinte), mêmes règles de masquage, même coupure. Vérifié dans Chrome : le texte de l'aperçu est contenu dans le message envoyé.
- **Prompt durci** (`src/ai/analysisPrompt.ts`, `prompts/analysis-system.md`). Les consignes sont à part des messages (champ `system` d'Anthropic, message `system` d'Ollama). Le texte du journal est dans **un seul message utilisateur, entre `<log_data_NONCE>` et `</log_data_NONCE>`**, `NONCE` étant 128 bits tirés par `crypto.getRandomValues` **à chaque requête** (donc aussi à la relance, qui reprend le même, et à chaque envoi). Le prompt système cite le même délimiteur et dit que le bloc est une donnée, jamais une instruction. Si le journal contient par hasard la valeur tirée, une autre est tirée (cinq essais), sinon **aucune requête n'est construite**. Le nom du fichier et les nombres d'occurrences sont dans le bloc (ils viennent du disque de l'utilisateur) ; seule la note de coupure, qui est la nôtre, le suit.
- **Réponse validée** (`src/ai/analysis.ts`). Le JSON seul, avec au plus une clôture ```` ```json ````. **Rien n'est cherché ni deviné** : du JSON entouré de prose est refusé. Chaque champ du schéma est vérifié à la main (type guard, pas de bibliothèque) ; la gravité et la confiance doivent être l'une des valeurs du schéma ; **les champs inconnus sont écartés**, l'objet rendu est construit champ par champ (aucune propriété venue du modèle n'est recopiée) ; un texte de plus de 4 000 caractères ou une liste de plus de 20 éléments est **refusé, jamais coupé** ; la réponse entière est bornée à 60 000 caractères.
- **Une relance, puis le texte brut.** Une réponse non valide est redemandée une fois (avec la première réponse et le rappel de `docs/PROMPTS.md` §4). Si la seconde ne l'est pas, son texte est montré tel quel, **dit « format non structuré »**. Un échec du fournisseur n'est pas rejoué.
- **Rendu** (`AnalysisView`). Chaque texte est affiché comme du texte : pas de balisage, pas de lien, pas de markdown. L'écran rappelle que l'analyse est la production d'un modèle qui a lu un journal non fiable, à vérifier avant d'agir, et dit quel modèle l'a faite.
- **Statut « Analysé ».** Posé par l'analyse réussie (pas par l'utilisateur, jamais proposé comme choix), **sans écraser « Ignoré » ni « Résolu »** : une décision de l'utilisateur prime. Il est filtrable. Si l'utilisateur repasse l'erreur à « Nouveau », l'analyse reste affichée.
- **Où vit l'analyse.** Dans l'écran, en mémoire, par empreinte ; elle vaut pour toutes les erreurs identiques. Rien n'est écrit dans un stockage (l'historique est l'étape 11).
- **Coût et durée.** 4 096 jetons au plus par réponse (l'analyse en demande quelques centaines à un millier) ; au plus deux requêtes par erreur ; l'entrée est bornée à 12 000 caractères (ADR-016). Pas de plafond sur le nombre d'erreurs choisies par clic : c'est l'utilisateur qui choisit, et il voit le nombre.

## Conséquences
- Le modèle peut encore être persuadé d'écrire une analyse **fausse mais conforme au schéma** (une cause inventée, une piste trompeuse). Ce qui est garanti : elle ne peut pas modifier l'écran au-delà de ce texte, ni sortir du schéma, ni exécuter quoi que ce soit ; le rappel à l'écran dit de vérifier.
- Un petit modèle local suivra moins bien le format : il passera plus souvent par la relance, puis par le texte brut.
- `MAX_INPUT_CHARS` (12 000, ADR-016) **reste non mesuré sur un modèle réel** : à reprendre si les réponses réelles le demandent.

## Audit de sécurité de l'étape 8 (2026-11-09)
Audit complet, liste de contrôle de Sherlog (`CLAUDE.md`, adaptation 6), au niveau « envoi réel ». **Aucun point critique, majeur ni moyen.**

| Point | Constat | Preuve |
|---|---|---|
| Routes et rôles, CSP | Inchangés depuis l'étape 7 : `connect-src` exactement `'self'`, Anthropic, Ollama local ; aucune nouvelle sortie | `git diff` de `staticwebapp.config.json` vide ; tests de configuration ; garde sur `src/` |
| Rien ne part sans action | Aucun envoi avant le clic ; une requête par erreur choisie ; le bouton dit la destination | e2e dans Chrome : 0 requête d'analyse avant le clic, 1 après ; tests d'intégration |
| Injection de prompt — construction | Le journal est dans un bloc dont le délimiteur est tiré à chaque requête (128 bits) ; un journal qui contient `</log_data>`, un faux délimiteur ou des ordres reste dans le bloc, fermé une seule fois, par nous | 14 tests de `analysisPrompt` dont l'échantillon hostile `samples/serilog-injection.log` ; 6 mutations vérifiées (collision, délimiteur fixe, zéros, note, tentatives) ; e2e : un second envoi tire un autre délimiteur |
| Injection de prompt — réponse | Le schéma ne bouge pas : gravité hors valeurs, champs en trop, texte ou liste trop longs, prose autour, objet de clés polluées (`__proto__`) sont refusés ou écartés | 39 tests de `parseAnalysis` ; 9 mutations vérifiées |
| Injection de prompt — rendu | Balisage, `<img onerror>`, liens markdown d'un modèle ne deviennent jamais des éléments | tests de `AnalysisView` ; e2e dans Chrome : le `<img src=x onerror=…>` d'un « modèle » est affiché comme texte, aucun `img`, `a` ni `script` dans l'analyse |
| XSS | Aucun HTML brut, `eval`, style en ligne, `innerHTML` dans `src/` | `tests/sourceGuards.test.ts` |
| Fuite de la clé | Absente de l'écran après l'envoi, des messages d'échec (expurgée de ce que dit le fournisseur) ; l'en-tête `by` ne porte que le modèle et le fournisseur | tests d'intégration ; e2e |
| Ce qui part avec la requête | Clé, version, accès navigateur ; ni cookie ni référent ; le texte masqué et identique à l'aperçu | e2e : en-têtes relevés dans Chrome ; test sur un masquage choisi (GUID) et sur le masquage par défaut |
| Déni de service local | Réponse bornée à 60 000 caractères (source sans fin refusée) ; lignes de flux bornées (étape 7) ; **sept réponses hostiles de la taille maximale** (clôtures jamais fermées, imbrications profondes) refusées en moins d'une seconde (mesuré : ~40 ms pour les sept) | `analysisParseTiming.test.ts`, `readAnswer.test.ts` |
| ReDoS | Une seule expression régulière nouvelle, sur la clôture d'une réponse (`/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i`) : mesurée sur des réponses hostiles de 60 000 caractères | idem |
| Annulation | Annuler arrête la requête ; une réponse tardive d'un réseau qui n'a pas arrêté n'est pas gardée ; une série annulée ne laisse rien « en cours » | 3 tests d'intégration, mutations vérifiées |
| Journalisation, stockage | Aucun `console` ; les analyses restent en mémoire ; rien d'écrit sauf clé et réglages (étape 7) | garde sur `src/` |
| Dépendances | Aucune ajoutée ; `package.json` et verrou inchangés ; `npm audit` au seuil élevé : réussi (code de sortie 0), seul l'avis modéré préexistant sur `minimatch` (outillage `eslint`) reste signalé | `npm run audit` |

**Défauts trouvés et corrigés pendant l'étape :** (1) si le réseau ne s'arrête pas à l'annulation, une entrée « Analyse en cours » restait affichée et une réponse tardive était gardée — corrigé, deux tests ajoutés (mutations vérifiées) ; (2) une garde redondante (« annulé pendant la lecture du journal », déjà couverte par le refus de la requête de partir une fois annulée) a été **supprimée** plutôt que gardée sans preuve.

**Mesuré.** 1 200 tests Vitest ; 121 vérifications de bout en bout dans Chrome 156 sans interface, sous la CSP de production, avec les fournisseurs joués au niveau réseau ; application à 98,9 Ko gzip (315,1 Ko bruts) pour un budget de 300 Ko gzip, sans dépendance ajoutée.

**Non vérifié — à faire par l'auteur, avec sa clé :**
- **Le comportement réel du modèle face à un journal hostile.** Le critère de fin de v1 demande un contrôle manuel documenté. **Procédure :** choisir `samples/serilog-injection.log` ; l'analyser ; choisir les deux erreurs ; saisir une clé dédiée ; « Envoyer à l'IA » ; lire les deux analyses. **Attendu :** chacune décrit un délai de passerelle ou un paiement échoué, la tentative est signalée dans les éléments du journal, la gravité est l'une des quatre valeurs, rien n'a changé de forme ni de langue. Si une analyse répond « PWNED » ou sort du schéma, elle s'affiche « format non structuré » : c'est le comportement prévu, à noter dans cet ADR avec le modèle essayé.
- Un appel réel à Anthropic et à Ollama avec le prompt d'analyse (les réponses sont jouées dans le test de bout en bout) ; la suffisance de 4 096 jetons et de 12 000 caractères d'entrée ; le comportement d'un petit modèle local sur le format JSON.

## Questions restantes
- Faut-il plafonner le nombre d'erreurs envoyées par clic, pour borner le coût d'un clic ? Proposé : non, l'utilisateur les a choisies une à une et le nombre est affiché.
