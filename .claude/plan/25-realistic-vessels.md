# 25 · Realistic vessels & branching

## Context

The `branching` vessel layout currently is a vertical main trunk with 40
straight, constant-radius side branches (each maybe one straight sub-branch).
It reads as "pipes", not anatomy. User ask (DE): *"die Adern und die
Verzweigungen so realistisch wie möglich"* — make the vessels and their
branching as realistic as possible.

What real vasculature has that we're missing:

1. **Continuous taper** — arteries narrow along their length; branches are
   thinner than their parent and keep thinning toward capillaries.
2. **Murray's law bifurcations** — at a split, `r_parent³ = r_childA³ +
   r_childB³`; the thinner child peels off at the wider angle.
3. **Tortuosity / curvature** — vessels meander, they're never straight
   lines.
4. **Recursive generations** — trunk → branches → sub-branches →
   capillaries, several levels deep, radius shrinking each generation.

## Audit

- `assets/core/vessels.js` — `buildBranchingNetwork` is the only layout that
  changes. Capsule shape today: `{x1,y1,x2,y2,r,flow,physics}`. The SDF
  (`capsuleSDF`) reads `cap.r` only; `nearestVesselWall`/`isInsideVessels`
  skip `physics:false` capsules.
- **Perf model**: `nearestVesselWall` runs **per cell per tick** over
  `physics:true` capsules (`sim.js:858`). So physics-capsule count is the
  budget that matters; visual-only (`physics:false`) capsules cost only
  render triangles/strokes. → Put curve+taper+capillary detail in
  `physics:false` capsules; keep `physics:true` to the trunk + major
  branches (~80–120).
- Renderers each `for (const cap of caps)`-draw. GPU `_pushThickSegment`
  draws a constant-width quad; canvas2d strokes with `lineCap:'round'`.
- `buildRbcParticles` seeds 3–24 per capsule by length — with fine
  subdivision this explodes. Must gate RBC seeding to flow-eligible
  (thick) capsules and update the one unit test that assumed
  `rbcs ≥ capsules×3`.

## Approach

**Geometry — no SDF change.** Represent each anatomical vessel as a
**curved, tapering centerline sampled into many short round-capped
capsules**. Because segments are short and radii step <~12 % per segment,
the union looks (and confines) like a smooth tapered curved tube. The
existing capsule SDF stays byte-for-byte (tests on `horiz` keep passing).

Add an optional `r2` to capsules = radius at `(x2,y2)` (start radius stays
`r`). Physics still uses `r` (start, slightly thicker end → safely
over-confines). GPU renders a **trapezoid** (`_pushTaperedSegment`,
hw1=r, hw2=r2) for a crisp taper; canvas2d strokes each short segment with
the mid radius + round caps (fine subdivision hides the steps).

**`buildBranchingNetwork` rewrite:**
- `emitVessel(x,y,heading,rStart,rEnd,length,opts)` — walks a meandering
  centerline (random-walk heading + mild restoring bias), tapers
  `rStart→rEnd`, subdivides so each segment turns a little and steps
  radius <12 %, pushes capsules with `r`/`r2`, returns the tip
  `{x,y,heading,r}`.
- `grow(x,y,heading,r,gen,lenScale)` — emits one vessel then **bifurcates
  per Murray's law**: pick a flow-split fraction `f∈[0.4,0.6]`,
  `rA=r·∛f`, `rB=r·∛(1−f)`; the thinner child takes the wider deviation;
  recurse until `gen>MAX_GEN` or `r<capillaryR`. `physics = r≥physicsMinR`.
- **Main trunk** preserved: a single dominant vertical vessel (low wander,
  strong vertical restoring), `H·20·sizeScale` long, through screen-X
  centre. Side branches peel off alternating sides at intervals (like
  intercostal arteries off the aorta), each seeded into `grow()` so it
  becomes a realistic recursive sub-tree.
- Hard cap on total capsules (~700) to bound render cost.

**RBCs:** seed only flow-eligible capsules (`r ≥ rbcFlowMinR`), so particles
ride the visible vessels, not hair-thin capillaries.

**Color:** deeper, less-plastic reds + softer specular for a wet anatomical
sheen (applies to all three renderers → parity).

## Critical files

- `assets/core/vessels.js` — rewrite `buildBranchingNetwork`; add `r2`;
  `bboxOf` reads `max(r,r2)`; gate RBC seeding.
- `assets/render/canvas2d.js` — taper-aware stroke + tuned gradient.
- `assets/render/webgl2.js` / `assets/render/webgpu.js` —
  `_pushTaperedSegment`; tuned 12-band palette.
- `test/vessels.test.js` — update the RBC-count test for flow-gated seeding.

## Verification

- `node --test` — all green (capsuleSDF/nearestVesselWall/isInside
  unchanged; updated RBC test; spawn-inside invariant holds).
- Renderer module-import smoke (canvas2d/webgl2/webgpu).
- Headless Chromium screenshots of canvas2d + webgl2 at default + a small
  `vesselsScale` — confirm curved, tapering, recursively branching tubes
  with visible 3D shading.

## Branch

`claude/realistic-vessels`
