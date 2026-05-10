# CLAUDE.md — workflow notes for AI sessions

This file is the on-boarding doc for any future Claude session
working on this repo. Keep it tight; it grows by intent only.

## Plan tracking

Open work lives in [`PLAN.md`](./PLAN.md) (at the repo root) +
[`.claude/plan/`](./.claude/plan/) (one numbered file per plan).

When **starting** a non-trivial change:

1. Drop a new file in `.claude/plan/` named `NN-kebab-case.md`
   (next two-digit number; never reuse).
2. The plan file follows the standard shape:
   `Context · Audit · Approach · Critical files · Verification · Branch`.
3. Add a checkbox entry to **PLAN.md → Open** with a relative
   link to the new plan file.

When **shipping** the change:

4. Open a PR titled with the plan's headline. Reference the plan
   file in the PR body.
5. After the PR merges to `main`, update **PLAN.md**:
   - flip the checkbox `[ ]` → `[x]`,
   - move the entry from **Open** to **Done**,
   - append the merging PR # in parentheses.
6. Plan files in `.claude/plan/` are **never deleted** — they
   accumulate as a project history.

## House rules

- **Always branch off `main`.** Never commit directly to main.
- **One PR per logical change.** Big plans split into sub-PRs;
  the plan file in `.claude/plan/` describes the split.
- **Always announce the build number after a merge or push.**
  After merging a PR or pushing to main, the assistant must tell
  the user which **build number** is now deploying — this is the
  GitHub PR number that just landed (e.g. "PR #95 merged → build
  #95 is deploying"). The user uses this to know which version
  of the GitHub Pages site to expect on next refresh. Do this on
  every merge/push without being asked.
- **Pre-commit checks**: `node --test` + render-module imports
  (`for r in canvas2d webgl2 webgpu; do node -e "import('./assets/render/${r}.js').then(()=>console.log(r))"; done`).
- **Renderer parity**: when a visual change touches one renderer
  it usually has to land in the others too (canvas2d, webgl2,
  webgpu). Document any intentional gaps in the plan file.
- **Default renderer is WebGPU** (with WebGL2 + Canvas2D as
  graceful fallbacks). Pixi was removed in PR #31 — see
  [`RENDERERS.md`](./RENDERERS.md) for the architecture rationale.
- **No build step today** (vanilla ES modules). Adding a build step
  is a load-bearing decision — if it ever happens, revisit the
  ideas in [`IDEAS.md`](./IDEAS.md).
- **Settings shape**: `assets/core/state.js` is the single source
  of truth for `S.*` defaults. Add new settings with i18n strings
  in all five locales (en, de, es, bar, la). Migration shims for
  removed values go in `loadSettings`.

## Reference docs

- [`RENDERERS.md`](./RENDERERS.md) — perf + library research; why
  Pixi was removed; canvas2d / webgl2 / webgpu comparison.
- [`IDEAS.md`](./IDEAS.md) — deferred ideas with revisit triggers.
- [`docs/`](./docs/) — game design (German) rendered via MkDocs.
