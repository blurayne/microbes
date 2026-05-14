# Basophil

> Tier 2 · Special · Zirkulierender Granulozyt. Mastzellen-Cousin
> im Blutkreislauf — gleiche Parasiten-Spezialisierung, mobiler,
> aber mit kleinerem Granula-Vorrat.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Special (Spezialisten) |
| Körper | `round`, Bilobenkern |
| Granula | 22 |
| Patrouille / Angriff | 45 / 95 |
| Alarm-Beschleunigung | 200 |
| Hostility | `idle` |

## Was greift sie an

**Parasiten** und **Milben**, ähnlich wie die Mastzelle.
Anders als sie ist der Basophil mobil und kommt schneller in
Position — deckt also einen grösseren Bereich ab, dafür mit
geringerer Maximal-Dauerleistung (22 Granula vs. 60 bei der
Mastzelle).

## Wie greift sie an

**Granula-Release** mit Heparin und Histamin. Mechanisch:

- **Parasiten**: 9 dps bei Angriffsradius 45 — höher als die
  Mastzelle (6) gegen Standard-Parasiten.
- **Milben**: 11 dps bei Angriffsradius 50 — gleich wie die
  Mastzelle, was beide zu spezialisierten Milben-Killern macht.

Im Kontrast zur Mastzelle: höhere Mobilität (`patrolSpeed = 45`
statt 28) → der Basophil ist ein **Streifenpolizist**, die
Mastzelle ist ein **Wachposten**.

## Wann greift sie an

- Detektion Parasiten: **240 Einheiten**.
- Detektion Milben: **260 Einheiten**.
- Engagement: ab **45 Einheiten** (Parasiten) bzw. **50** (Milben).
- `hostility = 'idle'` — wie die Mastzelle. Auch der Basophil
  wartet, bis ein Parasit den Trigger-Radius erreicht.

Bei beiden gilt: weil sie nicht initiieren, eignen sie sich als
**Stütze hinter den Frontkämpfern** — ein Neutrophil zieht die
Bakterien, der Basophil greift die Parasiten ab, die mit
durchziehen.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [Mastzelle](mast.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
