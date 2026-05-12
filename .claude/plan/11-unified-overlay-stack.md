# 11 — Unified overlay stack (checkbox-in-row, chained FBO pipeline)

## Context

Today's "overlays" surface is split in two:

- **Sortable list** (`S.fxOrder`) — owns the draw order of three
  fixed-function FX passes: `noise`, `vignette`, `crosshair`.
  Drag-and-drop reorderable; on/off toggles + per-effect sliders
  live elsewhere on the Settings panel.
- **Standalone checkboxes** — every other overlay
  (`cellTypeOverlay`, `causticsOverlay`, `liquidRipples`,
  `microscopeBlur`, `makeItReal` duotone grade) has its own
  toggle plus sliders, with order baked into each renderer's
  draw routine.

The user wants:

1. **One unified reorderable list.** Every overlay is a row in
   the same list; its on/off **checkbox is inside the row** next
   to the drag handle, so order and enable state are managed in
   one place.
2. **Each layer samples the previous layer's output.** The
   pipeline is a deterministic ping-pong chain: layer N reads
   the framebuffer that layer N-1 wrote into, then writes its
   own. Order is therefore user-visible end-to-end.
3. **Lowest layer reads the bg + scene render as its base.**
   The composited cells/particles/antibodies/HUD frame is the
   input to the bottom-of-stack overlay.

Anchor decision for ripples: the existing `S.rippleScope`
(`'scene'` vs `'bg'`) is **subsumed by stack position**. In the
chained model, "ripples only on the bg" is achieved by placing
ripples below the cells render; "ripples on everything" is
achieved by placing them above. The two-value enum goes away.

Anchor decision for cells: cells are not draggable. They appear
in the list as a **fixed pin** ("— scene —") that always exists
exactly once; overlays *below* the pin run before the cell pass
(bg post-FX), overlays *above* the pin run after. This preserves
the current `rippleScope: 'bg'` capability without inventing a
new control.

## Audit

### State (`assets/core/state.js`)

Existing overlay-relevant fields:

| Field                       | Default | Role |
|-----------------------------|---------|------|
| `cellTypeOverlay`           | false   | HTML overlay (per-cell label rings) — **renderer-agnostic, not in the shader stack**. |
| `causticsOverlay`           | false   | WebGL2/WebGPU FBO pass: water-caustic tint on top of bg. |
| `causticTintR/G/B`          | 0/1.35/0.5 | Caustics tint knobs. |
| `liquidRipples`             | false   | WebGL2/WebGPU FBO pass: per-cell ripple distortion. |
| `rippleScope`               | 'scene' | `'scene'` \| `'bg'` — **goes away** in the new model. |
| `rippleDensity/Reach/Strength` | 1.5/0.7/1.0 | Wave knobs — **all stay**. |
| `staticNoise` + `Intensity` + `Blend` | false / 0.4 / 'additive' | FX overlay, in `fxOrder`. |
| `vignette` + `Intensity` + `Blend` | false / 0.6 / 'additive' | FX overlay, in `fxOrder`. |
| `crosshair`                 | false   | FX overlay, in `fxOrder`. |
| `microscopeBlur` + `Focus` + `Strength` + `Falloff` | false / 0.35 / 0.5 / 0.5 | FBO pass: variable-radius blur. |
| `makeItReal` (duotone) + knobs | false / … | FBO pass: luminance-mapped duotone grade. |
| `fxOrder`                   | `['noise','vignette','crosshair']` | Sortable list. **Replaced** by `overlayOrder`. |

### Renderer plumbing

- `assets/render/webgl2.js`
  - `beginFrame` L2491–2529: branches on
    `liquidRipples × rippleScope` and `causticsOverlay` and
    `(microscopeBlur || makeItReal)` to choose one of three
    scene RTs. Today the three effects are mutually exclusive
    in scene-wide mode (`useCaustics = … && !ripplesSceneWide`,
    `useSceneFx = … && !ripplesSceneWide && !useCaustics`).
  - `drawBackground` L2755–2880: per-frame bg pass + bg-only
    ripple RT plumbing.
  - Caustics overlay L2667; microscope+duotone L2724; ripples
    L2783; FX overlay (noise/vignette/crosshair) L2812–2900,
    iterating `S.fxOrder`.
- `assets/render/webgpu.js` mirrors the same shape (different
  call sites; UBO layout differs).
- `assets/render/canvas2d.js` — FBO passes are no-ops; only the
  FX overlay layer applies (canvas2d composite blends).

### UI (`assets/app.js` + `index.html`)

- `renderFxOrderList()` L967–1038: builds the drag-drop list
  rows for the three FX effects. Drag handle + label + ▲/▼
  buttons. **No checkbox in the row today.** Drag-drop idiom
  matches the bg-layer list (PR #151).
- Standalone overlay toggles are scattered across the Settings
  panel above the sortable list. Each owns its own
  `<input type=checkbox>` + slider section.

### i18n keys (5 locales)

Today: `fx_kind_noise`, `fx_kind_vignette`, `fx_kind_crosshair`,
`fx_drag_reorder`, `fx_move_up`, `fx_move_down`. New keys
needed: `overlay_kind_caustics`, `overlay_kind_ripples`,
`overlay_kind_microscope`, `overlay_kind_duotone`,
`overlay_kind_celltype`, `overlay_pin_scene`. en + de minimum;
es/bar/la fall through.

## Approach

Split across four sub-PRs so each can land + revert cleanly.

### PR A — Introduce `S.overlayOrder` schema + cells pin (no UI change)

- Add `S.overlayOrder` default:

  ```js
  overlayOrder: [
    'duotone',     // top-most
    'noise',
    'vignette',
    'crosshair',
    'microscope',
    'caustics',
    'celltype',
    'scene',       // ← fixed pin, never moved/removed
    'ripples',     // below the pin → bg-only by default
  ]
  ```

  Order above mirrors today's effective stacking; ripples land
  below the pin to preserve `rippleScope: 'scene'` ≠
  `rippleScope: 'bg'` defaults across the upgrade.
- `loadSettings` migration: collapse `S.fxOrder` + the
  standalone toggle bools + `S.rippleScope` into
  `S.overlayOrder`. Drop `S.fxOrder` and `S.rippleScope` from
  the persisted schema (DEFAULTS removal triggers the existing
  unknown-key drop).
- Validate: `S.overlayOrder` must contain `'scene'` exactly
  once. Unknown kinds get filtered. Missing kinds get appended
  at the bottom of the appropriate zone.
- No renderer or UI changes yet. Existing toggles stay as the
  per-overlay enable flag; only their relative order is now
  driven by `S.overlayOrder` (renderers iterate the array
  instead of hard-coding the sequence).
- Tests: migration round-trip + ordering invariants.

### PR B — Unified sortable list UI (checkbox inside each row)

- Rename `fx-order-row` → `overlay-order-row` in CSS + markup.
- `renderOverlayOrderList()` replaces `renderFxOrderList()`. Each
  row owns: drag handle · checkbox (bound to the existing
  per-overlay bool, e.g. `S.staticNoise`) · label · ▲/▼ buttons.
  The `'scene'` pin row has no checkbox and no drag handle —
  rendered as a separator labeled `T('overlay_pin_scene')`
  ("— scene —").
- Hide the now-redundant standalone checkboxes; the per-effect
  sliders/knobs stay in their existing sub-sections (the row is
  for enable + order only).
- i18n: add the new `overlay_kind_*` + `overlay_pin_scene` keys
  in en + de.
- No renderer changes — renderers still iterate `S.overlayOrder`
  the same way PR A established.

### PR C — Drop `rippleScope`, scope follows position

- Already migrated in PR A; this PR removes the dead `rippleScope`
  reads from the three renderers' `beginFrame` / `drawBackground`
  branches. The pipeline reads `S.overlayOrder` to decide whether
  ripples run before or after the cell pass.
- Update CLAUDE.md's "Settings shape" note: `rippleScope` is gone
  (migration shim retained in `loadSettings`).

### PR D — True chained ping-pong pipeline

- Today noise/vignette/crosshair use cheap GPU blends; the other
  four effects use FBOs. Convert all enabled overlays to a single
  ping-pong chain:
  1. Allocate two scene-sized RGBA8 RTs (A, B). Front/back swap
     after each pass.
  2. Bg + cells + particles + HUD render into RT A.
  3. For each enabled entry above the `'scene'` pin (in order):
     bind front-RT as `u_sceneTex`, write to back-RT, swap.
  4. Final swap blits to the default framebuffer.
  - For entries *below* the pin, run the same chain on the
    bg-only RT before cells render.
- Cost: one extra texture sample per enabled overlay per frame.
  Cheap on desktop; flag in `RENDERERS.md` perf table for low-end
  mobile.
- Canvas2D: stays mostly no-op for FBO passes; the cheap blends
  (noise/vignette/crosshair) keep their canvas2d compositor path
  to avoid the cost of an FBO emulation on a 2D context.

## Critical files

- `assets/core/state.js`
  - DEFAULTS: add `overlayOrder`, drop `fxOrder` + `rippleScope`.
  - `loadSettings`: migration shim.
  - i18n tables (en + de minimum).
- `assets/app.js`
  - Replace `renderFxOrderList` with `renderOverlayOrderList`.
  - Bind row checkboxes to existing per-overlay bools.
- `assets/render/webgl2.js`
  - `beginFrame`: iterate `S.overlayOrder` to choose RT plumbing.
  - Drop `rippleScope` branches (PR C).
  - Convert to ping-pong chain (PR D).
- `assets/render/webgpu.js` — mirror webgl2 changes.
- `assets/render/canvas2d.js` — iterate the list for canvas-side
  blends; FBO-only effects remain no-ops with a one-time warning.
- `assets/styles.css` — rename `fx-order-*` selectors.
- `index.html` — `<div id="fxOrderList">` → `overlayOrderList`.
- `RENDERERS.md` — perf note for PR D.
- `CLAUDE.md` — note that `rippleScope` is migrated away.

## Verification

- `node --test` — migration round-trip cases:
  - old settings blob with `fxOrder` only → produces a valid
    `overlayOrder` with the cells pin in the historical position
    and ripples below it.
  - blob with `rippleScope: 'bg'` → ripples land below the pin.
  - blob with `rippleScope: 'scene'` → ripples land above the pin.
  - unknown kind in saved `overlayOrder` → dropped.
  - duplicate `'scene'` → collapsed to one.
- Renderer import smoke (canvas2d / webgl2 / webgpu) after each PR.
- Manual flow per PR:
  - PR A: load page with old localStorage → no visual change.
  - PR B: every overlay row has working checkbox + ▲/▼; drag
    reorder updates rendering instantly.
  - PR C: with `S.overlayOrder` placing ripples below the pin,
    cells render crisp on top; placing ripples above the pin
    distorts everything (pixel parity with the old `'scene'`
    scope).
  - PR D: pixel parity end-to-end vs PR C on at least one preset
    with every overlay enabled; no shader-link failures on iOS
    Safari + Android Chrome.

## Branch

- PR A: `claude/overlay-stack-schema` (merged #161)
- PR B: `claude/overlay-stack-ui` (merged #162)
- PR C: `claude/overlay-stack-drop-ripple-scope` (merged #163)
- PR D: `claude/overlay-stack-chained-pipeline` — **WebGL2 only**. Caustics + microscope/duotone + scene-wide ripples can now coexist via a ping-pong chain over the post-pin section of S.overlayOrder.
- PR D2 (follow-up): mirror the chain into WebGPU. Canvas2D stays single-pass (cheap blends only).

Each branches off `main` after the previous merges.
