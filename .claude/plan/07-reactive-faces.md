# 07 — Reactive facial expressions + smoother eye movement

## Context

Cartoon faces today are fully static — `FACE[c.type].mouth` is
the same string every frame, and the eye look-at recomputes from
`alarmTarget − pos` each frame and snaps instantly when the
per-pair targeting picker re-acquires a closer enemy. The user
asked for two related improvements: change facial expressions
when an entity fires, takes damage, or pursues a target, and
soften the eye motion so target switches don't jitter.

## Audit

- `state.js:1135–1149` — `FACE` table: per-cell-type mouth +
  eye config, all static.
- `sim.js:_emitAntibody` — single chokepoint when a B-cell fires.
- `sim.js:_applyDamage` — single chokepoint for any HP loss.
  Already sets `cell.flash = 0.4`; mouth-flash mirrors that.
- `sim.js:update` cell loop — flash decay + alarm-timer decrement
  live here; mouth-flash decay + lookX/lookY lerp slot in
  alongside.
- Renderer face passes (`canvas2d.js:_drawCartoonFaces`,
  `webgl2.js:FRAG_FACE` instance pack, `webgpu.js` face pack)
  all read `FACE[c.type].mouth` inline + recompute look-at from
  alarmTarget; all three swap to a shared `effectiveMouthKind`
  helper + `c.lookX/lookY`.

## Approach

Per-cell timer + override (mirrors the `flash` pattern):

| Field | Purpose |
|---|---|
| `mouthFlashKind` | Override mouth string during the flash window |
| `mouthFlashTimer` | Seconds remaining; decremented each `sim.update` |
| `lookX`, `lookY`  | Smoothed unit-vector pupil offset (exp lerp) |

Triggers:
- `_emitAntibody` → owner's mouth flashes `'fangs'` for 0.30 s.
- `_applyDamage`  → target's mouth flashes `'frown'` for 0.40 s.
- Pursuit (state, not event): while `alarmTimer > 0` with a live
  target, `effectiveMouthKind` returns `'snarl'`. The mouth flash
  overrides this so the firing/damage event still reads.

Eye lerp: per cell per frame in `sim.update`, exp-lerp toward
the desired direction with a 0.15 s time constant. Desired is
the alarmTarget direction if locked-on, else the velocity vector.
Renderers read `c.lookX, c.lookY` directly (still divided by
`hypot` to renormalise after the lerp drift).

## Critical files

- `assets/core/sim.js` — added 4 fields to `makeCell`, mouth-flash
  decay + look lerp at the top of the cell loop, mouth-flash
  triggers in `_applyDamage` + `_emitAntibody`.
- `assets/core/sim-faces.js` (new) — exports `effectiveMouthKind(c)`.
- `assets/render/canvas2d.js`, `assets/render/webgl2.js`,
  `assets/render/webgpu.js` — import the helper, swap inline
  `cfg.mouth` for `effectiveMouthKind(c)`, drop inline look-at
  recompute in favour of `c.lookX/lookY`.

## Verification

- `node --test`
- `for r in canvas2d webgl2 webgpu; do node -e
  "import('./assets/render/${r}.js').then(()=>console.log(r))"; done`
- `node -e "import('./assets/core/sim-faces.js').then(m =>
  console.log(m.effectiveMouthKind({ type: 'bcell',
  mouthFlashKind: 'fangs', mouthFlashTimer: 0.2, alarmTimer: 0
  })))"` — expects `fangs`.
- Manual all three renderers, cartoon mode on, see PR test plan.

## Branch

`claude/reactive-faces` (off main).
