# Amöbe (✗)

> Pseudopod-Parasit. Kriecht aktiv auf Rote Blutzellen zu und
> umschliesst sie wie eine bösartige Mini-Makrophage.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Parasit |
| Körper | `pseudopod` (Nierenkern), Tentakeln-Dekor |
| sizeMul | 1.25 |
| Granula | 6 |
| Patrouille / Angriff | 35 / 75 |
| Alarm-Beschleunigung | 150 |
| Hostility | `attack` |

## Wen greift sie an

**Rote Blutzellen** (`rbc`). Combat-Rule:

- `attract = 120`, `attack = 50`, `dps = 6`

Im Gegensatz zum Virus, der RBCs nur infiziert, **frisst** die
Amöbe die RBC aktiv weg (6 dps Tick). Auf der Bildschirmebene
sieht es aus wie eine kleine Makrophage, die das falsche Ziel
verfolgt.

## Wie greift sie an

**Pseudopod-Engulfment**, gespiegelt zur Makrophagen-Mechanik:
die Tentakeln-Fortsätze (Dekor `tentaclesWiggling`) umfliessen
die RBC, und sobald der Angriffsradius erreicht ist, läuft der
6-DPS-Schadenstick.

Die Amöbe ist mit `sizeMul = 1.25` **gross** — grösser als die
meisten Immunzellen — und mit ~115 HP (vgl. `defaultHp()` in
`sim-rules.js`) auch zäh. Zwei Neutrophile (6 dps each) brauchen
~10 s, um eine einzige Amöbe zu killen.

## Wann greift sie an

- Detektion RBC: **120 Einheiten**.
- Engagement: ab **50 Einheiten**.
- `hostility = 'attack'` — die Amöbe **initiiert** und verfolgt
  aktiv die nächste RBC.

Patrol-Speed 35 ist langsam, aber `attackSpeed = 75` und
`alarmAccel = 150` reichen, damit die Amöbe RBCs einholt, sobald
sie sie gesehen hat.

## Schwächen / Konter

| Konter | Mechanismus | DPS |
|---|---|---|
| Eosinophil | Granula-Toxine | **12** |
| Basophil | Heparin/Histamin | 9 |
| T-Zelle | Cytotoxische Granula (virus+parasit Tag) | 8 |
| NK-Zelle | Granula-Lyse | 10 |
| Mastzelle | Histamin-Burst | 6 |

Eosinophile sind der Hauptkonter; NK-Zellen schliessen die Lücke,
weil sie sofort verfügbar sind.

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [Eosinophil](../cells/eosinophil.md)
- [Red Blood Cell](../cells/rbc.md)
