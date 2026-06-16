# Plan 24 — Cardiovascular vessel network + flowing RBCs

## Context

User asked (paraphrased from German):

> Add a big cardiovascular structure the microbes are bound to move
> within — they must not be able to cross the vessel walls, only move
> inside the bloodstream. Make this layer optional, in a new settings
> submenu. Inside the vessels, red blood cells animate in the
> background, flowing through the arteries. The vessels also
> generously limit the playing field.

Today the playfield is a plain rectangle. `sim.W × sim.H` defines the
world extents, `MARGIN = 80` clamps cells inside via
`clampAllInside()` (`assets/core/sim.js:249-253`). The new feature welds
that rect-bound behaviour to a procedural vessel SDF, and animates
RBC particles along the vessel centerlines.

User decisions captured up front:

- **Layout**: dropdown selector — branching network, single tube,
  stylised heart.
- **Default state**: vessels ON for new sessions.

## Approach

### Geometry: union-of-capsules SDF

A vessel layout is a list of capsules:

```js
{ x1, y1, x2, y2, r, flow: 1 | -1 }   // world units, flow direction along centerline
```

Union SDF is `min(segDist - r)` across the set. Three factories in
`assets/core/vessels.js`:

- `buildBranchingNetwork(W, H)` — one main horizontal artery + 4
  vertical branches + 2 thin connectors. 7 capsules. Adapts radii to
  `min(W, H)`.
- `buildSingleTube(W, H)` — S-shaped polyline, 4 connected segments.
- `buildHeart(W, H)` — ~10 capsules approximating a heart silhouette.

Each factory returns `{ capsules, spawnSeeds, bbox }`. `spawnSeeds`
are known-good in-vessel positions used as rejection-sampling
fallbacks for cell spawning.

### Physics: confinement on top of existing motion

In `sim.update(dt)` at the end of the NORMAL branch
(`sim.js`, right after `c.x += c.vx*dt; c.y += c.vy*dt;`):

- Find the nearest wall (signed distance + outward normal).
- If `signedDist + c.r > 0`, push the cell inward by that penetration
  and reflect the inward-going velocity component (restitution =
  `S.bounce`, same coefficient cell↔cell collisions use).

`clampAllInside()` also gets a vessel branch — replaces the rect
clamp on resize so existing saved sessions migrate cleanly.

Spawning (`spawnAtCenter` / `spawnAtWorld`) snaps any out-of-mask
target to `pickSpawnInside(vessels)` first.

### Visual: vessels drawn behind cells, RBCs flow inside

Implementation strategy — keep parity cheap by reusing the existing
thick-line decoration pipeline that plan 19 already shipped on
WebGL2 + WebGPU:

- New `drawVessels(t, ts)` method on `RendererBase` (no-op default).
- Frame loop calls it between `drawBackground` and `drawCells`.
- **canvas2d**: draws via `withCameraCtx` — wide round-cap `ctx.stroke`
  for tubes + biconcave-donut RBC ellipses copied from the in-game
  `rbc` cell-type recipe.
- **webgl2 + webgpu**: new `_pushThickSegment(x1,y1,x2,y2,halfW,r,g,b,a)`
  helper — variant of the existing `_pushLine` that takes the
  half-width per call (so each capsule keeps its baked-in radius),
  plus `_pushEllipse(cx,cy,a,b,ang,r,g,b,alpha)` that fan-tessellates
  an oriented ellipse into 8 triangles. Both push into `_decorTris`
  and reuse `_uploadAndDrawDecorations` for the actual draw.

Camera-transform discipline: capsules + RBCs are world coords, so
they pan/zoom/rotate with the camera automatically.

### RBC particles

`Sim.vesselRbcs` is an array of `{ capsuleIdx, t, scale, phase, lateral }`.
`buildRbcParticles(vessels, densityMul)` initialises one particle
per ~60 world units of centerline, clamped to [3, 24] per capsule
× the user density slider. Each tick:
`p.t += baseFlow × S.vesselsFlowSpeed × cap.flow × dt / capsuleLength`,
wrapping on [0, 1]. v1 has no cross-capsule handoff.

### Settings UI

New `<details class="settings-section">` block in `index.html`,
inserted after the existing "Background" section. Contains:

- `vesselsEnabled` checkbox
- `vesselsLayout` `<select>` (branching / tube / heart)
- `vesselsRadius` slider 0.5..2.0 step 0.05
- `vesselsFlowSpeed` slider 0..3 step 0.1
- `vesselsRbcDensity` slider 0..2 step 0.1

Geometry-affecting changes (`vesselsEnabled`, `vesselsLayout`,
`vesselsRadius`, `vesselsRbcDensity`) trigger `sim.rebuildVessels()`
via the existing `bindCheckbox` / `bindRange` `onChange` hooks plus
a small inline change handler for the `<select>`. `vesselsFlowSpeed`
mutates `S` only — the per-tick advance reads it live without a
rebuild.

### State + i18n

`assets/core/state.js` DEFAULTS:

- `vesselsEnabled: true`
- `vesselsLayout: 'branching'`
- `vesselsRadius: 1.0`
- `vesselsFlowSpeed: 1.0`
- `vesselsRbcDensity: 1.0`

`loadSettings()` coerces the boolean, validates the layout enum
against `{branching, tube, heart}`, clamps the three sliders to
their ranges.

9 i18n keys (`vessels_section`, `vessels_enabled`, `vessels_layout`,
`vessels_layout_branching`, `vessels_layout_tube`,
`vessels_layout_heart`, `vessels_radius`, `vessels_flow_speed`,
`vessels_rbc_density`) added to `LOCALES.en` inline + translated in
`assets/i18n/de.json`. Other 11 locale JSONs fall back to English
via `T()` — matches the recent `glassInset` / `bumpDuration` pattern.

### Lifecycle

`sim.rebuildVessels()` is the single chokepoint. Called from:

- `app.js` `resize()` (both rendertest and normal branches).
- Each affected `bindCheckbox` / `bindRange` `onChange`.
- The `vesselsLayout` `<select>` change handler.

When `S.vesselsEnabled` is false the method sets `sim.vessels =
null`, all downstream branches transparently fall back to the
legacy rectangle behaviour.

## Critical files

| File                              | What changes                                                                                                              |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| `assets/core/vessels.js`          | **NEW** — capsule SDF helpers, 3 layout factories, RBC init + tick + spawn picker                                         |
| `assets/core/sim.js`              | `rebuildVessels()`, vessel branch in `clampAllInside`, per-tick confinement in the NORMAL block, RBC tick, spawn sampling |
| `assets/core/state.js`            | DEFAULTS + clamps + 9 i18n keys (en inline)                                                                               |
| `assets/i18n/de.json`             | German translations for the 9 new keys                                                                                    |
| `assets/render/renderer.js`       | `drawVessels` base hook (no-op)                                                                                           |
| `assets/render/canvas2d.js`       | `drawVessels` — `withCameraCtx`-wrapped stroke + RBC ellipses                                                              |
| `assets/render/webgl2.js`         | `drawVessels` + `_pushThickSegment` + `_pushEllipse`                                                                        |
| `assets/render/webgpu.js`         | WebGPU mirror of the same                                                                                                 |
| `index.html`                      | New "Blood vessels" settings submenu                                                                                       |
| `assets/app.js`                   | bind* wiring + layout select handler + `sim.rebuildVessels()` from resize                                                   |
| `test/vessels.test.js`            | **NEW** — 16 unit tests (capsule SDF, layout factories, RBC tick, spawn sampler)                                          |
| `.claude/plan/24-vessels.md`      | **NEW** — this file                                                                                                       |
| `PLAN.md`                         | Plan 24 added to Open                                                                                                     |

## Reused existing infrastructure

- `withCameraCtx(fn)` (`canvas2d.js:75-99`) — world-coord drawing
  helper.
- `_pushLine` / `_decorTris` / `_uploadAndDrawDecorations`
  (`webgl2.js`, `webgpu.js`) — thick-line + colored-triangle pipeline
  from plan 19, reused via the new `_pushThickSegment` variant.
- `bindCheckbox` / `bindRange` (`app.js:1071`, `app.js:1196`) —
  standard slider/checkbox wiring with `onChange` hook.
- In-game `rbc` cell-type color recipe (`CELL_TYPES.rbc` in
  `state.js`) — palette for the flowing RBC particles.

## Verification

- **Unit tests**: `node --test` — 52/52 green (36 prior + 16 new
  capsule SDF / layout / RBC tick / spawn sampler).
- **Renderer-import smoke**: `for r in canvas2d webgl2 webgpu; do
  node -e "import('./assets/render/${r}.js').then(...)"; done` — all
  load cleanly.
- **Manual browser**:
  - Reload with vessels ON: cells respawn inside the vessel mask,
    none stray outside the union.
  - Toggle OFF in settings: cells freely move to the rectangle
    bounds again.
  - Switch each of the 3 layouts via dropdown; visual transition is
    instant; no console errors.
  - Pan + zoom with vessels visible: the network follows the camera.
  - Try canvas2d / webgl2 / webgpu: vessels look comparable, RBC
    particles flow at the same apparent speed.

## Branch

`claude/vessels` off freshly-updated main. One PR.

## Out of scope (deferred)

- Cross-capsule RBC handoff at bifurcations (particles wrap within
  their own capsule for v1).
- Heart-pump pressure pulse (would modulate `S.vesselsFlowSpeed`
  sinusoidally; nice juice for v2).
- Camera zoom-out clamp matching the vessel bbox.
- Per-pathogen-tag tolerance for the constraint (e.g. virus can
  leak through walls for narrative reasons).
