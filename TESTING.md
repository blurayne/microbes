# Testing

This repo has three test surfaces, each runnable locally with no
build step (the project ships vanilla ES modules — see
[`CLAUDE.md`](./CLAUDE.md)).

| Surface | Command | What it checks |
|---|---|---|
| **Unit / state** | `npm test` | `node --test` over `test/*.test.js`. Settings shape, CELL_TYPES schema, migration shims. ~35 tests, all sub-second. |
| **Module-import smoke** | (one-liner below) | Each renderer file imports cleanly under Node. Catches syntax + circular-import regressions. |
| **Visual diffs** | `npm run test:visual:diff` | Headless Chromium via Playwright. Per `(cell × theme)` pair: screenshot the game canvas + the shader-test canvas, pixel-diff. The shader-test render is the source of truth. |

The visual suite also includes a baseline-based regression gate
(`tests/visual/cells.spec.js`) for cells that have already been
brought into parity — see [Visual baselines](#visual-baselines)
below.

## Prereqs

- **Node 20+** (uses built-in `node --test`; no test framework).
- **`@playwright/test`** + Chromium for the visual suite — installed
  via `npm install` + `npx playwright install`.
- **Python 3** for the local dev server Playwright boots
  (`python3 -m http.server …`).

```bash
npm install                                  # installs devDeps from lockfile
npx playwright install --with-deps chromium  # one-time browser fetch
```

`--with-deps` pulls the system libs Chromium needs (libnss3, fonts,
…) on Ubuntu. macOS / Windows skip the apt step automatically.

## Unit tests

```bash
npm test
```

Runs every `test/**/*.test.js` file under `node --test`. Output is
TAP-style; failures show the assertion + the line + a stack trace.
Add new tests as plain ES modules:

```js
// test/foo.test.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

test('does the thing', () => {
  assert.equal(1 + 1, 2);
});
```

`node --test` has no setup/teardown sugar beyond top-level imports.
Keep tests pure — no DOM, no fetch.

## Module-import smoke

```bash
for r in canvas2d webgl2 webgpu; do
  node -e "import('./assets/render/${r}.js').then(()=>console.log('${r}: OK')).catch(e=>{console.error('${r}:', e.message); process.exit(1)})"
done
```

Verifies the three renderer modules + their transitive imports load
under Node (which lacks DOM + WebGPU). Catches:

- ES-module syntax errors.
- Circular imports that throw on load.
- Top-level side effects that need a browser.

Run after touching `assets/render/*.js`, `assets/core/state.js`, or
any module they import. This is the same check the **pages-deploy**
workflow runs in CI.

## Visual tests

The Playwright suite lives at
[`tests/visual/`](./tests/visual/README.md). Two specs:

### 1. `game-vs-shader-test.spec.js` — pair diff (advisory)

For each `(cell × theme)` pair (21 × 4 = 84 cases):

1. Loads `/index.html?cellType=…&theme=…&bg=solid&pose=1&t=0` and
   screenshots `#stage`.
2. Loads `/docs/shader-test.html?…same params…` and screenshots
   `#stage`.
3. Center-crops both to 400×400 px so canvas-size differences
   don't pollute the diff.
4. `pixelmatch` with `threshold: 0.12, includeAA: false`.
5. Attaches a side-by-side composite (`game │ shader-test │ diff`)
   + a stats JSON to the Playwright HTML report — **on every test**,
   pass or fail.

```bash
npm run test:visual:diff
```

Outputs:

```
test-results/
  <cell>-<theme>-compare.png    # game | shader-test | diff
  <cell>-<theme>-stats.json     # { diffPixels, ratio, threshold }
playwright-report/
  index.html                    # HTML report, sortable
```

Open `playwright-report/index.html` to review. Failing pairs are
the candidates for the next per-cell port PR (see the
[skill](./.claude/skills/import-shader-test-cell/SKILL.md)).

### 2. `cells.spec.js` — historical baselines

For each `(cell × theme × renderer)` triple, screenshots the
`#stage` canvas via `cell-zoo.html?cellType=…&theme=…&renderer=…&pose=1`
and pixel-diffs against `tests/visual/baselines/`.

```bash
# Run the full suite (both specs):
npm run test:visual

# Refresh baselines after an intentional visual change:
npm run test:visual:update
```

Per-renderer thresholds (set in the spec) — calibrated against
SwiftShader on Linux CI:

| Renderer | maxDiffPixelRatio |
|---|---|
| canvas2d | 0.01 |
| webgl2   | 0.02 |
| webgpu   | 0.05 |

### URL params used by the visual suite

Both pages honour the same URL params so the diff harness drives
them with one query string. Useful for manual triage:

- `?cellType=KEY` — name (matches `CELL_TYPES` keys) **or** integer
  0..20.
- `?theme=KEY` — `microscope` / `cartoon` / `kurzgesagt` / `classic`
  (shader-test has no `legacy`).
- `?renderer=canvas2d|webgl2|webgpu` (game only; shader-test
  auto-picks WebGPU then WebGL2).
- `?bg=KEY` — `solid` (synthetic dark) or any
  `KNOWN_BACKGROUND_KEYS` value (game-side) / shader-test bgkind
  integer 0..6.
- `?pose=1` — freeze the sim after the first frame. On the game
  side this also adds `body.is-pose-clean` so all chrome (FABs,
  scanlines, pause overlay, …) hides — bare canvas only.
- `?t=N` — clamp the time uniform to `N` for deterministic wobble
  phase.
- `?screenshot=1` — auto-download a PNG of `#stage` inside the
  first paint's rAF tick. Pairs with `?pose=1` for repeatable
  captures.

Manual capture without a URL param: press `s` on the shader-test
page, or click **Settings → Screenshot** in the game (also
exposed as `window.__SCREENSHOT__()` / `window.__SHADER_TEST_SCREENSHOT__()`).

### Updating baselines

Bring a per-cell port into the baseline set after an intentional
visual change:

```bash
npm run test:visual:update
git add tests/visual/baselines/<cell>-<theme>-<renderer>.png
```

Each baseline PNG is ~5 KB; the full set (20 × 5 × 3 = 300) tops
out around 1.5 MB. Commit them in the same PR as the visual
change so the reviewer can sanity-check the new look.

## CI

[`.github/workflows/visual-test.yml`](./.github/workflows/visual-test.yml)
runs on every PR that touches `assets/**`, `docs/cell-zoo.html`,
`docs/shader-test.html`, `tests/visual/**`, `index.html`,
`playwright.config.js`, `package.json`, `package-lock.json`, or the
workflow itself. The job is **advisory** (`continue-on-error: true`)
until cells reach parity; failing pairs surface in the artifact
report without gating the PR.

The pages-deploy workflow (`.github/workflows/pages.yml`) runs
`npm test` + builds the MkDocs book on every push to `main`.

## Troubleshooting

**`npx playwright install` fails to download Chromium.** The CDN
is `storage.googleapis.com/chrome-for-testing-public/`; corporate
proxies often block it. Set `PLAYWRIGHT_DOWNLOAD_HOST` to a mirror
or download the browser tarball manually and unpack into
`~/.cache/ms-playwright/`.

**Visual diffs flake on WebGPU.** On Linux runners Chromium uses
SwiftShader (Vulkan over llvmpipe) — slight rasterisation drift
between runs. The 0.05 threshold accommodates that; if a single
pair flakes repeatedly, regenerate just its baseline with
`npm run test:visual:update` and commit.

**`#stage canvas missing`.** Both pages render into a `<canvas id="stage">`.
If your test goes blank, check the iframe URL — `pose=1`
+ `bg=solid` are required for a known cell to spawn on the dark
backdrop the harness diffs against.

**Pages-deploy stamps `(build # pending)`.** That's expected for
the first 30s after merge — the workflow run number lands when
Actions starts the deploy job. Hard-refresh after a minute to see
the live build stamp + codename (`buildCodename(run)` in
`assets/core/build-codename.js`).

## Adding a new test

1. **Unit** — drop a `.test.js` under `test/` and `npm test`
   picks it up automatically.
2. **Module-import smoke** — already covers `assets/render/*`; add
   new renderer entry points to the shell loop above and to
   [pages.yml](./.github/workflows/pages.yml) if relevant.
3. **Visual** — add the cell to `CELLS` in
   [`tests/visual/game-vs-shader-test.spec.js`](./tests/visual/game-vs-shader-test.spec.js)
   (and to `cells.spec.js` if it should gate against baselines).
   Run `npm run test:visual:diff` locally and paste the resulting
   `*-compare.png` in the PR body.

## See also

- [`tests/visual/README.md`](./tests/visual/README.md) — older
  per-spec doc (this file's `Visual tests` section supersedes it
  but keeps the same workflow).
- [`.claude/plan/13-shader-test-visuals.md`](./.claude/plan/13-shader-test-visuals.md)
  — the full Plan 13 brief: PR split, helpers reused, risks.
- [`.claude/skills/import-shader-test-cell/SKILL.md`](./.claude/skills/import-shader-test-cell/SKILL.md)
  — checklist for porting a single cell or theme from
  `docs/shader-test.html` into the game.
