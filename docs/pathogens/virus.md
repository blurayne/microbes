# Virus

> Nano-Partikel mit Spike-Proteinen. Greift Roten Blutzellen
> direkt an, kapert ihre Maschinerie und repliziert sich.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Virus |
| Körper | `round`, Spikes-Pulsing-Dekor |
| sizeMul | **0.30** (kleinstes Pathogen ausser Toxin) |
| Granula | 0 |
| Patrouille / Angriff | 70 / 160 |
| Alarm-Beschleunigung | 320 |
| Hostility | `attack` |

## Wen greift es an

**Rote Blutzellen** (`rbc`). Der Virus hat als einziges Pathogen
ein explizites Combat-Profil gegen RBCs:

- `attract = 80`, `attack = 40`, `dps = 0`

Der DPS-Wert ist **0** — der Virus tötet die RBC nicht direkt,
sondern **infiziert** sie. Im Designdokument repliziert er sich
dann in der gekaperten Zelle (siehe Kampagnen-Notizen in
`ch04-konzept.md`).

## Wie infiziert er

**Spike-Protein-Kontakt**. Die pulsierenden Spikes (Dekor
`spikesPulsing`) sind die visuelle Signatur. Im Sim:

1. Virus kommt in 80 Einheiten Umkreis einer RBC.
2. Er beschleunigt auf `attackSpeed = 160` darauf zu.
3. Bei Distanz < 40 Einheiten findet **Infektion** statt — im
   Free-Game derzeit ohne sichtbare Replikation, im Kampagnen-
   Design alle ~4 s ein neues Virus-Partikel.

## Wann greift er an

- Detektion RBC: **80 Einheiten** (der niedrigste Attraktions-
  radius im ganzen Spiel).
- Engagement: ab **40 Einheiten**.
- `hostility = 'attack'`.

Der enge Detektionsradius macht den Virus zum **Lauerer** — er
sieht weit weniger weit als Immunzellen. Dafür ist er schnell
(`patrolSpeed = 70`) und klein (sizeMul 0.30), sodass er sich
zwischen Phagozyten durchschlängelt.

## Schwächen / Konter

| Konter | Mechanismus | DPS |
|---|---|---|
| T-Zelle | Cytotoxische Granula | 12 |
| NK-Zelle | Granula-Lyse (innate) | 10 |
| B-Zelle | Antikörper-Markierung | indirekt +75 % |
| Makrophage | Phagozytose | 5 |

NK ist die schnellste Antwort (innate, ohne Antigen-Vorlauf),
T-Zelle der härteste Schlag (adaptiv, nach DC-Aktivierung).

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [Red Blood Cell](../cells/rbc.md)
