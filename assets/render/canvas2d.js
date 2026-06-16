// Microbes — Canvas2D renderer.
//
// All Canvas2D-specific drawing lives here. The class implements the renderer
// interface used by `app.js`: init / resize / setCamera / drawBackground /
// drawCells / drawSelection / drawDebug. The `Sim` instance owns the cells
// and camera; the renderer reads from it but never mutates it.

import {
  S, FACE, CELL_TYPES, NUCLEUS_RATIO, WOBBLE_VERTS, THETA_TABLE,
  cellColors, currentTheme, currentBackground, currentBgLayers, currentHighlightColor, hexToRgba, frac,
} from '../core/state.js';
import { shapeVertex, splitVirtualCenters } from '../core/shape.js';
import { effectiveMouthKind } from '../core/sim-faces.js';
import { rbcWorldPos } from '../core/vessels.js';
import { RendererBase } from './renderer.js';
import { URL_OVERRIDES } from '../core/url-overrides.js';
import { loadTexture } from '../core/texture-loader.js';

// Rendertest translucent mode: skip the opaque black fill in
// drawBackground so the canvas's native transparency shows through.
// Canvas2D contexts default to `alpha: true`, no constructor change
// needed.
const RT_TRANSLUCENT = !!URL_OVERRIDES.translucent;

/**
 * Canvas2D implementation of the IRenderer interface (see renderer.js).
 *
 * @implements {import('./renderer.js').IRenderer}
 */
export class Canvas2DRenderer extends RendererBase {
  constructor(canvas, sim) {
    super(canvas, sim);
    this.ctx = canvas.getContext('2d');
    // Lazy-allocated scratch canvas used by the per-splitting-pair
    // metaball renderer (S.metaSplit). Resized per pair per frame.
    this._scratch = null;
    this._scratchCtx = null;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.renderScale = 1;

    // Drifting light spots for the background — same one-time random seed.
    this.SPOTS = [];
    for (let i = 0; i < 7; i++) {
      this.SPOTS.push({
        ax: 0.15 + Math.random() * 0.7,
        ay: 0.15 + Math.random() * 0.7,
        ox1: 0.12 + Math.random() * 0.18,
        oy1: 0.12 + Math.random() * 0.18,
        ox2: 0.04 + Math.random() * 0.08,
        oy2: 0.04 + Math.random() * 0.08,
        w1: 0.10 + Math.random() * 0.18,
        w2: 0.05 + Math.random() * 0.10,
        phx: Math.random() * Math.PI * 2,
        phy: Math.random() * Math.PI * 2,
        r: 0.32 + Math.random() * 0.30,
      });
    }
  }

  resize(W, H, dpr, renderScale) {
    this.W = W; this.H = H;
    this.dpr = dpr; this.renderScale = renderScale;
    const rs = renderScale;
    this.canvas.width = Math.max(2, Math.floor(W * dpr * rs));
    this.canvas.height = Math.max(2, Math.floor(H * dpr * rs));
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.ctx.setTransform(dpr * rs, 0, 0, dpr * rs, 0, 0);
  }

  // The renderer reads camera/W/H from the Sim each frame.
  get camera() { return this.sim.camera; }

  withCameraCtx(fn) {
    const ctx = this.ctx;
    const cam = this.camera;
    // resize() seeds the ctx with `setTransform(dpr*rs, 0, 0, dpr*rs, 0, 0)`
    // — the DPR + renderScale baseline that drawBackground composes onto
    // via `ctx.transform(...)`. Because `ctx.setTransform` REPLACES the
    // matrix (vs. `ctx.transform` which multiplies), we must bake k = dpr*rs
    // into every entry here or the cell pass loses DPR scaling — cells
    // would shrink to 1/dpr and shift toward the top-left while the
    // bg fills the canvas at full size. Forward transform:
    //   screen = R(θ) · (world · scale) + (tx, ty)
    // composed with DPR by left-multiplication.
    const k = (this.dpr || 1) * (this.renderScale || 1);
    ctx.save();
    if (cam.rotation === 0) {
      ctx.setTransform(cam.scale * k, 0, 0, cam.scale * k, cam.tx * k, cam.ty * k);
    } else {
      const co = Math.cos(cam.rotation), si = Math.sin(cam.rotation);
      ctx.setTransform(
        cam.scale * co * k,  cam.scale * si * k,
        -cam.scale * si * k, cam.scale * co * k,
        cam.tx * k, cam.ty * k);
    }
    try { fn(); } finally { ctx.restore(); }
  }

  beginFrame() { /* no-op for Canvas2D */ }
  endFrame() { /* no-op for Canvas2D */ }

  // Cached CanvasPattern lookup for the tissue bg (and any future
  // image-tiled bgs). Lazy: kicks off the async fetch on first
  // call, returns null until decode completes. The result is a
  // repeat-pattern bound to this renderer's 2D context. Cache
  // key is `${url}@${scale}` so changing S.tissueScale invalidates
  // the cached pattern; the next frame rebuilds at the new
  // resolution.
  _tissuePatternFor(url) {
    if (!this._tissuePatternCache) this._tissuePatternCache = new Map();
    const cache = this._tissuePatternCache;
    const scale = (typeof S.tissueScale === 'number') ? S.tissueScale : 1;
    const clampedScale = Math.max(0.1, Math.min(1.0, scale));
    const key = `${url}@${clampedScale}`;
    if (cache.has(key)) {
      const v = cache.get(key);
      if (v === 'pending' || v === 'failed') return null;
      return v.pat || null;             // unwrap { pat, img }
    }
    cache.set(key, 'pending');
    loadTexture(url).then((img) => {
      try {
        let src = img;
        // Downsample the source image when scale < 1. The fillRect
        // covers the same world rect, so the visible tile is
        // unchanged in screen space; only the per-pixel sampling
        // cost drops because the GPU/CPU is reading from a smaller
        // texture. 0.1 floor matches the slider clamp; below that
        // the tile reads as a uniform blur.
        if (clampedScale < 1 && typeof document !== 'undefined') {
          // loadTexture prefers createImageBitmap which exposes
          // .width / .height; HTMLImageElement fallback has
          // .naturalWidth / .naturalHeight. Take whichever is
          // defined so the dimensions don't read as NaN (which
          // would give the offscreen canvas width: 0 and result
          // in createPattern returning null — the disappearing
          // bg bug PR-after-#263 fixed).
          const srcW = img.naturalWidth  || img.width  || 0;
          const srcH = img.naturalHeight || img.height || 0;
          const w = Math.max(1, Math.floor(srcW * clampedScale));
          const h = Math.max(1, Math.floor(srcH * clampedScale));
          const off = document.createElement('canvas');
          off.width = w;
          off.height = h;
          const oc = off.getContext('2d');
          if (oc) {
            oc.drawImage(img, 0, 0, w, h);
            src = off;
          }
        }
        const pat = this.ctx.createPattern(src, 'repeat');
        // Stash the source alongside the pattern so eviction can
        // null the .src + release any GPU-backed allocation. Some
        // browsers retain a hardware-accelerated CanvasPattern for
        // the lifetime of the source image even when nothing else
        // references the pattern; explicitly clearing the source
        // forces the compositor to drop it on the next frame.
        cache.set(key, pat ? { pat, img: src } : 'failed');
      } catch (_) {
        cache.set(key, 'failed');
      }
    }).catch(() => { cache.set(key, 'failed'); });
    return null;
  }

  // Walk the cache and drop entries whose URL isn't referenced by
  // any layer in `liveUrls`. Called from drawBackground each frame
  // to release the GPU-backed CanvasPattern when the user switches
  // away from a tissue bg. Cache keys are `${url}@${scale}`, so the
  // match splits on the '@' separator. Without this, the browser
  // kept the tile decoded + uploaded indefinitely; subsequent
  // procedural bgs slowed to a crawl on devices where the
  // compositor was memory-bound.
  _evictUnusedTissuePatterns(liveUrls) {
    const cache = this._tissuePatternCache;
    if (!cache || cache.size === 0) return;
    for (const key of cache.keys()) {
      const url = key.slice(0, key.lastIndexOf('@'));
      if (liveUrls.has(url)) continue;
      const v = cache.get(key);
      if (v && typeof v === 'object' && v.img && typeof v.img.src !== 'undefined') {
        // Best-effort release. Browsers vary on whether nulling
        // .src actually frees the decoded buffer; the cache drop
        // is what really matters. Offscreen canvases don't have
        // .src — skipping the assignment for them is fine.
        try { v.img.src = ''; } catch (_) { /* ignore */ }
      }
      cache.delete(key);
    }
  }

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() { return 'canvas2d'; }

  // ---------- Background ----------
  drawBackground(ts) {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    // Rendertest translucent: skip both the layered bg path and the
    // opaque default fill so the canvas alpha stays 0 outside cells.
    if (RT_TRANSLUCENT) {
      ctx.clearRect(0, 0, W, H);
      return;
    }
    const layers = currentBgLayers();
    // Drop tissue cache entries whose URL is no longer referenced
    // by any active layer — switching away from a tissue bg used
    // to leave the decoded image + GPU-backed CanvasPattern alive,
    // which made subsequent procedural bgs crawl on memory-bound
    // devices.
    const liveTissueUrls = new Set();
    for (const l of layers) {
      if (l && l.kind === 'tissue' && l.textureUrl) {
        liveTissueUrls.add(l.textureUrl);
      }
    }
    this._evictUnusedTissuePatterns(liveTissueUrls);
    if (layers.length === 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const blendMap = { normal: 'source-over', multiply: 'multiply', additive: 'lighter' };
    for (let i = 0; i < layers.length; i++) {
      const bg = layers[i];
      ctx.save();
      ctx.globalAlpha = (typeof bg.opacity === 'number') ? bg.opacity : 1;
      // First layer always paints over the previous frame's pixels;
      // additional layers composite onto the stack so far.
      ctx.globalCompositeOperation = (i === 0) ? 'source-over' : (blendMap[bg.blend] || 'source-over');
      this._drawBgLayer(ts, bg);
      ctx.restore();
    }
  }

  _drawBgLayer(ts, bg) {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const cam = this.camera;

    if (bg.kind === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg.topColor);
      g.addColorStop(1, bg.botColor);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg.base;
    }
    ctx.fillRect(0, 0, W, H);

    // bgScale lets the user enlarge / shrink every world-coord
    // bg pattern feature without touching the camera zoom. We do
    // that by running the bg pass at an effective scale of
    // cam.scale * bgScale: world points project further from the
    // camera origin, so features appear bgScale× bigger on screen
    // while cells continue to render at the unchanged cam.scale.
    // Mirrors the WebGL2 / WebGPU shaders' "worldPx /= bgScale".
    // Floor at 0.05 so the slider's 0 endpoint doesn't divide-by-
    // zero — at the floor features are ~20× bigger than baseline,
    // reading as a near-uniform wash.
    const bgScale = Math.max(0.05, S.bgScale || 1);
    const bgEff = cam.scale * bgScale;
    ctx.save();
    // Mirror the rotation-aware composition that `withCameraCtx` applies
    // to the cell pass. Without this the bg only scales + translates, so
    // when the camera rotates (pinchRotation on) the bg pattern stays
    // axis-aligned while cells turn with the camera — they appear to
    // move in opposite directions. Reduces to the original
    // scale + translate matrix exactly when cam.rotation === 0.
    if (cam.rotation === 0) {
      ctx.transform(bgEff, 0, 0, bgEff, cam.tx, cam.ty);
    } else {
      const co = Math.cos(cam.rotation), si = Math.sin(cam.rotation);
      ctx.transform(bgEff * co, bgEff * si, -bgEff * si, bgEff * co, cam.tx, cam.ty);
    }
    const wx = -cam.tx / bgEff;
    const wy = -cam.ty / bgEff;
    const ww = W / bgEff;
    const wh = H / bgEff;

    if (bg.kind === 'tissue') {
      // Tiled image bg. createPattern is lazy: we kick off the
      // texture-loader on first draw, cache the resulting Pattern,
      // and short-circuit subsequent frames. Until the image
      // resolves the canvas shows just the base fill from above.
      const url = bg.textureUrl;
      const pat = url ? this._tissuePatternFor(url) : null;
      if (pat) {
        ctx.save();
        // Tile size in world units. Independent of cam.scale so
        // bgScale alone controls the visible repeat frequency.
        // 0.5 px-per-world-px keeps the tile readable at default
        // scale; bigger bgScale → smaller tiles.
        const TILE_WORLD = 0.5;
        const m = (typeof DOMMatrix !== 'undefined')
          ? new DOMMatrix().scale(TILE_WORLD, TILE_WORLD)
          : null;
        if (m && typeof pat.setTransform === 'function') {
          try { pat.setTransform(m); } catch (_) { /* old Safari */ }
        }
        ctx.fillStyle = pat;
        ctx.fillRect(wx, wy, ww, wh);
        ctx.restore();
      }
    }

    if (bg.kind === 'agar') {
      ctx.save();
      ctx.strokeStyle = bg.ringColor || 'rgba(120,80,30,0.10)';
      ctx.lineWidth = 1 / bgEff;
      const cx = W / 2, cy = H / 2;
      const maxR = Math.hypot(W, H) * 0.9;
      for (let r = 32; r < maxR; r += 32) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (bg.rbcSilhouettes) {
      // World-tiled RBC silhouettes — mirror of the WebGL2 / WebGPU
      // tiled bg pass. As you zoom out, more tiles become visible
      // and density stays constant. We iterate exactly the tile
      // range that overlaps the visible world rectangle (computed
      // above as wx/wy/ww/wh inside the camera-transformed ctx),
      // expanded by one tile each side so RBCs that straddle the
      // viewport edge still render.
      ctx.save();
      const t2 = ts * 0.00025 * S.bgFlowSpeed;
      const TS = 600;
      const tx0 = Math.floor(wx / TS) - 1;
      const ty0 = Math.floor(wy / TS) - 1;
      const tx1 = Math.ceil((wx + ww) / TS) + 1;
      const ty1 = Math.ceil((wy + wh) / TS) + 1;
      ctx.lineWidth = 1.4 / bgEff;
      // Same hash as bgHash() in the GPU shaders so the silhouette
      // layout matches between renderers.
      const bgHash = (x, y) => {
        let px = (x * 123.34) - Math.floor(x * 123.34);
        let py = (y * 345.45) - Math.floor(y * 345.45);
        const dot = px * px + py * py + 34.345;
        px += dot; py += dot;
        const v = px * py;
        return v - Math.floor(v);
      };
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const h0 = bgHash(tx, ty) * 6.28;
          for (let k = 0; k < 4; k++) {
            const kSeed = h0 + k * 1.31;
            const inX = frac(kSeed * 1.7) * TS;
            const inY = frac(kSeed * 2.3) * TS;
            const px = tx * TS + inX + 40 * Math.sin(t2 * 1000 * 0.00025 + kSeed);
            const py = ty * TS + inY + 40 * Math.cos(t2 * 1000 * 0.00018 + kSeed);
            const r = 18 + 16 * frac(kSeed * 0.41);
            ctx.fillStyle = 'rgba(255,90,90,0.10)';
            ctx.strokeStyle = 'rgba(255,140,140,0.18)';
            ctx.beginPath();
            ctx.ellipse(px, py, r, r * 0.78, kSeed, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(120,20,20,0.18)';
            ctx.beginPath();
            ctx.arc(px, py, r * 0.32, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    if (bg.decor) this._drawAnatomyDecor(ts, bg.decor);

    if (bg.kind === 'cybergrid') {
      ctx.save();
      const step = bg.gridStep || 48;
      ctx.strokeStyle = bg.gridColor || 'rgba(0,255,170,0.15)';
      ctx.lineWidth = 1 / bgEff;
      const x0 = Math.floor(wx / step) * step;
      const y0 = Math.floor(wy / step) * step;
      ctx.beginPath();
      for (let x = x0; x < wx + ww + step; x += step) { ctx.moveTo(x, wy); ctx.lineTo(x, wy + wh); }
      for (let y = y0; y < wy + wh + step; y += step) { ctx.moveTo(wx, y); ctx.lineTo(wx + ww, y); }
      ctx.stroke();
      ctx.restore();
    }

    const t = ts * 0.001 * S.bgFlowSpeed;
    const count = Math.min(this.SPOTS.length, bg.spotCount || this.SPOTS.length);
    const spotCols = Array.isArray(bg.spotColors) ? bg.spotColors : null;
    const fallbackCol = bg.spotColor || 'rgba(255,255,255,0.10)';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const s = this.SPOTS[i];
      const cx = (s.ax + s.ox1 * Math.sin(t * s.w1 + s.phx) + s.ox2 * Math.sin(t * s.w1 * 2.3 + s.phx * 0.7)) * W;
      const cy = (s.ay + s.oy1 * Math.cos(t * s.w2 + s.phy) + s.oy2 * Math.sin(t * s.w2 * 1.7 + s.phy * 1.3)) * H;
      const radius = s.r * Math.max(W, H);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      const col = spotCols ? spotCols[i % spotCols.length] : fallbackCol;
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(wx, wy, ww, wh);
    }
    ctx.restore();
    ctx.restore();

    if (bg.vignette > 0) {
      const pulse = 0.92 + 0.08 * Math.sin(ts * 0.0006);
      const vg = ctx.createLinearGradient(0, 0, 0, H);
      const a = bg.vignette * pulse;
      vg.addColorStop(0, `rgba(0,0,0,${a})`);
      vg.addColorStop(0.5, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  _drawAnatomyDecor(ts, decor) {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const cam = this.camera;
    const t = ts * 0.001 * S.bgFlowSpeed;
    // bgScale enters via `sc`: every "1/sc" line width below stays
    // at 1 screen px regardless of the slider, matching the bg
    // pass above (and the shader smoothstep bands).
    const bgScale = Math.max(0.05, S.bgScale || 1);
    const sc = cam.scale * bgScale;
    switch (decor) {
      case 'lymphocytes': {
        const N = 22;
        ctx.lineWidth = 1.4 / sc;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.31;
          const fx = ((i / N) + 0.05 * Math.sin(t + seed)) % 1;
          const fy = (frac(seed * 0.7 + t * 0.3 + i * 0.13)) % 1;
          const px = fx * W; const py = fy * H;
          const r = 7 + 6 * frac(seed * 0.21);
          ctx.fillStyle = 'rgba(220,200,255,0.18)';
          ctx.strokeStyle = 'rgba(180,160,220,0.35)';
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = 'rgba(120,80,160,0.30)';
          ctx.beginPath(); ctx.arc(px - r * 0.2, py - r * 0.1, r * 0.45, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'lobules': {
        const N = 18;
        ctx.lineWidth = 1 / sc;
        ctx.strokeStyle = 'rgba(180,80,90,0.22)';
        for (let i = 0; i < N; i++) {
          const seed = i * 1.7;
          const px = frac(seed) * W;
          const py = frac(seed * 1.7) * H;
          const r = 30 + 20 * frac(seed * 0.31);
          const wob = Math.sin(t * 0.4 + seed) * 0.05;
          ctx.beginPath();
          for (let j = 0; j <= 6; j++) {
            const a = j * Math.PI / 3 + seed + wob;
            const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath(); ctx.stroke();
        }
        break;
      }
      case 'matrix': {
        ctx.strokeStyle = 'rgba(255,200,140,0.10)';
        ctx.lineWidth = 1 / sc;
        const step = 28;
        for (let x = 0; x < W; x += step) {
          const wob = Math.sin((x + t * 30) * 0.05) * 6;
          ctx.beginPath(); ctx.moveTo(x + wob, 0); ctx.lineTo(x - wob, H); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,200,140,0.06)';
        for (let y = 40; y < H; y += 80) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        break;
      }
      case 'pulse': {
        const cx = W / 2, cy = H / 2;
        ctx.strokeStyle = 'rgba(255,80,90,0.22)';
        ctx.lineWidth = 2 / sc;
        for (let i = 0; i < 5; i++) {
          const phase = ((t * 0.6 + i * 0.2) % 1);
          const r = phase * Math.max(W, H) * 0.55;
          const a = 1 - phase;
          ctx.globalAlpha = a * 0.6;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'villi': {
        ctx.fillStyle = 'rgba(220,140,140,0.20)';
        const N = 24;
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) * W / N;
          const wob = Math.sin(t * 1.4 + i * 0.7) * 5;
          const len = 30 + 12 * Math.sin(t * 1.0 + i);
          ctx.beginPath();
          ctx.ellipse(x + wob, len * 0.5, 11, len, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath();
          ctx.ellipse(x - wob, H - len * 0.5, 11, len, 0, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'alveoli': {
        ctx.strokeStyle = 'rgba(140,180,230,0.30)';
        ctx.lineWidth = 1 / sc;
        const N = 36;
        for (let i = 0; i < N; i++) {
          const seed = i * 2.31;
          const px = frac(seed) * W;
          const py = frac(seed * 1.31) * H;
          const r = 20 + 16 * Math.abs(Math.sin(t * 0.6 + seed));
          ctx.fillStyle = 'rgba(180,210,255,0.18)';
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        break;
      }
      case 'neurons': {
        const N = 16;
        ctx.lineWidth = 1.5 / sc;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.7;
          const x1 = frac(seed) * W, y1 = frac(seed * 1.31) * H;
          const x2 = frac(seed * 2.3) * W, y2 = frac(seed * 1.7) * H;
          const flash = (Math.sin(t * 2 + seed) + 1) / 2;
          ctx.strokeStyle = `rgba(255,210,255,${0.10 + flash * 0.30})`;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.fillStyle = `rgba(255,230,255,${0.20 + flash * 0.5})`;
          ctx.beginPath(); ctx.arc(x1, y1, 3 / sc + flash * 2 / sc, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'tubules': {
        ctx.strokeStyle = 'rgba(255,150,120,0.22)';
        ctx.lineWidth = 2 / sc;
        const N = 12;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.9;
          const x1 = frac(seed) * W;
          const cyy = frac(seed * 1.7) * H;
          ctx.beginPath();
          ctx.moveTo(x1, 0);
          ctx.bezierCurveTo(
            x1 + 60 + 30 * Math.sin(t + seed), cyy * 0.4,
            x1 - 60 - 30 * Math.cos(t + seed), cyy * 0.7,
            x1, H
          );
          ctx.stroke();
        }
        break;
      }
      case 'hair': {
        ctx.strokeStyle = 'rgba(120,80,40,0.45)';
        ctx.lineWidth = 1.2 / sc;
        const N = 56;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.3;
          const px = frac(seed) * W;
          const py = frac(seed * 1.71) * H;
          const len = 22 + 12 * frac(seed * 0.7);
          const wob = Math.sin(t * 1.0 + seed) * 0.4;
          const tipX = px + Math.sin(wob) * len;
          const tipY = py - Math.cos(wob) * len;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + Math.sin(wob) * len * 0.5, py - len * 0.5, tipX, tipY);
          ctx.stroke();
          ctx.fillStyle = 'rgba(60,30,15,0.6)';
          ctx.beginPath(); ctx.arc(px, py, 2 / sc, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
    }
  }

  // ---------- Cells: per-cell direct render (no metaball merging or
  // black outline halo — matches the WebGL2 renderer's clean per-cell
  // look). drawCellBodies fills the cytoplasm gradient with a sharp
  // polygon edge, then the existing granules / decorations / membrane
  // / nuclei / cartoon passes layer on top.
  // Cardiovascular vessel network + flowing RBC particles. Drawn in
  // world coordinates inside `withCameraCtx` so the network pans/
  // zooms/rotates with the camera. No-op when vessels are disabled.
  drawVessels(time, ts) {
    const sim = this.sim;
    if (!sim || !sim.vessels) return;
    const caps = sim.vessels.capsules;
    const rbcs = sim.vesselRbcs || [];
    this.withCameraCtx(() => {
      const ctx = this.ctx;
      ctx.lineCap = 'round';
      // Solid bright-red vessels — opaque so the post-fx chain
      // (microscope blur, glass membrane, noise) can't wash them
      // out against the bloodflow bg. Single pass matches the
      // anatomical-illustration style the user referenced.
      ctx.strokeStyle = 'rgb(224, 32, 44)';
      for (const cap of caps) {
        ctx.lineWidth = cap.r * 2;
        ctx.beginPath();
        ctx.moveTo(cap.x1, cap.y1);
        ctx.lineTo(cap.x2, cap.y2);
        ctx.stroke();
      }
      // Flowing RBCs — biconcave-ish ovals oriented along the flow.
      // Vivid pink so they read as moving particles even through the
      // post-fx blur.
      for (const p of rbcs) {
        const pos = rbcWorldPos(p, sim.vessels);
        if (!pos) continue;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(pos.angle);
        const a = pos.r;
        const b = a * 0.78;
        ctx.fillStyle = 'rgb(255, 120, 130)';
        ctx.beginPath();
        ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(140, 30, 38, 0.70)';
        ctx.beginPath();
        ctx.ellipse(0, 0, a * 0.55, b * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }

  drawCells(shapes, time, ts) {
    this._drawCellBodies(shapes, time);
    const theme = currentTheme();
    this._drawGranules(shapes, theme, time);
    this._drawDecorations(shapes, theme, time);
    this._drawMembrane(shapes, time, theme);
    this._drawNuclei(shapes, ts);
    this._drawCartoonFaces(shapes, time);
  }

  _drawCellBodies(shapes, t) {
    const ctx = this.ctx;
    const N = WOBBLE_VERTS;

    // Partition: when S.metaSplit is on, both halves of any SPLITTING
    // cell render together as a per-pair metaball. Everything else
    // renders as an independent shape via the per-cell path below.
    const useMetaSplit = !!S.metaSplit;
    const splittingByCellId = new Map();
    const singletons = [];
    if (useMetaSplit) {
      for (const s of shapes) {
        if (s.cell.state === 'SPLITTING') {
          if (!splittingByCellId.has(s.cell.id)) splittingByCellId.set(s.cell.id, []);
          splittingByCellId.get(s.cell.id).push(s);
          // Disk-pass crossfade: over the second half of SPLITTING
          // (p > 0.5), fade in the per-half disk content (nucleus,
          // top-light, donut, decorations) so when finishSplit fires
          // and the metaball pass stops, the disk pass is already at
          // full opacity. Eliminates the visible pop at the SPLITTING
          // → NORMAL transition.
          if (s.cell.splitProgress > 0.5) {
            s.diskAlpha = (s.cell.splitProgress - 0.5) * 2;
            singletons.push(s);
          }
        } else {
          singletons.push(s);
        }
      }
      // Cells where only one half is in view fall back to the singleton
      // path (no pair → no metaball merge).
      for (const [id, pair] of splittingByCellId) {
        if (pair.length < 2) {
          for (const s of pair) singletons.push(s);
          splittingByCellId.delete(id);
        }
      }
    } else {
      for (const s of shapes) singletons.push(s);
    }

    // ---- Per-pair metaball pass (each splitting cell rendered once)
    if (splittingByCellId.size > 0) {
      this.withCameraCtx(() => {
        for (const [, pair] of splittingByCellId) {
          this._renderSplittingPair(pair[0].cell, t);
        }
      });
    }

    // ---- Per-cell direct-render pass (the WebGL2-style clean look)
    this.withCameraCtx(() => {
      for (const s of singletons) {
        const c = s.cell;
        const cc = cellColors(c);
        const cType = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
        const hollow = !!cType.bodyHollow;
        // SPLITTING halves with p > 0.5 ride this loop with a fade-in
        // alpha (s.diskAlpha set in the partition step above) so the
        // disk-pass content reaches full opacity by the moment
        // finishSplit fires and the metaball pass stops.
        const fadingDisk = (s.diskAlpha !== undefined && s.diskAlpha < 1);
        if (fadingDisk) {
          ctx.save();
          ctx.globalAlpha = s.diskAlpha;
        }

        // Build the wobbly polygon path once and reuse it (Path2D would
        // be cleaner, but cytoplasm-fill path differs from clip path).
        const tracePolygon = () => {
          ctx.beginPath();
          for (let i = 0; i <= N; i++) {
            const v = shapeVertex(s, THETA_TABLE[i], t);
            if (i === 0) ctx.moveTo(v.x, v.y);
            else ctx.lineTo(v.x, v.y);
          }
          ctx.closePath();
        };

        // Cytoplasm: 3-stop radial gradient over a disc slightly larger
        // than the cell, clipped to the wobble polygon. Sharp polygon
        // edge — no metaball blur, no merging with neighbours.
        tracePolygon();
        const gradR = s.r * 1.95;
        const grad = ctx.createRadialGradient(s.x, s.y - s.r * 0.18, 0, s.x, s.y, gradR);
        grad.addColorStop(0,    cc.cytoTop);
        grad.addColorStop(0.55, cc.cytoBot);
        grad.addColorStop(1,    cc.cytoBotTransp || hexToRgba(cc.cytoBot, 0));
        ctx.fillStyle = grad;
        ctx.fill();

        // Inner overlays — donut hole (RBCs) and top-left highlight —
        // clipped to the polygon so they don't leak past the edge.
        ctx.save();
        tracePolygon();
        ctx.clip();

        if (hollow) {
          const innerR = s.r * 0.55;
          const g2 = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, innerR);
          g2.addColorStop(0, hexToRgba(cc.cytoBot, 0.78));
          g2.addColorStop(1, hexToRgba(cc.cytoBot, 0));
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, innerR, 0, Math.PI * 2);
          ctx.fill();
        }

        const hx = s.x - s.r * 0.35;
        const hy = s.y - s.r * 0.45;
        const hr = s.r * 0.75;
        const hgrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
        hgrad.addColorStop(0, cc.nucleusHi);
        hgrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = hgrad;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (fadingDisk) ctx.restore();
      }
    });
  }

  // Per-pair metaball render for a SPLITTING cell. The two halves are
  // drawn (white) into a scratch canvas, blur+contrast carves a binary
  // metaball mask that fuses them, then the mask is tinted with the
  // cytoplasm gradient via source-in and blitted into the main canvas
  // at the bbox. Membrane stroke comes later via _drawMembrane (which
  // strokes each half polygon — visually OK because the merge is
  // carried by the fill).
  _renderSplittingPair(c, t) {
    const ctx = this.ctx;
    const cam = this.camera;
    const cType = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
    const fld = cType.field || { blur: 6, contrast: 20 };
    const cc = cellColors(c);
    const N = WOBBLE_VERTS;
    const halves = splitVirtualCenters(c);

    // World-space bbox covering both wobble polygons (with a generous
    // body multiplier) plus blur padding.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const h of halves) {
      const buf = h.r * 1.6;
      if (h.x - buf < minX) minX = h.x - buf;
      if (h.y - buf < minY) minY = h.y - buf;
      if (h.x + buf > maxX) maxX = h.x + buf;
      if (h.y + buf > maxY) maxY = h.y + buf;
    }
    // 1 scratch pixel per screen pixel at current zoom keeps the blur
    // strength matched to canvas2D's filter() spec (px-based).
    const scratchScale = Math.max(0.5, cam.scale);
    const padScratchPx = fld.blur * 3 + 4;
    const padWorld = padScratchPx / scratchScale;
    minX -= padWorld; minY -= padWorld;
    maxX += padWorld; maxY += padWorld;
    const sw = Math.max(8, Math.ceil((maxX - minX) * scratchScale));
    const sh = Math.max(8, Math.ceil((maxY - minY) * scratchScale));

    if (!this._scratch) {
      this._scratch = document.createElement('canvas');
      this._scratchCtx = this._scratch.getContext('2d');
    }
    this._scratch.width = sw;
    this._scratch.height = sh;
    const sctx = this._scratchCtx;

    // World→scratch transform.
    sctx.setTransform(scratchScale, 0, 0, scratchScale, -minX * scratchScale, -minY * scratchScale);

    // 1) Both halves filled solid white onto the freshly-sized scratch.
    sctx.fillStyle = '#ffffff';
    for (const h of halves) {
      const ref = { x: h.x, y: h.y, r: h.r, cell: c };
      sctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const v = shapeVertex(ref, THETA_TABLE[i], t);
        if (i === 0) sctx.moveTo(v.x, v.y);
        else sctx.lineTo(v.x, v.y);
      }
      sctx.closePath();
      sctx.fill();
    }

    // 2) Apply blur+contrast in identity space (filter spec is in
    // scratch pixels), copying scratch onto itself to carve the
    // metaball edge.
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'copy';
    sctx.filter = `blur(${fld.blur}px) contrast(${fld.contrast})`;
    sctx.drawImage(this._scratch, 0, 0);
    sctx.filter = 'none';
    sctx.globalCompositeOperation = 'source-over';
    sctx.restore();

    // 3) Tint the mask with the cytoplasm gradient via source-in.
    sctx.save();
    sctx.globalCompositeOperation = 'source-in';
    const mx = (halves[0].x + halves[1].x) / 2;
    const my = (halves[0].y + halves[1].y) / 2;
    const gr = Math.max(halves[0].r, halves[1].r) * 1.95;
    const grad = sctx.createRadialGradient(mx, my - gr * 0.18, 0, mx, my, gr);
    grad.addColorStop(0,    cc.cytoTop);
    grad.addColorStop(0.55, cc.cytoBot);
    grad.addColorStop(1,    cc.cytoBotTransp || hexToRgba(cc.cytoBot, 0));
    sctx.fillStyle = grad;
    sctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    sctx.globalCompositeOperation = 'source-over';
    sctx.restore();

    // 4) Blit scratch into the main canvas at the world bbox. The
    // surrounding withCameraCtx already applies the camera transform,
    // so `minX / minY` are world coordinates here.
    ctx.drawImage(this._scratch, 0, 0, sw, sh, minX, minY, maxX - minX, maxY - minY);
  }

  _drawMembrane(shapes, t, theme) {
    const ctx = this.ctx;
    const cam = this.camera;
    const a = (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55;
    if (a <= 0 || shapes.length === 0) return;
    const N = WOBBLE_VERTS;
    // metaSplit outline modes:
    //   'sdf'     — stroke each half polygon (existing per-cell behavior).
    //   'polygon' — stroke union polygon (skip segments inside partner).
    //   'edge'    — same as 'polygon' but with a 1 px screen blur for a
    //               soft rim that approximates the metaball silhouette.
    // Without S.metaSplit the metaball pass isn't running, so each half
    // gets its own stroke regardless of mode.
    const mergeOutline = !!S.metaSplit
      && (S.metaOutlineMode === 'edge' || S.metaOutlineMode === 'polygon');
    this.withCameraCtx(() => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = a;
      const _lt = (typeof S.lineThickness === 'number' ? S.lineThickness : 1);
      ctx.lineWidth = Math.max(2, S.outlinePx * 0.85) * _lt / cam.scale;

      // Group SPLITTING shapes by cell.id when we'll merge them; the
      // remaining shapes use the original per-shape stroke loop.
      const splitPairs = mergeOutline ? new Map() : null;
      const standalone = mergeOutline ? [] : shapes;
      if (mergeOutline) {
        for (const s of shapes) {
          if (s.cell.state === 'SPLITTING') {
            let bucket = splitPairs.get(s.cell.id);
            if (!bucket) { bucket = []; splitPairs.set(s.cell.id, bucket); }
            bucket.push(s);
          } else {
            standalone.push(s);
          }
        }
      }

      // Per-shape outline (NORMAL cells, plus all shapes when in 'sdf' /
      // metaSplit-off).
      for (const s of standalone) {
        ctx.strokeStyle = cellColors(s.cell).cytoBot;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], t);
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // Union outline for SPLITTING pairs.
      if (mergeOutline && splitPairs.size > 0) {
        const softEdge = (S.metaOutlineMode === 'edge');
        // ctx.filter is in screen px (ignores canvas transform). 1.5 px
        // blur reads as a soft rim that approximates the metaball
        // silhouette without sampling the actual blur+threshold output.
        if (softEdge) ctx.filter = `blur(${(1.5).toFixed(2)}px)`;
        for (const halves of splitPairs.values()) {
          const polys = halves.map((s) => {
            const verts = new Float64Array(N * 2);
            for (let i = 0; i < N; i++) {
              const v = shapeVertex(s, THETA_TABLE[i], t);
              verts[i * 2]     = v.x;
              verts[i * 2 + 1] = v.y;
            }
            return verts;
          });
          ctx.strokeStyle = cellColors(halves[0].cell).cytoBot;
          for (let hi = 0; hi < halves.length; hi++) {
            const verts = polys[hi];
            const partner = (polys.length === 2) ? polys[1 - hi] : null;
            ctx.beginPath();
            let pathOpen = false;
            for (let i = 0; i < N; i++) {
              const ax = verts[i * 2],     ay = verts[i * 2 + 1];
              const bx = verts[((i + 1) % N) * 2], by = verts[((i + 1) % N) * 2 + 1];
              const skip = partner
                && pointInPoly((ax + bx) * 0.5, (ay + by) * 0.5, partner);
              if (skip) { pathOpen = false; continue; }
              if (!pathOpen) { ctx.moveTo(ax, ay); pathOpen = true; }
              ctx.lineTo(bx, by);
            }
            ctx.stroke();
          }
        }
        if (softEdge) ctx.filter = 'none';
      }
      ctx.restore();
    });
  }

  // ---------- Granules ----------
  _drawGranules(shapes, theme, t) {
    const anyGranules = shapes.some(s => {
      const type = CELL_TYPES[s.cell.type] || CELL_TYPES.neutrophil;
      return (type.granules || 0) > 0;
    });
    if (!anyGranules) return;
    const ctx = this.ctx;
    const N = WOBBLE_VERTS;
    this.withCameraCtx(() => {
      for (const s of shapes) {
        const c = s.cell;
        const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
        const Ng = type.granules || 0;
        if (Ng === 0) continue;
        const seed = c.id * 9.7 + (c.wobbleSeed || 0);
        const isBig = c.type === 'basophil';
        const baseSize = isBig ? 0.115 : 0.05;
        const sizeJitter = isBig ? 0.05 : 0.04;
        const cc = cellColors(c);

        // Clip to this cell's wobble polygon so granules near the rim
        // can't leak outside (replaces the old destination-in mask).
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], t);
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.clip();

        ctx.fillStyle = cc.nucleus;
        ctx.globalAlpha = isBig ? 0.85 : 0.55;
        for (let i = 0; i < Ng; i++) {
          const ang = frac(seed * 1.3 + i * 0.61) * Math.PI * 2;
          const rRel = 0.05 + 0.85 * Math.sqrt(frac(seed + i * 0.317));
          const wob = 0.04 * Math.sin(t * 0.5 + i + seed);
          const wx = s.x + Math.cos(ang) * s.r * (rRel + wob);
          const wy = s.y + Math.sin(ang) * s.r * (rRel + wob);
          const r = s.r * (baseSize + sizeJitter * frac(seed * 1.7 + i * 0.13));
          ctx.beginPath();
          ctx.arc(wx, wy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });
  }

  // ---------- Decorations ----------
  _drawDecorations(shapes, theme, t) {
    this.withCameraCtx(() => {
      for (const s of shapes) {
        const c = s.cell;
        const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
        const kind = (type.decoration && type.decoration.kind) || 'none';
        switch (kind) {
          case 'bigSpikes':         this._drawBigSpikes(s, theme, t); break;
          case 'spikesPulsing':     this._drawSpikesPulsing(s, theme, t); break;
          case 'tendrils':          this._drawTendrils(s, theme, t); break;
          case 'tentaclesWiggling': this._drawTentaclesWiggling(s, theme, t); break;
          case 'flagellum':         this._drawFlagellum(s, theme, t); break;
          case 'drips':             this._drawDrips(s, theme, t); break;
          case 'legs':              this._drawLegs(s, theme, t); break;
          case 'fuzz':              this._drawFuzz(s, theme, t); break;
          case 'yReceptorsFew':     this._drawYReceptors(s, theme, t, 6); break;
          case 'yReceptorsMany':    this._drawYReceptors(s, theme, t, 14); break;
        }
      }
    });
  }

  _drawBigSpikes(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 8;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.7) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = theme.outline.color;
    ctx.fillStyle = cc.accent;
    const tipLen = s.r * 0.55;
    const baseHalf = s.r * 0.09;
    for (let i = 0; i < N; i++) {
      const jitter = (frac(c.id * 0.31 + i * 0.71) - 0.5) * 0.25;
      const theta = (i / N) * Math.PI * 2 + jitter;
      const base = shapeVertex(s, theta, t);
      const tx = base.x + Math.cos(theta) * tipLen;
      const ty = base.y + Math.sin(theta) * tipLen;
      ctx.beginPath();
      ctx.moveTo(base.x + Math.cos(theta + Math.PI / 2) * baseHalf, base.y + Math.sin(theta + Math.PI / 2) * baseHalf);
      ctx.lineTo(tx, ty);
      ctx.lineTo(base.x + Math.cos(theta - Math.PI / 2) * baseHalf, base.y + Math.sin(theta - Math.PI / 2) * baseHalf);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  _drawTendrils(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 13;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.5) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = cc.cytoBot;
    for (let i = 0; i < N; i++) {
      const baseAng = (i / N) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, baseAng, t);
      const len = s.r * (1.1 + 0.4 * frac(c.id * 0.13 + i * 0.7));
      const sway = 0.4 * Math.sin(t * 0.9 + i * 1.3 + c.wobbleSeed);
      const tipAng = baseAng + sway * 0.4;
      const tipX = base.x + Math.cos(tipAng) * len;
      const tipY = base.y + Math.sin(tipAng) * len;
      const ctrlAng = baseAng + sway;
      const ctrlR = len * 0.6;
      const cpX = base.x + Math.cos(ctrlAng) * ctrlR;
      const cpY = base.y + Math.sin(ctrlAng) * ctrlR;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawYReceptors(s, theme, t, count) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, px * 0.4) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = cc.accent;
    const stem = s.r * 0.22;
    const arms = s.r * 0.13;
    const armSpread = Math.PI * 0.25;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, theta, t);
      const tipX = base.x + Math.cos(theta) * stem;
      const tipY = base.y + Math.sin(theta) * stem;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tipX, tipY);
      const lAng = theta + armSpread;
      const rAng = theta - armSpread;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(lAng) * arms, tipY + Math.sin(lAng) * arms);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(rAng) * arms, tipY + Math.sin(rAng) * arms);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawSpikesPulsing(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 10;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.7) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = theme.outline.color;
    ctx.fillStyle = cc.accent;
    const baseHalf = s.r * 0.09;
    for (let i = 0; i < N; i++) {
      const jitter = (frac(c.id * 0.31 + i * 0.71) - 0.5) * 0.18;
      const theta = (i / N) * Math.PI * 2 + jitter;
      const tipLen = s.r * (0.45 + 0.18 * Math.sin(t * 2.5 + i * 0.7 + (c.wobbleSeed || 0)));
      const base = shapeVertex(s, theta, t);
      const tipX = base.x + Math.cos(theta) * tipLen;
      const tipY = base.y + Math.sin(theta) * tipLen;
      ctx.beginPath();
      ctx.moveTo(base.x + Math.cos(theta + Math.PI / 2) * baseHalf, base.y + Math.sin(theta + Math.PI / 2) * baseHalf);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(base.x + Math.cos(theta - Math.PI / 2) * baseHalf, base.y + Math.sin(theta - Math.PI / 2) * baseHalf);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  _drawTentaclesWiggling(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 6;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, px * 0.7) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = cc.cytoBot;
    for (let i = 0; i < N; i++) {
      const baseAng = (i / N) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, baseAng, t);
      const len = s.r * (1.0 + 0.5 * frac(c.id * 0.13 + i * 0.7));
      const sway = 0.7 * Math.sin(t * 1.6 + i * 1.3 + c.wobbleSeed);
      const curl = 0.6 * Math.sin(t * 1.1 + i * 0.5);
      const midAng = baseAng + sway;
      const midX = base.x + Math.cos(midAng) * len * 0.6;
      const midY = base.y + Math.sin(midAng) * len * 0.6;
      const tipAng = baseAng + sway + curl;
      const tipX = base.x + Math.cos(tipAng) * len;
      const tipY = base.y + Math.sin(tipAng) * len;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(midX, midY, tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawFlagellum(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const ang = (c.orientation || 0) + Math.PI;
    const startV = shapeVertex(s, ang, t);
    const dirX = Math.cos(ang), dirY = Math.sin(ang);
    const perpX = -dirY, perpY = dirX;
    const length = s.r * 1.6;
    const N = 24;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, px * 0.6) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = cc.accent;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const along = length * u;
      const wave = Math.sin(u * Math.PI * 3 - t * 6) * (s.r * 0.18) * u;
      const x = startV.x + dirX * along + perpX * wave;
      const y = startV.y + dirY * along + perpY * wave;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawDrips(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const N = 5;
    ctx.save();
    ctx.fillStyle = cc.cytoBot;
    ctx.strokeStyle = theme.outline.color;
    ctx.lineWidth = Math.max(1.5, S.outlinePx * 0.5) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    for (let i = 0; i < N; i++) {
      const dirAng = Math.PI * 0.5 - 0.40 + (i / (N - 1)) * 0.80;
      const base = shapeVertex(s, dirAng, t);
      const drop = s.r * 0.22 + s.r * 0.06 * Math.sin(t * 1.8 + i);
      const tipX = base.x;
      const tipY = base.y + drop;
      ctx.beginPath();
      ctx.moveTo(base.x - s.r * 0.06, base.y);
      ctx.quadraticCurveTo(base.x, tipY + drop * 0.2, base.x + s.r * 0.06, base.y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      const bobY = tipY + s.r * 0.10 + s.r * 0.05 * Math.sin(t * 2.2 + i * 0.7);
      ctx.beginPath();
      ctx.arc(tipX, bobY, s.r * 0.07, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  _drawLegs(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const px = S.outlinePx;
    const N = 10;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, px * 0.6) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = theme.outline.color;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wiggle = 0.25 * Math.sin(t * 6 + i * 0.8);
      const base = shapeVertex(s, theta, t);
      const dir = theta + wiggle;
      const len = s.r * 0.4;
      const kneeX = base.x + Math.cos(dir) * len * 0.55;
      const kneeY = base.y + Math.sin(dir) * len * 0.55;
      const tipX = base.x + Math.cos(dir + 0.3 * Math.sin(t * 5 + i)) * len;
      const tipY = base.y + Math.sin(dir + 0.3 * Math.sin(t * 5 + i)) * len;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawFuzz(s, theme, t) {
    const ctx = this.ctx, cam = this.camera;
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 22;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.4, px * 0.4) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = cc.accent;
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const base = shapeVertex(s, theta, t);
      const len = s.r * (0.18 + 0.10 * Math.sin(t * 1.2 + i * 0.7));
      const tipX = base.x + Math.cos(theta) * len;
      const tipY = base.y + Math.sin(theta) * len;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Cartoon faces ----------
  _drawCartoonFaces(shapes, t) {
    if (!S.cartoon || shapes.length === 0) return;
    const ctx = this.ctx, cam = this.camera;
    const theme = currentTheme();
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
    const lw = Math.max(1.5, S.outlinePx * 0.6) / cam.scale;

    this.withCameraCtx(() => {
      for (const s of shapes) {
        const c = s.cell;
        const cfg = FACE[c.type] || FACE.default;
        const mouthKind = effectiveMouthKind(c);
        if (!cfg.eyes && mouthKind === 'none') continue;

        if (now > c.nextBlink) c.nextBlink = now + 120 + 3000 + Math.random() * 3500;
        const blinking = (c.nextBlink - now) < 120 && (c.nextBlink - now) > 0;

        // Face follows each shape entry. During SPLITTING, getShapes
        // emits two entries with correct half centres + radius
        // (shape.js:96-97); for NORMAL cells s.{x,y,r} === c.{x,y,r}.
        const cx = s.x;
        const cy = s.y;
        const cr = s.r;
        // Smoothed look-at unit vector lerped per frame in sim.update
        // (~0.15 s time constant). May drift slightly off the unit
        // circle during transitions; the `lm` divisor renormalises.
        const lookX = c.lookX, lookY = c.lookY;
        const lm = Math.hypot(lookX, lookY) || 1;

        ctx.save();
        // Face blur + alpha fade during SPLITTING. Both share a sine
        // envelope (peaks mid-split, zero at endpoints):
        //   blur:  ~0.09 * cr * cam.scale  (screen px; ctx.filter
        //          ignores canvas transform).
        //   alpha: 1 - 0.8 * sin(p*pi)  → 1 at endpoints, 0.2 at peak.
        if (c.state === 'SPLITTING') {
          const env = Math.sin(c.splitProgress * Math.PI);
          const blurPx = env * 0.09 * cr * cam.scale;
          if (blurPx > 0.5) ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
          // Linear face fade: 0.5 at split start → 1.0 at split end.
          ctx.globalAlpha = (ctx.globalAlpha || 1) * (0.5 + 0.5 * c.splitProgress);
        }
        ctx.lineWidth = lw;
        ctx.strokeStyle = theme.outline.color;

        if (cfg.eyes >= 1) {
          // 1.2 = baseline cartoon-face multiplier (unchanged since the
          // feature shipped). Multiplied by the user slider S.faceScale
          // so the same constant tunes eye radius, pupil radius and
          // horizontal eye spread together — parity with the WebGL2 +
          // WebGPU face shaders which read u_faceScale / vp_time.w.
          const FACE_SCALE = 1.2 * (S.faceScale != null ? S.faceScale : 1);
          const eyeR = cr * cfg.eyeR * FACE_SCALE;
          const eyeY = cy + cr * cfg.eyeY;
          const pupilR = cr * cfg.pupilR * FACE_SCALE;
          const pupilOff = eyeR * 0.45;
          const pdx = (lookX / lm) * pupilOff;
          const pdy = (lookY / lm) * pupilOff;
          const eyeXs = cfg.eyes === 2
            ? [cx - cr * 0.22 * FACE_SCALE, cx + cr * 0.22 * FACE_SCALE]
            : [cx];
          for (const ex of eyeXs) {
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            if (blinking) {
              ctx.ellipse(ex, eyeY, eyeR, eyeR * 0.12, 0, 0, Math.PI * 2);
            } else {
              ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.stroke();
            if (!blinking) {
              ctx.fillStyle = '#101218';
              ctx.beginPath();
              ctx.arc(ex + pdx, eyeY + pdy, pupilR, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = 'rgba(255,255,255,0.85)';
              ctx.beginPath();
              ctx.arc(ex + pdx - pupilR * 0.35, eyeY + pdy - pupilR * 0.35, pupilR * 0.30, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        if (mouthKind && mouthKind !== 'none') {
          const mY = cy + cr * 0.18;
          // Mouth half-extent: 0.34 (cfg baseline) × 1.2 (cartoon
          // multiplier) × S.faceScale so the user slider scales mouth
          // width in lockstep with eye radius.
          const mW = cr * 0.34 * 1.2 * (S.faceScale != null ? S.faceScale : 1);
          ctx.lineWidth = lw * 1.3;
          ctx.lineCap = 'round';   // soft endpoints (matches GPU shader's smoothstep fix)
          // Mouth base reads black on every theme — single high-contrast
          // colour that the user can spot at any zoom without mistaking
          // it for a nucleus.
          ctx.strokeStyle = '#000';
          ctx.fillStyle = '#000';
          if (mouthKind === 'smile') {
            // Solid filled circular segment below the chord (the
            // arc + closePath connects the chord). Reads as a U.
            ctx.beginPath();
            ctx.arc(cx, mY - mW * 0.3, mW, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.closePath();
            ctx.fill();
          } else if (mouthKind === 'frown') {
            // Solid filled segment above the chord (∩).
            ctx.beginPath();
            ctx.arc(cx, mY + mW * 0.6, mW, 1.12 * Math.PI, 1.88 * Math.PI);
            ctx.closePath();
            ctx.fill();
          } else if (mouthKind === 'snarl') {
            // 5 downward-pointing triangular teeth sharing their top
            // edges — solid filled (not a sawtooth-bottom rectangle).
            ctx.beginPath();
            const N = 5;
            const topY = mY - mW * 0.05;
            const toothH = mW * 0.30;
            const step = (2 * mW) / N;
            for (let i = 0; i < N; i++) {
              const tCx = cx - mW + (i + 0.5) * step;
              ctx.moveTo(tCx - step * 0.5, topY);
              ctx.lineTo(tCx + step * 0.5, topY);
              ctx.lineTo(tCx, topY + toothH);
              ctx.closePath();
            }
            ctx.fill();
          } else if (mouthKind === 'fangs') {
            ctx.beginPath();
            ctx.ellipse(cx, mY, mW, mW * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(cx - mW * 0.55, mY - mW * 0.20);
            ctx.lineTo(cx - mW * 0.40, mY + mW * 0.45);
            ctx.lineTo(cx - mW * 0.25, mY - mW * 0.20);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(cx + mW * 0.25, mY - mW * 0.20);
            ctx.lineTo(cx + mW * 0.40, mY + mW * 0.45);
            ctx.lineTo(cx + mW * 0.55, mY - mW * 0.20);
            ctx.closePath();
            ctx.fill();
          } else if (mouthKind === 'tongue') {
            ctx.beginPath();
            ctx.ellipse(cx, mY, mW, mW * 0.40, 0, 0, Math.PI * 2);
            ctx.fill();
            const wag = Math.sin(t * 5 + c.phase) * mW * 0.18;
            ctx.fillStyle = '#ff8aa0';
            ctx.beginPath();
            ctx.ellipse(cx + wag, mY + mW * 0.30, mW * 0.32, mW * 0.22, 0, 0, Math.PI * 2);
            ctx.fill();
          } else if (mouthKind === 'drool') {
            // Solid base smile + drool drip below.
            ctx.beginPath();
            ctx.arc(cx, mY - mW * 0.3, mW, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.closePath();
            ctx.fill();
            const dripPhase = ((t * 0.6 + c.phase) % 1);
            const dripY = mY + mW * 0.25 + dripPhase * mW * 0.8;
            const dripA = 1 - dripPhase;
            ctx.fillStyle = `rgba(120, 220, 130, ${dripA})`;
            ctx.beginPath();
            ctx.ellipse(cx + mW * 0.25, dripY, mW * 0.10, mW * 0.16, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.restore();
      }
    });
  }

  // ---------- Particles (kill-mode debris) ----------
  // Y-shaped antibody sprites. Each antibody is rotated along its
  // velocity vector so the stems trail behind. Birth flash scales the
  // Y up briefly (1.6× → 1.0× over the first 150 ms); the last 20% of
  // life fades alpha to 0 so misses dissolve instead of popping. A
  // small ambient spin (~1.5 rad/s, phased per-owner) keeps cruising
  // antibodies feeling alive without visible per-frame wagging.
  drawAntibodies(antibodies, _t, ts) {
    if (!antibodies || !antibodies.length) return;
    const ctx = this.ctx;
    this.withCameraCtx(() => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const now = (typeof ts === 'number' ? ts : performance.now()) * 0.001;
      for (const a of antibodies) {
        const age = a.maxLife - a.life;
        const lifeRatio = a.life / a.maxLife;
        // Birth flash: 1.6× → 1.0× over 150 ms.
        const birth = age < 0.15 ? (0.15 - age) / 0.15 : 0;
        const scale = a.r * (1.0 + 0.6 * birth);
        // Expiry fade: ramp alpha to 0 in the last 20% of life.
        const alpha = lifeRatio < 0.2 ? lifeRatio / 0.2 : 1;
        const baseAngle = Math.atan2(a.vy, a.vx);
        const ambient = (now * 1.5 + (a.ownerId || 0) * 0.7) % (Math.PI * 2);
        // Ambient spin is small (±0.15 rad) so the Y stays oriented
        // along the velocity but breathes a bit.
        const angle = baseAngle + Math.sin(ambient) * 0.15;
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(angle);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = a.color;
        // Unit-Y space — `scale = r` so the on-screen width is
        // `lineThickness · r · device-px`. Default 1.0 keeps the
        // original look; the slider scales 0.3..3.0.
        ctx.lineWidth = (typeof S.lineThickness === 'number' ? S.lineThickness : 1);
        ctx.beginPath();
        // Stem (behind the projectile).
        ctx.moveTo(-2.4, 0);
        ctx.lineTo(0, 0);
        // Arms (ahead).
        ctx.moveTo(0, 0);
        ctx.lineTo(1.6, -1.2);
        ctx.moveTo(0, 0);
        ctx.lineTo(1.6,  1.2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    });
  }

  drawParticles(particles /* , t, ts */) {
    if (!particles || !particles.length) return;
    const ctx = this.ctx;
    this.withCameraCtx(() => {
      for (const p of particles) {
        const a = Math.max(0, Math.min(1, p.life / p.maxLife));
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  // ---------- Selection / target marker / flash ----------
  drawSelection(shapes, t) {
    const ctx = this.ctx, cam = this.camera;
    const sim = this.sim;
    const anyFlash = shapes.some(s => s.cell.flash);
    if (sim.selectedCells.size === 0 && !anyFlash && !sim.targetMarker) return;

    this.withCameraCtx(() => {
      const N = WOBBLE_VERTS;
      const hl = currentHighlightColor();
      for (const c of sim.selectedCells) {
        if (c.state !== 'NORMAL') continue;
        const cc = cellColors(c);

        const shapeRef = { x: c.x, y: c.y, r: c.r, cell: c };
        ctx.save();
        ctx.fillStyle = hexToRgba(hl, 0.30);
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const v = shapeVertex(shapeRef, THETA_TABLE[i], t);
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        const inflated = { x: c.x, y: c.y, r: c.r * 1.30, cell: c };
        ctx.save();
        ctx.lineWidth = Math.max(2, S.outlinePx * 1.4) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
        ctx.strokeStyle = cc.cytoBot;
        ctx.shadowColor = hl;
        ctx.shadowBlur = 18 / cam.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const v = shapeVertex(inflated, THETA_TABLE[i], t);
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      for (const s of shapes) {
        const c = s.cell;
        if (!c.flash || c.flash <= 0) continue;
        const alpha = Math.min(1, c.flash / 0.2) * 0.6;
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], t);
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      if (sim.targetMarker) {
        const age = (performance.now() - sim.targetMarker.t0) / 1500;
        if (age >= 1) {
          sim.targetMarker = null;
        } else {
          const fade = 1 - age;
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.lineWidth = 2 / cam.scale;
          ctx.setLineDash([8 / cam.scale, 6 / cam.scale]);
          ctx.lineDashOffset = -performance.now() * 0.04 / cam.scale;
          ctx.strokeStyle = '#ffffff';
          for (const c of sim.selectedCells) {
            if (c.state !== 'NORMAL') continue;
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(sim.targetMarker.x, sim.targetMarker.y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          const r = 18 / cam.scale * (1 + 0.4 * age);
          ctx.lineWidth = 3 / cam.scale;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(sim.targetMarker.x, sim.targetMarker.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(sim.targetMarker.x, sim.targetMarker.y, 4 / cam.scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    });
  }

  // ---------- Nuclei ----------
  // `shapes` is the same culled list the body pass iterates. Gating the
  // nucleus loop on it keeps body + nucleus visibility in lock-step:
  // when inView (rotation-aware since PR #40) culls a cell, both passes
  // skip it. WebGL2 + WebGPU's disk shader composites body + nucleus
  // together so they don't have this asymmetry; canvas2d does because
  // the nucleus is a separate pass with a blur filter.
  _drawNuclei(shapes, ts) {
    if (shapes.length === 0) return;
    const ctx = this.ctx;
    const t = ts * 0.001;
    const visibleIds = new Set();
    for (const s of shapes) visibleIds.add(s.cell.id);
    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.globalAlpha = 0.78;
    this.withCameraCtx(() => this._drawNucleiInner(visibleIds, ts, t));
    ctx.restore();
  }

  _drawNucleiInner(visibleIds, ts, t) {
    for (const c of this.sim.cells) {
      if (!visibleIds.has(c.id)) continue;
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      if (type.nucleus.kind === 'none') continue;

      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        const half = c.r * (0.1 + p * 1.0);
        const a = c.splitAngle;
        const cx = Math.cos(a) * half, cy = Math.sin(a) * half;
        const rr = c.r * NUCLEUS_RATIO * (1 - p * 0.2);
        const wob = 1.5 * (1 - p);
        this._drawNucleus(c, c.x - cx + Math.sin(t + c.phase) * wob, c.y - cy + Math.cos(t + c.phase * 0.7) * wob, rr);
        if (p > 0.04) {
          this._drawNucleus(c, c.x + cx + Math.sin(t + c.phase + 1.7) * wob, c.y + cy + Math.cos(t + c.phase * 0.7 + 1.7) * wob, rr);
        }
      } else {
        const wx = c.x + Math.sin(t + c.phase) * 1.8;
        const wy = c.y + Math.cos(t + c.phase * 0.7) * 1.8;
        this._drawNucleus(c, wx, wy, c.r * NUCLEUS_RATIO);
      }
    }
  }

  _drawNucleus(cell, x, y, r) {
    const ctx = this.ctx, cam = this.camera;
    const theme = currentTheme();
    const cc = cellColors(cell);
    ctx.save();
    ctx.lineWidth = Math.max(2, S.outlinePx * 0.6) * (typeof S.lineThickness === 'number' ? S.lineThickness : 1) / cam.scale;
    ctx.strokeStyle = theme.outline.color;
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    let kind = type.nucleus.kind;
    if (kind === 'round-small') { kind = 'round'; r *= 0.7; }

    ctx.fillStyle = cc.nucleus;

    if (kind === 'kidney') {
      const biteAngle = (cell.phase || 0);
      const biteOff = r * 0.6;
      const biteR = r * 0.85;
      const bx = x + Math.cos(biteAngle) * biteOff;
      const by = y + Math.sin(biteAngle) * biteOff;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(bx, by, biteR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      const dx = bx - x, dy = by - y;
      const d = Math.hypot(dx, dy);
      if (d > 0.001 && d < r + biteR && d > Math.abs(r - biteR)) {
        const a = Math.acos((r * r - biteR * biteR + d * d) / (2 * r * d));
        const baseAng = Math.atan2(dy, dx);
        const start = baseAng + a;
        const end = baseAng + Math.PI * 2 - a;
        ctx.arc(x, y, r, start, end);
        const a2 = Math.acos((biteR * biteR - r * r + d * d) / (2 * biteR * d));
        const baseAng2 = Math.atan2(-dy, -dx);
        const start2 = baseAng2 - a2;
        const end2 = baseAng2 + a2;
        ctx.arc(bx, by, biteR, start2, end2, true);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'bilobed') {
      const sep = r * 0.7;
      const lr = r * 0.7;
      const ang = cell.phase || 0;
      const ox = Math.cos(ang) * sep * 0.5;
      const oy = Math.sin(ang) * sep * 0.5;
      ctx.beginPath();
      ctx.arc(x - ox, y - oy, lr, 0, Math.PI * 2);
      ctx.arc(x + ox, y + oy, lr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - ox, y - oy, lr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, lr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - ox - lr * 0.35, y - oy - lr * 0.35, lr * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'multilobed') {
      const lr = r * 0.55;
      const baseAng = cell.phase || 0;
      const radius = r * 0.65;
      const lobes = [];
      for (let i = 0; i < 4; i++) {
        const a = baseAng + (i - 1.5) * 0.7;
        lobes.push({ x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius * 0.4 });
      }
      ctx.beginPath();
      for (const l of lobes) ctx.arc(l.x, l.y, lr, 0, Math.PI * 2);
      ctx.fill();
      for (const l of lobes) {
        ctx.beginPath();
        ctx.arc(l.x, l.y, lr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(lobes[0].x - lr * 0.35, lobes[0].y - lr * 0.35, lr * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Debug ----------
  drawDebug(shapes) {
    const ctx = this.ctx, cam = this.camera;
    this.withCameraCtx(() => {
      ctx.save();
      ctx.lineWidth = 1 / cam.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      for (const b of shapes) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`cells: ${this.sim.cells.length} / ${S.maxCells}  zoom: ${cam.scale.toFixed(2)}×`, 12, 38);
    ctx.restore();
  }
}

// ---------- Static palette-tile preview ----------
// Used by `app.js` to render the small canvases in the help and palette
// dialogs. Kept as a free function (no Sim/camera needed).
export function renderCellPreview(canvasEl, typeKey) {
  const c2 = canvasEl.getContext('2d');
  const w = canvasEl.width, h = canvasEl.height;
  c2.clearRect(0, 0, w, h);
  const fakeCell = {
    id: 1, x: w / 2, y: h / 2, r: w * 0.32,
    type: typeKey,
    vx: 0, vy: 0, state: 'NORMAL',
    splitTimer: 0, splitProgress: 0, splitAngle: 0, bondTimer: 0,
    phase: 0.4, orientation: 0, wobbleSeed: 7, wobbleFreq: 0.7, flash: 0,
  };
  const s = { x: fakeCell.x, y: fakeCell.y, r: fakeCell.r, cell: fakeCell };
  const cc = (CELL_TYPES[typeKey] || CELL_TYPES.neutrophil).colors;
  const theme = currentTheme();
  const t = 0.5;
  const N = 48;
  const path = new Path2D();
  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * Math.PI * 2;
    const v = shapeVertex(s, theta, t);
    if (i === 0) path.moveTo(v.x, v.y);
    else path.lineTo(v.x, v.y);
  }
  path.closePath();
  const grad = c2.createRadialGradient(s.x, s.y - s.r * 0.3, 0, s.x, s.y, s.r * 1.6);
  grad.addColorStop(0, cc.cytoTop);
  grad.addColorStop(1, cc.cytoBot);
  c2.fillStyle = grad;
  c2.fill(path);
  c2.lineWidth = Math.max(2, S.outlinePx);
  c2.strokeStyle = theme.outline.color;
  c2.lineJoin = 'round';
  c2.stroke(path);
  drawPreviewNucleus(c2, fakeCell, s.x, s.y, s.r * NUCLEUS_RATIO, theme);
  drawPreviewDecorations(c2, s, theme, t);
}

// Point-in-polygon ray-cast test. `verts` is a flat (x, y) Float64Array
// of N vertices; tests whether (px, py) is inside the closed polygon.
// Used by 'edge' / 'polygon' metaSplit outline modes to skip segments
// whose midpoint falls inside the partner half (approximate union).
function pointInPoly(px, py, verts) {
  const n = verts.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ix = verts[i * 2], iy = verts[i * 2 + 1];
    const jx = verts[j * 2], jy = verts[j * 2 + 1];
    if (((iy > py) !== (jy > py)) && (px < (jx - ix) * (py - iy) / (jy - iy + 1e-12) + ix)) {
      inside = !inside;
    }
  }
  return inside;
}

function drawPreviewNucleus(c2, cell, x, y, r, theme) {
  const cc = (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
  const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
  let kind = type.nucleus.kind;
  if (kind === 'none') return;
  if (kind === 'round-small') { kind = 'round'; r *= 0.7; }
  c2.save();
  c2.lineWidth = Math.max(2, S.outlinePx * 0.6);
  c2.strokeStyle = theme.outline.color;
  c2.fillStyle = cc.nucleus;
  if (kind === 'round') {
    c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill(); c2.stroke();
  } else if (kind === 'kidney') {
    c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill();
    c2.globalCompositeOperation = 'destination-out';
    c2.beginPath(); c2.arc(x + r * 0.6, y, r * 0.85, 0, Math.PI * 2); c2.fill();
    c2.globalCompositeOperation = 'source-over';
    c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.stroke();
  } else if (kind === 'bilobed') {
    const sep = r * 0.5, lr = r * 0.7;
    c2.beginPath(); c2.arc(x - sep * 0.5, y, lr, 0, Math.PI * 2); c2.arc(x + sep * 0.5, y, lr, 0, Math.PI * 2); c2.fill();
    c2.beginPath(); c2.arc(x - sep * 0.5, y, lr, 0, Math.PI * 2); c2.stroke();
    c2.beginPath(); c2.arc(x + sep * 0.5, y, lr, 0, Math.PI * 2); c2.stroke();
  } else if (kind === 'multilobed') {
    const lr = r * 0.55, R = r * 0.65;
    const lobes = [-1.05, -0.35, 0.35, 1.05].map(a => ({ x: x + Math.cos(a) * R, y: y + Math.sin(a) * R * 0.4 }));
    c2.beginPath();
    for (const l of lobes) c2.arc(l.x, l.y, lr, 0, Math.PI * 2);
    c2.fill();
    for (const l of lobes) { c2.beginPath(); c2.arc(l.x, l.y, lr, 0, Math.PI * 2); c2.stroke(); }
  }
  c2.restore();
}

function drawPreviewDecorations(c2, s, theme, t) {
  const cell = s.cell;
  const cc = (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
  const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
  const kind = type.decoration && type.decoration.kind;
  if (!kind || kind === 'none') return;
  c2.save();
  c2.lineWidth = Math.max(1.5, S.outlinePx * 0.55);
  c2.strokeStyle = theme.outline.color;
  if (kind === 'bigSpikes') {
    c2.fillStyle = cc.accent;
    const N = 8;
    const tipLen = s.r * 0.55, baseHalf = s.r * 0.09;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const base = shapeVertex(s, theta, t);
      const tx = base.x + Math.cos(theta) * tipLen;
      const ty = base.y + Math.sin(theta) * tipLen;
      c2.beginPath();
      c2.moveTo(base.x + Math.cos(theta + Math.PI / 2) * baseHalf, base.y + Math.sin(theta + Math.PI / 2) * baseHalf);
      c2.lineTo(tx, ty);
      c2.lineTo(base.x + Math.cos(theta - Math.PI / 2) * baseHalf, base.y + Math.sin(theta - Math.PI / 2) * baseHalf);
      c2.closePath(); c2.fill(); c2.stroke();
    }
  } else if (kind === 'tendrils') {
    c2.strokeStyle = cc.cytoBot;
    c2.lineCap = 'round';
    const N = 13;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const base = shapeVertex(s, theta, t);
      const len = s.r * 1.2;
      const tx = base.x + Math.cos(theta) * len;
      const ty = base.y + Math.sin(theta) * len;
      const cpX = base.x + Math.cos(theta + 0.4) * len * 0.6;
      const cpY = base.y + Math.sin(theta + 0.4) * len * 0.6;
      c2.beginPath();
      c2.moveTo(base.x, base.y);
      c2.quadraticCurveTo(cpX, cpY, tx, ty);
      c2.stroke();
    }
  } else if (kind === 'yReceptorsFew' || kind === 'yReceptorsMany') {
    c2.strokeStyle = cc.accent;
    c2.lineCap = 'round';
    const count = kind === 'yReceptorsMany' ? 14 : 6;
    const stem = s.r * 0.22, arms = s.r * 0.13, armSpread = Math.PI * 0.25;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      const base = shapeVertex(s, theta, t);
      const tx = base.x + Math.cos(theta) * stem;
      const ty = base.y + Math.sin(theta) * stem;
      c2.beginPath();
      c2.moveTo(base.x, base.y); c2.lineTo(tx, ty);
      c2.moveTo(tx, ty); c2.lineTo(tx + Math.cos(theta + armSpread) * arms, ty + Math.sin(theta + armSpread) * arms);
      c2.moveTo(tx, ty); c2.lineTo(tx + Math.cos(theta - armSpread) * arms, ty + Math.sin(theta - armSpread) * arms);
      c2.stroke();
    }
  }
  c2.restore();
}
