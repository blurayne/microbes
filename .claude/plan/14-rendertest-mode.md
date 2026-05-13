# Plan 14 — `?debug=1&test=render` static-render mode + Playwright artifact loop

## Context

PR #199 stood up a Playwright pair-diff rig (`tests/visual/game-vs-shader-test.spec.js`)
between the live game and `docs/shader-test.html` (the project's "source of
truth" for cell appearance). The captures bake in five sources of run-to-run
noise — **viewport size**, **device-pixel ratio**, **active background theme**,
**whatever camera the user last had**, and **whatever cell-pose drift the sim
produced** between page-load and Playwright's 400ms settle — which forces a
permissive `MAX_DIFF_RATIO = 0.30` discovery threshold instead of the ≈0.02
we want for parity gating (and is the reason the visual-test workflow was
paused in PR #202).

This plan adds a **deterministic, single-cell, tight-framed, optionally
translucent** render mode triggered by `?debug=1&test=render` (with
`?rendertest=1` as a shortcut), available on both pages. Output: a 672-PNG
artifact bundle attached to the Playwright report — a downloadable gallery
per cell × theme × renderer × bg.

Re-enabling the visual-test workflow + tightening `MAX_DIFF_RATIO` is **not**
in scope here. This PR only produces the artifact gallery so the next pass
has a deterministic baseline to diff against.

## URL param shape

Orthogonal + future-proof:

- `?debug=1` — capability gate. By itself does nothing visible.
- `?test=render` — selects the render-test behaviour. Requires `debug=1`.
- `?rendertest=1` — convenience alias for the pair.
- `?renderer=canvas2d|webgl2|webgpu` — game-only renderer pick. Strict
  (no silent fallback) when combined with rendertest mode.
- `?translucent=1` — transparent background instead of black.
- `?download=1` — auto-trigger PNG download with the explicit filename.
- `?w=<int>&h=<int>` — canvas size; default 512×512, clamped `[64, 4096]`.

Parser computes a derived `URL_OVERRIDES.rendertest = !!rendertest ||
(debug && test === 'render')` so downstream code checks a single boolean.

## Approach

One PR. All changes feature-flagged behind the derived `rendertest` boolean —
default boot path is untouched.

1. **`assets/core/url-overrides.js`** — add `debug`, `test`, `rendertest`,
   `translucent`, `download` bools + `w`, `h` ints; derive `rendertest`;
   force `pose = true` when rendertest is on.
2. **`assets/render/webgl2.js` (2043, 2625, 3021)** — `getContext('webgl2', {
   alpha: URL_OVERRIDES.translucent, ... })`; gate `clearColor` alpha 0 vs 1.
3. **`assets/render/webgpu.js` (2169, 2750+)** — `alphaMode:
   URL_OVERRIDES.translucent ? 'premultiplied' : 'opaque'`; module-level
   `RT_CLEAR_A` reused at every user-visible `clearValue.a`.
4. **`assets/render/canvas2d.js` (100–107)** — when translucent, replace
   `fillStyle '#000' + fillRect` with `clearRect`.
5. **`assets/app.js`** — strict `makeRenderer()` when `rendertest && renderer`;
   fixed-size `resize()` branch (W, H from URL or 512², dpr=1, renderScale=1);
   `applyRendertestCamera(sim, W, H)` helper; auto-capture hook beside the
   existing `?screenshot=1` block; expose `window.__RENDERTEST_READY__`.
6. **`assets/ui/screenshot.js`** — extend `takeScreenshot(ctx)` with
   `{ filename, skipSidecar, returnBlob }`. Existing callers untouched.
7. **`docs/shader-test.html` (2486–2602)** — mirror the seven flags + the
   `rendertest` derivation; gate `alphaMode`; fix canvas to W×H; set
   `params.zoom = 2.0`, `cellOffsetX/Y = 0`. Reuse `__takeShaderTestShot()`.
8. **`tests/visual/_fixtures.js`** (NEW) — extract `CELLS` + `THEMES` from
   `game-vs-shader-test.spec.js` so both specs share them.
9. **`tests/visual/rendertest.spec.js`** (NEW) — iterate game (3 renderers)
   + shader-test for cell × theme × bg; `page.locator('#stage').screenshot()`
   after `waitForFunction(() => window.__RENDERTEST_READY__)`; attach via
   `testInfo.attach()`. No diff in this PR.
10. **`package.json`** — add `"test:visual:rendertest"` script.

### Filename pattern

`{origin}_cell-{cellType}{kindN}_{theme}[_translucent].png`

- `origin`: `game-canvas2d` | `game-webgl2` | `game-webgpu` | `shadertoy`.
- `kindN`: numeric kind ID from `testKindFor(cellType)`. Suffixed directly
  to the cell name (no separator) so `cell-virus5`, `cell-bacterium14`.
- `_translucent`: only when `?translucent=1`. Black-bg is the default,
  no suffix.

Examples:
- `game-webgpu_cell-virus5_microscope.png`
- `game-canvas2d_cell-eukaryote0_cartoon_translucent.png`
- `shadertoy_cell-bacterium14_classic.png`

### Bbox-fit math

- **Game**: post-spawn, `c = sim.cells[0]`. `half = min(W, H) / 2`.
  `scale = half / (c.r * 1.1)` → bbox + 10% padding fills the shorter axis.
- **Shader-test**: `params.zoom = 2.0` → SDF body fills ~80% of canvas
  with ~10% padding. Constant for all cells; refine in a follow-up if
  any consistently overflow.

### Translucent download semantics

Per user decision: only emit what's on screen. `?translucent=1&download=1`
produces one transparent PNG. `?translucent=0&download=1` produces one
black PNG. No dual-emit.

## Playwright matrix

| Page         | Cells | Themes | Renderer axis              | BG axis             | Total |
|--------------|-------|--------|----------------------------|---------------------|-------|
| game         | 21    | 4      | canvas2d / webgl2 / webgpu | black / translucent | 504   |
| shader-test  | 21    | 4      | (single, label `shadertoy`) | black / translucent | 168   |
|              |       |        |                            | **Grand total**     | 672   |

## Critical files

| File                                          | Touched by                                                         |
|-----------------------------------------------|--------------------------------------------------------------------|
| `assets/core/url-overrides.js`                | Parser additions + `rendertest` derivation                         |
| `assets/app.js`                               | Strict dispatch + fixed resize + camera fit + capture hook         |
| `assets/render/webgl2.js`                     | `alpha:` flag + `clearColor` alpha gate                            |
| `assets/render/webgpu.js`                     | `alphaMode:` flag + `clearValue.a` gate                            |
| `assets/render/canvas2d.js`                   | Translucent `drawBackground` branch                                |
| `assets/ui/screenshot.js`                     | `takeScreenshot` signature extension                               |
| `docs/shader-test.html`                       | Mirror parser + fixed canvas + tight framing                       |
| `tests/visual/_fixtures.js` (NEW)             | Shared CELLS + THEMES                                              |
| `tests/visual/rendertest.spec.js` (NEW)       | 672-tuple matrix, attach artifacts                                 |
| `tests/visual/game-vs-shader-test.spec.js`    | Import shared fixtures (extract-only diff)                         |
| `package.json`                                | New script                                                         |

## Verification

1. `node --test` — 35-test suite green.
2. Render-module imports: `for r in canvas2d webgl2 webgpu; do node -e "import('./assets/render/${r}.js').then(()=>console.log(r))"; done`.
3. `node -e "import('./assets/core/url-overrides.js').then(m=>console.log(m.URL_OVERRIDES))"` → `{}` (no window).
4. Manual smoke URLs:
   - `…/index.html?rendertest=1&cellType=virus&theme=microscope&renderer=canvas2d` → black, virus at 512².
   - `…/index.html?debug=1&test=render&cellType=virus&theme=microscope&renderer=canvas2d` → identical (alias).
   - `…&translucent=1` → transparent.
   - `…&renderer=webgl2&w=1024&h=1024&download=1` → triggers download of `game-webgl2_cell-virus5_microscope.png`.
   - `…&renderer=webgpu` on no-WebGPU system → page-error (no silent fallback).
   - `…/docs/shader-test.html?rendertest=1&cellType=virus&theme=microscope&translucent=1` → tight framed, transparent.
5. `npm run serve` + `npm run test:visual:rendertest` → 672 attachments in `playwright-report/index.html`.

## Branch

`claude/pr-rendertest-mode` off fresh `main`. One PR. Auto-merge `squash`.

## Out of scope

- Re-enabling the visual-test workflow (still paused per PR #202).
- Diffing rendertest captures — only emit artifacts here.
- Per-cell shader-test zoom tuning — single constant `params.zoom = 2.0`.
- Linking the gallery from `cell-zoo.html`.
