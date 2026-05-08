// Microbes — WebGL2 renderer.
//
// Implements IRenderer using WebGL2. This is the Phase-4 *skeleton*:
// it clears to the background base colour, draws each cell as a
// smooth instanced disk in its cytoBot colour, and respects camera
// pan/zoom. Outline / metaball pipeline / decorations / nuclei /
// cartoon faces / selection are stubbed and will land in later
// Phase-4 sub-steps.
//
// All shader source is inline JS template strings — no external .glsl
// files, no build step.

import {
  S, CELL_TYPES, currentBackground, currentTheme,
} from '../core/state.js';
import { RendererBase } from './renderer.js';

// Each cell is one instanced quad. The shader computes a soft disk +
// radial gradient (cytoTop at top, cytoBot at the body), a thin
// outline ring, and an inner nucleus indicator. This is a "close-
// enough" approximation of the Canvas2D metaball + outline + nucleus
// passes, all in one draw call.
const VERT_DISK = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;       // unit-square corner in [-1,1]
layout(location=1) in vec4 a_inst;         // (worldX, worldY, r, _)
layout(location=2) in vec3 a_cytoTop;
layout(location=3) in vec3 a_cytoBot;
layout(location=4) in vec3 a_nucleus;
layout(location=5) in vec3 a_outline;

uniform vec3 u_camera;                      // (scale, tx, ty)
uniform vec2 u_viewport;                    // (W, H) in CSS px

out vec2 v_uv;
out vec3 v_cytoTop;
out vec3 v_cytoBot;
out vec3 v_nucleus;
out vec3 v_outline;

void main() {
  // 1.05× quad so the soft edge isn't clipped.
  vec2 worldPos = a_inst.xy + a_corner * a_inst.z * 1.05;
  vec2 screenPos = worldPos * u_camera.x + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_corner * 1.05;     // -1.05..+1.05; disc ends at length 1.0
  v_cytoTop = a_cytoTop;
  v_cytoBot = a_cytoBot;
  v_nucleus = a_nucleus;
  v_outline = a_outline;
}`;

const FRAG_DISK = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_cytoTop;
in vec3 v_cytoBot;
in vec3 v_nucleus;
in vec3 v_outline;
out vec4 outColor;
void main() {
  float d = length(v_uv);
  if (d > 1.02) discard;

  // Cytoplasm radial gradient: highlight (cytoTop) toward upper-left,
  // body fill (cytoBot) elsewhere, fades softly toward the rim.
  float gradT = clamp((d - 0.0) / 0.65, 0.0, 1.0);
  vec3 cyto = mix(v_cytoTop, v_cytoBot, gradT);
  // Lift the highlight further toward the top-left like the C2D pass.
  float topLift = max(0.0, 0.6 - distance(v_uv, vec2(-0.3, -0.4))) * 0.6;
  cyto = mix(cyto, v_cytoTop, topLift);

  // Thin outline at the rim (0.86..1.0), darkening to v_outline.
  float outlineMask = smoothstep(0.86, 0.96, d);

  // Nucleus blob (radius ~0.30 of the cell, soft edge).
  float nucleusMask = 1.0 - smoothstep(0.26, 0.34, d);
  // Soft inner highlight on the nucleus (top-left dot).
  float nucGlint = max(0.0, 0.18 - distance(v_uv, vec2(-0.10, -0.13))) * 4.0;
  vec3 nucColor = mix(v_nucleus, vec3(1.0), clamp(nucGlint, 0.0, 0.35));

  vec3 col = cyto;
  col = mix(col, nucColor, nucleusMask);
  col = mix(col, v_outline, outlineMask);

  // Soft alpha falloff at the very edge for AA.
  float a = 1.0 - smoothstep(0.96, 1.02, d);
  outColor = vec4(col, a);
}`;

// Full-screen quad: uses gl_VertexID to fabricate the four corners.
const VERT_FULLSCREEN = `#version 300 es
precision highp float;
out vec2 v_uv;
const vec2 POS[4] = vec2[4](
  vec2(-1.0, -1.0), vec2( 1.0, -1.0),
  vec2(-1.0,  1.0), vec2( 1.0,  1.0)
);
void main() {
  vec2 p = POS[gl_VertexID];
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// One combined background shader. v_uv is screen-space 0..1.
// All bg variants compose into the same pass to keep state changes
// minimal: flat, gradient, agar rings, cybergrid, drifting spots,
// vignette. The decor patterns (lobules / villi / neurons / etc.)
// are intentionally skipped; they're per-theme flair that's costly
// to port and not visible in most palettes.
const MAX_SPOTS = 8;
const FRAG_BG = `#version 300 es
precision highp float;
in vec2 v_uv;

uniform int u_kind;          // 0 flat, 1 gradient, 2 agar, 3 cybergrid
uniform vec3 u_base;
uniform vec3 u_top;
uniform vec3 u_bot;
uniform vec3 u_ringColor;
uniform vec3 u_gridColor;
uniform float u_gridStep;
uniform float u_vignette;
uniform vec3 u_camera;       // (scale, tx, ty)
uniform vec2 u_viewport;     // (W, H)
uniform float u_time;        // seconds
uniform int u_spotCount;
uniform vec4 u_spots[${MAX_SPOTS}];      // (cx, cy, r, _) screen 0..1
uniform vec3 u_spotCols[${MAX_SPOTS}];

out vec4 outColor;

void main() {
  // Base.
  vec3 col = u_base;
  if (u_kind == 1) col = mix(u_top, u_bot, v_uv.y);

  // World-space pixel — screen px → world px through camera.
  vec2 screenPx = v_uv * u_viewport;
  vec2 worldPx = (screenPx - u_camera.yz) / u_camera.x;

  // Petri-dish concentric rings — 1px thin at every 32 world units,
  // centred on the world middle. Matches Canvas2D's stroke loop.
  if (u_kind == 2) {
    vec2 ctr = u_viewport * 0.5;
    float r = length(worldPx - ctr);
    float nearestRing = floor(r / 32.0 + 0.5) * 32.0;
    float dToRing = abs(r - nearestRing);
    float pxWorld = 1.0 / u_camera.x;
    float band = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.5, dToRing);
    col = mix(col, u_ringColor, band * 0.18);
  }

  // Cyber grid: thin lines every gridStep world units, in both axes.
  if (u_kind == 3) {
    vec2 g = mod(worldPx, u_gridStep);
    vec2 dToLine = min(g, u_gridStep - g);
    float pxWorld = 1.0 / u_camera.x;
    float lineX = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.x);
    float lineY = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.y);
    float line = max(lineX, lineY);
    col = mix(col, u_gridColor, line * 0.30);
  }

  // Drifting light spots — additive, screen-space coords. Each spot
  // colour was pre-multiplied by its source alpha on the JS side, so
  // we just add directly without re-scaling.
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    if (i >= u_spotCount) break;
    vec4 s = u_spots[i];
    float d = distance(v_uv, s.xy);
    float a = 1.0 - smoothstep(0.0, s.z, d);
    col += u_spotCols[i] * a;
  }

  // Vignette: darken the corners.
  if (u_vignette > 0.0) {
    float v = length(v_uv - 0.5) * 1.4;
    float vAmt = u_vignette * smoothstep(0.4, 1.0, v);
    col *= 1.0 - vAmt;
  }

  outColor = vec4(col, 1.0);
}`;

const INSTANCE_FLOATS = 16; // see _diskVao layout in init()

function hexToVec3(hex) {
  let h = (hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// Theme `ringColor` / `spotColor` / `gridColor` strings, returning rgb +
// optional alpha (defaulting to 1 for hex / no-alpha rgba).
function rgbaStringToVec3(s) {
  const v = rgbaStringToVec4(s);
  return [v[0], v[1], v[2]];
}

function rgbaStringToVec4(s) {
  if (!s) return [0, 0, 0, 1];
  if (s[0] === '#') { const v = hexToVec3(s); return [v[0], v[1], v[2], 1]; }
  const m = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
  if (!m) return [1, 1, 1, 1];
  return [
    parseInt(m[1], 10) / 255,
    parseInt(m[2], 10) / 255,
    parseInt(m[3], 10) / 255,
    m[4] != null ? parseFloat(m[4]) : 1,
  ];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed:\n${log}\n${src}`);
  }
  return sh;
}

function link(gl, vSrc, fSrc) {
  const v = compile(gl, gl.VERTEX_SHADER, vSrc);
  const f = compile(gl, gl.FRAGMENT_SHADER, fSrc);
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`program link failed:\n${log}`);
  }
  gl.deleteShader(v);
  gl.deleteShader(f);
  return p;
}

/**
 * @implements {import('./renderer.js').IRenderer}
 */
export class WebGL2Renderer extends RendererBase {
  constructor(canvas, sim) {
    super(canvas, sim);
    /** @type {WebGL2RenderingContext|null} */
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false });
    if (!this.gl) throw new Error('webgl2 unavailable');

    // GPU resources, populated in init().
    this._diskProg = null;
    this._diskU = {};            // uniform locations
    this._cornerVbo = null;
    this._instanceVbo = null;
    this._diskVao = null;
    this._instanceCapacity = 0;
    this._instanceData = new Float32Array(0);

    this._bgProg = null;
    this._bgU = {};
    this._bgVao = null;

    // One-time random light spots, matching Canvas2D's SPOTS layout.
    this._spots = [];
    for (let i = 0; i < MAX_SPOTS; i++) {
      this._spots.push({
        ax: 0.15 + Math.random() * 0.7,
        ay: 0.15 + Math.random() * 0.7,
        ox1: 0.12 + Math.random() * 0.18,
        oy1: 0.12 + Math.random() * 0.18,
        w1: 0.10 + Math.random() * 0.18,
        w2: 0.05 + Math.random() * 0.10,
        phx: Math.random() * Math.PI * 2,
        phy: Math.random() * Math.PI * 2,
        r: 0.32 + Math.random() * 0.30,
      });
    }
  }

  init() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Premultiplied-style blend (ONE, ONE_MINUS_SRC_ALPHA) gives proper
    // edge softness; we still output non-premultiplied alpha and rely
    // on the source factor multiplying-in. SRC_ALPHA is the right pick.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // ---- disk program ----
    this._diskProg = link(gl, VERT_DISK, FRAG_DISK);
    this._diskU.camera = gl.getUniformLocation(this._diskProg, 'u_camera');
    this._diskU.viewport = gl.getUniformLocation(this._diskProg, 'u_viewport');

    // Static unit-square corners (two triangles).
    const corners = new Float32Array([
      -1, -1,   1, -1,   -1,  1,
       1, -1,   1,  1,   -1,  1,
    ]);
    this._cornerVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._cornerVbo);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);

    this._instanceVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
    this._growInstanceBuffer(64);

    this._diskVao = gl.createVertexArray();
    gl.bindVertexArray(this._diskVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._cornerVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
    // Instance layout: 16 floats per cell —
    //   0..3  inst:    (x, y, r, _)
    //   4..6  cytoTop  (rgb)
    //   7..9  cytoBot  (rgb)
    //  10..12 nucleus  (rgb)
    //  13..15 outline  (rgb)
    const stride = INSTANCE_FLOATS * 4;
    let off = 0;
    function attr(loc, size) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
      off += size * 4;
    }
    attr(1, 4); // a_inst
    attr(2, 3); // a_cytoTop
    attr(3, 3); // a_cytoBot
    attr(4, 3); // a_nucleus
    attr(5, 3); // a_outline
    gl.bindVertexArray(null);

    // ---- background program ----
    this._bgProg = link(gl, VERT_FULLSCREEN, FRAG_BG);
    const bu = (n) => gl.getUniformLocation(this._bgProg, n);
    this._bgU.kind = bu('u_kind');
    this._bgU.base = bu('u_base');
    this._bgU.top = bu('u_top');
    this._bgU.bot = bu('u_bot');
    this._bgU.ringColor = bu('u_ringColor');
    this._bgU.gridColor = bu('u_gridColor');
    this._bgU.gridStep = bu('u_gridStep');
    this._bgU.vignette = bu('u_vignette');
    this._bgU.camera = bu('u_camera');
    this._bgU.viewport = bu('u_viewport');
    this._bgU.time = bu('u_time');
    this._bgU.spotCount = bu('u_spotCount');
    this._bgU.spots = bu('u_spots');
    this._bgU.spotCols = bu('u_spotCols');

    this._bgVao = gl.createVertexArray();

    // Reusable arrays for the per-frame spot-uniform upload.
    this._spotsBuf = new Float32Array(MAX_SPOTS * 4);
    this._spotColsBuf = new Float32Array(MAX_SPOTS * 3);
  }

  resize(W, H, dpr, renderScale) {
    this.W = W; this.H = H; this.dpr = dpr; this.renderScale = renderScale;
    const rs = renderScale;
    this.canvas.width = Math.max(2, Math.floor(W * dpr * rs));
    this.canvas.height = Math.max(2, Math.floor(H * dpr * rs));
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  beginFrame() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  drawBackground(timeMs) {
    const gl = this.gl;
    const bg = currentBackground();
    const t = timeMs * 0.001 * (S.bgFlowSpeed || 1);

    let kind = 0; // flat
    if (bg.kind === 'gradient') kind = 1;
    else if (bg.kind === 'agar') kind = 2;
    else if (bg.kind === 'cybergrid') kind = 3;
    // 'flat' / 'navy-ghost' / unknown all fall through to flat.

    // Compute drifting-spot positions in screen UV (matches Canvas2D).
    const count = Math.min(MAX_SPOTS, bg.spotCount || 0);
    const spotCols = Array.isArray(bg.spotColors) ? bg.spotColors : null;
    const fallbackCol = bg.spotColor;
    for (let i = 0; i < MAX_SPOTS; i++) {
      const s = this._spots[i];
      const cx = s.ax + s.ox1 * Math.sin(t * s.w1 + s.phx);
      const cy = s.ay + s.oy1 * Math.cos(t * s.w2 + s.phy);
      this._spotsBuf[i * 4]     = cx;
      this._spotsBuf[i * 4 + 1] = cy;
      this._spotsBuf[i * 4 + 2] = s.r;
      this._spotsBuf[i * 4 + 3] = 0;
      const colSrc = spotCols ? spotCols[i % spotCols.length] : fallbackCol;
      const v4 = colSrc ? rgbaStringToVec4(colSrc) : [1, 1, 1, 0.10];
      // Pre-multiply rgb by source alpha so the shader can add directly.
      this._spotColsBuf[i * 3]     = v4[0] * v4[3];
      this._spotColsBuf[i * 3 + 1] = v4[1] * v4[3];
      this._spotColsBuf[i * 3 + 2] = v4[2] * v4[3];
    }

    gl.useProgram(this._bgProg);
    gl.uniform1i(this._bgU.kind, kind);
    gl.uniform3fv(this._bgU.base, hexToVec3(bg.base || '#000000'));
    gl.uniform3fv(this._bgU.top, hexToVec3(bg.topColor || bg.base || '#000000'));
    gl.uniform3fv(this._bgU.bot, hexToVec3(bg.botColor || bg.base || '#000000'));
    gl.uniform3fv(this._bgU.ringColor, rgbaStringToVec3(bg.ringColor || 'rgba(120,80,30,0.5)'));
    gl.uniform3fv(this._bgU.gridColor, rgbaStringToVec3(bg.gridColor || 'rgba(0,255,170,0.5)'));
    gl.uniform1f(this._bgU.gridStep, bg.gridStep || 48);
    gl.uniform1f(this._bgU.vignette, bg.vignette || 0);
    gl.uniform3f(this._bgU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
    gl.uniform2f(this._bgU.viewport, this.W, this.H);
    gl.uniform1f(this._bgU.time, t);
    gl.uniform1i(this._bgU.spotCount, count);
    gl.uniform4fv(this._bgU.spots, this._spotsBuf);
    gl.uniform3fv(this._bgU.spotCols, this._spotColsBuf);

    gl.bindVertexArray(this._bgVao);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(null);
    // Decor (lobules, villi, neurons, …) intentionally not ported —
    // background flair only visible in a handful of themes.
  }

  _growInstanceBuffer(targetCount) {
    if (targetCount <= this._instanceCapacity) return;
    const newCap = Math.max(64, Math.ceil(targetCount * 1.5));
    this._instanceData = new Float32Array(newCap * INSTANCE_FLOATS);
    this._instanceCapacity = newCap;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._instanceData.byteLength, gl.DYNAMIC_DRAW);
  }

  drawCells(shapes /*, time, timeMs */) {
    if (shapes.length === 0) return;
    const gl = this.gl;
    this._growInstanceBuffer(shapes.length);
    const data = this._instanceData;
    const outlineRgb = hexToVec3(currentTheme().outline.color);
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      const cc = (CELL_TYPES[s.cell.type] || CELL_TYPES.neutrophil).colors;
      const top = hexToVec3(cc.cytoTop);
      const bot = hexToVec3(cc.cytoBot);
      const nuc = hexToVec3(cc.nucleus);
      const j = i * INSTANCE_FLOATS;
      data[j]     = s.x;
      data[j + 1] = s.y;
      data[j + 2] = s.r;
      data[j + 3] = 0;
      data[j + 4] = top[0];  data[j + 5] = top[1];  data[j + 6] = top[2];
      data[j + 7] = bot[0];  data[j + 8] = bot[1];  data[j + 9] = bot[2];
      data[j + 10] = nuc[0]; data[j + 11] = nuc[1]; data[j + 12] = nuc[2];
      data[j + 13] = outlineRgb[0]; data[j + 14] = outlineRgb[1]; data[j + 15] = outlineRgb[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, shapes.length * INSTANCE_FLOATS);

    gl.useProgram(this._diskProg);
    gl.uniform3f(this._diskU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
    gl.uniform2f(this._diskU.viewport, this.W, this.H);
    gl.bindVertexArray(this._diskVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, shapes.length);
    gl.bindVertexArray(null);
    // TODO Phase 4b: real metaball pipeline (FBO mask + blur + contrast)
    // for inter-cell merging, decorations, cartoon faces.
  }

  drawSelection(/* shapes, time */) {
    // TODO Phase 4f: selection ring / target marker / flash overlay.
  }

  drawDebug(/* shapes */) {
    // TODO Phase 4 wrap-up: cell-radius circles + count overlay.
  }

  endFrame() { /* default framebuffer is auto-swapped by the browser */ }

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    if (this._diskProg) gl.deleteProgram(this._diskProg);
    if (this._bgProg) gl.deleteProgram(this._bgProg);
    if (this._cornerVbo) gl.deleteBuffer(this._cornerVbo);
    if (this._instanceVbo) gl.deleteBuffer(this._instanceVbo);
    if (this._diskVao) gl.deleteVertexArray(this._diskVao);
    if (this._bgVao) gl.deleteVertexArray(this._bgVao);
    this.gl = null;
  }
}
