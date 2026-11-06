# ADR-002 : Appels IA directs depuis le navigateur avec la clé de l'utilisateur

## Statut
Proposé — décision attendue à l'issue du spike de l'étape 1

## Contexte
L'analyse et le chat nécessitent un modèle de langage. Sans backend, l'application ne peut pas détenir de clé : chaque utilisateur apporte la sienne.

## Décision (proposée)
Appels directs depuis le navigateur vers l'API Anthropic avec la clé de l'utilisateur (en-tête d'accès navigateur requis par Anthropic, à vérifier dans la documentation),
ou vers Ollama en local. Appel par `fetch` et lecture du flux SSE, sans SDK. Clé en `sessionStorage` par défaut, jamais journalisée ni exportée.

## Raisons
- Aucune clé ni aucun log ne transitent par un serveur de l'auteur.
- Pas de SDK : économie de poids dans le budget de 300 Ko gzip.

## Conséquences et points à vérifier au spike
- La clé est exposée à un éventuel XSS : CSP stricte, pas de HTML brut, clé dédiée avec plafond de dépense recommandée à l'utilisateur.
- Anthropic en streaming depuis le navigateur ; Ollama depuis une page HTTPS vers `http://localhost:11434` (origine à autoriser côté Ollama, comportement variable selon le navigateur, invites d'accès au réseau local).
- Si le spike échoue : retour vers l'auteur avant toute poursuite.
