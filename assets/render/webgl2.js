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

// Each cell is one instanced quad. The fragment shader computes the
// per-pixel body SDF for the cell's `body.kind` (round / lobed /
// rippled / oblong / pseudopod / star), giving organic polygon
// shapes without uploading vertex data per type. All pure math —
// no FBO, no mesh.
const VERT_DISK = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;        // unit-square corner [-1,1]
layout(location=1) in vec4 a_inst;          // (x, y, r, kindAsFloat)
layout(location=2) in vec4 a_phase;         // (phase, seed, freq, wobbleMul)
layout(location=3) in vec3 a_cytoTop;
layout(location=4) in vec3 a_cytoBot;
layout(location=5) in vec3 a_nucleus;
layout(location=6) in vec3 a_outline;

uniform vec3 u_camera;
uniform vec2 u_viewport;

out vec2 v_uv;
out float v_kind;
out vec4 v_phase;
out vec3 v_cytoTop;
out vec3 v_cytoBot;
out vec3 v_nucleus;
out vec3 v_outline;

void main() {
  // The corner quad is sized to a generous 1.30× r so wobble + lobed
  // / star extents (which can reach 1.30) aren't clipped.
  float quadR = a_inst.z * 1.30;
  vec2 worldPos = a_inst.xy + a_corner * quadR;
  vec2 screenPos = worldPos * u_camera.x + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  // v_uv ranges -1.30..+1.30 in body-radius units.
  v_uv = a_corner * 1.30;
  v_kind = a_inst.w;
  v_phase = a_phase;
  v_cytoTop = a_cytoTop;
  v_cytoBot = a_cytoBot;
  v_nucleus = a_nucleus;
  v_outline = a_outline;
}`;

// Body-kind constants (must match TS-side encoding in drawCells).
//   0=round  1=lobed  2=rippled  3=oblong  4=pseudopod  5=star
const FRAG_DISK = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_kind;
in vec4 v_phase;        // (phase, seed, freq, wobbleMul)
in vec3 v_cytoTop;
in vec3 v_cytoBot;
in vec3 v_nucleus;
in vec3 v_outline;
uniform float u_time;       // seconds
uniform float u_wobbleAmp;  // S.wobbleAmp
out vec4 outColor;

float bodyScale(vec2 uv) {
  int kind = int(v_kind + 0.5);
  float ang = atan(uv.y, uv.x);
  float phi = v_phase.x;
  float seed = v_phase.y;
  float freq = v_phase.z;
  float wobMul = v_phase.w;
  float t = u_time;

  float scale = 1.0;
  bool addWob = true;
  float wobShareForLobed = 0.4;

  if (kind == 1) {                 // lobed
    scale = 1.0 + 0.16 * sin(3.0*ang + phi) + 0.08 * sin(5.0*ang + phi*1.7);
    addWob = true;                 // 40% of base wobble overlay
  } else if (kind == 2) {          // rippled
    scale = 1.0 + 0.04 * sin(24.0*ang + phi) + 0.015 * sin(8.0*ang + phi*0.7);
  } else if (kind == 4) {          // pseudopod (animated)
    scale = 1.0
          + 0.20 * sin(3.0*ang + 0.8*t*freq + phi)
          + 0.06 * sin(5.0*ang - 0.5*t*freq + seed);
    addWob = false;
  } else if (kind == 5) {          // star (10-pointed)
    scale = 0.85 + 0.45 * abs(sin(5.0*ang + phi));
    addWob = false;
  }
  // round (0) and oblong (3) start at 1.0 with full wobble.

  if (addWob) {
    float w1 = sin(t * 0.55 * freq + ang*3.0 + seed);
    float w2 = sin(t * 0.85 * freq + ang*5.0 + seed*1.31 + phi);
    float wob = u_wobbleAmp * wobMul * (w1 * 0.65 + w2 * 0.45);
    if (kind == 1) scale += wob * wobShareForLobed;  // lobed gets a small overlay
    else scale += wob;                                // round / oblong / rippled
  }
  return scale;
}

void main() {
  float d = length(v_uv);
  float bodyR = bodyScale(v_uv);
  // Distance-from-rim in body-radius units (signed, <0 inside).
  float sdf = d - bodyR;

  // Soft body edge (anti-aliased over ~2 pixels in body-r units).
  float bodyA = 1.0 - smoothstep(-0.005, 0.015, sdf);
  if (bodyA <= 0.0) discard;

  // Cytoplasm gradient — top-left highlight, body fill toward rim.
  float gradT = clamp(d / max(0.001, bodyR * 0.65), 0.0, 1.0);
  vec3 cyto = mix(v_cytoTop, v_cytoBot, gradT);
  float topLift = max(0.0, 0.55 - distance(v_uv, vec2(-0.30, -0.40))) * 0.65;
  cyto = mix(cyto, v_cytoTop, topLift);

  // Outline ring (thin band straddling the body edge).
  float outlineMask = smoothstep(-0.04, -0.005, sdf) * (1.0 - smoothstep(0.0, 0.015, sdf));

  // Nucleus disc (round, radius ~30% of cell).
  float dNuc = d / max(0.001, bodyR);
  float nucleusMask = 1.0 - smoothstep(0.26, 0.34, dNuc);
  float nucGlint = max(0.0, 0.18 - distance(v_uv, vec2(-0.10, -0.13))) * 4.0;
  vec3 nucColor = mix(v_nucleus, vec3(1.0), clamp(nucGlint, 0.0, 0.35));

  vec3 col = cyto;
  col = mix(col, nucColor, nucleusMask);
  col = mix(col, v_outline, clamp(outlineMask, 0.0, 1.0));

  outColor = vec4(col, bodyA);
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

const INSTANCE_FLOATS = 20; // see _diskVao layout in init()
const BODY_KIND_FLOAT = {
  round: 0, lobed: 1, rippled: 2, oblong: 3, pseudopod: 4, star: 5,
};

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
    this._diskU.time = gl.getUniformLocation(this._diskProg, 'u_time');
    this._diskU.wobbleAmp = gl.getUniformLocation(this._diskProg, 'u_wobbleAmp');

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
    // Instance layout: 20 floats per cell —
    //   0..3   inst:    (x, y, r, kindAsFloat)
    //   4..7   phase:   (phase, seed, freq, wobbleMul)
    //   8..10  cytoTop  (rgb)
    //  11..13  cytoBot  (rgb)
    //  14..16  nucleus  (rgb)
    //  17..19  outline  (rgb)
    const stride = INSTANCE_FLOATS * 4;
    let off = 0;
    function attr(loc, size) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
      off += size * 4;
    }
    attr(1, 4); // a_inst
    attr(2, 4); // a_phase
    attr(3, 3); // a_cytoTop
    attr(4, 3); // a_cytoBot
    attr(5, 3); // a_nucleus
    attr(6, 3); // a_outline
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

  drawCells(shapes, time /*, timeMs */) {
    if (shapes.length === 0) return;
    const gl = this.gl;
    this._growInstanceBuffer(shapes.length);
    const data = this._instanceData;
    const outlineRgb = hexToVec3(currentTheme().outline.color);
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      const c = s.cell;
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const cc = type.colors;
      const top = hexToVec3(cc.cytoTop);
      const bot = hexToVec3(cc.cytoBot);
      const nuc = hexToVec3(cc.nucleus);
      const kind = BODY_KIND_FLOAT[(type.body && type.body.kind) || 'round'] || 0;
      const wobMul = (type.field && type.field.wobbleMul) || 1.0;
      const j = i * INSTANCE_FLOATS;
      data[j]     = s.x;
      data[j + 1] = s.y;
      data[j + 2] = s.r;
      data[j + 3] = kind;
      data[j + 4] = c.phase || 0;
      data[j + 5] = c.wobbleSeed || 0;
      data[j + 6] = c.wobbleFreq || 1;
      data[j + 7] = wobMul;
      data[j + 8] = top[0];  data[j + 9] = top[1];  data[j + 10] = top[2];
      data[j + 11] = bot[0]; data[j + 12] = bot[1]; data[j + 13] = bot[2];
      data[j + 14] = nuc[0]; data[j + 15] = nuc[1]; data[j + 16] = nuc[2];
      data[j + 17] = outlineRgb[0]; data[j + 18] = outlineRgb[1]; data[j + 19] = outlineRgb[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, shapes.length * INSTANCE_FLOATS);

    gl.useProgram(this._diskProg);
    gl.uniform3f(this._diskU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
    gl.uniform2f(this._diskU.viewport, this.W, this.H);
    gl.uniform1f(this._diskU.time, time);
    gl.uniform1f(this._diskU.wobbleAmp, S.wobbleAmp || 0);
    gl.bindVertexArray(this._diskVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, shapes.length);
    gl.bindVertexArray(null);
    // TODO Phase 4c-d: per-type nucleus shapes (kidney / bilobed /
    // multilobed), granules, decorations.
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
