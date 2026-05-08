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
  S, CELL_TYPES, currentBackground, hexToRgba,
} from '../core/state.js';
import { RendererBase } from './renderer.js';

const VERT_DISK = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;       // unit-square corner in [-1,1]
layout(location=1) in vec3 a_inst;          // instance: (worldX, worldY, r)
layout(location=2) in vec4 a_color;         // instance: rgba

uniform vec3 u_camera;                      // (scale, tx, ty)
uniform vec2 u_viewport;                    // (W, H) in CSS px

out vec2 v_uv;
out vec4 v_color;

void main() {
  // Position the unit-square corner in world space, scaled by r.
  vec2 worldPos = a_inst.xy + a_corner * a_inst.z;
  // Camera transform: screen = world*scale + translate.
  vec2 screenPos = worldPos * u_camera.x + u_camera.yz;
  // Clip-space: [-1, 1] mapped from [0, W]x[0, H], y inverted.
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_corner;
  v_color = a_color;
}`;

const FRAG_DISK = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
out vec4 outColor;
void main() {
  float d = length(v_uv);
  // Soft edge from 0.97..1.0
  float a = 1.0 - smoothstep(0.97, 1.0, d);
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb, v_color.a * a);
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

const FRAG_BG_FLAT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_color;
out vec4 outColor;
void main() { outColor = vec4(u_color, 1.0); }`;

const FRAG_BG_GRADIENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_top;
uniform vec3 u_bot;
out vec4 outColor;
void main() {
  outColor = vec4(mix(u_top, u_bot, v_uv.y), 1.0);
}`;

function hexToVec3(hex) {
  let h = (hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
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

    this._bgFlatProg = null;
    this._bgFlatU = {};
    this._bgGradProg = null;
    this._bgGradU = {};
    this._bgVao = null;
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
    // Instance layout: 7 floats per cell = (x, y, r, r, g, b, a)
    const stride = 7 * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    // ---- background programs ----
    this._bgFlatProg = link(gl, VERT_FULLSCREEN, FRAG_BG_FLAT);
    this._bgFlatU.color = gl.getUniformLocation(this._bgFlatProg, 'u_color');
    this._bgGradProg = link(gl, VERT_FULLSCREEN, FRAG_BG_GRADIENT);
    this._bgGradU.top = gl.getUniformLocation(this._bgGradProg, 'u_top');
    this._bgGradU.bot = gl.getUniformLocation(this._bgGradProg, 'u_bot');

    this._bgVao = gl.createVertexArray();
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

  drawBackground(/* timeMs */) {
    const gl = this.gl;
    const bg = currentBackground();
    gl.bindVertexArray(this._bgVao);

    if (bg.kind === 'gradient') {
      gl.useProgram(this._bgGradProg);
      gl.uniform3fv(this._bgGradU.top, hexToVec3(bg.topColor));
      gl.uniform3fv(this._bgGradU.bot, hexToVec3(bg.botColor));
    } else {
      gl.useProgram(this._bgFlatProg);
      gl.uniform3fv(this._bgFlatU.color, hexToVec3(bg.base || '#000'));
    }
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(null);
    // TODO Phase 4a: spots / agar rings / cybergrid / decor.
  }

  _growInstanceBuffer(targetCount) {
    if (targetCount <= this._instanceCapacity) return;
    const newCap = Math.max(64, Math.ceil(targetCount * 1.5));
    this._instanceData = new Float32Array(newCap * 7);
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
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      const cc = (CELL_TYPES[s.cell.type] || CELL_TYPES.neutrophil).colors;
      const rgb = hexToVec3(cc.cytoBot);
      const j = i * 7;
      data[j] = s.x;
      data[j + 1] = s.y;
      data[j + 2] = s.r;
      data[j + 3] = rgb[0];
      data[j + 4] = rgb[1];
      data[j + 5] = rgb[2];
      data[j + 6] = 1.0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, shapes.length * 7);

    gl.useProgram(this._diskProg);
    gl.uniform3f(this._diskU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
    gl.uniform2f(this._diskU.viewport, this.W, this.H);
    gl.bindVertexArray(this._diskVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, shapes.length);
    gl.bindVertexArray(null);
    // TODO Phase 4b: replace the solid-disc pass with the metaball
    // pipeline (mask FBO → blur → contrast → cyto / outline / membrane).
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
    if (this._bgFlatProg) gl.deleteProgram(this._bgFlatProg);
    if (this._bgGradProg) gl.deleteProgram(this._bgGradProg);
    if (this._cornerVbo) gl.deleteBuffer(this._cornerVbo);
    if (this._instanceVbo) gl.deleteBuffer(this._instanceVbo);
    if (this._diskVao) gl.deleteVertexArray(this._diskVao);
    if (this._bgVao) gl.deleteVertexArray(this._bgVao);
    this.gl = null;
  }
}
