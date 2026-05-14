---
name: webgl-debugger
description: Use when debugging WebGL2 / OpenGL ES 3 rendering bugs where draws silently produce wrong output (black framebuffer, missing pixels, "ghost" results, things only break on frame 2+). Covers the readPixels + gl.getError diagnostic pattern, the framebuffer feedback-loop class of bug, and the dummy-texture fix that lets samplers stay valid without trapping the FB target.
---

# WebGL2 silent-failure debugger

When a WebGL2 draw "looks broken" but the console is silent — black where colour should be, output from previous frames, or symptoms that only appear from frame 2 onwards — the cause is almost always one of:

1. **Framebuffer feedback loop** — a texture is bound to a sampler unit AT THE SAME TIME it's a colour attachment of the bound framebuffer. The driver doesn't crash; it just silently fails the `drawArrays` call.
2. **Sampler pointing at a unit with nothing bound** — `gl.bindTexture(target, null)` makes the sampler unit invalid even if the shader never executes the `texture()` call.
3. **FBO incomplete** — wrong attachment formats, mismatched sizes, missing depth attachment.

The diagnostic + fix below targets case (1) + (2), which are the most common silent-failure patterns this project has hit.

## 1. Drop in a per-frame diagnostic

Add a throttled `readPixels` + `gl.getError()` block immediately after the failing pass. Log enough state to tell what's changing between the first (working) frame and subsequent (broken) frames.

```js
// Place inside the suspected pass, right after the last drawArrays.
if (this._sceneFbo && (S.someToggle)) {
  const now = performance.now();
  if (!this._diagLastMs || now - this._diagLastMs > 1000) {
    this._diagLastMs = now;
    const px = new Uint8Array(4);
    const cx = (this.canvas.width / 2) | 0;
    const cy = (this.canvas.height / 2) | 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
    gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const err = gl.getError();
    const bg0 = layers[0] || {};
    // eslint-disable-next-line no-console
    console.log('[diag]',
                `px=rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
                `glErr=${err}`,
                `kind=${bg0.kind}`,
                `base=${bg0.base}`,
                /* …per-bug context: uniforms, S.*, this.camera.* */);
  }
}
```

Why these fields:

- `readPixels` returns the *actual* FB content. Useful to disambiguate "shader output is black" vs "shader didn't run." If RGB is real but you see black on screen, the bug is downstream (compositing / blit).
- `gl.getError()` clears the error latch when called. Without this you can't tell whether the failure is an `INVALID_OPERATION` from THIS frame or a sticky one carried over.
- The right-hand context fields are bug-specific: log whatever could differ between the working and broken frame (kind, uniforms, camera state, layer count, post-chain composition).

## 2. Interpret the error codes

`gl.getError()` returns one of:

| Code | Symbol | What to look for |
|------|--------|------------------|
| `0`   | `GL_NO_ERROR` | Draw passed; bug is logical (wrong uniform value, wrong blend mode, wrong shader). |
| `1280` | `GL_INVALID_ENUM` | Bad constant passed to a `gl.*` call. Usually a typo. |
| `1281` | `GL_INVALID_VALUE` | Out-of-range numeric arg (`viewport(-1, …)`, attachment index too high). |
| `1282` | `GL_INVALID_OPERATION` | **Feedback loop, sampler pointing at incompatible/null texture, drawing with no program, reading from incomplete FBO**. Most common silent-failure code. |
| `1285` | `GL_OUT_OF_MEMORY` | Texture/FBO allocation failed. |
| `1286` | `GL_INVALID_FRAMEBUFFER_OPERATION` | FBO not complete. Call `gl.checkFramebufferStatus(gl.FRAMEBUFFER)` to narrow it. |

A `1282` that appears starting on frame 2 and persists is the canonical fingerprint of a feedback loop.

## 3. Find the feedback loop

The pattern, in pseudocode:

```
endFrame:
  use post-chain program
  bindTexture(TEXTURE_2D, RT_A.tex)     ← bind for sampling
  draw to canvas                        ← reads RT_A
  /* RT_A.tex stays bound to TEXTURE0 after endFrame returns */

next frame's beginFrame:
  bindFramebuffer(RT_A.fbo)             ← bind for writing
  draw                                  ← INVALID_OPERATION
                                        ← same texture is both
                                        ← sampler binding AND FB
                                        ← colour attachment.
```

The rule (from the WebGL2 / OpenGL ES 3 spec): a texture's image **must not** be a colour attachment of the bound framebuffer AND simultaneously bound to a sampler unit referenced by any sampler uniform in the current program. The driver doesn't crash — it just kills the draw and sets `INVALID_OPERATION`.

WebGL2 enforces this **per sampler uniform declared in the program**, not just per uniform actually executed. If the shader has `uniform sampler2D u_reactorTex` and `if (u_kind == 8) { texture(u_reactorTex, ...); }` — and `u_kind != 8` — the sampler uniform still must point to a valid (non-feedback) texture at draw time. The shader path doesn't have to USE it; just DECLARING it is enough.

## 4. The dummy-texture fix

Two wrong impulses that don't work:

- **Unbind to `null`**: `gl.bindTexture(TEXTURE_2D, null)` removes the feedback BUT now the sampler uniform points at a unit with no compatible texture → also `INVALID_OPERATION`. (This is what PR #243 tried and got burned by.)
- **Skip the bind on kinds that don't need it**: same problem — the LAST thing bound stays bound, which may be the feedback texture.

The correct fix is to bind a **1×1 RGBA dummy** to every texture unit referenced by a sampler uniform in the current program, before any draw, on every kind. Kind-specific branches that need a real texture override the dummy for their unit; everything else keeps the dummy.

```js
_ensureDummyTex() {
  if (this._dummyTex) return;
  const gl = this.gl;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  this._dummyTex = t;
}

// In the writing pass, BEFORE any drawArrays:
this._ensureDummyTex();
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, this._dummyTex);
gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, this._dummyTex);
// …kind-specific branches below rebind only the units they actually use.
```

This satisfies both rules at once:

- The dummy is NOT the colour attachment of the FB you're rendering to → no feedback.
- The dummy is NOT `null` → sampler validity preserved.

Place the dummy bind in the **writing pass**, not the reading pass. The reading pass already binds the right textures explicitly; it's the next writing pass that needs to start from a known-safe state.

## 5. Reasoning checklist when you hit a silent black render

1. **Is it frame 1 or frame N?** Frame 1 working + frame 2+ broken → feedback loop or stale binding. All frames broken → bad uniform / blend / FBO setup.
2. **Drop in the diagnostic.** Confirm `gl.getError()` returns `1282` and identify which pass is failing (the readPixels just before the chain runs vs just after will narrow it).
3. **Inventory sampler uniforms in the failing shader.** Every `uniform sampler2D` declared in the program must point to a valid texture at draw time, whether the shader executes the `texture()` call or not.
4. **Look for textures bound by an EARLIER pass that are also the current FB attachment.** Post-processing chains are the usual culprit: the chain's reading-pass binds RT-A for sampling, the next frame's writing-pass renders into RT-A.
5. **Bind dummies before draw, not after.** The dummy bind is the WRITING pass's responsibility — don't try to clean up after the reading pass.

## 6. Reference PRs from this project

- **PR #243** (`f070469`) — initial wrong fix: `bindTexture(null)` after the post-chain. Diagnostic logged `glErr=1282` again, same RGB(0,0,0,255), confirming `null` doesn't satisfy sampler validity.
- **PR #244** (`149083f`) — correct fix: bind 1×1 dummy to `TEXTURE0` + `TEXTURE1` at the start of every bg pass. Diagnostic should now show `glErr=0` and real RGB on every frame.

## 7. Other useful diagnostic snippets

**Check FBO completeness:**

```js
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
if (status !== gl.FRAMEBUFFER_COMPLETE) {
  console.warn('FBO incomplete:', status.toString(16));
}
```

**Dump the active program's sampler uniforms (one-shot, for spelunking):**

```js
const prog = gl.getParameter(gl.CURRENT_PROGRAM);
const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
for (let i = 0; i < n; i++) {
  const info = gl.getActiveUniform(prog, i);
  if (info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_CUBE) {
    const loc = gl.getUniformLocation(prog, info.name);
    const unit = gl.getUniform(prog, loc);
    console.log(`  ${info.name} -> TEXTURE${unit}`);
  }
}
```

**Clear sticky errors at frame start** (helps isolate which frame introduced one):

```js
// eslint-disable-next-line no-empty
while (gl.getError() !== gl.NO_ERROR) {}
```

## 8. WebGPU note

WebGPU has stricter validation than WebGL2 — it generally catches feedback loops at bind-group-creation or render-pass-begin time and surfaces them as console errors. If WebGPU is broken silently (e.g. completely-black canvas with no console output), the cause is usually different from WebGL2: texture state transitions across submission boundaries, surface-texture lifetime, or device-specific tile-cache flush issues. Don't apply the WebGL2 dummy-texture fix directly to WebGPU — it doesn't have the same "sampler must point to valid texture" rule once bind groups are created.
