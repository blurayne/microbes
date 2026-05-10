# Plan #6 — Virus 3D shader, WebGPU + Canvas2D ports

## Context

[Plan #2](./02-virus-shader-experiment.md) shipped the virus 3D
shader on **WebGL2 only** (PR #50). When `S.virusShader3D` is on,
virus cells render with a faux 3D sphere derived from the disk's
local UV: cnoise-driven displacement + diffuse lighting from a
fixed top-left source.

For renderer parity (CLAUDE.md house rule), the same effect needs
to land on the project's default renderer (WebGPU) and ideally on
Canvas2D too. The toggle is currently a no-op in those two
backends.

## Audit

- WebGL2 reference is in `assets/render/webgl2.js`:
    - `isVirus3D()` decode at the v_kind helpers section.
    - `cnoise(P)` + Stefan Gustavson's classic-2D-noise helpers
      (`_cnoise_mod289` / `_permute` / `_invSqrt` / `_fade`).
    - The branch in FRAG_DISK's `main()` just before
      `outColor =`. ~25 lines of GLSL.
    - JS-side: `kindAsFloat` packs bit 9 as
      `(c.type === 'virus' && S.virusShader3D ? 1 : 0) * 512`.
- The vendored source is at
  `assets/shaders/vendor/{vert-sphere,frag-sphere}.glsl`.

## Approach

### WebGPU port (most of the work)

1. Add `is_virus_3d` decode helper to DISK_WGSL alongside the
   existing v_kind helpers. Same bit (9 → 512).
2. Port the cnoise + helpers to WGSL. WGSL's lack of GLSL's
   `mix(vec, vec, vec)` and `mod` differences require small
   syntactic adjustments — the actual math is unchanged.
3. Insert the same surface-replacement branch in DISK_WGSL's
   `fs_main()` just before the alpha-output return.
4. JS-side packing in `webgpu.js` already mirrors `webgl2.js`'s
   instance layout — extend it the same way as PR #50.

### Canvas2D port (much smaller)

Canvas2D doesn't have a fragment shader equivalent. The
practical port renders the virus cells with a **CSS-light-style
radial gradient** + a few overlaid bright spots animated in
`u_time` to suggest the rolling-noise look. Won't match the GPU
versions byte-for-byte, but should give a clear "different
visual" toggle so the A/B comparison is still useful in canvas2d
mode.

If the cost is too high, leave canvas2d as a documented gap in
this plan file and ship only the WebGPU port.

## Critical files

- `assets/render/webgpu.js` — DISK_WGSL helpers + fs_main branch,
  JS instance packing.
- `assets/render/canvas2d.js` (optional) — `_drawCellBodies`
  branch when `c.type === 'virus' && S.virusShader3D`.

## Verification

1. `node --test` clean.
2. `?renderer=webgpu`, toggle `S.virusShader3D` on. Virus cells
   render with the 3D sphere look that matches WebGL2 side-by-
   side.
3. Toggle off → virus reverts to today's appearance.
4. Other cell types are unchanged in both states.

## Branch

`claude/virus-shader-3d-webgpu` (off main).
