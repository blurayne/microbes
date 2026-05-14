# Thrombozyt (Platelet)

> Tier 3 · Utility · Wundverschluss. Kein Kampf — sondern
> mechanischer Support, der Schaden eingrenzt und Engstellen
> baut.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Utility (Support) |
| Körper | `star` (kernlos, biologisch korrekt) |
| sizeMul | **0.50** (kleinste Immuneinheit) |
| Granula | 4 |
| Patrouille / Angriff | **80 / 190** (höchste Geschwindigkeit) |
| Alarm-Beschleunigung | **400** (gleichauf mit Milbe) |
| Hostility | `idle` |

## Was greift sie an

**Niemanden** im direkten Sinn. Der Thrombozyt hat im Sim keine
Combat-Rule — `attract / attack / dps` sind alle leer.

## Wie greift sie an

Statt direktem Schaden ist der Plan (siehe `IDEAS.md` und
`ch04-konzept.md`), dass Thrombozyten:

- an verletzten Stellen **aggregieren** (Plaque-/Pfropfen-
  Bildung),
- den Pathogen-Durchfluss durch das Organ **drosseln** (geringere
  Effektiv-Geschwindigkeit für Erreger, die durch eine
  Thrombozyten-Wolke ziehen),
- bei späteren Spielmodi **Reparatur** des Organ-HP triggern.

Im aktuellen Free-Game-Stand sind diese Hooks noch nicht
implementiert; der Thrombozyt ist deshalb visuelles Atmo-
Element mit Implementierungs-Roadmap.

## Wann greift sie an

Trigger im aktuellen Sim: keiner. Sobald die Aggregations-
Mechanik landet, wird der Trigger entlang der `bumpFeedback`-
Kollisionsachse laufen: ein Thrombozyt, der ein Pathogen anstösst,
"klebt" und ruft weitere Thrombozyten heran.

`hostility = 'idle'`, `patrolSpeed = 80` (höchste), `alarmAccel =
400` — er reagiert blitzschnell auf Signale, kämpft aber nicht.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [04 · Konzept & Tiers](../ch04-konzept.md)
- [11 · Physik & Magnetismus](../ch11-physik.md)
