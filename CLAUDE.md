# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

No build step — the game is vanilla ES modules served as static files.

```sh
npm test                     # node --test over test/*.test.js (~35 tests, sub-second)
node --test test/sim.test.js # run a single test file
npm run test:visual          # full Playwright visual suite (Chromium)
npm run test:visual:diff     # game ↔ shader-test pair diff only
npm run test:visual:update   # refresh visual baselines after intentional change
npm run serve                # python3 -m http.server 8000  (then open localhost:8000)
npm run build:docs           # mkdocs build → book/  (German GDD)
```

First-time setup for the visual suite: `npm install && npx playwright install --with-deps chromium`.

**Renderer module-import smoke** — run before any commit touching `assets/render/*.js`,
`assets/core/state.js`, or files they import (this is what CI gates on):

```sh
for r in canvas2d webgl2 webgpu; do
  node -e "import('./assets/render/${r}.js').then(()=>console.log('${r}: OK'))"
done
```

## Architecture

Vanilla ES modules, three pluggable renderers, no bundler.

- **Renderer cascade** (`webgpu → webgl2 → canvas2d`) — `app.js` constructs each in
  turn; if init or runtime throws (lost device, missing `navigator.gpu`, etc.) it
  cascades to the next. WebGPU is the default because Gray-Scott reactor backgrounds
  need compute shaders. WebGL2 mirrors WebGPU visually. Canvas2D is a graceful
  fallback — simpler bg pipeline, no FBO chain, no chained overlays, but the game
  still plays. **Visual changes typically have to land in all three** — document
  intentional gaps in the plan file.

- **`assets/core/state.js` is the single source of truth.** It owns `DEFAULTS`,
  `S = loadSettings()`, the 21-entry `CELL_TYPES` map, `THEMES`, `BACKGROUNDS`, and
  i18n tables (English inline; other locales lazy-load from `assets/i18n/*.json`).
  `loadSettings()` clamps numeric ranges, validates enums, and migrates legacy keys.
  Every new setting needs entries in `DEFAULTS` + i18n strings for all locales +
  (optionally) a migration shim.

- **`assets/core/cell-relations.js` is auto-generated** — do NOT edit it directly.
  Source of truth is the GDD card grids in `docs/ch01-helden.md` and
  `docs/ch02-pathogene.md`; regenerate with `tools/extract-cell-relations.mjs`.

- **Cell kind IDs are aligned 1:1 with `docs/shader-test.html` (kinds 0..20).**
  `cell-kinds.js`'s `testKindFor(type)` is the bridge so the per-kind SDF branches
  in the disk shader work identically across renderers.

- **Frame loop** (in `app.js`): `sim.update(dt) → renderer.draw(...) → updateNavArrows(ts)`
  driven by rAF. The face overlay is a separate render pass downstream of the cell
  body, so it works identically across all three renderers and four shader-test themes.

- **Background layer stack** (`S.bgLayers`): sortable list of preset references with
  per-layer opacity + blend mode. WebGL2/WebGPU sample bg passes in the disk shader;
  Canvas2D paints them sequentially via `globalCompositeOperation`.

- **Overlay stack** (`S.overlayOrder`): unified, drag-reorderable list of
  post-effects with a fixed `'scene'` pin. Overlays above `'scene'` run after the
  cell pass; below run on the bg-only RT. GPU renderers use a chained ping-pong FBO
  pipeline; Canvas2D only applies cheap blends (noise/vignette/crosshair).

Full module map, runtime loop diagram, settings surface, and overlay pipeline in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Plan tracking

Open work lives in [`PLAN.md`](./PLAN.md) + [`.claude/plan/`](./.claude/plan/)
(one numbered file per plan).

When **starting** a non-trivial change:

1. Drop a new file in `.claude/plan/` named `NN-kebab-case.md` (next two-digit
   number; never reuse).
2. The plan file follows the standard shape:
   `Context · Audit · Approach · Critical files · Verification · Branch`.
3. Add a checkbox entry to **PLAN.md → Open** with a relative link.

When **shipping**:

4. Open a PR titled with the plan's headline. Reference the plan file in the PR body.
5. After merge to `main`: flip `[ ]` → `[x]`, move the entry from **Open** to
   **Done**, append the merging PR # in parentheses.
6. Plan files in `.claude/plan/` are **never deleted** — they accumulate as
   project history.

## House rules

- **Always branch off `main`.** Never commit directly to main, and never stack PRs
  on feature branches — every PR's `base` is `main`, never another `claude/*`
  branch. If a follow-up depends on unmerged work, wait for the parent PR to land,
  then branch off the freshly-updated main.

- **One PR per logical change.** Big plans split into sub-PRs; the plan file
  describes the split.

- **Auto-merge when CI is green.** Every PR opened by a Claude session should have
  auto-merge enabled (`merge_method: squash`) immediately after creation via
  `mcp__github__enable_pr_auto_merge`. The user opted in May 2026 — just do it.

- **Announce branch / PR / build / codename after every merge.** Three numbers,
  three meanings — never conflate:
    - **PR number** — the GitHub PR that just merged (stable identifier).
    - **Build number** — the GitHub Actions Pages-deploy *run* number for the
      merge commit (different counter than PR #).
    - **Codename** — derived from the build run via `buildCodename(run)` in
      `assets/core/build-codename.js`.
  Include the **source branch** of the PR too. Format:
  ```
  PR #98 from claude/pr-b3-vesicles → main
  build #N · <codename> · deployed: https://blurayne.github.io/microbes/
  ```

- **Verify the deploy actually finished before announcing.** If a GitHub token
  lives at `~/.github-token` (chmod 600, outside the repo, never `git add`-ed),
  poll the workflow run for the merge commit *to completion* (status endpoint
  `/repos/blurayne/microbes/actions/runs/${RUN_ID}`) and only then report the URL.
  Run the poll in the background so the user sees it stream. Once
  `completed/success`, fetch `/repos/blurayne/microbes/pages` and report the
  `html_url`. On `completed/failure`, fetch the failing job's steps + logs so the
  user sees why before the next push. **Never commit the token.** No token →
  fall back to "(build # pending — you'll see it on next refresh)".

- **Pages source must be `build_type: workflow`.** If the API reports
  `build_type: legacy`, the custom `pages.yml` runs but its artifact is ignored —
  the deployed site comes from GitHub's built-in Jekyll workflow against raw
  `main`, so the stamp step never affects what users see. Fix:
  `PUT {"build_type":"workflow"}` to `/repos/blurayne/microbes/pages` (needs
  `pages:write`); on 403, ask the user to flip **Settings → Pages → Build and
  deployment → Source: GitHub Actions**.

- **Renderer parity.** When a visual change touches one renderer it usually has to
  land in the others too (canvas2d, webgl2, webgpu). Document any intentional gaps
  in the plan file.

- **No build step today.** Adding one is load-bearing — revisit ideas in
  [`IDEAS.md`](./IDEAS.md) before introducing tooling.

## Reference docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module map, render loop, renderer
  cascade, background layer stack, overlay pipeline, theme branches, full Settings
  surface, storage + URL state.
- [`TESTING.md`](./TESTING.md) — unit + module-import smoke + Playwright visual
  diffs; URL-param table; CI gating; baseline updates.
- [`RENDERERS.md`](./RENDERERS.md) — perf research; why Pixi was removed (PR #31);
  canvas2d vs webgl2 vs webgpu comparison.
- [`ALGORITHMS.md`](./ALGORITHMS.md) — non-obvious algorithms (currently:
  1D-greedy clustering for the off-screen nav-arrow indicators).
- [`IDEAS.md`](./IDEAS.md) — deferred ideas with revisit triggers.
- [`docs/`](./docs/) — German Game Design Document, rendered via MkDocs.
- [`.claude/skills/`](./.claude/skills/) — repeatable workflows (importing a cell
  or theme from `docs/shader-test.html`; debugging WebGL2 / WebGPU; mobile debut).
