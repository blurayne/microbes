# Neutrophile

> Tier 1 · Core · Soldat. First Responder des angeborenen Immunsystems —
> die häufigste weiße Blutzelle und der zuverlässige Bakterien-Fresser
> des Spielfelds.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Core (Säulen) |
| Körper | `lobed` (multilobiger Zellkern) |
| Granula | 28 |
| Patrouille / Angriff | 60 / 150 |
| Alarm-Beschleunigung | 320 |
| Hostility | `attack` (greift aktiv an) |

## Was greift sie an

Neutrophile fokussieren sich auf **Bakterien** (`germ`,
`bacterium`) und nehmen **Pilze** (`slime`, `spore`) als Sekundärziel
mit. Andere Erregerklassen — Viren, Parasiten, Toxine — werden
ignoriert; dafür sind T-Zellen, Eosinophile und Mastzellen
zuständig.

## Wie greift sie an

Klassische **Phagozytose**: Wenn ein Bakterium oder ein Pilz in
den Patrouillenbereich gerät, beschleunigt die Neutrophile auf
`attackSpeed = 150` und rammt das Ziel. Sobald die Distanz unter
den Angriffsradius fällt, beginnt der Schaden-pro-Sekunde-Tick:

- Bakterien: **6 dps** bei Angriffsradius 50.
- Pilze: **4 dps** bei Angriffsradius 50.

Die volle DPS-Matrix steht in
[Kapitel 10 · Schadens-Matrix](../ch10-schaden.md).

## Wann greift sie an

Triggerbedingungen sind ausschließlich räumlich — kein
Antigen-Lernen, keine Vorab-Markierung nötig:

- **Bakterien** im Umkreis von **220 Einheiten** lösen Verfolgung
  aus.
- **Pilze** im Umkreis von **200 Einheiten** lösen Verfolgung
  aus.
- Außerhalb dieser Radien bleibt sie im Patrouillenmodus
  (`patrolSpeed = 60`).

Da `hostility = 'attack'` gesetzt ist, initiiert die Neutrophile
aktiv (sie wartet nicht, bis sie selbst angegriffen wird).

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
- [02 · Pathogene — Übersicht](../ch02-pathogene.md)
