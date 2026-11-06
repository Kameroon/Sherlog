# ADR-006 : Contrôle d'accès par l'authentification intégrée de Static Web Apps et rôle `invited`

## Statut
Accepté — 2026-11-06 (étape 0 validée). Résultats et deux vérifications restantes : section « Vérification » ci-dessous.

## Contexte
L'application ne détient ni donnée ni secret côté serveur. La menace visée est celle de développeurs ou testeurs acharnés qui solliciteraient l'outil : l'auteur veut contrôler qui peut le charger.
Le plan Free offre l'authentification GitHub et Microsoft préconfigurée et 25 rôles par invitation.

## Décision
Les routes de `staticwebapp.config.json` n'autorisent que le rôle `invited` (sauf les pages publiques `/login/*` et `/forbidden/*`). Le contrôle est appliqué par Azure **avant** de servir l'application ;
le code client ne vérifie rien. L'identité affichée (`/.auth/me`) est purement informative.
Les invitations se font par nom d'utilisateur (GitHub) ou adresse e-mail (Microsoft), valables 168 heures au plus.

## Raisons
- Une vérification côté client serait contournable ; la configuration de la plateforme ne l'est pas.
- Aucun backend ni fournisseur d'identité personnalisé nécessaire.

## Conséquences
- Limite : sans backend, aucun plafonnement de débit ; l'invitation filtre qui charge l'application, rien de plus.
- 25 invitations au maximum sur Free. Retirer puis réinviter une personne change son `userId`.
- Pas de `navigationFallback` (les règles de route ne s'appliquent pas aux requêtes qui le déclenchent).
- **Repli décidé** : si les invitations ne sont pas viables sur Free, l'application est mise en ligne publiquement, sans connexion, ni identité ni historique par identité. Risque accepté par l'auteur malgré la menace visée.
- Alternative rejetée : plan Standard payant (contredit le coût nul).

## Vérification (étape 0)
Faite le 2026-11-06 sur l'environnement de prévisualisation de la pull request n°1 (`curl`, anonyme) :

| Vérification | Résultat |
|---|---|
| `/`, chemin inexistant, `/assets/*.js`, `/assets/*.css`, `/index.html`, `/staticwebapp.config.json` | 302 vers `/login/` : aucun fichier de l'application ni `index.html` n'est servi |
| `/login/`, `/login` et `/login/login.css` | 200, pas de boucle de redirection |
| `/forbidden/` en anonyme | 302 vers `/login/` |
| En-têtes sur `/login/` | CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` présents |
| `/.auth/me` en anonyme | 200, `{"clientPrincipal": null}` |
| Protection de la prévisualisation | **Les règles de routes s'y appliquent** (malgré la mise en garde de la documentation Microsoft) |

Avec le navigateur, sur la prévisualisation : un compte GitHub connecté mais **non invité** voit la page « Accès refusé » (403 maîtrisé) et non la page Azure par défaut.

**Constat sur les invitations (important pour la suite) :** la signature d'un lien d'invitation est liée au domaine pour lequel il a été créé, et Azure n'accepte que le domaine par défaut de l'application
(`--domain` avec l'hôte d'une prévisualisation est refusé : « domain object is not present »). Tant que l'environnement de production n'a rien de déployé, ses routes `/.auth/*` renvoient 404 (le lien est donc inutilisable)
et le même lien sur l'hôte de prévisualisation renvoie 400. **Conséquence : la première invitation exige que la production soit déployée ; le chemin « invité » ne se teste pas sur le staging.**
Les rôles sont propres à l'application : une fois invité via la production, le compte l'est aussi sur les prévisualisations (nouvelle connexion nécessaire sur chaque domaine).

**Production déployée (après la fusion de la pull request n°1) :**
- Anonyme : mêmes résultats que sur la prévisualisation ; `/.auth/*` répond désormais.
- Accès après invitation (compte GitHub invité avec le rôle `invited`, via un lien créé pour le domaine de production) : constaté par captures d'écran de l'auteur — l'application s'affiche avec l'identité « Kameroon via GitHub » et le lien « Se déconnecter ».
- Redirections relatives : `post_login_redirect_uri=/` ramène bien sur l'application après connexion ; `post_logout_redirect_uri=/login/` ramène bien sur la page de connexion après déconnexion.

**Go/no-go de l'étape 0 :** invitations viables sur le plan Free (oui) ; prévisualisations exploitables comme staging et protégées par la configuration (oui). Le repli en application publique n'est pas nécessaire.

**Non vérifié (à ne pas supposer) :**
- L'accès refusé **après retrait de l'invitation** n'a pas été testé : le test aurait retiré à l'auteur l'accès à sa propre application (un seul compte). À faire avant d'ouvrir l'application à d'autres personnes.
- Le **code de statut** du 403 servi avec `rewrite` n'a pas été mesuré (la page s'affiche correctement ; l'émulateur local ne reproduit pas le comportement du cloud).
