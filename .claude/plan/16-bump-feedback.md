# Plan 16 — Bump feedback (collision flash + squash)

## Context

When two cells (or a cell + pathogen) collide, the sim just runs
push-apart + elastic bounce (`assets/core/sim.js` lines 770-808)
and moves on. A virus ramming into a macrophage looks the same
as two neutrophils brushing past at near-zero velocity. The user
wants collisions to feel like collisions.

After a multi-option suggestion round the user picked the
cheapest, most universal option:

- **Effect**: per-cell squash + outline flash via the cell shader.
- **Setting shape**: single "Bump feedback" toggle + intensity
  slider in Settings → Look.
- **Intensity model**: scaled by closing speed at contact, so
  hard hits punch and crowded jostle stays calm.

Rejected this round (easy to add later): particle bursts,
ripple-bg shockwaves, combat-pair colour coding.

## Audit

* Collision loop already computes `nx, ny` (contact normal) and
  `velAlongNormal` (closing speed × −1) for the bounce impulse.
  Free signal to reuse.
* `c.flash` (sim.js:133) is already plumbed to instance slot
  `[20]` of the cell instance buffer in webgl2 + webgpu, and
  drives a white outline halo across all three renderers. Reuse
  is free — no GPU pipeline change for the flash half.
* No `onCollide` event hook exists. None is needed — this is a
  closed-loop write inside the physics step.
* SPLITTING cells skip the collision loop (`if (state !== 'NORMAL')`),
  so the metaball pipeline doesn't need a parallel bump path.

## Approach

### 1. Sim — emit per-cell bump intensity

`assets/core/sim.js`:

* Cell init (~line 133) — new `bumpX: 0, bumpY: 0` fields next
  to `flash: 0`.
* `update(dt)` decay (~line 545) — exponential decay matching the
  flash feel: `c.bumpX *= Math.exp(-dt * 5)` (≈150 ms half-life),
  zeroed below 1e-3.
* Collision branch (~line 798) — after the existing bounce
  impulse:

  ```js
  if (S.bumpFeedback) {
    const closing = -velAlongNormal;
    const k = Math.min(1, closing / 60) * (S.bumpFeedbackIntensity ?? 1);
    if (k > 0.05) {
      const flashAmt = Math.min(1, 0.6 * k);
      if (a.flash < flashAmt) a.flash = flashAmt;
      if (b.flash < flashAmt) b.flash = flashAmt;
      a.bumpX = -nx * k; a.bumpY = -ny * k;  // squash axis points INTO a
      b.bumpX =  nx * k; b.bumpY =  ny * k;
    }
  }
  ```

### 2. Renderer wiring

* **webgl2 + webgpu** — extend the cell instance layout from
  `22` → `24` floats (slots `[22] = bumpX`, `[23] = bumpY`).
  - WebGL2: new `vertexAttribPointer` at location 8, pass-through
    `a_bump → v_bump`, fragment shader squashes `bodyR` along the
    bump axis just before `sdf = d - bodyR`.
  - WebGPU: new `@location(8)` in `VsIn`/`VsOut` + matching entry
    in the disk pipeline's `buffers[1].attributes` at offset 88.
    Same squash math in WGSL.
  - Squash formula:

    ```glsl
    float along = dot(v_uv / max(1e-4, d), normalize(v_bump));
    bodyR *= 1.0 - 0.30 * length(v_bump) * along;
    ```

    Side facing the impact compresses up to 30 %; far side bulges.
    Magnitude 0.30 chosen so peak bump (k=1) reads as a clear
    squash without looking comical.

* **canvas2d** — bodies are drawn with `ctx.arc`, not amenable
  to non-uniform scaling. Skip the squash; the existing flash
  rendering already brightens the outline on impact. Documented
  parity gap.

### 3. State + i18n

`assets/core/state.js`:

* `DEFAULTS`: `bumpFeedback: true`, `bumpFeedbackIntensity: 1.0`.
* `loadSettings`: clamp intensity to `[0, 3]`; default-on coerce
  for the boolean (matches the pattern around `glassStrength`).
* i18n en + de adjacent to the glass entries.

### 4. UI

`index.html` — checkbox + slider added to Settings → Look,
right after the wobble slider (which is the same per-cell visual
neighbourhood).

`assets/app.js` — `bindCheckbox('bumpFeedback', …)` +
`bindRange('bumpFeedbackIntensity', …)` next to `bindRange('wobbleAmp', …)`.

## Critical files

* `assets/core/sim.js` — cell init + decay + collision hook.
* `assets/core/state.js` — DEFAULTS, load/clamp, i18n.
* `assets/render/webgl2.js` — INSTANCE_FLOATS bump 22→24, new
  attribute, shader squash.
* `assets/render/webgpu.js` — mirror of above.
* `assets/render/canvas2d.js` — unchanged (flash already
  rendered; documented gap).
* `index.html`, `assets/app.js` — UI wiring.

## Verification

* `node --test` — 35/35 green.
* Renderer-module imports for canvas2d / webgl2 / webgpu.
* Manual:
  - Enable Bump feedback. Two cells colliding head-on visibly
    squash (webgl2 + webgpu) and flash (all three renderers).
  - Drag intensity slider; effect scales linearly.
  - Slow brush-past barely flickers; hard head-on pop pronounced.
  - Renderer switch (Look → Renderer): squash visible on
    webgl2 + webgpu, flash-only on canvas2d.
  - Edge case: 30 cells crammed in a corner — bump field decays
    per-frame so they don't stay permanently squashed.

## Branch

`claude/bump-feedback`.
