# Prompt de démarrage à coller dans Claude Code (VS Code)

Place `CLAUDE.md`, `docs/` et `samples/` à la racine d'un dossier vide, ouvre-le dans VS Code, lance Claude Code, puis colle :

```
Lis CLAUDE.md, puis docs/SPEC.md, docs/ARCHITECTURE.md, docs/PROMPTS.md et docs/ROADMAP.md.

Utilise le skill orchestrator pour :
1. reformuler le projet en 10 lignes maximum ;
2. me poser les questions ouvertes du §8 de SPEC.md et me demander de confirmer les choix par défaut du §2 (ne suppose rien) ;
3. produire le plan détaillé à partir de ROADMAP.md, sans le contredire.

N'écris aucun code avant mon feu vert.
```

## Étapes suivantes
```
Réalise l'étape N de docs/ROADMAP.md avec les skills indiqués dans la table, puis arrête-toi pour validation.
```

## Astuces
- Mode Plan de Claude Code recommandé pour les étapes 0, 1 et 7.
- L'étape 1 (spikes) peut changer le périmètre : n'enchaîne pas sur l'étape 2 sans avoir lu son compte rendu.
- Fournis ~30 vraies lignes Serilog (`samples/real-serilog.log`) avant la fin de l'étape 2 et un export réel Application Insights avant l'étape 3b.
- La table des étapes a évolué (étapes 3b et 5b, étape 10 en 10a/10b/10c) : `docs/ROADMAP.md` fait foi.
