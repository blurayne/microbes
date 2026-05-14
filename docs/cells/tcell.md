# T-Zelle (T-Killer / T-Helfer)

> Tier 1 · Core · Adaptiver Scharfschütze. Hoher Schaden gegen
> Viren und intrazelluläre Parasiten — die adaptive Spezialwaffe
> nach dem Dendritischen Signal.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Core (Säulen) |
| Körper | `round`, Y-Rezeptor-Dekor (wenige) |
| Granula | 0 (Cytotoxine, keine Vesikel) |
| Patrouille / Angriff | 70 / 160 |
| Alarm-Beschleunigung | 340 |
| Hostility | `attack` |

## Was greift sie an

Primär **Viren** (höchster DPS-Wert). Sekundär **virusartige
Pathogene und Parasiten** (Tag-Match `virus`, `parasite`). Andere
Erregerklassen werden ignoriert.

## Wie greift sie an

**Cytotoxische Granula-Freisetzung** — die T-Zelle erkennt am
Y-Rezeptor das spezifische Antigen und feuert Perforin/Granzyme
in das Ziel. Mechanisch:

- **Virus**: 12 dps bei Angriffsradius 45 — der höchste Single-
  Target-Schaden im Spiel.
- **Virus + Parasiten**: 8 dps bei Angriffsradius 45 (für
  virus-tagged Parasiten).

Die T-Zelle hat **0 Granula** als Vesikel-Inventar — ihre
"Munition" ist im Sim unbegrenzt, anders als bei der Mastzelle
mit 60 Granula.

## Wann greift sie an

- Detektion Virus: **240 Einheiten** (eine der grössten
  Reichweiten).
- Detektion Virus+Parasit: **220 Einheiten**.
- Engagement: ab **45 Einheiten**.
- `hostility = 'attack'`.

Designziel: die T-Zelle ist **schnell** (`patrolSpeed = 70`,
`attackSpeed = 160`) und **weit-detektierend**, weil sie
spezifische Antigene erst nach DC-Aktivierung "sieht". Im Spiel
ist sie deshalb keine Sofort-Counter, sondern eine zweite Welle.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [05 · Adaptiver Codex](../ch05-codex.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
