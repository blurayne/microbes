// Game-vs-shader-test visual diff harness.
//
// For each (cell, theme): renders the game and the shader-test page
// at the same URL params, captures each #stage canvas as a PNG, and
// pixel-diffs them with pixelmatch. The shader-test capture is the
// "source of truth"; any pair whose diff exceeds the per-renderer
// threshold flags a candidate for a per-cell port PR.
//
// Discovery mode (current): failures emit a side-by-side PNG +
// computed diff ratio as a Playwright attachment, so the report
// surfaces *which* cells need work. Thresholds (below) are
// deliberately permissive so noisy renderers don't drown out the
// signal. Tighten after each port lands.
//
// Pairs with PR #197 (game `?pose=1` clean-pose + ?bg=…) and PR #198
// (shader-test URL params + screenshot). The same URL works on
// both pages — game spawns one cell at world centre, shader-test
// displays one specimen centred. We center-crop both captures to a
// fixed 400×400 box so canvas-size differences don't pollute the
// pixel-diff.

import { test, expect } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// Same 21-cell list as cells.spec.js. Keep in sync with
// assets/core/state.js CELL_TYPES + the eukaryote extended entry.
const CELLS = [
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
  { key: 'virus',      cat: 'bad' },
  { key: 'germ',       cat: 'bad' },
  { key: 'bacterium',  cat: 'bad' },
  { key: 'amoebaP',    cat: 'bad' },
  { key: 'slime',      cat: 'bad' },
  { key: 'mite',       cat: 'bad' },
  { key: 'spore',      cat: 'bad' },
  { key: 'toxin',      cat: 'bad' },
  { key: 'eukaryote',  cat: 'extended' },
];

// shader-test has NO legacy theme — that's the in-game canvas2d-look
// fallback. So this harness covers the 4 themes both pages can
// produce: microscope, cartoon, kurzgesagt, classic.
const THEMES = ['microscope', 'cartoon', 'kurzgesagt', 'classic'];

const CROP_SIZE = 400;
// Pixel-diff threshold (pixelmatch's per-pixel YIQ delta). 0.12 is
// permissive — accommodates anti-alias jitter + sub-pixel wobble
// phase drift. The overall diff ratio (failing-pixels / total) is
// the test's actual gate.
const PER_PIXEL_THRESHOLD = 0.12;
// Overall ratio at which we consider the pair "matched". Set
// loosely now (discovery mode); tighten to ≈0.02 once cells are
// brought into parity.
const MAX_DIFF_RATIO = 0.30;

function gameUrl(cell, theme) {
  const p = new URLSearchParams({
    cellType: cell.key,
    theme,
    bg: 'solid',
    pose: '1',
    t: '0',
  });
  if (cell.cat === 'extended') p.set('extended', '1');
  return `/index.html?${p.toString()}`;
}

function shaderTestUrl(cell, theme) {
  const p = new URLSearchParams({
    cellType: cell.key,
    theme,
    bg: 'solid',
    pose: '1',
    t: '0',
  });
  return `/docs/shader-test.html?${p.toString()}`;
}

async function captureCanvas(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  // Wait for #stage canvas to exist + size up.
  await page.waitForFunction(() => {
    const c = document.getElementById('stage');
    return c && c.width > 0 && c.height > 0;
  });
  // Settle: pose=1 freezes the loop after one frame; give a buffer
  // for the first paint to compose (face overlay, etc.).
  await page.waitForTimeout(400);
  return await page.locator('#stage').screenshot({ type: 'png' });
}

function centerCrop(png, size) {
  const sx = Math.max(0, Math.floor((png.width  - size) / 2));
  const sy = Math.max(0, Math.floor((png.height - size) / 2));
  const w = Math.min(size, png.width  - sx);
  const h = Math.min(size, png.height - sy);
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, sx, sy, w, h, 0, 0);
  return out;
}

// Compose game (left) + shader-test (right) + diff (far right) into
// a single PNG for the failure attachment.
function composeSideBySide(gameImg, shaderImg, diffImg) {
  const gap = 6;
  const w = gameImg.width + gap + shaderImg.width + gap + diffImg.width;
  const h = Math.max(gameImg.height, shaderImg.height, diffImg.height);
  const out = new PNG({ width: w, height: h });
  // background fill — light grey so any zero-alpha pixels are
  // obvious in the attachment.
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i]     = 28;
    out.data[i + 1] = 30;
    out.data[i + 2] = 36;
    out.data[i + 3] = 255;
  }
  PNG.bitblt(gameImg,   out, 0, 0, gameImg.width,   gameImg.height,   0, 0);
  PNG.bitblt(shaderImg, out, 0, 0, shaderImg.width, shaderImg.height, gameImg.width + gap, 0);
  PNG.bitblt(diffImg,   out, 0, 0, diffImg.width,   diffImg.height,   gameImg.width + gap + shaderImg.width + gap, 0);
  return PNG.sync.write(out);
}

for (const cell of CELLS) {
  for (const theme of THEMES) {
    test(`${cell.key} · ${theme} — game vs shader-test`, async ({ page }, testInfo) => {
      const [gameBuf, shaderBuf] = [
        await captureCanvas(page, gameUrl(cell, theme)),
        await captureCanvas(page, shaderTestUrl(cell, theme)),
      ];

      const game   = centerCrop(PNG.sync.read(gameBuf),   CROP_SIZE);
      const shader = centerCrop(PNG.sync.read(shaderBuf), CROP_SIZE);
      const w = Math.min(game.width,  shader.width);
      const h = Math.min(game.height, shader.height);

      const diff = new PNG({ width: w, height: h });
      const diffPx = pixelmatch(
        game.data, shader.data, diff.data, w, h,
        { threshold: PER_PIXEL_THRESHOLD, includeAA: false },
      );
      const totalPx = w * h;
      const ratio = diffPx / totalPx;

      // Always attach the side-by-side composite + the raw diff PNG
      // so the report shows what's going on whether the test passes
      // or fails.
      const composite = composeSideBySide(game, shader, diff);
      await testInfo.attach(`${cell.key}-${theme}-compare.png`, {
        body: composite, contentType: 'image/png',
      });
      await testInfo.attach(`${cell.key}-${theme}-stats.json`, {
        body: Buffer.from(JSON.stringify({
          cell: cell.key, theme,
          diffPixels: diffPx, totalPixels: totalPx,
          ratio: Number(ratio.toFixed(4)),
          threshold: MAX_DIFF_RATIO,
        }, null, 2)),
        contentType: 'application/json',
      });

      // Discovery mode: assert the loose threshold. Tighten once
      // per-cell ports bring divergent specimens into parity.
      expect(ratio, `${cell.key}/${theme} diverges ${(ratio * 100).toFixed(2)}% from shader-test`)
        .toBeLessThan(MAX_DIFF_RATIO);
    });
  }
}
