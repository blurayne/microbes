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
  S, FACE, CELL_TYPES, WOBBLE_VERTS, THETA_TABLE,
  currentBackground, currentTheme, currentHighlightColor, cellColors, frac,
} from '../core/state.js';
import { shapeVertex } from '../core/shape.js';
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
layout(location=6) in vec4 a_outline;        // .a = c.flash (0..1)

uniform vec3 u_camera;
uniform vec2 u_viewport;

out vec2 v_uv;
out float v_kind;
out vec4 v_phase;
out vec3 v_cytoTop;
out vec3 v_cytoBot;
out vec3 v_nucleus;
out vec4 v_outline;

void main() {
  // 1.70× r — covers wobbly body extents (up to ~1.30) plus the
  // selection ring (which extends to 1.30 × bodyR).
  float quadR = a_inst.z * 1.70;
  vec2 worldPos = a_inst.xy + a_corner * quadR;
  vec2 screenPos = worldPos * u_camera.x + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_corner * 1.70;     // body-radius units
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
in vec4 v_outline;
uniform float u_time;       // seconds
uniform float u_wobbleAmp;  // S.wobbleAmp
uniform vec3 u_highlight;   // S.highlightColor as rgb
uniform float u_membraneIntensity; // S.membraneIntensity 0..1
out vec4 outColor;

// v_kind packs:
//   body (0..5) + nucleus (0..5) * 16 + selected (0..1) * 256 + hollow (0..1) * 4096
int bodyKind()    { return int(mod(v_kind + 0.5, 16.0)); }
int nucKind()     { return int(mod((v_kind + 0.5) / 16.0, 16.0)); }
int isSelected()  { return int(mod((v_kind + 0.5) / 256.0, 16.0)); }
int isHollow()    { return int((v_kind + 0.5) / 4096.0); }

float bodyScale(vec2 uv) {
  int kind = bodyKind();
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
  float sdf = d - bodyR;
  int sel = isSelected();

  // Outside the body: contribute a glow ring only when selected.
  if (sdf > 0.015) {
    if (sel == 0) discard;
    float ringT = sdf / (bodyR * 0.30);
    if (ringT >= 1.0) discard;
    // Peak around ringT=0.5; smooth fade at both ends.
    float ringA = smoothstep(0.0, 0.20, ringT) * (1.0 - smoothstep(0.65, 1.0, ringT));
    outColor = vec4(u_highlight, ringA);
    return;
  }

  // Soft body edge AA.
  float bodyA = 1.0 - smoothstep(-0.005, 0.015, sdf);
  if (bodyA <= 0.0) discard;

  // Cytoplasm gradient — top-left highlight, body fill toward rim.
  float gradT = clamp(d / max(0.001, bodyR * 0.65), 0.0, 1.0);
  vec3 cyto = mix(v_cytoTop, v_cytoBot, gradT);
  float topLift = max(0.0, 0.55 - distance(v_uv, vec2(-0.30, -0.40))) * 0.65;
  cyto = mix(cyto, v_cytoTop, topLift);

  // Donut-hole darkening for cells flagged bodyHollow (RBCs).
  if (isHollow() == 1) {
    float holeT = 1.0 - smoothstep(0.0, 0.45, length(v_uv));
    cyto = mix(cyto, v_cytoBot * 0.42, holeT * 0.85);
  }

  // Bold membrane band straddling the body edge, in the cell's own deep
  // colour (a darkened cytoBot). Slider gates the alpha for parity with
  // the Canvas2D pass.
  float outlineMask = smoothstep(-0.06, -0.01, sdf)
                    * (1.0 - smoothstep(0.0, 0.015, sdf))
                    * u_membraneIntensity;

  // Nucleus shape — driven by per-cell nucKind.
  // We work in body-radius units (uvN) so the nucleus scales with the cell.
  vec2 uvN = v_uv / max(0.001, bodyR);
  int nucK = nucKind();
  float nucleusMask = 0.0;
  if (nucK == 1 || nucK == 5) {                   // round / round-small
    float r = (nucK == 5) ? 0.21 : 0.30;
    nucleusMask = 1.0 - smoothstep(r - 0.04, r + 0.02, length(uvN));
  } else if (nucK == 2) {                         // kidney
    float main = 1.0 - smoothstep(0.30 - 0.04, 0.30 + 0.02, length(uvN));
    float bite = 1.0 - smoothstep(0.25 - 0.04, 0.25 + 0.02, length(uvN - vec2(0.18, 0.0)));
    nucleusMask = clamp(main - bite, 0.0, 1.0);
  } else if (nucK == 3) {                         // bilobed
    float ang = v_phase.x;
    vec2 off = vec2(cos(ang), sin(ang)) * 0.10;
    float ma = 1.0 - smoothstep(0.20 - 0.04, 0.20 + 0.02, length(uvN - off));
    float mb = 1.0 - smoothstep(0.20 - 0.04, 0.20 + 0.02, length(uvN + off));
    nucleusMask = max(ma, mb);
  } else if (nucK == 4) {                         // multilobed (4 lobes)
    float baseAng = v_phase.x;
    float total = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i) - 1.5;
      float a = baseAng + fi * 0.7;
      vec2 p = vec2(cos(a), sin(a) * 0.4) * 0.20;
      total = max(total, 1.0 - smoothstep(0.155 - 0.03, 0.155 + 0.02, length(uvN - p)));
    }
    nucleusMask = total;
  }
  float nucGlint = max(0.0, 0.18 - distance(v_uv, vec2(-0.10, -0.13))) * 4.0;
  vec3 nucColor = mix(v_nucleus, vec3(1.0), clamp(nucGlint, 0.0, 0.35));

  vec3 col = cyto;
  col = mix(col, nucColor, nucleusMask);
  col = mix(col, v_cytoBot * 0.80, clamp(outlineMask, 0.0, 1.0));

  // Tap flash overlay — c.flash decays in Sim.update(); fade out across 200 ms.
  float flashA = clamp(v_outline.a / 0.2, 0.0, 1.0) * 0.6;
  col = mix(col, vec3(1.0), flashA);

  // Selection brighten — translucent highlight wash inside the cell.
  if (sel == 1) {
    col = mix(col, u_highlight, 0.30);
  }

  // Flash overlay from cell.flash (per-cell, decays in Sim.update).
  if (v_phase.w < 0.0) {
    // Reuse: we don't have a separate flash slot. Skip — flash is only
    // drawn via the cell.flash field in the Canvas2D pass; close-enough
    // parity ignores the brief 200ms tap flash for the WebGL backend.
  }

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
uniform int u_rbc;                        // 0=off, 1=draw drifting RBC silhouettes

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

  // Drifting red-blood-cell silhouettes — bloodstream theme flair.
  // 22 ellipses with darker centre dot, drift on screen UV with u_time.
  if (u_rbc == 1) {
    for (int i = 0; i < 22; i++) {
      float seed = float(i) * 1.31;
      float fx = mod(float(i) / 22.0 + 0.06 * sin(u_time * 0.25 + seed), 1.0);
      float fy = mod(fract(seed * 0.7) + u_time * 0.15 + float(i) * 0.13, 1.0);
      vec2 c = vec2(fx, fy);
      float r = 0.018 + 0.016 * fract(seed * 0.21);
      vec2 dEll = (v_uv - c) / vec2(r, r * 0.78);
      float ellA = (1.0 - smoothstep(0.85, 1.0, length(dEll))) * 0.10;
      col = mix(col, vec3(1.0, 0.35, 0.35), ellA);
      float dDot = length(v_uv - c) / (r * 0.32);
      float dotA = (1.0 - smoothstep(0.88, 1.0, dDot)) * 0.18;
      col = mix(col, vec3(0.47, 0.08, 0.08), dotA);
    }
  }

  // Vignette: darken the corners.
  if (u_vignette > 0.0) {
    float v = length(v_uv - 0.5) * 1.4;
    float vAmt = u_vignette * smoothstep(0.4, 1.0, v);
    col *= 1.0 - vAmt;
  }

  outColor = vec4(col, 1.0);
}`;

// ---------- metaSplit (S.metaSplit) — per-pair metaball pass ----------
// Renders both halves of a SPLITTING cell as filled white wobble polygons
// into an off-screen RT, blurs separably, then a single fragment pass
// applies the alpha threshold (α' = clamp(K·α − K/2, 0, 1)) and the
// canvas2d-spec radial gradient tint, blending onto the main framebuffer.
//
// Three RT-sizing strategies, selected via S.metaRtMode:
//   'bbox'        — per-pair RT sized to the screen-space bbox + blur padding
//                   (matches canvas2d). Lowest GPU memory; reallocates as
//                   pair sizes change. Sizes are rounded up to a 64-px grid
//                   so the pool churn stays modest.
//   'fullCanvas'  — pool of full-canvas RTs, one per active pair index
//                   (matches Pixi's _pairPool). Highest GPU memory; zero
//                   per-pair allocation after warmup.
//   'sharedMax'   — single shared RT, sized to the largest active pair
//                   this frame. Middle ground.
const VERT_META_POLY = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;   // physical px from top-left of the RT
uniform vec2 u_rtSize;              // RT size in physical px
uniform vec2 u_rtOrigin;            // top-left of RT in canvas physical px (0,0 for fullCanvas)
void main() {
  vec2 local = a_pos - u_rtOrigin;
  vec2 ndc = (local / u_rtSize) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const FRAG_FLAT_WHITE = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(1.0, 1.0, 1.0, 1.0); }`;

// Separable Gaussian blur. u_dir is a 1-source-pixel step in uv space —
// i.e. (1/srcW, 0) horizontal, (0, 1/srcH) vertical. u_radius is in
// source pixels; kernel is sized at compile time to MAX_TAPS. uv is
// derived from gl_FragCoord so the shader works both when the RT == the
// viewport (bbox mode) and when the viewport is a sub-rect of a larger
// canvas-sized RT (fullCanvas / sharedMax modes).
const FRAG_META_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_srcSize;
uniform vec2 u_dir;
uniform float u_radius;
out vec4 outColor;
const int MAX_TAPS = 16;
void main() {
  vec2 uv = gl_FragCoord.xy / u_srcSize;
  float sigma = max(u_radius * 0.5, 0.5);
  float twoS2 = 2.0 * sigma * sigma;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -MAX_TAPS; i <= MAX_TAPS; i++) {
    float d = float(i);
    float mask = step(abs(d), u_radius);
    float w = exp(-(d * d) / twoS2) * mask;
    sum += texture(u_src, uv + u_dir * d) * w;
    wsum += w;
  }
  outColor = sum / max(wsum, 1e-4);
}`;

// Combined threshold + canvas2d-style radial gradient tint, blends onto
// the destination framebuffer with SRC_ALPHA, ONE_MINUS_SRC_ALPHA (we
// output pre-multiplied so the dst factor still works). The tint is the
// same 3-stop gradient canvas2d builds in the source-in step of
// _renderSplittingPair: cytoTop @ 0, cytoBot @ 0.55, cytoBotTransp @ 1.
const FRAG_META_TINT = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_srcSize;        // RT size in physical px
uniform vec2 u_rtOrigin;       // canvas top-left of the RT in physical px (0,0 for fullCanvas)
uniform vec2 u_canvasSize;     // canvas physical size, for top-left flip
uniform vec2 u_midPx;          // gradient centre in canvas physical px (top-left)
uniform float u_gr;             // gradient radius in physical px
uniform float u_K;              // threshold contrast (field.contrast)
uniform vec3 u_cytoTop;
uniform vec3 u_cytoBot;
out vec4 outColor;
void main() {
  // gl_FragCoord is canvas-window coords (bottom-left). Translate to
  // top-left, subtract the RT origin, then convert to source uv (which
  // is itself bottom-left, so flip y again).
  vec2 canvasPxTL = vec2(gl_FragCoord.x, u_canvasSize.y - gl_FragCoord.y);
  vec2 rtLocalTL = canvasPxTL - u_rtOrigin;
  vec2 uv = vec2(rtLocalTL.x / u_srcSize.x, 1.0 - rtLocalTL.y / u_srcSize.y);
  vec4 m = texture(u_src, uv);
  vec2 ctr = u_midPx + vec2(0.0, -u_gr * 0.18);
  float r = distance(canvasPxTL, ctr);
  float t = clamp(r / max(u_gr, 0.001), 0.0, 1.0);
  vec3 col;
  float alphaMul;
  if (t < 0.55) {
    col = mix(u_cytoTop, u_cytoBot, t / 0.55);
    alphaMul = 1.0;
  } else {
    col = u_cytoBot;
    alphaMul = 1.0 - (t - 0.55) / 0.45;
  }
  float thresholded = clamp(u_K * m.a - u_K * 0.5, 0.0, 1.0);
  float a = thresholded * alphaMul;
  outColor = vec4(col, a);
}`;

const INSTANCE_FLOATS = 21; // see _diskVao layout in init()

// Body and nucleus kinds packed into a single float per instance:
//   packedKind = bodyKind + nucKind * 16
const BODY_KIND_FLOAT = {
  round: 0, lobed: 1, rippled: 2, oblong: 3, pseudopod: 4, star: 5,
};
const NUC_KIND_FLOAT = {
  none: 0, round: 1, kidney: 2, bilobed: 3, multilobed: 4, 'round-small': 5,
};

// ---------- Decoration pass (per-cell appendages: spikes, tendrils,
// flagella, etc.) Shared vertex+fragment program for both line and
// triangle primitives. Each vertex carries (x,y) world coords and an
// rgba colour. Drawn in two batches (LINES + TRIANGLES) per frame.
const DECOR_VERT_FLOATS = 6;     // x, y, r, g, b, a
const VERT_DECOR = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_col;
uniform vec3 u_camera;
uniform vec2 u_viewport;
out vec4 v_col;
void main() {
  vec2 screenPos = a_pos * u_camera.x + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_col = a_col;
}`;
const FRAG_DECOR = `#version 300 es
precision highp float;
in vec4 v_col;
out vec4 outColor;
void main() { outColor = v_col; }`;

// ---------- Target-marker dashed lines (selected → marker). Vertices
// carry (x, y, distAlongLine). Fragment shader does the dash test.
const VERT_DASH = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_dist;
uniform vec3 u_camera;
uniform vec2 u_viewport;
out float v_dist;
void main() {
  vec2 screenPos = a_pos * u_camera.x + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_dist = a_dist;
}`;
const FRAG_DASH = `#version 300 es
precision highp float;
in float v_dist;
uniform float u_dashOffset;
uniform float u_alpha;
out vec4 outColor;
void main() {
  float m = mod(v_dist + u_dashOffset, 14.0);
  if (m > 8.0) discard;
  outColor = vec4(1.0, 1.0, 1.0, u_alpha);
}`;

// ---------- Target-marker pulsing circle + inner dot (single quad).
const VERT_MARKER = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
uniform vec3 u_camera;
uniform vec2 u_viewport;
uniform vec3 u_marker;       // (x, y, scaledRadius_world)
out vec2 v_uv;
void main() {
  vec2 worldPos = u_marker.xy + a_corner * u_marker.z;
  vec2 screenPos = worldPos * u_camera.x + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_corner;
}`;
const FRAG_MARKER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_age;          // 0..1 lifetime
uniform float u_innerNorm;    // inner-dot radius in v_uv units
uniform float u_ringNorm;     // ring radius in v_uv units (1.0 baseline)
uniform float u_ringHalfPx;   // ring half-width in v_uv units
out vec4 outColor;
void main() {
  float d = length(v_uv);
  float fade = 1.0 - u_age;
  // Inner dot.
  float dotA = 1.0 - smoothstep(u_innerNorm * 0.92, u_innerNorm * 1.05, d);
  // Ring band centred at u_ringNorm.
  float ringA = 1.0 - smoothstep(u_ringHalfPx, u_ringHalfPx * 1.4, abs(d - u_ringNorm));
  float a = max(dotA, ringA) * fade;
  if (a <= 0.0) discard;
  outColor = vec4(1.0, 1.0, 1.0, a);
}`;

// ---------- Cartoon face pass (only drawn when S.cartoon = true) ----------
//
// One instanced quad per cell. Per-instance: world position + cell.r,
// eye config (count / size / Y-offset / pupil size), look direction,
// mouth kind + width, blink flag, mouth color. Fragment shader composes
// eyes (white circle + dark pupil + white glint) and a per-type mouth
// (smile / frown / snarl / fangs / tongue / drool / none).
const FACE_INSTANCE_FLOATS = 19;
const MOUTH_KIND_FLOAT = {
  none: 0, smile: 1, frown: 2, snarl: 3, fangs: 4, tongue: 5, drool: 6,
};

const VERT_FACE = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_inst;     // (x, y, r, mouthKind)
layout(location=2) in vec4 a_face1;    // (eyesCount, eyeR, eyeY, pupilR)
layout(location=3) in vec4 a_face2;    // (lookX, lookY, mouthW, blink)
layout(location=4) in vec4 a_face3;    // (mouthY, phase, _, _)
layout(location=5) in vec3 a_mouthCol; // RGB for mouth fill / stroke

uniform vec3 u_camera;
uniform vec2 u_viewport;

out vec2 v_uv;
out vec4 v_inst;
out vec4 v_face1;
out vec4 v_face2;
out vec4 v_face3;
out vec3 v_mouthCol;

void main() {
  // Quad covers the body extent (no need for spike margins — faces sit
  // inside the cell). 1.0 × r is enough for any face-bearing cell.
  vec2 worldPos = a_inst.xy + a_corner * a_inst.z * 1.0;
  vec2 screenPos = worldPos * u_camera.x + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_corner;     // body-radius units, (0,0) at cell centre
  v_inst = a_inst;
  v_face1 = a_face1;
  v_face2 = a_face2;
  v_face3 = a_face3;
  v_mouthCol = a_mouthCol;
}`;

const FRAG_FACE = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_inst;       // (.., .., .., mouthKind)
in vec4 v_face1;      // (eyesCount, eyeR, eyeY, pupilR)
in vec4 v_face2;      // (lookX, lookY, mouthW, blink)
in vec4 v_face3;      // (mouthY, phase, _, _)
in vec3 v_mouthCol;
uniform float u_time;
out vec4 outColor;

const float FACE_SCALE = 1.2;

// Soft disc fill: returns alpha 0..1 inside, fades to 0 outside r.
float discA(vec2 p, vec2 c, float r) {
  return 1.0 - smoothstep(r * 0.92, r, length(p - c));
}

// Stroked arc segment: thin band along an arc from a0 to a1, centre c, radius r,
// half-width hw.
float arcA(vec2 p, vec2 c, float r, float hw, float a0, float a1) {
  vec2 d = p - c;
  float dist = abs(length(d) - r);
  float band = 1.0 - smoothstep(hw * 0.5, hw, dist);
  float ang = atan(d.y, d.x);
  // Wrap into [-PI, PI].
  float lo = a0;
  float hi = a1;
  float in_arc = step(lo, ang) * step(ang, hi);
  return band * in_arc;
}

void main() {
  int mouthKind = int(v_inst.w + 0.5);
  int eyesCount = int(v_face1.x + 0.5);
  if (eyesCount == 0 && mouthKind == 0) discard;

  float eyeRBase = v_face1.y;
  float eyeY = v_face1.z;
  float pupilRBase = v_face1.w;
  float blink = v_face2.w;
  vec2 look = vec2(v_face2.x, v_face2.y);
  float mouthW = v_face2.z;
  float mouthY = v_face3.x;
  float phase = v_face3.y;

  vec3 col = vec3(0.0);
  float a = 0.0;

  // ---------- Eyes ----------
  if (eyesCount > 0) {
    float eyeR = eyeRBase * FACE_SCALE;
    float pupilR = pupilRBase * FACE_SCALE;

    // Eye centres in body-radius units.
    vec2 eL = (eyesCount == 1) ? vec2(0.0, eyeY) : vec2(-0.22 * FACE_SCALE, eyeY);
    vec2 eR = vec2(0.22 * FACE_SCALE, eyeY);

    // Helper closure isn't possible in GLSL; inline twice for left + right (or only left).
    for (int i = 0; i < 2; i++) {
      if (i >= eyesCount) break;
      vec2 ec = (i == 0) ? eL : eR;
      vec2 d = v_uv - ec;
      if (blink > 0.5) {
        // Squint slit.
        float ed = length(vec2(d.x / eyeR, d.y / (eyeR * 0.12)));
        float wA = 1.0 - smoothstep(0.92, 1.0, ed);
        col = mix(col, vec3(1.0), wA);
        a = max(a, wA);
      } else {
        float ed = length(d) / eyeR;
        if (ed < 1.05) {
          float white = 1.0 - smoothstep(0.92, 1.0, ed);
          col = mix(col, vec3(1.0), white);
          a = max(a, white);
          // Pupil
          vec2 pupilCentre = ec + look * (eyeR * 0.45);
          float pd = length(v_uv - pupilCentre) / pupilR;
          float pupilA = 1.0 - smoothstep(0.92, 1.05, pd);
          col = mix(col, vec3(0.06, 0.07, 0.09), pupilA);
          a = max(a, pupilA);
          // Glint
          vec2 glintCentre = pupilCentre - vec2(pupilR * 0.35, pupilR * 0.35);
          float gd = length(v_uv - glintCentre) / (pupilR * 0.30);
          float glintA = (1.0 - smoothstep(0.92, 1.05, gd)) * 0.85;
          col = mix(col, vec3(1.0), glintA);
        }
      }
    }
  }

  // ---------- Mouth ----------
  // All mouth styles centred at (0, mouthY) in body-radius units; mouthW
  // is the half-extent.
  vec2 mc = vec2(0.0, mouthY);
  vec2 d = v_uv - mc;

  if (mouthKind == 1 || mouthKind == 6) {
    // SMILE (or DROOL — base smile)
    float arc = arcA(v_uv, vec2(0.0, mouthY - mouthW * 0.3), mouthW, 0.04, 0.12 * 3.14159, 0.88 * 3.14159);
    col = mix(col, v_mouthCol, arc);
    a = max(a, arc);
    if (mouthKind == 6) {
      // Drool drip — small ellipse below the smile, animates over time.
      float dripPhase = fract(u_time * 0.6 + phase);
      vec2 dripC = vec2(mouthW * 0.25, mouthY + mouthW * 0.25 + dripPhase * mouthW * 0.8);
      vec2 dr = (v_uv - dripC) / vec2(mouthW * 0.10, mouthW * 0.16);
      float dripA = (1.0 - smoothstep(0.85, 1.0, length(dr))) * (1.0 - dripPhase);
      col = mix(col, vec3(0.47, 0.86, 0.51), dripA);
      a = max(a, dripA);
    }
  } else if (mouthKind == 2) {
    // FROWN
    float arc = arcA(v_uv, vec2(0.0, mouthY + mouthW * 0.6), mouthW, 0.04, 1.12 * 3.14159, 1.88 * 3.14159);
    col = mix(col, v_mouthCol, arc);
    a = max(a, arc);
  } else if (mouthKind == 3) {
    // SNARL — zig-zag teeth (5 segments)
    // Distance from each segment, kept loose since GLSL line-segment SDF is verbose.
    // Approximate with a thin band that follows y = mouthY + (i%2)*0.18*mouthW
    float xrel = (v_uv.x - 0.0) / mouthW;
    if (abs(xrel) < 1.0) {
      float seg = floor((xrel + 1.0) * 2.5);
      float yTarget = mouthY + (mod(seg, 2.0) < 0.5 ? 0.0 : mouthW * 0.18);
      float dy = abs(v_uv.y - yTarget);
      float zigA = 1.0 - smoothstep(0.02, 0.04, dy);
      col = mix(col, v_mouthCol, zigA);
      a = max(a, zigA);
    }
  } else if (mouthKind == 4) {
    // FANGS — open mouth ellipse + two white triangles
    vec2 dn = d / vec2(mouthW, mouthW * 0.45);
    float open = 1.0 - smoothstep(0.92, 1.0, length(dn));
    col = mix(col, v_mouthCol, open);
    a = max(a, open);
    // Approximate fangs with two small bright wedges below the mouth ellipse.
    vec2 fL = vec2(-mouthW * 0.40, mouthY + mouthW * 0.10);
    vec2 fR = vec2( mouthW * 0.40, mouthY + mouthW * 0.10);
    float fLA = (1.0 - smoothstep(0.85, 1.0, length((v_uv - fL) / vec2(mouthW * 0.10, mouthW * 0.32)))) * 1.0;
    float fRA = (1.0 - smoothstep(0.85, 1.0, length((v_uv - fR) / vec2(mouthW * 0.10, mouthW * 0.32)))) * 1.0;
    col = mix(col, vec3(1.0), max(fLA, fRA));
    a = max(a, max(fLA, fRA));
  } else if (mouthKind == 5) {
    // TONGUE — open mouth + pink tongue ellipse below
    vec2 dn = d / vec2(mouthW, mouthW * 0.40);
    float open = 1.0 - smoothstep(0.92, 1.0, length(dn));
    col = mix(col, v_mouthCol, open);
    a = max(a, open);
    float wag = sin(u_time * 5.0 + phase) * mouthW * 0.18;
    vec2 tc = vec2(wag, mouthY + mouthW * 0.30);
    vec2 td = (v_uv - tc) / vec2(mouthW * 0.32, mouthW * 0.22);
    float tA = 1.0 - smoothstep(0.85, 1.0, length(td));
    col = mix(col, vec3(1.0, 0.54, 0.63), tA);
    a = max(a, tA);
  }

  if (a <= 0.0) discard;
  outColor = vec4(col, a);
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

    // metaSplit (per-pair metaball pass). Programs / VBOs / FBOs created
    // in init(); the RT pool layout depends on S.metaRtMode (see header).
    this._metaPolyProg = null;
    this._metaPolyU = {};
    this._metaBlurProg = null;
    this._metaBlurU = {};
    this._metaTintProg = null;
    this._metaTintU = {};
    this._metaPolyVbo = null;
    this._metaPolyVao = null;
    // 34 verts per half (1 fan-centre + 32 rim + 1 closer) × 2 floats × 2 halves.
    this._metaPolyData = new Float32Array(2 * (WOBBLE_VERTS + 2) * 2);
    // Pool entries: { fbo, tex, w, h }. Indexed by pair index for 'bbox'
    // and 'fullCanvas'; 'sharedMax' uses index 0 only.
    this._metaPool = [];
    this._metaPoolMode = null;            // last-applied mode; rebuild on change
    this._metaPoolCanvasW = 0;            // canvas size that fullCanvas pool was sized for
    this._metaPoolCanvasH = 0;
    this._metaActivePairCount = 0;        // hide pool sprites equivalent (just a counter for debug)

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
    this._diskU.highlight = gl.getUniformLocation(this._diskProg, 'u_highlight');
    this._diskU.membraneIntensity = gl.getUniformLocation(this._diskProg, 'u_membraneIntensity');

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
    //  17..20  outline  (rgba; .a = c.flash)
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
    attr(6, 4); // a_outline (rgba; .a = c.flash)
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
    this._bgU.rbc = bu('u_rbc');

    this._bgVao = gl.createVertexArray();

    // Reusable arrays for the per-frame spot-uniform upload.
    this._spotsBuf = new Float32Array(MAX_SPOTS * 4);
    this._spotColsBuf = new Float32Array(MAX_SPOTS * 3);

    // ---- face program (cartoon mode) ----
    this._faceProg = link(gl, VERT_FACE, FRAG_FACE);
    this._faceU = {
      camera: gl.getUniformLocation(this._faceProg, 'u_camera'),
      viewport: gl.getUniformLocation(this._faceProg, 'u_viewport'),
      time: gl.getUniformLocation(this._faceProg, 'u_time'),
    };
    this._faceVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._faceVbo);
    this._faceCapacity = 0;
    this._faceData = new Float32Array(0);
    this._growFaceBuffer(64);

    this._faceVao = gl.createVertexArray();
    gl.bindVertexArray(this._faceVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._cornerVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._faceVbo);
    {
      const stride = FACE_INSTANCE_FLOATS * 4;
      let off = 0;
      const fa = (loc, size) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
        gl.vertexAttribDivisor(loc, 1);
        off += size * 4;
      };
      fa(1, 4); // a_inst   (x, y, r, mouthKind)
      fa(2, 4); // a_face1  (eyesCount, eyeR, eyeY, pupilR)
      fa(3, 4); // a_face2  (lookX, lookY, mouthW, blink)
      fa(4, 4); // a_face3  (mouthY, phase, _, _)
      fa(5, 3); // a_mouthCol (rgb)
    }
    gl.bindVertexArray(null);

    // ---- decoration program (lines + triangles share the same shader) ----
    this._decorProg = link(gl, VERT_DECOR, FRAG_DECOR);
    this._decorU = {
      camera: gl.getUniformLocation(this._decorProg, 'u_camera'),
      viewport: gl.getUniformLocation(this._decorProg, 'u_viewport'),
    };
    // Two dynamic buffers (lines + tris) share the same vertex layout.
    this._decorLineVbo = gl.createBuffer();
    this._decorTriVbo = gl.createBuffer();
    this._decorLines = [];   // packed (x, y, r, g, b, a) ×N
    this._decorTris  = [];
    this._decorLineCap = 0;
    this._decorTriCap = 0;
    const makeDecorVao = (vbo) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, DECOR_VERT_FLOATS * 4, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, DECOR_VERT_FLOATS * 4, 8);
      gl.bindVertexArray(null);
      return vao;
    };
    this._decorLineVao = makeDecorVao(this._decorLineVbo);
    this._decorTriVao = makeDecorVao(this._decorTriVbo);

    // ---- target-marker dashed-line program ----
    this._dashProg = link(gl, VERT_DASH, FRAG_DASH);
    this._dashU = {
      camera: gl.getUniformLocation(this._dashProg, 'u_camera'),
      viewport: gl.getUniformLocation(this._dashProg, 'u_viewport'),
      dashOffset: gl.getUniformLocation(this._dashProg, 'u_dashOffset'),
      alpha: gl.getUniformLocation(this._dashProg, 'u_alpha'),
    };
    this._dashVbo = gl.createBuffer();
    this._dashVao = gl.createVertexArray();
    gl.bindVertexArray(this._dashVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._dashVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);

    // ---- target-marker pulsing-circle program ----
    this._markerProg = link(gl, VERT_MARKER, FRAG_MARKER);
    this._markerU = {
      camera: gl.getUniformLocation(this._markerProg, 'u_camera'),
      viewport: gl.getUniformLocation(this._markerProg, 'u_viewport'),
      marker: gl.getUniformLocation(this._markerProg, 'u_marker'),
      age: gl.getUniformLocation(this._markerProg, 'u_age'),
      innerNorm: gl.getUniformLocation(this._markerProg, 'u_innerNorm'),
      ringNorm: gl.getUniformLocation(this._markerProg, 'u_ringNorm'),
      ringHalfPx: gl.getUniformLocation(this._markerProg, 'u_ringHalfPx'),
    };
    this._markerVao = gl.createVertexArray();
    gl.bindVertexArray(this._markerVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._cornerVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);

    this._buildMetaballPipeline();
  }

  _buildMetaballPipeline() {
    const gl = this.gl;
    this._metaPolyProg = link(gl, VERT_META_POLY, FRAG_FLAT_WHITE);
    this._metaPolyU = {
      rtSize: gl.getUniformLocation(this._metaPolyProg, 'u_rtSize'),
      rtOrigin: gl.getUniformLocation(this._metaPolyProg, 'u_rtOrigin'),
    };
    this._metaBlurProg = link(gl, VERT_FULLSCREEN, FRAG_META_BLUR);
    this._metaBlurU = {
      src: gl.getUniformLocation(this._metaBlurProg, 'u_src'),
      srcSize: gl.getUniformLocation(this._metaBlurProg, 'u_srcSize'),
      dir: gl.getUniformLocation(this._metaBlurProg, 'u_dir'),
      radius: gl.getUniformLocation(this._metaBlurProg, 'u_radius'),
    };
    this._metaTintProg = link(gl, VERT_FULLSCREEN, FRAG_META_TINT);
    this._metaTintU = {
      src: gl.getUniformLocation(this._metaTintProg, 'u_src'),
      srcSize: gl.getUniformLocation(this._metaTintProg, 'u_srcSize'),
      rtOrigin: gl.getUniformLocation(this._metaTintProg, 'u_rtOrigin'),
      canvasSize: gl.getUniformLocation(this._metaTintProg, 'u_canvasSize'),
      midPx: gl.getUniformLocation(this._metaTintProg, 'u_midPx'),
      gr: gl.getUniformLocation(this._metaTintProg, 'u_gr'),
      K: gl.getUniformLocation(this._metaTintProg, 'u_K'),
      cytoTop: gl.getUniformLocation(this._metaTintProg, 'u_cytoTop'),
      cytoBot: gl.getUniformLocation(this._metaTintProg, 'u_cytoBot'),
    };

    this._metaPolyVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._metaPolyVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._metaPolyData.byteLength, gl.DYNAMIC_DRAW);
    this._metaPolyVao = gl.createVertexArray();
    gl.bindVertexArray(this._metaPolyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._metaPolyVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
  }

  // RT pool acquisition. Each entry owns *two* FBO/texture pairs so the
  // metaball chain can ping-pong scratchA → scratchB → scratchA without
  // a third allocation. Sizing depends on S.metaRtMode:
  //   'bbox'        — reqW × reqH, rounded up to a 64-px grid (so the
  //                   pool reuses entries as the pair gradually grows).
  //   'fullCanvas'  — the canvas physical size, regardless of req.
  //   'sharedMax'   — pairIdx is forced to 0 by the caller; size grows
  //                   monotonically to the largest req seen.
  _metaAcquireRt(pairIdx, reqW, reqH) {
    const gl = this.gl;
    const mode = this._metaResolvedMode || 'bbox';
    let entry = this._metaPool[pairIdx];

    let targetW, targetH;
    if (mode === 'bbox') {
      const grid = 64;
      targetW = Math.max(grid, Math.ceil(reqW / grid) * grid);
      targetH = Math.max(grid, Math.ceil(reqH / grid) * grid);
    } else if (mode === 'fullCanvas') {
      targetW = this.canvas.width;
      targetH = this.canvas.height;
    } else { // sharedMax
      const prevW = (entry && entry.w) || 0;
      const prevH = (entry && entry.h) || 0;
      const grid = 128;
      targetW = Math.max(prevW, Math.ceil(reqW / grid) * grid, grid);
      targetH = Math.max(prevH, Math.ceil(reqH / grid) * grid, grid);
    }

    if (entry && entry.w === targetW && entry.h === targetH) return entry;
    if (entry) this._metaFreeEntry(entry);

    const make = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, targetW, targetH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fbo, tex };
    };
    const a = make();
    const b = make();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    entry = {
      fboA: a.fbo, texA: a.tex,
      fboB: b.fbo, texB: b.tex,
      w: targetW, h: targetH,
    };
    this._metaPool[pairIdx] = entry;
    return entry;
  }

  _metaFreeEntry(entry) {
    const gl = this.gl;
    if (!entry) return;
    if (entry.fboA) gl.deleteFramebuffer(entry.fboA);
    if (entry.texA) gl.deleteTexture(entry.texA);
    if (entry.fboB) gl.deleteFramebuffer(entry.fboB);
    if (entry.texB) gl.deleteTexture(entry.texB);
  }

  _metaDestroyPool() {
    for (const entry of this._metaPool) this._metaFreeEntry(entry);
    this._metaPool = [];
  }

  _growFaceBuffer(target) {
    if (target <= this._faceCapacity) return;
    const newCap = Math.max(64, Math.ceil(target * 1.5));
    this._faceData = new Float32Array(newCap * FACE_INSTANCE_FLOATS);
    this._faceCapacity = newCap;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._faceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._faceData.byteLength, gl.DYNAMIC_DRAW);
  }

  resize(W, H, dpr, renderScale) {
    this.W = W; this.H = H; this.dpr = dpr; this.renderScale = renderScale;
    const rs = renderScale;
    this.canvas.width = Math.max(2, Math.floor(W * dpr * rs));
    this.canvas.height = Math.max(2, Math.floor(H * dpr * rs));
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // Pool RTs are sized to canvas in 'fullCanvas' mode; resize forces
    // a rebuild. For 'bbox' / 'sharedMax' the next per-pair acquire
    // will redetermine size, so the safest move is to wipe the pool.
    this._metaDestroyPool();
    this._metaPoolCanvasW = this.canvas.width;
    this._metaPoolCanvasH = this.canvas.height;
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
    gl.uniform1i(this._bgU.rbc, bg.rbcSilhouettes ? 1 : 0);

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

    // Partition: when S.metaSplit is on, group both halves of any
    // SPLITTING cell by id and render them through the metaball pass.
    // Pairs where only one half is in view fall back to the singleton
    // path (matches canvas2d / pixi). Singletons feed the disk pass
    // unchanged.
    const useMetaSplit = !!S.metaSplit;
    const splittingByCellId = useMetaSplit ? new Map() : null;
    const singletons = useMetaSplit ? [] : shapes;
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
      for (const [id, pair] of splittingByCellId) {
        if (pair.length < 2) {
          for (const s of pair) singletons.push(s);
          splittingByCellId.delete(id);
        }
      }
    }

    // ---- Disk pass (singletons only when metaSplit is on) ----
    if (singletons.length > 0) {
      this._growInstanceBuffer(singletons.length);
      const data = this._instanceData;
      const outlineRgb = hexToVec3(currentTheme().outline.color);
      for (let i = 0; i < singletons.length; i++) {
        const s = singletons[i];
        const c = s.cell;
        const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
        const cc = type.colors;
        const top = hexToVec3(cc.cytoTop);
        const bot = hexToVec3(cc.cytoBot);
        const nuc = hexToVec3(cc.nucleus);
        const bodyK = BODY_KIND_FLOAT[(type.body && type.body.kind) || 'round'] || 0;
        const nucK = NUC_KIND_FLOAT[(type.nucleus && type.nucleus.kind) || 'none'] || 0;
        const sel = this.sim.selectedCells.has(c) ? 1 : 0;
        const hollow = type.bodyHollow ? 1 : 0;
        const kind = bodyK + nucK * 16 + sel * 256 + hollow * 4096;
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
        data[j + 20] = c.flash || 0;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, singletons.length * INSTANCE_FLOATS);

      gl.useProgram(this._diskProg);
      gl.uniform3f(this._diskU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
      gl.uniform2f(this._diskU.viewport, this.W, this.H);
      gl.uniform1f(this._diskU.time, time);
      gl.uniform1f(this._diskU.wobbleAmp, S.wobbleAmp || 0);
      gl.uniform3fv(this._diskU.highlight, hexToVec3(currentHighlightColor()));
      gl.uniform1f(this._diskU.membraneIntensity,
        (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55);
      gl.bindVertexArray(this._diskVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, singletons.length);
      gl.bindVertexArray(null);
    }

    // ---- metaSplit pass (one fused blob per SPLITTING pair) ----
    if (splittingByCellId && splittingByCellId.size > 0) {
      this._renderSplittingPairs(splittingByCellId, time);
    }

    // Cartoon faces — only when the toggle is on.
    // Per-cell decorations (spikes, tendrils, flagella, etc.).
    this._drawDecorations(shapes, time);
    if (S.cartoon) this._drawFaces(shapes, time);
  }

  // Per-pair metaball pass. Renders both halves' wobble polygons in
  // white onto an offscreen RT, separable Gaussian blur, then a single
  // fragment pass folds together the alpha threshold and the canvas2d
  // 3-stop radial-gradient tint, blending onto the main canvas.
  _renderSplittingPairs(splittingByCellId, time) {
    const gl = this.gl;
    const cam = this.camera;
    const fbW = this.canvas.width;
    const fbH = this.canvas.height;
    // CSS-px → physical-px scale (dpr * renderScale). The disk pass
    // viewport is also at this resolution, so the metaball tint blends
    // 1:1 over it. `field.blur` is specified in CSS px; multiply for the
    // RT (which is at physical px).
    const pxScale = fbW / Math.max(1, this.W);

    // Resolve mode: rebuild the pool if S.metaRtMode changed since the
    // last frame, so a settings toggle takes effect immediately.
    const mode = (S.metaRtMode === 'fullCanvas' || S.metaRtMode === 'sharedMax')
      ? S.metaRtMode : 'bbox';
    if (mode !== this._metaResolvedMode) {
      this._metaDestroyPool();
      this._metaResolvedMode = mode;
    }

    let pairIdx = 0;
    for (const [, pair] of splittingByCellId) {
      const c = pair[0].cell;
      const cType = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const fld = cType.field || { blur: 6, contrast: 20 };
      const cc = cellColors(c);
      const blurPx = Math.max(0, fld.blur * pxScale);
      const padPx = Math.ceil(blurPx * 3 + 4);

      // Pack polygon verts (both halves) into _metaPolyData.
      // Layout per half: [center, rim0..rim31, rim0_again] = 34 verts.
      const poly = this._metaPolyData;
      let off = 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let mx = 0, my = 0; // gradient centre = avg of half centers (physical px)
      let maxR = 0;
      for (let p = 0; p < pair.length; p++) {
        const s = pair[p];
        mx += (s.x * cam.scale + cam.tx) * pxScale;
        my += (s.y * cam.scale + cam.ty) * pxScale;
        maxR = Math.max(maxR, s.r * cam.scale * pxScale);
        const rimStart = off + 2;
        let cxAcc = 0, cyAcc = 0;
        for (let i = 0; i < WOBBLE_VERTS; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], time);
          const px = (v.x * cam.scale + cam.tx) * pxScale;
          const py = (v.y * cam.scale + cam.ty) * pxScale;
          poly[rimStart + i * 2]     = px;
          poly[rimStart + i * 2 + 1] = py;
          cxAcc += px; cyAcc += py;
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        poly[off]     = cxAcc / WOBBLE_VERTS;
        poly[off + 1] = cyAcc / WOBBLE_VERTS;
        const rimEnd = rimStart + WOBBLE_VERTS * 2;
        poly[rimEnd]     = poly[rimStart];
        poly[rimEnd + 1] = poly[rimStart + 1];
        off = rimEnd + 2;
      }
      mx /= pair.length;
      my /= pair.length;
      const gr = Math.max(maxR, 1) * 1.95;

      // Bbox in canvas physical px (top-left origin), clamped to canvas.
      const bboxX = Math.max(0, Math.floor(minX - padPx));
      const bboxY = Math.max(0, Math.floor(minY - padPx));
      const bboxRight = Math.min(fbW, Math.ceil(maxX + padPx));
      const bboxBottom = Math.min(fbH, Math.ceil(maxY + padPx));
      const bboxW = bboxRight - bboxX;
      const bboxH = bboxBottom - bboxY;
      if (bboxW <= 0 || bboxH <= 0) { pairIdx++; continue; }

      // Acquire RT. For 'sharedMax' all pairs share index 0.
      const acquireIdx = (mode === 'sharedMax') ? 0 : pairIdx;
      const rt = this._metaAcquireRt(
        acquireIdx,
        (mode === 'fullCanvas') ? fbW : bboxW,
        (mode === 'fullCanvas') ? fbH : bboxH,
      );

      // For 'fullCanvas' mode, the RT origin is (0,0) in canvas coords —
      // the polygon and viewport sit at the bbox subregion of a canvas-
      // sized RT. For 'bbox' / 'sharedMax', the RT is local: origin
      // becomes the bbox top-left, viewport covers the bbox in the RT.
      const rtOriginX = (mode === 'fullCanvas') ? 0 : bboxX;
      const rtOriginY = (mode === 'fullCanvas') ? 0 : bboxY;
      const rtViewportX = (mode === 'fullCanvas') ? bboxX : 0;
      // gl.viewport is bottom-left; convert from top-left bbox coords.
      const rtViewportY = (mode === 'fullCanvas')
        ? (rt.h - bboxY - bboxH)
        : (rt.h - bboxH);

      // ---- Pass 1: clear scratchA, render polygons (white) ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fboA);
      gl.viewport(0, 0, rt.w, rt.h);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this._metaPolyProg);
      gl.uniform2f(this._metaPolyU.rtSize, rt.w, rt.h);
      gl.uniform2f(this._metaPolyU.rtOrigin, rtOriginX, rtOriginY);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._metaPolyVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, poly, 0, off);
      gl.bindVertexArray(this._metaPolyVao);
      const vertsPerHalf = WOBBLE_VERTS + 2;
      for (let p = 0; p < pair.length; p++) {
        gl.drawArrays(gl.TRIANGLE_FAN, p * vertsPerHalf, vertsPerHalf);
      }
      gl.bindVertexArray(null);

      // ---- Pass 2: clear scratchB, horizontal blur scratchA → scratchB ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fboB);
      gl.viewport(0, 0, rt.w, rt.h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(rtViewportX, rtViewportY, bboxW, bboxH);
      gl.useProgram(this._metaBlurProg);
      gl.uniform2f(this._metaBlurU.srcSize, rt.w, rt.h);
      gl.uniform2f(this._metaBlurU.dir, 1.0 / rt.w, 0);
      gl.uniform1f(this._metaBlurU.radius, blurPx);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rt.texA);
      gl.uniform1i(this._metaBlurU.src, 0);
      gl.bindVertexArray(this._bgVao); // empty VAO → fullscreen via gl_VertexID
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // ---- Pass 3: vertical blur scratchB → scratchA (overwriting bbox) ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fboA);
      gl.viewport(rtViewportX, rtViewportY, bboxW, bboxH);
      gl.uniform2f(this._metaBlurU.dir, 0, 1.0 / rt.h);
      gl.bindTexture(gl.TEXTURE_2D, rt.texB);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // ---- Pass 4: tint+threshold scratchA → main canvas (alpha blend) ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // Convert bbox from canvas top-left to GL bottom-left for viewport.
      gl.viewport(bboxX, fbH - bboxY - bboxH, bboxW, bboxH);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this._metaTintProg);
      gl.uniform2f(this._metaTintU.srcSize, rt.w, rt.h);
      gl.uniform2f(this._metaTintU.rtOrigin, rtOriginX, rtOriginY);
      gl.uniform2f(this._metaTintU.canvasSize, fbW, fbH);
      gl.uniform2f(this._metaTintU.midPx, mx, my);
      gl.uniform1f(this._metaTintU.gr, gr);
      gl.uniform1f(this._metaTintU.K, fld.contrast);
      gl.uniform3fv(this._metaTintU.cytoTop, hexToVec3(cc.cytoTop));
      gl.uniform3fv(this._metaTintU.cytoBot, hexToVec3(cc.cytoBot));
      gl.bindTexture(gl.TEXTURE_2D, rt.texA);
      gl.uniform1i(this._metaTintU.src, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      pairIdx++;
    }

    // Restore default viewport for subsequent passes.
    gl.viewport(0, 0, fbW, fbH);
    this._metaActivePairCount = pairIdx;
  }

  _drawFaces(shapes, time) {
    const gl = this.gl;
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
    // First pass: count how many cells actually paint a face (skip the ones
    // with eyes==0 && mouth==none) and pack instance data.
    this._growFaceBuffer(shapes.length);
    const data = this._faceData;
    let n = 0;
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      const c = s.cell;
      const cfg = FACE[c.type] || FACE.default;
      const eyesCount = cfg.eyes || 0;
      const mouthName = (cfg.mouth || 'none');
      const mouthKind = MOUTH_KIND_FLOAT[mouthName] || 0;
      if (eyesCount === 0 && mouthKind === 0) continue;

      // Look direction → unit vector. Velocity-based, falls back to alarmTarget.
      let lookX = c.vx, lookY = c.vy;
      if (c.alarmTimer > 0 && c.alarmTarget && c.alarmTarget.state === 'NORMAL') {
        lookX = c.alarmTarget.x - c.x;
        lookY = c.alarmTarget.y - c.y;
      }
      const lm = Math.hypot(lookX, lookY) || 1;
      lookX /= lm; lookY /= lm;

      // Blink: when nextBlink fires the eyes squint for ~120ms, then
      // re-arm. Sim updates aren't aware of this, so we rearm here.
      if (now > c.nextBlink) c.nextBlink = now + 120 + 3000 + Math.random() * 3500;
      const blink = ((c.nextBlink - now) < 120 && (c.nextBlink - now) > 0) ? 1 : 0;

      // Mouth fill colour follows the cell's nucleus colour (matches the
      // Canvas2D pass) so it reads as part of the body.
      const mc = (CELL_TYPES[c.type] || CELL_TYPES.neutrophil).colors;
      const mcRgb = hexToVec3(mc.nucleus);

      const j = n * FACE_INSTANCE_FLOATS;
      data[j]     = c.x;
      data[j + 1] = c.y;
      data[j + 2] = c.r;
      data[j + 3] = mouthKind;
      data[j + 4] = eyesCount;
      data[j + 5] = cfg.eyeR != null ? cfg.eyeR : 0.18;
      data[j + 6] = cfg.eyeY != null ? cfg.eyeY : -0.10;
      data[j + 7] = cfg.pupilR != null ? cfg.pupilR : 0.07;
      data[j + 8] = lookX;
      data[j + 9] = lookY;
      data[j + 10] = 0.34 * 1.2;     // mouthW (half-extent in body-r units)
      data[j + 11] = blink;
      data[j + 12] = 0.18;           // mouthY
      data[j + 13] = c.phase || 0;
      data[j + 14] = 0;
      data[j + 15] = 0;
      data[j + 16] = mcRgb[0];
      data[j + 17] = mcRgb[1];
      data[j + 18] = mcRgb[2];
      n++;
    }
    if (n === 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this._faceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * FACE_INSTANCE_FLOATS);

    gl.useProgram(this._faceProg);
    gl.uniform3f(this._faceU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
    gl.uniform2f(this._faceU.viewport, this.W, this.H);
    gl.uniform1f(this._faceU.time, time);
    gl.bindVertexArray(this._faceVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  // ---------- Decorations ----------
  _drawDecorations(shapes, time) {
    this._decorLines.length = 0;
    this._decorTris.length = 0;
    const theme = currentTheme();
    for (const s of shapes) {
      const c = s.cell;
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const kind = type.decoration && type.decoration.kind;
      if (!kind || kind === 'none') continue;
      switch (kind) {
        case 'bigSpikes':         this._decorBigSpikes(s, theme, time); break;
        case 'spikesPulsing':     this._decorSpikesPulsing(s, theme, time); break;
        case 'tendrils':          this._decorTendrils(s, theme, time); break;
        case 'tentaclesWiggling': this._decorTentacles(s, theme, time); break;
        case 'flagellum':         this._decorFlagellum(s, theme, time); break;
        case 'drips':             this._decorDrips(s, theme, time); break;
        case 'legs':              this._decorLegs(s, theme, time); break;
        case 'fuzz':              this._decorFuzz(s, theme, time); break;
        case 'yReceptorsFew':     this._decorY(s, theme, time, 6); break;
        case 'yReceptorsMany':    this._decorY(s, theme, time, 14); break;
      }
    }
    if (this._decorLines.length === 0 && this._decorTris.length === 0) return;
    this._uploadAndDrawDecorations();
  }

  _pushLine(x1, y1, x2, y2, r, g, b, a) {
    const arr = this._decorLines;
    arr.push(x1, y1, r, g, b, a, x2, y2, r, g, b, a);
  }
  _pushTri(p0, p1, p2, r, g, b, a) {
    const arr = this._decorTris;
    arr.push(p0[0], p0[1], r, g, b, a, p1[0], p1[1], r, g, b, a, p2[0], p2[1], r, g, b, a);
  }

  _uploadAndDrawDecorations() {
    const gl = this.gl;
    gl.useProgram(this._decorProg);
    gl.uniform3f(this._decorU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
    gl.uniform2f(this._decorU.viewport, this.W, this.H);

    if (this._decorLines.length > 0) {
      const arr = new Float32Array(this._decorLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._decorLineVbo);
      if (arr.byteLength > this._decorLineCap) {
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        this._decorLineCap = arr.byteLength;
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
      }
      gl.bindVertexArray(this._decorLineVao);
      gl.drawArrays(gl.LINES, 0, this._decorLines.length / DECOR_VERT_FLOATS);
    }
    if (this._decorTris.length > 0) {
      const arr = new Float32Array(this._decorTris);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._decorTriVbo);
      if (arr.byteLength > this._decorTriCap) {
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        this._decorTriCap = arr.byteLength;
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
      }
      gl.bindVertexArray(this._decorTriVao);
      gl.drawArrays(gl.TRIANGLES, 0, this._decorTris.length / DECOR_VERT_FLOATS);
    }
    gl.bindVertexArray(null);
  }

  // Per-decoration helpers — port the canvas2d helpers, but emit
  // line / triangle vertices into the shared buffers instead of
  // talking to a 2D context.

  _decorBigSpikes(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const accent = hexToVec3(cc.accent);
    const outline = hexToVec3(theme.outline.color);
    const N = 8;
    const tipLen = s.r * 0.55;
    const baseHalf = s.r * 0.09;
    for (let i = 0; i < N; i++) {
      const jitter = (frac(c.id * 0.31 + i * 0.71) - 0.5) * 0.25;
      const theta = (i / N) * Math.PI * 2 + jitter;
      const base = shapeVertex(s, theta, t);
      const a = [base.x + Math.cos(theta + Math.PI / 2) * baseHalf,
                 base.y + Math.sin(theta + Math.PI / 2) * baseHalf];
      const b = [base.x + Math.cos(theta - Math.PI / 2) * baseHalf,
                 base.y + Math.sin(theta - Math.PI / 2) * baseHalf];
      const tip = [base.x + Math.cos(theta) * tipLen, base.y + Math.sin(theta) * tipLen];
      this._pushTri(a, tip, b, accent[0], accent[1], accent[2], 1.0);
      this._pushLine(a[0], a[1], tip[0], tip[1], outline[0], outline[1], outline[2], 1.0);
      this._pushLine(tip[0], tip[1], b[0], b[1], outline[0], outline[1], outline[2], 1.0);
      this._pushLine(b[0], b[1], a[0], a[1], outline[0], outline[1], outline[2], 1.0);
    }
  }

  _decorSpikesPulsing(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const accent = hexToVec3(cc.accent);
    const outline = hexToVec3(theme.outline.color);
    const N = 10;
    const baseHalf = s.r * 0.09;
    for (let i = 0; i < N; i++) {
      const jitter = (frac(c.id * 0.31 + i * 0.71) - 0.5) * 0.18;
      const theta = (i / N) * Math.PI * 2 + jitter;
      const tipLen = s.r * (0.45 + 0.18 * Math.sin(t * 2.5 + i * 0.7 + (c.wobbleSeed || 0)));
      const base = shapeVertex(s, theta, t);
      const a = [base.x + Math.cos(theta + Math.PI / 2) * baseHalf,
                 base.y + Math.sin(theta + Math.PI / 2) * baseHalf];
      const b = [base.x + Math.cos(theta - Math.PI / 2) * baseHalf,
                 base.y + Math.sin(theta - Math.PI / 2) * baseHalf];
      const tip = [base.x + Math.cos(theta) * tipLen, base.y + Math.sin(theta) * tipLen];
      this._pushTri(a, tip, b, accent[0], accent[1], accent[2], 1.0);
      this._pushLine(a[0], a[1], tip[0], tip[1], outline[0], outline[1], outline[2], 1.0);
      this._pushLine(tip[0], tip[1], b[0], b[1], outline[0], outline[1], outline[2], 1.0);
    }
  }

  _decorTendrils(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const col = hexToVec3(cc.cytoBot);
    const N = 13;
    const SEG = 12;
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
      // Sample quadratic Bezier at 12 segments.
      let prevX = base.x, prevY = base.y;
      for (let k = 1; k <= SEG; k++) {
        const u = k / SEG;
        const iu = 1 - u;
        const x = iu * iu * base.x + 2 * iu * u * cpX + u * u * tipX;
        const y = iu * iu * base.y + 2 * iu * u * cpY + u * u * tipY;
        this._pushLine(prevX, prevY, x, y, col[0], col[1], col[2], 1.0);
        prevX = x; prevY = y;
      }
    }
  }

  _decorTentacles(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const col = hexToVec3(cc.cytoBot);
    const N = 6;
    const SEG = 12;
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
      let prevX = base.x, prevY = base.y;
      for (let k = 1; k <= SEG; k++) {
        const u = k / SEG;
        const iu = 1 - u;
        const x = iu * iu * base.x + 2 * iu * u * midX + u * u * tipX;
        const y = iu * iu * base.y + 2 * iu * u * midY + u * u * tipY;
        this._pushLine(prevX, prevY, x, y, col[0], col[1], col[2], 1.0);
        prevX = x; prevY = y;
      }
    }
  }

  _decorFlagellum(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const col = hexToVec3(cc.accent);
    const ang = (c.orientation || 0) + Math.PI;
    const startV = shapeVertex(s, ang, t);
    const dirX = Math.cos(ang), dirY = Math.sin(ang);
    const perpX = -dirY, perpY = dirX;
    const length = s.r * 1.6;
    const N = 24;
    let prevX = startV.x, prevY = startV.y;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const along = length * u;
      const wave = Math.sin(u * Math.PI * 3 - t * 6) * (s.r * 0.18) * u;
      const x = startV.x + dirX * along + perpX * wave;
      const y = startV.y + dirY * along + perpY * wave;
      this._pushLine(prevX, prevY, x, y, col[0], col[1], col[2], 1.0);
      prevX = x; prevY = y;
    }
  }

  _decorDrips(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const fill = hexToVec3(cc.cytoBot);
    const outline = hexToVec3(theme.outline.color);
    const N = 5;
    for (let i = 0; i < N; i++) {
      const dirAng = Math.PI * 0.5 - 0.40 + (i / (N - 1)) * 0.80;
      const base = shapeVertex(s, dirAng, t);
      const drop = s.r * 0.22 + s.r * 0.06 * Math.sin(t * 1.8 + i);
      const wL = [base.x - s.r * 0.06, base.y];
      const wR = [base.x + s.r * 0.06, base.y];
      const tip = [base.x, base.y + drop * 1.2];
      // Triangle fan approximating teardrop (3 tris).
      const ctrl = [base.x, base.y + drop];
      this._pushTri(wL, ctrl, wR, fill[0], fill[1], fill[2], 1.0);
      this._pushTri(wL, tip, ctrl, fill[0], fill[1], fill[2], 1.0);
      this._pushTri(ctrl, tip, wR, fill[0], fill[1], fill[2], 1.0);
      // Outline edges.
      this._pushLine(wL[0], wL[1], tip[0], tip[1], outline[0], outline[1], outline[2], 1.0);
      this._pushLine(tip[0], tip[1], wR[0], wR[1], outline[0], outline[1], outline[2], 1.0);
      // Bobbing droplet below — small disc made from a 12-segment fan.
      const bobY = tip[1] + s.r * 0.10 + s.r * 0.05 * Math.sin(t * 2.2 + i * 0.7);
      const cx = base.x, cy = bobY, dr = s.r * 0.07;
      const SEG = 12;
      for (let k = 0; k < SEG; k++) {
        const a0 = (k / SEG) * Math.PI * 2;
        const a1 = ((k + 1) / SEG) * Math.PI * 2;
        const p0 = [cx + Math.cos(a0) * dr, cy + Math.sin(a0) * dr];
        const p1 = [cx + Math.cos(a1) * dr, cy + Math.sin(a1) * dr];
        this._pushTri([cx, cy], p0, p1, fill[0], fill[1], fill[2], 1.0);
      }
    }
  }

  _decorLegs(s, theme, t) {
    const c = s.cell;
    const outline = hexToVec3(theme.outline.color);
    const N = 10;
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
      this._pushLine(base.x, base.y, kneeX, kneeY, outline[0], outline[1], outline[2], 1.0);
      this._pushLine(kneeX, kneeY, tipX, tipY, outline[0], outline[1], outline[2], 1.0);
    }
  }

  _decorFuzz(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const col = hexToVec3(cc.accent);
    const N = 22;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const base = shapeVertex(s, theta, t);
      const len = s.r * (0.18 + 0.10 * Math.sin(t * 1.2 + i * 0.7));
      const tipX = base.x + Math.cos(theta) * len;
      const tipY = base.y + Math.sin(theta) * len;
      this._pushLine(base.x, base.y, tipX, tipY, col[0], col[1], col[2], 0.85);
    }
  }

  _decorY(s, theme, t, count) {
    const c = s.cell;
    const cc = cellColors(c);
    const col = hexToVec3(cc.accent);
    const stem = s.r * 0.22;
    const arms = s.r * 0.13;
    const armSpread = Math.PI * 0.25;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, theta, t);
      const tipX = base.x + Math.cos(theta) * stem;
      const tipY = base.y + Math.sin(theta) * stem;
      this._pushLine(base.x, base.y, tipX, tipY, col[0], col[1], col[2], 1.0);
      const lAng = theta + armSpread;
      const rAng = theta - armSpread;
      this._pushLine(tipX, tipY,
        tipX + Math.cos(lAng) * arms, tipY + Math.sin(lAng) * arms,
        col[0], col[1], col[2], 1.0);
      this._pushLine(tipX, tipY,
        tipX + Math.cos(rAng) * arms, tipY + Math.sin(rAng) * arms,
        col[0], col[1], col[2], 1.0);
    }
  }

  drawSelection(shapes, time) {
    // The per-cell selection ring + tap-flash live in the cell pass
    // (handled by the kind / a_outline.a packing). What's left is the
    // target marker — pulsing circle + dashed lines from each selected
    // cell to the marker point — when sim.targetMarker is present.
    if (this.sim.targetMarker) this._drawTargetMarker();
  }

  _drawTargetMarker() {
    const gl = this.gl;
    const m = this.sim.targetMarker;
    if (!m) return;
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
    const age = (now - m.t0) / 1500;
    if (age >= 1) {
      this.sim.targetMarker = null;
      return;
    }
    const fade = 1 - age;
    const camScale = this.camera.scale;

    // ----- Dashed lines from each selected cell to the marker -----
    if (this.sim.selectedCells.size > 0) {
      const verts = [];
      for (const c of this.sim.selectedCells) {
        if (c.state !== 'NORMAL') continue;
        const dx = m.x - c.x, dy = m.y - c.y;
        const len = Math.hypot(dx, dy);
        // distAlongLine encoded in screen-px units (so dashing uses px).
        const screenLen = len * camScale;
        verts.push(c.x, c.y, 0);
        verts.push(m.x, m.y, screenLen);
      }
      if (verts.length > 0) {
        const arr = new Float32Array(verts);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._dashVbo);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        gl.useProgram(this._dashProg);
        gl.uniform3f(this._dashU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
        gl.uniform2f(this._dashU.viewport, this.W, this.H);
        gl.uniform1f(this._dashU.dashOffset, -now * 0.04);
        gl.uniform1f(this._dashU.alpha, fade);
        gl.bindVertexArray(this._dashVao);
        gl.drawArrays(gl.LINES, 0, verts.length / 3);
        gl.bindVertexArray(null);
      }
    }

    // ----- Pulsing circle + inner dot at the marker -----
    // Quad covers the full ring (ring at 18 / camScale * (1 + 0.4 * age) world units).
    const ringWorld = (18 / camScale) * (1 + 0.4 * age);
    const innerWorld = 4 / camScale;
    const quadR = ringWorld + 6 / camScale;
    gl.useProgram(this._markerProg);
    gl.uniform3f(this._markerU.camera, this.camera.scale, this.camera.tx, this.camera.ty);
    gl.uniform2f(this._markerU.viewport, this.W, this.H);
    gl.uniform3f(this._markerU.marker, m.x, m.y, quadR);
    gl.uniform1f(this._markerU.age, age);
    gl.uniform1f(this._markerU.innerNorm, innerWorld / quadR);
    gl.uniform1f(this._markerU.ringNorm, ringWorld / quadR);
    gl.uniform1f(this._markerU.ringHalfPx, (3 / camScale) / quadR);
    gl.bindVertexArray(this._markerVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  drawDebug(/* shapes */) {
    // TODO Phase 4 wrap-up: cell-radius circles + count overlay.
  }

  endFrame() { /* default framebuffer is auto-swapped by the browser */ }

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() { return 'webgl2'; }

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    if (this._diskProg) gl.deleteProgram(this._diskProg);
    if (this._bgProg) gl.deleteProgram(this._bgProg);
    if (this._faceProg) gl.deleteProgram(this._faceProg);
    if (this._faceVbo) gl.deleteBuffer(this._faceVbo);
    if (this._faceVao) gl.deleteVertexArray(this._faceVao);
    if (this._cornerVbo) gl.deleteBuffer(this._cornerVbo);
    if (this._instanceVbo) gl.deleteBuffer(this._instanceVbo);
    if (this._diskVao) gl.deleteVertexArray(this._diskVao);
    if (this._bgVao) gl.deleteVertexArray(this._bgVao);
    if (this._decorProg) gl.deleteProgram(this._decorProg);
    if (this._decorLineVbo) gl.deleteBuffer(this._decorLineVbo);
    if (this._decorTriVbo) gl.deleteBuffer(this._decorTriVbo);
    if (this._decorLineVao) gl.deleteVertexArray(this._decorLineVao);
    if (this._decorTriVao) gl.deleteVertexArray(this._decorTriVao);
    if (this._dashProg) gl.deleteProgram(this._dashProg);
    if (this._dashVbo) gl.deleteBuffer(this._dashVbo);
    if (this._dashVao) gl.deleteVertexArray(this._dashVao);
    if (this._markerProg) gl.deleteProgram(this._markerProg);
    if (this._markerVao) gl.deleteVertexArray(this._markerVao);
    if (this._metaPolyProg) gl.deleteProgram(this._metaPolyProg);
    if (this._metaBlurProg) gl.deleteProgram(this._metaBlurProg);
    if (this._metaTintProg) gl.deleteProgram(this._metaTintProg);
    if (this._metaPolyVbo) gl.deleteBuffer(this._metaPolyVbo);
    if (this._metaPolyVao) gl.deleteVertexArray(this._metaPolyVao);
    this._metaDestroyPool();
    this.gl = null;
  }
}
