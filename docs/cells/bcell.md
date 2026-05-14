# B-Zelle

> Tier 1 · Core · Antikörperfabrik. Macht selbst **keinen
> Nahkampfschaden** — sondern beschiesst Pathogene aus der Distanz
> mit Y-Antikörperketten, die das Team verstärken.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Core (Säulen) |
| Körper | `round`, Y-Rezeptor-Dekor (viele) |
| Granula | 0 |
| Patrouille / Angriff | 55 / 120 |
| Alarm-Beschleunigung | 260 |
| Hostility | `attack` |

## Was greift sie an

Alle Pathogene — Viren, Bakterien, Parasiten, Pilze, Toxine.
Die B-Zelle macht keinen Unterschied; ihre Antikörper-Y-Ketten
binden an jedes Antigen.

## Wie greift sie an

**Antikörper-Sekretion**, kein Nahkampf. Im Sim ist das so
modelliert:

- `attack = 0` und `dps = 0` — sie taucht **nicht** ein.
- `attract = 280` — die **grösste Reichweite** aller Immunzellen.

Stattdessen feuert sie (Plan #3c, sichtbare Y-Ketten) **Antikörper-
projektile** auf die identifizierte Beute. Die Y-Ketten haften am
Pathogen und verstärken den Schaden anderer Phagozyten **um
+75 %**. Eine B-Zelle alleine tötet also nichts — eine B-Zelle
plus Neutrophile kommt schneller durch ein Bakterium als zwei
einzelne Neutrophile.

Die hohe Y-Rezeptor-Dichte am Körper (`yReceptorsMany`-Dekor) ist
die visuelle Erinnerung: viele Antigen-Bindungsstellen, jede ein
potentielles Antikörper-Template.

## Wann greift sie an

- Detektion: **280 Einheiten** auf jedes Pathogen — sie sieht
  weiter als alle anderen.
- Engagement: 0 — sie geht **nie** in den Nahkampf.
- `hostility = 'attack'`.

Designziel: die B-Zelle als **Force Multiplier**, nicht als
Killer. Sie macht andere Zellen besser. Sie kann selbst nicht
sterben, weil sie kein Pathogen anfasst — sie steht im Hinterland
und feuert.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [05 · Adaptiver Codex](../ch05-codex.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
