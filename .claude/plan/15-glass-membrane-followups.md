# Plan 15 — Glass-membrane follow-ups: size slider, WebGL2 Y-flip, trail fix

## Context

PR #229 (and a couple of follow-up PRs) shipped the glass-membrane
overlay — a per-cell lens-band that bends the scene behind each cell.
Three regressions surfaced on review:

1. **No size control.** The lens band is hard-coded to `0.85·r .. 1.15·r`
   in both renderers. The user wants a slider so the band thickness can
   be tuned independently of `glassStrength`.
2. **WebGL2 is vertically inverted.** WebGPU looks correct; WebGL2's
   lens band reads from the wrong (mirrored) row of the scene FBO, so
   the refraction visibly bends "the wrong way". WebGPU's texture
   convention has texel `(0,0)` at the top-left so canvas-uv samples
   trivially; WebGL2's FBO has texel `(0,0)` at the bottom-left, which
   inverts canvas-uv lookups.
3. **Background trail.** With glass on, moving cells appear to leave a
   trace behind them. Suspected root cause: the same Y-inversion above
   — the lens samples mirrored rows that contain different bg content,
   creating ghost smears that look like a trail when the camera pans.
   Fixing the inversion is expected to resolve this too.

## Audit

* `assets/render/webgpu.js` — `GLASS_BG_WGSL` already samples
  `bgTex` at `uv ∈ [0,1]` with canvas-y top, naturally correct.
* `assets/render/webgl2.js` — `FRAG_GLASS_BG` samples `u_bg` at
  `uv ∈ [0,1]` but `VERT_FULLSCREEN` flips `v_uv.y` so canvas-top
  has `v_uv.y = 0`. The scene FBO this pass reads has texel `y = 0`
  at the BOTTOM (default WebGL convention), so a canvas-uv lookup
  returns the mirror row. Same pattern exists in `FRAG_RIPPLE_BG`
  but is less visible because ripple displacement is locally
  symmetric.
* `assets/core/state.js` — `glassStrength` + `glassChroma` exist;
  `glassSize` is new. Load + clamp follow the existing
  `glassStrength` clamp pattern.

## Approach

* **`glassSize` state** — defaults to `1.0`, clamped to `0.2..3.0`,
  loaded from `localStorage` like the other glass fields.
* **Shader change (both renderers)** — extend the params uniform's
  third lane to carry size. Band half-width becomes
  `halfBand = 0.15 * size`, so `size = 1.0` reproduces the original
  `0.85..1.15·r` look and the user can dial up to `3.0` (very wide
  refractive halo) or down to `0.2` (thin rim).
* **WebGL2 Y-inversion** — wrap the `texture(u_bg, …)` lookup in a
  `sampleBg(canvasUv)` helper that flips y: `texUv = vec2(uv.x, 1.0 - uv.y)`.
  Applied to the three chroma samples + the single non-chroma sample.
* **UI** — `<input type="range" id="glassSize" min="0.2" max="3.0">`
  next to `glassStrength` inside `#glassControls`. Bound via
  `bindRange('glassSize', 'glassSize', 'glassSizeVal', v => v.toFixed(1) + '×')`.
* **i18n** — `glass_size` in en + de (matches the `glass_strength`
  coverage — the other three locales already fall through).

## Critical files

* `assets/core/state.js` — DEFAULT + load/clamp + i18n strings.
* `index.html` — slider markup inside `#glassControls`.
* `assets/app.js` — `bindRange('glassSize', …)`.
* `assets/render/webgl2.js` — `FRAG_GLASS_BG` (uniform → vec3 +
  Y-flip helper) + `_runPostPass` glass branch.
* `assets/render/webgpu.js` — `GLASS_BG_WGSL` (params.z = size) +
  glass UBO write in the post-pass branch.

## Verification

* `node --test` — full suite green (no test specifically covers the
  shader; correctness is visual).
* Render-module imports for canvas2d / webgl2 / webgpu.
* Manual: Settings → Overlays → Glass membrane. Move the size
  slider; the lens band visibly widens/narrows. Compare canvas2d
  (no-op) vs webgl2 vs webgpu — webgl2 + webgpu should agree.
* Manual: pan the camera with glass on — no trail.

## Branch

`claude/cell-splitting-metaball-hcdrO` (per session brief).
