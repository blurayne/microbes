# 13 — Shader-test visual parity for in-game cells

## Context

`docs/shader-test.html` is the project's source of truth for how each cell type *should* look — a single self-contained page with monolithic WGSL + GLSL ES 3.00 shaders, 4 themes, and 21 specimens (kinds 0–20). The live game renders the same 20 cells (kinds 1–20) with bespoke per-cell branches that have drifted from the shader-test reference over many PRs.

We bring the game's appearance, colours, animations and themes into exact parity with shader-test — **except the legacy theme which stays untouched**. Microscope / cartoon / kurzgesagt / classic get overhauled. The one shader-test-only specimen (`eukaryote`, kind 0) becomes a new *extended* cell, opt-in via `S.extendedCells`, with basic gameplay wiring (HP, AI, faction matrix).

Canvas2D is intentionally simplified per user direction (May 2026): no animations, simple static rendering, legacy-look fallback. The cartoon-face feature (`S.cartoon` + `S.faceScale`) keeps composing on top of whichever body the renderer drew.

## Audit

- **shader-test**: `docs/shader-test.html` L967–1138 `bodySdf` + `nucleusSdf`, L1075–1097 `cytoColor`, L1560–1600 (WGSL) / L2282 (GLSL) theme branch, L1147–1378 `envBackground`.
- **Game CELL_TYPES**: `assets/core/state.js` L1896–2144, 20 types with `body.kind` / `decoration` / `sizeMul`.
- **Theme dispatch**: webgl2.js L1984 `_themeId()`, L3242 `u_theme`; webgpu.js L58 `_wgpuThemeId()`, L3717 uniform slot 13; canvas2d.js L451/1108/1488.
- **Kind alignment**: `testKindFor(cellType)` in `cell-kinds.js:24` already produces kind IDs matching shader-test (verified during Phase-1 audit).
- **Face overlay**: composes after the cell body via the face program (webgl2.js L1700+, webgpu.js L1715+, canvas2d.js `_drawCartoonFaces`) — independent of any per-kind body branch, so visual port doesn't touch it.

## Approach

Inline new branches alongside `testKind()` rather than build a per-specimen module system (forbidden by the "no build step" rule in CLAUDE.md). Add `// region: kindN <name>` markers for future mechanical extraction.

Canvas2D uses the existing legacy-theme path for every theme — no animations, no per-theme palette tint. Document the deliberate gap in this file.

## PR split

10 small focused PRs, branched off fresh `main`. Foundation PRs (A → A.4) land serially because subsequent work depends on them; per-cell ports (PR C.*) parallelise via sub-agents, one cell per PR.

| #     | Branch                                       | Scope |
|-------|----------------------------------------------|-------|
| **A** | `claude/pr-13a-plan-skill-toggle`            | Plan file + skill file + `S.extendedCells: false` + i18n + filter hook + `bindCheckbox`. No cells yet. |
| A.1   | `claude/pr-13a1-url-params`                  | `?cellType=…&theme=…&pose=1&extended=1` parser in `app.js` after `loadSettings()`. In-memory only. |
| A.2   | `claude/pr-13a2-screenshot-helper`           | `window.__SCREENSHOT__()` + `?screenshot=1` + Settings → Debug button. Dumps PNG + sim-state JSON. |
| A.3   | `claude/pr-13a3-cell-zoo`                    | `docs/cell-zoo.html` side-by-side compare; linked from mkdocs.yml. |
| A.4   | `claude/pr-13a4-playwright-harness`          | Playwright devDep + `tests/visual/*.spec.js`. Per-renderer pixel-diff thresholds (canvas2d 0.01, webgl2 0.02, webgpu 0.05). CI job appended to pages.yml. |
| B     | `claude/pr-13b-eukaryote-extended`           | `eukaryote` CELL_TYPES entry + render branch + basic gameplay (HP 8, AI drift, foes virus/bacterium/slime). |
| C.*   | `claude/pr-13c-port-<cell>`                  | One PR per cell — ports webgl2 + webgpu visuals; canvas2d gets the legacy fallback. Sub-agents parallelise. |
| E     | `claude/pr-13e-theme-overhaul`               | Microscope / cartoon / kurzgesagt / classic re-pointed to shader-test theme block. Legacy untouched. |
| F     | `claude/pr-13f-gdd-appendix-and-tables`      | German docs: `## Anhang B — Erweiterte Zellen` + `## Übersichtstabelle` sections. |

## Eukaryote — basic gameplay

```
eukaryote: {
  category: 'good',
  extended: true,
  body: { kind: 'eukaryote', radius: 1.0 },
  decoration: 'none', sizeMul: 1.15,
  ai: 'drift', hp: 8, attack: 0, speed: 0.3,
  friends: [], prey: [], foes: ['virus','bacterium','slime'],
  i18n: 'cell.eukaryote',
}
```

## Critical files

- `assets/core/state.js` — DEFAULTS L114, CELL_TYPES L1896, i18n L665+/L857+
- `assets/core/cell-kinds.js` — L24 `testKindFor()`
- `assets/app.js` — L774 bindCheckbox, L1720 renderHelpList, settings init
- `assets/render/{canvas2d,webgl2,webgpu}.js` — per-kind body + theme branches
- `docs/shader-test.html` — read-only source of truth
- `docs/cell-zoo.html` — new visual-test entry
- `docs/ch01-helden.md`, `ch02-pathogene.md`, `ch13-anhang.md` — GDD pages
- `.claude/skills/import-shader-test-cell/SKILL.md` — repeatable workflow

## Verification

Per PR:
1. `node --test` (35+ tests pass).
2. Renderer-import smoke: `for r in canvas2d webgl2 webgpu; do node -e "import('./assets/render/${r}.js').then(()=>console.log(r))"; done`.
3. `npm run test:visual` (Playwright, once A.4 lands) for the cells/themes the PR touches.
4. Open `cell-zoo.html` with the relevant `?cellType=…&theme=…&renderer=…`, screenshot via `__SCREENSHOT__()` or `?screenshot=1`, paste in PR body.

## Branch

This file documents the parent plan. Per-PR branches listed above.
