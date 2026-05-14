# Plan 19 — Thick decoration lines on GPU (lineThickness slider)

## Context

`S.lineThickness` already affected canvas2d strokes (cell
outlines, nucleus, decorations, faces) and the cell-shader
outline band on webgl2 / webgpu (multiplied into the
`u_borderThickness` uniform). The user reported the slider had no
visible effect on **cell + pathogen lines** under webgl2 / webgpu
— spikes, tendrils, flagella, cilia, drips, legs, fuzz, Y
receptors.

## Audit

The decoration pipeline in both GPU renderers draws everything
through `_pushLine(x1, y1, x2, y2, r, g, b, a)`, which packs two
vertices into `_decorLines` and ships them via:

* `webgl2.js:3850` — `gl.drawArrays(gl.LINES, …)`.
* `webgpu.js:2537` — `primitive: { topology: 'line-list' }`.

Line-list primitives are pinned to **1 device-pixel**: WebGL2's
`gl.lineWidth()` is a driver no-op (the spec only requires the 1.0
case), and WebGPU has no line-width API at all. The
`u_borderThickness` slider path is unrelated — that's the cell
membrane band, not the decoration line pipeline.

State.js comment at `lineThickness:` already acknowledged the
limitation for "GPU antibody Y's"; the same restriction silently
applied to all GPU decoration lines.

## Approach

Switch decorations to **screen-space-thick triangle quads** via a
single emitter change.

### 1. Per-pass half-width

At the top of each `_drawDecorations` pass, compute
`this._decorHalfW = (S.lineThickness × 0.5) / camera.scale` — in
world units, so a `lineThickness` of 1 reads as ≈ 1 CSS px at any
zoom level. Stored on the renderer instance for `_pushLine` to
read without a recompute per segment.

### 2. `_pushLine` emits a quad

Replace the two-vertex line write with a six-vertex (two-tri) quad
write into `_decorTris`:

```js
const tx = dx / len, ty = dy / len;   // unit tangent
const nx = -ty * hw,  ny =  tx * hw;  // half-width normal
const ex =  tx * hw,  ey =  ty * hw;  // cap extension
// Corners A±n, B±n; endpoints also shifted by ±(ex,ey) so
// chained segments overlap at joints instead of showing a gap.
arr.push(
  ax1, ay1, r, g, b, a,
  ax2, ay2, r, g, b, a,
  bx1, by1, r, g, b, a,
  ax2, ay2, r, g, b, a,
  bx2, by2, r, g, b, a,
  bx1, by1, r, g, b, a,
);
```

The cap extension is the cheapest miter substitute: a
butt-capped quad would show notches at corners where the
decoration helpers chain segments (flagella waves, tendril
curves, fuzz tufts). Extending each endpoint outward by `halfW`
guarantees the next segment overlaps the previous one cleanly.

### 3. Pipeline reuse

`_decorTris` already feeds a `TRIANGLES` / `'triangle-list'`
pipeline with the same `(x, y, r, g, b, a)` vertex layout, so no
new pipeline / shader is needed. The existing `_decorLines`
buffer + LINES draw call still runs but receives 0 verts; left in
place for now to keep this PR focused on the visible fix (cleanup
of the dead pipeline can land in a follow-up).

## Out of scope

* **Antibody Y's** still use a separate `_antibodyPipeline` with
  `line-list` topology. That pipeline is per-instance unit-Y
  geometry, not segment-pair vertices, so the `_pushLine` change
  doesn't reach it. State.js comment updated to note the carve-out.
* **canvas2d** decorations already respect `lineThickness` via
  `ctx.lineWidth = ... * S.lineThickness / scale`. No change.
* The `u_borderThickness` cell membrane uniform still multiplies
  `cellBorderThickness × lineThickness` for the cell outline ring
  — unchanged here.

## Critical files

* `assets/render/webgl2.js` — `_drawDecorations` halfW compute +
  `_pushLine` quad emit.
* `assets/render/webgpu.js` — same.
* `assets/core/state.js` — `lineThickness` comment now lists the
  GPU decoration pipeline as a consumer + carves out antibody Y's.

## Verification

* `node --test` — 35/35 green.
* `canvas2d`, `webgl2`, `webgpu` modules import.
* Manual:
  - Settings → Look → Line thickness slider 1 → 5. Virus spikes,
    bacteria flagella, dendritic tendrils, basophil drips and
    every other decoration visibly thickens.
  - Slider 0.3: lines render below 1 px and look almost invisible
    (expected — the slider's clamped lower bound is for users who
    want hairline strokes).
  - Antibody Y's stay 1 device-px regardless (intentional carve-out).
  - Cell outline band still scales with the existing cell-border
    slider × line-thickness slider.

## Branch

`claude/thick-decor-lines`.
