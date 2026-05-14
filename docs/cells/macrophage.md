# Makrophage

> Tier 1 · Core · Wachposten. Der "Big Eater" — langsamer
> Patroullist, aber unermüdlicher Phagozyt mit der grössten
> Körpermasse des Immunsystems.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Core (Säulen) |
| Körper | `pseudopod` (Nierenkern), sizeMul 1.45 |
| Granula | 12 |
| Patrouille / Angriff | 40 / 90 |
| Alarm-Beschleunigung | 180 |
| Hostility | `attack` |

## Was greift sie an

Alle Pathogene — Viren, Bakterien, Parasiten, Pilze, Toxine.
Sie ist neben dem Monozyten die zweite Universal-Phagozyte des
Spiels. Im Gegensatz zur schnellen Neutrophile fokussiert sie
nicht auf Bakterien; ihr Schaden ist breitbandig und
unverhandelbar.

## Wie greift sie an

**Pseudopod-Phagozytose** — die ausstülpenden Scheinfüsschen
umfliessen das Pathogen und schliessen es ein. Mechanisch
bedeutet das einen konstanten Tick von **5 dps**, sobald die
Distanz unter den Angriffsradius **60** fällt.

Die hohe Grösse (`sizeMul = 1.45`, grösste der Immunzellen)
macht die Makrophage zu einem **schweren Anker** — sie blockiert
Pfade physisch, weil andere Zellen sie nicht so leicht
durchdringen.

Im Free-Game-Modus hat sie **unendlich HP** (siehe
`defaultHp(type)` in `sim-rules.js`), während Pathogene durch
Größe skaliert sind. Der Makrophagen-Block ist im Spiel deshalb
fast ein passives Bollwerk.

## Wann greift sie an

- Detektion: **200 Einheiten** für jedes Pathogen.
- Engagement: ab **60 Einheiten** Angriffsradius.
- `hostility = 'attack'` — proaktiv, ohne dass jemand ihn
  aktivieren müsste.

Der niedrige `patrolSpeed = 40` und `attackSpeed = 90` macht ihn
zum **Langsamläufer** — er erreicht weit entfernte Bedrohungen
nicht rechtzeitig. Stattdessen muss er strategisch da plaziert
werden, wo Pathogene durchziehen.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [11 · Physik & Magnetismus](../ch11-physik.md)
