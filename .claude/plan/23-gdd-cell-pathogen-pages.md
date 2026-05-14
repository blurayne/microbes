# Plan 23 — GDD per-cell + per-pathogen detail pages

## Context

`docs/ch01-helden.md` (12 immune cells) and `docs/ch02-pathogene.md`
(8 pathogens) currently use one big card-grid HTML page per side
with a 1-line `cell-desc` per unit. The user wants deeper-dive
detail pages that answer three questions for each unit:

1. **Was** greift sie an / wen attackiert dieser Erreger?
2. **Wie** greift sie an (Mechanik im Spiel — Phagozytose,
   Granula-Burst, Antikörper, Drift, Replikation, …)?
3. **Wann** greift sie an (Trigger: Attraktionsradius,
   Hostility-Mode, idle vs. attack, Tag-Match, …)?

The combat numbers exist in `assets/core/sim-rules.js` and
`CELL_TYPES`. The new pages reuse them so a reader can
cross-check the GDD against the live sim.

## Audit

- `docs/ch01-helden.md` and `docs/ch02-pathogene.md` stay as
  the registry overview pages — short cards, link out.
- `docs/ch10-schaden.md` has the per-pair DPS matrix; new pages
  reference it for the full numbers.
- `mkdocs.yml` nav today is flat (one entry per chapter). Need
  to nest the per-cell + per-pathogen pages under their chapter
  entries so the sidebar stays tidy.
- Site language is **German** (per CLAUDE.md). New pages match.
- Pathogen-group taxonomy (`PATHOGEN_GROUPS` in state.js):
  `virus / bacteria / parasite / fungus / toxin`.

## Approach

### 1. New directories

- `docs/cells/` — 12 pages, one per immune cell.
- `docs/pathogens/` — 8 pages, one per pathogen.

### 2. Per-cell page template (markdown, German)

```markdown
# <Name>

> <Ein-Satz-Rolle aus CELL_TYPES.label + tier>

## Steckbrief
| Eigenschaft | Wert |
| --- | --- |
| Tier | Core / Special / Utility |
| Körper | round/lobed/rippled/oblong/pseudopod/star |
| Granula | n |
| Patrouille / Angriff | patrolSpeed / attackSpeed |
| Hostility | attack / idle |

## Was greift sie an
- Beute-Tags, mit Verweis auf den Pathogenkatalog.

## Wie greift sie an
- Mechanik in Worten — Phagozytose, Granula-Burst,
  Antikörper-Y-Ketten, etc. Cross-ref ch10 für DPS-Zahlen.

## Wann greift sie an
- Trigger: hostility-mode, attract-Radius, attack-Radius.
- Sonderbedingungen (z. B. „nur bei Mites", „nur bei Viren").

## Verwandte Kapitel
- [01 · Helden — Übersicht](../ch01-helden.md)
- [10 · Schadens-Matrix](../ch10-schaden.md)
```

### 3. Per-pathogen page template

Mirror of (2) but with:
- "Was infiziert / wen erbeutet er?" instead of "Was greift sie an".
- "Schwächen / Konter" section listing immune cells that
  hardcounter it (lifted from sim-rules attract/attack/dps).

### 4. Coverage list

**Immunzellen (12)** — neutrophil, monocyte, macrophage,
dendritic, tcell, bcell, NK, mast, basophil, eosinophil,
platelet, RBC.

**Pathogene (8)** — virus, germ, bacterium, amoebaP, mite,
slime, spore, toxin.

(Extended/test-only cells like `eukaryote` are skipped — they
aren't game-playable.)

### 5. mkdocs.yml nav

Wrap the two chapters as collapsible sub-trees:

```yaml
- 01 · Helden:
  - Übersicht: ch01-helden.md
  - Neutrophile: cells/neutrophil.md
  - Monozyt: cells/monocyte.md
  - …
- 02 · Pathogene:
  - Übersicht: ch02-pathogene.md
  - Virus: pathogens/virus.md
  - …
```

## Critical files

- `docs/cells/*.md` — 12 new pages.
- `docs/pathogens/*.md` — 8 new pages.
- `mkdocs.yml` — nav restructure for ch01 / ch02.
- `PLAN.md` — add plan 23 to Open.

## Verification

- `node --test` (no behaviour change; tests should still pass
  trivially since this is docs-only).
- If `mkdocs build` is locally available, run it and confirm
  the nav rebuild succeeds with no warnings. Otherwise rely on
  the GitHub Pages build step.
- Manual: open every new page in the rendered site and confirm
  the three sections (Was / Wie / Wann) are present.

## Branch

`claude/gdd-cell-pathogen-pages` (off main; independent of
plan 22's renderer branch).
