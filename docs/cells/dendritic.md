# Dendritische Zelle

> Tier 1 · Core · Brücke. Antigen-präsentierende Späherin —
> niedriger Direktschaden, dafür die Brücke vom angeborenen zum
> adaptiven Immunsystem.

## Steckbrief

| Eigenschaft | Wert |
| --- | --- |
| Tier | Core (Säulen) |
| Körper | `round` (kleiner runder Kern), Tendrils-Dekor |
| Granula | 0 |
| Patrouille / Angriff | 50 / 110 |
| Alarm-Beschleunigung | 240 |
| Hostility | `attack` |

## Was greift sie an

Alle Pathogene — Viren, Bakterien, Parasiten, Pilze, Toxine.
Sie engulft sie, aber **erheblich schwächer** als ein
Phagozyten-Spezialist; ihre Aufgabe ist primär das
**Sampling und Markieren**.

## Wie greift sie an

**Antigen-Sampling**: Die Dendritische Zelle nimmt einen Bissen
vom Pathogen (im Sim: konstanter Tick von **2 dps**, der
niedrigste Schaden aller Phagozyten) und "präsentiert" das
Antigen anschliessend an T- und B-Zellen.

Im aktuellen Free-Game ist die Antigen-Präsentation noch nicht
als sichtbarer Buff implementiert; im Kampagnen-Design (siehe
[Kapitel 5 · Codex](../ch05-codex.md)) schaltet die DC die
adaptive Phase frei — danach werden T-Killer und B-Zellen
spawnbar.

Die langen, dünnen **Tendrils** (Dekoration `tendrils`) sind die
visuelle Signatur: sechs lange Fühler, die nach Antigen schmecken.

## Wann greift sie an

- Detektion: **180 Einheiten** — der **niedrigste Attraktions-
  radius** aller Phagozyten. Sie reagiert nur auf nahe Pathogene.
- Engagement: ab **50 Einheiten**.
- `hostility = 'attack'`.

Die enge Detektion ist Absicht: die DC soll nicht der primäre
Frontkämpfer sein. Sie sammelt nur ein, was ohnehin schon in
ihrer Nähe ist, und schickt das Signal weiter.

## Verwandte Kapitel

- [01 · Helden — Übersicht](../ch01-helden.md)
- [05 · Adaptiver Codex](../ch05-codex.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
