# Bakterium

> Stäbchen-Bakterium mit Geissel. Schnell, mobil, schwer zu
> fassen — aber ohne eigene Bewaffnung gegen Immunzellen.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Bakterium |
| Körper | `oblong` (Aspektverhältnis 1.8, Stäbchenform), Flagellum-Dekor |
| sizeMul | 0.55 |
| Granula | 8 |
| Patrouille / Angriff | **75 / 170** |
| Alarm-Beschleunigung | 340 |
| Hostility | `attack` |

## Wen greift es an

Im Sim hat das Bakterium **keine eigene Combat-Rule** —
`attract`, `attack` und `dps` gegen Immunzellen sind nicht
definiert. Trotzdem ist `hostility = 'attack'` gesetzt. Das
bedeutet: das Bakterium initiiert zwar Verfolgung, hat aber
keinen Schaden, sondern **rammt und entkommt**.

## Wie greift es an

**Flagellen-Motilität**. Die Dekoration `flagellum` ist eine
peitschende Geissel, die das Bakterium auf hohe Patrouillen-
Geschwindigkeit (75) bringt — schneller als jede Immunzelle
ausser dem Thrombozyten und der Milbe.

Strategisch ist das Bakterium deshalb ein **Fluchttier**: es
durchzieht den Bildschirm schneller, als ein langsamer Patrouill-
ist (Makrophage 40, Eosinophil 60) hinterherkommt. Wer es
fangen will, braucht Neutrophile (Patrouille 60, Angriff 150)
oder schnellere Spezialisten.

## Wann greift es an

- `hostility = 'attack'` — initiiert Verfolgung.
- Aber: kein Target-Lock auf Immunzellen, weil keine Combat-Rule
  greift.
- Im Effekt: Bakterien laufen schnell durchs Feld; ihre Wirkung
  ist **Druck statt Schaden**.

## Schwächen / Konter

| Konter | Mechanismus | DPS |
|---|---|---|
| Neutrophile | Phagozytose | **6** |
| Makrophage | Phagozytose | 5 |
| Monozyt | Phagozytose | 4 |

Da Bakterien schnell sind, ist die **Geschwindigkeit der
Neutrophile** der entscheidende Vorteil — Makrophagen kommen
oft zu spät. B-Zellen-Antikörper helfen dem Schwarm, weil
markierte Bakterien +75 % Schaden kassieren.

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [Neutrophile](../cells/neutrophil.md)
- [B-Zelle](../cells/bcell.md)
