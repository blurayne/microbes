// Microbes — PixiJS renderer.
//
// Phase 2 of the Pixi migration: metaball mask + outline (8-direction
// blits + glow-theme halo) + per-type tinted cytoplasm fill +
// membrane stroke. Pixi v8 is loaded from an ESM CDN so the project
// keeps its no-build-step deployment story.
//
// Rendering pipeline per frame:
//   1. drawBackground — gradient or flat base fill on `bgLayer`.
//   2. Build `unionMaskRT` and `fillRT` per type group. White
//      polygons in target-pixel space → BlurFilter + ColorMatrixFilter
//      (alpha threshold) → scratchRT. Then composite scratchRT twice:
//      once additively into `unionMaskRT` (white silhouette), once
//      tinted with the type's `cytoBot` colour into `fillRT`.
//   3. Outline = 8 offset Sprites of `unionMaskRT` tinted
//      `theme.outline.color`. Glow themes prepend a blurred glow
//      sprite tinted `theme.outline.glow`.
//   4. Cytoplasm = Sprite of `fillRT` masked by a Sprite of
//      `unionMaskRT` (alpha mask via `sprite.mask = maskSprite`).
//   5. Membrane stroke — wobbly polygon outlines drawn directly into
//      `worldLayer` (camera-transformed) by `Graphics.poly().stroke()`.
//
// Out of scope here (next commits):
//   - bodyHollow donut variant for RBCs.
//   - Inner highlight (top-left soft glow). Per-cell radial cytoplasm
//     gradient (currently uniform per type) — can be added later via
//     pre-baked gradient textures or by switching `tint` to a
//     per-cell value.
//   - Granules, decorations (spikes / tendrils / Y-receptors /
//     flagellum / drips / legs / fuzz), nuclei, cartoon faces, target
//     marker, flash overlay.
//   - Background extras: spots, vignette, agar rings, cybergrid,
//     anatomy decor, RBC silhouettes.

import {
  S, CELL_TYPES, WOBBLE_VERTS, THETA_TABLE, DOWNSAMPLE,
  cellColors, currentBackground, currentTheme,
} from '../core/state.js';
import { shapeVertex, splitVirtualCenters } from '../core/shape.js';
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

    // Display layers (added to app.stage in init).
    this.bgLayer = null;
    this.bgGfx = null;
    this.outlineLayer = null;
    this.outlineSprites = [];   // 8 sprites, tinted outline colour, at offsets
    this.glowSprite = null;     // optional 9th sprite for glow themes
    this.fillSprite = null;     // displays fillRT
    this.fillMaskSprite = null; // unionMaskRT used as alpha mask for fillSprite
    this.worldLayer = null;
    this.membraneGfx = null;
    this.selectionGfx = null;
    this.debugGfx = null;

    // Metaball machinery (created in init, RTs allocated in resize).
    this.polyContainer = null;
    this.polyGfx = null;
    this.scratchSprite = null;
    this.blurFilter = null;
    this.thresholdFilter = null;
    this.unionMaskRT = null;
    this.scratchRT = null;
    this.fillRT = null;

    // Empty container used to clear an RT cheaply via `clear: true`.
    this._empty = null;

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
    // Caller controls the backend choice; Pixi defaults to 'webgl' if
    // preference is omitted, and falls through to WebGL2 if WebGPU
    // isn't available when 'webgpu' is requested.
    if (this.preference) initOpts.preference = this.preference;
    await app.init(initOpts);
    if (this._destroyed) {
      app.destroy(true);
      return;
    }
    app.ticker.stop();
    this.app = app;

    // --- Display layers ---
    this.bgLayer = new PIXI.Container();
    this.bgGfx = new PIXI.Graphics();
    this.bgLayer.addChild(this.bgGfx);

    this.outlineLayer = new PIXI.Container();
    this.glowSprite = new PIXI.Sprite();
    this.glowSprite.visible = false;
    this.outlineLayer.addChild(this.glowSprite);
    for (let i = 0; i < 8; i++) {
      const s = new PIXI.Sprite();
      this.outlineSprites.push(s);
      this.outlineLayer.addChild(s);
    }

    this.fillSprite = new PIXI.Sprite();
    this.fillMaskSprite = new PIXI.Sprite();
    this.fillMaskSprite.renderable = false; // used only as alpha mask
    this.fillSprite.addChild(this.fillMaskSprite);
    this.fillSprite.mask = this.fillMaskSprite;

    this.worldLayer = new PIXI.Container();
    this.membraneGfx = new PIXI.Graphics();
    this.selectionGfx = new PIXI.Graphics();
    this.debugGfx = new PIXI.Graphics();
    this.worldLayer.addChild(this.membraneGfx);
    this.worldLayer.addChild(this.selectionGfx);
    this.worldLayer.addChild(this.debugGfx);

    app.stage.addChild(this.bgLayer);
    app.stage.addChild(this.outlineLayer);
    app.stage.addChild(this.fillSprite);
    app.stage.addChild(this.worldLayer);

    // --- Metaball offscreen machinery ---
    this.polyContainer = new PIXI.Container();
    this.polyGfx = new PIXI.Graphics();
    this.polyContainer.addChild(this.polyGfx);

    this.blurFilter = new PIXI.BlurFilter({ strength: 6, quality: 4 });
    this.thresholdFilter = new PIXI.ColorMatrixFilter();
    this._setThresholdContrast(this.thresholdFilter, 22);
    this.polyContainer.filters = [this.blurFilter, this.thresholdFilter];

    this.scratchSprite = new PIXI.Sprite();

    this._empty = new PIXI.Container();
  }

  // Map alpha through `K*a - K/2` to threshold near 0.5 with sharpness K.
  // RGB channels pass through untouched. The framebuffer clamps the
  // output to [0,1] per-channel after the matrix multiply, which is
  // exactly the threshold behaviour we want.
  _setThresholdContrast(filter, K) {
    filter.matrix = [
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, K, -K * 0.5,
    ];
  }

  resize(W, H, dpr, renderScale) {
    this.W = W; this.H = H;
    this.dpr = dpr; this.renderScale = renderScale;
    if (!this.app) return;
    const PIXI = this.PIXI;
    const rs = Math.max(0.125, Math.min(1, renderScale || 1));
    this.app.renderer.resolution = Math.min(dpr || 1, 2) * rs;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.app.renderer.resize(W, H);

    // Recreate render textures sized to canvas × DOWNSAMPLE so the
    // metaball blur has the same perceived strength as canvas2D.
    const ow = Math.max(2, Math.floor(W * DOWNSAMPLE * rs));
    const oh = Math.max(2, Math.floor(H * DOWNSAMPLE * rs));
    if (this.unionMaskRT) this.unionMaskRT.destroy(true);
    if (this.scratchRT) this.scratchRT.destroy(true);
    if (this.fillRT) this.fillRT.destroy(true);
    this.unionMaskRT = PIXI.RenderTexture.create({ width: ow, height: oh, resolution: 1 });
    this.scratchRT = PIXI.RenderTexture.create({ width: ow, height: oh, resolution: 1 });
    this.fillRT = PIXI.RenderTexture.create({ width: ow, height: oh, resolution: 1 });

    // Repoint sprites at the freshly-created textures.
    this.scratchSprite.texture = this.scratchRT;
    this.fillSprite.texture = this.fillRT;
    this.fillMaskSprite.texture = this.unionMaskRT;
    this.glowSprite.texture = this.unionMaskRT;
    for (const s of this.outlineSprites) s.texture = this.unionMaskRT;

    // Display sprites span the full canvas; sprite.width/height
    // multiplies scale by (target / texture). RT is at half-res so
    // scale ends up at (1/DOWNSAMPLE).
    this.fillSprite.width = W;
    this.fillSprite.height = H;
    this.fillMaskSprite.width = W;
    this.fillMaskSprite.height = H;
    this.glowSprite.width = W;
    this.glowSprite.height = H;
    for (const s of this.outlineSprites) {
      s.width = W;
      s.height = H;
    }
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
    if (!this.app || !this.unionMaskRT) return;
    const PIXI = this.PIXI;
    const cam = this.camera;
    const renderer = this.app.renderer;
    const W = this.W;
    const ow = this.unionMaskRT.width;
    const sx = ow / W;
    const cs = cam.scale, cTx = cam.tx, cTy = cam.ty;

    // World-layer transform (membrane / selection / debug live here).
    this.worldLayer.position.set(cam.tx, cam.ty);
    this.worldLayer.scale.set(cam.scale);

    // Always clear the RTs first — covers the empty-screen case where
    // no shapes are visible (otherwise stale content would persist).
    renderer.render({ container: this._empty, target: this.unionMaskRT, clear: true });
    renderer.render({ container: this._empty, target: this.fillRT, clear: true });

    // ---- Outline tints ----
    const theme = currentTheme();
    const outlineColor = (theme && theme.outline && theme.outline.color) || '#000000';
    const px = Math.max(1, S.outlinePx || 5);
    const offsets = [
      [-px, 0], [px, 0], [0, -px], [0, px],
      [-px, -px], [px, px], [-px, px], [px, -px],
    ];
    for (let i = 0; i < this.outlineSprites.length; i++) {
      const s = this.outlineSprites[i];
      const [dx, dy] = offsets[i];
      s.tint = outlineColor;
      s.x = dx; s.y = dy;
      s.alpha = 1;
      s.visible = shapes.length > 0;
    }
    // Glow halo for themes that want one.
    if (theme && theme.outline && theme.outline.glow && shapes.length > 0) {
      this.glowSprite.tint = theme.outline.glow;
      this.glowSprite.x = 0; this.glowSprite.y = 0;
      this.glowSprite.alpha = 0.85;
      this.glowSprite.visible = true;
      const glowBlur = (theme.outline.glowBlur || 14);
      this.glowSprite.filters = this.glowSprite.filters && this.glowSprite.filters.length
        ? this.glowSprite.filters
        : [new PIXI.BlurFilter({ strength: glowBlur, quality: 3 })];
      // Update strength on the existing filter if it's already there.
      const f = this.glowSprite.filters[0];
      if (f && 'strength' in f) f.strength = glowBlur;
    } else {
      this.glowSprite.visible = false;
    }

    // Membrane / selection / debug all redraw fresh each frame.
    this.membraneGfx.clear();
    this.selectionGfx.clear();
    this.debugGfx.clear();
    this.fillSprite.visible = shapes.length > 0;

    if (shapes.length === 0) return;

    // ---- Per-type pass: white polys → blur+threshold → scratchRT,
    //      then composite into unionMaskRT (white) and fillRT (tinted).
    const groups = {};
    for (const s of shapes) (groups[s.cell.type] ||= []).push(s);

    for (const [typeKey, group] of Object.entries(groups)) {
      const type = CELL_TYPES[typeKey] || CELL_TYPES.neutrophil;
      const field = type.field || { blur: 6, contrast: 20 };

      // Build all of this type's polygons in target-pixel space.
      this.polyGfx.clear();
      for (const s of group) {
        const pts = new Array(WOBBLE_VERTS * 2);
        for (let i = 0; i < WOBBLE_VERTS; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], time);
          pts[i * 2] = (v.x * cs + cTx) * sx;
          pts[i * 2 + 1] = (v.y * cs + cTy) * sx;
        }
        this.polyGfx.poly(pts).fill(0xffffff);
      }

      // Configure the per-type filter chain.
      this.blurFilter.strength = field.blur;
      this._setThresholdContrast(this.thresholdFilter, field.contrast);

      // Render filtered polys to scratchRT.
      renderer.render({ container: this.polyContainer, target: this.scratchRT, clear: true });

      // Composite scratchRT → unionMaskRT (white silhouette, additive).
      this.scratchSprite.tint = 0xffffff;
      this.scratchSprite.alpha = 1;
      this.scratchSprite.blendMode = 'add';
      renderer.render({ container: this.scratchSprite, target: this.unionMaskRT, clear: false });

      // Composite scratchRT → fillRT (tinted with cytoBot).
      const cc = (type.colors) || { cytoBot: '#d36699' };
      this.scratchSprite.tint = cc.cytoBot || '#d36699';
      this.scratchSprite.blendMode = 'normal';
      renderer.render({ container: this.scratchSprite, target: this.fillRT, clear: false });
    }

    // ---- Membrane stroke (world-space polygon trace) ----
    const membraneAlpha = (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55;
    if (membraneAlpha > 0) {
      const lw = Math.max(1.5, (S.outlinePx || 5) * 0.55) / Math.max(0.0001, cam.scale);
      const stroke = { color: outlineColor, width: lw, alpha: membraneAlpha, alignment: 0.5 };
      for (const s of shapes) {
        const pts = new Array(WOBBLE_VERTS * 2);
        for (let i = 0; i < WOBBLE_VERTS; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], time);
          pts[i * 2] = v.x;
          pts[i * 2 + 1] = v.y;
        }
        this.membraneGfx.poly(pts).stroke(stroke);
      }
    }
  }

  drawSelection(shapes /* , time */) {
    if (!this.app || !this.selectionGfx) return;
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

  destroy() {
    this._destroyed = true;
    if (this.unionMaskRT) { try { this.unionMaskRT.destroy(true); } catch {} this.unionMaskRT = null; }
    if (this.scratchRT)   { try { this.scratchRT.destroy(true); } catch {} this.scratchRT = null; }
    if (this.fillRT)      { try { this.fillRT.destroy(true); } catch {} this.fillRT = null; }
    if (this.app) {
      try { this.app.destroy({ removeView: false }, { children: true, texture: true }); }
      catch (e) { console.warn('[microbes] PixiRenderer destroy:', e && e.message); }
      this.app = null;
    }
    this.bgLayer = null;
    this.bgGfx = null;
    this.outlineLayer = null;
    this.outlineSprites = [];
    this.glowSprite = null;
    this.fillSprite = null;
    this.fillMaskSprite = null;
    this.worldLayer = null;
    this.membraneGfx = null;
    this.selectionGfx = null;
    this.debugGfx = null;
    this.polyContainer = null;
    this.polyGfx = null;
    this.scratchSprite = null;
    this.blurFilter = null;
    this.thresholdFilter = null;
    this._empty = null;
  }
}
