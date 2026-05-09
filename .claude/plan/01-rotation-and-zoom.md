# Plan #1 — Two-finger rotation gesture + 2× zoom-out

## Context

The pinch gesture currently does scale + pan only. User wants to
add **rotation** from a two-finger twist. User also asked to
double the zoom-out range so the camera can pull back further.

## Audit

- **`assets/core/sim.js:53`** — `this.camera = { scale: 1, tx: 0, ty: 0 }`. No
  rotation slot.
- **`assets/app.js:85+`** — `startPinchIfTwoPointers()` records
  `startDist` + `startMid` + `startScale/Tx/Ty` only.
- **`assets/app.js:158+`** — pinch update reads new distance, scales
  `pinch.startScale * (dist / pinch.startDist)`, recomputes tx/ty
  to keep the pinch midpoint fixed in world space.
- **No `screenToWorld` / `worldToScreen` utility** exists. The
  inverse-camera math is inlined where needed (drag begin, hit
  test, target marker placement, target-line rendering, debug-
  field overlay). Each site rebuilds the inverse transform from
  `cam.scale + cam.tx/ty`. **Adding rotation means every one of
  those sites picks up the rotation term.**
- **`MIN_SCALE`** lives in `assets/core/state.js` (~line 1116:
  `export const MIN_SCALE = 0.25;`). Halve it to `0.125` for 2×
  more zoom-out range.

## Approach

Order so each step compiles + tests cleanly:

1. **Helper extraction** (first commit): `screenToWorld` /
   `worldToScreen` in `assets/core/sim.js` (rotation-aware from
   day one). Migrate every inline cam-inversion in `app.js` to
   the helper. No behaviour change yet — just plumbing.
2. **Camera state**: `this.camera = { scale: 1, tx: 0, ty: 0, rotation: 0 }`.
   Default 0; behaviour unchanged until set.
3. **Renderers — apply rotation** in each transform site:
   - **canvas2d.js** (`withCameraCtx`): build a 2×3 matrix that
     composes translate-to-centre, rotate, translate-back, scale,
     translate-by-camera. Pass to `ctx.setTransform`.
   - **webgl2.js**: change `u_camera` from `vec3` (scale, tx, ty) to
     `vec4` (scale, tx, ty, rotation). Vertex shader (`VERT_DISK`,
     `VERT_DECOR`, `VERT_FACE`, `VERT_PARTICLE`, fullscreen vert
     for bg / metaSplit) builds a 2D rotation matrix and applies it
     to `worldPos` before scale + translate. Update every site
     that reads `u_camera` (~5 vertex shaders).
   - **webgpu.js**: extend the disk-pass `cameraVp` carry; mirror
     in WGSL.
4. **Pinch handler — angle tracking** (`app.js:85+`):
   - On `startPinch`, also record
     `startAngle = atan2(p1.y - p0.y, p1.x - p0.x)` and
     `startRotation = sim.camera.rotation`.
   - On move (two pointers), compute `currentAngle`. New
     `cam.rotation = pinch.startRotation + (currentAngle - startAngle)`.
   - Adjust `cam.tx/ty` to keep the pinch midpoint anchored in
     world space (the same midpoint already used for scale).
5. **2× zoom-out**: `MIN_SCALE` `0.25` → `0.125`. One-line edit.

## Critical files

- `assets/core/sim.js` — camera shape + new screen↔world helpers.
- `assets/core/state.js` — `MIN_SCALE` halved.
- `assets/app.js` — pinch handler (record start angle, apply
  rotation on move); migrate every inline `cam.scale / cam.tx`
  inversion to the helper.
- `assets/render/canvas2d.js` — `withCameraCtx` rotation step;
  every place that draws screen-space-with-respect-to-world.
- `assets/render/webgl2.js` — extend `u_camera` to `vec4`; rotate
  in every vertex pass.
- `assets/render/webgpu.js` — extend `cameraVp` carry; rotate in
  every vertex pass.

## Verification

1. `node --test` clean.
2. All 3 renderer modules import cleanly.
3. Manual: pinch with two fingers and twist — view rotates around
   the pinch midpoint. Pan + zoom + rotate compose smoothly.
4. Manual: drag a cell with rotation ≠ 0; cell follows the cursor
   correctly (hit math respects rotation).
5. Toggle through canvas2d / webgl2 / webgpu at the same camera
   state; visual output is rotation-comparable.
6. Manual: zoom out until `cam.scale === 0.125` (twice as far as
   before). Cells visibly half their previous minimum size.

## Branch

`claude/rotation-and-zoom` (off main).
