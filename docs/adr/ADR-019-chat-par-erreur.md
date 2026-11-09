# ADR-019 : Chat par erreur

## Statut
Proposé — 2026-11-09, en attente de la validation de l'étape 9 par l'auteur. Suite de l'ADR-018 (prompt durci) et de l'ADR-017 (fournisseurs et clé).

## Contexte
L'étape 9 ajoute la conversation avec le modèle à propos d'une erreur (`SPEC.md` §3, partie 2). Elle réemploie ce que l'étape 8 a posé : le journal est une donnée non fiable, il part masqué, entre des délimiteurs aléatoires, et ce que dit le modèle s'affiche comme du texte. Le chat ajoute ce que l'analyse n'avait pas : **du texte libre venu de l'utilisateur**, et **une conversation qui est renvoyée entière à chaque question**. Décision de l'auteur du 2026-11-09 : « le chat doit démarrer après le clic sur le bouton "Analyser ce journal" ».

## Décision
- **Quand.** Le chat est ouvert pour l'erreur sélectionnée **dès que « Analyser ce journal » a trouvé des erreurs** : il n'attend ni une analyse du modèle ni un envoi préalable. Il lui faut seulement un fournisseur utilisable (ADR-017) ; sinon l'écran dit quoi faire. Interprétation de la décision de l'auteur, signalée dans le compte rendu : « démarrer » veut dire « être disponible », pas « envoyer quelque chose » : **rien ne part avant le clic sur « Envoyer la question »**.
- **Rattaché à une erreur, pas global** (`SPEC.md`). Une conversation par empreinte, donc partagée par les erreurs identiques ; en mémoire seulement (l'historique est l'étape 11) ; effaçable.
- **Contexte** (`src/ai/chatPrompt.ts`). Texte de l'occurrence la plus récente (`buildSendPayload` : masqué puis coupé, même fonction que l'aperçu) **plus l'analyse du modèle si elle existe**, dans le bloc de données : l'analyse a été produite par un modèle qui a lu le journal, elle n'est pas plus fiable que lui. Il est **fixé au premier message** de la conversation : il ne change pas si une analyse arrive entre-temps. L'écran le montre à la demande avant la première question (« Voir le contexte envoyé avec la première question »).
- **Délimiteur neuf à chaque requête.** Toute la conversation est renvoyée à chaque question : le contexte est donc **réemballé** à chaque fois, entre `<log_data_NONCE>` et `</log_data_NONCE>` avec un NONCE (128 bits) tiré pour cette requête, le même dans le prompt système. Le contexte n'est que dans le premier message, suivi de la première question ; les autres messages sont hors du bloc. Un délimiteur que le contexte ou l'analyse contiendrait par hasard est écarté (cinq essais, sinon aucune requête).
- **Les questions de l'utilisateur sont masquées.** Le texte libre peut contenir ce que l'utilisateur colle d'un journal : il passe par `redact` avec les règles choisies et toujours celles cochées d'office, **dans le hook, pas dans l'écran** (l'écran ne peut pas l'oublier). L'écran dit avant l'envoi combien de données seront masquées, et la conversation montre le texte tel qu'il est parti.
- **Réponse en continu, en texte.** Affichée au fil de l'écriture, comme du texte (ni balisage, ni lien, ni markdown). Seuls le début et la fin sont annoncés aux lecteurs d'écran, pas chaque morceau.
- **Arrêt et échecs.** « Arrêter la réponse » coupe la requête ; une réponse tardive n'est pas gardée. Une question qui n'a pas de réponse (échec, arrêt, réponse vide, interrompue) **laisse la conversation comme elle était** et rend la question, avec « Réessayer » ; le message est celui des échecs de l'étape 7 (clé jamais montrée). Une seule réponse à la fois.
- **Bornes, jamais de coupe silencieuse.** Une question : 4 000 caractères. Une requête entière (consignes, contexte, conversation, nouvelle question) : 60 000 caractères ; au-delà, l'écran dit que **la conversation est trop longue** et propose de l'effacer, plutôt que de la tronquer. Une réponse : 60 000 caractères (comme l'analyse).
- **Lecture partagée.** `readPayload` (lecture du texte à envoyer) est commune à l'analyse et au chat ; `ExactText` (l'aperçu du texte exact) l'est au panneau d'envoi et au chat : ce qui est montré est construit par la même fonction que ce qui part.
- **Pas d'onglets.** Le chat est une section du détail de l'erreur, sous l'analyse : les onglets de `ARCHITECTURE.md` n'apportent rien tant qu'il n'y a que deux contenus empilés (YAGNI).

## Conséquences
- **Coût qui croît** : chaque question renvoie toute la conversation (jusqu'à 60 000 caractères, environ 15 000 jetons). Le message « conversation trop longue » est la borne ; l'écran dit que chaque message part « avec toute la conversation ».
- Changer de fournisseur en cours de conversation envoie l'historique au nouveau : la destination de chaque message est affichée avant le clic.
- Les réponses précédentes du modèle sont renvoyées telles qu'elles sont venues (rôle assistant, hors du bloc) : elles peuvent reprendre ce que le journal a fait écrire. Le risque est celui de toute conversation avec un modèle ; l'effet reste limité à du texte affiché comme du texte.
- La suffisance de 60 000 caractères et le comportement d'un petit modèle local sur plusieurs tours ne sont pas mesurés.

## Revue de sécurité de l'étape 9 (2026-11-09, revue plus légère que celle des étapes 7 et 8)
**Aucun point critique, majeur ni moyen.**

| Point | Constat | Preuve |
|---|---|---|
| Rien ne part sans action | Taper, ouvrir le contexte, changer d'erreur n'envoie rien ; seul « Envoyer la question » envoie | 26 tests d'intégration ; e2e dans Chrome : 0 requête avant le clic |
| Texte libre de l'utilisateur | Masqué avant l'envoi (règles choisies + règles d'office), dans le hook ; ce qui est montré est ce qui est parti | test (e-mail dans la question) ; mutation vérifiée ; e2e : `jane.doe@…` absent de la requête et de l'écran |
| Injection de prompt | Contexte et analyse dans un bloc à délimiteur tiré par requête ; un journal ou une analyse qui ferme le bloc reste dans le bloc ; collision tirée à nouveau ; sans délimiteur sûr, aucune requête | 15 tests de `chatPrompt` (dont l'échantillon hostile), 6 mutations vérifiées ; e2e : délimiteur différent à la seconde requête |
| Rendu | Réponse affichée comme du texte : `<img onerror>`, `<b>`, liens markdown restent du texte | test ; e2e : `<b>gras</b>` écrit par un « modèle » reste du texte |
| Fuite de la clé | Absente de l'écran, des échecs et de la conversation | tests ; e2e |
| Mémoire et durée | Réponse bornée (60 000), requête bornée (60 000), question bornée (4 000) ; une réponse à la fois ; annulation vérifiée, réponse tardive non gardée | 11 mutations vérifiées sur le hook et le panneau |
| Réseau, console, stockage, HTML brut | Inchangés : un seul module envoie (`ai/request.ts`), rien dans la console, rien écrit dans un stockage (la conversation est en mémoire) | `tests/sourceGuards.test.ts` |
| CSP, routes, dépendances | Inchangées ; aucune dépendance ajoutée | `git diff` ; `npm audit` |

**Défauts trouvés par les tests et corrigés pendant l'étape :** (1) le bouton « Réessayer » aurait pu renvoyer une question vide si la question gardée avait été perdue — test ajouté ; (2) le contexte était reconstruit à chaque question, donc une analyse arrivée entre-temps l'aurait modifié — figé, test ajouté.

**Mesuré.** 1 245 tests Vitest ; 137 vérifications de bout en bout dans Chrome sous la CSP de production (fournisseurs joués au niveau réseau) ; application à 101,3 Ko gzip (324 Ko bruts) pour un budget de 300 Ko gzip, sans dépendance ajoutée.

**Non vérifié.** Une vraie conversation avec Anthropic ou Ollama (réponses jouées dans les tests de bout en bout) ; le comportement d'un petit modèle local sur plusieurs tours ; Edge, Firefox et Safari ; la lisibilité au lecteur d'écran de la diffusion de la réponse (annonces prévues, non essayées avec un lecteur réel).

## Questions restantes
- Faut-il proposer d'exporter la conversation ? Non demandé ; l'historique et l'export sont l'étape 11.
