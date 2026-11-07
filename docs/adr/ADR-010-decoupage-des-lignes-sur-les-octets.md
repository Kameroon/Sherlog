# ADR-010 : Découper le flux en lignes sur les octets, avant de décoder

## Statut
Proposé — 2026-11-07. Passe à « Accepté » avec la validation de l'étape 2 par l'auteur.

## Contexte
Le parseur (étape 2) doit tenir CRLF, BOM, UTF-16 (fréquent avec la redirection PowerShell 5.1), UTF-8 coupé entre deux blocs et lignes très longues (`SPEC.md` §3). L'étape 4 relira une entrée à la demande avec `File.slice` : il faut donc, pour chaque entrée, une position **exacte en octets**.

## Décision
- **Les octets sont découpés en lignes, puis chaque ligne est décodée** (`src/core/lineSplitter.ts`). En UTF-8, l'octet `0x0A` n'apparaît jamais à l'intérieur d'un caractère multi-octets ; en UTF-16, un saut de ligne est l'unité complète `0x000A` à une position paire (`0A 00` en LE, `00 0A` en BE).
- **L'encodage vient de la marque d'ordre des octets (BOM) seulement** : UTF-8, UTF-16 LE, UTF-16 BE ; sans marque, UTF-8.
- **Seuls LF et CRLF terminent une ligne.** Le `\r` d'un CRLF n'est pas dans le texte mais compte dans la longueur ; un `\r` isolé reste dans le texte.
- **Positions en octets, entrées contiguës** : `offset` est le début de la première ligne, `length` va jusqu'au début de l'entrée suivante (terminateurs inclus). Le BOM compte dans la première ligne : `[offset, offset+length[` se relit tel quel avec un `TextDecoder`.
- **Une limite de conservation unique et provisoire**, `MAX_RETAINED_BYTES` = 1 Mio, appliquée à une ligne puis à une entrée. Au-delà, les octets sont comptés mais plus conservés, l'objet est marqué `truncated` et sa longueur reste exacte ; l'en-tête d'une entrée est toujours conservé.
- **Détection de profil sans deviner** (`src/core/detectProfile.ts`) : candidat si la première ligne non vide correspond ; le plus grand nombre d'en-têtes dans les 50 premières lignes l'emporte ; aucun candidat ou égalité → `unrecognized` avec une raison. Un contenu qui commence par `{` est renvoyé vers le profil structuré (étape 3b).
- **Profil personnalisé** : expression insensible à la casse avec un groupe nommé `level` obligatoire.
- API synchrone à état (`push`, `finish`) : utilisable telle quelle dans le worker de l'étape 4.

## Raisons
- Décoder en flux puis couper sur le texte rend les positions fausses dès qu'un octet est invalide, qu'un BOM est présent ou qu'on est en UTF-16 : on ne sait plus à quel octet correspond une ligne.
- Couper avant de décoder supprime par construction le cas du caractère coupé entre deux blocs.
- Une détection fondée sur la proportion de lignes qui correspondent échoue dès que les traces d'exception sont longues (`SPEC.md` §5).

## Alternatives écartées
- `TextDecoder` en mode flux puis découpage du texte : positions en octets non récupérables sans réencoder, donc inexactes.
- Détecter UTF-16 sans BOM par la présence d'octets nuls : c'est deviner. L'échec reste visible, puisque le texte ne correspond alors à aucun profil.

## Conséquences
- **Précision sur ADR-003.** `core` n'utilise ni DOM ni React, mais `TextDecoder` (standard Encoding). Il existe dans Node et dans les workers : le but de l'ADR-003 (exécution dans un worker et dans des tests Node) est tenu ; sa formule « aucune API Web » est à lire « aucune API du DOM ».
- Octets invalides en UTF-8 : remplacés par U+FFFD, sans erreur. Un octet isolé en fin de flux UTF-16 est écarté et la ligne est signalée `truncated`.
- Une entrée tronquée garde son début : l'empreinte (étape 3) se calcule sur le texte conservé, la relecture complète passe par `[offset, offset+length[`.
- `ARCHITECTURE.md` : une source fournit des blocs d'octets, plus des lignes (signature à fixer à l'étape 4).
- Une expression régulière de profil saisie par l'utilisateur peut être lente : elle n'est pas bornée ici. Le contrôle est le worker terminable de l'étape 4.

## Mesuré et non vérifié
- **Mesuré** (Node 22.20.0, Vitest) : sur les 4 échantillons, profil, entrées et erreurs identiques au README (14/5, 17/9, 5/3, 7/5), y compris en CRLF, avec BOM, en UTF-16 LE et BE, en blocs de 1 et 7 octets, avec une ligne de plusieurs Mo ; le contrôle de la parité UTF-16 a été vérifié en le retirant volontairement (les cas voisins d'un `0x00` échouent alors).
- **Non vérifié** : `TextDecoder('utf-16be')` dans les navigateurs (seul Node a été exercé) ; temps et mémoire sur un fichier de plusieurs centaines de Mo, et la valeur de 1 Mio (étape 4) ; fidélité sur de vrais logs (`samples/real-serilog.log` attendu avant la clôture de l'étape 2) ; détection d'un en-tête CSV (étape 3b).
