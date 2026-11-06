# ADR-005 : Aucun backend

## Statut
Accepté — 2026-11-06

## Contexte
Un backend avec stockage sortirait du cadre gratuit vérifié et ferait transiter des logs sensibles par un serveur de l'auteur.

## Décision
Aucun backend, aucune fonction serveur, aucune base de données.

## Raisons
- Coût nul, confidentialité par construction, maintenance minimale.

## Conséquences
- Hors périmètre : ingestion continue, alertes, surveillance sans page ouverte, historique serveur, partage d'analyses entre utilisateurs, collecte par SSH ou agents, lecture de serveurs sans CORS,
  fournisseur d'identité personnalisé (non disponible sur le plan Free). Détail dans `SPEC.md` §4.
- Aucun plafonnement de débit possible côté serveur (voir ADR-006).
- Compensations : relecture d'un dossier autorisé (Chromium), requêtes Azure Monitor sur une période, export/import de l'historique local.
