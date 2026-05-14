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
  currentBackground, currentBgLayers, currentTheme, currentHighlightColor, cellColors, frac,
  overlayFxOrder, overlayKindRunsAfterScene,
} from '../core/state.js';
import { shapeVertex } from '../core/shape.js';
import { effectiveMouthKind } from '../core/sim-faces.js';
import { testKindFor } from '../core/cell-kinds.js';
import { RendererBase } from './renderer.js';
import { URL_OVERRIDES } from '../core/url-overrides.js';
import { loadTexture } from '../core/texture-loader.js';

// Rendertest translucent mode: paint to a canvas that retains its
// alpha channel so the captured PNG composites onto an arbitrary
// backdrop. Default is opaque (existing behaviour). Read once at
// module load — `URL_OVERRIDES` is frozen.
const RT_TRANSLUCENT = !!URL_OVERRIDES.translucent;
// Diagnostic infrastructure (readPixels + gl.getError() + verbose
// state log every second) is gated behind ?diagnose=webgl (or
// ?diagnose=webgl2) in the URL. Off by default so production
// traffic doesn't pay the 1-frame readback. See
// .claude/skills/webgl-debugger/SKILL.md.
const DIAG_WEBGL = !!(URL_OVERRIDES.diagnose && URL_OVERRIDES.diagnose.has('webgl'));
const RT_CLEAR_A = RT_TRANSLUCENT ? 0.0 : 1.0;

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
layout(location=7) in float a_diskAlpha;     // per-instance fade-in (split-end)
layout(location=8) in vec2 a_bump;           // bump-feedback squash axis (impact-normal × intensity, 0..1)

uniform vec4 u_camera;
uniform vec2 u_viewport;

out vec2 v_uv;
out float v_kind;
out vec4 v_phase;
out vec3 v_cytoTop;
out vec3 v_cytoBot;
out vec3 v_nucleus;
out vec4 v_outline;
out float v_diskAlpha;
out vec2 v_bump;

void main() {
  // 1.70× r — covers wobbly body extents (up to ~1.30) plus the
  // selection ring (which extends to 1.30 × bodyR).
  float quadR = a_inst.z * 1.70;
  vec2 worldPos = a_inst.xy + a_corner * quadR;
  // Camera transform: scale, then rotate by u_camera.w, then translate.
  // Reduces to plain "worldPos * scale + (tx, ty)" when rotation == 0.
  vec2 worldPosScaled = worldPos * u_camera.x;
  float ccw = cos(u_camera.w), scw = sin(u_camera.w);
  vec2 screenPos = vec2(ccw * worldPosScaled.x - scw * worldPosScaled.y,
                        scw * worldPosScaled.x + ccw * worldPosScaled.y)
                 + u_camera.yz;
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
  v_diskAlpha = a_diskAlpha;
  v_bump = a_bump;
}`;

// Body-kind constants (must match TS-side encoding in drawCells).
//   0=round  1=lobed  2=rippled  3=oblong  4=pseudopod  5=star
const FRAG_DISK = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
in float v_kind;
in vec4 v_phase;        // (phase, seed, freq, wobbleMul)
in vec3 v_cytoTop;
in vec3 v_cytoBot;
in vec3 v_nucleus;
in vec4 v_outline;
in float v_diskAlpha;       // SPLITTING crossfade: 0..1 over p ∈ [0.5, 1.0]
in vec2 v_bump;             // bump-feedback squash axis (impact-normal × intensity)
uniform float u_time;       // seconds
uniform float u_wobbleAmp;  // S.wobbleAmp
uniform vec3 u_highlight;   // S.highlightColor as rgb
uniform float u_membraneIntensity; // S.membraneIntensity 0..1
uniform float u_borderThickness;   // S.cellBorderThickness multiplier (~0.5..5)
// Cell-shader theme. 0 legacy (default · today's look) · 1 microscope ·
// 2 cartoon · 3 kurzgesagt · 4 classic. Set from S.theme each frame.
// Float (with the existing precision highp float covering it) is more
// portable than uniform int here — some GLSL ES 3.00 drivers refuse to
// link an int uniform that lacks an explicit precision qualifier, even
// with precision highp int set, returning a null uniform location and
// silently turning the per-frame uniform writes into no-ops.
uniform float u_theme;
out vec4 outColor;

// v_kind packs:
//   body (0..5) + nucleus (0..5) * 16 + selected (0..1) * 256 + hollow (0..1) * 4096
int bodyKind()    { return int(mod(v_kind + 0.5, 16.0)); }
int nucKind()     { return int(mod((v_kind + 0.5) / 16.0, 16.0)); }
int isSelected()  { return int(mod((v_kind + 0.5) / 256.0, 2.0)); }
int isHollow()    { return int(mod((v_kind + 0.5) / 4096.0, 2.0)); }
// Per-cell-type test-kind (0..20), ported from docs/shader-test.html.
// 0 = eukaryote/generic. Read only when u_theme != 0; legacy theme
// (default) ignores this and uses the existing bodyKind dispatch.
int testKind()    { return int(mod((v_kind + 0.5) / 8192.0, 32.0)); }

// Lightweight value-noise + 4-octave fbm for the cytoplasm grain
// pass. Mirrors shader-test's fbm() in scale + octaves so the
// non-legacy theme cyto matches what the playground shows.
float cellHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float cellNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(cellHash(i),                  cellHash(i + vec2(1.0, 0.0)), u.x),
    mix(cellHash(i + vec2(0.0, 1.0)), cellHash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
float cellFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * cellNoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
// 2D rotated capsule SDF — used for mitochondria.
float cellCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

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

// Per-test-kind body silhouette, ported from docs/shader-test.html.
// Returns the membrane radius in body-radius units (~1.0 = nominal).
// Active only when u_theme != 0; legacy theme uses bodyScale() above.
// Test-shader UV constants (radius ~0.5..0.66 in its own frame) are
// rescaled by ~1.7 so the membrane sits at length(v_uv) ≈ 1.0 in the
// game's frame, preserving each cell's existing in-game size (cell.r).
float testShape(vec2 uv, float t) {
  int tk = testKind();
  float ang = atan(uv.y, uv.x);
  if (tk == 5) {
    // virus — hex capsid (6-fold symmetry) + sharp spike modulation
    return 1.0
         + 0.10 * cos(ang * 6.0  + t * 0.30)
         + 0.12 * pow(0.5 + 0.5 * cos(ang * 12.0 - t * 0.20), 6.0);
  }
  if (tk == 6) {
    // bacterium — capsule along x. Approximate as ellipse so we can
    // keep the simple radial scale-factor contract.
    return 1.0 / sqrt(uv.x * uv.x * 0.42 + uv.y * uv.y * 1.55);
  }
  if (tk == 7) {
    // amoeba — large, irregular pseudopod blob
    return 1.10
         + 0.20 * sin(ang * 3.0 + t * 0.40)
         + 0.10 * sin(ang * 7.0 - t * 0.25);
  }
  if (tk == 8) {
    // spore — small disc with a thin breath
    return 0.85 + 0.025 * sin(t * 0.4);
  }
  if (tk == 9) {
    // monocyte — high-frequency surface ripple
    return 1.15
         + 0.06 * sin(ang * 11.0 + t * 0.50)
         + 0.03 * sin(ang * 23.0 - t * 0.30);
  }
  if (tk == 10) {
    // mast cell — slightly oblong (taller than wide)
    return 1.0 / sqrt(uv.x * uv.x * 0.72 + uv.y * uv.y * 1.21);
  }
  if (tk == 11) {
    // dendritic — round body + 6 long thin tendrils
    return 1.0 + 0.45 * pow(0.5 + 0.5 * cos(ang * 6.0 + t * 0.20), 14.0);
  }
  if (tk == 13) {
    // platelet — small 10-point star
    return 0.85 + 0.10 * cos(ang * 10.0);
  }
  if (tk == 17) {
    // germ — small 3-lobe blob
    return 0.95 + 0.16 * cos(ang * 3.0 + t * 0.40);
  }
  if (tk == 18) {
    // slime mold — irregular lobed (chaotic)
    return 1.10
         + 0.18 * sin(ang * 4.0  + t * 0.30)
         + 0.10 * sin(ang * 7.0  - t * 0.50)
         + 0.08 * sin(ang * 11.0 + t * 0.80);
  }
  if (tk == 19) {
    // mite — round with 4 small leg bumps
    return 1.05 + 0.13 * pow(0.5 + 0.5 * cos(ang * 4.0 + 0.5), 8.0);
  }
  if (tk == 20) {
    // toxin — sharp 10-point spike star
    return 0.95 + 0.30 * pow(0.5 + 0.5 * cos(ang * 10.0 + t * 0.30), 4.0);
  }
  // Fallback (eukaryote, macrophage, neutrophil, nk, b-cell, basophil,
  // t-cell, eosinophil, rbc) — keep round; their identity comes from
  // colour + nucleus + the shared sin-based wobble overlay below.
  return 1.0;
}

void main() {
  float d = length(v_uv);
  // Pick the per-cell silhouette: legacy bodyScale (today's 5-kind
  // dispatch on bodyKind) or the per-test-kind testShape with a small
  // wobble overlay so themed cells still breathe.
  // Decode the float u_theme uniform once per fragment.
  int themeId = int(u_theme + 0.5);
  float bodyR;
  if (themeId == 0) {
    bodyR = bodyScale(v_uv);
  } else {
    // Non-legacy themes: shader-test-style membrane. Per-blob-kind
    // amplitude (matches the amp table in shader-test's
    // membraneFor) + a 3-term Fourier wobble that the amp scales.
    float ang = atan(v_uv.y, v_uv.x);
    int tk = testKind();
    float kAmp = 1.0;                  // default eukaryote
    if      (tk == 1)  kAmp = 1.60;    // macrophage
    else if (tk == 2)  kAmp = 0.50;    // neutrophil
    else if (tk == 3)  kAmp = 0.40;    // nk-cell
    else if (tk == 4)  kAmp = 0.60;    // b-cell
    else if (tk == 12) kAmp = 0.30;    // basophil
    else if (tk == 14) kAmp = 0.25;    // t-cell
    else if (tk == 15) kAmp = 0.35;    // eosinophil
    // Wobble + testShape pick up the per-cell freq sign so split-
    // children inheriting the parent's seed+phase visibly diverge
    // (wobble runs the opposite direction on one sibling). The
    // legacy bodyScale path already responded to freq sign; this
    // adds the same behaviour to microscope / cartoon / kurzgesagt /
    // classic. The phase offset v_phase.x rides into each sin too
    // so even at t = 0 siblings don't start exactly aligned.
    float dir   = sign(v_phase.z + 1e-6);
    float tt    = u_time * dir;
    float phi   = v_phase.x;
    float wob = kAmp * (
      0.045 * sin(ang * 5.0  + tt * 0.60 + phi) +
      0.025 * sin(ang * 9.0  - tt * 0.40 + phi * 1.31) +
      0.015 * sin(ang * 17.0 + tt * 1.10 + phi * 0.71)
    );
    // Pull through u_wobbleAmp + per-cell wobbleMul so the user's
    // settings slider + per-cell variation (Sim.makeCell) still
    // dampen / amplify on top of the kind-specific amp.
    wob *= max(0.001, u_wobbleAmp * v_phase.w);
    bodyR = testShape(v_uv, tt) + wob;
  }
  // Bump-feedback squash: compress the silhouette on the impact
  // side and bulge it on the far side. v_bump carries the impact
  // normal x intensity (0..1). When magnitude is ~0 this is a no-op.
  float bumpMag = length(v_bump);
  if (bumpMag > 0.001) {
    vec2 bumpDir = v_bump / bumpMag;
    float along = dot(v_uv / max(1e-4, d), bumpDir);
    bodyR *= 1.0 - 0.30 * bumpMag * along;
  }
  float sdf = d - bodyR;
  int sel = isSelected();

  // Outside the body: contribute a glow ring only when selected.
  if (sdf > 0.015) {
    if (sel == 0) discard;
    float ringT = sdf / (bodyR * 0.30);
    if (ringT >= 1.0) discard;
    // Peak around ringT=0.5; smooth fade at both ends.
    float ringA = smoothstep(0.0, 0.20, ringT) * (1.0 - smoothstep(0.65, 1.0, ringT));
    outColor = vec4(u_highlight, ringA * v_diskAlpha);
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

  // Non-legacy themes: shader-test cytoplasm texturing — fine
  // granular fbm subtracted (cell-grain feel) + slow sheets fbm
  // added (organelle-density variation). B-cell rough ER stripes
  // when testKind == 4. Identical numerical formula to shader-
  // test's fs_main; kAmp / wobble already match by PR-B.1.
  // The per-cell seed (v_phase.y) and phase (v_phase.x) shift the
  // fbm domain + ER phase so every cell of the same type renders a
  // distinct cyto pattern (instead of all looking identical).
  if (themeId != 0) {
    vec2 cellOff = vec2(v_phase.y * 1.31, v_phase.y * 0.83 + v_phase.x);
    float granular = cellFbm(v_uv * 22.0 + cellOff * 7.0
                             + vec2(u_time * 0.02, 0.0));
    cyto -= vec3(0.10, 0.07, 0.08) * granular;
    float sheets = cellFbm(v_uv * 6.0 + cellOff * 2.5
                           - vec2(u_time * 0.03, u_time * 0.02));
    cyto += vec3(0.08, 0.04, 0.05) * (sheets - 0.5);
    if (testKind() == 4) {
      // b-cell — diagonal rough-ER striping
      float er = sin(v_uv.x * 14.0 + v_uv.y * 6.0
                     + u_time * 0.4 + v_phase.x) * 0.5 + 0.5;
      cyto += vec3(0.10, 0.05, 0.07) * (er - 0.5) * 0.6;
    }
  }

  // Donut-hole darkening for cells flagged bodyHollow (RBCs).
  if (isHollow() == 1) {
    float holeT = 1.0 - smoothstep(0.0, 0.45, length(v_uv));
    cyto = mix(cyto, v_cytoBot * 0.42, holeT * 0.85);
  }

  // Bold membrane band straddling the body edge, in the cell's own deep
  // colour (a darkened cytoBot). Width scales with u_borderThickness so
  // the slider can take it from the slim Canvas2D-parity look up to a
  // bold cartoon outline. u_membraneIntensity gates alpha (Canvas2D
  // parity).
  float bt = max(u_borderThickness, 0.001);
  float outlineMask = smoothstep(-0.06 * bt, -0.01 * bt, sdf)
                    * (1.0 - smoothstep(0.0, 0.015 * bt, sdf))
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

  // Non-legacy themes — per-theme compose. PR #117 collapsed all four
  // non-legacy themes (microscope/cartoon/kurzgesagt/classic) into a
  // single branch; this restores the test-shader's distinct per-theme
  // treatments (cyto modulation, highlight, outline colour + opacity,
  // kurzgesagt's neon halo). Cell organelles (nucleus / mito /
  // vesicles) stay visible in EVERY theme so dense fights stay
  // readable — that's the deviation from test-shader's classic, which
  // strips them entirely.
  vec3 themedCyto = cyto;
  vec3 themedOutline = v_cytoBot * 0.55;
  float outlineOp = 1.0;
  float haloAdd = 0.0;
  if (themeId == 1) {
    // microscope — keep cyto unchanged; soft brown outline at 0.85
    themedOutline = vec3(0.16, 0.06, 0.18);
    outlineOp = 0.85;
  } else if (themeId == 2) {
    // cartoon — saturated cyto + soft top-left highlight + thick black outline
    themedCyto = clamp(cyto * 1.30, 0.0, 1.0);
    float hi = smoothstep(0.16, 0.0, distance(v_uv, vec2(-0.30, -0.40)));
    themedCyto += vec3(0.32, 0.30, 0.28) * hi;
    themedOutline = vec3(0.0);
    outlineOp = 1.0;
  } else if (themeId == 3) {
    // kurzgesagt — flat cyto + thin pale outline + neon halo
    themedOutline = vec3(0.95, 0.92, 0.85);
    outlineOp = 0.4;
    haloAdd = pow(smoothstep(0.55, 0.42, length(v_uv)), 2.0);
  } else if (themeId == 4) {
    // classic — lightened/saturated cyto + hard radial highlight + dark purple outline
    themedCyto = clamp(cyto * 1.35 + vec3(0.05), 0.0, 1.0);
    float hi = smoothstep(0.7, 0.0, distance(v_uv, vec2(-0.30, -0.40))) * 0.4;
    themedCyto = mix(themedCyto, v_cytoTop, hi);
    themedOutline = vec3(0.04, 0.02, 0.08);
    outlineOp = 1.0;
  }
  vec3 col = themedCyto;
  col = mix(col, nucColor, nucleusMask);
  col = mix(col, themedOutline, clamp(outlineMask * outlineOp, 0.0, 1.0));
  // kurzgesagt neon halo — additive cyto wash inside the membrane.
  if (themeId == 3 && d < bodyR) {
    col += cyto * 1.6 * haloAdd;
  }

  // Per-test-kind compose overlays. Active only for non-legacy themes;
  // each is gated on the corresponding test kind so the cost stays
  // constant for every other cell. Ported from docs/shader-test.html
  // (rbc biconcave, virus capsid lattice, dendritic tendrils, slime
  // hyphal threads, toxin glow). All work inside v_uv (cell-local).
  if (themeId != 0 && d < bodyR) {
    int tk = testKind();
    float insideMask = 1.0 - smoothstep(-0.005, 0.015, sdf);
    if (tk == 16) {
      // rbc — biconcave depression: darken disc centre.
      float bicon = smoothstep(0.45, 0.10, d);
      col = mix(col, col * 0.45, bicon * insideMask);
    } else if (tk == 5) {
      // virus — bright hex lattice tinted on the body. Per-cell
      // phase rotates the lattice so adjacent virions don't tile.
      float ca = cos(v_phase.x), sa = sin(v_phase.x);
      vec2 latUv = vec2(ca * v_uv.x - sa * v_uv.y,
                        sa * v_uv.x + ca * v_uv.y);
      float h = 0.5 + 0.5 * cos(latUv.x * 16.0) * cos(latUv.y * 16.0);
      col += vec3(0.30, 0.20, 0.45) * pow(h, 6.0) * insideMask;
    } else if (tk == 11) {
      // dendritic — accentuate the tendril rim with a faint cyto glow.
      // Rotation direction follows sign(freq) so siblings from a split
      // rotate opposite ways.
      float dirT = sign(v_phase.z + 1e-6);
      float ang = atan(v_uv.y, v_uv.x);
      float t6  = pow(0.5 + 0.5 * cos(ang * 6.0 + u_time * 0.20 * dirT + v_phase.x), 14.0);
      col += v_cytoBot * t6 * 0.25 * insideMask;
    } else if (tk == 18) {
      // slime — faint dark hyphal threads at the rim. Phase
      // direction follows sign(freq).
      float dirH = sign(v_phase.z + 1e-6);
      float ang = atan(v_uv.y, v_uv.x);
      float lines = pow(abs(cos(ang * 1.5 + u_time * 0.10 * dirH + v_phase.x)), 50.0);
      float ring  = smoothstep(1.05, 0.80, d) * smoothstep(0.45, 0.65, d);
      col = mix(col, vec3(0.20, 0.30, 0.05), lines * ring * 0.7);
    } else if (tk == 20) {
      // toxin — bright violet glow inside the membrane.
      float glow = pow(smoothstep(1.05, 0.80, d), 2.0) * smoothstep(0.55, 0.85, d);
      col += vec3(0.55, 0.30, 0.85) * glow;
    }
  }

  // ── Mitochondria orbits ── 8 capsules drifting around the
  // nucleus on a slow rotation. Skipped for prokaryotes / virus /
  // spore / anucleate / toxin (matches shader-test's nMito gate).
  if (themeId != 0 && d < bodyR) {
    int tk3 = testKind();
    bool noMito = (tk3 == 5 || tk3 == 6 || tk3 == 8 || tk3 == 13 ||
                   tk3 == 16 || tk3 == 17 || tk3 == 20);
    if (!noMito) {
      float mito = 1e9;
      // Orbit direction = sign(freq): split-children inherit the
      // parent's phase + seed but their freqs have opposite signs, so
      // their mito orbits spin opposite ways from the same starting
      // arrangement — visibly readable as mitotic siblings.
      float orbitDir = sign(v_phase.z + 1e-6);
      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        // Per-cell phase rotates the orbit; per-cell seed jitters
        // each capsule's radius + jitter phase so two same-type
        // cells don't show identical mito layouts.
        float baseA = fi * 0.7853 + u_time * 0.08 * orbitDir + v_phase.x;
        float radM  = 0.40 + 0.05 * sin(fi * 1.7 + v_phase.y * 0.21);
        vec2 centre = vec2(cos(baseA), sin(baseA)) * radM
                    + vec2(0.015 * sin(u_time * 1.3 + fi + v_phase.y),
                           0.015 * cos(u_time * 1.1 + fi * 2.0 + v_phase.y * 0.7));
        vec2 dir = vec2(cos(baseA + 1.5708), sin(baseA + 1.5708));
        float capLen = 0.045;
        float dCap = cellCapsule(v_uv, centre - dir * capLen,
                                       centre + dir * capLen, 0.018);
        mito = min(mito, dCap);
      }
      float mitoMask = smoothstep(0.004, -0.004, mito);
      col = mix(col, vec3(0.95, 0.55, 0.30), mitoMask * 0.55);
    }
  }

  // ── Vesicles / granules ── per-kind scattered dots inside the
  // cytoplasm. Count + radius + colour vary by kind (matches the
  // table in shader-test). Hard-capped at 16 here for fragment
  // cost; shader-test's mast (60) is the only kind that's
  // visibly denser there — comes through as plenty-dense at 16.
  if (themeId != 0 && d < bodyR) {
    int tk4 = testKind();
    int vesCount = 14;
    if      (tk4 == 1)  { vesCount = 16; }   // macrophage lysosomes (cap)
    else if (tk4 == 2)  { vesCount = 16; }   // neutrophil
    else if (tk4 == 3)  { vesCount = 6;  }   // nk
    else if (tk4 == 4)  { vesCount = 8;  }   // b-cell
    else if (tk4 == 5)  { vesCount = 0;  }   // virus
    else if (tk4 == 6)  { vesCount = 16; }   // bacterium
    else if (tk4 == 7)  { vesCount = 10; }   // amoeba
    else if (tk4 == 8)  { vesCount = 4;  }   // spore
    else if (tk4 == 9)  { vesCount = 14; }   // monocyte
    else if (tk4 == 10) { vesCount = 16; }   // mast (cap)
    else if (tk4 == 11) { vesCount = 6;  }   // dendritic
    else if (tk4 == 12) { vesCount = 16; }   // basophil (cap)
    else if (tk4 == 13) { vesCount = 4;  }   // platelet
    else if (tk4 == 14) { vesCount = 0;  }   // t-cell
    else if (tk4 == 15) { vesCount = 16; }   // eosinophil
    else if (tk4 == 16) { vesCount = 0;  }   // rbc
    else if (tk4 == 17) { vesCount = 8;  }
    else if (tk4 == 18) { vesCount = 12; }
    else if (tk4 == 19) { vesCount = 10; }
    else if (tk4 == 20) { vesCount = 8;  }
    float vesRadius = 0.012;
    if      (tk4 == 2)  vesRadius = 0.008;
    else if (tk4 == 3)  vesRadius = 0.020;
    else if (tk4 == 7)  vesRadius = 0.022;
    else if (tk4 == 10) vesRadius = 0.006;
    else if (tk4 == 12) vesRadius = 0.010;
    else if (tk4 == 13) vesRadius = 0.014;
    else if (tk4 == 15) vesRadius = 0.020;
    else if (tk4 == 20) vesRadius = 0.014;
    vec3 vesCol = vec3(1.0, 0.92, 0.65);
    if      (tk4 == 3)  vesCol = vec3(0.75, 0.85, 1.00);
    else if (tk4 == 6)  vesCol = vec3(0.80, 0.90, 0.55);
    else if (tk4 == 7)  vesCol = vec3(0.55, 0.45, 0.30);
    else if (tk4 == 10) vesCol = vec3(0.12, 0.40, 0.25);
    else if (tk4 == 12) vesCol = vec3(0.20, 0.10, 0.55);
    else if (tk4 == 13) vesCol = vec3(0.55, 0.40, 0.10);
    else if (tk4 == 15) vesCol = vec3(1.00, 0.55, 0.30);
    else if (tk4 == 17) vesCol = vec3(0.70, 0.85, 0.45);
    else if (tk4 == 18) vesCol = vec3(0.60, 0.75, 0.20);
    else if (tk4 == 19) vesCol = vec3(0.90, 0.60, 0.20);
    else if (tk4 == 20) vesCol = vec3(1.00, 0.90, 1.00);
    if (vesCount > 0) {
      float ves = 1e9;
      // Per-cell seed shifts the angular phase + drift speed of every
      // vesicle so each cell's granule arrangement is unique. Drift
      // direction follows sign(freq) so split-siblings' granules
      // diverge in opposite rotational senses.
      float vSeed = v_phase.y;
      float vDir  = sign(v_phase.z + 1e-6);
      for (int j = 0; j < 16; j++) {
        if (j >= vesCount) break;
        float fj = float(j);
        vec2 pos = vec2(
          0.42 * sin(fj * 1.91 + vSeed * 0.71 + u_time * (0.18 + 0.03 * fj) * vDir),
          0.42 * cos(fj * 2.37 + vSeed * 0.93 + u_time * (0.21 + 0.02 * fj) * vDir)
        );
        vec2 jit = vec2(0.008 * sin(u_time * 3.0 * vDir + fj * 7.0 + vSeed),
                        0.008 * cos(u_time * 2.6 * vDir + fj * 5.0 + vSeed * 1.3));
        ves = min(ves, length(v_uv - pos - jit) - vesRadius);
      }
      float vesMask = smoothstep(0.003, -0.003, ves);
      col = mix(col, vesCol, vesMask * 0.85);
    }
  }

  // Microscope brownian dots — 18 tan specks drifting inside the cell.
  // Per-cell seed (v_phase.y) shifts the constellation so siblings
  // don't show identical dust. Mirrors the test-shader microscope
  // post-effect; film grain + chromatic limb stay out of scope here.
  if (themeId == 1 && d < bodyR) {
    vec3 dustCol = vec3(0.18, 0.14, 0.10);
    float dSeed = v_phase.y * 0.013;
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float sx = fract(sin((fi + dSeed) * 12.9898) * 43758.5453);
      float sy = fract(sin((fi + dSeed) * 78.2330) * 43758.5453);
      vec2 base = vec2(sx, sy) * 1.4 - 0.7;
      vec2 drift = vec2(0.04 * sin(u_time * 0.6 + fi * 1.7),
                        0.04 * cos(u_time * 0.5 + fi * 2.3));
      float dst = length(v_uv - base - drift);
      float dotA = (1.0 - smoothstep(0.012, 0.018, dst)) * 0.55;
      col = mix(col, dustCol, dotA);
    }
  }

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

  outColor = vec4(col, bodyA * v_diskAlpha);
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
  // v_uv in canvas convention: v=0 at top, v=1 at bottom. Cells render
  // in canvas coords (y=0 at top); the bg shader's worldPx reconstruction
  // multiplies v_uv by the viewport, so v_uv must use the same y direction
  // as the cell shader or the bg pans opposite to cells in y. Flip is
  // free here; downstream code (worldPx, gradient mix, spots, RBC) all
  // inherit the canvas convention.
  v_uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
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

uniform int u_kind;          // 0 flat, 1 gradient, 2 agar, 3 cybergrid, 4 lung (smoke), 5 aurora, 6 underwater, 7 lava, 8 reactor, 9 bloodflow, 10 cell-shadow, 11 tissue (image)
uniform sampler2D u_reactorTex;  // bound when u_kind == 8 (Gray-Scott RT)
uniform sampler2D u_tissueTex;   // bound when u_kind == 11 (seamless tiled image)
uniform vec3 u_base;
uniform vec3 u_top;
uniform vec3 u_bot;
uniform vec3 u_ringColor;
uniform vec3 u_gridColor;
uniform float u_gridStep;
uniform float u_vignette;
uniform vec4 u_camera;       // (scale, tx, ty, rotation-radians)
uniform vec2 u_viewport;     // (W, H)
uniform float u_time;        // seconds
uniform int u_spotCount;
uniform vec4 u_spots[${MAX_SPOTS}];      // (cx, cy, r, _) screen 0..1
uniform vec3 u_spotCols[${MAX_SPOTS}];
uniform int u_rbc;                        // 0=off, 1=draw drifting RBC silhouettes
uniform float u_bgScale;                  // S.bgScale — uniform multiplier on every bg feature size (rings stride, grid step, spot radii, RBC silhouettes). Floored at 0.05 below.
uniform float u_opacity;                  // per-layer opacity (0..1), folded into output alpha + premultiplied RGB

out vec4 outColor;

// ---------- Helper noise for procedural bgs (kinds 4-7) ----------
float bgHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float bgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bgHash(i),                  bgHash(i + vec2(1.0, 0.0)), u.x),
             mix(bgHash(i + vec2(0.0, 1.0)), bgHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bgFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * bgNoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main() {
  // Base.
  vec3 col = u_base;
  if (u_kind == 1) col = mix(u_top, u_bot, v_uv.y);

  // World-space pixel — screen px → world px through camera.
  vec2 screenPx = v_uv * u_viewport;
  // Inverse camera transform (screen → world): un-translate, un-rotate, un-scale.
  vec2 dCam = screenPx - u_camera.yz;
  float ccwBg = cos(u_camera.w), scwBg = sin(u_camera.w);
  vec2 worldPx = vec2(ccwBg * dCam.x + scwBg * dCam.y,
                      -scwBg * dCam.x + ccwBg * dCam.y) / u_camera.x;

  // Background-size slider. Every bg-pattern stride / feature
  // radius below is multiplied by bgS, so a single uniform makes
  // features grow or shrink uniformly while cells stay at the
  // unchanged cam.scale. Floor at 0.05 so the slider's 0 endpoint
  // doesn't collapse the stride to zero — at the floor features
  // are ~20× bigger than baseline (near-uniform wash).
  float bgS = max(u_bgScale, 0.05);

  // Petri-dish concentric rings — 1px thin at every 32*bgS world
  // units, centred on the world middle. Matches Canvas2D's stroke loop.
  if (u_kind == 2) {
    vec2 ctr = u_viewport * 0.5;
    float r = length(worldPx - ctr);
    float stride = 32.0 * bgS;
    float nearestRing = floor(r / stride + 0.5) * stride;
    float dToRing = abs(r - nearestRing);
    float pxWorld = 1.0 / u_camera.x;
    float band = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.5, dToRing);
    col = mix(col, u_ringColor, band * 0.18);
  }

  // Cyber grid: thin lines every gridStep*bgS world units, in both axes.
  if (u_kind == 3) {
    float gStep = u_gridStep * bgS;
    vec2 g = mod(worldPx, gStep);
    vec2 dToLine = min(g, gStep - g);
    float pxWorld = 1.0 / u_camera.x;
    float lineX = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.x);
    float lineY = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.y);
    float line = max(lineX, lineY);
    col = mix(col, u_gridColor, line * 0.30);
  }

  // ---- Lung: alveolar foam (kind 4) ----
  // Tile worldPx into ~80 unit cells; each tile holds a soft circular
  // bubble with a slightly randomised radius (per-tile hash). Subtle
  // breath pulse from sin(u_time).
  if (u_kind == 4) {
    // Lung — "Smoke" FBM by Roman Bobniev / FatumR (Apache 2.0,
    // https://www.shadertoy.com/view/ldBSDd). Self-referential
    // value-noise FBM with a breathing-rhythm sine in lieu of the
    // original's audio-reactive amplitude. Octaves trimmed 6→4
    // for in-game cost; visuals stay close. Domain-warped in
    // worldPx so the pattern tiles seamlessly with the camera.
    // 0.00714 — user re-tuned the lung to 0.7× current (was 0.0050
    // after the original "0.2× scale" step). Features visibly bigger
    // than the prior tweak, still finer than the initial 0.0010.
    // hot/cool ramp reads u_top / u_bot so the picker actually drives
    // the smoke palette. Default state colours match the previous
    // hard-coded stops (0.510,0.204,0.016) / (0.529,0.808,0.980).
    vec2 plungP = worldPx * 0.00714 + vec2(0.0, u_time * 0.08);
    float breath = 0.55 + 0.20 * sin(u_time * 0.6);
    float n0 = bgFbm(plungP * 0.5);
    float n1 = bgFbm(plungP + 2.0 * n0);
    float n2 = bgFbm(plungP + n1);
    float n3 = bgFbm(plungP + vec2(u_time * 0.04, 0.0) + n2);
    float v = breath * n3;
    col = mix(col, mix(u_top, u_bot, clamp(v, 0.0, 1.0)), 0.85);
  }

  // ---- Bloodflow (kind 9): port of shader-test's 'bloodflow ·
  //      default' — fbm tint over deep red + drifting RBC ovals.
  //      Distinct from the game's gradient+tile bloodstream (kind
  //      0 path), this one keeps the shader-test aesthetic. ----
  if (u_kind == 9) {
    // 0.012 — user spec "scale bloodflow by 0.1x" (features 10x
    // smaller than original 0.0012; far denser pattern across the
    // viewport).
    // Colour ramp reads u_bot → u_top → 1.5×u_top so the in-app
    // picker actually drives the look. Default state colours are
    // calibrated to match the previous hard-coded ramp.
    vec2 bf_p = worldPx * 0.012 + vec2(u_time * 0.04, u_time * 0.03);
    float bf_n = bgFbm(bf_p);
    float bf_rbc = bgFbm(worldPx * 0.0030 + vec2(0.0, u_time * 0.15));
    vec3 bf_hi = clamp(u_top * 1.5, vec3(0.0), vec3(1.0));
    vec3 bf_base = mix(u_bot, u_top, bf_n);
    bf_base = mix(bf_base, bf_hi, smoothstep(0.55, 0.75, bf_rbc) * 0.5);
    col = mix(col, bf_base, 0.85);
  }
  // ---- Cell shadow (kind 10): port of shader-test's voronoi ---
  //      Smooth-min Voronoi field over 3×3 cell neighbourhood,
  //      animated point positions. CC BY-NC-SA 3.0 (see About).
  if (u_kind == 10) {
    vec2 cs_st = worldPx * 0.005;
    vec2 cs_cellPos   = floor(cs_st);
    vec2 cs_cellCoord = fract(cs_st);
    float cs_sum = 0.0;
    for (int ix = -1; ix <= 1; ix++) {
      for (int iy = -1; iy <= 1; iy++) {
        vec2 nb = vec2(float(ix), float(iy));
        float h0 = bgHash(cs_cellPos + nb);
        float h1 = bgHash(cs_cellPos + nb + vec2(17.3, 41.7));
        vec2 nb_pos = 0.5 + 0.5 * sin(u_time * 0.4 + vec2(h0, h1) * 6.0);
        vec2 diff = (nb + nb_pos) - cs_cellCoord;
        cs_sum += exp(-32.0 * dot(diff, diff));
      }
    }
    float cs_v = -(1.0 / 32.0) * log(max(cs_sum, 1e-6));
    float cs_intensity = 0.03 / pow(max(1.2 - sqrt(max(cs_v, 0.0)), 0.05), 3.0);
    // cs_baseCol reads u_base so the picker drives the voronoi tint.
    // Default state base (#c83245) matches the previous hard-coded
    // colour vec3(200/255, 50/255, 69/255).
    col = mix(col, clamp(u_base * cs_intensity, 0.0, 2.0), 0.95);
  }
  // ---- Aurora borealis: vertical ribbons of green/violet (kind 5) ----
  // Ribbon density driven by domain-warped fbm; brightness peaks in
  // a horizontal band (the "sky strip"). Hue oscillates between
  // topColor and botColor over time — defaults match the previous
  // hard-coded green (0.24,0.95,0.52) / violet (0.55,0.35,0.95).
  if (u_kind == 5) {
    vec2 sky = vec2(worldPx.x * 0.0015, worldPx.y * 0.001 - u_time * 0.05);
    float warp = bgFbm(vec2(sky.x, u_time * 0.08));
    float ribbon = 0.5 + 0.5 * sin(sky.y * 6.2831 + warp * 6.2831);
    ribbon = pow(ribbon, 4.0);
    float bandH = exp(-pow((sky.y - 0.5) * 1.5, 2.0));
    vec3 hue = mix(u_top, u_bot, 0.5 + 0.5 * sin(warp * 3.14159 + u_time * 0.2));
    col = mix(col, hue, ribbon * bandH * 0.85);
  }

  // ---- Underwater: caustic interference (kind 6) ----
  // Two interleaved sine systems modulated by each other; raised to a
  // high power to spike the bright caustic ridges. botColor is the
  // deep wash, topColor is the bright caustic peak — defaults match
  // the previous hard-coded deep (0.04,0.16,0.30) / bright (0.60,0.95,1.00).
  if (u_kind == 6) {
    vec2 p = worldPx * 0.04;
    float w1 = sin(p.x + u_time * 0.6 + sin(p.y * 0.75));
    float w2 = sin(p.y * 0.95 + u_time * 0.85 + sin(p.x * 0.85));
    float c = pow(max(0.0, (w1 + w2) * 0.5 + 0.5), 6.0);
    col = mix(col, u_bot, 0.70);
    col = mix(col, u_top, c * 0.55);
  }

  // ---- Lava / fire: boiling 3-octave fbm (kind 7) ----
  // Domain warp (fbm-of-fbm) for organic motion; rising drift via the
  // -u_time*1.2 offset on Y. Hot gradient: base → bot → top → peak,
  // where peak is a clamped 2×u_top so the picker actually drives the
  // hot tendrils. Default state colours are calibrated to match the
  // previous hard-coded ramp.
  if (u_kind == 7) {
    vec2 p = worldPx * 0.005;
    p.y -= u_time * 1.2;
    float n = bgFbm(p + bgFbm(p * 0.5 + u_time * 0.05));
    vec3 peak = clamp(u_top * 2.0, vec3(0.0), vec3(1.0));
    vec3 hot = mix(u_base, u_bot, smoothstep(0.20, 0.45, n));
    hot     = mix(hot,    u_top,  smoothstep(0.45, 0.70, n));
    hot     = mix(hot,    peak,   smoothstep(0.70, 0.95, n));
    col = mix(col, hot, 0.85);
  }

  // Ambient drifting wash for the otherwise-static kinds (flat,
  // gradient, agar, cybergrid). A faint domain-warped fbm tinted
  // toward the existing colour — keeps every theme visibly "alive"
  // without overpowering the design. Skipped for kinds that already
  // animate (lung/aurora/underwater/lava/reactor/bloodflow/cellShadow).
  if (u_kind <= 3) {
    vec2 ambP = worldPx * 0.0009 + vec2(u_time * 0.025, u_time * 0.012);
    float amb = bgFbm(ambP + bgFbm(ambP * 0.5)) - 0.5;
    col += amb * 0.06;
  }

  // Drifting light spots — additive, screen-space coords. Each spot
  // colour was pre-multiplied by its source alpha on the JS side, so
  // we just add directly without re-scaling. Radius scales with bgS.
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    if (i >= u_spotCount) break;
    vec4 s = u_spots[i];
    float d = distance(v_uv, s.xy);
    float a = 1.0 - smoothstep(0.0, s.z * bgS, d);
    col += u_spotCols[i] * a;
  }

  // Bloodstream theme: directional plasma flow beneath the RBC
  // silhouettes. Flow vector points downward (top → bottom) so the
  // wash reads as a stream of blood draining vertically; streamer
  // ribbons appear as horizontal bands sliding downward. Pattern
  // wavelength scales with bgS — dividing worldPx by bgS is
  // equivalent to multiplying the fbm wavelength by bgS.
  if (u_rbc == 1) {
    vec2 bgWorldPx = worldPx / bgS;
    vec2 flow = vec2(0.10, 1.0);    // mostly downward, slight rightward
    vec2 plasmaP = bgWorldPx * 0.0015 + flow * (u_time * 0.20);
    float plasma = bgFbm(plasmaP + bgFbm(plasmaP * 0.5));
    vec3 plasmaCol = mix(vec3(0.30, 0.05, 0.07), vec3(0.62, 0.12, 0.16),
                         smoothstep(0.30, 0.85, plasma));
    col = mix(col, plasmaCol, 0.55);
    // Streamer ribbons — narrow horizontal bands (perpendicular to
    // the vertical flow) of brighter tint that scroll downward.
    float ribbon = sin(bgWorldPx.x * 0.012 + bgFbm(plasmaP * 0.7) * 6.28
                       + u_time * 0.6);
    ribbon = pow(max(0.0, ribbon), 6.0);
    col = mix(col, vec3(0.88, 0.22, 0.25), ribbon * 0.18);
  }

  // RBC donuts — biconcave-disc silhouettes flowing top → bottom
  // with per-cell rotation. World-tiled (3×3 × 4 cells per tile) so
  // density stays camera-independent. Each donut renders as a soft
  // pink rim with a darker red dimple in the centre (the biconcave
  // depression seen face-on); a slight aspect ratio (0.92) makes the
  // per-cell spin visually readable. Tile size + disc radius scale
  // with bgS so a single slider grows / shrinks the whole pattern;
  // time-driven motion stays in unscaled world units so RBCs move at
  // the same on-screen speed regardless of bgS.
  if (u_rbc == 1) {
    float TS = 600.0 * bgS;            // world px per tile
    vec2 tIdx = floor(worldPx / TS);
    for (int oy = -1; oy <= 1; oy++) {
      for (int ox = -1; ox <= 1; ox++) {
        vec2 cell = tIdx + vec2(float(ox), float(oy));
        float h0 = bgHash(cell);
        for (int k = 0; k < 4; k++) {
          float kSeed = h0 * 6.28 + float(k) * 1.31;
          vec2 inTile = vec2(fract(kSeed * 1.7), fract(kSeed * 2.3)) * TS;
          // Top-bottom flow + small per-cell wobble on the side axis.
          vec2 cWorld = cell * TS + inTile
                      + vec2(28.0 * sin(u_time * 0.30 + kSeed), 0.0)
                      + vec2(9.0, 110.0) * u_time;
          float rWorld = (24.0 + 18.0 * fract(kSeed * 0.41)) * bgS;

          // Per-cell rotation: angle = seed phase + slow spin rate.
          float spin = 0.6 + 0.7 * fract(kSeed * 0.71);   // 0.6..1.3 rad/s
          float ang  = kSeed + u_time * spin;
          float ca   = cos(ang), sa = sin(ang);
          vec2  d    = worldPx - cWorld;
          vec2  rd   = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
          // Slight oblate so rotation is visible on the round shape.
          vec2  dE   = rd / vec2(rWorld, rWorld * 0.92);
          float L    = length(dE);

          // Disc body — soft AA edge at L = 1.
          float bodyA = (1.0 - smoothstep(0.95, 1.05, L)) * 0.65;
          // Biconcave depression: rim stays bright, centre darkens.
          float dimple = smoothstep(0.55, 0.0, L);
          vec3 rbcCol = mix(vec3(0.96, 0.32, 0.34),    // rim pink
                            vec3(0.50, 0.10, 0.12),    // central dimple
                            dimple);
          col = mix(col, rbcCol, bodyA);
          // Thin dark outline at the membrane edge.
          float rim = smoothstep(0.92, 0.99, L) * (1.0 - smoothstep(1.00, 1.04, L));
          col = mix(col, vec3(0.22, 0.04, 0.06), rim * 0.45);
        }
      }
    }
  }

  // ---- Reactor: Gray-Scott reaction-diffusion display (kind 8) ----
  // Reads the front ping-pong RT (set up by drawBackground before this
  // pass). The RT stores (A * 0.05, B, 0, 1); calculate_concentrations
  // is the inverse mapping. Acid-green palette ramped on B; subtle dark
  // tint where A ≈ 1 stays untouched. Step + seed shaders run in their
  // own off-screen passes — see _reactorStep / _reactorSeed.
  if (u_kind == 8) {
    // dark/mid/hot ramp reads u_base / u_bot / u_top so the picker
    // actually drives the acid-green palette. Default state colours
    // match the previous hard-coded stops (0.02,0.06,0.04) /
    // (0.10,0.40,0.20) / (0.49,1.00,0.54 = panel accent #7eff8a).
    vec4 rxColor = texture(u_reactorTex, v_uv);
    vec2 rxConc = rxColor.rg / vec2(0.05, 1.0);
    float bN = clamp(rxConc.y * 1.6, 0.0, 1.0);
    col = mix(mix(u_base, u_bot, smoothstep(0.0, 0.45, bN)),
              u_top, smoothstep(0.45, 0.92, bN));
  }
  if (u_kind == 11) {
    // Tissue (texture) — seamless tile sampled in world coords.
    // TILE_PX = 800 world-pixels per repeat at bgScale = 1; the
    // slider re-scales the wrap frequency without touching the
    // camera. fract() wraps both positive and negative worldPx
    // into [0,1) so the camera can pan freely without visible
    // seams.
    float TILE_PX = 800.0;
    vec2 tuv = fract(worldPx * (bgS / TILE_PX));
    col = texture(u_tissueTex, tuv).rgb;
  }

  // Vignette: darken the corners. Aspect-corrected so the falloff
  // is a true 1:1 circle in screen pixels (matches the crosshair
  // overlay circle) instead of stretching to an ellipse on
  // widescreen.
  if (u_vignette > 0.0) {
    vec2 d = v_uv - 0.5;
    float aspect = u_viewport.x / max(1.0, u_viewport.y);
    if (aspect > 1.0) d.x *= aspect; else d.y /= aspect;
    float v = length(d) * 1.4;
    float vAmt = u_vignette * smoothstep(0.4, 1.0, v);
    col *= 1.0 - vAmt;
  }

  // Premultiplied output so the bg pass composites correctly when
  // u_opacity < 1 with the standard blend funcs the layer loop sets.
  outColor = vec4(col * u_opacity, u_opacity);
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
//   'fullCanvas'  — pool of full-canvas RTs, one per active pair index.
//                   Highest GPU memory; zero per-pair allocation after
//                   warmup.
//   'sharedMax'   — single shared RT, sized to the largest active pair
//                   this frame. Middle ground.
// ---- Reactor (Gray-Scott) shaders ---------------------------------
// Two off-screen RGBA8 textures (`_reactorRtA` + `_reactorRtB`) ping-
// pong each visible frame. Encoding: the texel stores
// `(A * 0.05, B, 0, 1)` so both concentrations fit cleanly in 0..1.
// Caustics overlay post-process: samples the bg texture (rendered
// in a previous pass to an offscreen FBO) at uv displaced by an
// animated water-turbulence pattern, then multiplies by a
// green/teal tint — reads as light dancing through water on top of
// whatever bg theme is selected.
//
// Adapted from "Tileable Water Caustic" by David Hoskins (modified
// joltz0r 2013) — https://www.shadertoy.com/view/ltSczG · Shadertoy
// default licence (CC BY-NC-SA 3.0). Same caustic math as the
// shader-test page's PR #73 implementation.
const FRAG_CAUSTIC_BG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bg;
uniform float u_time;
uniform vec2 u_resolution;       // canvas drawing-buffer (W, H)
uniform vec3 u_tint;             // additive cast on top of the per-pixel shade
out vec4 outColor;

void main() {
  vec2 uv = v_uv;
  float TAU = 6.28318530718;
  // Tile the caustic pattern across the screen, aspect-corrected so
  // each "cell" of the pattern stays roughly square instead of being
  // stretched horizontally on widescreen. Tile factor 3 ⇒ ~3 cells
  // tall, 3*aspect cells wide.
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 cuv = uv * vec2(aspect, 1.0) * 3.0;
  float time2 = u_time * 0.5 + 23.0;
  vec2 p0 = mod(cuv * TAU, TAU) - 150.0;
  vec2 i = p0;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tn = time2 * (1.0 - (3.5 / float(n + 1)));
    i = p0 + vec2(cos(tn - i.x) + sin(tn + i.y),
                  sin(tn - i.y) + cos(tn + i.x));
    vec2 denom = vec2(p0.x / (sin(i.x + tn) / inten),
                      p0.y / (cos(i.y + tn) / inten));
    c += 1.0 / max(length(denom), 1e-4);
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  float shade = pow(abs(c), 8.0);
  vec3 tint = clamp((vec3(shade) + u_tint) * 2.0, 0.0, 1.0);
  vec2 off = vec2(cos(c) - 0.75, sin(c) - 0.75) * 0.04;
  vec2 sampleUv = clamp(uv + off, 0.0, 1.0);
  vec3 bg = texture(u_bg, sampleUv).rgb;
  outColor = vec4(bg * tint, 1.0);
}
`;

// Microscope FX post-pass: combines microscope blur (variable-radius
// bokeh-style blur — sharp center, blurry edges) with "make it real"
// gradient-mapped color grade + chromatic aberration. Both effects
// gated independently by uniforms so the user can enable either / both
// / neither. Single fullscreen quad. Mutually exclusive with scene-
// wide ripples + caustics — only one scene-wide post-pass owns the
// scene RT.
//
// The grade math switched from HSV-duotone (PR #147, didn't look
// like microscopy) to a 2-stop RGB gradient between user-chosen
// anchor colors derived from (hue1, hue2, saturation). RGB
// interpolation is what every shipped duotone shader uses; HSV
// interpolation produces hue-wheel banding and ignores perceptual
// luminance, which is why the original looked wrong. See
// https://agatedragon.blog/2024/01/01/creating-a-duotone-effect-in-a-glsl-shader/
// for the reference pattern.
const FRAG_SCENE_FX = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_blurOn;        // 0 / 1
uniform float u_focusRadius;   // 0..1, fraction of the half-diagonal that stays sharp
uniform float u_blurStrength;  // 0..1, peak edge blur as fraction of min(W,H)
uniform float u_falloff;       // 0..1, transition hardness (0 soft → 1 abrupt)
uniform float u_gradeOn;       // 0 / 1
uniform float u_hue1;          // 0..1, shadow hue
uniform float u_hue2;          // 0..1, highlight hue
uniform float u_saturation;    // 0..1, anchor-color saturation
out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// 16-tap Poisson disk for softer bokeh than a single 8-tap ring.
// Coords pre-normalized to ±1; the shader scales by the per-pixel
// blur radius. Pattern from Bart Wronski's "Optimized Spatial Blur"
// reference set (CC0).
const vec2 POISSON16[16] = vec2[16](
  vec2( 0.0, 0.0),
  vec2( 0.50, 0.0),
  vec2(-0.50, 0.0),
  vec2( 0.0,  0.50),
  vec2( 0.0, -0.50),
  vec2( 0.92,  0.39),
  vec2(-0.92,  0.39),
  vec2( 0.92, -0.39),
  vec2(-0.92, -0.39),
  vec2( 0.39,  0.92),
  vec2(-0.39,  0.92),
  vec2( 0.39, -0.92),
  vec2(-0.39, -0.92),
  vec2( 0.68,  0.68),
  vec2(-0.68,  0.68),
  vec2( 0.68, -0.68)
);

void main() {
  // v_uv arrives in canvas convention (v=0 at top) — see
  // VERT_FULLSCREEN — but u_scene is a framebuffer-backed texture in
  // GL convention (v=0 at bottom). Sampling with v_uv directly reads
  // the scene flipped upside-down. Use gl_FragCoord (already in GL
  // bottom-up viewport coords) for texture lookup so the duotone
  // grade composites with the right pixel.
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // Aspect-correct radial distance so the focus zone stays circular.
  vec2 ndc = uv * 2.0 - 1.0;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 nd = ndc;
  if (aspect > 1.0) nd.x *= aspect; else nd.y /= aspect;
  float r = length(nd);

  // Variable-radius blur (or straight sample). The radius is what
  // drives the visible defocus — bumped 2× from the PR #147 baseline
  // so the user can actually see the effect at default sliders.
  vec3 col;
  if (u_blurOn > 0.5 && u_blurStrength > 0.001) {
    float beyond = clamp((r - u_focusRadius) / max(1e-3, 1.0 - u_focusRadius), 0.0, 1.0);
    float curve = mix(1.2, 5.0, u_falloff);
    float blurAmt = pow(beyond, curve);
    float minDim = min(u_resolution.x, u_resolution.y);
    float blurRadius = u_blurStrength * 0.12 * minDim * blurAmt;
    if (blurRadius < 0.5) {
      col = texture(u_scene, uv).rgb;
    } else {
      vec2 px = vec2(blurRadius) / u_resolution;
      vec3 sum = vec3(0.0);
      for (int i = 0; i < 16; i++) {
        sum += texture(u_scene, uv + POISSON16[i] * px).rgb;
      }
      col = sum / 16.0;
    }
  } else {
    col = texture(u_scene, uv).rgb;
  }

  if (u_gradeOn > 0.5) {
    // Chromatic aberration: radial offset on R/B channels. Strength
    // ramps with distance² from screen center, so the corners get a
    // visible pink/cyan fringe and the focus zone stays clean.
    vec2 toCtr = uv - 0.5;
    float caAmt = 0.006 * dot(toCtr, toCtr) * 4.0;
    float Rc = texture(u_scene, uv - toCtr * caAmt).r;
    float Bc = texture(u_scene, uv + toCtr * caAmt).b;
    // If blur is on we already lost the sharp sample — use the
    // blurred col.g, but pull fresh R/B taps from the scene RT for
    // the aberration look.
    vec3 src = vec3(Rc, col.g, Bc);

    // Anchor colors: shadow at low V, highlight at high V, both
    // tinted by the user-chosen hues and shared saturation. The two
    // anchors are NOT V=0 and V=1 because that would crush blacks
    // and blow out whites; 0.18 / 0.92 leaves headroom.
    vec3 shadowAnchor    = hsv2rgb(vec3(u_hue1, u_saturation, 0.18));
    vec3 highlightAnchor = hsv2rgb(vec3(u_hue2, u_saturation, 0.92));

    // Map perceptual luminance along the anchor gradient. The
    // smoothstep gives a Photoshop-style gentle contrast curve.
    float Y = clamp(dot(src, LUMA), 0.0, 1.0);
    float t = smoothstep(0.05, 0.95, Y);
    vec3 graded = mix(shadowAnchor, highlightAnchor, t);

    // Blend 15% of the original chroma back so cell colours don't
    // collapse entirely into the gradient (microscopy preserves
    // some local hue — pure duotone looks plasticky).
    col = mix(graded, src, 0.15);
  }

  outColor = vec4(col, 1.0);
}
`;

// Liquid-ripples overlay: each on-screen cell radiates concentric
// ripples that distort the bg sample UV. Reads as cells moving
// through liquid. Cells render on top normally; only the bg layer
// is distorted, so the pass is cheap (one fullscreen quad with an
// inner loop bounded by the cap).
const RIPPLE_MAX = 24;
const GLASS_MAX = 24;
// Glass-membrane lensing overlay. Parity port of GLASS_BG_WGSL in
// webgpu.js — band geometry now driven by u_glassParams.z (size):
// half-width = 0.15 * size, so size=1.0 reproduces the original
// 0.85..1.15 band. Half-sine lens peak; optional chromatic-split
// via u_glassParams.y.
//
// WebGL2 Y-inversion fix: VERT_FULLSCREEN's v_uv uses canvas
// convention (y=0 top) but the scene FBO this pass samples has
// texel y=0 at the BOTTOM (default WebGL convention). Sampling
// directly with v_uv would mirror the image vertically and the
// lens band would appear to bend the WRONG row of pixels. Map
// canvas-uv → texture-uv by flipping y when issuing the lookup.
const FRAG_GLASS_BG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bg;
uniform float u_time;
uniform vec2 u_resolution;
uniform int u_cellCount;
uniform vec3 u_cells[${GLASS_MAX}];      // (uvX, uvY, uvR_minAxis)
uniform vec3 u_glassParams;              // (strength, chroma, size)
out vec4 outColor;

vec4 sampleBg(vec2 canvasUv) {
  // Canvas-uv (y=0 top) → texture-uv (y=0 bottom).
  vec2 texUv = vec2(canvasUv.x, 1.0 - canvasUv.y);
  return texture(u_bg, clamp(texUv, 0.0, 1.0));
}

void main() {
  vec2 uv = v_uv;
  vec2 disp = vec2(0.0);
  float minAx = min(u_resolution.x, u_resolution.y);
  float strength = u_glassParams.x;
  float chroma   = u_glassParams.y;
  float size     = max(u_glassParams.z, 0.01);
  float half_    = 0.15 * size;
  for (int i = 0; i < ${GLASS_MAX}; i++) {
    if (i >= u_cellCount) break;
    vec3 c = u_cells[i];
    vec2 dvUv = uv - c.xy;
    vec2 dvPx = dvUv * u_resolution;
    float dPx  = length(dvPx);
    float rPx  = max(c.z * minAx, 4.0);
    float lo   = rPx * (1.0 - half_);
    float hi   = rPx * (1.0 + half_);
    if (dPx < lo || dPx > hi) continue;
    float t = (dPx - lo) / max(1e-4, hi - lo);
    float lens = sin(t * 3.14159);
    vec2 normal = dvUv / max(1e-4, length(dvUv));
    disp += normal * lens;
  }
  vec2 baseDisp = disp * (8.0 / minAx) * strength;
  if (chroma > 0.5) {
    float r = sampleBg(uv + baseDisp * 0.85).r;
    float g = sampleBg(uv + baseDisp * 1.00).g;
    float b = sampleBg(uv + baseDisp * 1.15).b;
    outColor = vec4(r, g, b, 1.0);
  } else {
    vec3 rgb = sampleBg(uv + baseDisp).rgb;
    outColor = vec4(rgb, 1.0);
  }
}
`;
const FRAG_RIPPLE_BG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bg;
uniform float u_time;
uniform vec2 u_resolution;       // canvas drawing-buffer (W, H)
uniform int u_cellCount;
uniform vec3 u_cells[${RIPPLE_MAX}];   // (uvX, uvY, uvR_minAxis)
uniform vec3 u_rippleParams;     // (density, reach, strength)
out vec4 outColor;

void main() {
  vec2 uv = v_uv;
  vec2 disp = vec2(0.0);
  float minAx = min(u_resolution.x, u_resolution.y);
  float density  = max(u_rippleParams.x, 0.001);
  float reach    = max(u_rippleParams.y, 0.001);
  float strength = u_rippleParams.z;
  for (int i = 0; i < ${RIPPLE_MAX}; i++) {
    if (i >= u_cellCount) break;
    vec3 c = u_cells[i];
    vec2 dvUv = uv - c.xy;
    vec2 dvPx = dvUv * u_resolution;
    float dPx  = length(dvPx);
    float rPx  = max(c.z * minAx, 4.0);
    // Cull radius scales with reach so high-reach values still pass.
    if (dPx > rPx * 8.0 * reach) continue;
    // density > 1 ⇒ shorter wavelength ⇒ more rings per cell radius.
    float wavelen = rPx * 0.7 / density;
    float k = 6.28318 / wavelen;
    float wave = sin(dPx * k - u_time * (wavelen * 1.5) * k);
    // reach < 1 ⇒ ripples decay closer to the cell.
    float falloff = exp(-dPx / (rPx * 4.0 * reach));
    vec2 dirUv = dvUv / max(1e-4, length(dvUv));
    disp += dirUv * wave * falloff;
  }
  vec2 uvDisp = disp * (6.0 / minAx) * strength;
  vec3 bg = texture(u_bg, clamp(uv + uvDisp, 0.0, 1.0)).rgb;
  outColor = vec4(bg, 1.0);
}
`;

// Single fullscreen overlay shader for the three new post-effects.
// Output formula chosen per blend mode so the same shader can be
// composited via additive / multiply / normal GPU blendFunc.
//
//   normal   blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA) — outputs
//            (effectCol, intensity*mask); dst becomes a mix of
//            scene and effect color weighted by alpha.
//   multiply blendFunc(DST_COLOR, ZERO) — outputs
//            (1 - effectCol*intensity*mask, 1); dst becomes
//            dst*out, i.e. darkens proportional to effect strength.
//   additive blendFunc(ONE, ONE) — outputs (effectCol*intensity*mask,
//            1); dst becomes dst + effect, brightening towards
//            the effect colour.
//
// Crosshair ignores u_mode and always renders with normal alpha
// blend so the line stays opaque against any background.
const FRAG_FX_OVERLAY = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_effect;     // 1 = static noise · 2 = vignette · 3 = crosshair
uniform int u_mode;       // 1 = normal · 2 = multiply · 3 = additive
uniform float u_intensity;
out vec4 outColor;

float fxHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 effectCol = vec3(0.0);
  float effectMask = 1.0;
  if (u_effect == 1) {
    float g = fxHash(gl_FragCoord.xy + vec2(u_time * 31.7, u_time * 17.3));
    effectCol  = vec3(g);
    effectMask = 1.0;
  } else if (u_effect == 2) {
    // Aspect-corrected radial distance — true 1:1 circle, matches
    // the crosshair overlay circle (PR #144). Without the
    // correction the falloff was elliptical on widescreen.
    vec2 uv  = gl_FragCoord.xy / u_resolution;
    vec2 ndc = uv * 2.0 - 1.0;
    float aspect = u_resolution.x / max(1.0, u_resolution.y);
    if (aspect > 1.0) ndc.x *= aspect; else ndc.y /= aspect;
    float r  = length(ndc);
    effectCol  = vec3(0.05, 0.10, 0.20);
    effectMask = pow(smoothstep(0.6, 1.0, r), 2.0);
  } else {
    // Crosshair — cyan ring + cross. Pure normal-blend output;
    // u_mode is ignored to keep the line legible against any scene.
    // Ring fits the shorter viewport axis with 5% padding (radius =
    // min(W,H) * 0.475) so it scales with the canvas while staying
    // circular at any aspect ratio.
    vec2 px = gl_FragCoord.xy - u_resolution * 0.5;
    float armLen   = 14.0;
    float thick    = 1.0;
    float ringR    = min(u_resolution.x, u_resolution.y) * 0.475;
    float horiz = (abs(px.y) < thick && abs(px.x) < armLen) ? 1.0 : 0.0;
    float vert  = (abs(px.x) < thick && abs(px.y) < armLen) ? 1.0 : 0.0;
    float ring  = (abs(length(px) - ringR) < thick) ? 0.6 : 0.0;
    float a = max(max(horiz, vert), ring);
    outColor = vec4(vec3(0.42, 0.95, 1.0), a * 0.6);
    return;
  }

  float s = u_intensity * effectMask;
  if (u_mode == 1) {
    outColor = vec4(effectCol, s);
  } else if (u_mode == 2) {
    outColor = vec4(vec3(1.0) - effectCol * s, 1.0);
  } else {
    outColor = vec4(effectCol * s, 1.0);
  }
}
`;

// Step shader runs N iterations per visible frame; seed shader writes
// fresh B-discs every ~10 s so the pattern keeps regrowing.
const FRAG_REACTOR_STEP = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
out vec4 outColor;

vec2 readConc(vec2 uv)        { return texture(u_texture, uv).rg / vec2(0.05, 1.0); }
vec4 packConc(vec2 c)         { return vec4(c * vec2(0.05, 1.0), 0.0, 1.0); }

vec2 lapConc(vec2 uv) {
  float du = 1.0 / u_resolution.x;
  float dv = 1.0 / u_resolution.y;
  vec2 lap = -readConc(uv);
  lap += 0.20 * readConc(uv + vec2(-du, 0.0));
  lap += 0.20 * readConc(uv + vec2( du, 0.0));
  lap += 0.20 * readConc(uv + vec2(0.0, -dv));
  lap += 0.20 * readConc(uv + vec2(0.0,  dv));
  lap += 0.05 * readConc(uv + vec2(-du, -dv));
  lap += 0.05 * readConc(uv + vec2( du, -dv));
  lap += 0.05 * readConc(uv + vec2( du,  dv));
  lap += 0.05 * readConc(uv + vec2(-du,  dv));
  return lap;
}

void main() {
  float D_A = 0.8;
  float D_B = 0.4;
  float feed = 0.06 * v_uv.x;
  float kill = 0.035 + 0.03 * v_uv.x + (0.022 - 0.015 * v_uv.x) * v_uv.y;
  vec2 c   = readConc(v_uv);
  vec2 lap = lapConc(v_uv);
  float dA = D_A * lap.x - c.x * c.y * c.y + feed * (1.0 - c.x);
  float dB = D_B * lap.y + c.x * c.y * c.y - (kill + feed) * c.y;
  c += vec2(dA, dB);
  outColor = packConc(c);
}`;

// Seed shader — copies the front RT and stamps up to 8 fresh B-discs
// at uniform-random UV positions. Discs raise B to 0.9 inside their
// radius without touching A (so the existing pattern keeps living).
const REACTOR_MAX_SEEDS = 8;
const FRAG_REACTOR_SEED = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform int u_seedCount;
uniform vec3 u_seeds[${REACTOR_MAX_SEEDS}];   // (cx, cy, r) in UV
out vec4 outColor;

void main() {
  vec4 src = texture(u_texture, v_uv);
  vec2 c = src.rg / vec2(0.05, 1.0);
  for (int i = 0; i < ${REACTOR_MAX_SEEDS}; i++) {
    if (i >= u_seedCount) break;
    vec3 seed = u_seeds[i];
    if (length(v_uv - seed.xy) < seed.z) c.y = max(c.y, 0.9);
  }
  outColor = vec4(c * vec2(0.05, 1.0), 0.0, 1.0);
}`;

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
uniform int u_outlineMode;      // 0 = edge (rim from blurred mask), else no rim here (sdf/polygon use a separate line pass)
uniform vec3 u_outlineColor;    // rim colour for edge mode
uniform float u_outlineWidth;   // half-width of the rim band in normalised mask-alpha units (~0.06)
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
  float bodyA = thresholded * alphaMul;

  // Edge-mode rim: thin band along the blurred-mask 0.5 contour, which
  // tracks the metaball silhouette exactly. sdf / polygon modes draw
  // their rims via the decoration line pipeline so this contributes 0.
  float outlineA = 0.0;
  if (u_outlineMode == 0) {
    outlineA = 1.0 - smoothstep(0.0, max(u_outlineWidth, 0.001), abs(m.a - 0.5));
  }
  vec3 finalRGB = mix(col, u_outlineColor, outlineA);
  float finalA = max(bodyA, outlineA);
  outColor = vec4(finalRGB, finalA);
}`;

const INSTANCE_FLOATS = 24; // see _diskVao layout in init()

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
uniform vec4 u_camera;
uniform vec2 u_viewport;
out vec4 v_col;
void main() {
  // Camera transform: scale, rotate by u_camera.w, then translate.
  vec2 a_posScaled = a_pos * u_camera.x;
  float ccw = cos(u_camera.w), scw = sin(u_camera.w);
  vec2 screenPos = vec2(ccw * a_posScaled.x - scw * a_posScaled.y,
                        scw * a_posScaled.x + ccw * a_posScaled.y)
                 + u_camera.yz;
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
uniform vec4 u_camera;
uniform vec2 u_viewport;
out float v_dist;
void main() {
  // Camera transform: scale, rotate by u_camera.w, then translate.
  vec2 a_posScaled = a_pos * u_camera.x;
  float ccw = cos(u_camera.w), scw = sin(u_camera.w);
  vec2 screenPos = vec2(ccw * a_posScaled.x - scw * a_posScaled.y,
                        scw * a_posScaled.x + ccw * a_posScaled.y)
                 + u_camera.yz;
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
uniform vec4 u_camera;
uniform vec2 u_viewport;
uniform vec3 u_marker;       // (x, y, scaledRadius_world)
out vec2 v_uv;
void main() {
  vec2 worldPos = u_marker.xy + a_corner * u_marker.z;
  // Camera transform: scale, then rotate by u_camera.w, then translate.
  // Reduces to plain "worldPos * scale + (tx, ty)" when rotation == 0.
  vec2 worldPosScaled = worldPos * u_camera.x;
  float ccw = cos(u_camera.w), scw = sin(u_camera.w);
  vec2 screenPos = vec2(ccw * worldPosScaled.x - scw * worldPosScaled.y,
                        scw * worldPosScaled.x + ccw * worldPosScaled.y)
                 + u_camera.yz;
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

// ---------- Particles (kill-mode protein/gut explosions) ----------
// One instanced quad per particle. Per-instance: (worldX, worldY, r,
// alpha) + (R, G, B, _pad). Soft-disc fragment shader anti-aliases
// the rim. Mirrors the WebGPU PARTICLE_WGSL pipeline 1:1.
const PARTICLE_INSTANCE_FLOATS = 8;
const ANTIBODY_INSTANCE_FLOATS = 8;            // (x, y, angle, alpha, R, G, B, scale)
// Unit Y in local coords. Three line segments → 6 vertices, drawn
// as gl.LINES. Stem points back along -x; arms fan forward along +x.
const ANTIBODY_UNIT_Y = new Float32Array([
  -2.4, 0,    0, 0,             // stem
   0, 0,    1.6, -1.2,           // left arm
   0, 0,    1.6,  1.2,           // right arm
]);
const VERT_PARTICLE = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_inst;        // (x, y, r, alpha)
layout(location=2) in vec4 a_rgb;         // (R, G, B, _)
uniform vec4 u_camera;
uniform vec2 u_viewport;
out vec2 v_uv;
out vec4 v_col;
void main() {
  vec2 worldPos = a_inst.xy + a_corner * a_inst.z;
  // Camera transform: scale, then rotate by u_camera.w, then translate.
  // Reduces to plain "worldPos * scale + (tx, ty)" when rotation == 0.
  vec2 worldPosScaled = worldPos * u_camera.x;
  float ccw = cos(u_camera.w), scw = sin(u_camera.w);
  vec2 screenPos = vec2(ccw * worldPosScaled.x - scw * worldPosScaled.y,
                        scw * worldPosScaled.x + ccw * worldPosScaled.y)
                 + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_corner;
  v_col = vec4(a_rgb.rgb, a_inst.w);
}`;
const FRAG_PARTICLE = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_col;
out vec4 outColor;
void main() {
  float d = length(v_uv);
  float a = (1.0 - smoothstep(0.85, 1.0, d)) * v_col.a;
  if (a <= 0.0) discard;
  outColor = vec4(v_col.rgb, a);
}`;

// ---------- Antibody Y-sprite pass --------------------------------
// Six-vertex unit Y in local space, drawn as gl.LINES with three
// segments (stem + two arms). Per-instance: (x, y, angle, alpha,
// R, G, B, scale). Vertex shader rotates+scales the local Y, then
// the same camera transform every other pass uses.
const VERT_ANTIBODY = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_local;       // unit-Y vertex (-2.4..1.6, -1.2..1.2)
layout(location=1) in vec4 a_inst;        // (x, y, angle, alpha)
layout(location=2) in vec4 a_rgbScale;    // (R, G, B, scale)
uniform vec4 u_camera;
uniform vec2 u_viewport;
out vec4 v_col;
void main() {
  float ca = cos(a_inst.z), sa = sin(a_inst.z);
  vec2 rotated = vec2(ca * a_local.x - sa * a_local.y,
                      sa * a_local.x + ca * a_local.y);
  vec2 worldPos = a_inst.xy + rotated * a_rgbScale.w;
  // Camera: scale, rotate, translate (matches every other pass).
  vec2 worldPosScaled = worldPos * u_camera.x;
  float ccw = cos(u_camera.w), scw = sin(u_camera.w);
  vec2 screenPos = vec2(ccw * worldPosScaled.x - scw * worldPosScaled.y,
                        scw * worldPosScaled.x + ccw * worldPosScaled.y)
                 + u_camera.yz;
  vec2 clipPos = (screenPos / u_viewport) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_col = vec4(a_rgbScale.rgb, a_inst.w);
}`;
const FRAG_ANTIBODY = `#version 300 es
precision highp float;
in vec4 v_col;
out vec4 outColor;
void main() {
  outColor = v_col;
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
layout(location=4) in vec4 a_face3;    // (mouthY, phase, blur, alphaMul)
layout(location=5) in vec3 a_mouthCol; // RGB for mouth fill / stroke

uniform vec4 u_camera;
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
  // Camera transform: scale, then rotate by u_camera.w, then translate.
  // Reduces to plain "worldPos * scale + (tx, ty)" when rotation == 0.
  vec2 worldPosScaled = worldPos * u_camera.x;
  float ccw = cos(u_camera.w), scw = sin(u_camera.w);
  vec2 screenPos = vec2(ccw * worldPosScaled.x - scw * worldPosScaled.y,
                        scw * worldPosScaled.x + ccw * worldPosScaled.y)
                 + u_camera.yz;
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
in vec4 v_face3;      // (mouthY, phase, blur, alphaMul)
in vec3 v_mouthCol;
uniform float u_time;
uniform float u_faceScale;     // S.faceScale — uniform multiplier on every face dimension (eye R, pupil R, eye-X spread, mouth half-width). Default 1.0 keeps the legacy look; 0 hides faces; up to 3 fills the cell.
out vec4 outColor;

const float FACE_SCALE_BASE = 1.2;

// Edge-widening smoothstep — approximates Gaussian blur by extending the
// AA band by v_face3.z (= blur amount in body-radius units). Replaces
// every fixed smoothstep edge below so the face softens uniformly during
// SPLITTING. Cheap (no extra texture sampling); good enough at the
// modest blur amounts we use (≤ 0.10).
float sstep(float a, float b, float x) {
  float blur = v_face3.z;
  return smoothstep(a - blur, b + blur, x);
}

// Soft disc fill: returns alpha 0..1 inside, fades to 0 outside r.
float discA(vec2 p, vec2 c, float r) {
  return 1.0 - sstep(r * 0.92, r, length(p - c));
}

// Stroked arc segment: thin band along an arc from a0 to a1, centre c, radius r,
// half-width hw.
float arcA(vec2 p, vec2 c, float r, float hw, float a0, float a1) {
  vec2 d = p - c;
  float dist = abs(length(d) - r);
  float band = 1.0 - sstep(hw * 0.5, hw, dist);
  float ang = atan(d.y, d.x);
  // Wrap into [-PI, PI].
  float lo = a0;
  float hi = a1;
  // Soft angular endpoints (was hard step() — sub-pixel arc at
  // small zoom aliased to dot-pairs at the extrema, user-visible
  // on dendritic). 0.06 rad fade reads as a curve at any size.
  float aFade = 0.06;
  float in_arc = smoothstep(lo - aFade, lo + aFade, ang)
               * (1.0 - smoothstep(hi - aFade, hi + aFade, ang));
  return band * in_arc;
}

void main() {
  int mouthKind = int(v_inst.w + 0.5);
  int eyesCount = int(v_face1.x + 0.5);
  if (eyesCount == 0 && mouthKind == 0) discard;

  // Compose the user-driven face scale into the legacy 1.2 constant.
  // mouthW + eye-spread baked-in below pick this up too, so the whole
  // face scales as one unit when the slider moves.
  float FACE_SCALE = FACE_SCALE_BASE * u_faceScale;

  float eyeRBase = v_face1.y;
  float eyeY = v_face1.z;
  float pupilRBase = v_face1.w;
  float blink = v_face2.w;
  vec2 look = vec2(v_face2.x, v_face2.y);
  float mouthW = v_face2.z * u_faceScale;
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
        float wA = 1.0 - sstep(0.92, 1.0, ed);
        col = mix(col, vec3(1.0), wA);
        a = max(a, wA);
      } else {
        float ed = length(d) / eyeR;
        // Guard widens with the SPLITTING blur amount (v_face3.z,
        // body-radius units) so the eye whites blur outward
        // during a split instead of being hard-clipped at the
        // original ed < 1.05 disc. blur=0 → guard = 1.05 (legacy
        // perf-friendly look); blur=0.10 → guard ≈ 1.05 + 0.56
        // in eye-radius units, which lines up with the widened
        // smoothstep transition.
        if (ed < 1.05 + v_face3.z / max(eyeR, 0.001)) {
          float white = 1.0 - sstep(0.92, 1.0, ed);
          col = mix(col, vec3(1.0), white);
          a = max(a, white);
          // Pupil
          vec2 pupilCentre = ec + look * (eyeR * 0.45);
          float pd = length(v_uv - pupilCentre) / pupilR;
          float pupilA = 1.0 - sstep(0.92, 1.05, pd);
          col = mix(col, vec3(0.06, 0.07, 0.09), pupilA);
          a = max(a, pupilA);
          // Glint
          vec2 glintCentre = pupilCentre - vec2(pupilR * 0.35, pupilR * 0.35);
          float gd = length(v_uv - glintCentre) / (pupilR * 0.30);
          float glintA = (1.0 - sstep(0.92, 1.05, gd)) * 0.85;
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
    // SMILE (or DROOL — base smile). Filled circular segment below
    // the chord — reads as a solid "U" mouth at every zoom level
    // (the previous thin-arc stroke aliased to dot-pairs at small
    // sizes; user wants every cell/pathogen to draw a solid mouth).
    vec2 sc = vec2(0.0, mouthY - mouthW * 0.3);
    float chordY = sc.y + mouthW * sin(0.12 * 3.14159);
    float discMask = 1.0 - sstep(mouthW * 0.95, mouthW, length(v_uv - sc));
    float chordMask = sstep(chordY - 0.005, chordY + 0.005, v_uv.y);
    float fill = discMask * chordMask;
    col = mix(col, v_mouthCol, fill);
    a = max(a, fill);
    if (mouthKind == 6) {
      // Drool drip — small ellipse below the smile, animates over time.
      float dripPhase = fract(u_time * 0.6 + phase);
      vec2 dripC = vec2(mouthW * 0.25, mouthY + mouthW * 0.25 + dripPhase * mouthW * 0.8);
      vec2 dr = (v_uv - dripC) / vec2(mouthW * 0.10, mouthW * 0.16);
      float dripA = (1.0 - sstep(0.85, 1.0, length(dr))) * (1.0 - dripPhase);
      col = mix(col, vec3(0.47, 0.86, 0.51), dripA);
      a = max(a, dripA);
    }
  } else if (mouthKind == 2) {
    // FROWN — filled circular segment above the chord (mirror of smile).
    vec2 fc = vec2(0.0, mouthY + mouthW * 0.6);
    float chordY = fc.y - mouthW * sin(0.12 * 3.14159);
    float discMask = 1.0 - sstep(mouthW * 0.95, mouthW, length(v_uv - fc));
    float chordMask = 1.0 - sstep(chordY - 0.005, chordY + 0.005, v_uv.y);
    float fill = discMask * chordMask;
    col = mix(col, v_mouthCol, fill);
    a = max(a, fill);
  } else if (mouthKind == 3) {
    // SNARL — 5 downward-pointing triangular teeth sharing their
    // top edges. Solid filled (not a rectangle with sawtooth).
    float topY = mouthY - mouthW * 0.05;
    float toothH = mouthW * 0.30;
    float halfStep = mouthW / 5.0;          // half-width of each tooth
    float ly = v_uv.y - topY;
    if (ly > 0.0 && ly < toothH) {
      // Locate which tooth this fragment is over.
      float xrel = (v_uv.x + mouthW) / (2.0 * mouthW);  // 0..1 across the band
      if (xrel > 0.0 && xrel < 1.0) {
        float idx = floor(xrel * 5.0);
        float cx = -mouthW + (idx + 0.5) * (2.0 * mouthW / 5.0);
        float t = ly / toothH;
        float halfAtY = (1.0 - t) * halfStep;
        // Soft tooth edge AA: ramp the boundary across ~0.005 uv.
        float fill = 1.0 - smoothstep(halfAtY - 0.005, halfAtY + 0.005,
                                       abs(v_uv.x - cx));
        col = mix(col, v_mouthCol, fill);
        a = max(a, fill);
      }
    }
  } else if (mouthKind == 4) {
    // FANGS — open mouth ellipse + two white triangles
    vec2 dn = d / vec2(mouthW, mouthW * 0.45);
    float open = 1.0 - sstep(0.92, 1.0, length(dn));
    col = mix(col, v_mouthCol, open);
    a = max(a, open);
    // Approximate fangs with two small bright wedges below the mouth ellipse.
    vec2 fL = vec2(-mouthW * 0.40, mouthY + mouthW * 0.10);
    vec2 fR = vec2( mouthW * 0.40, mouthY + mouthW * 0.10);
    float fLA = (1.0 - sstep(0.85, 1.0, length((v_uv - fL) / vec2(mouthW * 0.10, mouthW * 0.32)))) * 1.0;
    float fRA = (1.0 - sstep(0.85, 1.0, length((v_uv - fR) / vec2(mouthW * 0.10, mouthW * 0.32)))) * 1.0;
    col = mix(col, vec3(1.0), max(fLA, fRA));
    a = max(a, max(fLA, fRA));
  } else if (mouthKind == 5) {
    // TONGUE — open mouth + pink tongue ellipse below
    vec2 dn = d / vec2(mouthW, mouthW * 0.40);
    float open = 1.0 - sstep(0.92, 1.0, length(dn));
    col = mix(col, v_mouthCol, open);
    a = max(a, open);
    float wag = sin(u_time * 5.0 + phase) * mouthW * 0.18;
    vec2 tc = vec2(wag, mouthY + mouthW * 0.30);
    vec2 td = (v_uv - tc) / vec2(mouthW * 0.32, mouthW * 0.22);
    float tA = 1.0 - sstep(0.85, 1.0, length(td));
    col = mix(col, vec3(1.0, 0.54, 0.63), tA);
    a = max(a, tA);
  }

  // SPLITTING fade — alphaMul drops to ~0.2 at p=0.5 then returns
  // to 1 at split end. Always 1 outside SPLITTING.
  float alphaMul = v_face3.w;
  float finalA = a * alphaMul;
  if (finalA <= 0.0) discard;
  outColor = vec4(col, finalA);
}`;

// Point-in-polygon ray-cast test. `verts` is a flat (x, y) Float64Array
// of N vertices; tests whether (px, py) is inside the closed polygon.
// Used by 'polygon' metaSplit outline mode to skip segments whose
// midpoint falls inside the partner half (approximate union).
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

function hexToVec3(hex) {
  let h = (hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// Cell-shader theme key → integer for the FRAG_DISK u_theme uniform.
// Mirrors KNOWN_THEME_KEYS in core/state.js. Unknown values fall back
// to 0 (legacy) so a stale localStorage entry never breaks rendering.
const _THEME_IDS = { legacy: 0, microscope: 1, cartoon: 2, kurzgesagt: 3, classic: 4 };
function _themeId(key) { return _THEME_IDS[key] || 0; }

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
    this.gl = canvas.getContext('webgl2', { alpha: RT_TRANSLUCENT, antialias: true, premultipliedAlpha: false });
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
    this._diskU.borderThickness = gl.getUniformLocation(this._diskProg, 'u_borderThickness');
    this._diskU.theme = gl.getUniformLocation(this._diskProg, 'u_theme');

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
    // Instance layout: 24 floats per cell —
    //   0..3   inst:    (x, y, r, kindAsFloat)
    //   4..7   phase:   (phase, seed, freq, wobbleMul)
    //   8..10  cytoTop  (rgb)
    //  11..13  cytoBot  (rgb)
    //  14..16  nucleus  (rgb)
    //  17..20  outline  (rgba; .a = c.flash)
    //  21      diskAlpha (SPLITTING crossfade)
    //  22..23  bump     (vec2: impact-normal × intensity, bump-feedback)
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
    attr(7, 1); // a_diskAlpha (SPLITTING crossfade)
    attr(8, 2); // a_bump (bump-feedback squash axis)
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
    this._bgU.bgScale = bu('u_bgScale');
    this._bgU.reactorTex = bu('u_reactorTex');
    this._bgU.tissueTex = bu('u_tissueTex');
    this._bgU.opacity = bu('u_opacity');

    // Reactor (Gray-Scott) — programs compile lazily on first use,
    // not at boot: most sessions never select the theme. See
    // _reactorEnsure() for the FBO/program allocation.
    this._reactorProgsReady = false;

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
      faceScale: gl.getUniformLocation(this._faceProg, 'u_faceScale'),
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

    this._buildParticlePipeline();
    this._buildAntibodyPipeline();
    this._buildMetaballPipeline();
  }

  _buildParticlePipeline() {
    const gl = this.gl;
    this._particleProg = link(gl, VERT_PARTICLE, FRAG_PARTICLE);
    this._particleU = {
      camera: gl.getUniformLocation(this._particleProg, 'u_camera'),
      viewport: gl.getUniformLocation(this._particleProg, 'u_viewport'),
    };
    this._particleVbo = gl.createBuffer();
    this._particleCapacity = 0;          // capacity in particles (8 floats each)
    this._particleData = new Float32Array(0);
    this._growParticleBuffer(64);

    this._particleVao = gl.createVertexArray();
    gl.bindVertexArray(this._particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._cornerVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleVbo);
    {
      const stride = PARTICLE_INSTANCE_FLOATS * 4;
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(2, 1);
    }
    gl.bindVertexArray(null);
  }

  _buildAntibodyPipeline() {
    const gl = this.gl;
    this._antibodyProg = link(gl, VERT_ANTIBODY, FRAG_ANTIBODY);
    this._antibodyU = {
      camera:   gl.getUniformLocation(this._antibodyProg, 'u_camera'),
      viewport: gl.getUniformLocation(this._antibodyProg, 'u_viewport'),
    };
    // Static unit-Y vertex buffer.
    this._antibodyUnitVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._antibodyUnitVbo);
    gl.bufferData(gl.ARRAY_BUFFER, ANTIBODY_UNIT_Y, gl.STATIC_DRAW);
    // Dynamic per-instance buffer.
    this._antibodyInstVbo = gl.createBuffer();
    this._antibodyCapacity = 0;
    this._antibodyData = new Float32Array(0);
    this._growAntibodyBuffer(32);
    // VAO with the unit-Y at location 0 + per-instance attrs at 1, 2.
    this._antibodyVao = gl.createVertexArray();
    gl.bindVertexArray(this._antibodyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._antibodyUnitVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._antibodyInstVbo);
    {
      const stride = ANTIBODY_INSTANCE_FLOATS * 4;
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(2, 1);
    }
    gl.bindVertexArray(null);
  }

  _growAntibodyBuffer(target) {
    if (target <= this._antibodyCapacity) return;
    const newCap = Math.max(32, Math.ceil(target * 1.5));
    this._antibodyData = new Float32Array(newCap * ANTIBODY_INSTANCE_FLOATS);
    this._antibodyCapacity = newCap;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._antibodyInstVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._antibodyData.byteLength, gl.DYNAMIC_DRAW);
  }

  _growParticleBuffer(target) {
    if (target <= this._particleCapacity) return;
    const newCap = Math.max(64, Math.ceil(target * 1.5));
    this._particleData = new Float32Array(newCap * PARTICLE_INSTANCE_FLOATS);
    this._particleCapacity = newCap;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._particleData.byteLength, gl.DYNAMIC_DRAW);
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
      outlineMode: gl.getUniformLocation(this._metaTintProg, 'u_outlineMode'),
      outlineColor: gl.getUniformLocation(this._metaTintProg, 'u_outlineColor'),
      outlineWidth: gl.getUniformLocation(this._metaTintProg, 'u_outlineWidth'),
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
    // Build the post-pin chain of enabled FBO passes by walking
    // S.overlayOrder from just-above-pin upward (= rendering order:
    // first item is closest to the scene pin, runs first). The
    // microscope-blur and duotone effects share one bundled shader
    // ('sceneFx'), so they collapse to a single chain step.
    const order = Array.isArray(S.overlayOrder) ? S.overlayOrder : [];
    const pinIdx = order.indexOf('scene');
    this._postChain = [];
    if (pinIdx > 0) {
      for (let i = pinIdx - 1; i >= 0; i--) {
        const kind = order[i];
        if (kind === 'ripples' && S.liquidRipples) {
          this._postChain.push('ripples');
        } else if (kind === 'caustics' && S.causticsOverlay) {
          this._postChain.push('caustics');
        } else if (kind === 'glass' && S.glassMembrane) {
          this._postChain.push('glass');
        } else if ((kind === 'microscope' || kind === 'duotone')
                   && (S.microscopeBlur || S.makeItReal)) {
          if (!this._postChain.includes('sceneFx')) this._postChain.push('sceneFx');
        }
      }
    }
    // Bg-only ripple mode: ripples is BELOW the scene pin. Bg pass
    // writes to _rippleBgRt; ripple shader then writes to the scene
    // target (either _postRtA if a scene-wide chain is on, or canvas).
    const ripplesBgOnly = !!S.liquidRipples && !overlayKindRunsAfterScene('ripples');

    // Ping-pong RTs for the scene-wide chain. Allocated lazily when
    // any chain step is enabled; freed when none are.
    this._sceneFbo = null;
    if (this._postChain.length > 0) {
      this._postEnsureRts();
      for (const kind of this._postChain) {
        if (kind === 'ripples')  this._rippleEnsureProg();
        if (kind === 'caustics') this._causticEnsureProg();
        if (kind === 'glass')    this._glassEnsureProg();
        if (kind === 'sceneFx')  this._sceneFxEnsureProg();
      }
      this._postSource = this._postRtA;
      this._sceneFbo = this._postSource.fbo;
    } else if (this._postRtA) {
      this._postDestroyRts();
    }
    if (ripplesBgOnly) {
      this._rippleBgEnsureRt();
      this._rippleEnsureProg();
    } else if (this._rippleBgRt) {
      this._rippleBgDestroy();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
    // Defensive clear of the scene post-RT every frame. Without
    // this, the cell-trail smearing the user reported on
    // microscope-blur activation (PR after #237) can leak through
    // when the bg pass either runs `discard` paths or doesn't
    // fully cover (e.g. layer with opacity < 1, sub-pixel
    // viewport edge, tile-cache load on mobile drivers). The bg
    // layer-0 already disables BLEND to overwrite, so this clear
    // is a no-op for well-behaved themes — cheap insurance for
    // edge cases. Note: the canvas (no _sceneFbo) is cleared by
    // the bg pass itself, so this only fires when the post-pin
    // chain is active.
    if (this._sceneFbo) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, RT_CLEAR_A);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  // ---- Reactor (Gray-Scott) helpers --------------------------------
  // The two RTs ping-pong: index 0 = front (display source), 1 = back
  // (write target for the next step). After each step we swap.
  // Sized to half the canvas (capped at 256×256) so a typical frame
  // does ~64k pixel updates per step — ~5 steps * 64k = 320k texel
  // ops per visible frame, well within budget.

  _reactorEnsureProgs() {
    if (this._reactorProgsReady) return;
    const gl = this.gl;
    this._reactorStepProg = link(gl, VERT_FULLSCREEN, FRAG_REACTOR_STEP);
    this._reactorStepU = {
      texture:    gl.getUniformLocation(this._reactorStepProg, 'u_texture'),
      resolution: gl.getUniformLocation(this._reactorStepProg, 'u_resolution'),
    };
    this._reactorSeedProg = link(gl, VERT_FULLSCREEN, FRAG_REACTOR_SEED);
    this._reactorSeedU = {
      texture:   gl.getUniformLocation(this._reactorSeedProg, 'u_texture'),
      seedCount: gl.getUniformLocation(this._reactorSeedProg, 'u_seedCount'),
      seeds:     gl.getUniformLocation(this._reactorSeedProg, 'u_seeds'),
    };
    this._reactorRtA = null;
    this._reactorRtB = null;
    this._reactorFront = 0;     // 0 = A is the display source, 1 = B
    this._reactorRtSize = { w: 0, h: 0 };
    this._reactorLastSeedMs = -Infinity;   // -∞ → seed on the very first frame
    this._reactorSeedBuf = new Float32Array(REACTOR_MAX_SEEDS * 3);
    this._reactorProgsReady = true;
  }

  _reactorMakeRt(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // NEAREST: the laplacian samples 9 specific texels — bilinear
    // blending would smear concentrations across cells and ruin the
    // numerical stability of the Gray-Scott step.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    // Initial fill: pack(A=1, B=0) → (0.05, 0.0, 0, 1). The Gray-Scott
    // equilibrium with no B present is uniform A; this is the
    // pristine state from which seed discs grow Turing patterns.
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.05, 0.0, 0.0, RT_CLEAR_A);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo, tex };
  }

  _reactorEnsureRts() {
    const gl = this.gl;
    const targetW = Math.max(64, Math.min(256, Math.floor(this.W * 0.5)));
    const targetH = Math.max(64, Math.min(256, Math.floor(this.H * 0.5)));
    if (this._reactorRtA && this._reactorRtSize.w === targetW && this._reactorRtSize.h === targetH) return;
    if (this._reactorRtA) {
      gl.deleteFramebuffer(this._reactorRtA.fbo); gl.deleteTexture(this._reactorRtA.tex);
    }
    if (this._reactorRtB) {
      gl.deleteFramebuffer(this._reactorRtB.fbo); gl.deleteTexture(this._reactorRtB.tex);
    }
    this._reactorRtA = this._reactorMakeRt(targetW, targetH);
    this._reactorRtB = this._reactorMakeRt(targetW, targetH);
    this._reactorRtSize = { w: targetW, h: targetH };
    this._reactorFront = 0;
    this._reactorLastSeedMs = -Infinity;
  }

  _reactorRt(idx) { return idx === 0 ? this._reactorRtA : this._reactorRtB; }

  _reactorSeed(seedCount) {
    const gl = this.gl;
    const front = this._reactorRt(this._reactorFront);
    const back  = this._reactorRt(1 - this._reactorFront);
    // Caller passes the desired count; fall back to a randomised 5..8
    // when called without an argument (legacy path).
    const count = (typeof seedCount === 'number' && seedCount > 0)
      ? Math.max(1, Math.min(REACTOR_MAX_SEEDS, seedCount | 0))
      : (5 + Math.floor(Math.random() * 4));
    for (let i = 0; i < count; i++) {
      this._reactorSeedBuf[i * 3]     = Math.random();
      this._reactorSeedBuf[i * 3 + 1] = Math.random();
      // Disc radius in UV space — small enough that seeds don't drown
      // the whole RT in B; ~3% of the texture in radius works well.
      this._reactorSeedBuf[i * 3 + 2] = 0.025 + Math.random() * 0.015;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, back.fbo);
    gl.viewport(0, 0, this._reactorRtSize.w, this._reactorRtSize.h);
    gl.useProgram(this._reactorSeedProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, front.tex);
    gl.uniform1i(this._reactorSeedU.texture, 0);
    gl.uniform1i(this._reactorSeedU.seedCount, count);
    gl.uniform3fv(this._reactorSeedU.seeds, this._reactorSeedBuf);
    gl.bindVertexArray(this._bgVao);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    this._reactorFront = 1 - this._reactorFront;
  }

  _reactorStep(iters) {
    const gl = this.gl;
    gl.useProgram(this._reactorStepProg);
    gl.uniform2f(this._reactorStepU.resolution, this._reactorRtSize.w, this._reactorRtSize.h);
    gl.uniform1i(this._reactorStepU.texture, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this._bgVao);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this._reactorRtSize.w, this._reactorRtSize.h);
    for (let i = 0; i < iters; i++) {
      const front = this._reactorRt(this._reactorFront);
      const back  = this._reactorRt(1 - this._reactorFront);
      gl.bindFramebuffer(gl.FRAMEBUFFER, back.fbo);
      gl.bindTexture(gl.TEXTURE_2D, front.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this._reactorFront = 1 - this._reactorFront;
    }
    gl.enable(gl.BLEND);
  }

  _reactorDestroy() {
    const gl = this.gl;
    if (this._reactorRtA) { gl.deleteFramebuffer(this._reactorRtA.fbo); gl.deleteTexture(this._reactorRtA.tex); this._reactorRtA = null; }
    if (this._reactorRtB) { gl.deleteFramebuffer(this._reactorRtB.fbo); gl.deleteTexture(this._reactorRtB.tex); this._reactorRtB = null; }
    if (this._reactorStepProg) { gl.deleteProgram(this._reactorStepProg); this._reactorStepProg = null; }
    if (this._reactorSeedProg) { gl.deleteProgram(this._reactorSeedProg); this._reactorSeedProg = null; }
    this._reactorProgsReady = false;
  }

  // ── Post-FX ping-pong RTs (shared) ──
  // Two canvas-sized RGBA8 FBOs alternated between by every
  // post-pin overlay. Each chain step reads from `_postSource`
  // and writes to the other RT, then we swap. The last step
  // writes straight to the default framebuffer.
  _postMakeRt(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo, tex, w, h };
  }
  // Lazy 1×1 RGBA dummy used by the bg pass to keep
  // u_reactorTex / u_tissueTex samplers pointed at a known-safe
  // texture on kinds that don't sample them. Created once;
  // contents don't matter.
  _ensureBgDummyTex() {
    if (this._bgDummyTex) return;
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this._bgDummyTex = t;
  }

  _postEnsureRts() {
    const w = this.canvas.width | 0;
    const h = this.canvas.height | 0;
    if (this._postRtA && this._postRtA.w === w && this._postRtA.h === h) return;
    this._postDestroyRts();
    this._postRtA = this._postMakeRt(w, h);
    this._postRtB = this._postMakeRt(w, h);
  }
  _postDestroyRts() {
    const gl = this.gl;
    if (this._postRtA) { gl.deleteFramebuffer(this._postRtA.fbo); gl.deleteTexture(this._postRtA.tex); this._postRtA = null; }
    if (this._postRtB) { gl.deleteFramebuffer(this._postRtB.fbo); gl.deleteTexture(this._postRtB.tex); this._postRtB = null; }
    this._postSource = null;
  }

  // ── Caustics overlay (S.causticsOverlay) ──
  // Shader-only helper. RT allocation lives in _postEnsureRts; the
  // shader samples whichever ping-pong RT is currently the chain
  // source and writes to the other (or to the default framebuffer
  // for the last chain step).
  _causticEnsureProg() {
    if (this._causticProg) return;
    const gl = this.gl;
    const prog = link(gl, VERT_FULLSCREEN, FRAG_CAUSTIC_BG);
    this._causticProg = prog;
    this._causticU = {
      bg:   gl.getUniformLocation(prog, 'u_bg'),
      time: gl.getUniformLocation(prog, 'u_time'),
      res:  gl.getUniformLocation(prog, 'u_resolution'),
      tint: gl.getUniformLocation(prog, 'u_tint'),
    };
  }
  _causticDestroy() {
    const gl = this.gl;
    if (this._causticProg) {
      gl.deleteProgram(this._causticProg);
      this._causticProg = null;
      this._causticU = null;
    }
  }

  // ── Microscope FX post-pass (S.microscopeBlur + S.makeItReal) ──
  // Bundled shader for scene-wide blur + duotone color grade. Shares
  // the ping-pong RTs with the rest of the post chain.
  _sceneFxEnsureProg() {
    if (this._sceneFxProg) return;
    const gl = this.gl;
    const prog = link(gl, VERT_FULLSCREEN, FRAG_SCENE_FX);
    this._sceneFxProg = prog;
    this._sceneFxU = {
      scene:        gl.getUniformLocation(prog, 'u_scene'),
      res:          gl.getUniformLocation(prog, 'u_resolution'),
      blurOn:       gl.getUniformLocation(prog, 'u_blurOn'),
      focusRadius:  gl.getUniformLocation(prog, 'u_focusRadius'),
      blurStrength: gl.getUniformLocation(prog, 'u_blurStrength'),
      falloff:      gl.getUniformLocation(prog, 'u_falloff'),
      gradeOn:      gl.getUniformLocation(prog, 'u_gradeOn'),
      hue1:         gl.getUniformLocation(prog, 'u_hue1'),
      hue2:         gl.getUniformLocation(prog, 'u_hue2'),
      saturation:   gl.getUniformLocation(prog, 'u_saturation'),
    };
  }
  _sceneFxDestroy() {
    const gl = this.gl;
    if (this._sceneFxProg) {
      gl.deleteProgram(this._sceneFxProg);
      this._sceneFxProg = null;
      this._sceneFxU = null;
    }
  }

  // ── Liquid-ripples overlay (S.liquidRipples) ──
  // Two code paths depending on ripples' position vs the scene pin
  // in S.overlayOrder:
  //   • Below pin → bg-only. drawBackground writes bg to _rippleBgRt
  //     and the ripple shader writes to the active scene target
  //     (either canvas or _postRtA when a scene-wide chain is on).
  //     Cells then render on top.
  //   • Above pin → joins the scene-wide post chain as a normal
  //     ping-pong step using _postRtA/_postRtB (the shared chain RTs).
  _rippleBgEnsureRt() {
    const w = this.canvas.width | 0;
    const h = this.canvas.height | 0;
    if (this._rippleBgRt && this._rippleBgRt.w === w && this._rippleBgRt.h === h) return;
    if (this._rippleBgRt) {
      const gl = this.gl;
      gl.deleteFramebuffer(this._rippleBgRt.fbo);
      gl.deleteTexture(this._rippleBgRt.tex);
    }
    this._rippleBgRt = this._postMakeRt(w, h);
  }
  _rippleBgDestroy() {
    const gl = this.gl;
    if (this._rippleBgRt) {
      gl.deleteFramebuffer(this._rippleBgRt.fbo);
      gl.deleteTexture(this._rippleBgRt.tex);
      this._rippleBgRt = null;
    }
  }
  // FX overlay program (noise / vignette / crosshair). Single shader
  // shared across all three effects; the JS driver sets `u_effect` +
  // `u_mode` + `u_intensity` per draw and picks the GPU blendFunc to
  // match the requested mode. Lazy-init: only built when the first
  // FX overlay toggles on.
  _fxOverlayEnsureProg() {
    if (this._fxOverlayProg) return;
    const gl = this.gl;
    const prog = link(gl, VERT_FULLSCREEN, FRAG_FX_OVERLAY);
    this._fxOverlayProg = prog;
    this._fxOverlayU = {
      res:       gl.getUniformLocation(prog, 'u_resolution'),
      time:      gl.getUniformLocation(prog, 'u_time'),
      effect:    gl.getUniformLocation(prog, 'u_effect'),
      mode:      gl.getUniformLocation(prog, 'u_mode'),
      intensity: gl.getUniformLocation(prog, 'u_intensity'),
    };
  }

  // Apply the GPU blend func that matches a blend-mode setting.
  // Crosshair always uses normal blending so it stays legible.
  _fxOverlayBlend(mode) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    if (mode === 'multiply') {
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    } else if (mode === 'additive') {
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  // Draw the enabled FX overlays in order: noise → vignette →
  // crosshair. Each enabled effect picks up its own blend mode +
  // intensity; the shader branches internally on `u_effect`.
  _fxOverlayDraw(t) {
    // Three fixed-function FX overlays composited on top of the
    // scene framebuffer. Order comes from overlayFxOrder() — the FX
    // subset of S.overlayOrder — so the user can reorder via the
    // sortable list (Settings → Overlays). Each entry checks its
    // own enabled-toggle. Per-frame read of S.* means reorders +
    // toggles take effect on the next draw with no pipeline reset
    // needed. The list is reversed before iteration to honour the
    // UI's "Stack (top runs last)" semantics: top-of-list FX
    // composites last (= visually on top), matching the post-pin
    // FBO chain's bottom-to-top walk.
    const order = overlayFxOrder().slice().reverse();
    const anyOn = order.some(k => {
      if (k === 'noise')     return !!S.staticNoise;
      if (k === 'vignette')  return !!S.vignette;
      if (k === 'crosshair') return !!S.crosshair;
      return false;
    });
    if (!anyOn) return;
    const gl = this.gl;
    this._fxOverlayEnsureProg();
    gl.useProgram(this._fxOverlayProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this._bgVao);
    gl.uniform2f(this._fxOverlayU.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this._fxOverlayU.time, t);
    const _MODES = { normal: 1, multiply: 2, additive: 3 };
    for (const k of order) {
      if (k === 'noise' && S.staticNoise) {
        gl.uniform1i(this._fxOverlayU.effect, 1);
        gl.uniform1i(this._fxOverlayU.mode, _MODES[S.staticNoiseBlend] || 3);
        gl.uniform1f(this._fxOverlayU.intensity, S.staticNoiseIntensity ?? 0.4);
        this._fxOverlayBlend(S.staticNoiseBlend);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (k === 'vignette' && S.vignette) {
        gl.uniform1i(this._fxOverlayU.effect, 2);
        gl.uniform1i(this._fxOverlayU.mode, _MODES[S.vignetteBlend] || 3);
        gl.uniform1f(this._fxOverlayU.intensity, S.vignetteIntensity ?? 0.6);
        this._fxOverlayBlend(S.vignetteBlend);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (k === 'crosshair' && S.crosshair) {
        gl.uniform1i(this._fxOverlayU.effect, 3);
        gl.uniform1i(this._fxOverlayU.mode, 1);
        gl.uniform1f(this._fxOverlayU.intensity, 1.0);
        this._fxOverlayBlend('normal');
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null);
  }

  _rippleEnsureProg() {
    if (this._rippleProg) return;
    const gl = this.gl;
    const prog = link(gl, VERT_FULLSCREEN, FRAG_RIPPLE_BG);
    this._rippleProg = prog;
    this._rippleU = {
      bg:        gl.getUniformLocation(prog, 'u_bg'),
      time:      gl.getUniformLocation(prog, 'u_time'),
      res:       gl.getUniformLocation(prog, 'u_resolution'),
      cellCount: gl.getUniformLocation(prog, 'u_cellCount'),
      cells:     gl.getUniformLocation(prog, 'u_cells'),
      params:    gl.getUniformLocation(prog, 'u_rippleParams'),
    };
    this._rippleCellsBuf = new Float32Array(RIPPLE_MAX * 3);
  }
  _rippleDestroy() {
    const gl = this.gl;
    if (this._rippleProg) {
      gl.deleteProgram(this._rippleProg);
      this._rippleProg = null;
      this._rippleU = null;
    }
  }
  // Lazy WebGL2 texture upload for tissue bg (kind=11). Cached
  // per-URL on the renderer so re-selecting the same texture is
  // free. While the image is loading, returns a 1x1 fallback so
  // the sampler always has something valid bound — the shader
  // then shows a near-uniform tint until the real bytes arrive.
  _tissueTexFor(url) {
    const gl = this.gl;
    if (!this._tissueTexCache) this._tissueTexCache = new Map();
    const cache = this._tissueTexCache;
    if (!this._tissueFallbackTex) {
      // 1x1 mid-grey placeholder; replaced once the image decodes.
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                    new Uint8Array([64, 32, 36, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this._tissueFallbackTex = t;
    }
    if (!url) return this._tissueFallbackTex;
    const slot = cache.get(url);
    if (slot && slot.tex) return slot.tex;
    if (slot && slot.pending) return this._tissueFallbackTex;
    cache.set(url, { pending: true });
    loadTexture(url).then((img) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // Mip + trilinear so small bgScale (tiny tiles) doesn't shimmer.
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      cache.set(url, { tex });
    }).catch((e) => {
      console.warn('[webgl2 tissue] load failed:', e && e.message);
      cache.set(url, { tex: this._tissueFallbackTex });
    });
    return this._tissueFallbackTex;
  }

  // ── Glass-membrane overlay (WebGL2 parity of glass on webgpu.js) ──
  _glassEnsureProg() {
    if (this._glassProg) return;
    const gl = this.gl;
    const prog = link(gl, VERT_FULLSCREEN, FRAG_GLASS_BG);
    this._glassProg = prog;
    this._glassU = {
      bg:        gl.getUniformLocation(prog, 'u_bg'),
      time:      gl.getUniformLocation(prog, 'u_time'),
      res:       gl.getUniformLocation(prog, 'u_resolution'),
      cellCount: gl.getUniformLocation(prog, 'u_cellCount'),
      cells:     gl.getUniformLocation(prog, 'u_cells'),
      params:    gl.getUniformLocation(prog, 'u_glassParams'),
    };
    this._glassCellsBuf = new Float32Array(GLASS_MAX * 3);
  }
  _glassDestroy() {
    const gl = this.gl;
    if (this._glassProg) {
      gl.deleteProgram(this._glassProg);
      this._glassProg = null;
      this._glassU = null;
    }
  }
  _glassCollectCells() {
    const buf = this._glassCellsBuf;
    const cells = (this.sim && this.sim.cells) || [];
    const W = this.W, H = this.H;
    const minAx = Math.max(1, Math.min(W, H));
    let n = 0;
    for (let i = 0; i < cells.length && n < GLASS_MAX; i++) {
      const c = cells[i];
      const s = this.sim.worldToScreen(c.x, c.y);
      const m = c.r * 1.5;
      if (s.x < -m || s.y < -m || s.x > W + m || s.y > H + m) continue;
      buf[n * 3 + 0] = s.x / W;
      buf[n * 3 + 1] = s.y / H;
      buf[n * 3 + 2] = (c.r * this.camera.scale) / minAx;
      n++;
    }
    for (let i = n * 3; i < GLASS_MAX * 3; i++) buf[i] = 0;
    return n;
  }
  // Pack at most RIPPLE_MAX on-screen cells into _rippleCellsBuf as
  // (uvX, uvY, uvR_minAxis) triplets. Returns the count actually used.
  _rippleCollectCells() {
    const buf = this._rippleCellsBuf;
    const cells = (this.sim && this.sim.cells) || [];
    const W = this.W, H = this.H;
    const minAx = Math.max(1, Math.min(W, H));
    let n = 0;
    for (let i = 0; i < cells.length && n < RIPPLE_MAX; i++) {
      const c = cells[i];
      const s = this.sim.worldToScreen(c.x, c.y);
      // Skip off-screen + a tiny margin so the post-pass cost stays
      // proportional to visible cells rather than total population.
      const m = c.r * 1.5;
      if (s.x < -m || s.y < -m || s.x > W + m || s.y > H + m) continue;
      buf[n * 3 + 0] = s.x / W;
      buf[n * 3 + 1] = s.y / H;
      buf[n * 3 + 2] = (c.r * this.camera.scale) / minAx;
      n++;
    }
    // Zero out the unused tail so the GPU doesn't read stale data.
    for (let i = n * 3; i < RIPPLE_MAX * 3; i++) buf[i] = 0;
    return n;
  }

  drawBackground(timeMs) {
    const gl = this.gl;
    // Rendertest translucent: skip the bg pipeline entirely and leave
    // the framebuffer at alpha=0 so the captured PNG has a clean
    // transparent backdrop. Cell + overlay passes still run on top
    // and write their own alpha where they paint.
    if (RT_TRANSLUCENT) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this._lastFrameSec = timeMs * 0.001 * (S.bgFlowSpeed || 1);
      return;
    }
    const layers = currentBgLayers();
    const t = timeMs * 0.001 * (S.bgFlowSpeed || 1);
    this._lastFrameSec = t;     // endFrame's post-pass reads this

    // Reactor (Gray-Scott) — run N step iterations + maybe seed before
    // the display pass(es), so the FRAG_BG kind=8 branch can sample the
    // up-to-date front RT. Update once per frame regardless of how many
    // reactor layers reference it. Per-layer fields (seedCount,
    // reseedSec, simSpeed) come from the first reactor layer; the rest
    // tag along since they sample the same RT.
    const reactorLayer = layers.find(l => l.kind === 'reactor');
    const hasReactor = !!reactorLayer;
    if (hasReactor) {
      this._reactorEnsureProgs();
      this._reactorEnsureRts();
      const reseedSec = Math.max(0.1, +reactorLayer.reseedSec || 10);
      if (timeMs - this._reactorLastSeedMs > reseedSec * 1000) {
        const seedCount = Math.max(1, Math.min(REACTOR_MAX_SEEDS,
          Math.round(+reactorLayer.seedCount || 6)));
        this._reactorSeed(seedCount);
        this._reactorLastSeedMs = timeMs;
      }
      const simSpeed = Math.max(0, Math.min(15,
        Math.round(+reactorLayer.simSpeed ?? 5)));
      if (simSpeed > 0) this._reactorStep(simSpeed);
      // Restore the scene framebuffer + drawing-buffer viewport so
      // the bg display pass renders into the same target as cells.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    } else if (this._reactorRtA) {
      // No layer references reactor — release the RTs so we don't
      // carry the GPU memory across the rest of the session.
      this._reactorDestroy();
    }

    // Bg-only ripple mode (ripples positioned below the scene pin):
    // redirect the entire bg stack into the bg-ripple RT, then run
    // the ripple post-pass to the active scene target. Scene-wide
    // mode (ripples above the pin) is handled in endFrame() instead.
    const bgOnlyRipples = !!S.liquidRipples && !overlayKindRunsAfterScene('ripples');
    if (bgOnlyRipples) {
      this._rippleBgEnsureRt();
      this._rippleEnsureProg();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rippleBgRt.fbo);
      gl.viewport(0, 0, this._rippleBgRt.w, this._rippleBgRt.h);
    }

    if (layers.length === 0) {
      // No enabled layers — clear to black so cells aren't drawn over
      // stale pixels.
      gl.clearColor(0, 0, 0, RT_CLEAR_A);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else {
      gl.useProgram(this._bgProg);
      gl.bindVertexArray(this._bgVao);
      gl.uniform4f(this._bgU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
      gl.uniform2f(this._bgU.viewport, this.W, this.H);
      gl.uniform1f(this._bgU.time, t);

      // Bind a 1×1 dummy to TEXTURE0 + TEXTURE1 before each bg
      // pass. The bg shader has u_reactorTex / u_tissueTex
      // samplers that the kind-specific branches (kind=8 reactor,
      // kind=11 tissue) bind real textures to — but for every
      // other kind those samplers retain whatever was bound last
      // frame. After the post-pin sceneFx pass bound _postRtA.tex
      // to TEXTURE0 in the previous frame's endFrame, TEXTURE0
      // would still point to _postRtA.tex on this frame's bg pass.
      // _postRtA is now the render target, so the sampler
      // referencing a texture that's also the FB attachment is a
      // WebGL2 feedback-loop violation → GL_INVALID_OPERATION on
      // drawArrays → bg silently fails and the FB stays at the
      // defensive-clear black. Binding a known-safe dummy here
      // breaks the feedback unconditionally; the kind-specific
      // rebind below still overrides for the kinds that need it.
      this._ensureBgDummyTex();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._bgDummyTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._bgDummyTex);

      for (let li = 0; li < layers.length; li++) {
        const bg = layers[li];
        this._setBgLayerUniforms(bg, t);
        // Layer 0 is the bg "base" — it must fully cover the FB so
        // the post-pin chain RT (cleared to black at the start of
        // every frame) doesn't show through. Override u_opacity to
        // 1.0 here regardless of the layer's saved opacity slider:
        // partial-opacity bases don't have a useful meaning anyway
        // (there's nothing behind layer 0 to blend with), and
        // skipping this override was the reason microscope /
        // duotone showed a black backdrop in PR-after-#238.
        if (li === 0) gl.uniform1f(this._bgU.opacity, 1.0);
        this._applyBgLayerBlend(li, bg);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    if (bgOnlyRipples && this._rippleProg) {
      const cellCount = this._rippleCollectCells();
      // Write the rippled bg to the active scene target — either
      // the scene-wide chain head (_postRtA) or the default fb.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo || null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this._rippleProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._rippleBgRt.tex);
      gl.uniform1i(this._rippleU.bg, 0);
      gl.uniform1f(this._rippleU.time, t);
      gl.uniform2f(this._rippleU.res, this.canvas.width, this.canvas.height);
      gl.uniform1i(this._rippleU.cellCount, cellCount);
      gl.uniform3fv(this._rippleU.cells, this._rippleCellsBuf);
      gl.uniform3f(this._rippleU.params,
                   S.rippleDensity ?? 1.5,
                   S.rippleReach ?? 0.7,
                   S.rippleStrength ?? 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null);
    // Decor (lobules, villi, neurons, …) intentionally not ported —
    // background flair only visible in a handful of themes.

    // DIAG_WEBGL: readPixels + gl.getError() + verbose state log
    // once per second, only when ?diagnose=webgl is set in the URL.
    // Captures richer state on each tick so we can identify what
    // changes between frames (frame-1-works / frame-2-breaks bugs).
    if (DIAG_WEBGL && this._sceneFbo && (S.microscopeBlur || S.makeItReal)) {
      const now = performance.now();
      if (!this._bgDiagLastMs || now - this._bgDiagLastMs > 1000) {
        this._bgDiagLastMs = now;
        const px = new Uint8Array(4);
        const cx = (this.canvas.width / 2) | 0;
        const cy = (this.canvas.height / 2) | 0;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
        gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const err = gl.getError();
        const bg0 = layers[0] || {};
        // eslint-disable-next-line no-console
        console.log('[duotone-diag2]',
                    `px=rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
                    `glErr=${err}`,
                    `kind=${bg0.kind}`,
                    `base=${bg0.base}`,
                    `top=${bg0.topColor}`,
                    `bot=${bg0.botColor}`,
                    `rbc=${bg0.rbcSilhouettes ? 1 : 0}`,
                    `opacity=${bg0.opacity}`,
                    `bgScale=${S.bgScale}`,
                    `flow=${S.bgFlowSpeed}`,
                    `cs=${this.camera.scale}`,
                    `t=${t.toFixed(2)}`);
      }
    }
  }

  _setBgLayerUniforms(bg, t) {
    const gl = this.gl;
    let kind = 0; // flat
    if (bg.kind === 'gradient') kind = 1;
    else if (bg.kind === 'agar') kind = 2;
    else if (bg.kind === 'cybergrid') kind = 3;
    else if (bg.kind === 'lung') kind = 4;
    else if (bg.kind === 'aurora') kind = 5;
    else if (bg.kind === 'underwater') kind = 6;
    else if (bg.kind === 'lava') kind = 7;
    else if (bg.kind === 'reactor') kind = 8;
    else if (bg.kind === 'bloodflow') kind = 9;
    else if (bg.kind === 'cell-shadow') kind = 10;
    else if (bg.kind === 'tissue') kind = 11;
    // 'flat' / 'navy-ghost' / unknown all fall through to flat.

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
      this._spotColsBuf[i * 3]     = v4[0] * v4[3];
      this._spotColsBuf[i * 3 + 1] = v4[1] * v4[3];
      this._spotColsBuf[i * 3 + 2] = v4[2] * v4[3];
    }

    gl.uniform1i(this._bgU.kind, kind);
    gl.uniform3fv(this._bgU.base, hexToVec3(bg.base || '#000000'));
    gl.uniform3fv(this._bgU.top, hexToVec3(bg.topColor || bg.base || '#000000'));
    gl.uniform3fv(this._bgU.bot, hexToVec3(bg.botColor || bg.base || '#000000'));
    gl.uniform3fv(this._bgU.ringColor, rgbaStringToVec3(bg.ringColor || 'rgba(120,80,30,0.5)'));
    gl.uniform3fv(this._bgU.gridColor, rgbaStringToVec3(bg.gridColor || 'rgba(0,255,170,0.5)'));
    gl.uniform1f(this._bgU.gridStep, bg.gridStep || 48);
    gl.uniform1f(this._bgU.vignette, bg.vignette || 0);
    gl.uniform1i(this._bgU.spotCount, count);
    gl.uniform4fv(this._bgU.spots, this._spotsBuf);
    gl.uniform3fv(this._bgU.spotCols, this._spotColsBuf);
    gl.uniform1i(this._bgU.rbc, bg.rbcSilhouettes ? 1 : 0);
    gl.uniform1f(this._bgU.bgScale, S.bgScale || 1);
    gl.uniform1f(this._bgU.opacity, (typeof bg.opacity === 'number') ? bg.opacity : 1);
    if (kind === 8) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._reactorRt(this._reactorFront).tex);
      gl.uniform1i(this._bgU.reactorTex, 0);
    }
    if (kind === 11) {
      // Tissue: lazy GPU texture upload. _tissueTexFor returns the
      // WebGLTexture once the image has decoded; until then we bind
      // a 1x1 fallback so the sampler has something valid.
      const tex = this._tissueTexFor(bg.textureUrl);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this._bgU.tissueTex, 1);
    }
  }

  _applyBgLayerBlend(index, bg) {
    const gl = this.gl;
    if (index === 0) {
      // First layer overwrites whatever was in the framebuffer.
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    const mode = bg.blend || 'normal';
    if (mode === 'additive') {
      gl.blendFunc(gl.ONE, gl.ONE);
    } else if (mode === 'multiply') {
      // True multiply: srcRGB * dstRGB. Source alpha is ignored, so
      // opacity < 1 doesn't lerp toward identity here — acceptable for
      // PR A; tighter control lands with the per-kind config in PR C.
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    } else {
      // 'normal' — standard premultiplied alpha over.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
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
    // path (matches canvas2d / webgpu). Singletons feed the disk pass
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
          // Disk-pass crossfade: re-include the half in the disk pass
          // over p ∈ [0.5, 1.0] with alpha ramping 0 → 1, so by the time
          // finishSplit fires the disk content is already at full
          // opacity and there's no pop when the metaball pass stops.
          if (s.cell.splitProgress > 0.5) {
            s.diskAlpha = (s.cell.splitProgress - 0.5) * 2;
            singletons.push(s);
          }
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
        // Pack the docs/shader-test "test kind" (0..20) at bit 13
        // (multiplier 8192). Read as testKind() in FRAG_DISK; consumed
        // only when u_theme != 0 (Phase 2 per-type SDF dispatch).
        const tk = testKindFor(c.type);
        const kind = bodyK + nucK * 16 + sel * 256 + hollow * 4096 + tk * 8192;
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
        data[j + 21] = (s.diskAlpha !== undefined) ? s.diskAlpha : 1;
        data[j + 22] = c.bumpX || 0;
        data[j + 23] = c.bumpY || 0;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, singletons.length * INSTANCE_FLOATS);

      gl.useProgram(this._diskProg);
      gl.uniform4f(this._diskU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
      gl.uniform2f(this._diskU.viewport, this.W, this.H);
      gl.uniform1f(this._diskU.time, time);
      gl.uniform1f(this._diskU.wobbleAmp, S.wobbleAmp || 0);
      gl.uniform3fv(this._diskU.highlight, hexToVec3(currentHighlightColor()));
      gl.uniform1f(this._diskU.membraneIntensity,
        (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55);
      // GPU border = base cell-border slider × global line-thickness
      // slider. The global control is the one the user expects to
      // affect every line/stroke; the per-shader knob is the legacy
      // GPU-only band thickness from the disk-outline pass.
      gl.uniform1f(this._diskU.borderThickness,
        ((typeof S.cellBorderThickness === 'number') ? S.cellBorderThickness : 3.0)
        * ((typeof S.lineThickness === 'number') ? S.lineThickness : 1.0));
      gl.uniform1f(this._diskU.theme, _themeId(S.theme));
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

      // ---- Pass 4: tint+threshold scratchA → scene fb (alpha blend) ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
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
      // Outline mode: 0 = trace blob edge in this shader; 1/2 (sdf/
      // polygon) emit lines via the decoration pipeline so we suppress
      // the in-shader rim. Width is in normalised mask-alpha units;
      // ~0.06 reads as a clean ~1-2 px rim at default zoom.
      const outlineModeIdx = (S.metaOutlineMode === 'sdf') ? 1
        : (S.metaOutlineMode === 'polygon') ? 2 : 0;
      gl.uniform1i(this._metaTintU.outlineMode, outlineModeIdx);
      gl.uniform3fv(this._metaTintU.outlineColor, hexToVec3(cc.cytoBot));
      gl.uniform1f(this._metaTintU.outlineWidth, 0.06);
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
      const mouthName = effectiveMouthKind(c);
      const mouthKind = MOUTH_KIND_FLOAT[mouthName] || 0;
      if (eyesCount === 0 && mouthKind === 0) continue;

      // Smoothed look-at unit vector — lerped per frame in sim.update.
      // Renormalise here since the lerp may drift slightly off-circle.
      const lm = Math.hypot(c.lookX, c.lookY) || 1;
      const lookX = c.lookX / lm, lookY = c.lookY / lm;

      // Blink: when nextBlink fires the eyes squint for ~120ms, then
      // re-arm. Sim updates aren't aware of this, so we rearm here.
      if (now > c.nextBlink) c.nextBlink = now + 120 + 3000 + Math.random() * 3500;
      const blink = ((c.nextBlink - now) < 120 && (c.nextBlink - now) > 0) ? 1 : 0;

      // Mouth fill colour: hard-coded black so it reads high-contrast
      // on every theme + at every zoom level. (Used to follow the
      // cell's nucleus colour, which made mouths invisible against
      // dark interiors.) Keeps parity with the canvas2d + webgpu
      // paths.
      const mcRgb = [0, 0, 0];

      // Face follows each shape entry. During SPLITTING getShapes
      // emits two entries with correct half centres + radius
      // (shape.js:96-97); for NORMAL cells s.{x,y,r} === c.{x,y,r}.
      const j = n * FACE_INSTANCE_FLOATS;
      data[j]     = s.x;
      data[j + 1] = s.y;
      data[j + 2] = s.r;
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
      // SPLITTING envelope (sine, peaks mid-split, zero at endpoints):
      //   blur (slot 14): widens every smoothstep edge in FRAG_FACE.
      //                   0.12 in body-radius units at peak — eyes
      //                   soften noticeably without dissolving.
      //   alphaMul (slot 15): fades the final face alpha. 1 → 0.2 → 1.
      if (c.state === 'SPLITTING') {
        const env = Math.sin(c.splitProgress * Math.PI);
        data[j + 14] = env * 0.12;
        // Linear face fade: 0.5 at split start → 1.0 at split end.
        data[j + 15] = 0.5 + 0.5 * c.splitProgress;
      } else {
        data[j + 14] = 0;
        data[j + 15] = 1;
      }
      data[j + 16] = mcRgb[0];
      data[j + 17] = mcRgb[1];
      data[j + 18] = mcRgb[2];
      n++;
    }
    if (n === 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this._faceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * FACE_INSTANCE_FLOATS);

    gl.useProgram(this._faceProg);
    gl.uniform4f(this._faceU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
    gl.uniform2f(this._faceU.viewport, this.W, this.H);
    gl.uniform1f(this._faceU.time, time);
    gl.uniform1f(this._faceU.faceScale, S.faceScale != null ? S.faceScale : 1);
    gl.bindVertexArray(this._faceVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  // ---------- Decorations ----------
  _drawDecorations(shapes, time) {
    this._decorLines.length = 0;
    this._decorTris.length = 0;
    // Half-width for thick decoration lines, in world units. Each
    // unit of S.lineThickness ≈ 1 CSS pixel at the current zoom.
    // GPU line-list primitives can't be widened (gl.lineWidth is a
    // no-op on most drivers, WebGPU has no API at all), so
    // _pushLine emits a screen-space-thick quad into _decorTris
    // instead — the slider now visibly thickens cell + pathogen
    // decorations (spikes, tendrils, flagella, cilia, drips, …).
    const lt = (typeof S.lineThickness === 'number') ? S.lineThickness : 1.0;
    this._decorHalfW = (lt * 0.5) / Math.max(0.001, this.camera.scale);
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
    // metaSplit outline modes 'sdf' / 'polygon' emit polygon strokes
    // via this same line pipeline. 'edge' is handled inside the tint
    // shader so emit nothing here.
    if (S.metaSplit && (S.metaOutlineMode === 'sdf' || S.metaOutlineMode === 'polygon')) {
      this._emitMetaSplitOutlines(shapes, time);
    }
    if (this._decorLines.length === 0 && this._decorTris.length === 0) return;
    this._uploadAndDrawDecorations();
  }

  // Pair up SPLITTING shapes by cell.id, emit each half's wobble
  // polygon as 32 line segments (cytoBot colour). For 'polygon' mode,
  // skip segments whose midpoint falls inside the partner polygon —
  // approximate union of the two halves (sub-ms even with several
  // pairs: 32 edges × 64 segment midpoints = 2048 ray-cast ops).
  _emitMetaSplitOutlines(shapes, time) {
    const N = WOBBLE_VERTS;
    const pairs = new Map();
    for (const s of shapes) {
      const c = s.cell;
      if (c.state !== 'SPLITTING') continue;
      let bucket = pairs.get(c.id);
      if (!bucket) { bucket = []; pairs.set(c.id, bucket); }
      bucket.push(s);
    }
    if (pairs.size === 0) return;
    const skipUnion = (S.metaOutlineMode === 'polygon');
    for (const halves of pairs.values()) {
      // Pre-compute each half's polygon verts (we need both for the
      // point-in-polygon test in 'polygon' mode).
      const polys = halves.map((s) => {
        const verts = new Float64Array(N * 2);
        for (let i = 0; i < N; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], time);
          verts[i * 2]     = v.x;
          verts[i * 2 + 1] = v.y;
        }
        return verts;
      });
      for (let hi = 0; hi < halves.length; hi++) {
        const c = halves[hi].cell;
        const cc = cellColors(c);
        const col = hexToVec3(cc.cytoBot);
        const verts = polys[hi];
        const partner = (skipUnion && polys.length === 2) ? polys[1 - hi] : null;
        for (let i = 0; i < N; i++) {
          const a = i * 2;
          const b = ((i + 1) % N) * 2;
          if (partner) {
            const mx = (verts[a] + verts[b]) * 0.5;
            const my = (verts[a + 1] + verts[b + 1]) * 0.5;
            if (pointInPoly(mx, my, partner)) continue;
          }
          this._pushLine(
            verts[a], verts[a + 1], verts[b], verts[b + 1],
            col[0], col[1], col[2], 1.0,
          );
        }
      }
    }
  }

  _pushLine(x1, y1, x2, y2, r, g, b, a) {
    // Expand the segment into a screen-space-thick quad (6 verts
    // / 2 triangles) and write it into _decorTris. The legacy
    // gl.LINES draw path can't honour the lineThickness slider —
    // line-list topology is 1-px on every WebGL2 + WebGPU driver
    // — so all decoration lines go through the triangle pipeline.
    // Endpoints are also extended by halfW along the segment
    // direction so chained segments (flagella waves, tendril
    // curves) overlap at joints instead of showing a notch.
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const hw = this._decorHalfW || 0.5;
    const tx = dx / len, ty = dy / len;          // unit tangent
    const nx = -ty * hw,  ny =  tx * hw;         // half-width normal
    const ex =  tx * hw,  ey =  ty * hw;         // cap extension
    const ax1 = x1 - ex + nx, ay1 = y1 - ey + ny;
    const ax2 = x1 - ex - nx, ay2 = y1 - ey - ny;
    const bx1 = x2 + ex + nx, by1 = y2 + ey + ny;
    const bx2 = x2 + ex - nx, by2 = y2 + ey - ny;
    const arr = this._decorTris;
    arr.push(
      ax1, ay1, r, g, b, a,
      ax2, ay2, r, g, b, a,
      bx1, by1, r, g, b, a,
      ax2, ay2, r, g, b, a,
      bx2, by2, r, g, b, a,
      bx1, by1, r, g, b, a,
    );
  }
  _pushTri(p0, p1, p2, r, g, b, a) {
    const arr = this._decorTris;
    arr.push(p0[0], p0[1], r, g, b, a, p1[0], p1[1], r, g, b, a, p2[0], p2[1], r, g, b, a);
  }

  _uploadAndDrawDecorations() {
    const gl = this.gl;
    gl.useProgram(this._decorProg);
    gl.uniform4f(this._decorU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
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

  // Kill-mode protein/gut explosions. One instanced quad per particle,
  // 8 floats per instance. Soft-disc fragment shader anti-aliases the
  // rim. sim.particles entries: { x, y, vx, vy, r, color (hex string),
  // life, maxLife }.
  drawParticles(particles /* , time, timeMs */) {
    if (!particles || particles.length === 0) return;
    const gl = this.gl;
    this._growParticleBuffer(particles.length);
    const data = this._particleData;
    let n = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const a = Math.max(0, Math.min(1, p.life / Math.max(p.maxLife, 1e-3)));
      if (a <= 0) continue;
      const rgb = hexToVec3(p.color || '#ffffff');
      const j = n * PARTICLE_INSTANCE_FLOATS;
      data[j]     = p.x;
      data[j + 1] = p.y;
      data[j + 2] = p.r;
      data[j + 3] = a;
      data[j + 4] = rgb[0];
      data[j + 5] = rgb[1];
      data[j + 6] = rgb[2];
      data[j + 7] = 0;
      n++;
    }
    if (n === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * PARTICLE_INSTANCE_FLOATS);
    gl.useProgram(this._particleProg);
    gl.uniform4f(this._particleU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
    gl.uniform2f(this._particleU.viewport, this.W, this.H);
    gl.bindVertexArray(this._particleVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  // Y-shaped antibody sprites. Per-instance pack:
  //   (x, y, angle, alpha) + (R, G, B, scale)
  // Vertex shader rotates+scales the unit Y, applies the camera, and
  // drops to clip space. Birth flash + expiry fade are computed JS-side
  // from each antibody's life ratio (mirrors canvas2d.drawAntibodies).
  drawAntibodies(antibodies, _t, ts) {
    if (!antibodies || antibodies.length === 0) return;
    const gl = this.gl;
    this._growAntibodyBuffer(antibodies.length);
    const data = this._antibodyData;
    const now = (typeof ts === 'number' ? ts : performance.now()) * 0.001;
    let n = 0;
    for (let i = 0; i < antibodies.length; i++) {
      const a = antibodies[i];
      const age = a.maxLife - a.life;
      const lifeRatio = a.life / Math.max(a.maxLife, 1e-3);
      const birth = age < 0.15 ? (0.15 - age) / 0.15 : 0;
      const scale = a.r * (1.0 + 0.6 * birth);
      const alpha = lifeRatio < 0.2 ? lifeRatio / 0.2 : 1;
      if (alpha <= 0) continue;
      const baseAngle = Math.atan2(a.vy, a.vx);
      const ambient = (now * 1.5 + (a.ownerId || 0) * 0.7);
      const angle = baseAngle + Math.sin(ambient) * 0.15;
      const rgb = hexToVec3(a.color || '#ffe14a');
      const j = n * ANTIBODY_INSTANCE_FLOATS;
      data[j]     = a.x;
      data[j + 1] = a.y;
      data[j + 2] = angle;
      data[j + 3] = alpha;
      data[j + 4] = rgb[0];
      data[j + 5] = rgb[1];
      data[j + 6] = rgb[2];
      data[j + 7] = scale;
      n++;
    }
    if (n === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._antibodyInstVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * ANTIBODY_INSTANCE_FLOATS);
    gl.useProgram(this._antibodyProg);
    gl.uniform4f(this._antibodyU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
    gl.uniform2f(this._antibodyU.viewport, this.W, this.H);
    // Slight extra weight in screen space — line widths > 1.0 aren't
    // guaranteed in core WebGL2, but most desktop drivers honour ≤2.
    gl.lineWidth(2);
    gl.bindVertexArray(this._antibodyVao);
    gl.drawArraysInstanced(gl.LINES, 0, 6, n);
    gl.bindVertexArray(null);
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
        gl.uniform4f(this._dashU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
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
    gl.uniform4f(this._markerU.camera, this.camera.scale, this.camera.tx, this.camera.ty, this.camera.rotation);
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

  endFrame() {
    // Walk the post-pin overlay chain (built in beginFrame): each
    // enabled FBO pass reads from _postSource and writes to the
    // other ping-pong RT, then we swap. The last step writes
    // straight to the default framebuffer. Finally the cheap FX
    // blends (noise / vignette / crosshair) composite on top via
    // glBlendFunc — they're not part of the FBO chain.
    const t = this._lastFrameSec || 0;
    const gl = this.gl;
    if (this._postChain && this._postChain.length > 0 && this._postSource) {
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this._bgVao);
      for (let i = 0; i < this._postChain.length; i++) {
        const kind = this._postChain[i];
        const isLast = (i === this._postChain.length - 1);
        const dst = isLast ? null
                           : (this._postSource === this._postRtA ? this._postRtB : this._postRtA);
        const dstFbo = dst ? dst.fbo : null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this._runPostPass(kind, this._postSource.tex, t);
        if (!isLast) this._postSource = dst;
      }
      gl.enable(gl.BLEND);
      gl.bindVertexArray(null);
      // PR #243 unbound TEXTURE0/1 to null here to break the
      // feedback loop on the next frame, but that produced a
      // different INVALID_OPERATION because the bg shader's
      // u_reactorTex / u_tissueTex samplers still required SOME
      // bound texture at their unit. The actual feedback fix
      // lives in drawBackground — a 1×1 dummy is bound to
      // TEXTURE0/1 before each bg pass, which breaks the loop
      // AND keeps the samplers valid. Nothing to do here.
      this._postChain = [];
      this._postSource = null;
      this._sceneFbo = null;
    }
    this._fxOverlayDraw(t);
  }

  // Run a single post-pin chain step. Reads from `srcTex` (the
  // ping-pong source RT bound by the caller); writes to whatever
  // framebuffer is currently bound.
  _runPostPass(kind, srcTex, t) {
    const gl = this.gl;
    if (kind === 'ripples' && this._rippleProg) {
      const cellCount = this._rippleCollectCells();
      gl.useProgram(this._rippleProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this._rippleU.bg, 0);
      gl.uniform1f(this._rippleU.time, t);
      gl.uniform2f(this._rippleU.res, this.canvas.width, this.canvas.height);
      gl.uniform1i(this._rippleU.cellCount, cellCount);
      gl.uniform3fv(this._rippleU.cells, this._rippleCellsBuf);
      gl.uniform3f(this._rippleU.params,
                   S.rippleDensity ?? 1.5,
                   S.rippleReach ?? 0.7,
                   S.rippleStrength ?? 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (kind === 'glass' && this._glassProg) {
      const cellCount = this._glassCollectCells();
      gl.useProgram(this._glassProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this._glassU.bg, 0);
      gl.uniform1f(this._glassU.time, t);
      gl.uniform2f(this._glassU.res, this.canvas.width, this.canvas.height);
      gl.uniform1i(this._glassU.cellCount, cellCount);
      gl.uniform3fv(this._glassU.cells, this._glassCellsBuf);
      gl.uniform3f(this._glassU.params,
                   S.glassStrength ?? 1.0,
                   S.glassChroma ? 1.0 : 0.0,
                   S.glassSize ?? 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (kind === 'caustics' && this._causticProg) {
      gl.useProgram(this._causticProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this._causticU.bg, 0);
      gl.uniform1f(this._causticU.time, t);
      gl.uniform2f(this._causticU.res, this.canvas.width, this.canvas.height);
      gl.uniform3f(this._causticU.tint,
                   S.causticTintR ?? 0.0,
                   S.causticTintG ?? 1.35,
                   S.causticTintB ?? 0.5);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (kind === 'sceneFx' && this._sceneFxProg) {
      gl.useProgram(this._sceneFxProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this._sceneFxU.scene, 0);
      gl.uniform2f(this._sceneFxU.res, this.canvas.width, this.canvas.height);
      gl.uniform1f(this._sceneFxU.blurOn,       S.microscopeBlur ? 1 : 0);
      gl.uniform1f(this._sceneFxU.focusRadius,  S.microscopeFocus ?? 0.35);
      gl.uniform1f(this._sceneFxU.blurStrength, S.microscopeBlurStrength ?? 0.5);
      gl.uniform1f(this._sceneFxU.falloff,      S.microscopeFalloff ?? 0.5);
      gl.uniform1f(this._sceneFxU.gradeOn,      S.makeItReal ? 1 : 0);
      gl.uniform1f(this._sceneFxU.hue1,         S.makeItRealHue1 ?? 0.30);
      gl.uniform1f(this._sceneFxU.hue2,         S.makeItRealHue2 ?? 0.55);
      gl.uniform1f(this._sceneFxU.saturation,   S.makeItRealSaturation ?? 0.55);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

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
    if (this._particleProg) gl.deleteProgram(this._particleProg);
    if (this._particleVbo) gl.deleteBuffer(this._particleVbo);
    if (this._particleVao) gl.deleteVertexArray(this._particleVao);
    if (this._antibodyProg) gl.deleteProgram(this._antibodyProg);
    if (this._antibodyUnitVbo) gl.deleteBuffer(this._antibodyUnitVbo);
    if (this._antibodyInstVbo) gl.deleteBuffer(this._antibodyInstVbo);
    if (this._antibodyVao) gl.deleteVertexArray(this._antibodyVao);
    if (this._metaPolyProg) gl.deleteProgram(this._metaPolyProg);
    if (this._metaBlurProg) gl.deleteProgram(this._metaBlurProg);
    if (this._metaTintProg) gl.deleteProgram(this._metaTintProg);
    if (this._metaPolyVbo) gl.deleteBuffer(this._metaPolyVbo);
    if (this._metaPolyVao) gl.deleteVertexArray(this._metaPolyVao);
    this._metaDestroyPool();
    this._reactorDestroy();
    this._causticDestroy();
    this._sceneFxDestroy();
    this.gl = null;
  }
}
