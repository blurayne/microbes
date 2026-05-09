// Microbes — hand-rolled WebGPU renderer.
//
// Companion to assets/render/webgl2.js — same author, same layering,
// using the WebGPU API + WGSL shaders. Independent from Pixi's
// internal WebGPU backend (reachable via the "Pixi (WebGPU)" dropdown
// option).
//
// Phase 2: instanced SDF disks. We now port webgl2.js's VERT_DISK +
// FRAG_DISK to WGSL and draw every cell as an instanced quad with the
// fragment shader doing the same body-shape SDF (round / lobed /
// rippled / oblong / pseudopod / star), nucleus shape, membrane band,
// flash overlay, selection ring + wash. Decorations, cartoon faces,
// dashed-line target marker, particles, debug overlay are still
// deferred — they layer on top in follow-up commits.
//
// Async note: WebGPU's adapter + device requests are async, but the
// IRenderer interface's init() is sync. Mirroring the PixiRenderer
// pattern, init() is a no-op and a separate initAsync() does the real
// work; app.js's makeRenderer awaits it.

import {
  S, CELL_TYPES, currentBackground, currentTheme, currentHighlightColor,
} from '../core/state.js';
import { RendererBase } from './renderer.js';

// ---------- Layout constants (must match WGSL `VsIn` + JS pack loop) ----------
//
// Per-instance layout, 21 floats (84 bytes), identical byte layout to
// the webgl2 instance VBO so shape-pack code reads cleanly across
// renderers:
//   0..3   inst:    (x, y, r, kindAsFloat)
//   4..7   phase:   (phase, seed, freq, wobbleMul)
//   8..10  cytoTop  (rgb)
//  11..13  cytoBot  (rgb)
//  14..16  nucleus  (rgb)
//  17..20  outline  (rgba; .a = c.flash)
const INSTANCE_FLOATS = 21;
const INSTANCE_STRIDE = INSTANCE_FLOATS * 4;

const BODY_KIND_FLOAT = {
  round: 0, lobed: 1, rippled: 2, oblong: 3, pseudopod: 4, star: 5,
};
const NUC_KIND_FLOAT = {
  none: 0, round: 1, kidney: 2, bilobed: 3, multilobed: 4, 'round-small': 5,
};

// ---------- Shaders (WGSL) ----------
// Combined vertex + fragment in one module — identical pixel output to
// webgl2.js's VERT_DISK + FRAG_DISK. Inline comments cross-reference
// the GLSL source where the math diverges only in syntax.
const DISK_WGSL = /* wgsl */ `
struct U {
  // (scale, tx, ty, vw)
  cameraVp: vec4<f32>,
  // (vh, time, wobbleAmp, membraneIntensity)
  misc: vec4<f32>,
  // highlight rgb (alpha unused; padded to 16 bytes)
  highlight: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: U;

struct VsIn {
  @location(0) corner: vec2<f32>,
  @location(1) inst: vec4<f32>,
  @location(2) phase: vec4<f32>,
  @location(3) cytoTop: vec3<f32>,
  @location(4) cytoBot: vec3<f32>,
  @location(5) nucleus: vec3<f32>,
  @location(6) outline: vec4<f32>,
};

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) kind: f32,
  @location(2) phase: vec4<f32>,
  @location(3) cytoTop: vec3<f32>,
  @location(4) cytoBot: vec3<f32>,
  @location(5) nucleus: vec3<f32>,
  @location(6) outline: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
  let scale = u.cameraVp.x;
  let tx = u.cameraVp.y;
  let ty = u.cameraVp.z;
  let vw = u.cameraVp.w;
  let vh = u.misc.x;

  // 1.70× r — covers wobbly body extents (up to ~1.30) plus the
  // selection ring (which extends to 1.30 × bodyR).
  let quadR = in.inst.z * 1.70;
  let worldPos = in.inst.xy + in.corner * quadR;
  let screenPos = worldPos * scale + vec2<f32>(tx, ty);
  var clipPos = (screenPos / vec2<f32>(vw, vh)) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  var out: VsOut;
  out.pos = vec4<f32>(clipPos, 0.0, 1.0);
  out.uv = in.corner * 1.70;
  out.kind = in.inst.w;
  out.phase = in.phase;
  out.cytoTop = in.cytoTop;
  out.cytoBot = in.cytoBot;
  out.nucleus = in.nucleus;
  out.outline = in.outline;
  return out;
}

// kind packs (matches webgl2 FRAG_DISK):
//   body (0..5) + nucleus (0..5) * 16 + selected (0..1) * 256 + hollow (0..1) * 4096
fn bodyKind(k: f32) -> i32 { return i32((k + 0.5) % 16.0); }
fn nucKind(k: f32)  -> i32 { return i32(((k + 0.5) / 16.0) % 16.0); }
fn isSelected(k: f32) -> i32 { return i32(((k + 0.5) / 256.0) % 16.0); }
fn isHollow(k: f32) -> i32 { return i32((k + 0.5) / 4096.0); }

fn bodyScale(uv: vec2<f32>, kindF: f32, ph: vec4<f32>, time: f32, wobbleAmp: f32) -> f32 {
  let kind = bodyKind(kindF);
  let ang = atan2(uv.y, uv.x);
  let phi = ph.x;
  let seed = ph.y;
  let freq = ph.z;
  let wobMul = ph.w;

  var scale: f32 = 1.0;
  var addWob: bool = true;
  let wobShareForLobed: f32 = 0.4;

  if (kind == 1) {
    scale = 1.0 + 0.16 * sin(3.0 * ang + phi) + 0.08 * sin(5.0 * ang + phi * 1.7);
    addWob = true;
  } else if (kind == 2) {
    scale = 1.0 + 0.04 * sin(24.0 * ang + phi) + 0.015 * sin(8.0 * ang + phi * 0.7);
  } else if (kind == 4) {
    scale = 1.0
          + 0.20 * sin(3.0 * ang + 0.8 * time * freq + phi)
          + 0.06 * sin(5.0 * ang - 0.5 * time * freq + seed);
    addWob = false;
  } else if (kind == 5) {
    scale = 0.85 + 0.45 * abs(sin(5.0 * ang + phi));
    addWob = false;
  }

  if (addWob) {
    let w1 = sin(time * 0.55 * freq + ang * 3.0 + seed);
    let w2 = sin(time * 0.85 * freq + ang * 5.0 + seed * 1.31 + phi);
    let wob = wobbleAmp * wobMul * (w1 * 0.65 + w2 * 0.45);
    if (kind == 1) {
      scale = scale + wob * wobShareForLobed;
    } else {
      scale = scale + wob;
    }
  }
  return scale;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let time = u.misc.y;
  let wobbleAmp = u.misc.z;
  let membraneIntensity = u.misc.w;
  let highlight = u.highlight.xyz;

  let d = length(in.uv);
  let bodyR = bodyScale(in.uv, in.kind, in.phase, time, wobbleAmp);
  let sdf = d - bodyR;
  let sel = isSelected(in.kind);

  // Outside the body: glow ring only when selected.
  if (sdf > 0.015) {
    if (sel == 0) { discard; }
    let ringT = sdf / (bodyR * 0.30);
    if (ringT >= 1.0) { discard; }
    let ringA = smoothstep(0.0, 0.20, ringT) * (1.0 - smoothstep(0.65, 1.0, ringT));
    return vec4<f32>(highlight, ringA);
  }

  // Soft body edge AA.
  let bodyA = 1.0 - smoothstep(-0.005, 0.015, sdf);
  if (bodyA <= 0.0) { discard; }

  // Cytoplasm gradient — top-left highlight, body fill toward rim.
  let gradT = clamp(d / max(0.001, bodyR * 0.65), 0.0, 1.0);
  var cyto = mix(in.cytoTop, in.cytoBot, vec3<f32>(gradT));
  let topLift = max(0.0, 0.55 - distance(in.uv, vec2<f32>(-0.30, -0.40))) * 0.65;
  cyto = mix(cyto, in.cytoTop, vec3<f32>(topLift));

  // Donut-hole darkening for cells flagged bodyHollow (RBCs).
  if (isHollow(in.kind) == 1) {
    let holeT = 1.0 - smoothstep(0.0, 0.45, length(in.uv));
    cyto = mix(cyto, in.cytoBot * 0.42, vec3<f32>(holeT * 0.85));
  }

  // Bold membrane band straddling the body edge.
  let outlineMask = smoothstep(-0.06, -0.01, sdf)
                  * (1.0 - smoothstep(0.0, 0.015, sdf))
                  * membraneIntensity;

  // Nucleus shape — driven by per-cell nucKind. uvN is in body-radius units.
  let uvN = in.uv / max(0.001, bodyR);
  let nucK = nucKind(in.kind);
  var nucleusMask: f32 = 0.0;

  if (nucK == 1 || nucK == 5) {
    let r: f32 = select(0.30, 0.21, nucK == 5);
    nucleusMask = 1.0 - smoothstep(r - 0.04, r + 0.02, length(uvN));
  } else if (nucK == 2) {
    let mainM = 1.0 - smoothstep(0.30 - 0.04, 0.30 + 0.02, length(uvN));
    let bite  = 1.0 - smoothstep(0.25 - 0.04, 0.25 + 0.02, length(uvN - vec2<f32>(0.18, 0.0)));
    nucleusMask = clamp(mainM - bite, 0.0, 1.0);
  } else if (nucK == 3) {
    let ang = in.phase.x;
    let off = vec2<f32>(cos(ang), sin(ang)) * 0.10;
    let ma = 1.0 - smoothstep(0.20 - 0.04, 0.20 + 0.02, length(uvN - off));
    let mb = 1.0 - smoothstep(0.20 - 0.04, 0.20 + 0.02, length(uvN + off));
    nucleusMask = max(ma, mb);
  } else if (nucK == 4) {
    let baseAng = in.phase.x;
    var total: f32 = 0.0;
    for (var i: i32 = 0; i < 4; i = i + 1) {
      let fi = f32(i) - 1.5;
      let a = baseAng + fi * 0.7;
      let p = vec2<f32>(cos(a), sin(a) * 0.4) * 0.20;
      total = max(total, 1.0 - smoothstep(0.155 - 0.03, 0.155 + 0.02, length(uvN - p)));
    }
    nucleusMask = total;
  }

  let nucGlint = max(0.0, 0.18 - distance(in.uv, vec2<f32>(-0.10, -0.13))) * 4.0;
  let nucColor = mix(in.nucleus, vec3<f32>(1.0), vec3<f32>(clamp(nucGlint, 0.0, 0.35)));

  var col = cyto;
  col = mix(col, nucColor, vec3<f32>(nucleusMask));
  col = mix(col, in.cytoBot * 0.80, vec3<f32>(clamp(outlineMask, 0.0, 1.0)));

  // Tap flash — c.flash decays in Sim.update(); fade across 200 ms.
  let flashA = clamp(in.outline.a / 0.2, 0.0, 1.0) * 0.6;
  col = mix(col, vec3<f32>(1.0), vec3<f32>(flashA));

  // Selection brighten — translucent highlight wash inside the cell.
  if (sel == 1) {
    col = mix(col, highlight, vec3<f32>(0.30));
  }

  return vec4<f32>(col, bodyA);
}
`;

// ---------- Helpers ----------

function hexToRgb(hex) {
  const h = (hex || '#000').replace('#', '');
  const x = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [
    parseInt(x.slice(0, 2), 16) / 255,
    parseInt(x.slice(2, 4), 16) / 255,
    parseInt(x.slice(4, 6), 16) / 255,
  ];
}

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

    // Disk pipeline + buffers (created in initAsync).
    this._diskPipeline = null;
    this._diskBindGroup = null;
    this._uniformBuffer = null;
    this._uniformData = new Float32Array(12); // (cameraVp, misc, highlight) — 48 bytes
    this._cornerBuffer = null;
    this._instanceBuffer = null;
    this._instanceCapacity = 0;
    this._instanceData = new Float32Array(0);

    // Per-frame transient state (set in beginFrame, cleared in endFrame).
    this._frameEncoder = null;
    this._frameView = null;
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
    context.configure({ device, format, alphaMode: 'opaque' });

    this.device = device;
    this.context = context;
    this.format = format;

    this._buildDiskPipeline();
    this._growInstanceBuffer(64);
  }

  _buildDiskPipeline() {
    const device = this.device;

    const module = device.createShaderModule({ code: DISK_WGSL });

    // Static unit-square corners (two triangles).
    const corners = new Float32Array([
      -1, -1,   1, -1,   -1,  1,
       1, -1,   1,  1,   -1,  1,
    ]);
    this._cornerBuffer = device.createBuffer({
      size: corners.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._cornerBuffer, 0, corners);

    // Uniform buffer (48 bytes).
    this._uniformBuffer = device.createBuffer({
      size: this._uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this._diskPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
            ],
          },
          {
            arrayStride: INSTANCE_STRIDE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0,  format: 'float32x4' }, // a_inst
              { shaderLocation: 2, offset: 16, format: 'float32x4' }, // a_phase
              { shaderLocation: 3, offset: 32, format: 'float32x3' }, // a_cytoTop
              { shaderLocation: 4, offset: 44, format: 'float32x3' }, // a_cytoBot
              { shaderLocation: 5, offset: 56, format: 'float32x3' }, // a_nucleus
              { shaderLocation: 6, offset: 68, format: 'float32x4' }, // a_outline
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            // Match webgl2's gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA).
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._diskBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
    });
  }

  _growInstanceBuffer(targetCount) {
    if (targetCount <= this._instanceCapacity) return;
    const newCap = Math.max(64, Math.ceil(targetCount * 1.5));
    this._instanceData = new Float32Array(newCap * INSTANCE_FLOATS);
    this._instanceCapacity = newCap;
    if (this._instanceBuffer) this._instanceBuffer.destroy();
    this._instanceBuffer = this.device.createBuffer({
      size: this._instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
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

  beginFrame(/* timeMs, dt */) {
    if (!this.device || !this.context) return;
    this._frameEncoder = this.device.createCommandEncoder();
    const tex = this.context.getCurrentTexture();
    this._frameView = tex.createView();
  }

  drawBackground(/* timeMs */) {
    if (!this._frameEncoder || !this._frameView) return;
    const bg = currentBackground();
    // Skeleton: solid clear. Gradient backgrounds collapse to the top
    // colour for now; a vertex-shader-driven gradient + spots / decor
    // lands in a follow-up commit.
    const cssColor = (bg.kind === 'gradient' && bg.topColor) ? bg.topColor : (bg.base || '#0a0612');
    const clearValue = cssToGpuColor(cssColor);
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{
        view: this._frameView,
        clearValue,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
  }

  drawCells(shapes, time /*, timeMs */) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!shapes || shapes.length === 0) return;
    const device = this.device;

    this._growInstanceBuffer(shapes.length);
    const data = this._instanceData;
    const outlineRgb = hexToRgb(currentTheme().outline.color);
    const sel = this.sim.selectedCells;
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      const c = s.cell;
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const cc = type.colors;
      const top = hexToRgb(cc.cytoTop);
      const bot = hexToRgb(cc.cytoBot);
      const nuc = hexToRgb(cc.nucleus);
      const bodyK = BODY_KIND_FLOAT[(type.body && type.body.kind) || 'round'] || 0;
      const nucK = NUC_KIND_FLOAT[(type.nucleus && type.nucleus.kind) || 'none'] || 0;
      const isSel = sel.has(c) ? 1 : 0;
      const hollow = type.bodyHollow ? 1 : 0;
      const kind = bodyK + nucK * 16 + isSel * 256 + hollow * 4096;
      const wobMul = (type.field && type.field.wobbleMul) || 1.0;
      const j = i * INSTANCE_FLOATS;
      data[j]      = s.x;
      data[j + 1]  = s.y;
      data[j + 2]  = s.r;
      data[j + 3]  = kind;
      data[j + 4]  = c.phase || 0;
      data[j + 5]  = c.wobbleSeed || 0;
      data[j + 6]  = c.wobbleFreq || 1;
      data[j + 7]  = wobMul;
      data[j + 8]  = top[0]; data[j + 9]  = top[1]; data[j + 10] = top[2];
      data[j + 11] = bot[0]; data[j + 12] = bot[1]; data[j + 13] = bot[2];
      data[j + 14] = nuc[0]; data[j + 15] = nuc[1]; data[j + 16] = nuc[2];
      data[j + 17] = outlineRgb[0]; data[j + 18] = outlineRgb[1]; data[j + 19] = outlineRgb[2];
      data[j + 20] = c.flash || 0;
    }
    device.queue.writeBuffer(
      this._instanceBuffer, 0,
      data.buffer, data.byteOffset, shapes.length * INSTANCE_STRIDE,
    );

    // Pack uniform buffer: cameraVp, misc, highlight.
    const u = this._uniformData;
    const cam = this.camera;
    u[0] = cam.scale; u[1] = cam.tx; u[2] = cam.ty; u[3] = this.W;
    u[4] = this.H;
    u[5] = time;
    u[6] = S.wobbleAmp || 0;
    u[7] = (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55;
    const hl = hexToRgb(currentHighlightColor());
    u[8] = hl[0]; u[9] = hl[1]; u[10] = hl[2]; u[11] = 0;
    device.queue.writeBuffer(this._uniformBuffer, 0, u.buffer, u.byteOffset, u.byteLength);

    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{
        view: this._frameView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this._diskPipeline);
    pass.setBindGroup(0, this._diskBindGroup);
    pass.setVertexBuffer(0, this._cornerBuffer);
    pass.setVertexBuffer(1, this._instanceBuffer);
    pass.draw(6, shapes.length, 0, 0);
    pass.end();
  }

  // Decorations, cartoon faces, dashed-line target marker, particles,
  // and debug overlay are deferred. The selection ring + brighten wash
  // *are* already inline in the disk fragment shader, so drawSelection
  // is a no-op here (the equivalent webgl2.js path also folds the ring
  // into the disk pass via the `sel` packed bit).
  drawSelection(/* shapes, time */) {}

  endFrame() {
    if (!this._frameEncoder) return;
    this.device.queue.submit([this._frameEncoder.finish()]);
    this._frameEncoder = null;
    this._frameView = null;
  }

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() { return 'webgpu'; }

  destroy() {
    this._destroyed = true;
    if (this.context) {
      try { this.context.unconfigure(); } catch {}
      this.context = null;
    }
    if (this._instanceBuffer) { try { this._instanceBuffer.destroy(); } catch {} }
    if (this._cornerBuffer)   { try { this._cornerBuffer.destroy(); }   catch {} }
    if (this._uniformBuffer)  { try { this._uniformBuffer.destroy(); }  catch {} }
    this._instanceBuffer = null;
    this._cornerBuffer = null;
    this._uniformBuffer = null;
    this._diskPipeline = null;
    this._diskBindGroup = null;
    if (this.device) {
      try { this.device.destroy(); } catch {}
      this.device = null;
    }
    this.format = null;
  }
}
