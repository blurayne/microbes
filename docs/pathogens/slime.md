# Schleim (Slime)

> Biofilm-Globule mit toxischem Tropf. Treibt langsam, greift
> nicht selbst zu, vergiftet aber alles in seiner Aura.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Pilz |
| Körper | `lobed`, **kernlos** (Pilz, kein Eukaryot), Drips-Dekor |
| sizeMul | 1.30 |
| Granula | 8 |
| Patrouille / Angriff | 30 / 65 |
| Alarm-Beschleunigung | 130 |
| Hostility | `attack` |

## Wen greift es an

Im Sim hat der Schleim **keine eigene Combat-Rule**. `hostility =
'attack'` ist gesetzt, was bedeutet, dass er Immunzellen
verfolgt — aber ohne `attract` / `attack` / `dps` greift er
nicht regulär an. Stattdessen wirkt seine **Drip-Aura**.

## Wie greift es an

**Toxin-Drip**. Die Dekoration `drips` ist eine animierte Reihe
fallender Sekundärmetabolit-Tropfen, die im Sim als visueller
Marker für die Toxin-Wolke fungieren. Der Schaden ist
**chemisch** und wirkt im Designdokument auf:

- naheliegendes Tissue (Tissue-Erosion, vgl. ch11-Physik),
- benachbarte Immunzellen ohne enzymatischen Schutz.

Im aktuellen Free-Game-Stand ist die Drip-Schadenslogik noch
nicht im Sim, der Schleim wirkt deshalb hauptsächlich als
**Platzblocker**.

## Wann greift es an

- `hostility = 'attack'`.
- Keine spezifischen Combat-Rules.
- Hostile-Fallback (default 200/50/4) greift, sobald er angegriffen
  wird — er **wehrt sich** mit 4 dps gegen den Angreifer.

Das macht den Schleim zu einem **Counter-Damage-Tier**: wer ihn
zu nah angreift, kassiert zurück.

## Schwächen / Konter

| Konter | Mechanismus | DPS |
|---|---|---|
| Neutrophile | Phagozytose | 4 |
| Makrophage | Phagozytose | 5 |
| Monozyt | Phagozytose | 4 |

Da der Schleim langsam ist (Patrouille 30) und ~118 HP hat
(`60 * 1.30 + 40`), reicht ein Makrophagen-Block, um ihn zu
zermürben. Die T-Zelle hilft nicht — Pilze sind nicht in ihrer
Tag-Liste.

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [Makrophage](../cells/macrophage.md)
