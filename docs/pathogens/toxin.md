# Toxin

> Lösliche Toxin-Kristall-Partikel. Driftet, jagt nicht — aber
> jeder Kontakt richtet Schaden an. Die "Mine" des Spielfelds.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Toxin |
| Körper | `star` (zackige Kristallform), kernlos |
| sizeMul | **0.25** (kleinste Entität im Spiel) |
| Granula | 0 |
| Patrouille / Angriff | 30 / 80 |
| Alarm-Beschleunigung | 150 |
| Hostility | `idle` |

## Wen greift es an

Im Sim **keinen aktiv**. Das Toxin hat keine Combat-Rule und
keinen Aggro-Modus. Es funktioniert stattdessen als
**passive Mine**: jede Immunzelle, die das Toxin berührt, kassiert
Hostile-Fallback-Schaden (200/50/4 standard).

## Wie greift es an

**Drift + Kontaktschaden**. Anders als Pathogene mit aktivem
Angriff bleibt das Toxin auf seiner trägen Driftbahn. Wer auf
es zu läuft, läuft in den Schaden. Es repliziert sich nicht und
heilt nicht — ein Toxin ist eine **einmalige Bedrohung**, die
neutralisiert werden muss.

## Wann greift es an

- `hostility = 'idle'` — initiiert nichts selbst.
- Kein `attract`, kein `attack`, kein `dps`.
- Hostile-Fallback wirkt **gegen den Berührer**, nicht zugunsten
  des Toxins (das Toxin macht Default-Schaden zurück, geht aber
  bei diesem Tausch zugrunde, weil es nur ~55 HP hat).

## Schwächen / Konter

| Konter | Mechanismus | DPS |
|---|---|---|
| Mastzelle | Histamin-Burst (Fallback) | 4 |
| B-Zelle | Antikörper-Markierung | indirekt |
| Makrophage | Phagozytose | 5 |

Designziel: **B-Zellen-Antikörper** sind der eleganteste Konter,
weil sie das Toxin neutralisieren, ohne dass eine Phagozyte den
direkten Kontakt aushalten muss. Mastzellen entkernen lokale
Toxin-Wolken über ihren Histamin-Effekt.

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [B-Zelle](../cells/bcell.md)
- [Mastzelle](../cells/mast.md)
