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

---

## Heartbeat HUD + shader-driven pulse

**The idea.** Show a heart icon next to the lower-left FAB stack
that beats at a real heart's rhythm — 60 bpm at rest, ramping up
to 150 bpm during fights (more on-field pathogens, more recent
damage events). The same beat drives a fragment-shader pulse that
"shines through" the scene with each beat: a faint radial
brightness bloom or warm-tint flash riding the systole peak.
Toggle in settings, with off as the third state.

**Settings shape (rough).**

- `S.heartbeat: 'off' | 'icon' | 'icon+shader'` — three-way
  toggle. Default `icon` so the HUD beat exists without the
  shader cost.
- `S.heartbeatBpmMin: 60`, `heartbeatBpmMax: 150` — locked for
  now; could expose later.
- HUD: an `<svg>` heart positioned next to the FAB stack
  (bottom-left). Beat scaling animation runs off the same
  `phase01` value used by the shader, so HUD and visual stay in
  sync.

**BPM driver.**

- Per-frame inputs: count of on-field pathogens, recent damage
  events (last ~3 s, decaying), recent kills (boost). Map to a
  target BPM via a smooth curve, low-pass filter the result so
  it doesn't twitch. Resting drift is fine — random ±2 BPM around
  60 reads as "alive" on the HUD.

**Shader hook.**

- One new uniform: `u_heartbeat: vec2<f32>` carrying `(phase01,
  amplitude)`. `phase01` is the seconds-since-last-systole
  divided by current beat period; `amplitude` is 0 when the
  toggle is off, 1 when on.
- In the bg compose, modulate the existing tint by `1 + 0.05 *
  smoothstep(0, 0.18, phase01) * (1 - phase01) * amplitude` —
  a sharp ramp-up over ~180 ms then a slow decay over the rest
  of the period, so each beat reads as a faint warm pulse
  riding the scene.
- Same uniform passed to disk shader if we want the cells to
  brighten with each beat too. Probably overkill at first.

**Why not yet.**

- Adds a new HUD element + a new shader toggle + a per-frame
  BPM driver. Each is small but the bundle is enough to want a
  dedicated PR.
- Need to confirm that the visual pulse reads as "atmospheric"
  rather than distracting — likely needs A/B tuning of the
  amplitude curve.
- BPM calibration: the "fight intensity" curve has to feel
  responsive without being twitchy. Worth a small
  feel-engineering pass.

**When to revisit.**

- After the next round of bg-environment work has settled (so
  there's a stable canvas to add the pulse to).
- When we want a clearer "the body is alive" tell for the player
  and the existing tells (RBC drift, scanlines) feel too quiet.

---

## FX overlays: full Photoshop blend-mode list

**Today.** The blend dropdown on `staticNoise` and `vignette` (and
the per-layer `blend` field on bg-layers added in #143) ships only
three modes: `normal`, `multiply`, `additive`. Each maps to a
fixed-function GPU blend in WebGL2 (`gl.blendFunc`) and WebGPU
(pipeline blend state).

**User ask.** Expand to the full Photoshop / CSS list: `normal`,
`multiply`, `screen`, `overlay`, `darken`, `lighten`,
`color-dodge`, `color-burn`, `hard-light`, `soft-light`,
`difference`, `exclusion`, `hue`, `saturation`, `color`,
`luminosity` (~16 modes).

**The pain.** Most of those modes are NOT expressible as
fixed-function blends. `overlay` needs a per-pixel branch
(`if (a < 0.5) 2*a*b else 1 - 2*(1-a)*(1-b)`); `hue` /
`saturation` / `color` / `luminosity` need HSL round-trips per
pixel. The math is shader-side, which means the source pixel and
the destination pixel both have to be available to the fragment
shader at the same time. Fixed-function blends compose them on
the ROP — you never see the destination.

**Architecture options.**

1. **Sample the framebuffer per FX pass.** Render each FX overlay
   into a temp RT, then a small "compositor" pass samples both
   the underlying scene RT and the FX RT, computes the blend
   mode, and writes the result. ~1 extra RT + 1 extra pass per
   FX, but every blend mode becomes possible.
2. **Reuse the scene-FX RT plumbing introduced in #147 + #148.**
   `_sceneFxRt` is already a captured scene texture. Each FX
   overlay's shader can sample `_sceneFxRt` for the destination
   and compose in-shader. That avoids the per-FX temp RT but
   couples the FX overlays to the scene-RT slot's mutual
   exclusion with caustics / ripples-scene-wide.
3. **Don't.** Stick to the 3 modes; document which Photoshop
   modes are not supported.

**Why not yet.**

- Architectural change for what's effectively a polish feature.
  Six new effect kinds, each shipping in both WebGL2 + WebGPU,
  with renderer parity tests — adds up.
- Mutual exclusion math gets fiddly: if FX overlays sample
  `_sceneFxRt`, then they can't run when caustics is on (which
  owns the RT). Today they CAN compose with caustics (the FX
  overlay layers on top of the post-pass output via
  fixed-function blend, no RT sample needed).
- Most users won't notice the difference between `overlay` and
  `multiply` for a vignette tint.

**When to revisit.**

- Bg-layers PR B (drag-drop layer-list UI) ships and surfaces
  a per-layer blend dropdown — that's the right moment to invest
  in real blend math, since users will be composing arbitrary bg
  kinds with arbitrary blends.
- We hit a specific scene where the missing modes matter
  (e.g. a "color" blend mode for tinting noise to match the bg
  theme).
- Or: a 3rd-party shader library appears that ports
  Photoshop-blend math to WGSL/GLSL cleanly and we can just vendor
  it.

**Scope guardrails when we do.**

- Single compositor shader with a `mode` uniform branching on the
  blend formula. One shader, sixteen branches.
- Run it inside the existing `_sceneFxRt` pipeline so we don't
  add a third scene-RT slot.
- UI: same `<select>` dropdown wherever `staticNoiseBlend` /
  `vignetteBlend` / per-bg-layer `blend` lives today. Two-line
  change per call site.

