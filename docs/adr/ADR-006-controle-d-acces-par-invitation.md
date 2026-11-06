# ADR-006 : Contrôle d'accès par l'authentification intégrée de Static Web Apps et rôle `invited`

## Statut
Accepté sous réserve — à confirmer par la vérification sur le site déployé (étape 0). Résultats : section « Vérification » ci-dessous.

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
À compléter après le déploiement : anonyme sur `/`, sur un chemin inexistant et sur un fichier de `/assets/` ; page de connexion ; compte connecté non invité (403 maîtrisé, déconnexion possible) ;
accès après invitation ; accès refusé après retrait de l'invitation ; protection de l'environnement de prévisualisation.
