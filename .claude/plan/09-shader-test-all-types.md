# 09 — Shader test: cover all game cell + pathogen types

## Context

PR #52 shipped `docs/shader-test.html` with 9 specimens. The full
game roster in `assets/core/state.js:838–1086` has **22 distinct
types**: 12 immune cells + 9 pathogens + RBC. Adding the missing
12 lets the doc page act as a faithful preview of every cell the
game ships with.

## Audit

- Existing dropdown: 0..8 (eukaryote, macrophage, neutrophil,
  nk-cell, b-cell, virus, bacterium, amoeba, spore).
- Helpers `membraneFor` / `cytoColor` / `nucleusSdf` already a
  per-kind switch — adding kinds is mechanical.
- Inline branches for special features (rough-ER, hex capsid,
  flagellum, double-wall) live in `main` — the new types add a
  few more (RBC biconcave, slime hyphae, toxin glow).
- Colours come straight from each type's `cytoBot` in
  `CELL_TYPES` — already a hand-tuned palette.

## Approach

Extend the dropdown to 21 entries (0..20). Add 12 new
`membraneFor`, `cytoColor`, `nucleusSdf` cases mirrored byte-for-
byte across the WGSL + GLSL shader pair. Three new compose-pass
effects: RBC biconcave (radial darken), slime hyphae (faint dark
filaments at the rim), toxin glow (violet halo).

Shapes chosen for microscope fidelity:

| # | Type        | Membrane                     | Nucleus      | Special                            |
|---|-------------|------------------------------|--------------|------------------------------------|
| 9 | monocyte    | round + high-freq ripple     | kidney       | normal vesicles                    |
|10 | mast        | slightly oblong              | round        | 60 dark green granules (signature) |
|11 | dendritic   | round + 6 long tendrils      | round-small  | tendrils-only                      |
|12 | basophil    | smooth round                 | bilobed      | 25 dark blue/violet granules       |
|13 | platelet    | small 10-point star          | none         | 4 small alpha-granules             |
|14 | t-cell      | very smooth round            | round-large  | nothing — clean lymphocyte         |
|15 | eosinophil  | smooth round                 | bilobed      | 18 large bright orange granules    |
|16 | rbc         | round disc                   | none         | dark biconcave depression          |
|17 | germ        | small 3-lobe                 | round-small  | bacterium-style                    |
|18 | slime       | irregular lobed              | none         | faint hyphal threads at rim        |
|19 | mite        | round + 4 leg bumps          | round        | textured cytoplasm                 |
|20 | toxin       | sharp 10-point spike star    | none         | violet glow + 8 sparkle dots       |

## Critical files

- `docs/shader-test.html` — single file. Dropdown + WGSL kind enum
  comment + WGSL helpers + WGSL inline branches + GLSL kind enum
  comment + GLSL helpers + GLSL inline branches.

## Verification

- `node --test` clean.
- Brace count balance check on both shader blocks.
- Manual: open the page, click through all 21 specimens.

## Branch

`claude/shader-test-all-types`.
