// Rendertest artifact spec.
//
// Drives `?rendertest=1` (alias for `?debug=1&test=render`) on both
// the live game and the shader-test reference page, captures the
// `#stage` canvas as a PNG via `page.locator('#stage').screenshot()`
// after the page sets `window.__RENDERTEST_READY__ = true`, and
// attaches each capture to the Playwright report.
//
// This spec produces ARTIFACTS, not assertions. It always passes;
// failures only happen when the page itself errors out (e.g. a
// forced `?renderer=webgpu` on a runner without WebGPU bubbles up as
// a page-error). Tightening into a diff is the next PR's job.
//
// Output: one PNG per (cell × theme × renderer × bg) tuple,
// attached via `testInfo.attach()` so it lands in
// `playwright-report/data/` and rides the existing
// `actions/upload-artifact@v4` step in `.github/workflows/visual-test.yml`.
//
// Total: 21 cells × 4 themes × 3 renderers × 2 bgs (game) +
//        21 cells × 4 themes × 2 bgs (shader-test)
//      = 504 + 168 = 672 PNGs.

import { test } from '@playwright/test';
import { CELLS, THEMES, CELL_KIND } from './_fixtures.js';

const RENDERERS = ['canvas2d', 'webgl2', 'webgpu'];
const BGS = [
  { key: 'black',       translucent: false },
  { key: 'translucent', translucent: true  },
];

// `?w=&h=` baked in so the canvas size matches across all captures.
// 512 keeps the artifact bundle small (≈30–50 MB total) while leaving
// enough resolution to spot membrane / nucleus differences by eye.
const SIZE = 512;

function gameUrl(cell, theme, renderer, translucent) {
  const p = new URLSearchParams({
    rendertest: '1',
    cellType: cell.key,
    theme,
    renderer,
    bg: 'solid',
    w: String(SIZE),
    h: String(SIZE),
  });
  if (translucent) p.set('translucent', '1');
  if (cell.cat === 'extended') p.set('extended', '1');
  return `/index.html?${p.toString()}`;
}

function shaderToyUrl(cell, theme, translucent) {
  const p = new URLSearchParams({
    rendertest: '1',
    cellType: cell.key,
    theme,
    w: String(SIZE),
    h: String(SIZE),
  });
  if (translucent) p.set('translucent', '1');
  return `/docs/shader-test.html?${p.toString()}`;
}

async function captureRendertest(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  // The page sets __RENDERTEST_READY__ after two rAFs so the cell
  // framing + first paint have settled. 5 s ceiling guards against
  // WebGPU init taking longer than usual on cold runners.
  await page.waitForFunction(() => window.__RENDERTEST_READY__ === true, null, {
    timeout: 5000,
  });
  return await page.locator('#stage').screenshot({ type: 'png' });
}

// ---- Game: cell × theme × renderer × bg ------------------------------
for (const cell of CELLS) {
  for (const theme of THEMES) {
    for (const renderer of RENDERERS) {
      for (const bg of BGS) {
        const kindN = CELL_KIND[cell.key];
        const suffix = bg.translucent ? '_translucent' : '';
        const filename = `game-${renderer}_cell-${cell.key}${kindN}_${theme}${suffix}.png`;
        test(`game · ${renderer} · ${cell.key} · ${theme} · ${bg.key}`, async ({ page }, testInfo) => {
          const buf = await captureRendertest(page, gameUrl(cell, theme, renderer, bg.translucent));
          await testInfo.attach(filename, { body: buf, contentType: 'image/png' });
        });
      }
    }
  }
}

// ---- Shader-test (single backend, two bgs) ---------------------------
for (const cell of CELLS) {
  for (const theme of THEMES) {
    for (const bg of BGS) {
      const kindN = CELL_KIND[cell.key];
      const suffix = bg.translucent ? '_translucent' : '';
      const filename = `shadertoy_cell-${cell.key}${kindN}_${theme}${suffix}.png`;
      test(`shadertoy · ${cell.key} · ${theme} · ${bg.key}`, async ({ page }, testInfo) => {
        const buf = await captureRendertest(page, shaderToyUrl(cell, theme, bg.translucent));
        await testInfo.attach(filename, { body: buf, contentType: 'image/png' });
      });
    }
  }
}
