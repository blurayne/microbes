---
name: webgpu-debugger
description: Use when debugging WebGPU rendering bugs where draws silently produce wrong output (canvas renders completely black, a specific pass produces no pixels, validation errors flood the console with no obvious cause). Covers the pushErrorScope + createRenderPipelineAsync + getCompilationInfo diagnostic chain, the WGSL "uniform control flow" rule that bites textureSample calls inside if/for branches, and the in-app log dedupe pattern needed to keep one-shot init messages visible amid per-frame validation spam.
---

# WebGPU silent-failure debugger

WebGPU's validation model differs from WebGL2's. There's no `glGetError` returning a code; instead, the device emits validation errors that you can intercept with `pushErrorScope` + `popErrorScope`, or capture via a global `device.onuncapturederror` handler. **Errors are mostly silent until you set up a scope** — pipelines silently flip to an "invalid" state, every subsequent use produces a derivative error, and the actual root cause is often async (validation completes after `createRenderPipeline` returns).

This skill captures the diagnostic arc from PRs #246 → #250 → #252 → #253 → #255 → #256 → final fix.

## 1. The fingerprint

If you see this shape of error spamming every frame:

```
[Invalid RenderPipeline "<name>"] is invalid due to a previous error.
 - While Validating GetBindGroupLayout (0) on [Invalid RenderPipeline "<name>"]
```

or:

```
[Invalid RenderPipeline "<name>"] is invalid due to a previous error.
 - While encoding [RenderPassEncoder].SetPipeline([Invalid RenderPipeline "<name>"])
 - While finishing [CommandEncoder]
```

…a pipeline was rejected at create time and you're seeing **derivative** errors every frame. You need to find the **root** error.

## 2. Diagnostic plumbing

Wire the renderer for diagnosis BEFORE you start guessing fixes. Six pieces, in order of usefulness:

### a. Global uncaptured-error handler

```js
device.onuncapturederror = (event) => {
  console.warn('[webgpu] uncaptured error:', event.error && event.error.message);
};
```

Catches anything that escapes every scope. Install it immediately after `requestDevice()`.

### b. Per-frame validation scope

In `beginFrame`:

```js
device.pushErrorScope('validation');
this._diagScopeArmed = true;
```

In `endFrame`, after the last `queue.submit`:

```js
if (this._diagScopeArmed) {
  this._diagScopeArmed = false;
  device.popErrorScope().then((err) => {
    if (err) console.warn('[webgpu-diag] validation error:', err.message);
  });
}
```

Pop returns only the FIRST error in the scope. Repeated errors per frame produce one log line per frame.

### c. Init-time scope around pipeline construction

Wrap `_buildDiskPipeline / _buildOverlayPipelines / _buildMetaPipelines / …` in their own scope:

```js
device.pushErrorScope('validation');
this._buildDiskPipeline();
this._buildOverlayPipelines();
device.popErrorScope().then(err => err && console.warn('[webgpu init] pipeline validation error:', err.message));
```

Lazy pipelines built later (in `beginFrame`) need their OWN scope — the init scope already popped.

### d. Pipeline labels

Every `device.createRenderPipeline({...})` and `device.createShaderModule({...})` should get a `label:`. Error messages then say `[Invalid RenderPipeline "sceneFx"]` instead of `(unlabeled)`, so you know **which** pipeline to investigate.

### e. `getCompilationInfo()` on shader modules

```js
const mod = device.createShaderModule({ code: WGSL, label: 'sceneFx' });
mod.getCompilationInfo().then((info) => {
  for (const m of info.messages) {
    console.warn(`[webgpu sceneFx-shader] ${m.type} at ${m.lineNum}:${m.linePos}: ${m.message}`);
  }
});
```

WGSL parse errors / warnings land here with **line + column + severity**. Critical: this is the most informative source. Always wire it up.

### f. `createRenderPipelineAsync` for the actually-blocking validation

`createRenderPipeline` returns synchronously even when validation fails — the returned object is just marked invalid. Async pipeline validation completes AFTER your `pushErrorScope` has popped, so your handler returns `null`.

Use `createRenderPipelineAsync` alongside the sync call to surface the real error:

```js
this._sceneFxPipeline = device.createRenderPipeline(pipelineDesc);  // sync, immediately usable
device.createRenderPipelineAsync(pipelineDesc).then(() => {
  console.log('[webgpu sceneFx-async] pipeline validated OK');
}).catch((err) => {
  console.warn('[webgpu sceneFx-async] validation rejection:', err && err.message);
});
```

The async catch is the ground-truth source — its error message carries the actual driver reason.

## 3. Read the error message in order

A typical full WGSL rejection looks like:

```
Error while parsing WGSL: :80:21 error: 'textureSample' must only be called from uniform control flow
        sum = sum + textureSample(sceneTex, sceneSamp, uv + poisson[i] * px).rgb;
                    ^^^^^^^^^^^^^^

:74:5 note: control flow depends on possibly non-uniform value
    if (blurRadius < 0.5) {
    ^^

:28:13 note: builtin 'frag' of 'fs_main' may be non-uniform
  let uv  = frag.xy / dim;
            ^^^^
```

Read top to bottom:

- **error** line is the WHAT — the call that's illegal.
- **note** lines are the WHY — the WGSL static-analysis chain that proves the variable is non-uniform.

In the example above: `frag.xy` (line 28) → `uv` (non-uniform) → `blurRadius` (non-uniform) → `if (blurRadius < 0.5)` is non-uniform control flow → `textureSample` (line 80) inside it is illegal.

## 4. Common WGSL spec rules that bite

### a. `textureSample` requires uniform control flow

`textureSample` computes mipmap LOD via implicit derivatives, which require all fragments in a quad to take the same branch. WGSL rejects any call to `textureSample` from a branch whose condition depends on a non-uniform value (typically per-fragment data: `@builtin(position)`, varyings, sampled texture results, etc.).

**Fix**: replace with `textureSampleLevel(tex, samp, uv, 0.0)` — explicit LOD, no derivatives required, callable from any control flow. For a texture with no mipmaps (like an FBO color attachment), LOD=0 is the correct value anyway.

**`textureSampleGrad`** is another option if you actually need filtering with a controllable LOD.

**`textureLoad`** is the integer-coord, no-filtering, no-derivative load — fine for nearest-neighbour reads but doesn't filter.

### b. Auto-layout pipelines defer validation

`layout: 'auto'` on `createRenderPipeline` makes WebGPU infer the bind group layout from the shader bindings. On some drivers (notably Safari WebGPU) this validation happens **lazily** when `getBindGroupLayout(0)` is called — after your init-time `pushErrorScope` has popped. The error you see in your scope is the derivative `GetBindGroupLayout` rejection, not the actual auto-layout failure.

**Fix**: use an **explicit** `GPUPipelineLayout` with `device.createBindGroupLayout({ entries: [...] })` matching the shader's `@binding` declarations exactly. Catches the layout mismatch synchronously at pipeline create.

### c. Sampler / texture type mismatches in the bind group layout

When you declare an explicit `GPUBindGroupLayout`:

- `buffer.type` — `'uniform'`, `'storage'`, `'read-only-storage'`.
- `sampler.type` — `'filtering'`, `'non-filtering'`, `'comparison'`. Must match the shader's sampler binding.
- `texture.sampleType` — `'float'`, `'unfilterable-float'`, `'depth'`, `'sint'`, `'uint'`. Some formats (e.g. `r32float`) are unfilterable on some devices, so a `'filtering'` sampler paired with a `'float'` sampleType on that format → validation rejection.

### d. Same-encoder render → sample feedback

Reading and writing the same texture in two passes of the same `CommandEncoder` is permitted by the spec but some drivers reject specific patterns. If you see `Resource ... is used both as RENDER_ATTACHMENT and TEXTURE_BINDING in the same submit`, split the encoder: `queue.submit([enc1.finish()])` then start a fresh encoder for the next phase.

## 5. The in-app log buffer must dedupe

Per-frame validation errors fire at ~60 Hz. Any in-app log mirror that doesn't dedupe consecutive identical messages will evict the precious one-shot init messages within seconds (a 200-entry cap fills in ~3 seconds at 60 fps).

```js
const last = _debugLog[_debugLog.length - 1];
if (last && last.level === level && last.msg === msg) {
  last.count = (last.count || 1) + 1;
  last.t = Date.now();
} else {
  _debugLog.push({ t: Date.now(), level, msg, count: 1 });
  if (_debugLog.length > _DEBUG_LOG_MAX) _debugLog.shift();
}
```

Render the count as `" (×N)"` when `count > 1`.

Without this dedupe, you'll keep getting the same paste from the user every round — spam without the init line you actually need. **PR #256** added this to the project; reuse the same pattern in any new in-app log surface.

## 6. Reasoning checklist when you hit a silent black canvas

1. **Wire all six diagnostic pieces** before guessing fixes (uncaptured handler, per-frame scope, init scope, labels, `getCompilationInfo`, async pipeline). Each one catches a different class of bug.
2. **Identify the failing pipeline** via the label in the derivative error message.
3. **Wrap THAT pipeline's creation in its own scope** + force `createRenderPipelineAsync` alongside. The async catch's error message is the root cause.
4. **Read the WGSL error from top to bottom** — error line is the symptom, notes prove the cause.
5. **Apply the targeted fix** — usually `textureSample → textureSampleLevel`, or explicit pipeline layout, or sampler/texture type alignment.
6. **Dedupe in the in-app log** if there's a mobile log mirror; otherwise spam evicts the one-shot lines you need.

## 7. Reference PRs from this project

- **PR #246** (`a4a9300`) — initial WebGPU diagnostic: validation scope around `beginFrame` + 1×1 `copyTextureToBuffer` readback of `_postRtA`.
- **PR #250** (`a8013cf`) — `onuncapturederror` handler + init-time error scope + pipeline labels + `getCompilationInfo` on bg shader.
- **PR #252** (`ff0e7ff`) — lazy `_sceneFxEnsurePipeline` wrapped in its own scope.
- **PR #253** (`f0f9f4f`) — explicit `GPUPipelineLayout` for sceneFx (removed `layout: 'auto'` as a variable + forced lazy validation).
- **PR #255** (`24daae7`) — `createRenderPipelineAsync` ran in parallel with the sync call; async catch finally surfaced the real driver message.
- **PR #256** (`f2de45d`) — in-app log dedupe so the one-shot init messages survived the per-frame validation spam.
- **PR-after-#256** — actual fix: `textureSample → textureSampleLevel(…, 0.0)` for every call inside non-uniform branches in `SCENE_FX_WGSL`.

The full arc took 6 rounds because each round only caught one layer of the onion. Wiring **all the diagnostic pieces at once on day one** would have cut that to two rounds. That's the meta-lesson — set up complete diagnostic infrastructure before you start hypothesizing.

## 8. Other useful snippets

**Validate one bind group layout entry against the shader binding**:

```js
const bgl = pipeline.getBindGroupLayout(0);   // throws / errors if pipeline is invalid
// Inspect via the explicit layout you passed in createBindGroupLayout —
// auto layout doesn't surface its inferred entries directly.
```

**Force-resolve all queued errors before reading a result**:

```js
await device.queue.onSubmittedWorkDone();
```

Use this in tests / diagnostics if you want the GPU to fully drain before you read back.

**Check WGSL compilation info without creating a pipeline**:

```js
const mod = device.createShaderModule({ code, label });
const info = await mod.getCompilationInfo();
for (const m of info.messages) {
  console.log(m.type, m.lineNum, m.linePos, m.message);
}
```

Useful as a unit-test-style shader sanity check at the top of any new WGSL pass.

## 9. WebGL2 note

WebGL2's `gl.getError()` returns a numeric code (typically `1282 = GL_INVALID_OPERATION`) and errors latch until read. The WGSL "uniform control flow" rule does NOT apply to GLSL — GLSL allows derivative-requiring functions inside any branch with implementation-defined behaviour on the boundary. Other classes of error overlap (feedback loops, sampler-must-point-to-valid-texture) — see `.claude/skills/webgl-debugger/SKILL.md`.
