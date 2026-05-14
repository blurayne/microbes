# Plan 22 — Glass membrane follows cell silhouette + inset slider

## Context

The user asked for three changes to the glass-membrane overlay:

1. Make the refraction band follow the **cell/pathogen silhouette**
   instead of a perfect circle (lobed, rippled, pseudopod, star
   cells should have a membrane band that traces their actual
   outline).
2. Start the band **inset by a configurable amount** from the
   silhouette edge — new `glass_inset` slider.
3. Confirm the band **scales 1:1 with camera zoom** (user
   clarified: keep as-is; already does).

Canvas2D parity is intentionally skipped (no GPU pass available;
glass remains a WebGL2 + WebGPU feature). Documented as a known gap.

## Audit

Today's glass pass (WebGL2 `_glassEnsureProg` + WebGPU
`_glassEnsurePipeline`):

- Per-cell instance uniform is `vec3 (uvX, uvY, uvR)` — a screen-
  space circle anchored at each cell center. GLASS_MAX = 24.
- Band geometry: `lo = rPx * (1 - half_)`, `hi = rPx * (1 + half_)`
  where `half_ = 0.15 * glassSize`. Half-sine lens peak inside the
  band drives the refraction displacement.
- Cell silhouettes are NOT pre-baked as polygons; the existing
  cell fragment shader synthesizes them via `bodyScale(uv)` which
  dispatches on `bodyKind` (0=round, 1=lobed, 2=rippled, 3=oblong,
  4=pseudopod, 5=star) and combines kind-specific scaling with
  a per-cell wobble keyed on `(phase, seed, freq, wobbleMul)`.
- Both cell shaders carry per-cell `kindAsFloat` (packed `body +
  nuc*16 + sel*256 + ...`) in instance location 1 and `phase
  (phi, seed, freq, wobMul)` in instance location 2. The glass
  collection loop is the only place this info is dropped.

Same-named plan: plan 15 ("Glass-membrane follow-ups") shipped the
`glassSize` slider + WebGL2 Y-flip + trail fix. This plan picks
up where 15 left off without touching its concerns.

## Approach

### 1. Expand per-cell uniform from vec3 → 2 × vec4

Each cell now ships:

- `vec4 a: (uvX, uvY, uvR, kindFloat)`
- `vec4 b: (phi, seed, freq, wobMul)`

GLASS_MAX stays 24. Both renderers gain a second cells array.

WebGL2: `uniform vec4 u_cellsA[24]; uniform vec4 u_cellsB[24];`
WebGPU: bump `cells: array<vec4<f32>, 48>` (interleaved A,B,A,B…)
or split into two arrays — pick whichever keeps the uniform
buffer alignment cleanest.

### 2. Port `bodyScale()` into the glass fragment shader

Verbatim copy of the existing cell-shader function (GLSL +
WGSL). It needs three extra uniforms the cell pass already has:

- `u_time` — already present in the glass pass.
- `u_wobbleAmp` — currently NOT passed to the glass pass. Add it.
- `kindFloat` + per-cell `phase` — sourced from the new vec4s.

Inside the per-cell loop, replace the fixed circle bounds:

```glsl
// old
float lo = rPx * (1.0 - half_);
float hi = rPx * (1.0 + half_);

// new — band traces cell silhouette, inset inward
float silhouette = rPx * bodyScale(dvUv, kindFloat, phase);
float midR = silhouette * (1.0 - inset);
float lo = midR - silhouette * half_;
float hi = midR + silhouette * half_;
```

`inset` is a fraction of the silhouette radius (0.0 = flush with
the edge, 0.2 = band sits 20% of the radius inward). The
half-sine lens inside `[lo, hi]` is unchanged.

### 3. New `glassInset` setting

- `S.glassInset` default `0.08` (subtle inward shift so the band
  reads as "inside the cell" rather than astride the edge).
- Range 0.00 .. 0.50 in 0.01 steps.
- Slider lives next to `glassSize` / `glassStrength` / `glassChroma`
  in the Overlays → Glass section.

i18n key `glass_inset` → `Inset` (en). If plan 21 has landed by
the time this lands, add the translation key to every
`assets/i18n/<code>.json`. If not, the `LOCALES` inline blocks in
state.js are the place.

### 4. Canvas2D parity gap

Document in plan + PR description: canvas2d has no glass pass
today and this PR doesn't add one. The existing `S.glassEnabled
&& renderer === 'canvas2d'` no-op stays.

## Critical files

- `assets/render/webgl2.js` — uniform layout (2 vec4 arrays),
  fragment shader: import `bodyScale` + use silhouette bounds,
  pass `u_wobbleAmp` + `u_glassInset`. Update
  `_glassCollectCells` to pack kindFloat + phase.
- `assets/render/webgpu.js` — same changes in WGSL: extend the
  `GlassU` struct, add `bodyScale` function, update
  `_glassCollectCells` to write to the 2-vec4-per-cell layout.
- `assets/core/state.js` — `glassInset` default + clamp; i18n
  key for `glass_inset` (en inline).
- `assets/i18n/*.json` — only if plan 21 has merged: add
  `glass_inset` to every locale (English label as fallback,
  translated where reasonable).
- `assets/app.js` — slider wiring in the Overlays → Glass
  settings group.

## Verification

- `node --test` — existing tests must still pass; no new test
  required (visual change, not logic).
- Renderer imports for canvas2d / webgl2 / webgpu must still
  load.
- Manual: open the deployed site on WebGL2 + WebGPU, enable
  Glass overlay, sweep `glassInset` slider 0.0 → 0.5, confirm:
  - At inset = 0 the band hugs the silhouette outer edge.
  - At inset = 0.5 it sits halfway between center and edge.
  - On a star/pseudopod cell the band visibly traces the
    pointed/lobed outline, not a circle.
  - Zoom in/out: band stays in 1:1 proportion with the cell.
- Take a side-by-side screenshot of WebGL2 + WebGPU on the same
  scene to confirm parity.

## Branch

`claude/glass-membrane-silhouette`

## Notes / sequencing

This PR will be opened after plan 21 (#266) lands on main, so it
branches off a freshly-updated main. The shader work is
independent of the i18n externalization but the new `glass_inset`
i18n key will need to be added in the post-#266 shape (JSON
files, not state.js LOCALES blocks).
