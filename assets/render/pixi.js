// Microbes — PixiJS renderer.
//
// Phase 1 of the Pixi migration. Implements the IRenderer interface
// (renderer.js) using PixiJS v8. Pixi is loaded from an ESM CDN so the
// project keeps its no-build-step deployment story.
//
// Scope right now:
//   - init / resize / beginFrame / endFrame / destroy
//   - drawBackground: gradient or flat base fill (theme-aware)
//   - drawCells: each shape as a filled disc with the theme outline
//   - drawSelection / drawDebug: minimal (selection ring; debug overlay)
//
// Out of scope here (deferred to Phase 2 follow-up commit):
//   - Metaball mask + 8-direction outline blit + per-cell cytoplasm
//     gradient + inner highlight (canvas2d.js's drawMetaballMask /
//     tintMask / drawMetaballToMain pipeline).
//   - Membrane stroke, granules, decorations (spikes, tendrils,
//     receptors, flagellum, drips, legs, fuzz), nuclei, cartoon
//     faces, target marker, flash overlay, anatomy decor / spots /
//     vignette / agar rings / cybergrid.
//
// Async note: Pixi v8's `Application.init()` is async, so this class
// exposes `initAsync()` returning a Promise. `app.js` awaits it before
// the first frame. The synchronous `init()` from RendererBase is kept
// as a no-op so the IRenderer surface doesn't break for callers that
// haven't been async-ified.

import {
  S, CELL_TYPES, currentBackground, currentTheme, cellColors,
} from '../core/state.js';
import { RendererBase } from './renderer.js';

// Pixi v8 from the ESM CDN. Pin a version so the deployment is stable.
const PIXI_URL = 'https://esm.sh/pixi.js@8.6.6';

// Lazy-loaded Pixi module — only fetched if a PixiRenderer is constructed.
let _pixiPromise = null;
function loadPixi() {
  if (!_pixiPromise) {
    _pixiPromise = import(/* @vite-ignore */ PIXI_URL);
  }
  return _pixiPromise;
}

/**
 * Pixi implementation of the IRenderer interface (see renderer.js).
 *
 * @implements {import('./renderer.js').IRenderer}
 */
export class PixiRenderer extends RendererBase {
  constructor(canvas, sim) {
    super(canvas, sim);
    this.app = null;
    this.PIXI = null;

    // Display layers — created in initAsync().
    this.bgLayer = null;       // screen-space: background gradient/base
    this.bgGfx = null;         // single Graphics for the background fill
    this.worldLayer = null;    // world-space: cells, decorations, etc.
    this.cellsGfx = null;      // single Graphics for the cell discs

    this._destroyed = false;
  }

  /**
   * Synchronous init is a no-op; the real work happens in initAsync().
   * `app.js` awaits initAsync() before the first frame so the renderer
   * is always ready by the time draw* runs.
   */
  init() { /* see initAsync() */ }

  async initAsync() {
    const PIXI = await loadPixi();
    if (this._destroyed) return;
    this.PIXI = PIXI;

    const app = new PIXI.Application();
    await app.init({
      canvas: this.canvas,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      width: window.innerWidth,
      height: window.innerHeight,
      antialias: true,
      preference: 'webgl',
      backgroundAlpha: 1,
      background: 0x000000,
    });
    if (this._destroyed) {
      app.destroy(true);
      return;
    }
    // app.js drives the frame loop; Pixi's internal ticker would
    // double-render every frame.
    app.ticker.stop();
    this.app = app;

    this.bgLayer = new PIXI.Container();
    this.bgGfx = new PIXI.Graphics();
    this.bgLayer.addChild(this.bgGfx);

    this.worldLayer = new PIXI.Container();
    this.cellsGfx = new PIXI.Graphics();
    this.worldLayer.addChild(this.cellsGfx);

    app.stage.addChild(this.bgLayer);
    app.stage.addChild(this.worldLayer);
  }

  resize(W, H, dpr, renderScale) {
    this.W = W; this.H = H;
    this.dpr = dpr; this.renderScale = renderScale;
    if (!this.app) return;
    // Pixi owns the canvas backing-store via autoDensity + resolution.
    // We pass the *logical* size; resolution stays at min(dpr, 2). The
    // renderScale slider is honoured by mutating the renderer's
    // resolution so the GPU paints fewer texels.
    const rs = Math.max(0.125, Math.min(1, renderScale || 1));
    this.app.renderer.resolution = Math.min(dpr || 1, 2) * rs;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.app.renderer.resize(W, H);
  }

  beginFrame(/* timeMs, dt */) { /* no-op; render happens in endFrame */ }

  drawBackground(/* timeMs */) {
    if (!this.app || !this.bgGfx) return;
    const PIXI = this.PIXI;
    const W = this.W, H = this.H;
    const bg = currentBackground();

    const g = this.bgGfx;
    g.clear();
    if (bg.kind === 'gradient' && bg.topColor && bg.botColor) {
      const grad = new PIXI.FillGradient(0, 0, 0, H);
      grad.addColorStop(0, bg.topColor);
      grad.addColorStop(1, bg.botColor);
      g.rect(0, 0, W, H).fill(grad);
    } else {
      g.rect(0, 0, W, H).fill(bg.base || '#0a0612');
    }
  }

  drawCells(shapes /* , time, timeMs */) {
    if (!this.app || !this.cellsGfx) return;
    const cam = this.camera;
    // Camera transform on the world layer.
    this.worldLayer.position.set(cam.tx, cam.ty);
    this.worldLayer.scale.set(cam.scale);

    const theme = currentTheme();
    const outlineColor = (theme && theme.outline && theme.outline.color) || '#000000';
    const outlineWidth = Math.max(1, S.outlinePx || 5) / Math.max(0.0001, cam.scale);

    const g = this.cellsGfx;
    g.clear();
    for (const s of shapes) {
      const cc = cellColors(s.cell);
      const fill = (cc && cc.cytoBot) || '#d36699';
      g.circle(s.x, s.y, s.r)
        .fill(fill)
        .stroke({ color: outlineColor, width: outlineWidth, alignment: 0.5 });
    }
  }

  drawSelection(shapes /* , time */) {
    if (!this.app || !this.cellsGfx) return;
    // Phase 1: minimal selection ring drawn into the same world layer
    // as the cells. The full target-marker + flash + brighten wash
    // lands with the metaball pipeline in Phase 2.
    const sim = this.sim;
    if (!sim || !sim.selectedCells || sim.selectedCells.size === 0) return;
    const cam = this.camera;
    const theme = currentTheme();
    const ringColor = (theme && theme.outline && theme.outline.color) || '#ffffff';
    const w = Math.max(1.5, (S.outlinePx || 5) * 0.7) / Math.max(0.0001, cam.scale);
    // Draw selection rings on top of cells using the same Graphics
    // (called after drawCells inside the same frame).
    const g = this.cellsGfx;
    for (const s of shapes) {
      if (!sim.selectedCells.has(s.cell)) continue;
      g.circle(s.x, s.y, s.r * 1.30)
        .stroke({ color: ringColor, width: w, alpha: 0.85, alignment: 0.5 });
    }
  }

  drawDebug(shapes) {
    if (!this.app || !this.cellsGfx) return;
    const cam = this.camera;
    const w = 1 / Math.max(0.0001, cam.scale);
    const g = this.cellsGfx;
    for (const s of shapes) {
      g.circle(s.x, s.y, s.r)
        .stroke({ color: '#00ff66', width: w, alpha: 0.6, alignment: 0.5 });
    }
  }

  endFrame() {
    if (!this.app) return;
    this.app.renderer.render(this.app.stage);
  }

  destroy() {
    this._destroyed = true;
    if (this.app) {
      // `removeView: false` keeps the <canvas> DOM node so a hot-swap
      // back to canvas2d would still find #stage. We don't actually
      // hot-swap today (renderer changes reload), so this is defensive.
      try { this.app.destroy({ removeView: false }, { children: true, texture: true }); }
      catch (e) { console.warn('[microbes] PixiRenderer destroy:', e && e.message); }
      this.app = null;
    }
    this.bgLayer = null;
    this.bgGfx = null;
    this.worldLayer = null;
    this.cellsGfx = null;
  }
}
