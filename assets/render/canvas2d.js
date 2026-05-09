// Microbes — Canvas2D renderer.
//
// All Canvas2D-specific drawing lives here. The class implements the renderer
// interface used by `app.js`: init / resize / setCamera / drawBackground /
// drawCells / drawSelection / drawDebug. The `Sim` instance owns the cells
// and camera; the renderer reads from it but never mutates it.

import {
  S, FACE, CELL_TYPES, NUCLEUS_RATIO, WOBBLE_VERTS, THETA_TABLE, DOWNSAMPLE,
  cellColors, currentTheme, currentBackground, currentHighlightColor, hexToRgba, frac,
} from '../core/state.js';
import { shapeVertex, splitVirtualCenters } from '../core/shape.js';
import { RendererBase } from './renderer.js';

/**
 * Canvas2D implementation of the IRenderer interface (see renderer.js).
 *
 * @implements {import('./renderer.js').IRenderer}
 */
export class Canvas2DRenderer extends RendererBase {
  constructor(canvas, sim) {
    super(canvas, sim);
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.off2 = document.createElement('canvas');
    this.off2Ctx = this.off2.getContext('2d');
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
    const ow = Math.max(2, Math.floor(W * DOWNSAMPLE * rs));
    const oh = Math.max(2, Math.floor(H * DOWNSAMPLE * rs));
    this.off.width = ow; this.off.height = oh;
    this.off2.width = ow; this.off2.height = oh;
  }

  // The renderer reads camera/W/H from the Sim each frame.
  get camera() { return this.sim.camera; }

  withCameraCtx(fn) {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.save();
    ctx.transform(cam.scale, 0, 0, cam.scale, cam.tx, cam.ty);
    try { fn(); } finally { ctx.restore(); }
  }

  beginFrame() { /* no-op for Canvas2D */ }
  endFrame() { /* no-op for Canvas2D */ }

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() { return 'canvas2d'; }

  // ---------- Background ----------
  drawBackground(ts) {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const cam = this.camera;
    const bg = currentBackground();

    if (bg.kind === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg.topColor);
      g.addColorStop(1, bg.botColor);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg.base;
    }
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.transform(cam.scale, 0, 0, cam.scale, cam.tx, cam.ty);
    const wx = -cam.tx / cam.scale;
    const wy = -cam.ty / cam.scale;
    const ww = W / cam.scale;
    const wh = H / cam.scale;

    if (bg.kind === 'agar') {
      ctx.save();
      ctx.strokeStyle = bg.ringColor || 'rgba(120,80,30,0.10)';
      ctx.lineWidth = 1 / cam.scale;
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
      ctx.save();
      const t2 = ts * 0.00025 * S.bgFlowSpeed;
      const N = 22;
      ctx.lineWidth = 1.4 / cam.scale;
      for (let i = 0; i < N; i++) {
        const seed = i * 1.31;
        const fx = ((i / N) + 0.06 * Math.sin(t2 + seed)) % 1;
        const fy = (frac(seed * 0.7 + t2 * 0.6 + i * 0.13)) % 1;
        const px = fx * W;
        const py = fy * H;
        const r = 18 + 16 * frac(seed * 0.21);
        ctx.fillStyle = 'rgba(255,90,90,0.10)';
        ctx.strokeStyle = 'rgba(255,140,140,0.18)';
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.78, seed, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(120,20,20,0.18)';
        ctx.beginPath();
        ctx.arc(px, py, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (bg.decor) this._drawAnatomyDecor(ts, bg.decor);

    if (bg.kind === 'cybergrid') {
      ctx.save();
      const step = bg.gridStep || 48;
      ctx.strokeStyle = bg.gridColor || 'rgba(0,255,170,0.15)';
      ctx.lineWidth = 1 / cam.scale;
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
    const sc = cam.scale;
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

  // ---------- Cells (full pipeline: mask → outline → cyto → highlight → granules → decorations → membrane → nuclei → cartoon) ----------
  drawCells(shapes, time, ts) {
    this._drawMetaballMask(shapes, time);
    this._drawMetaballToMain(shapes, time);
    this._drawNuclei(ts);
    this._drawCartoonFaces(shapes, time);
  }

  _drawMetaballMask(shapes, t) {
    const off = this.off, off2 = this.off2;
    const offCtx = this.offCtx, off2Ctx = this.off2Ctx;
    const ow = off.width, oh = off.height;
    const W = this.W;
    const sx = ow / W;
    const cam = this.camera;
    const cs = cam.scale, cTx = cam.tx, cTy = cam.ty;
    const N = WOBBLE_VERTS;

    const groups = {};
    for (const s of shapes) (groups[s.cell.type] ||= []).push(s);

    off2Ctx.setTransform(1, 0, 0, 1, 0, 0);
    off2Ctx.globalCompositeOperation = 'copy';
    off2Ctx.filter = 'none';
    off2Ctx.clearRect(0, 0, off2.width, off2.height);
    off2Ctx.globalCompositeOperation = 'source-over';

    for (const [typeKey, group] of Object.entries(groups)) {
      const field = (CELL_TYPES[typeKey] && CELL_TYPES[typeKey].field) || { blur: 6, contrast: 20 };
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.globalCompositeOperation = 'source-over';
      offCtx.filter = 'none';
      offCtx.clearRect(0, 0, ow, oh);
      offCtx.fillStyle = '#ffffff';
      for (const s of group) {
        offCtx.beginPath();
        for (let i = 0; i <= N; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], t);
          const px = (v.x * cs + cTx) * sx;
          const py = (v.y * cs + cTy) * sx;
          if (i === 0) offCtx.moveTo(px, py);
          else offCtx.lineTo(px, py);
        }
        offCtx.closePath();
        offCtx.fill();
      }
      offCtx.globalCompositeOperation = 'copy';
      offCtx.filter = `blur(${field.blur}px) contrast(${field.contrast})`;
      offCtx.drawImage(off, 0, 0);
      offCtx.filter = 'none';
      offCtx.globalCompositeOperation = 'source-over';
      off2Ctx.globalCompositeOperation = 'source-over';
      off2Ctx.drawImage(off, 0, 0);
    }
  }

  _tintMask(color) {
    const offCtx = this.offCtx;
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'copy';
    offCtx.filter = 'none';
    offCtx.drawImage(this.off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-in';
    if (typeof color === 'function') {
      color(offCtx, this.off.width, this.off.height);
    } else {
      offCtx.fillStyle = color;
      offCtx.fillRect(0, 0, this.off.width, this.off.height);
    }
    offCtx.globalCompositeOperation = 'source-over';
  }

  _drawMetaballToMain(shapes, t) {
    const ctx = this.ctx;
    const off = this.off, off2 = this.off2;
    const offCtx = this.offCtx;
    const W = this.W, H = this.H;
    const cam = this.camera;
    const theme = currentTheme();
    const px = S.outlinePx;

    const offsets = [
      [-px, 0], [px, 0], [0, -px], [0, px],
      [-px, -px], [px, px], [-px, px], [px, -px],
    ];
    this._tintMask(theme.outline.color);
    for (const [dx, dy] of offsets) {
      ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, W, H);
    }

    const sx = off.width / W;
    const cs = cam.scale, cTx = cam.tx, cTy = cam.ty;
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, off.width, off.height);
    offCtx.globalCompositeOperation = S.blendMode || 'source-over';
    for (const cell of this.sim.cells) {
      const subs = (cell.state === 'SPLITTING')
        ? splitVirtualCenters(cell)
        : [{ x: cell.x, y: cell.y, r: cell.r }];
      const cc = cellColors(cell);
      const cType = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
      const hollow = !!cType.bodyHollow;
      for (const b of subs) {
        const cx = (b.x * cs + cTx) * sx;
        const cy = (b.y * cs + cTy) * sx;
        const r = b.r * 1.95 * cs * sx;
        const g = offCtx.createRadialGradient(cx, cy - r * 0.18, 0, cx, cy, r);
        g.addColorStop(0,    cc.cytoTop);
        g.addColorStop(0.55, cc.cytoBot);
        g.addColorStop(1,    cc.cytoBotTransp || hexToRgba(cc.cytoBot, 0));
        offCtx.fillStyle = g;
        offCtx.beginPath();
        offCtx.arc(cx, cy, r, 0, Math.PI * 2);
        offCtx.fill();
        // Donut-hole effect for cells flagged bodyHollow (e.g. RBCs).
        // Paint a smaller darker radial gradient on top, sinking the
        // centre toward cytoBot.
        if (hollow) {
          const innerR = b.r * 0.55 * cs * sx;
          const g2 = offCtx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
          g2.addColorStop(0, hexToRgba(cc.cytoBot, 0.78));
          g2.addColorStop(1, hexToRgba(cc.cytoBot, 0));
          offCtx.fillStyle = g2;
          offCtx.beginPath();
          offCtx.arc(cx, cy, innerR, 0, Math.PI * 2);
          offCtx.fill();
        }
      }
    }
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);

    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.clearRect(0, 0, off.width, off.height);
    for (const cell of this.sim.cells) {
      const subs = (cell.state === 'SPLITTING')
        ? splitVirtualCenters(cell)
        : [{ x: cell.x, y: cell.y, r: cell.r }];
      const cc = cellColors(cell);
      for (const b of subs) {
        const x = ((b.x - b.r * 0.35) * cs + cTx) * sx;
        const y = ((b.y - b.r * 0.45) * cs + cTy) * sx;
        const r = b.r * 0.75 * cs * sx;
        const g = offCtx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, cc.nucleusHi);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = g;
        offCtx.beginPath();
        offCtx.arc(x, y, r, 0, Math.PI * 2);
        offCtx.fill();
      }
    }
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
    ctx.globalAlpha = 1.0;

    this._drawGranules(shapes, theme, t);
    this._drawDecorations(shapes, theme, t);
    this._drawMembrane(shapes, t, theme);
  }

  _drawMembrane(shapes, t, theme) {
    const ctx = this.ctx;
    const cam = this.camera;
    const a = (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55;
    if (a <= 0 || shapes.length === 0) return;
    this.withCameraCtx(() => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = a;
      // Bold membrane in each cell's own deep cytoBot colour — accentuates
      // the cell's identity instead of the single shared theme outline.
      ctx.lineWidth = Math.max(2, S.outlinePx * 0.85) / cam.scale;
      const N = WOBBLE_VERTS;
      for (const s of shapes) {
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
    const offCtx = this.offCtx;
    const off = this.off, off2 = this.off2;
    const W = this.W, H = this.H;
    const cam = this.camera;

    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, off.width, off.height);

    const sx = off.width / W;
    const cs = cam.scale, cTx = cam.tx, cTy = cam.ty;
    for (const s of shapes) {
      const c = s.cell;
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const N = type.granules || 0;
      if (N === 0) continue;
      const seed = c.id * 9.7 + (c.wobbleSeed || 0);
      const isBig = c.type === 'basophil';
      const baseSize = isBig ? 0.115 : 0.05;
      const sizeJitter = isBig ? 0.05 : 0.04;
      const cc = cellColors(c);
      offCtx.fillStyle = cc.nucleus;
      offCtx.globalAlpha = isBig ? 0.85 : 0.55;
      for (let i = 0; i < N; i++) {
        const ang = frac(seed * 1.3 + i * 0.61) * Math.PI * 2;
        const rRel = 0.05 + 0.85 * Math.sqrt(frac(seed + i * 0.317));
        const wob = 0.04 * Math.sin(t * 0.5 + i + seed);
        const wx = s.x + Math.cos(ang) * s.r * (rRel + wob);
        const wy = s.y + Math.sin(ang) * s.r * (rRel + wob);
        const x = (wx * cs + cTx) * sx;
        const y = (wy * cs + cTy) * sx;
        const r = s.r * (baseSize + sizeJitter * frac(seed * 1.7 + i * 0.13)) * cs * sx;
        offCtx.beginPath();
        offCtx.arc(x, y, r, 0, Math.PI * 2);
        offCtx.fill();
      }
    }
    offCtx.globalAlpha = 1;
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
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
    ctx.lineWidth = Math.max(1.5, px * 0.7) / cam.scale;
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
    ctx.lineWidth = Math.max(1.5, px * 0.5) / cam.scale;
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
    ctx.lineWidth = Math.max(1.2, px * 0.4) / cam.scale;
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
    ctx.lineWidth = Math.max(1.5, px * 0.7) / cam.scale;
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
    ctx.lineWidth = Math.max(2, px * 0.7) / cam.scale;
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
    ctx.lineWidth = Math.max(2, px * 0.6) / cam.scale;
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
    ctx.lineWidth = Math.max(1.5, S.outlinePx * 0.5) / cam.scale;
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
    ctx.lineWidth = Math.max(2, px * 0.6) / cam.scale;
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
    ctx.lineWidth = Math.max(1.4, px * 0.4) / cam.scale;
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
        if (!cfg.eyes && cfg.mouth === 'none') continue;

        if (now > c.nextBlink) c.nextBlink = now + 120 + 3000 + Math.random() * 3500;
        const blinking = (c.nextBlink - now) < 120 && (c.nextBlink - now) > 0;

        const cx = c.x;
        const cy = c.y;
        let lookX = c.vx, lookY = c.vy;
        if (c.alarmTimer > 0 && c.alarmTarget && c.alarmTarget.state === 'NORMAL') {
          lookX = c.alarmTarget.x - cx;
          lookY = c.alarmTarget.y - cy;
        }
        const lm = Math.hypot(lookX, lookY) || 1;

        ctx.save();
        ctx.lineWidth = lw;
        ctx.strokeStyle = theme.outline.color;

        if (cfg.eyes >= 1) {
          const FACE_SCALE = 1.2;
          const eyeR = c.r * cfg.eyeR * FACE_SCALE;
          const eyeY = cy + c.r * cfg.eyeY;
          const pupilR = c.r * cfg.pupilR * FACE_SCALE;
          const pupilOff = eyeR * 0.45;
          const pdx = (lookX / lm) * pupilOff;
          const pdy = (lookY / lm) * pupilOff;
          const eyeXs = cfg.eyes === 2
            ? [cx - c.r * 0.22 * FACE_SCALE, cx + c.r * 0.22 * FACE_SCALE]
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

        if (cfg.mouth && cfg.mouth !== 'none') {
          const mY = cy + c.r * 0.18;
          const mW = c.r * 0.34 * 1.2;
          const cc = cellColors(c);
          ctx.lineWidth = lw * 1.3;
          ctx.strokeStyle = cc.nucleus;
          ctx.fillStyle = cc.nucleus;
          if (cfg.mouth === 'smile') {
            ctx.beginPath();
            ctx.arc(cx, mY - mW * 0.3, mW, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
          } else if (cfg.mouth === 'frown') {
            ctx.beginPath();
            ctx.arc(cx, mY + mW * 0.6, mW, 1.12 * Math.PI, 1.88 * Math.PI);
            ctx.stroke();
          } else if (cfg.mouth === 'snarl') {
            ctx.beginPath();
            const N = 5;
            for (let i = 0; i <= N; i++) {
              const x = cx - mW + (2 * mW) * (i / N);
              const y = mY + (i % 2 === 0 ? 0 : mW * 0.18);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          } else if (cfg.mouth === 'fangs') {
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
          } else if (cfg.mouth === 'tongue') {
            ctx.beginPath();
            ctx.ellipse(cx, mY, mW, mW * 0.40, 0, 0, Math.PI * 2);
            ctx.fill();
            const wag = Math.sin(t * 5 + c.phase) * mW * 0.18;
            ctx.fillStyle = '#ff8aa0';
            ctx.beginPath();
            ctx.ellipse(cx + wag, mY + mW * 0.30, mW * 0.32, mW * 0.22, 0, 0, Math.PI * 2);
            ctx.fill();
          } else if (cfg.mouth === 'drool') {
            ctx.beginPath();
            ctx.arc(cx, mY - mW * 0.3, mW, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
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
        ctx.lineWidth = Math.max(2, S.outlinePx * 1.4) / cam.scale;
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
  _drawNuclei(ts) {
    const ctx = this.ctx;
    const t = ts * 0.001;
    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.globalAlpha = 0.78;
    this.withCameraCtx(() => this._drawNucleiInner(ts, t));
    ctx.restore();
  }

  _drawNucleiInner(ts, t) {
    for (const c of this.sim.cells) {
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
    ctx.lineWidth = Math.max(2, S.outlinePx * 0.6) / cam.scale;
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
