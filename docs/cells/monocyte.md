# Monozyt

> Tier 1 · Core · Generalist. Patrouillierender Phagozyt, der in
> jedes Pathogen beißt — keine Spezialisierung, dafür universell
> einsetzbar.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Core (Säulen) |
| Körper | `rippled` (Nierenkern) |
| Granula | 6 |
| Patrouille / Angriff | 50 / 110 |
| Alarm-Beschleunigung | 230 |
| Hostility | `attack` |

## Was greift sie an

Alle Pathogenklassen — Viren, Bakterien, Parasiten, Pilze,
Toxine. Der Monozyt unterscheidet im Sim nicht zwischen
Erreger-Tags und macht keinen Schaden-Bonus auf ein einzelnes
Ziel. Er ist die Allzweckwaffe.

## Wie greift sie an

**Phagozytose**. Sobald die Distanz zum Pathogen unter
`attack = 55` fällt, beginnt ein konstanter Schadenstick von
**4 dps**. Der Schaden ist gegen jeden Erreger gleich; die
fehlende Spezialisierung ist der Trade-off für die universelle
Reichweite.

Im Spiel-Design ist der Monozyt der **Vorläufer der Makrophage**
— in der Biologie wandelt er sich nach Tissue-Eintritt in die
gewebsständige Makrophage um. Auf dem Brett ist die Umwandlung
kein Mechaniker, aber die Patrouillen-Geschwindigkeit (50) und
geringe Granula-Zahl (6) markieren ihn als "Makrophage in
Ausbildung".

## Wann greift sie an

- Detektion: **200 Einheiten** Umkreis für **alle** Pathogene.
- Engagement: ab **55 Einheiten** Angriffsradius beginnt der
  DPS-Tick.
- `hostility = 'attack'` — initiiert eigenständig, ohne
  Vorab-Signal.

Der grosse Patrouillen-/Angriffs-Unterschied (50 → 110) macht
ihn zum klassischen "Lauerjäger": langsam unterwegs, aber
explosiv beim Zustoßen.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
