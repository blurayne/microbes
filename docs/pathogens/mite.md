# Milbe (Mite)

> Krabbelnder Arachnid-Parasit. Schnellster, grösster und am
> schwersten zu fassender Gegner — verlangt eine dedizierte
> Anti-Milben-Strategie.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Parasit |
| Körper | `round`, Beine-Dekor (8 Beine, achtbeinige Laufanimation) |
| sizeMul | **1.60** (eines der grössten Pathogene) |
| Granula | 4 |
| Patrouille / Angriff | **90 / 200** (schnellste Werte im Spiel) |
| Alarm-Beschleunigung | **420** (höchste im Spiel) |
| Hostility | `attack` |

## Wen greift sie an

**Rote Blutzellen** (`rbc`). Combat-Rule:

- `attract = 140`, `attack = 50`, `dps = 4`

Der DPS ist niedriger als bei der Amöbe (6), aber die Milbe
kommt **viel öfter durch** — `attackSpeed = 200` und
`alarmAccel = 420` machen sie für die meisten Immunzellen
unerreichbar.

## Wie greift sie an

**Krabbeln + Erodieren**. Die acht Beine (Dekor `legs`) treiben
die Milbe mit ungewöhnlich hoher Geschwindigkeit, und auf
Distanz < 50 Einheiten beginnt der 4-DPS-Erosionstick.

Mit ~136 HP (`60 * 1.60 + 40`) ist die Milbe das **zäheste
Pathogen** des Spiels.

## Wann greift sie an

- Detektion RBC: **140 Einheiten** (etwas weiter als die Amöbe).
- Engagement: ab **50 Einheiten**.
- `hostility = 'attack'`.

Was die Milbe so gefährlich macht, ist nicht die Detektion,
sondern die **Reaktionsgeschwindigkeit**. Sobald sie eine RBC
sieht, ist sie binnen Sekunden dort.

## Schwächen / Konter

Milben haben **dedizierte Hochschaden-Profile** bei zwei Special-
Zellen:

| Konter | Mechanismus | DPS |
|---|---|---|
| Mastzelle | Histamin-Burst (Milben-Tag) | **11** |
| Basophil | Heparin/Histamin (Milben-Tag) | **11** |
| Eosinophil | Granula-Toxine | 12 |
| T-Zelle | Cytotoxische Granula (parasit-Tag) | 8 |
| NK-Zelle | Granula-Lyse | 10 |

Designziel: Mastzelle und Basophil sind **die Konter** —
historisch sind das auch die Real-Welt-Allergie-Antworten auf
Hausstaubmilben. Der Eosinophil ist die generelle
Parasitenwaffe und schliesst die Lücke, wenn Milben zusammen mit
Amöben kommen.

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [Mastzelle](../cells/mast.md)
- [Basophil](../cells/basophil.md)
