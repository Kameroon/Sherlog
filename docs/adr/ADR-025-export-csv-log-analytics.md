# ADR-025 : Lire l'export CSV du portail Log Analytics (étape 3b, première partie)

## Statut
Proposé — 2026-11-18, en attente de la validation de l'auteur.

## Contexte
L'auteur veut une version **simple, qui fonctionne et qui peut évoluer**, plutôt qu'une étape 3b complète. Sherlog ne lit jusqu'ici que des journaux texte (Serilog fichier et console). Les journaux d'Azure Monitor (Application Insights, Log Analytics) ne sont pas du texte : ce sont des tables.

L'auteur a fourni un **export réel** de la table `AppTraces` (264 lignes, 30 jours, gardé hors du dépôt). Il a été obtenu dans le portail : Journaux, bascule « Agent » désactivée, mode KQL, puis Exporter et « CSV (toutes les colonnes) ». Constats relevés sur ce fichier, sans rien supposer :
- 34 colonnes, dont `"TimeGenerated [UTC]"`, `Message` et `SeverityLevel` ;
- un BOM UTF-8 ; des CRLF entre les lignes ; des LF dans les messages entre guillemets, sur plusieurs lignes ; pas de fin de ligne finale ;
- des valeurs entre guillemets dès qu'elles contiennent autre chose que des lettres et des chiffres ;
- des dates au format `20/10/2026 00:41:49.839` (jour en premier, heure sur 24 heures). Pour 30 jours distincts, la première partie va de 1 à 31 : c'est donc bien le jour ;
- `SeverityLevel` ne vaut que 1 ou 2 : aucune erreur dans ce fichier.

## Décision
- **Un profil « CSV »** à côté des profils texte (`CsvProfile`, `src/core/profiles.ts`). Il déclare trois colonnes par leur nom (horodatage, niveau, message) et une table des niveaux. C'est le « profil structuré » de la SPEC, limité à ce qui sert aujourd'hui.
- **Préréglage `log-analytics-csv`** : les noms de colonnes sont ceux de l'export réel. La table des niveaux est l'échelle `SeverityLevel` documentée par Microsoft (0 Verbose, 1 Information, 2 Warning, 3 Error, 4 Critical). **Seuls 3 et 4 sont des erreurs**, comme pour les autres formats (les avertissements ne le sont pas). Une valeur hors table est gardée telle quelle et n'est jamais une erreur.
- **Reconnaissance** : la toute première ligne doit nommer les trois colonnes. Rien n'est déduit des lignes qui suivent.
- **Lecture** (`src/core/csvExport.ts`) :
  - les champs sont lus selon la RFC 4180, ligne après ligne, et chaque enregistrement donne une entrée, même quand son message tient sur plusieurs lignes ;
  - seuls les trois champs utiles sont gardés, et seulement leur première ligne : la mémoire reste bornée ;
  - le texte de l'entrée reste la ligne exacte de l'export, relue depuis le fichier comme pour un journal texte ;
  - la ligne des noms de colonnes n'est pas une entrée.
- **Date** : seule la forme relevée est lue, et elle est réécrite en ISO 8601 UTC (`2026-10-20T00:41:49.839Z`) pour que le tri et la période marchent comme ailleurs. Une autre forme ne donne **pas de date**, jamais une date devinée. En particulier, un mois supérieur à 12 montre que le jour n'est pas en premier.
- **Refus visibles** :
  - si une colonne manque, tout le texte forme une seule entrée sans niveau : jamais une erreur, et l'écran dit qu'aucune ligne ne correspond au format ;
  - si une ligne dépasse la limite de lecture (1 Mio), l'analyse s'arrête avec un message. En effet, ses guillemets ne peuvent plus être comptés, et la suite serait lue de travers, au risque de créer de fausses erreurs.

## Hors de cette décision (pas faits, à faire sur demande)
- JSON lines **Serilog compact** et **JSON de l'API** Azure Monitor : ce sont les autres préréglages de 3b. Le profil CSV a été écrit pour les accueillir (colonnes nommées et table des niveaux), sans les coder d'avance.
- Les tables `AppRequests` et `AppDependencies` ont un drapeau `Success` à la place de `SeverityLevel`. Il faudrait décider si une réponse 404 est une erreur, et relever leurs colonnes sur un export réel.
- 10c (connexion directe à Azure Monitor) reste bloquée. **L'export déposé comme fichier est le chemin qui fonctionne dès maintenant** : c'est le repli que prévoyait la ligne 10 de la feuille de route.

## Conséquences
- `LogProfile` devient une union (`TextProfile | CsvProfile`, champ `kind`), et `LogEntry` porte son `message`. Les fonctions communes aux deux lectures sont dans `src/core/entryLines.ts`. L'empreinte et la liste lisent `entry.message`, au lieu d'appliquer de nouveau l'expression de l'en-tête.
- Il n'y a ni dépendance ajoutée, ni appel réseau, ni changement de la CSP.
- Échantillon `samples/log-analytics-apptraces.csv` : il est **synthétique** et copie la forme exacte de l'export réel (même ligne d'en-tête, octet pour octet). Il n'est pas converti par git (`.gitattributes`).
- Hypothèse signalée : le format de date suit sans doute la langue du portail, ce qui n'est pas vérifié. Un portail dans une autre langue peut écrire les dates autrement : elles seraient alors absentes, pas fausses.
- Vérifié :
  - tests unitaires, et mutations du lecteur, de la détection et de l'aperçu, toutes détectées ;
  - parcours e2e dans Chrome avec l'échantillon ;
  - lecture de l'export réel en local : 264 entrées, toutes datées, 0 erreur, ce qui est exact.
