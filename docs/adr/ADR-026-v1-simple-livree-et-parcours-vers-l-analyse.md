# ADR-026 : v1 simple livrée, et parcours vers l'analyse reçue

## Statut
Accepté — 2026-11-25. Le périmètre de la v1 est décidé par l'auteur ; le changement d'interface est à valider sur `dev`.

## Contexte
L'auteur veut une **version simple et entièrement fonctionnelle**, avec les fonctionnalités de base, à améliorer plus tard. Les étapes 0 à 10b et la première partie de 3b sont en production.

Un premier essai réel avec une clé Anthropic a montré un défaut de parcours, pas de logique : l'analyse arrive dans le détail de l'erreur (en haut de la page) alors que le bouton « Envoyer à l'IA » est en bas, donc l'utilisateur ne voyait pas que l'envoi avait réussi. Le bouton grisé n'expliquait pas non plus qu'il fallait cocher « Faire expliquer cette erreur par l'IA » : une ligne **sélectionnée** n'est pas une erreur **choisie** pour l'envoi.

## Décision
- **La v1 est l'application telle qu'elle est en production.** Le reste est reporté, sans être abandonné :
  - étape 11 : historique local, export et import ;
  - étape 3b, suite : Serilog compact et JSON de l'API Application Insights (en attente d'un échantillon réel) ;
  - étape 10c : Azure Monitor direct (bloqué, ADR-020).
- **L'analyse reste dans le détail de l'erreur**, à côté de son statut, de ses lignes voisines et du chat qui s'ouvre après elle. La déplacer sous le panneau d'envoi l'éloignerait de son contexte et la repousserait sous les réglages de la clé.
- **On amène l'utilisateur à l'analyse** depuis le panneau d'envoi :
  - **dès la première réponse du modèle** après le clic sur « Envoyer à l'IA », l'erreur concernée est sélectionnée et le focus est placé sur le bloc d'analyse (le navigateur défile jusqu'à lui, un lecteur d'écran l'annonce). Les réponses suivantes du même envoi ne déplacent plus rien : l'utilisateur lit la première pendant que les autres arrivent ;
  - un bouton « Voir l'analyse » par erreur analysée, pour aller à une autre ;
  - un message d'état « Analyse terminée : N sur M » quand plus aucun envoi n'est en cours ;
  - près du bouton, quand aucune erreur n'est choisie, une consigne qui dit où cocher.
- **Défilement automatique : décision révisée le 2026-11-25.** Une première version n'offrait que le bouton, par crainte de désorienter l'utilisateur quand plusieurs erreurs sont envoyées. À l'essai, l'auteur ne voyait toujours pas le résultat : le défilement vers la première réponse est donc ajouté, limité à une fois par clic pour ne pas désorienter.

- **Mise en avant du choix et blocs repliables (2026-11-26).** À l'essai en production, la case « Faire expliquer cette erreur par l'IA » passait inaperçue et la page est longue :
  - la case est dans un encadré à bordure d'accent, plus grande, et une fois cochée une phrase dit où est l'étape suivante (le panneau « Envoi à l'IA », bouton « Envoyer à l'IA ») ;
  - les blocs « Fournisseur d'IA », « Discuter de cette erreur » et chaque erreur choisie dans le panneau d'envoi ont la flèche de repliage des panneaux de préparation (`FoldablePanel`, option `nested` : titre de niveau 3, sans l'aspect d'un panneau de page). Le contenu est masqué, pas retiré : ce qui a été saisi (clé, question) revient à l'ouverture ;
  - le bloc « Analyse de l'IA » n'est pas repliable pour l'instant : c'est la cible du focus de « Voir l'analyse ». À ajouter sur demande.
  - Conséquence d'accessibilité : la région du chat et le groupe du fournisseur sont nommés par leur titre (« Discuter de cette erreur », « Fournisseur d'IA »).

## Vérifications faites le 2026-11-25
- `tsc --noEmit`, `eslint --max-warnings 0`, tests, `npm audit --omit=dev` (0 vulnérabilité) et build : sans erreur.
- Visiteur non connecté sur la production : redirigé vers `/login/`, CSP et en-têtes de sécurité présents.
- Essai réel avec une clé Anthropic et le modèle `claude-haiku-5-5` sur l'extrait Docker de 21 lignes : connexion réussie, une requête `messages` en 200, analyse reçue et rendue dans le détail.

## Pas encore vérifié
- Une personne connectée mais **non invitée** reçoit bien la réponse 403 maîtrisée (demande un second compte).
- Le comportement réel du modèle face à un journal contenant « ignore tes instructions et… » (contrôle manuel de l'étape 8). Les tests sur la construction du prompt, la validation du JSON et le rendu existent.

## Conséquences
- La feuille de route garde l'étape 11 ouverte ; les critères de fin de v1 qui dépendent d'elle (historique, audit global final) restent à faire quand l'auteur le décidera.
- Aucun changement de contrat de données, de CSP ni de dépendance.
