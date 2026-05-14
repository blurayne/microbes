# NK-Zelle (Natural Killer)

> Tier 2 · Special · Angeborener Anti-Virus. Sprintet zu
> virusinfizierten Zellen und Parasiten und tötet sie ohne
> vorherige Antigen-Lernkurve.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Special (Spezialisten) |
| Körper | `round`, BigSpikes-Dekor (Cytotoxin-Vesikel) |
| Granula | 8 |
| Patrouille / Angriff | 70 / 170 |
| Alarm-Beschleunigung | **360** (höchste im Spiel) |
| Hostility | `attack` |

## Was greift sie an

**Viren** und **Parasiten** — beide Tags zugleich. Sie ist die
"Antwort auf Viren ohne Wartezeit": anders als die T-Zelle
braucht sie kein dendritisches Signal, kein Antigen-Lernen, kein
Lymphknoten-Pull.

## Wie greift sie an

**Granula-Lyse** — die NK-Zelle erkennt die fehlenden MHC-I-
Marker auf einer infizierten Zelle (Missing-Self-Erkennung) und
schiesst aus ihren `BigSpikes` Cytotoxine. Mechanisch:

- **Virus + Parasiten**: 10 dps bei Angriffsradius 40.

Der Schaden ist ein klares "**innate burst**" — niedriger als
T-Zellen-Niveau (12 dps), aber sofort verfügbar. Das ist der
Trade-off: weniger pro Treffer, dafür ohne Phase-Vorlauf.

Die Alarm-Beschleunigung **360** ist die höchste aller
Immunzellen — die NK-Zelle ist deshalb der **erste Verteidiger**,
sobald ein Virus den Bildschirm erreicht.

## Wann greift sie an

- Detektion: **220 Einheiten** für Viren und Parasiten.
- Engagement: ab **40 Einheiten** — der engste Strike-Radius
  unter den Damage-Dealern (T-Zelle 45, Eosinophil 40).
- `hostility = 'attack'`.

In Kombination mit dem hohen `attackSpeed = 170` ergibt das ein
charakteristisches Verhalten: sie sprintet aus dem Stand auf ihr
Ziel zu und springt fast hinein.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [05 · Adaptiver Codex](../ch05-codex.md) (NK ist die Ausnahme:
  ohne Phase-Vorlauf verfügbar)
