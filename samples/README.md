# Échantillons de logs

**Ces fichiers sont synthétiques** : ils suivent le modèle de fichier par défaut documenté de Serilog
(`{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}`), mais ne proviennent d'aucune vraie application.
À compléter ou remplacer par des extraits réels dès qu'ils sont disponibles.

Résultats de référence, calculés avec un prototype des règles du §5 de `docs/SPEC.md` (l'implémentation TypeScript doit les reproduire) :

| Fichier | Profil attendu | Entrées | Erreurs | Empreintes distinctes |
|---|---|---|---|---|
| `sample.log` | Serilog fichier | 14 | 5 | 4 |
| `serilog-realistic.log` | Serilog fichier | 17 | 9 | 7 |
| `serilog-console.log` | Serilog console (sans date) | 5 | 3 | 2 |
| `serilog-pieges.log` | Serilog fichier | 7 | 5 | 3 |

Étape 2 : les colonnes « Profil attendu », « Entrées » et « Erreurs » sont vérifiées par `tests/samples.test.ts` (parseur de `src/core`). La colonne « Empreintes distinctes » relève de l'étape 3 : elle n'est pas encore vérifiée.

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

## À ajouter par l'auteur (non devinable)
- ~30 lignes réelles de log Serilog, avant la clôture de l'étape 2 (`samples/real-serilog.log`) ; les résultats attendus sont alors calculés et ajoutés au tableau ci-dessus.
- Un export réel Application Insights / Log Analytics (JSON de l'API et/ou CSV du portail), avant l'étape 3b : les noms exacts des colonnes sont relevés sur cet export, jamais supposés.
