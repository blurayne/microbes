# Mastzelle

> Tier 2 · Special · Histamin-Sentinell. Reagiert kaum auf Viren
> oder Bakterien — wartet stattdessen auf Parasiten und Milben
> und entleert dann ihr enormes Granula-Arsenal.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Special (Spezialisten) |
| Körper | `oblong` (rundkern), sizeMul 1.15 |
| Granula | **60** (das grösste Arsenal im Spiel) |
| Patrouille / Angriff | **28 / 60** (langsamste Werte) |
| Alarm-Beschleunigung | 130 |
| Hostility | `idle` (initiiert nicht von selbst) |

## Was greift sie an

**Parasiten** (`amoebaP`) im Standard. **Milben** (`mite`) als
Spezial-Bonus mit eigenem Hochschaden-Profil.

Sie ignoriert Viren, Bakterien, Pilze und Toxine vollständig —
sie sind kein Tag-Match.

## Wie greift sie an

**Histamin-Burst** — die Mastzelle ist überfüllt mit
Vesikeln (60 Granula sichtbar als Punktmuster im Cytoplasma).
Bei Kontakt mit Parasiten entleert sie diese als
Histamin/Heparin/TNF-Cocktail:

- **Parasiten**: 6 dps bei Angriffsradius 50.
- **Milben** (spezifischer Tag-Match): 11 dps bei Angriffsradius
  50 — fast doppelt so hoch.

Das hohe Milben-DPS spiegelt die reale Allergie-Immunologie wider
(Mastzellen sind die Hauptakteure bei Hausstaubmilben-
Reaktionen) und gibt der Mastzelle eine klare Nischenrolle im
Spiel: **Milben-Konter**.

## Wann greift sie an

- Detektion Parasiten: **220 Einheiten**.
- Detektion Milben: **260 Einheiten** — sie spürt Milben weiter
  als andere Parasiten.
- Engagement: ab **50 Einheiten**.
- `hostility = 'idle'` — sie **initiiert nicht selbst**, sondern
  reagiert nur, wenn ein Parasit in den Trigger-Radius eindringt.
  Im Sim heisst das: sie patrouilliert langsam mit Speed 28 und
  wartet.

Designziel: ein **stationärer Sentinell**, den du strategisch in
einem Korridor plazierst. Sie kommt langsam zum Ziel — wenn das
Ziel zu weit weg ist, verpasst sie es einfach.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [02 · Pathogene — Milbe](../pathogens/mite.md)
