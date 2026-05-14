# Spore

> Windgetragenes Pilz-Propagul. Driftet, wartet, repliziert sich
> nicht aktiv — aber lange ignorierte Sporen werden zu echten
> Pilzkolonien.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Pilz |
| Körper | `round`, Fuzz-Dekor (mikroskopischer Sporen-Saum) |
| sizeMul | 0.55 |
| Granula | 22 |
| Patrouille / Angriff | 50 / 110 |
| Alarm-Beschleunigung | 220 |
| Hostility | `idle` |

## Wen greift sie an

**Niemanden.** Die Spore hat keine Combat-Rule und keinen Aggro-
Modus. Sie ist die **passivste aktive Bedrohung** im Spiel —
weder Phagozyten-Fresslust löst sie aus, noch reagiert sie
spürbar auf Treffer.

## Wie greift sie an

Indirekt. Im Kampagnen-Design (siehe `ch04-konzept.md`,
`ch06-levels.md`) **keimt** eine Spore nach genügender
Verweildauer und wird zu einem **Schleim** oder einer
voll wachsenden Pilzkolonie. Im Free-Game ist die Keimung noch
nicht implementiert; die Spore bleibt eine driftende Markierung,
die ein Memento auf zukünftige Wellen ist.

## Wann greift sie an

Nie aktiv:

- `hostility = 'idle'`.
- Kein `attract`, kein `attack`, kein `dps`.

Sie reagiert nur defensiv auf Angriffe (Hostile-Fallback) und
beschleunigt dann auf `attackSpeed = 110`, **fliehend**, nicht
zurückschlagend.

## Schwächen / Konter

Jeder Phagozyt kann eine Spore eliminieren — sie ist klein
(sizeMul 0.55, ~73 HP) und wehrt sich nicht.

| Konter | DPS |
|---|---|
| Neutrophile | 4 (Pilz-Tag) |
| Makrophage | 5 |
| Monozyt | 4 |

Designhinweis: nicht-gekeimte Sporen sind **billig zu entsorgen**,
gekeimte (Schleime) verlangen ein höheres Investment.

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [Schleim](slime.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
