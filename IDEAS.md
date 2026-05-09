# Ideas — things to revisit later

A scratchpad for "good idea, but not now" items uncovered while
working on the renderer / docs / game-mode work. Each entry has a
short rationale + a clear trigger for when to pick it up.

---

## Shaders: write WGSL once, cross-compile to GLSL

**The pain it would solve.** Every renderer-touching PR currently
edits `assets/render/webgl2.js` (GLSL ES 3.00) **and**
`assets/render/webgpu.js` (WGSL) — same logic, two languages. The
double-edit cost is bounded (~5–10 minutes per PR; perhaps 2–4 hours
across the year), but it's a permanent overhead.

**The candidates.**

- **`naga-oil`** ([github.com/bevyengine/naga_oil](https://github.com/bevyengine/naga_oil))
  / **`naga`** itself (Rust) — Bevy / wgpu's shader translator.
  WGSL → SPIR-V → GLSL ES 3.00 round-trip is well-trodden. Has WASM
  builds, but the JS bindings are still rough.
- **`tint`** (Google's WGSL/SPIR-V/GLSL compiler from Chrome's WebGPU
  pipeline). C++; would need a wasm build.
- **`@webgpu/glslang`** style wrappers — older WGSL toolchains.

**Why not yet.**

- We have **no build step** today. Vanilla ES modules, no bundler.
  Adopting a cross-compiler means introducing one of:
  - a build-time compile step (run `naga-cli` over `*.wgsl` →
    `*.glsl.js`, vendor the output)
  - or a runtime translator loaded as wasm in the browser
- Either path is "right tool for the wrong moment" — the cost of
  setting it up dwarfs the cost of hand-keeping the two shader files
  in sync.

**When to revisit.**

- We add a build step for **any other reason** (TypeScript, bundling,
  i18n compilation, asset pipeline). Then bolting on `naga-cli`
  becomes near-zero marginal cost.
- The shader codebase grows past ~3000 lines per backend (currently
  ~600 lines of fragment shaders per backend). At that volume
  the dual-edit cost starts hurting.
- We add **compute shaders** for GPU-side gameplay (particle
  flocking, fluid dynamics for the bloodstream). WebGL2 has no
  compute, so we'd need to either drop the WebGL2 backend or write
  the compute logic twice (CPU fallback for WebGL2). At that point
  having a single source of truth for shaders matters more.

**See also.** Detailed comparison of library options is in
[`RENDERERS.md`](./RENDERERS.md) → "Would a library help?".
