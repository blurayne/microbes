// Microbes — hand-rolled WebGPU renderer.
//
// Companion to assets/render/webgl2.js — same author, same layering,
// using the WebGPU API + WGSL shaders. Independent from Pixi's
// internal WebGPU backend (reachable via the "Pixi (WebGPU)" dropdown
// option). Exposed in the dropdown as "WebGPU (legacy)" alongside our
// hand-rolled WebGL2 renderer.
//
// Phase 1 SKELETON: this commit lands the renderer plumbing — boots,
// requests an adapter + device, configures the canvas context, and
// clears to the active theme background colour each frame. No cells
// rendered yet. Reaching parity with webgl2.js (instanced SDF disks,
// decorations, nuclei, cartoon faces, selection ring, target marker)
// is a follow-up sequence of commits.
//
// Async note: WebGPU's adapter + device requests are async, but the
// IRenderer interface's init() is sync. Mirroring the PixiRenderer
// pattern, init() is a no-op and a separate initAsync() does the real
// work; app.js's makeRenderer awaits it.

import { currentBackground } from '../core/state.js';
import { RendererBase } from './renderer.js';

// Parse a CSS hex / rgba colour string into the {r,g,b,a} 0..1 form
// WebGPU's clearValue expects. Returns a sensible fallback on garbage.
function cssToGpuColor(css, fallback = { r: 0, g: 0, b: 0, a: 1 }) {
  if (!css || typeof css !== 'string') return fallback;
  const s = css.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if (Number.isFinite(r + g + b + a)) return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (Number.isFinite(r + g + b + a)) return { r, g, b, a };
    }
  }
  const m = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i);
  if (m) {
    return {
      r: parseFloat(m[1]) / 255,
      g: parseFloat(m[2]) / 255,
      b: parseFloat(m[3]) / 255,
      a: m[4] !== undefined ? parseFloat(m[4]) : 1,
    };
  }
  return fallback;
}

/**
 * @implements {import('./renderer.js').IRenderer}
 */
export class WebGPURenderer extends RendererBase {
  constructor(canvas, sim) {
    super(canvas, sim);
    /** @type {GPUDevice|null} */
    this.device = null;
    /** @type {GPUCanvasContext|null} */
    this.context = null;
    /** @type {GPUTextureFormat|null} */
    this.format = null;
    this._destroyed = false;
  }

  /** Synchronous init is a no-op; initAsync() does the real work. */
  init() { /* see initAsync() */ }

  async initAsync() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      throw new Error('WebGPU not available (navigator.gpu missing)');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU: no adapter');
    const device = await adapter.requestDevice();
    if (this._destroyed) { device.destroy(); return; }

    const context = this.canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU: canvas.getContext("webgpu") returned null');

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
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
    const r = Math.min(dpr || 1, 2) * rs;
    const wPx = Math.max(2, Math.floor(W * r));
    const hPx = Math.max(2, Math.floor(H * r));
    this.canvas.width = wPx;
    this.canvas.height = hPx;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    // Re-configure to match new size; format / device unchanged.
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
  }

  beginFrame(/* timeMs, dt */) { /* no-op; clear happens in drawBackground */ }

  drawBackground(/* timeMs */) {
    if (!this.device || !this.context) return;
    const bg = currentBackground();
    // Skeleton: solid clear. Gradient backgrounds collapse to the top
    // colour for now; a vertex-shader-driven gradient + spots / decor
    // lands in a follow-up commit.
    const cssColor = (bg.kind === 'gradient' && bg.topColor) ? bg.topColor : (bg.base || '#0a0612');
    const clearValue = cssToGpuColor(cssColor);

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  // Cell + selection + debug + particle rendering are deferred to the
  // next commits. RendererBase's no-op defaults handle them for now.

  endFrame() { /* nothing to flush; drawBackground submits its own pass */ }

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() { return 'webgpu'; }

  destroy() {
    this._destroyed = true;
    if (this.context) {
      try { this.context.unconfigure(); } catch {}
      this.context = null;
    }
    if (this.device) {
      try { this.device.destroy(); } catch {}
      this.device = null;
    }
    this.format = null;
  }
}
