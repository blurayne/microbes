# 10 — Background layer stack (drag-drop compositable bgs)

## Context

Today each scene runs a single bg shader. The renderer picks one
`kind` out of an 11-value enum and draws one fullscreen quad;
`staticNoise` + `vignette` post-FX layer on top in fixed order.
Presets in `assets/core/state.js` map a preset key (`S.background`)
to one `{ kind, ...params }` object via `currentBackground()`.

The user wants to compose multiple backgrounds — e.g. a gradient
underlay with a reactor pattern multiplied on top, or two flow
fields blended additively — and reorder them by drag-drop. More
bg kinds will be added in future, so the layer model has to be
extensible without touching the renderer plumbing each time.

Decision on `staticNoise` + `vignette`: they stay as fixed
top-of-stack post-FX, in the order the player already settled on
(vignette over noise over everything else). Merging the FX overlay
shader path with the bg shader path is a bigger refactor for no
new feature value — declined.

## Audit

State (`assets/core/state.js`):
- `S.background` (string preset key) at L90 default `'solid'`.
- THEMES table L1266–1357: per-theme `bg: {...}` blob.
- BACKGROUNDS table L1451–1463: derived + `'solid'` fallback.
- `currentBackground()` resolves the preset key to one bg object.

Renderers — all three have a `drawBackground(timeMs)` that:
1. reads `currentBackground()` → one bg object,
2. encodes `bg.kind` into a 0..11 integer,
3. uploads `base`/`topColor`/`botColor`/`spotColor[s]`/`spotCount`/
   `vignette`/`gridStep` plus camera + time,
4. draws one quad.

- `assets/render/canvas2d.js` `drawBackground` L100–247.
  Kind switch is if-chains (L106/134/148/202). Decor pass at
  L200 (`_drawAnatomyDecor`). Per-bg vignette at L237 is a 2D
  radial gradient drawn inline.
- `assets/render/webgl2.js` `drawBackground` L2755–2880.
  Kind switch L2761–2772, uniforms via `_bgU.*`. The shader
  itself branches internally on `kind`.
- `assets/render/webgpu.js` `drawBackground` L3174–3340.
  Same shape; UBO layout L3210–3258. Built-in vignette read
  from `u.misc.y` (L1216) inside the shader.

UI:
- `index.html` `<select id="bgSelect">` L50–51.
- `assets/app.js` `setBackground` L1161–1193 wires the dropdown
  to `S.background`. i18n key `bg_*` per locale, fallback to
  the theme's `label` field.

i18n keys live in 5 locales (en/de/es/bar/la) in
`assets/core/state.js` (en at L282–384, de L437+, es L577+,
bar L704+, la L1088+).

## Approach

### Target state shape

```js
S.bgLayers = [
  { id, kind, opacity, blend, enabled, /* kind-specific params */ },
  ...
]
```

- `blend ∈ { 'normal', 'multiply', 'additive' }` — same enum as
  the existing FX overlays so all renderers already accept it.
- `opacity ∈ [0,1]`.
- `enabled: bool` — keep disabled layers in the list so the user
  doesn't lose their config when experimenting.
- `id`: short stable string for React-style reorders + DOM keys.
- Kind-specific params (`base`, `topColor`, `spotCount`, …) keep
  the same names they have today — no schema rename.

`S.background` (preset key) stays as a *load action*: picking a
preset replaces `S.bgLayers` with that preset's stack. It is no
longer a live binding the renderer reads.

Per-layer `vignette` field: kept for now — the bg shader bakes
it in and ripping it out is unrelated work. Layer-level vignette
applies to that layer's draw only, which is roughly what the
existing presets already expect.

### Phasing (4 PRs)

- **PR A — foundation** *(this branch)*. Wire `S.bgLayers` end
  to end with N=1 behavior identical to today.
  - State: add `bgLayers: []` default, `bgLayersFromPreset(key)`
    helper, migration shim in `loadSettings` (if `bgLayers`
    missing or empty, derive from `S.background`).
  - Renderers: each `drawBackground` iterates the array, calls
    the existing kind code per layer with per-layer
    opacity/blend. Disabled layers skipped. N=0 → clear-to-base.
  - No UI change. `bgSelect` keeps working — selecting a preset
    just rewrites `S.bgLayers`.
  - Tests: `node --test`, renderer import smoke, manual sanity
    in browser (every preset still looks identical).

- **PR B — drag-drop layer list UI**. Replace bg dropdown with a
  layer list panel. Add layer (kind picker), delete, enable
  toggle, opacity slider, blend dropdown, drag handle. HTML5
  drag-and-drop API; no library. i18n strings in all 5 locales.
  Preset dropdown becomes a "load preset" button that replaces
  the stack.

- **PR C — per-kind config controls inside each layer card**.
  Color pickers / spotCount / etc. surfaced inline. Today only
  the global flow-speed slider is exposed; this PR makes the
  full bg config tweakable per layer.

- **PR D — multi-layer presets**. Extend presets table to allow
  arrays. Author a few composite scenes (e.g. neuron landscape +
  bloodflow multiply; reactor + agar additive). Update i18n.

## Critical files

PR A specifically:
- `assets/core/state.js` — defaults, migration shim, helper.
- `assets/render/canvas2d.js` `drawBackground` — loop wrapper +
  per-layer blend/opacity via `globalCompositeOperation` + alpha.
- `assets/render/webgl2.js` `drawBackground` — loop wrapper +
  per-layer blend (gl blendFunc) and opacity uniform.
- `assets/render/webgpu.js` `drawBackground` — loop wrapper +
  per-layer pipeline picked by blend mode (reuse the existing
  `_fxPipeline` blend-mode pipelines if practical).

## Verification

- `node --test` clean.
- Renderer import smoke:
  `for r in canvas2d webgl2 webgpu; do node -e "import('./assets/render/${r}.js').then(()=>console.log(r))"; done`
- Manual: load each existing preset, confirm visuals are
  unchanged (N=1 path must be bit-for-bit identical or close).
- Manual: stuff a second layer into `S.bgLayers` via devtools,
  confirm it composites with the chosen blend mode in all three
  renderers.

## Branch

PR A: `claude/bg-layers-foundation`.
