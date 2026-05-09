# Renderers — architecture, performance, and what to keep

The microbes game ships **four renderers** behind a tiny `IRenderer`
interface (`assets/render/renderer.js`). The user picks one in the
settings panel; the rest of the game (sim, state, UI) is renderer-
agnostic.

| Renderer  | Source                          | LOC   | Notes                                |
|-----------|----------------------------------|-------|--------------------------------------|
| canvas2d  | `assets/render/canvas2d.js`     | 1574  | 2D Canvas API, immediate-mode        |
| webgl2    | `assets/render/webgl2.js`       | 2249  | WebGL 2.0, GLSL ES 3.00 shaders      |
| webgpu    | `assets/render/webgpu.js`       | 2772  | WebGPU, WGSL shaders                 |
| pixi      | `assets/render/pixi.js`         | 1076  | Pixi.js v8 high-level wrapper        |

This doc explains why pixi is slower at scale, what differs between
the three "real" renderers, and recommends what to keep.

## TL;DR

- **Pixi is slower** because its API model is geometry-per-shape:
  every cell records ~13 fill/stroke calls and a fresh
  `FillGradient` per frame, which Pixi's batcher can't compress.
  WebGL2/WebGPU bypass that with custom fragment shaders that
  compute everything per-pixel from a single `(22 floats × N)`
  instance buffer.
- **Removing pixi** is reasonable. Removing webgl2 or webgpu would
  regress the "constant frame rate at high N" property the GPU
  renderers already give you.
- **WebGL2 vs WebGPU**: nearly identical perf for our workload,
  same visual output; the gap is API ergonomics + browser support.
  Concrete recommendation below.

## Why not Pixi

(Same audit findings as the perf research that preceded this doc.)

### Per-frame work — by the numbers

| Layer              | webgl2 / webgpu                                      | pixi                                                                |
|--------------------|------------------------------------------------------|---------------------------------------------------------------------|
| GPU draw calls     | ~6 fixed (bg, disk-instanced, particles, decor-line, decor-tri, faces) + per-pair metaSplit | varies; Pixi's batcher walks geometry per cell             |
| JS work scaling    | **O(1)** — pack one instance buffer per frame, then **one** instanced draw | **O(N) with a high constant** — ~13 `g.fill / g.stroke` calls per cell, plus separate Graphics passes for nuclei + faces |
| Filter / RT round-trips | **0** — every effect is a fragment shader   | **5+ per frame** — BlurFilter on face buckets (×4), nuclei container, splitting pairs |

`grep -c BlurFilter\|ColorMatrixFilter` per file: **pixi 10 · webgl2 0 · webgpu 0**.

### What WebGL2 / WebGPU do that Pixi can't easily match

A "cell" in the GPU renderers isn't real geometry. It's:

- One instanced quad (4 verts shared by all cells)
- 22 floats of per-cell data: `(x, y, r, kindAsFloat)`,
  `(phase, seed, freq, wobbleMul)`, 4 colours, outline, diskAlpha
- The fragment shader (`FRAG_DISK` in webgl2, `DISK_WGSL` in webgpu)
  computes everything from those 22 floats: the wobble polygon
  distance via `bodyScale(uv)`, the cytoplasm gradient (radial), the
  nucleus shape (round / kidney / bilobed / multilobed branches),
  the donut hole (RBC-style stacked falloff), the top-left
  highlight, the outline ring, the selection halo. Per-pixel, in
  parallel, on the GPU.

For N cells:

- CPU work scales **only with the instance-buffer write** (~22 float
  writes per cell = a couple of microseconds at any scale).
- GPU work scales with **pixels covered**, not cells. 100 cells
  covering the same screen area cost roughly the same as 1 cell
  covering that area.

That's why frame rate stays flat as cell count climbs.

### What Pixi has to do for the same scene

Pixi v8's `Graphics` is a high-level recording API. The singleton
loop currently does this **per cell**:

```js
g.poly(pts).fill(grad);                       // wobble polygon, per-cell FillGradient
g.poly(pts).stroke({...});                     // membrane stroke
g.circle(s.x, s.y, dr*1.00).fill({...});       // donut layer 1
g.circle(...).fill({...});                     // donut layer 2
g.circle(...).fill({...});                     // donut layer 3
g.circle(...).fill({...});                     // donut layer 4
g.circle(...).fill({...});                     // top-light layer 1
g.circle(...).fill({...});                     // top-light layer 2
g.circle(...).fill({...});                     // top-light layer 3
g.circle(...).fill({...});                     // top-light layer 4
// + outlines if hollow type
```

That's ~13 method calls × N cells per frame **just for bodies**.
Each `FillGradient` is a fresh allocation (= GC pressure). Pixi's
batcher tries to merge same-state submissions, but a per-cell unique
gradient defeats batching — every cell becomes its own batch.

Then it does the same dance for nuclei (separate Graphics, more
circles per cell). Then the face pass, which for SPLITTING cells
routes into 4 BlurFilter buckets — **each bucket is a render-texture
round-trip every frame**.

### Could hardwiring Pixi into `sim.js` fix it?

No. The renderer abstraction layer is thin; bypassing it doesn't
buy you anything. The bottleneck is **Pixi's API model**. Calling
Pixi directly from `sim.js` would still call
`g.poly().fill().stroke()` per cell, which is the slow path.

### Two approaches that would actually speed Pixi up

1. **Replace `Graphics` with `Mesh` or `ParticleContainer`** — Pixi
   v8's lower-level primitives, exposing an instance-buffer model
   similar to what webgl2/webgpu use directly. Pack one big buffer
   per frame, draw all cells in one call.
2. **Write custom Pixi shaders** that mirror `FRAG_DISK` / `DISK_WGSL`
   — compute the body shape, gradient, nucleus etc. on the GPU
   instead of recording per-cell geometry on the CPU.

Both amount to **rebuilding the cell hot path inside Pixi to look
just like webgl2/webgpu**. At which point the webgl2/webgpu
renderers ARE the optimal answer; you'd just be wrapping them in
Pixi.

### Recommendation: drop pixi, or demote it

Two reasonable paths:

- **Demote pixi** to "experimental / not recommended for high-N
  gameplay" in the renderer picker, with a tooltip. Keeps the
  parity-test value of having a high-level reference renderer.
- **Remove pixi** outright. Cuts ~1100 lines of renderer code and
  10 BlurFilter allocations from the bundle without a perf or
  feature regression for end users.

Either way: keep canvas2d (universal fallback) + at least one of
webgl2 / webgpu (the perf-critical path).

## Canvas2D vs WebGL2 vs WebGPU

All three are kept in lockstep visually — same wobble shape, same
gradient stops, same nucleus geometry, same face spec. The
differences are about **how the pixels get computed**.

### Canvas2D

- **Engine**: 2D Canvas API (`getContext('2d')`).
- **Per-cell work**: explicit `arc`, `fill`, `stroke`, `setTransform`,
  `globalCompositeOperation`. Every cell is a sequence of immediate
  draws into the canvas back-buffer.
- **Effects**: `ctx.filter = 'blur(Npx)'` for the face blur,
  composite operations for the metaball pass, `globalAlpha` for
  fades.
- **Where it hurts**: per-cell calls scale linearly with N at the JS
  level. The blur for the metaball pass uses a temporary scratch
  canvas + `filter: blur(Npx) contrast(K)` — a CSS-filter pipeline
  inside the browser, faster than you'd expect but still
  CPU-rasterised.
- **Where it shines**: zero shader code, zero buffer management,
  works on literally every browser. ~1574 LOC, easy to read and
  modify. Great for debugging the visual spec since the code reads
  like the design doc.

### WebGL 2.0

- **Engine**: WebGL 2.0 + GLSL ES 3.00.
- **Per-cell work**: pack a `Float32Array(22 × N)` once per frame,
  call `gl.drawArraysInstanced(TRIANGLES, 0, 6, N)` once. The
  fragment shader does the rest.
- **Shader programs**: 18 (disk, particles, decor-line, decor-tri,
  bg, fullscreen, faces, meta-poly, meta-blur, meta-tint, …).
  Shared infrastructure: VAO, instance VBO, FBO pool for metaSplit
  RTs.
- **Effects**: every effect is a fragment shader. No filters, no
  RT round-trips except for the metaSplit blur (RT ping-pong via
  framebuffers).
- **Where it shines**: rock-solid browser support (Chrome 56+,
  Firefox 51+, Safari 15+ — basically everywhere since 2017).
  Familiar OpenGL state model; easy to debug with Spector.js.
- **Where it stings**: the OpenGL state machine (bound buffer,
  bound program, active texture unit) requires careful bookkeeping;
  silent failures on illegal state transitions; verbose VAO setup
  when you add a new attribute.

### WebGPU

- **Engine**: WebGPU + WGSL.
- **Per-cell work**: identical pattern to webgl2 — pack the same
  `(22 × N)` buffer, set the disk pipeline + bind group, dispatch
  one indirect-instance draw.
- **Pipelines**: 10 WGSL modules (disk, bg, particles, decor, face,
  meta-poly, meta-blur-h, meta-blur-v, meta-tint, marker). Each is
  a compiled `GPURenderPipeline` with explicit bind-group layout.
- **Effects**: same fragment-shader model as webgl2; metaSplit uses
  the WebGPU equivalent of FBO ping-pong via render textures + bind
  groups.
- **Where it shines**: explicit pipeline objects ⇒ no silent state
  failures (errors at pipeline-creation time, not at draw time).
  WGSL is stricter than GLSL (catches bugs the GLSL compiler would
  let through). Future path to compute shaders if we ever want
  GPU-side particle physics. Async API plays nice with rAF.
- **Where it stings**: more verbose (WebGPU is ~25% more LOC than
  webgl2 for the same scene). Browser support is improving but
  still narrower than webgl2 — Chrome/Edge full, Firefox stable in
  the last year, Safari macOS Tahoe (2025) yes, Safari iOS 17+ yes
  but with some quirks. Older devices (iOS < 17, mobile Firefox
  before its ship) silently fall back to webgl2 / canvas2d.

### Quick comparison

| | canvas2d | webgl2 | webgpu |
|---|---|---|---|
| Browser support | universal | universal (since 2017) | improving (Chrome/Edge/Safari macOS solid; Safari iOS 17+; Firefox stable since 2024) |
| Shader language | none | GLSL ES 3.00 | WGSL |
| Frame-rate scaling | linear with N (CPU-bound) | flat (GPU-bound on pixel coverage) | flat (same) |
| Code size | 1574 LOC | 2249 LOC | 2772 LOC |
| Effect engine | `ctx.filter`, composite ops | fragment shaders + FBOs | fragment shaders + render textures |
| Best for | debugging the visual spec; bulletproof fallback | high-N gameplay on any modern browser | forward-looking architecture; cleaner state model |
| Worst for | high-N gameplay (CPU-bound) | newer-API features (no compute) | older browsers (silent fallback needed) |

## Are webgl2 and webgpu both worth keeping?

Honest assessment, since you asked.

### What they share

- **Shaders are 1:1 in logic.** Every shader in `webgl2.js` has a
  WGSL twin in `webgpu.js`. The maths is identical; only syntax
  differs (`texture()` vs `textureSample()`, `varying out` vs
  `@location()`, etc.).
- **Visual output is pixel-comparable.** Several PRs in the recent
  history have explicitly verified side-by-side parity (the
  metaSplit phases, the cell-border slider, the WebGPU RBC stream
  backport).
- **Both bypass Pixi-style geometry-per-shape; both flat-FPS at
  scale.** Performance is indistinguishable for our workload.
- **Both render through the same `IRenderer` interface.** No game
  code change required to swap.

### Where they differ

- **Maintenance cost**: every shader-touching PR is **two file
  edits** instead of one. We've felt this in practice — every
  recent PR ("metaSplit phase A/B/C/D", "cell border thickness",
  "split-end continuity") has paired webgl2 + webgpu changes that
  do the same thing in two languages.
- **Browser support**: webgl2 covers more devices today (~99% vs
  ~85% for webgpu, depending on how you count Safari iOS).
- **Future**: webgpu has the architecture future (compute shaders,
  cleaner state, Vulkan-style explicit pipelines). webgl2 is in
  permanent maintenance — last spec update was 2017.

### Suggestion

**Keep both for now, with webgpu as the default-when-supported and
webgl2 as the fallback.** Pixi can go.

The reasoning:

1. **The shader-parity work is largely already done.** The double-
   edit cost has been paid for the existing pipelines. New PRs
   touching shaders will keep paying it, but it's a known constant
   (typically 5–10 minutes per change) — not a hidden tax.
2. **Browser support is in transition.** Removing webgl2 today
   would lose some users (older Safari iOS especially); removing
   webgpu would forfeit the cleaner architecture and the future
   compute path.
3. **Three renderers (canvas2d + webgl2 + webgpu) is the right
   number for cross-browser graceful-degradation:**
   - WebGPU first: best perf characteristics + cleanest code path
     for new development.
   - WebGL2 fallback: for browsers without WebGPU support, same
     perf at scale, same visual output.
   - Canvas2D fallback: ultimate fallback + invaluable as a
     visual reference (the only renderer where the code reads
     like the design doc).

If maintenance bites in 6–12 months once Safari iOS WebGPU is
solid across versions, **drop webgl2 then** — its only value at
that point is older-Safari coverage, which will be a shrinking
audience.

If the project stays small and the maintenance cost of two GPU
backends feels heavy now, **drop webgpu** — webgl2 has
near-universal support today, and you can always add webgpu back
when there's a concrete reason (e.g. compute shaders for particle
physics).

**Concrete next step regardless of which option you pick:** drop
pixi (per the section above). It's not pulling its weight —
slower at scale by design, and the parity-test value isn't worth
1100 LOC + 10 filter allocations.

## Would a library help?

Reasonable question — every recent PR has touched both `webgl2.js`
and `webgpu.js`, and the shaders are ~95% identical in logic. Could
we write the shader once and target both backends? Could we get
better effects "for free"?

### What a library would have to give us

For our codebase to benefit, a library would need to do at least
one of:

1. **Cross-compile a single shader source to GLSL ES 3.00 + WGSL** —
   so shader changes touch one file, not two.
2. **Provide an instance-buffer + custom-shader path** that's as
   thin as our current setup — without forcing us through a heavy
   scene graph / material system.
3. **Better metaSplit / blur / postprocessing** — production-quality
   effects we'd otherwise have to hand-roll.

Anything that doesn't deliver one of these makes the renderer
*more* complex, not less.

### The serious candidates

| Library | What it gives | What it costs | Verdict |
|---------|---------------|---------------|---------|
| **three.js + TSL** ([Three Shading Language](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)) | Single shader source compiles to both GLSL and WGSL via TSL's node graph. `WebGLRenderer` + `WebGPURenderer` both stable. Huge ecosystem of postprocessing effects (`UnrealBloomPass`, etc.). | Forces a 3D scene-graph + material system on a 2D game. Significant rewrite — probably 2–3× the LOC of current `webgl2.js` once you wrap our custom passes in three.js abstractions. ~700 KB minified. | **Strongest candidate if we wanted to commit to a library.** Would replace `webgl2.js + webgpu.js` (~5000 LOC) with a TSL-based renderer (estimated ~3000 LOC + three.js as a dep). Net win on shader maintenance, net loss on code simplicity. |
| **Babylon.js** | Similar to three.js: WebGPU + WebGL renderers, node-material editor. More gameplay-engine-y than three.js. | Even heavier than three.js. ~2 MB. Mostly aimed at 3D games. | Skip. |
| **regl** | Functional WebGL wrapper. Cleaner ergonomics than raw WebGL. | **WebGL-only.** Doesn't help with the dual-backend story at all. | Skip. |
| **OGL** | Lightweight 3D / 2D library. ~30 KB. | **WebGL-only.** Same as regl. | Skip. |
| **TWGL** | Helpers for WebGL geometry / textures. | WebGL-only. | Skip. |
| **`naga-oil` / `tint`-wasm** | Shader cross-compilers (WGSL → GLSL or vice versa). Author once, generate the twin. | Need a build step (we have none today — vanilla ES modules). Generated code is harder to debug. Currently rough JS bindings. | **Interesting but premature.** If we ever add a build step for other reasons, revisit — could cut the dual-shader cost without library adoption. |
| **PicoGL.js** | Tiny (12 KB) WebGL2-focused engine. | WebGL2-only. | Skip — same reason as regl. |
| **Stage3D / shaderfrog / Lygia** | Shader fragment libraries / repositories. | Don't solve the cross-backend problem; just provide reusable GLSL snippets. | Skip — our shaders are already short and tailored. |

### Effect-quality libraries (orthogonal to the cross-backend question)

If we wanted prettier effects without a full engine swap:

- **`postprocessing` package (npm)** — works with three.js. Bloom,
  DoF, vignette, chromatic aberration, etc. Requires three.js.
- **Pixi-filters** — drop-in filters for Pixi (we'd be locked into
  pixi for the renderer; we just argued against that).
- **Hand-rolling** — what we do now. The metaSplit pipeline (poly
  fill → blur → threshold → tint with edge mode) is essentially a
  custom postprocessing chain we built ourselves, ~600 lines per
  GPU backend. Working great; just hand-maintained.

### Honest recommendation

**Don't adopt a library yet.** Reasons:

1. **The double-edit cost is bounded.** Our shaders aren't large or
   complex. Each cross-backend PR has cost ~5–10 minutes extra
   versus one-backend work. Over a year that's perhaps 2–4 hours
   total — far less than the 1–2 weeks of refactoring needed to
   adopt three.js + TSL or to thread a build step for naga.
2. **The current architecture is the simplest thing that works.**
   Vanilla ES modules, no build step, raw WebGL/WebGPU. Adding a
   library introduces dependencies, bundle size, and a learning
   curve for anyone touching the code.
3. **The pain points (effect quality, shader maintenance) aren't
   acute.** The metaSplit pipeline looks great. The cross-renderer
   parity tests pass. Frame rate is constant at scale. None of this
   is broken.

**When to revisit:**

- If we ever add **compute-shader gameplay** (GPU-side particle
  flocking, fluid dynamics for the bloodstream): a library that
  makes compute pipelines easier (three.js TSL has compute support)
  starts paying off.
- If we add a **build step** for any reason (TypeScript, bundling,
  i18n compilation): the marginal cost of dropping in `naga`-wasm
  becomes near-zero, and the dual-shader problem dissolves.
- If the visual ambition grows significantly (PBR materials,
  shadow maps, complex postprocessing): three.js / Babylon become
  worth their weight.

For now: **keep what we have**, drop pixi, and treat the
webgl2/webgpu pair as the long-term default. Revisit libraries
when one of the three triggers above fires.
