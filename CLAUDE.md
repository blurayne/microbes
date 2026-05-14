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

- **Always branch off `main`.** Never commit directly to main, and
  never stack PRs on feature branches — every PR's `base` is
  `main`, never another `claude/*` branch. If a follow-up depends
  on work that hasn't merged yet, wait for the parent PR to land,
  then branch off the freshly-updated main.
- **One PR per logical change.** Big plans split into sub-PRs;
  the plan file in `.claude/plan/` describes the split.
- **Auto-merge when CI is green.** Every PR opened by a Claude
  session should have auto-merge enabled (`merge_method: squash`)
  immediately after creation, so it lands on main as soon as the
  Pages-deploy workflow + tests pass without the user having to
  click anything. Use `mcp__github__enable_pr_auto_merge`. The
  user explicitly opted in to this in May 2026 — don't ask each
  time, just do it.
- **Always announce branch / PR / build / codename after every
  merge or push to main.** Three numbers, three meanings — never
  conflate them:
    - **PR number** — the GitHub PR that just merged (e.g. #98).
      Stable identifier. NOT the same as the build number.
    - **Build number** — the GitHub Actions Pages-deploy *run*
      number for the merge commit. Different counter than PR #.
    - **Codename** — derived from the build run via
      `buildCodename(run)` in `assets/core/build-codename.js`.
  Always include the **source branch** of the PR too — the user
  uses it to track which session/feature shipped. Format:
  ```
  PR #98 from claude/pr-b3-vesicles → main
  build #N · <codename> · deployed: https://blurayne.github.io/microbes/
  ```
- **Verify the deploy actually finished before announcing.** If
  a GitHub token lives at `~/.github-token` (chmod 600, outside
  the repo, never `git add`-ed), use it via `curl` to poll the
  workflow run for the merge commit *to completion* and only
  then report the URL. Poll loop:
  ```bash
  TOKEN="$(cat ~/.github-token)"
  # Find the in-flight run for main
  RUN_ID=$(curl -sS -H "Authorization: Bearer ${TOKEN}" \
    "https://api.github.com/repos/blurayne/microbes/actions/runs?per_page=1&branch=main" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['workflow_runs'][0]['id'])")
  while true; do
    STATE=$(curl -sS -H "Authorization: Bearer ${TOKEN}" \
      "https://api.github.com/repos/blurayne/microbes/actions/runs/${RUN_ID}" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status'], d['conclusion'])")
    echo "$STATE"
    case "$STATE" in completed*) break;; esac
    sleep 15
  done
  ```
  Run this in the background (Bash `run_in_background: true` or
  Monitor) so the user can see the poll output stream in. Once
  the run reports `completed/success`, fetch
  `/repos/blurayne/microbes/pages` and report the `html_url` as
  the deployment URL. If the run is `completed/failure`, fetch
  the failing job's step list + log download so the user sees
  exactly why before any next push. **Never commit the token.**
  If no token is available, fall back to "(build # pending — you'll
  see it on next refresh)".
- **Pages source must be `build_type: workflow`.** If the API
  reports `build_type: legacy`, my custom `pages.yml` runs but
  its artifact is ignored — the deployed site comes from
  GitHub's built-in Jekyll workflow against the raw `main`
  branch, so the stamp step never affects what users see. PUT
  `{"build_type":"workflow"}` to `/repos/blurayne/microbes/pages`
  needs `pages:write` on the token; if 403, ask the user to flip
  it in the GitHub UI: **Settings → Pages → Build and deployment
  → Source: GitHub Actions**.
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
