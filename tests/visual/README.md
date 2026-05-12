# Visual tests

Pixel-diff harness for the shader-test → game cell ports (see
[`.claude/plan/13-shader-test-visuals.md`](../../.claude/plan/13-shader-test-visuals.md)
and the per-port skill at
[`.claude/skills/import-shader-test-cell/SKILL.md`](../../.claude/skills/import-shader-test-cell/SKILL.md)).

## Running

```bash
# First time on a fresh checkout:
npm install
npx playwright install --with-deps chromium

# Run the full visual suite:
npm run test:visual

# Refresh baselines after an intentional visual change:
npm run test:visual:update
```

## What gets tested

`tests/visual/cells.spec.js` drives `docs/cell-zoo.html?cellType=…&theme=…&renderer=…&pose=1` for every (cell, theme, renderer) combination, screenshots the inner canvas, and compares against
`tests/visual/baselines/<cell>-<theme>-<renderer>.png`.

## Tolerances

Per-renderer pixel-diff thresholds — calibrated against
SwiftShader on Linux CI runners (WebGPU drifts a few pixels frame
to frame even on the same hardware):

| Renderer | Threshold |
|----------|-----------|
| canvas2d | 0.01      |
| webgl2   | 0.02      |
| webgpu   | 0.05      |

## Updating baselines

When a port intentionally changes a cell's appearance:

1. Run `npm run test:visual:update` locally (Linux + Chromium for
   parity with CI).
2. Commit the regenerated `tests/visual/baselines/*.png` in the
   same PR as the visual change.
3. The PR body should screenshot the cell before/after so the
   reviewer can sanity-check the new baseline.

## First time per-cell

The config uses `updateSnapshots: 'missing'` so the first
`npm run test:visual` run on a fresh cell creates baselines without
failing. Subsequent runs gate on the diff.
