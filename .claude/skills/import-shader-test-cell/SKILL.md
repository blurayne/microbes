---
name: import-shader-test-cell
description: Use when porting a single cell type or theme from docs/shader-test.html into the live game's renderers (canvas2d / webgl2 / webgpu). Covers the file edits, visual-test loop, GDD update, and PR convention.
---

# Importing a shader-test specimen or theme into the game

shader-test (`docs/shader-test.html`) is the project's source of truth for cell visuals. The game's per-cell shader branches drift from it over time. This skill is the checklist for bringing one cell — or one theme — back to parity.

The parent plan is [`.claude/plan/13-shader-test-visuals.md`](../../plan/13-shader-test-visuals.md). Foundation PRs A → A.4 must already have landed before using this skill on a per-cell port.

## 1. Read the source

Open `docs/shader-test.html`. The shader is a single monolithic WGSL + GLSL ES 3.00 pair embedded in `<script>` blocks. Key spots (approximate, verify in your branch):

| What | WGSL | GLSL |
|------|------|------|
| Body SDF (per-kind shape) | L967–1069 | mirror around L1830 |
| Nucleus SDF | L1101–1138 | mirror |
| Cytoplasm colour (per-kind palette) | L1075–1097 | mirror |
| Theme branch (microscope / cartoon / kurzgesagt / classic) | L1560–1600 | L2282 |
| envBackground (per-bg theme) | L1147–1378 | L1890–2087 |

Both shaders must port — they're byte-mirrors. Pasting WGSL constants into the GLSL twin is mostly mechanical (`vec3<f32>(…)` → `vec3(…)`).

## 2. Edit files (renderer parity is mandatory per CLAUDE.md)

- **`assets/core/state.js`** — `CELL_TYPES` (L1896+). For a new cell: add the entry with `body.kind`, `decoration`, `sizeMul`, `category`, faction matrix. For a new theme: extend `KNOWN_THEME_KEYS` (L168) + i18n.
- **`assets/core/cell-kinds.js`** — `testKindFor()` (L24). Register the kind ID — must match shader-test's specimen kind.
- **`assets/render/webgl2.js`** — `testKind()` (L113). Inline a new branch under the existing `else if (tk == N)` pattern. Decorations use the `_decor*` family (L3529–3540).
- **`assets/render/webgpu.js`** — WGSL mirror of the webgl2 branch.
- **`assets/render/canvas2d.js`** — simplified static rendering, no animations. Fall back to legacy-look shapes; the canvas2d theme dispatch (L451/1108/1488) stays on the legacy code path. Document the gap explicitly in the PR description.
- **i18n** in all 5 active locales (`en/de/es/bar/latin`). New keys go into the per-locale objects in `state.js`. Missing keys fall through to English.

## 3. Visual test

Foundation infrastructure from PRs A.1–A.4 makes this fast:

1. **URL jump-load**: `?cellType=NEWKIND&theme=microscope&pose=1` spawns one centred cell, paused.
2. **Screenshot**: hit `window.__SCREENSHOT__()` in DevTools, or use the Settings → Debug → Screenshot button, or add `&screenshot=1` to the URL. Saves `microbes-<timestamp>.png` + a matching `.json` with theme, camera, cells.
3. **Side-by-side**: open `docs/cell-zoo.html?cellType=NEWKIND&theme=microscope` — bottom half embeds `shader-test.html` at the same kind. Eyeball the diff.
4. **CI parity**: `npm run test:visual` (Playwright) — per (cell × theme × renderer) screenshot diff against committed baselines. Thresholds: 0.01 canvas2d, 0.02 webgl2, 0.05 webgpu (WebGPU on Linux runners uses SwiftShader → slight drift). If your port intentionally changes the look, regenerate baselines with `npm run test:visual -- --update-snapshots` in the SAME PR.

Run all three renderers manually before opening the PR:

```bash
# In one tab each
http://localhost:8000/?cellType=NEW&theme=microscope&renderer=canvas2d&pose=1
http://localhost:8000/?cellType=NEW&theme=microscope&renderer=webgl2&pose=1
http://localhost:8000/?cellType=NEW&theme=microscope&renderer=webgpu&pose=1
```

## 4. GDD update

`docs/` is German-only. Match the existing tone (formal-technical, biology-accurate, ≤3-sentence paragraphs, heavy `§N` cross-references).

- **Immune cell** → add a `.cell-card` block to `docs/ch01-helden.md` mirroring existing cards. Include `data-friends` / `data-prey` / `data-foes` attributes — the summary table at the bottom of the page flattens these.
- **Pathogen** → same in `docs/ch02-pathogene.md`.
- **Extended (non-game) cell** → add to `docs/ch13-anhang.md` under `## Anhang B — Erweiterte Zellen`. Do NOT add to ch01/ch02 — extended cells are out of game balance.
- **New theme** → no GDD page is canonical for themes; the screenshot in the PR body suffices.

## 5. PR convention

One cell or one theme per PR. Auto-merge with squash on green CI.

Title format: `Port <cell> from shader-test` or `Theme <name>: shader-test parity`.

PR body must include:

- Side-by-side screenshots (game on left, shader-test on right) for each theme × renderer.
- Note about Canvas2D's deliberate simplification ("falls back to legacy look, no animations — per user direction").
- Mention any baseline updates: "regenerated `tests/visual/baselines/<cell>-*-*.png`".

After merge, the Pages-deploy workflow rebuilds; verify the live game shows the new visuals on the deployed `cell-zoo.html`.

## Faces feature

Cartoon faces (`S.cartoon` + `S.faceScale`) compose on top of the cell body via a separate face program (webgl2.js L1700+, webgpu.js L1715+, canvas2d.js `_drawCartoonFaces`). They're INDEPENDENT of per-kind body branches — your port doesn't touch the face pass. Just verify the face still lands centred on the new body by spawning a cartoon-mode-on cell with `?cartoon=1` (or toggle Settings → Display → Cartoon mode).

## Risks / gotchas

- **Kind-ID drift**: if shader-test's kind list ever reorders, `testKindFor()` must update in lockstep. Check `docs/shader-test.html`'s kind table against `cell-kinds.js:24` before porting.
- **Decorations vs body**: shader-test has some `if (kind == N)` branches that emit BOTH body and decoration in one block. The game splits decorations into `_decor*` calls. Keep them separate — the face pass + outline pass depend on the body alpha being clean.
- **WebGPU baseline flakes**: if Playwright reports a webgpu diff > threshold but the visual is correct by eye, regenerate just the webgpu baseline in a follow-up PR. The 0.05 threshold accommodates Vulkan / SwiftShader variance.
