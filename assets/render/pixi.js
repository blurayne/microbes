// Microbes — PixiJS renderer.
//
// Implements the IRenderer interface (renderer.js) using PixiJS v8.
// Pixi is loaded from an ESM CDN so the project keeps its no-build-step
// deployment story.
//
// Rendering style: clean per-cell rendering matching the WebGL2 look
// (no metaball merging, no dark outline halo). Each cell is drawn as
// an independent wobble polygon with a vertical linear gradient
// (cytoTop → cytoBot) for the cytoplasm, and a membrane stroke in
// the cell's own cytoBot colour gated by S.membraneIntensity.
//
// Out of scope (deferred follow-up commits):
//   - Cytoplasm radial gradient + per-cell top-left highlight + RBC
//     donut hole. The vertical linear gradient here is a close
//     approximation of WebGL2's radial+top-lift effect.
//   - Granules, decorations, nuclei, cartoon faces, target marker,
//     flash overlay, debug overlay.
//   - Background extras (spots, vignette, agar rings, cybergrid,
//     anatomy decor, RBC silhouettes).

import {
  S, CELL_TYPES, WOBBLE_VERTS, THETA_TABLE,
  cellColors, currentBackground, currentTheme,
} from '../core/state.js';
import { shapeVertex } from '../core/shape.js';
import { RendererBase } from './renderer.js';

const PIXI_URL = 'https://esm.sh/pixi.js@8.6.6';

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
  constructor(canvas, sim, opts = {}) {
    super(canvas, sim);
    this.app = null;
    this.PIXI = null;
    // 'webgl' | 'webgpu' | undefined (Pixi's default = 'webgl').
    this.preference = opts.preference || undefined;

    this.bgLayer = null;
    this.bgGfx = null;
    this.worldLayer = null;
    this.cellsGfx = null;
    this.selectionGfx = null;
    this.debugGfx = null;

    this._destroyed = false;
  }

  init() { /* see initAsync() */ }

  async initAsync() {
    const PIXI = await loadPixi();
    if (this._destroyed) return;
    this.PIXI = PIXI;

    const app = new PIXI.Application();
    const initOpts = {
      canvas: this.canvas,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      width: window.innerWidth,
      height: window.innerHeight,
      antialias: true,
      backgroundAlpha: 1,
      background: 0x000000,
    };
    if (this.preference) initOpts.preference = this.preference;
    await app.init(initOpts);
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
    this.selectionGfx = new PIXI.Graphics();
    this.debugGfx = new PIXI.Graphics();
    this.worldLayer.addChild(this.cellsGfx);
    this.worldLayer.addChild(this.selectionGfx);
    this.worldLayer.addChild(this.debugGfx);

    app.stage.addChild(this.bgLayer);
    app.stage.addChild(this.worldLayer);
  }

  resize(W, H, dpr, renderScale) {
    this.W = W; this.H = H;
    this.dpr = dpr; this.renderScale = renderScale;
    if (!this.app) return;
    const rs = Math.max(0.125, Math.min(1, renderScale || 1));
    this.app.renderer.resolution = Math.min(dpr || 1, 2) * rs;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.app.renderer.resize(W, H);
  }

  beginFrame(/* timeMs, dt */) { /* render happens in endFrame */ }

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

  drawCells(shapes, time /* , timeMs */) {
    if (!this.app || !this.cellsGfx) return;
    const PIXI = this.PIXI;
    const cam = this.camera;
    this.worldLayer.position.set(cam.tx, cam.ty);
    this.worldLayer.scale.set(cam.scale);

    const g = this.cellsGfx;
    g.clear();
    if (!shapes.length) return;

    const membraneAlpha = (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55;
    const strokeWidth = Math.max(1.5, (S.outlinePx || 5) * 0.55) / Math.max(0.0001, cam.scale);

    for (const s of shapes) {
      const cc = cellColors(s.cell);
      const cytoTop = cc.cytoTop || '#ffffff';
      const cytoBot = cc.cytoBot || '#d36699';

      // Build wobble polygon vertices in world space.
      const pts = new Array(WOBBLE_VERTS * 2);
      for (let i = 0; i < WOBBLE_VERTS; i++) {
        const v = shapeVertex(s, THETA_TABLE[i], time);
        pts[i * 2] = v.x;
        pts[i * 2 + 1] = v.y;
      }

      // Vertical linear gradient — close enough to WebGL2's radial +
      // top-left lift for a clean per-cell look. Pixi v8's stable
      // FillGradient constructor is the 4-arg linear form.
      const grad = new PIXI.FillGradient(s.x, s.y - s.r, s.x, s.y + s.r);
      grad.addColorStop(0, cytoTop);
      grad.addColorStop(1, cytoBot);

      g.poly(pts).fill(grad);
      if (membraneAlpha > 0) {
        g.poly(pts).stroke({
          color: cytoBot,
          width: strokeWidth,
          alpha: membraneAlpha,
          alignment: 0.5,
        });
      }
    }
  }

  drawSelection(shapes /* , time */) {
    if (!this.app || !this.selectionGfx) return;
    this.selectionGfx.clear();
    const sim = this.sim;
    if (!sim || !sim.selectedCells || sim.selectedCells.size === 0) return;
    const cam = this.camera;
    const theme = currentTheme();
    const ringColor = (theme && theme.outline && theme.outline.color) || '#ffffff';
    const w = Math.max(1.5, (S.outlinePx || 5) * 0.7) / Math.max(0.0001, cam.scale);
    for (const s of shapes) {
      if (!sim.selectedCells.has(s.cell)) continue;
      this.selectionGfx
        .circle(s.x, s.y, s.r * 1.30)
        .stroke({ color: ringColor, width: w, alpha: 0.85, alignment: 0.5 });
    }
  }

  drawDebug(shapes) {
    if (!this.app || !this.debugGfx) return;
    this.debugGfx.clear();
    const cam = this.camera;
    const w = 1 / Math.max(0.0001, cam.scale);
    for (const s of shapes) {
      this.debugGfx
        .circle(s.x, s.y, s.r)
        .stroke({ color: '#00ff66', width: w, alpha: 0.6, alignment: 0.5 });
    }
  }

  endFrame() {
    if (!this.app) return;
    this.app.renderer.render(this.app.stage);
  }

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() {
    if (!this.app || !this.app.renderer) return 'pixi';
    const t = this.app.renderer.type;
    return 'pixi/' + (t || 'webgl');
  }

  destroy() {
    this._destroyed = true;
    if (this.app) {
      try { this.app.destroy({ removeView: false }, { children: true, texture: true }); }
      catch (e) { console.warn('[microbes] PixiRenderer destroy:', e && e.message); }
      this.app = null;
    }
    this.bgLayer = null;
    this.bgGfx = null;
    this.worldLayer = null;
    this.cellsGfx = null;
    this.selectionGfx = null;
    this.debugGfx = null;
  }
}
