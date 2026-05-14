# Eosinophil

> Tier 2 · Special · Parasitenjäger. Hochspezialisiert auf
> Parasiten, mit dem höchsten Anti-Parasiten-Schaden im Spiel.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Special (Spezialisten) |
| Körper | `round`, Bilobenkern |
| Granula | 18 |
| Patrouille / Angriff | 60 / 130 |
| Alarm-Beschleunigung | 280 |
| Hostility | `attack` |

## Was greift sie an

**Parasiten** (`amoebaP`, `mite`) als einziges Ziel. Andere
Erregerklassen werden ignoriert. Im Gegensatz zur Mastzelle und
zum Basophil hat der Eosinophil **kein separates Milben-Profil**
— Parasit ist Parasit.

## Wie greift sie an

**Granula-Toxine** (Major Basic Protein, Eosinophil Cationic
Protein in der Biologie). Mechanisch:

- **Parasiten**: **12 dps** bei Angriffsradius 40 — der höchste
  Schaden eines Tier-2-Spezialisten und gleichauf mit der T-Zelle
  gegen Viren.

Die enge Angriffs-Reichweite (40) zwingt den Eosinophil näher
ans Pathogen zu kommen als jeder andere Granulozyt — das macht
ihn anfälliger, wenn der Parasit zurückschlägt.

## Wann greift sie an

- Detektion: **240 Einheiten**.
- Engagement: ab **40 Einheiten**.
- `hostility = 'attack'` — anders als Mastzelle / Basophil
  initiiert der Eosinophil aktiv. Er ist der einzige Tier-2-
  Special, der **selbst losläuft**.

Designziel: der Eosinophil ist die **erste Wahl** gegen
Parasitenwellen. Wer Mastzelle oder Basophil nicht in Position
hat, deckt mit Eosinophilen ab.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [02 · Pathogene — Amöbe & Milbe](../ch02-pathogene.md)
