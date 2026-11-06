# ADR-004 : Lecture d'Azure Monitor depuis le navigateur

## Statut
Proposé — décision attendue à l'issue du spike de l'étape 1

## Contexte
Les logs d'Application Insights et Log Analytics sont une source réelle. Sans backend, la lecture passe par une connexion Microsoft dans le navigateur.

## Décision (proposée)
Connexion Microsoft dans le navigateur (enregistrement d'application Microsoft Entra gratuit), jeton gardé en mémoire avec une portée minimale en lecture, requête sur une période.

## Raisons
- Évite à l'utilisateur l'export manuel depuis le portail.

## Conséquences et points à vérifier au spike
- Critère de go : la bibliothèque MSAL tient dans le budget de 300 Ko gzip, et CORS autorise l'API Log Analytics depuis la page.
- L'API renvoie des tables (colonnes et lignes) : il faut un profil structuré, comme pour l'export CSV du portail (étape 3b). Les noms de colonnes sont relevés sur un export réel.
- Un consentement administrateur peut être exigé selon le locataire.
- Repli : export depuis le portail déposé comme fichier. C'est le premier élément coupé si le périmètre dérape.
