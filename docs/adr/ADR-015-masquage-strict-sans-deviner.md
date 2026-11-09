# ADR-015 : Masquage par règles strictes, qui ne devinent pas

## Statut
Proposé — 2026-11-09, tranches 1 (le cœur `redact`) et 2 (l'outil « Masquer » de la préparation) de l'étape 6 faites. Passera à « Accepté » avec la validation de l'étape par l'auteur.

## Contexte
Rien ne doit partir vers un fournisseur IA sans avoir été masqué (`SPEC.md` §6). Le masquage par motifs se trompe dans deux sens : il **masque ce qui n'est pas sensible** (faux positif : un numéro de version pris pour une adresse IP, un nom de fichier pris pour un e-mail) ou **laisse passer ce qui l'est** (faux négatif). L'auteur a demandé le 2026-11-09 : « pas de faux positif nulle part, dans aucun de mes projets », en validant que le masquage s'applique aussi aux lignes autour de l'erreur (ADR-013, conséquences).

Une garantie de zéro faux positif n'existe pas pour une règle qui juge un texte sur sa forme seule : `1.2.3.4` est une adresse ou une version selon ce qui l'entoure, et rien dans le texte ne le dit toujours. Ce qui est possible, et qui est décidé ici, c'est de **ne jamais deviner** : une règle qui ne peut pas trancher par la forme demande un contexte, un contrôle ou est laissée de côté, et chaque garde-fou est prouvé par un test qui échoue s'il disparaît.

## Décision
- **`src/core/redact.ts`, fonctions pures.** `redact(texte, règles)` remplace ce que trouvent les règles actives par une étiquette (`[EMAIL]`, `[SECRET]`, `[IP]`, `[CARD]`, `[GUID]`, `[HOST]`) ; `countOccurrences(texte)` compte, règle par règle, ce que chacune trouverait (options comprises), pour que l'utilisateur voie ce qu'une case masquerait avant de la cocher. Un texte sans correspondance revient identique.
- **Six règles, quatre cochées d'office** (e-mails, jetons / clés / mots de passe, adresses IP, cartes probables) ; **GUID et noms d'hôte dans les adresses web sont des options décochées** (`SPEC.md` §6, règles nouvelles validées ici).
- **Une règle exige ce que la forme ne donne pas.**
  - *E-mail* : domaine avec fin en lettres ; `icon@2x.png`, `Shop.Core@1.4.dll` et les fins de nom de fichier courantes sont laissés.
  - *IP* : IPv4 aux quatre champs de 0 à 255 sans zéro de tête, qui n'est ni précédée d'un mot `version`, `build`, `release`… ni collée à un autre nombre pointé ; 127.x et 0.0.0.0 ne désignent aucune machine de l'utilisateur et sont laissées ; IPv6 seulement écrite avec ses huit groupes (une heure `12:05:38` ou un nom `Dead::Beef` ne peuvent pas en avoir huit).
  - *Secrets* : motifs à préfixe sans ambiguïté (JWT `eyJ….eyJ….…`, `sk-`, `AKIA`, `ghp_`) ; valeur d'un en-tête `Authorization` ; `Bearer` hors en-tête seulement avec un chiffre dans la valeur (`Bearer AuthenticationHandler` est un nom de classe) ; `clé=valeur` seulement avec `=` (ou JSON entre guillemets), **jamais** après un deux-points en prose (« Password: incorrect »), valeur d'au moins 4 caractères, sans valeur vide, `null`, booléenne, d'étoiles, de gabarit (`{…}`, `%s`) ni déjà masquée ; `token` seul n'est pas reconnu dans `maxToken` ni `tokenCount`.
  - *Carte* : 13 à 19 chiffres, début de numéro d'un émetteur connu, contrôle de Luhn, et **écrite par groupes** ou **donnée après un nom** (`card=`, `cardNumber=`, `pan=`) : un long nombre seul est un identifiant, pas une carte.
  - *GUID* : versions 1 à 8 et variante RFC 4122, ni le GUID nul, ni des groupes hexadécimaux qui n'en sont pas.
  - *Nom d'hôte* : seulement dans l'adresse d'un `http://` ou `https://` ; `localhost`, les adresses IP et les noms réservés aux exemples (RFC 2606) sont laissés.
- **`redact` reste le dernier filet** : `rulesForSending(choix)` ajoute toujours les règles cochées d'office à celles que l'utilisateur a choisies. Décocher une case dans la préparation ne laisse donc pas partir une adresse ou une clé (`SPEC.md` §6).
- **Recouvrements** : le texte qui commence le plus tôt gagne, le plus long à égalité ; un texte que deux règles trouvent est remplacé une fois. Chaque règle compte à part (un mot de passe d'adresse compte pour « secret » et, si elle le voit, pour « e-mail »).
- **Pas de ReDoS** : chaque motif commence après une assertion qui interdit ses propres caractères (sans elle le moteur retente depuis chaque position d'une longue suite : durée au carré), toutes les répétitions sont bornées, et douze entrées hostiles (200 000 caractères d'une même famille, motifs répétés) ont un test de durée.
- **Étiquette sans numéro** (`[EMAIL]`, pas `[EMAIL_1]`) : deux adresses différentes donnent la même étiquette. Plus simple, au prix de ne pas montrer au modèle que deux erreurs concernent le même utilisateur.

## Outil « Masquer » (tranche 2)
- **Une carte par règle** sous les trois autres réglages, sur toute la largeur : case, étiquette, nombre d'occurrences trouvées (même quand la règle est décochée, pour voir ce qu'une case masquerait), description de ce que la règle laisse. Les options (GUID, hôte) sont dites « option » et décochées.
- **L'état du masquage vit à côté de la préparation, pas dedans** (`ScanState.masking`, remis aux règles par défaut à chaque nouveau journal). Il ne rend donc pas le résultat obsolète : masquer change ce qui est montré et envoyé, pas quelles erreurs il y a.
- **Aperçu masqué avant d'être coupé** : une ligne est masquée en entier puis tronquée à 300 caractères, pour qu'un secret à cheval sur la coupure ne soit pas montré en partie ; `PreviewLine.text` est ce qui s'affiche, `originalText` le texte du journal.
- **Texte d'origine à la demande** : un bouton à bascule (`aria-pressed`) le montre dans l'aperçu ; il reste dans le composant (état local), il disparaît en quittant la préparation et n'est ni envoyé ni gardé.
- **Compteur « données masquées »** (quatrième compteur, seulement s'il y en a) et nombres par règle : calculés sur les entrées gardées du début du fichier (1 Mio), et dits « dans le début » tant que le fichier n'est pas lu en entier. Ils ne portent pas sur tout le fichier : l'envoi masque de toute façon le texte exact qui part (tranche 3).
- **Avertissement** quand aucune case n'est cochée : le texte est montré tel quel, et les e-mails, secrets, adresses IP et cartes seront tout de même masqués à l'envoi (`rulesForSending`).
- **Coût** : les occurrences de chaque règle sont comptées **une fois par entrée à la lecture du début du fichier** (`ParsedHead.occurrencesByEntry`) ; changer une règle « Ignorer » ou la période ne fait que sommer ces comptes, et `redact` n'est rejoué que sur les entrées où une règle active a trouvé quelque chose.

## Raisons
- Un faux négatif laisse partir un secret, un faux positif retire une information utile au diagnostic : les règles qui cachent des secrets sont strictes **et** cochées d'office, les identifiants qui aident à suivre une requête (GUID, hôte) sont des options.
- Vérifier les garde-fous un par un par mutation (retirer le garde-fou, constater qu'un test échoue) est ce qui remplace une garantie impossible.

## Alternatives écartées
- **Masquer large puis laisser l'utilisateur corriger** : contraire à la consigne de l'auteur.
- **Règle d'hôte par forme** (tout ce qui ressemble à `a.b.c`) : `System.Net.Http.HttpClient`, `report.final.csv` et `Microsoft.Extensions.Logging` en sont ; elle ne peut pas éviter les faux positifs, donc seule l'adresse web est ciblée.
- **IPv6 abrégée** (`::1`, `fe80::1`) : indiscernable d'un nom de portée `A::B` ; non reconnue, dite à l'écran.
- **Liste de termes saisis par l'utilisateur** (zéro faux positif par construction) : non retenue pour l'instant (YAGNI) ; possible si un besoin réel apparaît.

## Conséquences
- **Faux négatifs connus** (dits dans les descriptions des règles et à l'écran) : IPv6 abrégée ; numéro de carte écrit d'une traite sans nom devant ; mot de passe de moins de 4 caractères, ou qui contient un espace, un point-virgule ou une esperluette ; secret écrit en prose ; nom de clé en français (`mot_de_passe=`, `mdp=`) ; GUID qui n'a pas une version 1 à 8 et la variante RFC 4122 (certains identifiants COM) ; noms, adresses postales, numéros de téléphone et autres données personnelles : aucune règle ne les voit.
- **Faux positifs possibles malgré tout** : un texte qui a la forme exacte d'une règle et son contexte (par exemple `password=Abcd1234` qui n'est pas un mot de passe, une adresse e-mail d'exemple). L'aperçu de ce qui est envoyé et le texte d'origine à la demande restent le contrôle.
- Les règles sont mesurées sur cinq échantillons (dont deux extraits réels qu'elles ne modifient pas) : leur fidélité à d'autres journaux n'est pas prouvée.

## Mesuré et non vérifié
**Mesuré** (Node, Vitest, `tests/redact.test.ts`, 96 vérifications) : les deux extraits réels (`real-serilog.log`, `real-mixed-formats.log`) sortent identiques avec les règles par défaut ; `sample.log` change deux lignes (mot de passe, e-mail), `serilog-pieges.log` quatre valeurs (deux e-mails, deux adresses IP), `serilog-realistic.log` le jeton `Authorization` seulement. Dix-neuf entrées hostiles traitées par les six règles et le comptage, mesurées à part, en 12 à 88 ms chacune (200 000 caractères d'une même famille, motifs répétés), dont douze ont un test de durée ; un mégaoctet de lignes ordinaires sous la limite de 1,5 s fixée au test. Onze garde-fous retirés un à un : chacun fait échouer au moins un test.

**Mesuré, tranche 2** (Node, 1 Mio de lignes denses où chaque entrée contient une adresse e-mail et une adresse IP) : lecture du début 218 ms (49 ms avant le comptage, une fois par choix de journal ou de format), recalcul de l'aperçu 10 ms à un changement de période, 130 ms à une case de masquage cochée dans le pire cas. Chrome 156 sans interface, `npm run e2e` (73 vérifications) sur `sample.log` : le mot de passe et l'e-mail sont remplacés dans l'aperçu, le compteur dit 2 données masquées, le GUID est gardé tant que l'option n'est pas cochée, le texte d'origine s'affiche sur demande ; console sans erreur.

**Non vérifié :** des journaux réels autres que les deux extraits ; des journaux hors .NET et hors anglais ; des caractères Unicode d'apparence voisine (chiffres pleine chasse, par exemple) ; la durée sur un navigateur lent.
