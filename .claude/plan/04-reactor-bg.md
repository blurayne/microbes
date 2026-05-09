# Plan #4 — "Reactor" background (Gray-Scott reaction-diffusion)

## Context

Add a stateful **Gray-Scott reaction-diffusion** shader as a new
"Reactor" background theme. Unlike every existing bg shader (which
is single-pass / stateless), this one needs **ping-pong render
textures** so the shader can sample its own previous output.

User direction: random seed sites (no mouse interaction); seeds
placed initially, periodically refreshed. Theme name: "Reactor".

## Source shader (drop-in target)

```glsl
#define GLSLIFY 1
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;
uniform float u_frame;
uniform sampler2D u_texture;
varying vec2 v_uv;

vec4 laplacian(vec2 uv, sampler2D texture, vec2 texture_size) {
    float du = 1.0 / texture_size.x;
    float dv = 1.0 / texture_size.y;
    vec4 lap = -texture2D(texture, uv);
    lap += 0.2 * texture2D(texture, uv + vec2(-du, 0.0));
    lap += 0.2 * texture2D(texture, uv + vec2(du, 0.0));
    lap += 0.2 * texture2D(texture, uv + vec2(0.0, -dv));
    lap += 0.2 * texture2D(texture, uv + vec2(0.0, dv));
    lap += 0.05 * texture2D(texture, uv + vec2(-du, -dv));
    lap += 0.05 * texture2D(texture, uv + vec2(du, -dv));
    lap += 0.05 * texture2D(texture, uv + vec2(du, dv));
    lap += 0.05 * texture2D(texture, uv + vec2(-du, dv));
    return lap;
}

vec4 calculate_color(vec2 concentrations) {
    return vec4(concentrations * vec2(0.05, 1.0), 0.0, 1.0);
}

vec2 calculate_concentrations(vec4 color) {
    return color.rg / vec2(0.05, 1.0);
}

void main() {
    float D_A = 0.8;
    float D_B = 0.4;
    float feed = 0.06 * v_uv.x;
    float kill = 0.035 + 0.03 * v_uv.x + (0.022 - 0.015 * v_uv.x) * v_uv.y;
    float dt = 1.0;

    vec4 pixel_color = texture2D(u_texture, v_uv);
    vec2 concentrations = calculate_concentrations(pixel_color);
    float A = concentrations.x;
    float B = concentrations.y;

    vec2 lap = calculate_concentrations(laplacian(v_uv, u_texture, u_resolution));

    float dA = (D_A * lap.r - A * B * B + feed * (1.0 - A)) * dt;
    float dB = (D_B * lap.g + A * B * B - (kill + feed) * B) * dt;
    concentrations += vec2(dA, dB);

    if (length(gl_FragCoord.xy - u_mouse) < 5.0) {
        concentrations = vec2(0.0, 0.9);
    }

    gl_FragColor = calculate_color(concentrations);
}
```

For our integration: **drop the `u_mouse` poke** and replace it
with our random-seed-sites mechanism (uniform-random spots placed
on init + periodically refreshed).

## Audit

- All four current bg shader branches in `FRAG_BG` /
  `BG_WGSL` are single-pass (read screen UV, output colour).
  Reactor is the first feedback shader.
- WebGL2 has FBO infrastructure already (used for the metaSplit
  RT pool). We can reuse the FBO-allocation helpers.
- WebGPU has render-texture infrastructure (used for the metaSplit
  pipeline). Same pattern.
- Canvas2D has no realistic path: doing Gray-Scott in JS at 60fps
  via ImageData reads/writes is too slow. Canvas2D fallback should
  show a static placeholder (gradient or solid).

## Approach

1. **Theme entry** — add `reactor` to `THEMES` in
   `assets/core/state.js` with `kind: 'reactor'`. Add
   `'reactor'` to `KNOWN_THEME_KEYS` and the `validBackgrounds`
   list. Pick a UI accent (acid green: `#7eff8a`).
2. **Two FBOs / RTs** at canvas resolution (or 0.5× for cheaper
   iteration). One per "side"; ping-pong each frame.
3. **Step shader** (verbatim port of the source above, minus the
   mouse poke):
   ```
   bind FBO B; sample FBO A as u_texture; run Gray-Scott step;
   write to FBO B.
   swap A ↔ B.
   ```
4. **Display shader** — one fullscreen pass that samples the
   current "front" FBO and runs `calculate_color`. The bg is the
   final composited image.
5. **Random seed sites** — at theme switch (and every ~10 s), bind
   the active FBO and clear-write a few small B-concentration
   discs (5–8 discs of radius ~5 px, placed at uniform-random
   positions) without disturbing the rest of the texture. Cheapest
   implementation: a tiny shader that takes a list of seed-disc
   centres as a uniform array and writes B=0.9 inside any disc.
6. **Pipeline placement** — bg pass runs first in the frame
   (already does). For Reactor, run the step shader N times per
   visible frame (N=5 is typical for crisp Turing patterns; tune)
   then the display pass. The step iterations don't have to track
   simulation time — they're just "more iterations per visible
   frame".
7. **WebGL2 + WebGPU** both implement. Canvas2D: fall back to
   `solid` for this theme.

   **Actual scope shipped (PR #37):** WebGL2 only. WebGPU + Canvas2D
   fall through to the theme's `base` colour (acid-green `#02060a`,
   nearly black). The renderer-parity gap is tracked as Plan #5
   ([`05-reactor-webgpu-port.md`](./05-reactor-webgpu-port.md)) —
   the port is a mechanical translation of the GLSL into WGSL plus
   a ping-pong `GPUTexture` pool. Canvas2D has no realistic path
   (Gray-Scott in JS at 60 fps via ImageData reads/writes is too
   slow), so its base-colour fallback is permanent.
8. **Settings**: no user-facing parameters in the first cut. The
   feed/kill values come from the shader source. (A future
   follow-up could expose feed/kill as sliders.)

## Critical files

- `assets/core/state.js` — `reactor` theme, `KNOWN_THEME_KEYS`,
  `validBackgrounds`.
- `assets/render/webgl2.js` — new `_reactorRTs` (two FBOs),
  `_reactorStepProg` shader, `_reactorSeedProg` shader,
  display pass branch under `if (kind == 8)` in `FRAG_BG`.
- `assets/render/webgpu.js` — mirror in WGSL with two render
  textures + a step pipeline + a seed pipeline.
- `assets/render/canvas2d.js` — fallback to flat (or just leave
  unimplemented; bg renders as `bg.base`).

## Verification

1. `node --test` clean.
2. `?renderer=webgl2` and `?renderer=webgpu`, theme = "Reactor":
   - Initial frame: handful of dots scattered across the canvas.
   - Over 5–10 s: dots grow, split, develop the characteristic
     Gray-Scott Turing pattern (mottled cells).
   - Every ~10 s: new random spots appear and seed fresh growth.
3. Toggle to a different theme and back — ping-pong RTs reset
   cleanly (no leftover state).
4. Performance: should hold 60 fps even at full canvas
   resolution (the step is one read + one write per pixel).
5. Visual seed sites: 5–8 spots, random positions, refreshed ~10 s.

## Branch

`claude/reactor-bg` (off main).
