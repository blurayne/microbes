# Red Blood Cell (RBC)

> Tier 3 · Utility · Atmosphärischer NPC. Erythrozyt — trägt
> Sauerstoff, fängt Viren ab, kämpft nicht.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Utility (Filler) |
| Körper | `oblong` (bikonkav), `bodyHollow = true` (Donut-Loch) |
| sizeMul | 0.55 |
| Granula | 0 |
| Patrouille / Angriff | 35 / 65 |
| Alarm-Beschleunigung | 80 |
| Hostility | `idle` |

## Was greift sie an

Keinen. Die RBC ist ein **passiver NPC** — sie hat im Free-Game
keine Combat-Rule und keinen Aggro-Modus. Stattdessen ist sie
**Beute für Pathogene**:

- **Viren** infizieren sie (vgl. [pathogens/virus.md](../pathogens/virus.md)).
- **Amöben** und **Milben** greifen sie aktiv an (siehe deren
  Pathogen-Seiten).

## Wie greift sie an

Gar nicht. Die RBC driftet entlang der Blutstrom-Physik (siehe
[Kapitel 11](../ch11-physik.md)). Ihre einzige Aktion ist
**Existenz**: sie füllt das Spielfeld mit Bewegung und gibt
visuellen Massstab für Pathogen-Grössen.

Das `bodyHollow = true`-Flag aktiviert die Donut-Loch-Rendering-
Variante des Cell-Shaders — RBCs sind bikonkav, der Kern fehlt.

## Wann greift sie an

Nie. `hostility = 'idle'` plus fehlende Combat-Rule heisst: die
RBC reagiert auf nichts. Sie ist die einzige Einheit auf dem
Spielfeld, die garantiert **kein Aggressor** ist.

In Spielmodi mit Organ-HP (Kapitel 8) sind verlorene RBCs einer
der Indikatoren für **L1 Organ-HP** — wenn zu viele RBCs durch
Viren entführt werden, sinkt die Sauerstoffversorgung des Organs.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [02 · Pathogene — Virus](../pathogens/virus.md)
- [11 · Physik & Magnetismus](../ch11-physik.md)
- [08 · Sieg & Regeln (HUD §8.2 · drei Lebensbalken)](../ch08-regeln.md)
