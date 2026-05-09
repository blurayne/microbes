// Microbes — WebGPU renderer (skeleton).
//
// Hand-rolled WebGPU implementation of the IRenderer interface,
// modelled on assets/render/webgl2.js. This is the *skeleton*
// commit: the renderer boots, configures the swapchain, clears
// the canvas to the active theme's background colour each frame,
// and reports its `info` for the FPS overlay. Cell rendering, the
// instanced SDF disk, decorations, nuclei, faces, selection ring
// — all deferred to follow-up commits that port webgl2.js's
// VERT_DISK + FRAG_DISK to WGSL one chunk at a time.
//
// The Pixi (WebGPU) option in the renderer dropdown is independent
// from this — it routes through Pixi v8's internal WebGPU backend.
// This file is for users who want a side-by-side comparison with
// the hand-rolled WebGL2 renderer.

import {
  S, currentBackground, currentTheme, hexToRgba,
} from '../core/state.js';
import { RendererBase } from './renderer.js';

// Parse a CSS hex / rgba() string into a WebGPU GPUColor record
// { r, g, b, a } with components in [0, 1]. Falls back to opaque
// black for malformed input. Mirrors how canvas2D's fillStyle =
// '#xxxxxx' / 'rgba(...)' parses.
function parseColor(input) {
  const out = { r: 0, g: 0, b: 0, a: 1 };
  if (!input) return out;
  if (typeof input !== 'string') return out;
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6 || hex.length === 8) {
      out.r = parseInt(hex.slice(0, 2), 16) / 255;
      out.g = parseInt(hex.slice(2, 4), 16) / 255;
      out.b = parseInt(hex.slice(4, 6), 16) / 255;
      out.a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    }
  } else if (s.startsWith('rgba') || s.startsWith('rgb')) {
    const m = s.match(/-?\d*\.?\d+/g);
    if (m && m.length >= 3) {
      out.r = +m[0] / 255;
      out.g = +m[1] / 255;
      out.b = +m[2] / 255;
      out.a = m.length >= 4 ? +m[3] : 1;
    }
  }
  return out;
}

/**
 * WebGPU implementation of the IRenderer interface (see renderer.js).
 *
 * @implements {import('./renderer.js').IRenderer}
 */
export class WebGPURenderer extends RendererBase {
  constructor(canvas, sim) {
    super(canvas, sim);
    /** @type {GPUDevice|null} */
    this.device = null;
    /** @type {GPUCanvasContext|null} */
    this.context = null;
    /** @type {GPUTextureFormat} */
    this.format = 'bgra8unorm';
    this._destroyed = false;
  }

  /**
   * Synchronous IRenderer.init is a no-op; the real work needs an
   * adapter + device, both async. app.js awaits initAsync() before
   * resize() / frame() so the renderer is always ready.
   */
  init() { /* see initAsync() */ }

  async initAsync() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      throw new Error('WebGPU not available (navigator.gpu missing)');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (this._destroyed) return;
    if (!adapter) throw new Error('WebGPU adapter request returned null');

    const device = await adapter.requestDevice();
    if (this._destroyed) {
      try { device.destroy(); } catch {}
      return;
    }

    const context = this.canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU context unavailable on canvas');

    const format = navigator.gpu.getPreferredCanvasFormat
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'bgra8unorm';
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
    });

    // Fail fast if the device gets lost — surfaces the reason in
    // DevTools so a user can tell whether a missing frame is a
    // GPU-driver issue vs. a code bug here.
    device.lost.then((info) => {
      if (this._destroyed) return;
      console.warn('[microbes] WebGPU device lost:', info && info.message);
    });

    this.device = device;
    this.context = context;
    this.format = format;
  }

  resize(W, H, dpr, renderScale) {
    this.W = W; this.H = H;
    this.dpr = dpr; this.renderScale = renderScale;
    if (!this.device || !this.context) return;
    const rs = Math.max(0.125, Math.min(1, renderScale || 1));
    const bw = Math.max(2, Math.floor(W * Math.min(dpr || 1, 2) * rs));
    const bh = Math.max(2, Math.floor(H * Math.min(dpr || 1, 2) * rs));
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    // The configured context auto-resizes its swap-chain to the
    // canvas backing-store; nothing extra to do here.
  }

  beginFrame(/* timeMs, dt */) { /* render begins inside drawBackground */ }

  drawBackground(/* timeMs */) {
    if (!this.device || !this.context) return;
    // Skeleton: just clear to the active background base / topColor.
    // Real gradient / spots / vignette / decor land in follow-ups.
    const bg = currentBackground();
    let color = '#0a0612';
    if (bg) {
      if (bg.kind === 'gradient' && bg.topColor) color = bg.topColor;
      else if (bg.base) color = bg.base;
    }
    const c = parseColor(color);

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: c,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  // Cell rendering, decorations, nuclei, cartoon faces, particles,
  // selection ring, target marker, debug overlay — all deferred.
  // Stubs match the IRenderer interface so app.js doesn't have to
  // special-case the skeleton state.
  drawCells(/* shapes, time, ts */) {}
  drawParticles(/* particles, time, ts */) {}
  drawSelection(/* shapes, time */) {}
  drawDebug(/* shapes */) {}

  endFrame() {
    // Background pass already submitted in drawBackground while the
    // skeleton has nothing to layer on top. Real follow-up commits
    // will move the encoder into beginFrame and submit here.
  }

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() { return 'webgpu'; }

  destroy() {
    this._destroyed = true;
    try {
      if (this.context) this.context.unconfigure?.();
    } catch {}
    if (this.device) {
      try { this.device.destroy(); }
      catch (e) { console.warn('[microbes] WebGPURenderer destroy:', e && e.message); }
    }
    this.device = null;
    this.context = null;
  }
}
