// Visual-regression suite for the shader-test cell-port effort.
// Drives docs/cell-zoo.html one frame at a time, screenshots the
// inner canvas, and pixel-diffs against tests/visual/baselines/.
//
// Per-cell PRs grow the baseline set; the harness itself is
// content-free (just the spec).
//
// Keep CELLS in sync with assets/core/state.js CELL_TYPES.

import { test, expect } from '@playwright/test';

const CELLS = [
  // immune
  { key: 'neutrophil', cat: 'good' },
  { key: 'monocyte',   cat: 'good' },
  { key: 'mast',       cat: 'good' },
  { key: 'nk',         cat: 'good' },
  { key: 'macrophage', cat: 'good' },
  { key: 'dendritic',  cat: 'good' },
  { key: 'basophil',   cat: 'good' },
  { key: 'platelet',   cat: 'good' },
  { key: 'tcell',      cat: 'good' },
  { key: 'bcell',      cat: 'good' },
  { key: 'eosinophil', cat: 'good' },
  { key: 'rbc',        cat: 'good' },
  // pathogens
  { key: 'virus',     cat: 'bad' },
  { key: 'germ',      cat: 'bad' },
  { key: 'bacterium', cat: 'bad' },
  { key: 'amoebaP',   cat: 'bad' },
  { key: 'slime',     cat: 'bad' },
  { key: 'mite',      cat: 'bad' },
  { key: 'spore',     cat: 'bad' },
  { key: 'toxin',     cat: 'bad' },
  // extended (gated on ?extended=1)
  { key: 'eukaryote', cat: 'extended' },
];

const THEMES = ['legacy', 'microscope', 'cartoon', 'kurzgesagt', 'classic'];

// Tolerances align with tests/visual/README.md. WebGPU on Linux
// uses SwiftShader (Vulkan over llvmpipe) → wider band; WebGL2 +
// canvas2d are mostly deterministic.
const RENDERERS = [
  { name: 'canvas2d', maxDiffPixelRatio: 0.01 },
  { name: 'webgl2',   maxDiffPixelRatio: 0.02 },
  { name: 'webgpu',   maxDiffPixelRatio: 0.05 },
];

function frameUrl(cell, theme, renderer) {
  const p = new URLSearchParams({
    cellType: cell.key,
    theme,
    renderer,
    pose: '1',
  });
  if (cell.cat === 'extended') p.set('extended', '1');
  return `/index.html?${p.toString()}`;
}

for (const renderer of RENDERERS) {
  test.describe(`renderer ${renderer.name}`, () => {
    for (const cell of CELLS) {
      for (const theme of THEMES) {
        test(`${cell.key} · ${theme}`, async ({ page }) => {
          await page.goto(frameUrl(cell, theme, renderer.name));
          // Wait for the canvas + sim to settle. Two rAFs after
          // setPaused(true) plus a small buffer for cartoon-face
          // first-frame paint.
          await page.waitForFunction(() => {
            const c = document.getElementById('stage');
            return c && c.width > 0 && c.height > 0;
          });
          await page.waitForTimeout(250);
          const canvas = page.locator('#stage');
          await expect(canvas).toHaveScreenshot(
            `${cell.key}-${theme}-${renderer.name}.png`,
            { maxDiffPixelRatio: renderer.maxDiffPixelRatio },
          );
        });
      }
    }
  });
}
