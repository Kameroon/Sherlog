# Guide : débloquer les sources URL (10b) et Azure Monitor (10c)

Ce guide est écrit pour l'auteur du projet. Il explique, étape par étape, ce qu'il faut faire **côté Azure** pour que les deux dernières sources avancées puissent être construites, et **ce qu'il faut me donner** (très peu de choses). Le contexte et les menaces sont dans `docs/adr/ADR-020-sources-avancees-audit-de-securite.md`.

## À ne jamais me donner, ni écrire dans un fichier du dépôt
Une **clé de compte de stockage**, un **jeton SAS** (le texte après `?sig=…`), un **secret client**, un **jeton d'accès** Microsoft. Aucun de ces éléments n'est nécessaire pour que j'écrive le code : ils ne servent qu'à vous, dans le navigateur, au moment d'utiliser l'application. Ce que je demande est toujours un **nom** ou un **identifiant**, jamais un secret.

## Attention aux libellés
Je n'ai pas accès à votre portail Azure : les noms de menus ci-dessous viennent de ma connaissance du portail, **pas d'une vérification**. Microsoft les modifie. Si un libellé ne correspond pas à ce que vous voyez, dites-moi ce que vous voyez, je m'adapte.

---

## Partie A — Source URL (10b) : faite, en production

**État (2026-11-18) :** le compte `sherlogjournaux` existe, la source est en production et a été essayée par l'auteur sur le site en ligne (ADR-023). Pour s'en servir : générez un lien SAS en lecture seule, de courte durée, **HTTPS uniquement**, sur un fichier d'essai du conteneur `journaux` (portail → le fichier → « Générer une signature d'accès partagé »), collez-le dans le champ « Adresse du fichier », puis « Télécharger et lire ce journal ». Ne m'envoyez pas ce lien. Les étapes ci-dessous sont celles qui ont permis de créer le compte ; elles servent si un autre compte doit être ajouté (modification de la CSP et du code, puis redéploiement).

**Ce qu'il me faut à la fin :** le **nom exact de chaque compte de stockage** autorisé (par exemple `monentreprisejournaux`), rien d'autre.

**Pourquoi seulement des comptes précis :** l'application ne pourra contacter que les adresses écrites dans sa configuration. Je n'accepte pas de joker (`*.blob.core.windows.net`), car il autoriserait n'importe quel compte de stockage du monde comme destination (ADR-020, constat T1). Ajouter un compte plus tard demande une modification de la configuration et un redéploiement.

### Étapes
1. **Choisissez le compte de stockage** qui contient (ou contiendra) vos journaux. Dans le portail Azure : « Comptes de stockage ». Le **nom du compte** est visible dans la liste ; l'adresse de ses blobs est `https://<nom>.blob.core.windows.net`.
2. **Déposez un journal d'essai** dans un conteneur **privé** (laissez l'accès anonyme désactivé).
3. **Autorisez le site à lire ce compte (CORS).** Sans cela, le navigateur bloque la lecture. Dans le compte : Paramètres → « Partage de ressources (CORS) » → onglet **Blob service** → ajoutez une règle :
   - origines autorisées : `https://mango-plant-0313ba703.4.azurestaticapps.net` (l'adresse de production, exactement) ;
   - méthodes autorisées : `GET`, `HEAD`, `OPTIONS` ;
   - en-têtes autorisés : `*` ; en-têtes exposés : `*` ;
   - âge maximal : `3600`.
4. **Fabriquez, à l'usage, un lien de lecture limité** (pas pour moi) : ouvrez le blob → « Générer une SAP » → permissions **Lecture** seule ; une **durée courte** (une heure suffit) ; **HTTPS** uniquement → copiez l'**URL du blob avec son jeton**. Vous la collerez dans l'application le jour où la source existera ; elle ne sera jamais affichée après saisie, ni stockée.
5. **Donnez-moi le(s) nom(s) de compte**, sans le lien, sans clé.

Pour un compte de plus : écrire son nom exact dans `ALLOWED_STORAGE_HOSTS` (`src/sources/urlSource.ts`) et dans la CSP (un test garde les deux égaux), ajouter sa règle CORS, puis redéployer.

---

## Partie B — Azure Monitor (10c) : à faire après 3b

**Ordre obligatoire :** l'étape **3b** (profil structuré) doit être faite **avant** 10c, parce que l'API d'Azure Monitor renvoie des **tableaux** (colonnes et lignes) que le parseur de texte ne sait pas lire. 3b a besoin d'un **export réel** : je ne devine aucun nom de colonne.

**Ce qu'il me faut à la fin :** un **export réel** (étape B1), et **trois identifiants non secrets** (étapes B2 et B3).

### B1 — Un export réel (nécessaire à 3b, avant tout)
1. Dans le portail : votre **Application Insights** ou votre **espace de travail Log Analytics** → **Journaux**.
2. Lancez une requête qui ramène quelques erreurs. Les noms de tables dépendent de votre configuration, **à vérifier chez vous** : pour une ressource Application Insights basée sur un espace de travail, ce sont en général `AppTraces` et `AppExceptions` ; pour une ressource classique, `traces` et `exceptions`. Exemple (à adapter) : `AppTraces | where SeverityLevel >= 3 | order by TimeGenerated desc | take 200`.
3. Menu **Exporter** → **CSV**. Si vous pouvez aussi me donner le **JSON** renvoyé par l'API, c'est un plus, mais le CSV suffit.
4. **Relisez le fichier avant de me le donner** : il peut contenir des adresses e-mail, des adresses IP, des jetons, des noms de personnes. Remplacez-les, ou choisissez une période sans données sensibles. Dites-moi aussi **si le dépôt GitHub est public** : un fichier placé dans `samples/` y devient visible.

### B2 — L'espace de travail
5. Ouvrez l'**espace de travail Log Analytics** → « Vue d'ensemble » → copiez l'**ID de l'espace de travail** (non secret).
6. Vérifiez que **votre compte** a un rôle de lecture sur cet espace (par exemple « Lecteur » ou « Lecteur Log Analytics »). Sans cela, l'API refuse la lecture, même avec une application bien configurée.

### B3 — L'enregistrement de l'application dans Microsoft Entra (gratuit)
7. Portail Azure → **Microsoft Entra ID** → **Inscriptions d'applications** → **Nouvelle inscription**.
8. **Nom** : `Sherlog` (ou ce que vous voulez). **Types de comptes pris en charge** : « Comptes dans cet annuaire organisationnel uniquement » (**un seul locataire** : le vôtre ; je ne veux pas d'une application ouverte à tous les locataires, ADR-020 M3).
9. **URI de redirection** : plateforme **« Application à page unique (SPA) »**, valeur **exacte** `https://mango-plant-0313ba703.4.azurestaticapps.net/` (production seulement : les adresses de prévisualisation changent à chaque pull request, et aucun joker n'est accepté).
10. Une fois créée : **Autorisations d'API** → **Ajouter une autorisation** → « API utilisées par mon organisation » → **Log Analytics API** → **Autorisations déléguées** → **Data.Read** → Ajouter. Selon votre locataire, un **consentement administrateur** peut être demandé.
11. **Ne créez aucun secret client.** Une application à page unique n'en a pas, et il n'en faut aucun.
12. Sur la page de l'application, copiez deux identifiants (non secrets) : l'**ID d'application (client)** et l'**ID de l'annuaire (locataire)**.

### B4 — Ce que vous me donnez pour 10c
- l'**export réel** (B1) ;
- l'**ID de l'espace de travail** (B2) ;
- l'**ID d'application (client)** et l'**ID de l'annuaire (locataire)** (B3).

### Ce qu'on fera ensemble après
- 3b (profil structuré sur votre export), validé par vous ;
- puis 10c : connexion par **fenêtre contextuelle** (pas de renouvellement silencieux, donc pas de directive de plus dans la CSP), jeton **en mémoire seulement**, requêtes construites à partir de champs validés ; un **essai réel avec vous** (je ne peux pas me connecter à votre compte Microsoft : ce test est le vôtre) ; audit du code contre l'ADR-020.

## Récapitulatif de ce que vous me donnez
| Pour | Vous me donnez | Vous ne donnez jamais |
|---|---|---|
| 10b | le nom de chaque compte de stockage | clé du compte, lien SAS |
| 3b puis 10c | un export réel (CSV), l'ID de l'espace de travail, l'ID d'application, l'ID du locataire | secret client, jeton, mot de passe |
