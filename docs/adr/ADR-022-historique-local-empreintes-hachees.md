# ADR-022 : Historique local — empreintes hachées, statuts et analyses (étape 11)

## Statut
Proposé — 2026-11-15. L'option A a été choisie par l'auteur le 2026-11-15 ; l'ADR sera accepté quand les tranches T1 à T4 seront validées, avec les seuils mesurés reportés dans « Seuils ».

## Contexte
`SPEC.md` §2 posait : « historique optionnel, local au navigateur (IndexedDB), export/import JSON ; jamais de log brut non masqué : contenu masqué, ou seulement empreintes + statuts + analyses (à trancher à l'étape 11) ».
Aujourd'hui statuts, analyses et chats vivent en mémoire de session et disparaissent au rechargement. L'intérêt de l'historique est de **reconnaître une erreur déjà vue** quand elle réapparaît dans un nouveau journal, avec son statut et son analyse.

Trois constats pèsent sur la décision :
1. L'**empreinte n'est pas du texte masqué** : c'est le message normalisé (jusqu'à 1 000 caractères). Seuls les GUID, nombres, e-mails, IP, etc. sont remplacés ; des noms ou des identifiants métier peuvent y rester (`SPEC.md` §5). La stocker telle quelle reviendrait à stocker du journal non masqué.
2. Les identifiants d'empreinte de la session sont des **entiers locaux** : ils ne peuvent pas servir de clé d'un historique.
3. `folderStore` ouvre la base IndexedDB `sherlog` en version 1 et n'y crée que le magasin `folders` (ADR-021) ; un second magasin impose une nouvelle version et **une seule ouverture partagée**.

## Décision (option A, choisie par l'auteur)
- **Ce qui est conservé**, par erreur distincte et par identité : la **clé** (SHA-256 de l'empreinte, en hexadécimal), le **statut** (Analysé, Ignoré, Résolu ; « Nouveau » n'est pas un état à conserver), la date de dernière mise à jour et, s'il existe, **l'analyse du modèle** avec sa date et le modèle qui l'a produite.
- **Ce qui n'est jamais conservé** : le texte du journal, l'empreinte en clair, les lignes voisines, les noms de fichiers, la **clé de l'IA**, et les **chats** (questions libres de l'utilisateur : risque de fuite sans bénéfice prouvé, YAGNI).
- **Hachage** dans la couche `store`, avec `crypto.subtle` : `core` reste du TypeScript pur sans API Web (ADR-003). Sans `crypto.subtle` (contexte non sécurisé), l'historique est indisponible et l'écran le dit.
- **Pas de sel** : la clé doit rester la même d'un navigateur à l'autre pour que l'export/import retrouve les erreurs. Le hachage protège contre une lecture directe, **pas contre une attaque par dictionnaire** : qui a accès au stockage et soupçonne un message précis peut vérifier qu'il s'y trouve ; il ne peut pas lire un message qu'il ne connaît pas.
- **Facultatif, désactivé par défaut.** Un interrupteur explicite l'active ; tant qu'il est éteint, rien n'est écrit. « Tout effacer » et la suppression d'une entrée sont toujours disponibles. L'activation est un réglage **par identité**, gardé avec l'historique (donc effacé avec lui).
- **Cloisonné par identité**, comme la clé (ADR-017) et le dossier (ADR-021) : chaque identité ne voit, n'exporte et n'efface que le sien ; sans identité lue, pas d'historique et l'écran le dit.
- **Reconnaissance** : à la lecture d'un nouveau journal, une erreur dont la clé est connue est signalée « déjà vue » avec son statut, sa date et le résumé de l'analyse. **Rien n'est envoyé au modèle** pour cela.
- **Plein, jamais tronqué en silence** : au plafond du nombre d'entrées, l'écriture d'une nouvelle entrée est refusée avec un message visible (supprimer ou tout effacer) ; aucune entrée n'est écartée sans que l'utilisateur le sache.
- **Échecs dits** : stockage refusé (quota, navigation privée), lecture impossible : message visible, l'application reste utilisable, aucune erreur avalée.
- **Migration IndexedDB** : la base passe en version 2 avec un module d'ouverture unique qui crée les deux magasins (`folders` conservé, `history` ajouté) ; un test part d'une base en version 1 qui contient un dossier retenu et vérifie qu'il est retrouvé.
- **Export/import JSON** (T4) : fichier versionné (`format`, `version`), contenant exactement les champs ci-dessus, avec l'avertissement que **l'export contient des analyses**. L'import est une **entrée non fiable** :
  - validation champ par champ (l'analyse par la même validation que `parseAnalysis`), plafonds de taille et de nombre d'entrées ;
  - **atomique** : un seul enregistrement invalide refuse tout le fichier, avec le motif, et l'historique existant reste intact ;
  - dates postérieures à demain refusées (un fichier ne doit pas pouvoir gagner toutes les fusions) ;
  - **fusion** : par clé, l'entrée à la date la plus récente gagne ; rendu en texte seul, jamais de HTML.

## Menaces et contrôles
| # | Menace | Contrôle | Preuve prévue |
|---|---|---|---|
| H1 | Du journal non masqué finit dans le stockage ou l'export | Seuls les champs listés sont écrits (liste fermée, pas de copie d'objet) | test : contenu complet du magasin et d'un export relu, aucun texte du journal ni clé IA ; mutation |
| H2 | La clé IA entre dans l'historique | Elle n'est ni lue ni passée à la couche | test + garde sur `src/` |
| H3 | Une identité lit l'historique d'une autre | Clé de stockage préfixée par l'identité ; recherche limitée à elle | test à deux identités ; mutation |
| H4 | Fichier d'import hostile (hors schéma, énorme, HTML, dates futures) | Validation atomique, plafonds, texte seul | tests d'import hostile ; mutations |
| H5 | Écriture sans consentement | Désactivé par défaut ; rien écrit tant que l'interrupteur est éteint | test : aucune écriture IndexedDB |
| H6 | Perte du dossier retenu au passage en version 2 | Ouverture partagée, migration testée | test de migration depuis la version 1 |
| H7 | Script injecté (XSS) lisant le stockage | CSP stricte, aucun HTML brut ; même ordre de risque que la clé (ADR-017) | risque résiduel accepté |

## Risques résiduels acceptés
- **Les analyses conservées peuvent citer des fragments du journal.** Le modèle a reçu du texte masqué, mais ses champs (`summary`, `evidence`…) peuvent en reprendre des morceaux ; le masquage étant un meilleur effort (ADR-015), un fragment sensible non masqué peut y survivre. C'est le coût de l'option A, que l'auteur a choisie : « rien de lisible hors analyses ». L'écran d'activation et l'avertissement d'export le disent.
- Attaque par dictionnaire sur les clés hachées (voir « Pas de sel »).

## Options écartées
- **B — texte masqué lisible** : permettrait de tout lister, mais conserve du texte que le masquage « au mieux » peut laisser sensible. Écartée par l'auteur.
- **Hachage salé par appareil** : casserait l'export/import entre navigateurs.
- **Bibliothèque IndexedDB** : inutile, `folderStore` montre que le besoin tient en quelques fonctions (KISS).
- **Conserver les chats** : risque de fuite sans besoin prouvé.

## Seuils
Le nombre maximal d'entrées et la taille maximale d'un fichier d'import ne sont pas posés à l'avance : ils seront **mesurés** (taille d'une analyse maximale d'après `MAX_TEXT_CHARS` et `MAX_LIST_ITEMS`, durée d'écriture et d'import sur un jeu généré) en T1 et T4, puis reportés ici.

## Conséquences
- `core/history` (T1) : types, validation, fusion, plafonds, sans API Web.
- `store/historyStore` et module d'ouverture partagé avec `folderStore` (T2).
- Une garde sur `src/` : `indexedDB` reste confiné aux modules du `store` ; la clé IA n'est jamais importée par l'historique.
- La ligne 11 de la feuille de route reste ouverte tant que 3b, 10b et 10c ne sont pas livrées : l'audit global de T7 ne peut porter que sur l'existant.
