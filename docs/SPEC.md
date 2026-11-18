# SPEC — Sherlog

## 1. Vision
Application web **100 % côté navigateur**, hébergée gratuitement sur Azure Static Web Apps (plan Free), sans backend.
Elle lit des logs (fichiers exportés de n'importe quelle plateforme, URL, Azure Monitor), n'affiche que les erreurs, puis fournit pour chacune
une analyse IA précise et un chat, avec la clé de l'utilisateur ou un modèle local. Objectif final : un outil **générique**, pas lié à une seule application.

## 2. Contraintes et choix par défaut (à confirmer)
| Sujet | Défaut retenu |
|---|---|
| Coût | 0 € : plan Free, aucune fonction serveur, aucune offre payante |
| Accès | Authentification intégrée de Static Web Apps (GitHub ou Microsoft) ; accès réservé aux personnes **invitées** (rôle `invited`, 25 au maximum sur le plan Free). La barrière est appliquée par Azure avant de servir l'application, pas par le code client. Menace visée : testeurs / développeurs acharnés (aucun plafonnement de débit possible sans backend). **Repli** si les invitations ne sont pas viables sur Free : application publique sans connexion (risque accepté, ADR-006) |
| Identité | L'application lit l'identité de la personne connectée (nom, fournisseur) pour l'afficher et séparer l'historique local de chacun sur un navigateur partagé. Google n'est pas disponible comme fournisseur sur le plan Free |
| Clé IA | Chaque utilisateur apporte sa propre clé Anthropic, ou utilise Ollama en local |
| Données | Rien n'est envoyé à un serveur de l'auteur ; seuls des extraits masqués partent vers le fournisseur IA choisi par l'utilisateur. **Rien n'est analysé ni envoyé sans une action explicite de l'utilisateur**, à chacune des quatre étapes : choisir, préparer, analyser, envoyer (§3, « Préparation ») |
| Renoncements | Pas d'ingestion continue, pas d'historique serveur, pas de partage de données entre utilisateurs (voir §4) |
| Historique | Optionnel, local au navigateur (IndexedDB), export/import JSON. Jamais de log brut non masqué : contenu masqué, ou seulement empreintes + statuts + analyses (à trancher à l'étape 11) |
| Formats de logs | v1 : texte Serilog (fichier et console) et format générique « horodatage ISO + niveau » ; **profil structuré** (correspondance de champs + table des niveaux) pour JSON lines Serilog compact et pour les exports Log Analytics / App Insights (JSON de l'API, CSV) ; profil personnalisé par expression régulière. Après la v1 : pino, Docker json-file, log4net/NLog, console Microsoft.Extensions.Logging, Python, nginx/Apache |
| Sources | v1 : fichiers (export depuis n'importe quelle plateforme), collage, dossier (Chromium), URL **limitée à une liste de domaines figée dans la CSP** (Azure Blob au départ), Azure Monitor (sous réserve du spike). Autres connecteurs : à la demande, un par un |

## 3. Périmètre v1

### Accès et identité
- Connexion GitHub ou Microsoft via l'authentification intégrée de Static Web Apps ; accès restreint aux invités ; identité affichée, déconnexion possible.
- Historique local séparé par identité sur un même navigateur.

### Partie 1 — Collecte et affichage des erreurs
- **Sources locales** : glisser-déposer ou sélecteur de fichiers (tous navigateurs) ; sélecteur de dossier avec relecture rapide
  (Chrome et Edge uniquement ; **réalisé à l'étape 10a, ADR-021** : lecture seule, un seul niveau, 1 000 fichiers au plus, l'utilisateur choisit un fichier ; le dossier est retenu par identité et le navigateur redemande l'autorisation à chaque session). Pas de saisie de chemin ni de découverte automatique : le navigateur n'accède au disque que sur choix de l'utilisateur.
- **Sources distantes** : (a) collage de texte ; (b) URL de logs lisible par le navigateur (HTTPS + CORS autorisant le site,
  par exemple un lien SAS Blob) **sur un domaine de la liste figée dans la CSP** ; tout autre domaine est refusé avec un message explicite (ajout = modification de la config et redéploiement) ; **réalisé à l'étape 10b, ADR-023** : un seul compte (`sherlogjournaux`), lien saisi dans un champ masqué et jamais gardé, fichier de 256 Mio au plus, redirection refusée ; (c) Azure Monitor (Log Analytics / App Insights) via connexion Microsoft dans le navigateur —
  **conditionné au spike de faisabilité**. Repli sans condition : exporter le résultat de la requête depuis le portail Azure et le déposer comme un fichier.
- **Lecture en streaming dans un Web Worker** : plusieurs centaines de Mo sans figer l'interface, avec progression et **annulation**.
  Robustesse : fins de ligne CRLF, BOM, UTF-16 (fréquent avec la redirection PowerShell 5.1), UTF-8 coupé entre deux blocs, entrées très longues.
  **Mémoire** : par entrée en erreur, seuls position, longueur, horodatage, niveau, première ligne et empreinte sont conservés ; le détail complet et les lignes voisines
  sont relus à la demande depuis le fichier choisi. Aucune troncature silencieuse : toute limite atteinte (entrée trop longue, fichier modifié ou illisible depuis le chargement,
  résultat Azure plafonné) est signalée à l'écran. Les seuils sont fixés par une mesure sur un gros fichier généré, pas posés à l'avance : valeurs retenues et chiffres dans l'ADR-011 (100 000 erreurs enregistrées, toutes listées : la liste est virtualisée depuis l'étape 5, ADR-013).
- **Préparation avant analyse** : choisir un fichier ou coller du texte **lit** le journal dans le navigateur, sans l'analyser ni l'envoyer.
  L'utilisateur arrive sur un espace de préparation, facultatif, où il règle ce qui sera analysé, puis lance lui-même l'analyse (« Analyser ce journal »).
  Le fichier d'origine n'est jamais modifié (ADR-010) : les réglages ne changent que ce qui est retenu, affiché et envoyé. Des compteurs visibles
  (entrées lues, écartées par les réglages, prêtes à analyser ; « données masquées » avec le masquage, étape 6) et un aperçu du journal préparé rendent chaque réglage vérifiable. Disposition (décidée le 2026-11-09) : les réglages côte à côte, puis l'aperçu sur toute la largeur de la page dans une zone qui défile et que le clavier atteint, pour qu'une ligne de journal se lise sur une seule ligne. Les deux grands blocs (« Masquer les données sensibles » et « Aperçu du journal préparé ») se replient et se rouvrent par une flèche (ouverts au départ, état gardé tant que l’écran est affiché) pour laisser de la place.
  Tant que l'analyse n'a pas eu lieu, ces chiffres et l'aperçu portent sur **le début du fichier (1 Mio)** : exacts pour un texte collé ou un petit fichier, sinon dits « calculés sur le début » à l'écran ; l'analyse donne les chiffres exacts (ADR-012).
  Changer un réglage après l'analyse invalide le résultat affiché : l'analyse est à relancer. Outils :
  - **Format** : format reconnu affiché avec son effet (nombre d'entrées) ; lignes situées avant la première en-tête signalées ; liste des formats intégrés pour en choisir un autre, l'aperçu étant alors lu de nouveau avec lui (« reconnu » devient « choisi »), y compris quand aucun format n'est reconnu ; un format qui ne lit aucune ligne du début est refusé avec le motif. Pas de motif saisi à ce stade. Changer de format garde les règles et oublie la période.
  - **Ignorer des entrées** : règles texte (l'entrée est écartée si son texte, pile comprise, contient la chaîne, majuscules ou non), par exemple les appels de santé `/health` ; règles vides ou en double refusées, 200 caractères et 20 règles au plus, règles supprimables. Pas d'expression régulière. Une entrée écartée est lue et comptée, mais n'est ni une erreur ni regroupée par empreinte (ADR-012).
  - **Période** : borne de début et de fin. Pour un profil à heure seule (console), deux champs « heure » (`HH:MM`, champ natif du navigateur, choisi le 2026-11-09 parmi trois propositions), « Effacer la période » remettant les deux bornes à vide ; pour un profil avec date, deux champs date et heure à la minute, heures comparées telles qu'écrites dans le journal (décalage non lu, dit à l'écran) ; minute de fin incluse, entrées sans heure ou non placables conservées, fin avant début refusée avec sa raison (passage de minuit non géré), analyse interdite tant que la période est invalide.
  - **Masquer les données sensibles** : cases à cocher avec le nombre d'occurrences trouvées (voir §6) ; le texte d'origine n'est affiché qu'à la demande de l'utilisateur et reste sur cet écran.
- **Choix explicite avant tout envoi** : après l'analyse locale, l'utilisateur coche les erreurs à faire expliquer (aucune n'est cochée d'office), consulte le texte exact qui serait envoyé,
  **toujours masqué**, avec un avertissement si aucun masquage n'est actif, puis décide d'envoyer ou non. L'envoi est une étape séparée de l'analyse.
- **Erreurs uniquement** : `ERROR`, `ERR`, `FATAL`, `FTL`, `CRITICAL` (configurables ; `ERR` et `FTL` sont les abréviations Serilog).
  **Multi-lignes** : l'exception qui suit le message appartient à son en-tête.
- **Empreinte et entrées identiques** : chaque entrée en erreur reçoit une empreinte ; les entrées identiques sont signalées par un badge « ×N identiques » (avec première et dernière apparition) et partagent la même analyse et le même statut (Nouveau / Analysé / Ignoré / Résolu).
- **Liste des erreurs, vue à plat** : une ligne par entrée de log en erreur ; tri (ordre de lecture, heure, gravité, nombre d'identiques), filtres (niveau, statut), recherche plein texte, détail avec stack complète. **La recherche porte sur l'heure, le niveau et le début du message (300 caractères) tels que la liste les montre, pas sur la pile** (décidé le 2026-11-09, ADR-014). Seules les entrées en erreur sont affichées dans la liste ; les lignes voisines n'apparaissent qu'**à la demande dans le détail** (« Voir les lignes autour », 10 lignes avant et après, relues dans le fichier) et dans l'aperçu de ce qui est envoyé au modèle. Pas de vue regroupée : le badge « ×N identiques » est triable.
- **Partie 1 utilisable seule** : aucune clé IA n'est nécessaire pour récupérer et afficher les erreurs.

### Partie 2 — Analyse IA et chat
- **Analyse à la demande**, sortie structurée (résumé, cause probable, gravité, pistes, éléments manquants, confiance) — `docs/PROMPTS.md`. Elle est faite à partir de l'occurrence la plus récente de l'erreur (indiquée dans le détail) et vaut pour toutes les occurrences identiques. **Réalisée à l'étape 8 (ADR-018)** : « Envoyer à l'IA » envoie, sur clic, le texte exact de l'aperçu (masqué, puis coupé) de chaque erreur distincte choisie, une requête après l'autre, au fournisseur choisi ; le journal est une donnée entre des délimiteurs au délimiteur aléatoire tiré à chaque requête ; la réponse n'est reçue que si elle suit le schéma (une relance, puis le texte brut dit « format non structuré ») ; elle s'affiche dans le détail de l'erreur comme du texte, avec le rappel de la vérifier, et pose le statut « Analysé » sans écraser « Ignoré » ni « Résolu ».
  « Plus récente » = plus grand horodatage ; à défaut (profil console sans date) ou en cas d'égalité, la dernière dans l'ordre de lecture, ce que le détail indique.
- **Chat par erreur** en streaming ; contexte = erreur + stack + lignes voisines + analyse existante. Le chat est rattaché à une erreur : pas de chat global sur l'ensemble des erreurs. **Réalisé à l'étape 9 (ADR-019)** : le chat **traite le retour de l'analyse du modèle** pour approfondir son résultat et trouver une suggestion de solution **sans rien inventer** (rôle d'ingénieur logiciel expert, bonnes pratiques) ; sa fenêtre n'apparaît qu'**après** l'analyse de l'erreur par le modèle (décidé le 2026-11-09) ; rien ne part avant le clic sur « Envoyer la question » ; chaque question est masquée comme le reste et toute la conversation est renvoyée avec un délimiteur neuf ; une conversation par empreinte, en mémoire ; trop longue (60 000 caractères), elle est refusée, pas coupée.
- **Fournisseurs** : Anthropic (clé de l'utilisateur, appels directs depuis le navigateur) ou Ollama local (si l'utilisateur l'a lancé et a autorisé
  l'origine du site). Bouton « Tester la connexion ». Clé en `sessionStorage` par défaut ; « se souvenir de ma clé » optionnel avec avertissement.
  **Ces contrôles (saisie de la clé, modèle local) ne sont visibles ou actifs qu'une fois le journal lu, préparé et analysé** : l'étape « Envoyer à l'IA » est affichée dès l'étape 4b, grisée et dite « pas encore disponible ». Depuis l'étape 7 (ADR-017), elle devient l'étape courante après une analyse qui a trouvé des erreurs, et le panneau « Envoi à l'IA » porte les réglages du fournisseur : choix Anthropic ou Ollama, clé (champ masqué, jamais réaffichée, gardée pour l'onglet ou, sur demande, sur l'ordinateur), modèle (champ libre, `claude-haiku-5-5` au départ ; liste des modèles installés pour Ollama) et « Tester la connexion », qui n'envoie qu'une phrase fixe (Anthropic) ou ne lit que la liste des modèles (Ollama), jamais un mot du journal. L'envoi des erreurs choisies reste désactivé jusqu'à l'étape 8. Pas de page Paramètres séparée (décidé le 2026-11-09).

## 4. Hors périmètre (exige un backend avec stockage, donc sort du cadre gratuit vérifié)
Ingestion continue, alertes, surveillance sans page ouverte, historique serveur, partage d'analyses entre utilisateurs,
collecte par SSH ou agents, lecture de serveurs sans CORS, contrôle d'accès avec fournisseur d'identité personnalisé (Google, etc.).
Compensations v1 : relecture en un clic d'un dossier déjà autorisé (Chromium), requêtes Azure Monitor sur une période, export/import de l'historique local.

## 5. Règles de parsing et empreinte

### Profil par défaut (Serilog fichier + générique)
Le modèle de fichier par défaut de Serilog est `{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}`,
soit `2026-11-04 08:16:10.332 +01:00 [ERR] message` suivi de l'exception sur les lignes suivantes. Une nouvelle entrée commence sur une ligne
qui matche `HeaderPattern` (expression régulière configurable) :

```
^(?<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)\s+\[?(?<level>VERBOSE|VRB|TRACE|TRC|DEBUG|DBG|INFORMATION|INFO|INF|WARNING|WARN|WRN|ERROR|ERR|CRITICAL|FATAL|FTL)\]?\s+(?<msg>.*)$
```
(drapeau insensible à la casse ; le niveau est restreint aux niveaux connus pour qu'une ligne de message multi-ligne du type `2026-… Something` ne crée pas un faux en-tête)

Les lignes qui ne matchent pas continuent l'entrée courante. Plusieurs profils déclarables. **Détection** sur les 50 premières lignes : un profil est candidat si la
première ligne non vide matche son en-tête ; parmi les candidats, celui qui compte le plus d'en-têtes est retenu. Aucun candidat, ou égalité : avertissement et
possibilité de saisir un profil personnalisé, **ne pas deviner**. Une détection fondée sur la proportion de lignes qui matchent est exclue : elle échoue dès que les stacks sont longues
(17 en-têtes sur 52 lignes dans `serilog-realistic.log`). Un contenu qui commence par `{` ou par une ligne d'en-têtes CSV est dirigé vers le profil structuré.
**Profil « Serilog console »** (sans date) : `^\[(?<ts>\d{2}:\d{2}:\d{2}) (?<level>[A-Z]{3})\]\s+(?<msg>.*)$`. Le profil par défaut ne reconnaît aucune ligne de ce format ; il est donc intégré à part et signalé comme limité (seule l'heure est connue : pas de première/dernière apparition fiable).

**Empreinte** : la clé de regroupement est la chaîne `niveau + message normalisé + première frame applicative` elle-même (pas de hachage : synchrone, sans API Web, `core` reste du TS pur).
Normalisation : GUID, nombres, timestamps, e-mails, adresses IP, URL, identifiants alphanumériques (`ORD-2026-7710`), chemins temporaires, adresses mémoire remplacés par des jokers
(`<n>`, `<time>`, `<guid>`, `<email>`, `<ip>`, `<url>`, `<id>`, `<tmp>`, `<addr>`). Elle ne porte que sur le **message de l'en-tête** (groupe `msg` du profil ; à défaut, toute la première ligne) :
les lignes de continuation ne comptent pas, hors la première frame. La clé retient au plus **1 000 caractères** du message normalisé : deux messages identiques sur ce début sont la même erreur (chaque clé reste en mémoire ; sans ce plafond, des lignes de 1 Mio toutes différentes feraient croître la mémoire comme le fichier). Choix qui évitent de fusionner des erreurs différentes : un nombre collé à des lettres (`Int32`) reste tel quel ;
un mot avec tiret ou souligné n'est un identifiant que s'il contient lettres **et** chiffres (`Content-Type` reste tel quel). IPv6 n'est pas traité (ses groupes restent écrits : cela ne peut que séparer des erreurs identiques, jamais en fusionner). Ce n'est pas un masquage : `redact` (étape 6) reste seul garant de ce qui part vers l'IA.
**Première frame applicative** : première frame dont le nom ne commence pas par un préfixe de bibliothèque déclaré dans le profil (profil .NET : `System.`, `Microsoft.`) ;
si aucune ne convient, la première frame ; si l'entrée n'a pas de stack, pas de frame. Seule la syntaxe `   at Nom(arguments)` (.NET, Java) est reconnue ; le suffixe ` in fichier:line N` est retiré (le numéro change à chaque build). Un profil personnalisé ne déclare aucun préfixe : sa première frame est retenue.
Une entrée tronquée (`truncated`) peut avoir perdu sa stack : son empreinte est alors calculée sur le texte conservé.

**Profil structuré** (JSON lines, exports Log Analytics / App Insights) : une table de correspondance déclare le champ d'horodatage, de niveau, de message et d'exception, plus la table des niveaux
(texte ou numérique). Préréglages v1 : Serilog compact et Log Analytics / App Insights. Les noms exacts des colonnes d'un export sont relevés sur un échantillon réel, jamais supposés.

## 6. Sécurité propre au produit
(Règles générales — OWASP, dépendances — : skill `security-audit`.)
- **Contrôle d'accès** : appliqué par la configuration Static Web Apps (`routes` + `allowedRoles`), jamais par une vérification côté client. Un visiteur non connecté est redirigé vers la connexion ; une personne connectée mais non invitée est refusée.
- **Clé API** : `sessionStorage` par défaut, jamais journalisée, jamais envoyée ailleurs qu'au fournisseur choisi. L'interface recommande une clé
  dédiée à cet usage, avec un plafond de dépense si le fournisseur le permet.
- **CSP stricte** via `staticwebapp.config.json` : `connect-src` limité à une liste figée de domaines (Anthropic, Ollama local, Microsoft, Log Analytics, Azure Blob), aucun script tiers, **aucune télémétrie**
  (pas de Sentry ni d'analytics : le contenu des logs et les clés ne doivent jamais quitter le navigateur vers un tiers).
- **XSS** : jamais de HTML brut (pas de `dangerouslySetInnerHTML`) ; Markdown du modèle rendu sans HTML.
- **Redactor** avant tout envoi à un modèle (emails, IP, JWT, `Authorization`, chaînes de connexion, clés `sk-…`, `api_key=…`, cartes probables)
  + **aperçu « ce qui sera envoyé »** + troncature explicite à `maxInputChars`.
  **Masquage dès la préparation** : les mêmes règles sont proposées à l'utilisateur dans l'espace de préparation (cases à cocher, nombre d'occurrences, étiquette de remplacement du type `[EMAIL]`),
  appliquées à l'écran et dans l'aperçu d'envoi. `redact` reste le dernier filet : il s'applique à tout ce qui part, même si l'utilisateur n'a rien coché.
  Par défaut cochés : e-mails, jetons / clés / mots de passe, adresses IP. Proposés en option, non cochés : identifiants GUID et noms d'hôte dans les adresses web
  (**règles nouvelles, à valider à l'étape 6**). Le masquage est un meilleur effort : l'aperçu fait foi.
- **Logs = entrée non fiable** (injection de prompt) : délimiteur aléatoire par requête, JSON validé, rendu sans HTML ; voir `docs/PROMPTS.md`.
- **Chaîne d'approvisionnement** : dépendances minimales, versions épinglées, `npm audit` en CI.
- **Azure** : jeton Microsoft gardé en mémoire, portée minimale en lecture, jamais stocké.
- **Information de l'utilisateur** : l'interface indique toujours vers quel fournisseur partent les extraits.

## 7. Exigences non fonctionnelles
- Chargement initial léger (objectif indicatif < 300 Ko gzip, à mesurer) ; parsing hors du fil principal.
- Chrome/Edge : fonctionnalités complètes ; Firefox/Safari : sans sélecteur de dossier.

## 8. Décisions prises et questions restantes
Décidé : authentification GitHub ou Microsoft, accès sur invitation (25 personnes au maximum) ; import de fichiers exportés depuis n'importe quelle plateforme comme source par défaut ; vue à plat des erreurs (une ligne par entrée) ; analyse faite sur l'occurrence la plus récente et valable pour les occurrences identiques ; lignes voisines envoyées au modèle et visibles dans l'aperçu ; chat rattaché à une erreur, pas de chat global ; convention de tests `it('should … when …')` ; nom Sherlog ; hébergement Azure Static Web Apps en dérogation assumée à la règle globale Hetzner ; staging = prévisualisation par pull request puis production ; invitations conservées en v1, repli public si non viables ; code, TSDoc et commentaires en anglais, `docs/` en français ; interface en français, desktop-first ; les trois sources avancées (dossier, URL à domaines figés, Azure Monitor) en v1, avec ordre de coupe dans `ROADMAP.md` ; sources réelles : fichiers Serilog et Application Insights / Log Analytics ; parcours en quatre étapes sans automatisme (choisir un fichier ou coller du texte, préparer si besoin, analyser sur demande, envoyer à l'IA sur demande séparée) ; masquage proposé dès la préparation, `redact` conservé comme dernier filet ; règles « ignorer » par texte contenu ; aucun bouton d'exemple dans l'interface (les échantillons restent dans `samples/`).

À trancher (ne pas supposer) :
1. **Validation sur de vrais logs** : les échantillons de `samples/` sont synthétiques (construits d'après le modèle Serilog documenté), sauf `real-serilog.log` : leurs résultats attendus valident la cohérence de la spec, pas sa fidélité au réel.
   *Tranché* : l'auteur a fourni un extrait réel de **21 lignes** (sortie console Docker) au lieu des ~30 prévues ; il a été jugé suffisant pour clore l'étape 2. Il ne contient ni stack, ni message multi-ligne, ni `FTL` : ces cas ne sont vérifiés que sur du synthétique.
   Reste à fournir : un export réel Application Insights / Log Analytics avant l'étape 3b.
2. **Azure Monitor** : un workspace Log Analytics ou une ressource Application Insights avec des données est en préparation côté utilisateur ; l'enregistrement d'application Microsoft Entra (gratuit) se fait au moment du spike (étape 1).
3. **Autres plateformes** : un connecteur n'est étudié que si une plateforme précise est utilisée ; aucune n'a été vérifiée à ce jour.
4. **Fichiers à formats mélangés ou lignes illisibles** (par exemple des lignes `[10:32:39 BOOT INF]` au milieu d'un journal Serilog console) : la maquette refuse le fichier entier et montre la première ligne en cause. **Extrait réel fourni le 2026-11-08** : `samples/real-mixed-formats.log` (8 lignes, trois dispositions). Il reste à décider quoi en faire. **Décidé le 2026-11-08 (option A) : signaler seulement** — l'écran de préparation dit « N lignes ressemblent à un autre format (…) : elles sont lues comme la suite de l'entrée qui les précède », sans rien changer à la lecture ; un format à plusieurs motifs n'est pas fait. Constats vérifiés : l'application répond « format non reconnu » ; si l'utilisateur choisit à la main le format console (étape 4b, tranche 3), elle lit 5 entrées et **la ligne datée est absorbée par l'entrée qui la précède** (seule la ligne `BOOT` avant la première en-tête est signalée) ; avec le format fichier, elle lit 2 entrées et signale 2 lignes avant la première en-tête.
   Pistes non tranchées : profil à plusieurs motifs, compteur de « lignes à lire autrement », choix de lire ou d'écarter ces lignes. À décider à l'étape 4b, sur un échantillon réel.
5. **Période pour les profils avec date** : décidé le 2026-11-08 — deux champs date + heure à la minute, heures comparées **telles qu'écrites dans le journal** (le décalage horaire, par exemple `+01:00`, est ignoré et l'écran le dit), fin incluse à la minute ; fin avant début refusée (passage de minuit non géré). Réalisé à la tranche 2 de l'étape 4b (ADR-012).
6. **Entrées de santé journalisées au niveau erreur** : elles comptent comme erreurs tant que l'utilisateur n'a pas ajouté une règle « ignorer ». Faut-il proposer cette règle d'office quand `/health` apparaît dans des erreurs ? Non décidé.
7. **Règles de masquage GUID et nom d'hôte** : absentes de la liste initiale de `redact` ; leur ajout est à valider à l'étape 6, avec leurs faux positifs.
