# Échantillons de logs

**Tous ces fichiers sont synthétiques, sauf `real-serilog.log` et `real-mixed-formats.log`.** Les fichiers synthétiques suivent le modèle de fichier par défaut documenté de Serilog
(`{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}`), mais ne proviennent d'aucune vraie application.
`real-serilog.log` et `real-mixed-formats.log` sont des extraits réels (voir plus bas).

Résultats de référence : ceux des quatre fichiers synthétiques sont calculés avec un prototype des règles du §5 de `docs/SPEC.md` (l'implémentation TypeScript doit les reproduire) ;
ceux de `real-serilog.log` sont comptés à la main sur le fichier, puis confirmés par l'implémentation.

| Fichier | Profil attendu | Entrées | Erreurs | Empreintes distinctes |
|---|---|---|---|---|
| `sample.log` | Serilog fichier | 14 | 5 | 4 |
| `serilog-realistic.log` | Serilog fichier | 17 | 9 | 7 |
| `serilog-console.log` | Serilog console (sans date) | 5 | 3 | 2 |
| `serilog-pieges.log` | Serilog fichier | 7 | 5 | 3 |
| `real-serilog.log` | Serilog console (sans date) | 21 | 3 | 1 |

Étape 2 : les colonnes « Profil attendu », « Entrées » et « Erreurs » sont vérifiées par `tests/samples.test.ts` (parseur de `src/core`). Étape 3 : la colonne « Empreintes distinctes » est vérifiée par `tests/samples.test.ts`, qui contrôle aussi quelles erreurs partagent la même empreinte.

## Ce que chaque fichier vérifie
- **`sample.log`** : le cas de base ; deux timeouts qui ne diffèrent que par des nombres partagent la même empreinte ; un secret (`Password=`) et un email pour le `redact`.
- **`serilog-realistic.log`** : exceptions internes (`--->`), `AggregateException`, message SQL sur plusieurs lignes, même `NullReferenceException`
  survenant deux fois (identifiants différents → même empreinte), deux paiements en échec pour des commandes différentes (même empreinte),
  niveau `FTL`, bruit `WRN`/`DBG`/`INF` à ignorer, un faux jeton `Authorization: Bearer` à masquer.
- **`serilog-console.log`** : modèle console sans date ; le profil par défaut n'en reconnaît aucune ligne (0 sur 11), il faut donc le profil dédié.
- **`serilog-pieges.log`** : deux lignes de message qui ressemblent à un en-tête (`2026-… Something`, `2026-… Another`) mais dont le « niveau » n'est pas un niveau connu : elles continuent
  l'entrée `[ERR] Import failed…` (qui compte donc 6 lignes et une seule entrée) ; deux e-mails différents → même empreinte ; deux adresses IP différentes → même empreinte ;
  seule l'entrée d'import a une stack (la première frame applicative est `Shop.Import…`, `System.` étant ignoré). Les variantes d'encodage et de fin de ligne
  (CRLF, BOM, UTF-16 LE, UTF-8 coupé entre deux blocs, une ligne de plusieurs Mo) sont **générées par les tests** à partir de ce fichier et doivent donner exactement les mêmes résultats ; elles ne sont pas committées.

- **`real-serilog.log`** : **extrait réel** de la sortie console d'un conteneur Docker (21 lignes, `docker logs`), fourni par l'auteur. Il confirme sur du réel le profil Serilog console
  avec un identifiant de corrélation entre crochets dans le message (`[33ffff3c-…]`), des appels de santé journalisés au niveau `ERR`
  (`Executed endpoint 'HTTP: GET /health'`) et un message en français au niveau `DBG`. Les trois erreurs ne diffèrent que par ce GUID : une seule empreinte.
  Il ne contient **ni stack, ni message sur plusieurs lignes, ni niveau `FTL`** : ces cas restent couverts uniquement par les échantillons synthétiques.
- **`real-mixed-formats.log`** : **extrait réel** de 8 lignes, fourni par l'auteur, qui **mélange trois dispositions** : lignes console avec un champ en plus (`[10:32:39 BOOT INF]`), lignes console classiques (certaines avec un champ vide `[]` dans le message), et une ligne avec date et décalage (`2026-11-07 10:32:42 +00:00 [INF]`), plus une pile d'exception. Il n'a **pas de résultat de référence** : le cas est ouvert (`SPEC.md` §8 point 4). Constat vérifié aujourd'hui : la première ligne n'est lue par aucun profil, l'application répond « format non reconnu » (verrouillé par `tests/samples.test.ts`).

## À ajouter par l'auteur (non devinable)
- Un export réel Application Insights / Log Analytics (JSON de l'API et/ou CSV du portail), avant l'étape 3b : les noms exacts des colonnes sont relevés sur cet export, jamais supposés.
