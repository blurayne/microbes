# Keim (Germ)

> Knubbliges Bakterium ohne aktiven Antrieb. Driftet, opportunistisch,
> ohne Jagdverhalten — die schwächste Bedrohung im Spiel.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Kategorie | Bakterium |
| Körper | `lobed` |
| sizeMul | 0.55 |
| Granula | 14 |
| Patrouille / Angriff | 45 / 100 |
| Alarm-Beschleunigung | 80 |
| Hostility | `idle` |

## Wen greift es an

**Niemanden aktiv.** Der Keim hat im Sim keine eigene Combat-Rule
und keinen Aggro-Modus. Er driftet entlang der Hintergrundphysik
und wartet auf opportunistische Gelegenheiten — im Spiel
manifestiert sich das als langsame Hintergrundbedrohung, nicht
als gezielter Angriff.

## Wie greift es an

Passive Präsenz. Wenn ein Keim in Tissue-Kontakt gerät (im
Kampagnen-Design), erodiert er die Umgebung — eine Mechanik, die
im aktuellen Free-Game noch nicht implementiert ist. Im
Free-Game ist der Keim daher primär **Phagozyten-Futter**, das
sich nicht wehrt.

## Wann greift es an

- `hostility = 'idle'` — initiiert nichts.
- Kein `attract` oder `attack` definiert.
- Hostile-Fallback: wenn er selbst angegriffen wird, beschleunigt
  er auf `attackSpeed = 100`, **flieht aber nur**, statt zurück-
  zuschlagen.

## Schwächen / Konter

| Konter | Mechanismus | DPS |
|---|---|---|
| Neutrophile | Phagozytose | **6** |
| Makrophage | Phagozytose | 5 |
| Monozyt | Phagozytose | 4 |
| Dendritische | Sampling | 2 |

Die Neutrophile ist der Standard-Counter. Da Keime nicht zurück-
schlagen, geht jeder Angriff risikofrei aus.

## Verwandte Kapitel

- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [Neutrophile](../cells/neutrophil.md)
