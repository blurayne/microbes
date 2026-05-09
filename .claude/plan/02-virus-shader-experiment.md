# Plan #2 — Virus 3D shader experiment

## Context

Experiment: port the WebGL-Shaders.com sphere demo
(<https://webgl-shaders.com/sphere-example.html>) onto the **virus**
pathogen so it renders as a noise-displaced shaded sphere instead
of the flat 2D disk. Gated by a settings toggle so it can be A/B'd
on the live site without code changes.

**Awaits**: GLSL source from
- `https://webgl-shaders.com/shaders/vert-sphere.glsl`
- `https://webgl-shaders.com/shaders/frag-sphere.glsl`

(The host blocks the sandbox's fetch agent. User will paste the
contents when this plan moves to execution.)

## Audit

- **`assets/core/state.js:CELL_TYPES.virus`** — `body.kind`
  currently maps to one of the 6 generic body shapes. Disk-pass
  shader (`FRAG_DISK`) computes everything per-pixel from a 22-
  float instance buffer; `bodyKind` selects between
  `round / lobed / rippled / oblong / pseudopod / star`.
- The disk shader runs on a flat 2D quad. To get a "3D sphere"
  look without changing the geometry pipeline, we reconstruct a
  pseudo-normal from the disk UV and apply lighting per-fragment.

## Approach

1. **Settings toggle**: add `S.virusShader3D = false` (default off)
   to `DEFAULTS`. Add a simple checkbox to the settings panel
   ("3D virus shader (experimental)").
2. **New `bodyKind` value**: `bodyKind: 6` for `'virus3d'` in the
   shader-side enum. Plumb through the JS pack site so the virus
   instance gets `bodyKind=6` when the toggle is on, falling back
   to its current bodyKind otherwise.
3. **Port the GLSL** verbatim into a new branch in `FRAG_DISK`:
   - The original vertex shader's noise-displacement won't apply
     directly (we don't have real sphere geometry). Instead,
     reconstruct a pseudo-normal:
     ```glsl
     float r2 = dot(uv, uv);
     if (r2 > 1.0) discard;
     vec3 n = vec3(uv, sqrt(1.0 - r2));
     ```
     Use this `n` everywhere the original shader uses the vertex
     normal.
   - The fragment shader's lighting / colour math ports verbatim.
   - `u_time` already plumbed in our shader.
4. **Mirror in WGSL** for `assets/render/webgpu.js`'s `DISK_WGSL`.
5. **Canvas2D**: out of scope — virus stays as the existing 2D
   round disk on canvas2d (per the user's "Virus only, GPU
   renderers" pick).

## Critical files

- `assets/core/state.js` — `S.virusShader3D` default + locale
  strings + `validVirusShader` migration if needed.
- `index.html` — settings checkbox.
- `assets/app.js` — `bindCheckbox('virusShader3D', …)` line.
- `assets/render/webgl2.js` — new `bodyKind` branch in `FRAG_DISK`,
  ~50 lines of GLSL. JS pack site sets `kind = 6` for virus when
  toggle is on.
- `assets/render/webgpu.js` — same in WGSL.

## Verification

1. `node --test` clean.
2. Manual `?renderer=webgpu` and `?renderer=webgl2`: toggle the
   "3D virus shader" checkbox in settings. With it ON, virus cells
   render as a shaded sphere matching the WebGL-Shaders.com demo's
   look. With it OFF, virus renders as the existing 2D disk.
3. Other cell types unchanged in both states.
4. No FPS regression at 200+ cells (lighting is per-pixel but
   cheap; should stay flat).

## Branch

`claude/virus-shader-experiment` (off main; awaits GLSL paste).
