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
  S, CELL_TYPES, WOBBLE_VERTS, THETA_TABLE, NUCLEUS_RATIO,
  cellColors, currentBackground, currentTheme, frac,
} from '../core/state.js';
import { shapeVertex } from '../core/shape.js';
import { RendererBase } from './renderer.js';

// Vendored Pixi v8.6.6 ESM bundle. Lives at assets/vendor/pixi.min.mjs
// (~650 KB, MIT-licensed, copied verbatim from npm `pixi.js@8.6.6` →
// `dist/pixi.min.mjs`). Vendoring removes the runtime dependency on a
// CDN — the renderer works on `file://`, on offline pages, and on
// deployments behind strict CSP. Refresh by re-extracting the
// `pixi.min.mjs` from the same npm tarball.
const PIXI_URL = new URL('../vendor/pixi.min.mjs', import.meta.url).href;

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
    this.cellsGfx = null;       // polygon fill + membrane stroke + donut + highlight + granules
    this.nucleiContainer = null;
    this.nucleiGfx = null;
    this.particlesGfx = null;
    this.selectionGfx = null;
    this.debugGfx = null;

    // metaSplit: per-pair metaball machinery. Lazy-allocated.
    this.splittingLayer = null;     // screen-space layer holding one Sprite per active pair
    this.pairBlur = null;
    this.pairThreshold = null;
    this.pairContainer = null;      // off-stage Container with [blur, threshold] filters
    this.pairPolyGfx = null;        // Graphics inside pairContainer (cleared per pair)
    this._pairPool = [];            // [{ rt, sprite }] reused across frames

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
    // Nuclei: parity with canvas2D's `filter:blur(2px)` + globalAlpha
    // 0.78 wash. The Container's filter applies in screen space, so
    // the blur strength reads as ~2 on-screen pixels regardless of
    // camera zoom — same as canvas2D.
    this.nucleiContainer = new PIXI.Container();
    this.nucleiGfx = new PIXI.Graphics();
    this.nucleiContainer.addChild(this.nucleiGfx);
    this.nucleiContainer.alpha = 0.78;
    this.nucleiContainer.filters = [new PIXI.BlurFilter({ strength: 2, quality: 3 })];
    this.particlesGfx = new PIXI.Graphics();
    this.selectionGfx = new PIXI.Graphics();
    this.debugGfx = new PIXI.Graphics();
    this.worldLayer.addChild(this.cellsGfx);
    this.worldLayer.addChild(this.nucleiContainer);
    this.worldLayer.addChild(this.particlesGfx);
    this.worldLayer.addChild(this.selectionGfx);
    this.worldLayer.addChild(this.debugGfx);

    this.splittingLayer = new PIXI.Container();

    // metaSplit machinery — off-stage filter chain that paints two
    // halves through blur+threshold to a per-pair RenderTexture.
    this.pairBlur = new PIXI.BlurFilter({ strength: 6, quality: 4 });
    this.pairThreshold = new PIXI.ColorMatrixFilter();
    this._setPairThreshold(20);
    this.pairContainer = new PIXI.Container();
    this.pairPolyGfx = new PIXI.Graphics();
    this.pairContainer.addChild(this.pairPolyGfx);
    this.pairContainer.filters = [this.pairBlur, this.pairThreshold];

    app.stage.addChild(this.bgLayer);
    app.stage.addChild(this.worldLayer);
    app.stage.addChild(this.splittingLayer);
  }

  // Map alpha through K*a - K/2 (clamps in the framebuffer to a hard
  // threshold near 0.5). RGB passes through identity. Same trick the
  // canvas2D filter spec uses, expressed as a Pixi color matrix.
  _setPairThreshold(K) {
    this.pairThreshold.matrix = [
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
    const rs = Math.max(0.125, Math.min(1, renderScale || 1));
    this.app.renderer.resolution = Math.min(dpr || 1, 2) * rs;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.app.renderer.resize(W, H);

    // Recreate every pair RT at the new canvas size and repoint its
    // sprite. Pool entries are reused across frames; only on resize
    // do we throw away the old textures.
    const PIXI = this.PIXI;
    if (PIXI && this._pairPool.length) {
      const wPx = Math.max(2, Math.floor(W));
      const hPx = Math.max(2, Math.floor(H));
      for (const entry of this._pairPool) {
        if (entry.rt) { try { entry.rt.destroy(true); } catch {} }
        entry.rt = PIXI.RenderTexture.create({ width: wPx, height: hPx, resolution: 1 });
        entry.sprite.texture = entry.rt;
        entry.sprite.width = W;
        entry.sprite.height = H;
      }
    }
  }

  // Lazy-grow the (RT, Sprite) pool used by metaSplit. Each entry
  // owns a full-canvas RenderTexture and a screen-space Sprite added
  // to splittingLayer. Sprites stay on the stage and are made
  // visible/invisible per frame.
  _getOrCreatePairEntry(idx) {
    if (idx < this._pairPool.length) return this._pairPool[idx];
    const PIXI = this.PIXI;
    const W = Math.max(2, Math.floor(this.W));
    const H = Math.max(2, Math.floor(this.H));
    const rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1 });
    const sprite = new PIXI.Sprite(rt);
    sprite.width = this.W;
    sprite.height = this.H;
    sprite.visible = false;
    this.splittingLayer.addChild(sprite);
    const entry = { rt, sprite };
    this._pairPool.push(entry);
    return entry;
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

    // Hide all pool sprites first; we'll un-hide and re-render the
    // ones we use below.
    for (const entry of this._pairPool) entry.sprite.visible = false;

    // No early-return on empty `shapes`: we still need to fall
    // through so _drawNucleiPass runs and clears nucleiGfx (the
    // partition + singleton loops below are no-ops with no shapes).
    // Otherwise old nucleus polygons stick around forever after the
    // last cell dies, which reads as a freeze in kill mode.

    // metaSplit partition: pairs (both halves of a SPLITTING cell when
    // S.metaSplit is on) vs singletons (everything else).
    const useMetaSplit = !!S.metaSplit;
    const splittingByCellId = new Map();
    const singletons = [];
    if (useMetaSplit) {
      for (const s of shapes) {
        if (s.cell.state === 'SPLITTING') {
          let arr = splittingByCellId.get(s.cell.id);
          if (!arr) { arr = []; splittingByCellId.set(s.cell.id, arr); }
          arr.push(s);
        } else {
          singletons.push(s);
        }
      }
      // Cells where only one half is in view fall back to the singleton
      // path so they still render rather than disappearing.
      for (const [id, pair] of splittingByCellId) {
        if (pair.length < 2) {
          for (const s of pair) singletons.push(s);
          splittingByCellId.delete(id);
        }
      }
    } else {
      for (const s of shapes) singletons.push(s);
    }

    // Per-pair metaball render — paints each splitting cell as a
    // single fused blob via the off-stage filter chain.
    if (splittingByCellId.size > 0) this._renderSplittingPairs(splittingByCellId, time);

    const membraneAlpha = (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55;
    const strokeWidth = Math.max(1.5, (S.outlinePx || 5) * 0.55) / Math.max(0.0001, cam.scale);

    for (const s of singletons) {
      const cc = cellColors(s.cell);
      const cytoTop = cc.cytoTop || '#ffffff';
      const cytoBot = cc.cytoBot || '#d36699';
      const nucleusHi = cc.nucleusHi || '#ffffff';
      const cType = CELL_TYPES[s.cell.type] || CELL_TYPES.neutrophil;
      const hollow = !!cType.bodyHollow;

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

      // Donut hole — RBC-style centre darkening. Pixi v8 FillGradient
      // is linear-only, so we fake the radial falloff with stacked
      // translucent concentric circles (smaller + denser inward).
      if (hollow) {
        const dr = s.r * 0.55;
        g.circle(s.x, s.y, dr * 1.00).fill({ color: cytoBot, alpha: 0.10 });
        g.circle(s.x, s.y, dr * 0.75).fill({ color: cytoBot, alpha: 0.20 });
        g.circle(s.x, s.y, dr * 0.50).fill({ color: cytoBot, alpha: 0.36 });
        g.circle(s.x, s.y, dr * 0.25).fill({ color: cytoBot, alpha: 0.55 });
      }

      // Top-left highlight — same stacked-circles trick as the donut.
      // Centre offset matches canvas2D / WebGL2 (-0.35r, -0.45r) so
      // the visual lift sits in the same spot across renderers.
      const hx = s.x - s.r * 0.35;
      const hy = s.y - s.r * 0.45;
      const hr = s.r * 0.75;
      g.circle(hx, hy, hr * 1.00).fill({ color: nucleusHi, alpha: 0.05 });
      g.circle(hx, hy, hr * 0.70).fill({ color: nucleusHi, alpha: 0.10 });
      g.circle(hx, hy, hr * 0.45).fill({ color: nucleusHi, alpha: 0.20 });
      g.circle(hx, hy, hr * 0.22).fill({ color: nucleusHi, alpha: 0.32 });

      // Granules — small darker dots scattered inside the cell. Same
      // placement formula as the canvas2D renderer's _drawGranules so
      // the dotted "inner texture" matches across renderers. Position
      // is constrained to rRel ∈ [0.05, 0.90] of the cell radius, so
      // granules stay inside the wobble polygon without explicit
      // clipping (the slight wobble at the rim pulls them inward).
      const Ng = cType.granules || 0;
      if (Ng > 0) {
        const cell = s.cell;
        const seed = cell.id * 9.7 + (cell.wobbleSeed || 0);
        const isBig = cell.type === 'basophil';
        const baseSize = isBig ? 0.115 : 0.05;
        const sizeJitter = isBig ? 0.05 : 0.04;
        const granAlpha = isBig ? 0.85 : 0.55;
        const granColor = cc.nucleus || cytoBot;
        for (let i = 0; i < Ng; i++) {
          const ang = frac(seed * 1.3 + i * 0.61) * Math.PI * 2;
          const rRel = 0.05 + 0.85 * Math.sqrt(frac(seed + i * 0.317));
          const wob = 0.04 * Math.sin(time * 0.5 + i + seed);
          const wx = s.x + Math.cos(ang) * s.r * (rRel + wob);
          const wy = s.y + Math.sin(ang) * s.r * (rRel + wob);
          const gr = s.r * (baseSize + sizeJitter * frac(seed * 1.7 + i * 0.13));
          g.circle(wx, wy, gr).fill({ color: granColor, alpha: granAlpha });
        }
      }
    }

    // Nuclei pass: iterates ALL cells (independent of singletons /
    // splitting partition above), since the splitting nucleus
    // animation is its own thing.
    this._drawNucleiPass(time);
  }

  // Per-kind nucleus rendering, ported from canvas2D's _drawNucleus.
  // The whole pass renders into nucleiContainer which carries the
  // 2-px BlurFilter + alpha 0.78 wash for parity with canvas2D.
  _drawNucleiPass(time) {
    const ng = this.nucleiGfx;
    ng.clear();
    if (!this.sim || !this.sim.cells.length) return;
    const theme = currentTheme();
    const outlineColor = (theme && theme.outline && theme.outline.color) || '#000000';
    const lw = Math.max(2, (S.outlinePx || 5) * 0.6) / Math.max(0.0001, this.camera.scale);
    const t = time;
    for (const c of this.sim.cells) {
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      if (!type.nucleus || type.nucleus.kind === 'none') continue;
      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        const half = c.r * (0.1 + p * 1.0);
        const a = c.splitAngle;
        const cx = Math.cos(a) * half, cy = Math.sin(a) * half;
        const rr = c.r * NUCLEUS_RATIO * (1 - p * 0.2);
        const wob = 1.5 * (1 - p);
        this._drawNucleusShape(c,
          c.x - cx + Math.sin(t + c.phase) * wob,
          c.y - cy + Math.cos(t + c.phase * 0.7) * wob,
          rr, outlineColor, lw);
        if (p > 0.04) {
          this._drawNucleusShape(c,
            c.x + cx + Math.sin(t + c.phase + 1.7) * wob,
            c.y + cy + Math.cos(t + c.phase * 0.7 + 1.7) * wob,
            rr, outlineColor, lw);
        }
      } else {
        const wx = c.x + Math.sin(t + c.phase) * 1.8;
        const wy = c.y + Math.cos(t + c.phase * 0.7) * 1.8;
        this._drawNucleusShape(c, wx, wy, c.r * NUCLEUS_RATIO, outlineColor, lw);
      }
    }
  }

  _drawNucleusShape(cell, x, y, r, outlineColor, lw) {
    const g = this.nucleiGfx;
    const cc = cellColors(cell);
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    let kind = type.nucleus.kind;
    if (kind === 'round-small') { kind = 'round'; r *= 0.7; }
    const nucColor = cc.nucleus || '#1d1c5a';
    const nucHi = cc.nucleusHi || '#dee8ff';
    const cytoBot = cc.cytoBot || '#6d8df0';

    if (kind === 'kidney') {
      // Pixi v8 Graphics has no destination-out; the bite is faked
      // with a cytoBot-coloured circle on top of the main fill, which
      // approximates the cytoplasm peeking through the dent.
      const biteAngle = cell.phase || 0;
      const biteOff = r * 0.6;
      const biteR = r * 0.85;
      const bx = x + Math.cos(biteAngle) * biteOff;
      const by = y + Math.sin(biteAngle) * biteOff;
      g.circle(x, y, r).fill({ color: nucColor });
      g.circle(bx, by, biteR).fill({ color: cytoBot });
      g.circle(x, y, r).stroke({ color: outlineColor, width: lw });
      g.circle(x - r * 0.35, y - r * 0.4, r * 0.18).fill({ color: nucHi });
    } else if (kind === 'bilobed') {
      const sep = r * 0.7;
      const lr = r * 0.7;
      const ang = cell.phase || 0;
      const ox = Math.cos(ang) * sep * 0.5;
      const oy = Math.sin(ang) * sep * 0.5;
      g.circle(x - ox, y - oy, lr).fill({ color: nucColor });
      g.circle(x + ox, y + oy, lr).fill({ color: nucColor });
      g.circle(x - ox, y - oy, lr).stroke({ color: outlineColor, width: lw });
      g.circle(x + ox, y + oy, lr).stroke({ color: outlineColor, width: lw });
      g.circle(x - ox - lr * 0.35, y - oy - lr * 0.35, lr * 0.16).fill({ color: nucHi });
    } else if (kind === 'multilobed') {
      const lr = r * 0.55;
      const baseAng = cell.phase || 0;
      const radius = r * 0.65;
      const lobes = [];
      for (let i = 0; i < 4; i++) {
        const a = baseAng + (i - 1.5) * 0.7;
        lobes.push({ x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius * 0.4 });
      }
      for (const l of lobes) g.circle(l.x, l.y, lr).fill({ color: nucColor });
      for (const l of lobes) g.circle(l.x, l.y, lr).stroke({ color: outlineColor, width: lw });
      g.circle(lobes[0].x - lr * 0.35, lobes[0].y - lr * 0.35, lr * 0.18).fill({ color: nucHi });
    } else {
      // round (default)
      g.circle(x, y, r).fill({ color: nucColor }).stroke({ color: outlineColor, width: lw });
      g.circle(x - r * 0.35, y - r * 0.4, r * 0.24).fill({ color: nucHi });
    }
  }

  // metaSplit: render each splitting pair through the off-stage
  // [BlurFilter, ColorMatrixFilter] chain into its own RenderTexture,
  // then display via a Sprite tinted with the cell's cytoBot. The
  // splittingLayer sits above worldLayer so the merged blob covers
  // any bleed from the singleton pass under it.
  _renderSplittingPairs(splittingByCellId, time) {
    const PIXI = this.PIXI;
    const cam = this.camera;
    const renderer = this.app.renderer;

    // pairContainer carries the camera transform so polygons in
    // world space map to screen pixels in the RT (which is screen-
    // sized at resolution 1).
    this.pairContainer.position.set(cam.tx, cam.ty);
    this.pairContainer.scale.set(cam.scale);

    let idx = 0;
    for (const [, pair] of splittingByCellId) {
      const c = pair[0].cell;
      const cType = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const fld = cType.field || { blur: 6, contrast: 20 };
      const cc = cellColors(c);

      // Polygons for both halves, in world space.
      this.pairPolyGfx.clear();
      for (const s of pair) {
        const pts = new Array(WOBBLE_VERTS * 2);
        for (let i = 0; i < WOBBLE_VERTS; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], time);
          pts[i * 2] = v.x;
          pts[i * 2 + 1] = v.y;
        }
        this.pairPolyGfx.poly(pts).fill(0xffffff);
      }

      // Configure per-type field params on the shared filter chain.
      this.pairBlur.strength = fld.blur;
      this._setPairThreshold(fld.contrast);

      const entry = this._getOrCreatePairEntry(idx++);
      renderer.render({ container: this.pairContainer, target: entry.rt, clear: true });

      entry.sprite.tint = cc.cytoBot || '#d36699';
      entry.sprite.alpha = 1;
      entry.sprite.visible = true;
    }
  }

  drawParticles(particles /* , time, timeMs */) {
    if (!this.app || !this.particlesGfx) return;
    this.particlesGfx.clear();
    if (!particles || !particles.length) return;
    const g = this.particlesGfx;
    for (const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      g.circle(p.x, p.y, p.r).fill({ color: p.color, alpha: a });
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
    for (const entry of this._pairPool) {
      if (entry.rt) { try { entry.rt.destroy(true); } catch {} }
    }
    this._pairPool = [];
    if (this.app) {
      try { this.app.destroy({ removeView: false }, { children: true, texture: true }); }
      catch (e) { console.warn('[microbes] PixiRenderer destroy:', e && e.message); }
      this.app = null;
    }
    this.bgLayer = null;
    this.bgGfx = null;
    this.worldLayer = null;
    this.cellsGfx = null;
    this.nucleiContainer = null;
    this.nucleiGfx = null;
    this.particlesGfx = null;
    this.selectionGfx = null;
    this.debugGfx = null;
    this.splittingLayer = null;
    this.pairBlur = null;
    this.pairThreshold = null;
    this.pairContainer = null;
    this.pairPolyGfx = null;
  }
}
