# Project plans

Tracks the open work. Each entry links to a detailed plan file in
[`.claude/plan/`](./.claude/plan/). Mark `[x]` when the
corresponding PR merges to `main` and move the entry to **Done**
with the merging PR # noted.

See [`CLAUDE.md`](./CLAUDE.md) for the workflow that keeps this
file in sync.

## Open

- [ ] **Shader-test visual parity for in-game cells** — [`.claude/plan/13-shader-test-visuals.md`](./.claude/plan/13-shader-test-visuals.md) — split into PRs A → F; foundation PRs serially, per-cell ports parallel.
- [ ] **Rendertest mode + Playwright artifact loop** — [`.claude/plan/14-rendertest-mode.md`](./.claude/plan/14-rendertest-mode.md) — `?debug=1&test=render` (alias `?rendertest=1`) produces deterministic single-cell renders; Playwright attaches a 672-PNG gallery as workflow artifacts.
- [ ] **Glass-membrane follow-ups (size slider, WebGL2 Y-flip, trail fix)** — [`.claude/plan/15-glass-membrane-followups.md`](./.claude/plan/15-glass-membrane-followups.md) — new `glassSize` slider; WebGL2 lens band no longer reads from mirrored scene rows.
- [ ] **Bump feedback (collision flash + squash)** — [`.claude/plan/16-bump-feedback.md`](./.claude/plan/16-bump-feedback.md) — per-cell squash + outline flash on collision, scaled by closing speed.
- [ ] **HUD rework: rename + move-to-debug + every-branch build stamp** — [`.claude/plan/17-hud-rework.md`](./.claude/plan/17-hud-rework.md) — three top-left HUD toggles move to Debug, share one pill style, build wraps to 2 rows for long branches, pages.yml builds on every branch.
- [ ] **Thick decoration lines on GPU** — [`.claude/plan/19-thick-decor-lines.md`](./.claude/plan/19-thick-decor-lines.md) — webgl2/webgpu decorations switch from line-list to expanded-quad triangles so the line-thickness slider visibly affects spikes / tendrils / flagella / cilia / drips / Y receptors.
- [ ] **Bump-feedback envelope (smoother + slower)** — [`.claude/plan/18-bump-envelope.md`](./.claude/plan/18-bump-envelope.md) — smoothstep attack + linear decay envelope; new Bump attack + Bump duration sliders.
- [ ] **Thick decoration lines on GPU** — [`.claude/plan/19-thick-decor-lines.md`](./.claude/plan/19-thick-decor-lines.md) — `_pushLine` emits screen-space-thick quads into `_decorTris` so the Line thickness slider actually thickens spikes / tendrils / flagella on WebGL2 + WebGPU.
- [ ] **Bump-feedback envelope (smoother + slower)** — [`.claude/plan/18-bump-envelope.md`](./.claude/plan/18-bump-envelope.md) — smoothstep attack + linear decay envelope replaces the exp decay; new Bump attack + Bump duration sliders.
- [ ] **GDD per-cell + per-pathogen detail pages** — [`.claude/plan/23-gdd-cell-pathogen-pages.md`](./.claude/plan/23-gdd-cell-pathogen-pages.md) — 20 neue Detailseiten unter `docs/cells/` und `docs/pathogens/` mit Was / Wie / Wann pro Einheit; mkdocs-Nav nestet sie unter ch01 / ch02.

## Done

- [x] **Glass-membrane silhouette + inset slider** — [`.claude/plan/22-glass-silhouette.md`](./.claude/plan/22-glass-silhouette.md) (#267)

- [x] **Externalize non-`en` locales to `assets/i18n/*.json`** — [`.claude/plan/21-externalize-locales.md`](./.claude/plan/21-externalize-locales.md) (#266)

- [x] **Locales: Quenya · Sindarin · Black Speech · Klingon · Proto-Indo-European · Mittelhochdeutsch** — [`.claude/plan/20-locales-tolkien-and-more.md`](./.claude/plan/20-locales-tolkien-and-more.md) (#265)


- [x] **Background-size slider (uniform feature scale across all bg patterns)** — [`.claude/plan/12-bg-scale-slider.md`](./.claude/plan/12-bg-scale-slider.md) (#178)

- [x] **Unified overlay stack (checkbox-in-row, chained FBO pipeline)** — [`.claude/plan/11-unified-overlay-stack.md`](./.claude/plan/11-unified-overlay-stack.md) (PR A #161 · PR B #162 · PR C #163 · PR D #164 · PR D2 #168)

- [x] **Background layer stack (drag-drop compositable bgs)** — [`.claude/plan/10-bg-layer-stack.md`](./.claude/plan/10-bg-layer-stack.md) (PR A #143 · PR B #151 · PR C #152 · PR D #153)

- [x] **Rotation gesture + 2× zoom-out** — [`.claude/plan/01-rotation-and-zoom.md`](./.claude/plan/01-rotation-and-zoom.md) (#35)
- [x] **Reactor background (Gray-Scott, WebGL2)** — [`.claude/plan/04-reactor-bg.md`](./.claude/plan/04-reactor-bg.md) (#37)
- [x] **Reactor bg WebGPU port** — [`.claude/plan/05-reactor-webgpu-port.md`](./.claude/plan/05-reactor-webgpu-port.md) (#38)
- [x] **Free Game implementation** — [`.claude/plan/03-free-game-implementation.md`](./.claude/plan/03-free-game-implementation.md) (#44 / #45 / #46 / #47)
- [x] **Virus 3D shader experiment (WebGL2)** — [`.claude/plan/02-virus-shader-experiment.md`](./.claude/plan/02-virus-shader-experiment.md) (#50)
- [x] **Reactive faces + smooth eye movement** — [`.claude/plan/07-reactive-faces.md`](./.claude/plan/07-reactive-faces.md) (#51)
- [x] **Shader test doc + multi-cell dropdown** — [`.claude/plan/08-shader-test-doc.md`](./.claude/plan/08-shader-test-doc.md) (#52)
- [x] **Shader test: cover all game cell + pathogen types** — [`.claude/plan/09-shader-test-all-types.md`](./.claude/plan/09-shader-test-all-types.md) (#53)
- [x] **Virus 3D shader — WebGPU + Canvas2D ports** — [`.claude/plan/06-virus-shader-gpu-port.md`](./.claude/plan/06-virus-shader-gpu-port.md) — abandoned: the whole virus 3D experiment was removed in #117 along with `S.virusShader3D`, the shader branch, and the vendored Three.js sphere helpers.

## Process

1. New non-trivial change → drop a new file in `.claude/plan/`
   (numbered, kebab-case).
2. Add a checkbox entry to **Open** above with a relative link.
3. When the PR merges, update the checkbox to `[x]` and move the
   entry to **Done** with `(#PR)` after the link.
4. Plans never get deleted; the **Done** section is the project's
   running history of intent + outcomes.
