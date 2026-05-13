# Microbes — Immunsystem als Spiel

[![Deploy to GitHub Pages](https://github.com/blurayne/microbes/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/blurayne/microbes/actions/workflows/pages.yml)
[![Visual tests](https://github.com/blurayne/microbes/actions/workflows/visual-test.yml/badge.svg?branch=main)](https://github.com/blurayne/microbes/actions/workflows/visual-test.yml)

A 2D sandbox + level-based simulation of the human immune system. Twelve immune-cell types and twelve pathogen types live, drift, hunt and die autonomously on a canvas; the player composes a roster, places cells, and watches the cascade unfold.

> Inspired by Kurzgesagt's "Immune System" explainer series. Designed to be biologically accurate enough to teach + arcade-y enough to play.

## Live demo

- **Game** → <https://blurayne.github.io/microbes/>
- **Game Design Document (German)** → <https://blurayne.github.io/microbes/book/>
- **Shader-test sandbox** (one WGSL/GLSL shader, 21 specimens, four themes) → <https://blurayne.github.io/microbes/book/shader-test/>
- **Cell zoo** (every cell × theme × renderer in one grid) → <https://blurayne.github.io/microbes/book/cell-zoo/>

## What's in the game

- **12 immune cells** — macrophage, neutrophil, monocyte, dendritic, mast, NK, basophil, platelet, T-cell, B-cell, eosinophil, RBC.
- **12 pathogens** — virus (+ corona / flu / bacteriophage / retrovirus variants), bacterium, germ, amoeba, mite, slime mold, spore, toxin. Five sub-categories: Viren · Bakterien · Parasiten · Pilze · Toxine.
- **1 extended specimen** — `eukaryote` (shader-test kind 0) — opt-in via Settings → Display → "Show extended (non-game) cells" for visual-port tests.
- **3 modes** — Free Game (sandbox), Campaign (18 levels in 3 acts), Survival. Free Game is shipped; Campaign + Survival are scaffolded but disabled in the UI.
- **5 bosses** — 2 mini · 2 major · 1 finale (per the GDD; bosses live in the level catalogue, see [`docs/ch07-bosse.md`](./docs/ch07-bosse.md)).
- **Adaptive Codex** — the game teaches itself: players discover pathogen weaknesses through contact, mirroring adaptive immunity.
- **Five interface themes** — `legacy` (default — the canvas2d "classic game look"), `microscope` (H&E stain), `cartoon` (saturated + thick outlines), `kurzgesagt` (flat + neon halo), `classic` (radial highlight + dark outline).

The full design intent lives in the GDD chapters under [`docs/`](./docs/) — each chapter is a self-contained Markdown file rendered via MkDocs.

## Run locally

No build step (vanilla ES modules + MkDocs for the docs site).

```sh
git clone https://github.com/blurayne/microbes.git
cd microbes
python3 -m http.server 8000
# then open http://localhost:8000/
```

Any other static server works (`npx http-server`, `php -S`, …). Opening `index.html` over `file://` works too — there are no `fetch()` calls.

The MkDocs book builds on demand:

```sh
pip install mkdocs && npm run build:docs   # → book/index.html
```

## How to play

- **Gear button** (bottom-right FAB) opens Settings — language, theme, interface colour, background, overlays, controls, audio, links.
- **Palette FAB** opens the Add dialog — pick a cell type to spawn. Bad cells (pathogens) live in a separate section. Toggle "Show extended cells" in Settings to expose the eukaryote.
- **Pause FAB** freezes the sim.
- **Two-finger rotation** (optional) rotates the camera; pinch zooms.
- **Tap a cell** in the kill / target / split mode does what the active mode-button says.
- **Auto-split** is on for free-game spawns by default (cells split on a per-cell timer).

URL params for developers + visual testing — see [`TESTING.md`](./TESTING.md) §URL params. Quick example:

```
?cellType=virus&theme=cartoon&bg=solid&pose=1&screenshot=1
```

…boots into a single paused virus on a dark backdrop, auto-saves a PNG.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — workflow + house rules for Claude sessions working on this repo. Branch off `main`, one PR per logical change, auto-merge on green CI, announce build / codename after each merge.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module map, render loop, renderer cascade, background-layer stack, overlay-stack pipeline, theme branches, the full Settings surface with every key + range, storage + URL state.
- [`TESTING.md`](./TESTING.md) — local test guide (unit + module-import smoke + Playwright visual diffs).
- [`RENDERERS.md`](./RENDERERS.md) — perf research; why Pixi was removed; canvas2d vs webgl2 vs webgpu comparison.
- [`ALGORITHMS.md`](./ALGORITHMS.md) — non-obvious algorithms documented (currently: 1D-greedy clustering for the off-screen nav-arrow indicators).
- [`PLAN.md`](./PLAN.md) + [`.claude/plan/`](./.claude/plan/) — open + done plans with PR numbers.
- [`.claude/skills/`](./.claude/skills/) — repeatable workflows (e.g. importing a new cell or theme from `docs/shader-test.html`).
- [`IDEAS.md`](./IDEAS.md) — deferred ideas with revisit triggers.
- [`docs/`](./docs/) — full Game Design Document v10 (German). Each chapter file is self-contained and rendered via MkDocs.

## Tests

Three test surfaces, all run-local-friendly:

```sh
npm test                     # node --test, ~35 unit tests
npm run test:visual          # Playwright visual diffs (needs Chromium)
npm run test:visual:diff     # game ↔ shader-test pair diff only
```

Renderer module-import smoke:

```sh
for r in canvas2d webgl2 webgpu; do
  node -e "import('./assets/render/${r}.js').then(()=>console.log('${r}: OK'))"
done
```

Full guide + URL-param table + troubleshooting in [`TESTING.md`](./TESTING.md).

## Deployment

Pages-deploy publishes `main` to GitHub Pages on every push via [`.github/workflows/pages.yml`](./.github/workflows/pages.yml). The build runs `npm test`, builds the MkDocs book, stamps `assets/build.js` with the run SHA + number + codename, and uploads the whole tree as the Pages artefact. The deployed URL stamps appear in the in-app build pill (toggle Settings → Display → Show build info).

The build codename is a deterministic two-word handle generated from the workflow run number (`buildCodename(run)` in `assets/core/build-codename.js`) — same `N` → same name, so "build #97 · ruby-flagellum" stays distinct from "#98 · jade-codon".

## License

MIT for the JS / CSS / HTML. Documentation under `docs/` (GDD) is original except where individual sections cite their sources. Three shader assets in `docs/shader-test.html` carry the Shadertoy default **CC BY-NC-SA 3.0** licence and would need replacing if this project ever ships under a permissive licence — flagged in `docs/ch13-anhang.md` "Anhang · Drittanbieter-Lizenzen".
