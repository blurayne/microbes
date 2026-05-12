# 12 — Background scale slider

## Context

Users want a way to enlarge or shrink the background pattern
features (RBC tiles, fbm noise, voronoi cells, lava ribbons, etc.)
independently of the camera zoom. Today every bg layer is sampled
at a fixed world-space frequency baked into the shader/JS; you can
only change features by zooming the whole scene, which also
resizes the cells.

## Audit

- Settings live in `assets/core/state.js` `DEFAULTS`. `bgFlowSpeed`
  is the closest pattern: a single numeric scalar that every
  renderer reads off `S` at draw time. No uniform plumbing today.
- WebGL2 + WebGPU bg fragment shaders both compute a single
  `worldPx` variable from `(screenPx - tx,ty) / camScale` and feed
  it to every pattern (`worldPx * 0.012`, `worldPx * 0.005`, RBC
  `floor(worldPx / TS)`, etc.). Dividing that one value by a
  uniform `u_bgScale` rescales every feature uniformly with no
  per-kind plumbing.
- Canvas2D paints inside a camera-transformed `ctx`. Multiplying
  the local scale factor by `bgScale` (and adjusting the world
  rect ww/wh accordingly) is the equivalent transformation.
- Slider lives in Settings → Look, beside Background flow.

## Approach

1. Add `S.bgScale = 1.0` to `DEFAULTS`. `loadSettings` clamps
   to `[0.05, 4]`.
2. HTML range `min=0` `max=4` `step=0.05` with `bgVal2` readout.
3. `bindRange('bgScale', 'bgScale', 'bgVal2', v => v.toFixed(2) + '×')`.
4. WebGL2: add `uniform float u_bgScale`, divide `worldPx` by it
   (with a `max(., 0.05)` floor to dodge div-by-zero).
5. WebGPU: add an `f32` to the uniform buffer (reuse an existing
   reserved slot or extend), divide `worldPx` similarly.
6. Canvas2D: for each bg layer pass, run all world-coord drawing
   through `scale * bgScale` instead of `scale` (mirror the
   shader's `worldPx / bgScale` semantics).
7. i18n key `bg_scale` across en/de/es/bar/hes/mainz/latin.

At `bgScale = 0` the floor (0.05) makes features ~20× larger
than baseline, which reads as a near-uniform wash — the user's
request to allow 0 is honoured visually without dividing by zero.

## Critical files

- `assets/core/state.js` (default + clamp + 7 i18n entries)
- `index.html` (slider markup)
- `assets/app.js` (bindRange wiring)
- `assets/render/canvas2d.js` (`_drawBgLayer` scale handling)
- `assets/render/webgl2.js` (bg fragment shader + JS uniform)
- `assets/render/webgpu.js` (bg WGSL + uniform-buffer layout)

## Verification

- `node --test`
- `for r in canvas2d webgl2 webgpu; do node -e "import('./assets/render/${r}.js').then(()=>console.log(r))"; done`
- Manual browser check: at 0.5×, 1×, 2×, 4× the bloodstream RBC
  tiles, lung fbm, lava ribbons, cyber grid and petri rings all
  scale together; cells stay the same size.

## Branch

`claude/cell-splitting-metaball-hcdrO`
