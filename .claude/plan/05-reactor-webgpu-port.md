# Plan #5 — Port the Reactor (Gray-Scott) bg to WebGPU

## Context

[Plan #4 (#37)](./04-reactor-bg.md) shipped the Gray-Scott
reaction-diffusion background as a WebGL2-only feature. WebGPU
(the project's default renderer) currently falls through to the
theme's flat `base` colour for `bg.kind === 'reactor'`, which
breaks the **renderer-parity** house rule.

This plan finishes the port: the reactor theme should look the
same on WebGPU as on WebGL2.

Canvas2D parity is **out of scope and permanent** — Gray-Scott
in JS via ImageData reads/writes can't hit 60 fps, so canvas2d
will keep showing the flat base.

## Audit

- Existing WebGL2 implementation in `assets/render/webgl2.js`
  is the reference. Two key shaders:
    - `FRAG_REACTOR_STEP` — one Gray-Scott iteration.
    - `FRAG_REACTOR_SEED` — copies the front RT and stamps up
      to 8 fresh B-discs at uniform-random UV positions.
  Plus `FRAG_BG` `kind == 8` branch for display.
- Two `gl.RGBA8` textures + FBOs ping-pong; `_reactorFront`
  index swaps each step. Texture filtering is `NEAREST` (bilinear
  blending breaks the laplacian).
- WebGPU already has render-texture infrastructure (the
  metaSplit pipeline does ping-pong RTs). We can reuse that
  pattern: `device.createTexture({ format: 'rgba8unorm', usage:
  TEXTURE_BINDING | RENDER_ATTACHMENT })` ×2.

## Approach

1. **WGSL ports of the two shaders.** Mechanical translation
   from GLSL ES 300 → WGSL:
    - `texture()` → `textureSample()` with a `sampler` binding
      (or `textureLoad` with manual coord rounding for true
      NEAREST; `textureSample` with a NEAREST-filter sampler is
      simpler and equivalent).
    - `out vec4 outColor;` → `@location(0) vec4<f32>` returned
      from the fragment entry point.
    - The seed shader needs a uniform with `seedCount: u32` +
      `seeds: array<vec3<f32>, 8>`.
2. **Pipelines** — two render pipelines (`_reactorStepPipeline`,
   `_reactorSeedPipeline`) that target the off-screen texture
   format. Reuse the existing fullscreen vertex shader.
3. **Two GPUTextures** at `min(0.5 × W, 256) × min(0.5 × H, 256)`
   (matches webgl2). Sampler is NEAREST + clamp-to-edge.
4. **Initial fill** — write `(0.05, 0, 0, 1)` once on
   allocation. Cheapest: `device.queue.writeTexture` with a tiny
   solid-colour buffer, or a one-shot clear pass via a render
   pass with `loadOp: 'clear', clearValue: { r: 0.05, ... }`.
5. **Display path** — the existing BG_WGSL pipeline gains a
   `kind == 8` branch + a `@group(0) @binding(N)` for the
   reactor texture + sampler. Bind the front RT each frame.
6. **Lifecycle** — lazy alloc on first reactor frame; release
   on theme switch (mirrors webgl2's `_reactorDestroy`).

## Critical files

- `assets/render/webgpu.js` — new WGSL shader strings + pipelines
  + ping-pong RT pair + seed-uniform buffer. Add `kind == 8`
  branch to `BG_WGSL` (currently dispatches up to kind 7).
- No state.js / canvas2d.js / webgl2.js changes (all already
  done in Plan #4).

## Verification

1. `node --test` clean.
2. `?renderer=webgpu`, theme = "Reactor": same visual as
   WebGL2 — handful of dots on first frame, growing into the
   characteristic Gray-Scott Turing pattern over 5–10 s, fresh
   spots every ~10 s.
3. Toggle theme away and back — RTs reset cleanly.

## Branch

`claude/reactor-webgpu-port` (off main).
