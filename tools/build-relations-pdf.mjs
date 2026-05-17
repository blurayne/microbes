#!/usr/bin/env node
// Renders the immune-system relationship diagram from
// docs/ch13-anhang.md into an A4-landscape PDF using Playwright's
// bundled Chromium. Output: docs/assets/beziehungsdiagramm.pdf.
//
// Pure docs build helper; not wired into npm scripts.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const src  = join(repo, 'docs', 'ch13-anhang.md');
const out  = join(repo, 'docs', 'assets', 'beziehungsdiagramm.pdf');

const md = await readFile(src, 'utf8');
const svgMatch = md.match(/<svg[\s\S]*?<\/svg>/);
if (!svgMatch) throw new Error('relation-chart SVG not found in ch13-anhang.md');
// Strip the original style + background (the page will set those)
// and let the viewBox drive aspect-ratio preservation.
const svg = svgMatch[0]
  .replace(/\sstyle="[^"]*"/, '')
  .replace(/\sbackground[^"]*"/, '');

// A4 landscape = 297mm × 210mm. Reserve the top 22 mm for the
// header strip, leaving a 297 × 188 mm canvas for the chart.
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Beziehungsdiagramm · Immunsystem</title>
<style>
  @page { size: 297mm 210mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #1a0e3a; width: 297mm; height: 210mm; overflow: hidden; }
  body { display: grid; grid-template-rows: 22mm 1fr 8mm; }
  header {
    font-family: 'IBM Plex Sans', sans-serif;
    color: #cdd1ec; padding: 8mm 14mm 0 14mm; box-sizing: border-box;
  }
  header h1 { margin: 0 0 2px 0; font-size: 14pt; font-weight: 600; letter-spacing: 0.5px; }
  header p  { margin: 0; font-size: 8pt; color: #9aa0c4; max-width: 240mm; line-height: 1.4; }
  .chart-wrap {
    padding: 0 10mm; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    min-height: 0;
  }
  .chart-wrap svg {
    display: block;
    width: 100%;
    height: 100%;
    max-height: 100%;
  }
  footer {
    font-family: 'IBM Plex Mono', monospace;
    color: #6f7396; font-size: 7pt;
    padding: 0 14mm 4mm 14mm;
    display: flex; justify-content: space-between; align-items: flex-end;
  }
</style>
</head>
<body>
  <header>
    <h1>Beziehungsdiagramm · Immunsystem</h1>
    <p>Kurzgesagt-inspirierte Darstellung. Linke Hälfte: angeborene Immunität. Rechte Hälfte: adaptive Immunität. Kanten zeigen Interaktionstypen — siehe Legende rechts oben.</p>
  </header>
  <div class="chart-wrap">${svg}</div>
  <footer>
    <span>Microbes · GDD · Anhang §13.2</span>
    <span>blurayne/microbes</span>
  </footer>
</body>
</html>`;

const tmp = await mkdtemp(join(tmpdir(), 'relations-pdf-'));
const htmlPath = join(tmp, 'page.html');
await writeFile(htmlPath, html, 'utf8');

const browser = await chromium.launch({
  // Avoid Playwright's bundled browser revision check — point at the
  // pre-installed Chromium on disk. PLAYWRIGHT_CHROMIUM_EXECUTABLE
  // overrides; otherwise fall through and let Playwright resolve.
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.pdf({
    path: out,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true });
}
console.log('wrote', out);
