# Project plans

Tracks the open work. Each entry links to a detailed plan file in
[`.claude/plan/`](./.claude/plan/). Mark `[x]` when the
corresponding PR merges to `main` and move the entry to **Done**
with the merging PR # noted.

See [`CLAUDE.md`](./CLAUDE.md) for the workflow that keeps this
file in sync.

## Open

- [ ] **Virus 3D shader experiment** — [`.claude/plan/02-virus-shader-experiment.md`](./.claude/plan/02-virus-shader-experiment.md)
- [ ] **Free Game implementation** — [`.claude/plan/03-free-game-implementation.md`](./.claude/plan/03-free-game-implementation.md)
- [ ] **Reactor background (Gray-Scott)** — [`.claude/plan/04-reactor-bg.md`](./.claude/plan/04-reactor-bg.md)

## Done

- [x] **Rotation gesture + 2× zoom-out** — [`.claude/plan/01-rotation-and-zoom.md`](./.claude/plan/01-rotation-and-zoom.md) (#35)

## Process

1. New non-trivial change → drop a new file in `.claude/plan/`
   (numbered, kebab-case).
2. Add a checkbox entry to **Open** above with a relative link.
3. When the PR merges, update the checkbox to `[x]` and move the
   entry to **Done** with `(#PR)` after the link.
4. Plans never get deleted; the **Done** section is the project's
   running history of intent + outcomes.
