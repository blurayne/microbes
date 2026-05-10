# Project plans

Tracks the open work. Each entry links to a detailed plan file in
[`.claude/plan/`](./.claude/plan/). Mark `[x]` when the
corresponding PR merges to `main` and move the entry to **Done**
with the merging PR # noted.

See [`CLAUDE.md`](./CLAUDE.md) for the workflow that keeps this
file in sync.

## Open

_None — see Done. Day-to-day work for this project has moved to
small standalone PRs (defaults / shaders / settings polish);
they're tracked in the git log + PR descriptions rather than as
numbered plan files. New non-trivial features should still drop a
plan here per the Process section below._

## Done

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
