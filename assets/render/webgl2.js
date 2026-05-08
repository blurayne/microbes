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
  S, FACE, CELL_TYPES, currentBackground, currentTheme,
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
in vec3 v_outline;
uniform float u_time;       // seconds
uniform float u_wobbleAmp;  // S.wobbleAmp
uniform vec3 u_highlight;   // S.highlightColor as rgb
out vec4 outColor;

// v_kind packs: body (0..5) + nucleus (0..5) * 16 + selected (0..1) * 256.
int bodyKind()    { return int(mod(v_kind + 0.5, 16.0)); }
int nucKind()     { return int(mod((v_kind + 0.5) / 16.0, 16.0)); }
int isSelected()  { return int((v_kind + 0.5) / 256.0); }

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

  // Outline ring (thin band straddling the body edge).
  float outlineMask = smoothstep(-0.04, -0.005, sdf) * (1.0 - smoothstep(0.0, 0.015, sdf));

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
  col = mix(col, v_outline, clamp(outlineMask, 0.0, 1.0));

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

// Body and nucleus kinds packed into a single float per instance:
//   packedKind = bodyKind + nucKind * 16
const BODY_KIND_FLOAT = {
  round: 0, lobed: 1, rippled: 2, oblong: 3, pseudopod: 4, star: 5,
};
const NUC_KIND_FLOAT = {
  none: 0, round: 1, kidney: 2, bilobed: 3, multilobed: 4, 'round-small': 5,
};

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
      const bodyK = BODY_KIND_FLOAT[(type.body && type.body.kind) || 'round'] || 0;
      const nucK = NUC_KIND_FLOAT[(type.nucleus && type.nucleus.kind) || 'none'] || 0;
      const sel = this.sim.selectedCells.has(c) ? 1 : 0;
      const kind = bodyK + nucK * 16 + sel * 256;
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
    gl.uniform3fv(this._diskU.highlight, hexToVec3(S.highlightColor || '#ffffff'));
    gl.bindVertexArray(this._diskVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, shapes.length);
    gl.bindVertexArray(null);

    // Cartoon faces — only when the toggle is on.
    if (S.cartoon) this._drawFaces(shapes, time);
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
    if (this._faceProg) gl.deleteProgram(this._faceProg);
    if (this._faceVbo) gl.deleteBuffer(this._faceVbo);
    if (this._faceVao) gl.deleteVertexArray(this._faceVao);
    if (this._cornerVbo) gl.deleteBuffer(this._cornerVbo);
    if (this._instanceVbo) gl.deleteBuffer(this._instanceVbo);
    if (this._diskVao) gl.deleteVertexArray(this._diskVao);
    if (this._bgVao) gl.deleteVertexArray(this._bgVao);
    this.gl = null;
  }
}
