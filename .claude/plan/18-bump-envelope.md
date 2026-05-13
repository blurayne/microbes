# Plan 18 — Bump-feedback envelope (smoother + slower)

## Context

PRs #232 (squash + flash) and #233 (drop flash) gave cells a
visual response on collision: a squash along the impact normal,
decayed exponentially over ~150 ms. The user tested it and asked
for the bump to "begin slower" and "last longer" — overall
smoother and slower. The original exponential decay popped to
full intensity on the impact frame and faded quickly, which
read as a snap rather than a deformation.

## Audit

* Cell init (sim.js:133) — `bumpX, bumpY` were the live renderer
  attribute, set directly in the collision branch.
* Collision branch (sim.js:826) — wrote `a.bumpX = -nx * k` etc
  on the impact frame.
* Decay (sim.js:556) — `c.bumpX *= Math.exp(-dt * 5)` each
  frame, zeroed below epsilon. No attack ramp, no duration knob.
* Renderer: webgl2 + webgpu cell shaders read v_bump, squash
  bodyR along it. Unchanged here.

## Approach

### Per-cell envelope state

Split the live renderer value from the stored peak so the
attack-then-decay envelope can be evaluated each frame against a
stable peak axis:

* `bumpPeakX, bumpPeakY` — impact axis × intensity stored on
  collision.
* `bumpT` — seconds since the impact that set the current peak.
* `bumpX, bumpY` — still the live renderer values; computed each
  frame as `bumpPeak × env(bumpT)`.

### Envelope shape

```
attack   = clamp(S.bumpAttack, 0.001, 1.0)
total    = max(attack + 0.05, S.bumpDuration)
decay    = total - attack

if bumpT < attack:
  u   = bumpT / attack
  env = smoothstep(u)        # eases in, no pop
else:
  u   = (bumpT - attack) / decay
  env = max(0, 1 - u)        # linear fade
```

Smoothstep on the attack means the squash grows from 0 to peak
along an S-curve — no visible impulse at impact. Linear fade
during the decay gives a predictable, controllable tail length.

### Collision write

Replace the direct `bumpX/Y` write with a peak write + timer
reset, gated by a "stronger than current peak?" check so a weak
nudge during the decay tail doesn't restart the envelope:

```js
const aPeak = Math.hypot(a.bumpPeakX, a.bumpPeakY);
if (k > aPeak) {
  a.bumpPeakX = -nx * k; a.bumpPeakY = -ny * k;
  a.bumpT = 0;
}
```

### Sliders

* `S.bumpAttack` — default 0.20 s, range 0.01..1.0 s.
  Display: `ms`.
* `S.bumpDuration` — default 1.5 s, range 0.1..5.0 s.
  Display: `s`.

Both clamped in `loadSettings`. i18n keys `bump_attack` +
`bump_duration` added in en + de (other locales fall through).

Renderer: no changes (still reads `c.bumpX, c.bumpY`).

## Critical files

* `assets/core/sim.js` — new fields, envelope evaluation,
  collision-write peak-gate.
* `assets/core/state.js` — DEFAULTS + clamps + i18n.
* `index.html` — two new sliders under Settings → Look next to
  the existing Bump intensity slider.
* `assets/app.js` — `bindRange` for both new sliders.

## Verification

* `node --test` — 35/35 green.
* `canvas2d`, `webgl2`, `webgpu` import OK.
* Manual:
  - Head-on collision with defaults reads as a slow swell + fade
    over ~1.5 s, no snap at impact.
  - Drag Bump attack 1 ms → 1 s; squash rise time visibly
    stretches.
  - Drag Bump duration 0.1 s → 5 s; tail length tracks.
  - Two cells colliding twice in rapid succession: second
    impact only resets the envelope if it's harder than the
    first.

## Branch

`claude/bump-envelope`.
