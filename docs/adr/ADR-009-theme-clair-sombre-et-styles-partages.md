# ADR-009 : Thème clair et sombre selon le système, styles partagés avec les pages publiques

## Statut
Accepté — 2026-11-06.

## Contexte
La première interface (étape 0) a été jugée dépouillée, voire hostile. Trois maquettes ont été comparées ; la direction « Minuit » (sombre, orientée développeur, extrait de journal animé) a été retenue, avec un thème clair et sombre suivant le système.
Les pages de connexion et d'accès refusé sont des fichiers statiques servis avant toute connexion ; le reste du site n'est servi qu'aux personnes invitées (ADR-006). Elles ne peuvent donc pas utiliser le CSS empaqueté de l'application.
La CSP interdit les styles en ligne : tout passe par des fichiers CSS.

## Décision
- **Un seul fichier de jetons et de styles de base**, `public/login/base.css` : couleurs, espacements, rayons, thème clair par défaut et thème sombre sous `prefers-color-scheme: dark`, logo, animation d'entrée.
  Il est servi par le chemin `/login/*`, le seul accessible sans connexion ; les pages publiques et l'application le chargent toutes les deux.
- Styles propres aux pages publiques dans `public/login/login.css` ; styles de l'application dans `src/index.css`.
- Pas de bouton de bascule manuelle : le thème suit le système (`color-scheme: light dark` et `<meta name="color-scheme">` pour éviter un flash blanc).
- L'extrait de journal de la page de connexion reste une fenêtre sombre dans les deux thèmes, avec ses propres couleurs fixes (comme une capture de code).
- Animations légères, toutes coupées par `prefers-reduced-motion`.
- L'initiale du nom remplace la photo du compte : la CSP n'autorise aucune image externe.

## Raisons
- Un fichier unique évite que les jetons des pages publiques et de l'application divergent.
- Suivre le système est le comportement attendu et ne demande ni état, ni stockage, ni JavaScript.

## Conséquences
- `/login/base.css` est une dépendance de l'application : si ce chemin cessait d'être accessible aux personnes connectées, l'application s'afficherait sans ses jetons.
  `tests/staticwebapp-config.test.ts` vérifie que les pages publiques ne chargent que des feuilles existantes sous `/login/` et que l'application charge ce fichier.
- Toute couleur nouvelle passe par un jeton défini dans les deux thèmes, avec le contraste mesuré (WCAG AA) consigné dans l'en-tête du fichier.
- Ces jetons sont le point de départ du jeu de jetons prévu à l'étape 5 : l'étape 5 les étend, elle ne repart pas de zéro.

## Vérification
- Rendu contrôlé en local (build servi par un serveur temporaire) dans les deux thèmes : connexion, accès refusé, application avec identité.
- Contrastes mesurés : texte 16,7:1 (clair) et 16,0:1 (sombre) ; texte secondaire 7,1:1 et 7,7:1 ; accent 5,5:1 et 8,0:1 ; bordures de contrôles 4,4:1 et 3,5:1.
- Prévisualisation de la pull request n°2, en anonyme : `/login/base.css` et `/login/login.css` répondent 200, le reste du site redirige vers `/login/`.
- Le chargement de `/login/base.css` par une personne invitée et connectée (la règle `/login/*` est réservée au rôle `anonymous`, que tout visiteur possède) a été soumis à l'auteur sur la prévisualisation ; l'auteur a validé l'étape 0 ensuite, sans constat détaillé consigné.
