# Ideas — things to revisit later

A scratchpad for "good idea, but not now" items uncovered while
working on the renderer / docs / game-mode work. Each entry has a
short rationale + a clear trigger for when to pick it up.

---

## Shaders: write WGSL once, cross-compile to GLSL

**The pain it would solve.** Every renderer-touching PR currently
edits `assets/render/webgl2.js` (GLSL ES 3.00) **and**
`assets/render/webgpu.js` (WGSL) — same logic, two languages. The
double-edit cost is bounded (~5–10 minutes per PR; perhaps 2–4 hours
across the year), but it's a permanent overhead.

**The candidates.**

- **`naga-oil`** ([github.com/bevyengine/naga_oil](https://github.com/bevyengine/naga_oil))
  / **`naga`** itself (Rust) — Bevy / wgpu's shader translator.
  WGSL → SPIR-V → GLSL ES 3.00 round-trip is well-trodden. Has WASM
  builds, but the JS bindings are still rough.
- **`tint`** (Google's WGSL/SPIR-V/GLSL compiler from Chrome's WebGPU
  pipeline). C++; would need a wasm build.
- **`@webgpu/glslang`** style wrappers — older WGSL toolchains.

**Why not yet.**

- We have **no build step** today. Vanilla ES modules, no bundler.
  Adopting a cross-compiler means introducing one of:
  - a build-time compile step (run `naga-cli` over `*.wgsl` →
    `*.glsl.js`, vendor the output)
  - or a runtime translator loaded as wasm in the browser
- Either path is "right tool for the wrong moment" — the cost of
  setting it up dwarfs the cost of hand-keeping the two shader files
  in sync.

**When to revisit.**

- We add a build step for **any other reason** (TypeScript, bundling,
  i18n compilation, asset pipeline). Then bolting on `naga-cli`
  becomes near-zero marginal cost.
- The shader codebase grows past ~3000 lines per backend (currently
  ~600 lines of fragment shaders per backend). At that volume
  the dual-edit cost starts hurting.
- We add **compute shaders** for GPU-side gameplay (particle
  flocking, fluid dynamics for the bloodstream). WebGL2 has no
  compute, so we'd need to either drop the WebGL2 backend or write
  the compute logic twice (CPU fallback for WebGL2). At that point
  having a single source of truth for shaders matters more.

**See also.** Detailed comparison of library options is in
[`RENDERERS.md`](./RENDERERS.md) → "Would a library help?".

---

## Cells visibly age: organelle counts shift across the lifecycle

**The idea.** Today the disk shader (and the
[`docs/shader-test.html`](./docs/shader-test.html) sandbox) packs
a single `organelles` knob that is constant for a cell type — a
neutrophil shows 30 fine granules whether it just spawned or is
seconds from apoptosis. Real immune cells visibly change as they
age and act: granules deplete after firing, vesicles balloon up
during phagocytosis, the nucleus condenses before death. Tying
the existing per-cell phase/age fields to those visual knobs would
let the shader read the cell's biological state at a glance —
without any new gameplay mechanics, just a richer "in-game
microscope" feel.

**What would change in appearance, per type.**

The per-cell state we already have on every `Cell` (in
`assets/core/sim.js`): `hp/maxHp`, `flash`, `mouthFlashTimer`,
`alarmTimer`, `splitProgress`, `phase`, plus a hypothetical
`age = (Date.now() - bornAt) / 1000`. The table below lists how
each type's visual could read those numbers.

| Type        | Spawn / young (low age, full HP)         | Active (firing / pursuing)                                     | Spent / dying (low HP, high age)               |
|-------------|-------------------------------------------|-----------------------------------------------------------------|------------------------------------------------|
| neutrophil  | 30 fine granules, tight 3-lobe nucleus    | granules drop to ~12 after each "burst"; lobes start to fuse    | granules near zero; nucleus condensed (pyknosis), darker rim |
| macrophage  | 22 lysosomes, kidney nucleus, smooth pseudopods | 35–40 vesicles bloom mid-phagocytosis (engulfed cargo)          | shrinks back to ~12 vesicles; cytoplasm grainier |
| mast        | 60 dark green granules                    | granules retract toward the centre on fire; 35 visible        | granules nearly empty; pale washed-out cyto    |
| basophil    | 25 dark blue/violet granules              | 8–10 visible mid-degranulation                                 | granules empty; bilobed nucleus condensed     |
| eosinophil  | 18 large bright orange granules           | granules dimmer + 12 visible after firing                      | empty granules; nucleus condensed             |
| nk-cell     | 6 large cytotoxic granules                | granules bright + visibly tracking toward the target side     | granules empty; pale cytoplasm                |
| t-cell      | small smooth lymphocyte                  | nucleus chromatin lightens (active transcription noise FBM gain ↑) | nucleus dark + condensed; cell shrinks        |
| b-cell      | rough-ER stripes, modest cytoplasm       | rough-ER stripes intensify (peak amplitude doubles); cytoplasm enlarges | stripes fade; cytoplasm full of pale ghost-vesicles (plasma cell → spent) |
| dendritic   | 6 short tendrils                          | tendrils elongate during antigen presentation                 | tendrils retract; cell rounds off             |
| monocyte    | rippled membrane, normal vesicles         | ripples flatten as it differentiates toward macrophage shape  | not applicable — usually transitions out before death |
| platelet    | 10-point star, 4 alpha-granules          | granules dim + extra spike radius after activation            | dim, fragments visibly                        |
| rbc         | smooth biconcave disc                    | (no active state)                                             | colour shifts toward darker red as it ages; shape rounds slightly |
| virus       | sharp hex capsid, indigo core            | spikes lengthen + capsid lattice brightens at the moment of cell entry | capsid breaks: rim spikes flicker / disappear |
| bacterium   | tight rod + flagellum                     | flagellum wags faster when fleeing; ribosome density ↑ pre-split | rod swells then ruptures (lysis = membrane edge softens) |
| germ        | small 3-lobe blob                         | lobes cluster mid-split                                       | lyses like bacterium                          |
| amoeba      | irregular pseudopod blob                  | pseudopods elongate sharply toward food vacuole (vesicle visibly inflates) | pseudopods shrink; cell rounds off            |
| slime       | irregular lobed                           | hyphal threads at rim brighten during sporulation             | threads fade; blob rounds off                 |
| mite        | round + 4 leg bumps                       | leg bumps animate (flex) during attack                        | legs retract; outline darkens                 |
| spore       | hard small disc with double-wall          | (dormant — unchanged while waiting)                           | wall cracks: inner ring breaks                |
| toxin       | sharp 10-point spike + violet glow        | glow pulses brighter just before applying damage              | glow fades to grey                            |

**What it would cost.** Mostly shader plumbing — pack
`age / hp_frac / fireTimer` into the disk-instance bytes
(currently 4 floats of free space per cell), then read them in the
fragment shader and lerp the existing constants (granule count,
nucleus radius, capsid contrast). No new uniforms; no new render
passes.

**Why not yet.**

- We don't yet have an `age` or `bornAt` per cell — would need to
  add it to `makeCell` (one-line change, but loadbearing if anyone
  starts depending on it).
- The shader-test sandbox shows static states; would need a tiny
  "lifecycle slider" UI to demo. Fine, but extra work.
- The visual tells today are all event-driven (white flash on
  damage, mouth-flash on fire) — adding ambient "aging" tells
  competes with those for the player's attention. Need to confirm
  it adds clarity, not noise, before committing.

**When to revisit.**

- After we have a settled "campaign mode" pacing where cells live
  long enough on-screen for aging to be visible (free-game cells
  often die in <5 s — aging tells aren't readable in that span).
- If we add a player-facing "biology mode" toggle (slower
  simulation, pedagogical UI) — that's the natural showcase for
  these visuals.
- Once the shader-test sandbox adds a "time-lapse" mode (a slider
  driving a virtual cell-age uniform). The table above becomes
  the spec for how each kind's `age` slider should change its
  appearance.
