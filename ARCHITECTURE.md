# Architecture

Technical reference for the Microbes game: code structure, the render pipeline, the settings surface, and how the runtime fits together. Companion to:

- [`RENDERERS.md`](./RENDERERS.md) — historical research + canvas2d vs webgl2 vs webgpu comparison.
- [`ALGORITHMS.md`](./ALGORITHMS.md) — non-obvious algorithms (currently: 1D-greedy nav-arrow clustering).
- [`TESTING.md`](./TESTING.md) — test surfaces + how to run them.
- [`CLAUDE.md`](./CLAUDE.md) — workflow rules.

## Module map

Pure ES modules, vanilla DOM, three pluggable renderers.

```
index.html
└── assets/
    ├── app.js                       — top-level entry: settings UI, frame loop,
    │                                   dialog wiring, mode-button + FAB handlers.
    │                                   ~3.5 kLOC, intentionally monolithic so the
    │                                   no-build-step rule (CLAUDE.md) holds.
    │
    ├── core/
    │   ├── state.js                 — single source of truth for runtime config.
    │   │                              `DEFAULTS`, `S = loadSettings()`, the 21-entry
    │   │                              `CELL_TYPES` map, `FACE` per-cell-type
    │   │                              face geometry, `THEMES`, `BACKGROUNDS`,
    │   │                              i18n tables for 7 locales, the
    │   │                              `loadSettings` migration shim.
    │   ├── sim.js                    — cell physics, spawn, split, pairwise repulsion,
    │   │                              brownian, mode-aware tap handlers, `worldToScreen`.
    │   ├── sim-rules.js              — combat rules: `getRule(attacker, target) → {dps,…}`,
    │   │                              `defaultHp`, `getBestCounter`. Pulls from
    │   │                              `CELL_RELATIONS` (auto-generated from the
    │   │                              GDD card grid via `tools/extract-cell-relations.mjs`).
    │   ├── cell-relations.js        — auto-generated friend / prey / foe tables.
    │   │                              DO NOT EDIT — change the source cards in
    │   │                              `docs/ch01-helden.md` + `docs/ch02-pathogene.md`
    │   │                              and re-run the extractor.
    │   ├── cell-kinds.js             — `testKindFor(type) → 0..20`. Maps game cell
    │   │                              keys to the shader-test specimen kind IDs so
    │   │                              the disk shader can route per-type SDFs.
    │   ├── shape.js                  — wobble vertex table (`WOBBLE_VERTS`),
    │   │                              `inView(x, y, r, camera, W, H)` viewport
    │   │                              culling, theta lookup for membrane sin/cos.
    │   ├── sim-faces.js              — mouth-kind resolution for the face overlay
    │   │                              (smile / snarl / fangs / tongue / drool / frown /
    │   │                              none — overridden when state == SPLITTING).
    │   ├── url-overrides.js          — boot-time URL params (?cellType / ?theme /
    │   │                              ?renderer / ?bg / ?pose / ?extended / ?cartoon /
    │   │                              ?screenshot). In-memory only; never persists.
    │   ├── floating-text.js          — damage numbers, HP bars, level-banner text.
    │   ├── spawn-banner.js           — "first sighting" friend/prey/foe banner.
    │   ├── cell-tag.js               — per-cell name + faction tag overlay (eye toggle).
    │   ├── build-codename.js         — deterministic two-word build name from run #.
    │   ├── music.js                  — track list + playback state.
    │   └── sfx.js                    — death + split SFX with spatial audio.
    │
    ├── render/
    │   ├── renderer.js               — `RendererBase`: common camera + viewport
    │   │                              helpers shared by all three backends.
    │   ├── canvas2d.js               — 2D context implementation. Path2D body
    │   │                              geometry, additive radial blobs for the
    │   │                              metaball split pass, sequential bg passes.
    │   ├── webgl2.js                 — GLSL ES 3.00 (~3.8 kLOC). Disk-shader
    │   │                              per-kind branches + per-theme compose +
    │   │                              FBO chain for overlay stack.
    │   └── webgpu.js                 — WGSL mirror of webgl2. Default renderer
    │                                   (with graceful cascade to webgl2 → canvas2d).
    │
    └── ui/
        ├── nav-arrows.js             — off-screen nav-arrows. Floating mode = 4
        │                              edge arrows; Anchored mode = per-cell
        │                              arrows with 1D-greedy clustering +
        │                              Schmitt-trigger hysteresis (see ALGORITHMS.md).
        ├── color-picker.js           — HSL picker for the interface accent.
        ├── toast.js                  — single transient notification element.
        └── screenshot.js             — canvas → PNG + sim-state JSON sidecar
                                        for visual tests + `?screenshot=1`.
```

## Runtime loop

```
                        ┌───────────────────────────┐
                        │  app.js: frame loop (rAF) │
                        └────────────┬──────────────┘
                                     │ ts
              ┌──────────────────────┼─────────────────────────────┐
              ▼                      ▼                             ▼
     sim.update(dt)         renderer.draw(...)            updateNavArrows(ts)
     ├ pairwise repulse     ├ beginFrame                  ├ project off-screen
     ├ brownian + drift     ├ drawBackground (layer stack)│  cells to perimeter
     ├ split state ms       ├ drawCellBodies (per-renderer SDF / metaball)
     ├ ai per sim-rules     ├ drawNuclei / drawDecorations
     ├ damage + death       ├ drawCartoonFaces (if S.cartoon)
     └ spawn + recycle      ├ overlay stack (caustics / ripples / blur / duotone /
                            │  noise / vignette / crosshair) via ping-pong FBO
                            └ endFrame
```

The renderer cascade is `webgpu → webgl2 → canvas2d`. `app.js` constructs each in turn; if init or runtime throws (lost device, missing `navigator.gpu`, etc.) it cascades to the next.

The face overlay is a **separate** render pass downstream of the cell body — so it works identically across all three renderers and across the four shader-test themes.

## Background layer stack

`S.bgLayers` is a sortable list of preset references (`bloodstream`, `bloodflow`, `cellShadow`, `lung`, `aurora`, `underwater`, `lavaFire`, `reactor`, `mitochondria`, `neuron`, `bile`, plus the synthetic `solid` flat fallback). Each entry carries `enabled`, `opacity`, `blend` (`normal` / `multiply` / `additive`).

WebGL2 + WebGPU render the bg layers into the scene RT via a per-layer pass that the disk shader's per-kind SDF samples from at draw time. Canvas2D paints them sequentially in `globalCompositeOperation` mode.

## Overlay stack

`S.overlayOrder` is the unified, drag-reorderable list of post-effects + a `'scene'` pin separating bg from post-pin overlays:

```
[
  'duotone',     // top — luminance-mapped grade
  'noise',       // FX overlay (cheap blend)
  'vignette',    // FX overlay
  'crosshair',   // FX overlay
  'microscope',  // FBO pass: variable-radius blur
  'caustics',    // FBO pass: water-caustic tint
  'celltype',    // HTML overlay (per-cell label rings)
  'scene',       // ← fixed pin
  'ripples',     // FBO pass: per-cell ripple distortion (bg-only here)
]
```

Overlays above `'scene'` run after the cell pass (post-pin chain). Overlays below run on the bg-only RT. WebGL2 + WebGPU use a chained ping-pong pipeline (PR #164 + #168). Canvas2D applies only the cheap blends (noise / vignette / crosshair); FBO-only effects are no-ops on canvas2d.

## Themes

Five themes via `S.theme`:

| Theme | Treatment |
|---|---|
| `legacy` | Canvas2D-faithful default — gradient cytoplasm + dark outline + flat nucleus. **Untouched** during the shader-test parity port. |
| `microscope` | H&E stain look — soft brown outline, organelles visible. |
| `cartoon` | Saturated cyto × 1.30 + top-left highlight + thick black outline. |
| `kurzgesagt` | Flat cyto + pale rim + neon halo (`cyto * 1.6 * halo`). |
| `classic` | Radial fill (cyto → cytoTop × 1.35) + dark-purple outline. |

The non-legacy themes are ported from `docs/shader-test.html` and live as four branches inside the disk fragment shader. Per-cell compose overlays (rbc biconcave, virus capsid lattice, dendritic tendrils, slime hyphae, toxin glow) gate on `themeId != 0` so the legacy path stays free of them.

## Cell types

```
Immune (good · 12):
  macrophage · neutrophil · monocyte · mast · nk · dendritic
  basophil · platelet · tcell · bcell · eosinophil · rbc

Pathogens (bad · 8):
  virus · germ · bacterium · amoebaP · slime · mite · spore · toxin

Extended (opt-in via S.extendedCells · 1):
  eukaryote                   — shader-test kind 0; passive specimen
                                 used for visual-port tests.
```

Each entry in `CELL_TYPES` carries: `label`, `category` (`good`/`bad`), `extended?`, `sizeMul`, `body.kind` (`round` / `oblong` / `lobed` / `rippled` / `pseudopod` / `star`), `nucleus.kind`, `decoration.kind`, `granules`, `splitFactor`, `brownianMul`, `move` (patrol / attack speed + accel + weight + friction + hostility), `field` (blur + contrast + wobbleMul), `colors` (cytoTop / cytoBot / nucleus / nucleusHi / accent), `description`.

The kind IDs in `cell-kinds.js` (`testKindFor`) are aligned 1:1 with `docs/shader-test.html`'s specimen kinds 0–20.

## Storage + URL state

| Where | Schema |
|---|---|
| `localStorage['microbes.settings.v1']` | The whole `S` object, JSON-stringified. `loadSettings` validates + clamps + migrates legacy keys on read. Saved on every UI change via `saveSettings()`. |
| URL query params | Boot-time overrides (`assets/core/url-overrides.js`). In-memory only — never written back to localStorage. See [`TESTING.md`](./TESTING.md) §URL params. |
| `window.__BUILD__` | Set by the Pages-deploy workflow's "Stamp build info" step (`{ sha, run, branch, dateUtc }`). Drives the in-app build pill + codename. |

## Settings surface

Top-level groups in **Settings → ⚙** (`index.html` + `app.js` bindings + `state.js` defaults):

### Language
- **Language** — en / de / es / bar (Bavarian) / hes (Hessisch) / mainz (Mainzerisch) / latin. `applyI18n()` updates every `data-i18n` target on change.

### Theme
- **Theme** — legacy (default) / microscope / cartoon / kurzgesagt / classic. See §Themes above.

### Interface color
- **Accent palette** — picked via the color-picker UI; persists as `S.interfaceColor`.

### Background
- **Background kind** — picker for the active bg preset. Drives the bg layer stack (and `S.bgLayers` if the user has reordered).
- **Background flow** (`bgFlowSpeed`, 0..2 ×) — speed multiplier on time-driven bg patterns.
- **Background size** (`bgScale`, 0..4 ×) — uniform multiplier on every bg pattern feature (rings stride, grid step, fbm wavelength, RBC tile size). Floor 0.05 in the shader.
- Per-kind sub-controls when the active preset exposes them (e.g. ripple density / reach / strength).

### Gameplay
- **Game mode** — `free` (default) / `campaign` (disabled — soon) / `survival` (disabled — soon).
- **Two-finger rotation** (`pinchRotation`) — pinch gesture rotates the camera.
- **Composition HUD** (`compositionHud`) — recommends counters for on-field pathogens.
- **Fullscreen** — `requestFullscreen()` toggle.

### Overlays
- Unified sortable list (drag handle + checkbox in each row) for the post-effect stack: `noise`, `vignette`, `crosshair`, `caustics`, `ripples`, `microscope`, `duotone`, `celltype`, plus the fixed `'scene'` pin separator. Order = render order.
- Per-overlay sub-sliders show under the row when the overlay is on: caustics tint R/G/B, ripple density / reach / strength, static-noise intensity + blend, vignette intensity + blend, microscope focus / strength / falloff, duotone hot/cold knobs.

### Look
- **Wobble** (`wobbleAmp`, 0..0.4) — membrane oscillation magnitude.
- **Outline px** (`outlinePx`, 1..10) — black outline thickness on legacy theme.
- **Membrane** (`membraneIntensity`, 0..1) — non-legacy theme membrane strength.
- **Cell border** (`cellBorderThickness`, 0.5..5 ×) — GPU-renderer outline multiplier.
- **Cell size** (`cellSizeMul`, 0.4..2 ×) — global radius multiplier.
- **Face size** (`faceScale`, 0..3 ×) — cartoon-face footprint multiplier. Default 1.0.

### Display
- **Cartoon mode** (`cartoon`) — toggles the face overlay.
- **Show FPS** (`showFPS`) + **Show renderer** + **Show build info** + **Show object count**.
- **Off-screen arrows** (`navArrows`) + **Arrow mode** (`navMode`: `floating` / `anchored`). Anchored uses 1D-greedy clustering with Schmitt-trigger hysteresis — see [`ALGORITHMS.md`](./ALGORITHMS.md).
- **Show extended cells** (`extendedCells`) — unhide the eukaryote in the Add dialog.
- **Show metaball field** (`showDebugField`) — debug overlay.

### Audio
- Music volume + SFX volume sliders, current-track display + next-track button.

### Population
- **Max cells** (`maxCells`, 32..4096) — number input. Spawn-cap recycles the oldest cell when full.

### Links
- Game Design Document · Shader test.

### Footer (`.actions`)
- **Copy build SHA** · **Screenshot** · **About** · **GitHub**.

`S` is persisted on every change. The `loadSettings` shim in `state.js` clamps numeric ranges, validates enum values, and migrates legacy keys (`fxOrder` → `overlayOrder`, `rippleScope` → position in `overlayOrder`, etc.).

## Renderer cascade detail

```js
async function makeRenderer() {
  const k = S.renderer;          // user-pinned, e.g. 'webgpu'
  for (const cand of order(k)) { // webgpu → webgl2 → canvas2d
    try {
      const r = cand === 'webgpu'   ? await tryWebGPU()
              : cand === 'webgl2'   ? new WebGL2Renderer(canvas, sim)
              :                       new Canvas2DRenderer(canvas, sim);
      // success: stamp the active renderer for the FPS overlay
      return r;
    } catch (e) {
      console.warn(`renderer ${cand} failed:`, e);
    }
  }
}
```

The default is WebGPU because it gives the largest perf headroom + first-class compute (the Gray-Scott reactor bg uses a compute pipeline). WebGL2 mirrors webgpu visually. Canvas2D is a graceful fallback: simpler bg pipeline, no FBO chain, no chained overlays — but every cell still renders + the game still plays.
