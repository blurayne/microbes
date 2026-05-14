// Microbes — hand-rolled WebGPU renderer.
//
// Companion to assets/render/webgl2.js — same author, same layering,
// using the WebGPU API + WGSL shaders.
//
// Coverage: instanced SDF disks (round / lobed / rippled / oblong /
// pseudopod / star) with per-type nucleus, membrane, selection ring,
// flash overlay; per-pair metaSplit metaball merge with three
// configurable RT-sizing strategies (S.metaRtMode); per-type
// decorations (spikes / tendrils / flagella / cilia / drips / legs /
// fuzz / Y-receptors); cartoon faces (eyes + mouth, S.cartoon);
// dashed-line target marker + pulsing-circle marker; kill-mode
// particles. Only the debug overlay is still deferred (it's stubbed
// in webgl2.js too — needs a design first).
//
// Async note: WebGPU's adapter + device requests are async, but the
// IRenderer interface's init() is sync. Sub-classes implement
// initAsync() for the real work; app.js's makeRenderer awaits it.

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
const RT_ALPHA_MODE = RT_TRANSLUCENT ? 'premultiplied' : 'opaque';
const RT_CLEAR_A = RT_TRANSLUCENT ? 0.0 : 1.0;

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
//  21      diskAlpha (SPLITTING crossfade)
//  22..23  bump     (vec2: impact-normal x intensity, bump-feedback)
const INSTANCE_FLOATS = 24;
const INSTANCE_STRIDE = INSTANCE_FLOATS * 4;

const BODY_KIND_FLOAT = {
  round: 0, lobed: 1, rippled: 2, oblong: 3, pseudopod: 4, star: 5,
};
const NUC_KIND_FLOAT = {
  none: 0, round: 1, kidney: 2, bilobed: 3, multilobed: 4, 'round-small': 5,
};
const MOUTH_KIND_FLOAT = {
  none: 0, smile: 1, frown: 2, snarl: 3, fangs: 4, tongue: 5, drool: 6,
};

// Cell-shader theme key → integer for the disk WGSL fs_main. Mirrors
// KNOWN_THEME_KEYS in core/state.js + the same map in webgl2.js.
// Unknown values fall back to 0 (legacy) so a stale localStorage entry
// never breaks rendering.
const _WGPU_THEME_IDS = { legacy: 0, microscope: 1, cartoon: 2, kurzgesagt: 3, classic: 4 };
function _wgpuThemeId(key) { return _WGPU_THEME_IDS[key] || 0; }

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
  // (highlightR, highlightG, highlightB, borderThickness)
  highlight: vec4<f32>,
  // (rotation-radians, theme, _, _) — rotation applied in vs_main between
  // scale + translate; theme = cell-shader theme id (0 legacy / 1 microscope /
  // 2 cartoon / 3 kurzgesagt / 4 classic). Read in fs_main only.
  cameraRot: vec4<f32>,
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
  @location(7) diskAlpha: f32,    // SPLITTING crossfade: 0..1 over p ∈ [0.5, 1.0]
  @location(8) bump: vec2<f32>,    // bump-feedback squash axis (impact-normal x intensity, 0..1)
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
  @location(7) diskAlpha: f32,
  @location(8) bump: vec2<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
  let scale = u.cameraVp.x;
  let tx = u.cameraVp.y;
  let ty = u.cameraVp.z;
  let vw = u.cameraVp.w;
  let vh = u.misc.x;
  let rot = u.cameraRot.x;

  // 1.70× r — covers wobbly body extents (up to ~1.30) plus the
  // selection ring (which extends to 1.30 × bodyR).
  let quadR = in.inst.z * 1.70;
  let worldPos = in.inst.xy + in.corner * quadR;
  // Camera transform: scale, then rotate by rot, then translate.
  // Reduces to "worldPos * scale + (tx, ty)" when rot == 0.
  let scaledPos = worldPos * scale;
  let cR = cos(rot);
  let sR = sin(rot);
  let screenPos = vec2<f32>(cR * scaledPos.x - sR * scaledPos.y,
                            sR * scaledPos.x + cR * scaledPos.y)
                + vec2<f32>(tx, ty);
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
  out.diskAlpha = in.diskAlpha;
  out.bump = in.bump;
  return out;
}

// kind packs (matches webgl2 FRAG_DISK):
//   body (0..5) + nucleus (0..5) * 16 + selected (0..1) * 256 + hollow (0..1) * 4096
fn bodyKind(k: f32) -> i32 { return i32((k + 0.5) % 16.0); }
fn nucKind(k: f32)  -> i32 { return i32(((k + 0.5) / 16.0) % 16.0); }
fn isSelected(k: f32) -> i32 { return i32(((k + 0.5) / 256.0) % 16.0); }
fn isHollow(k: f32) -> i32 { return i32(((k + 0.5) / 4096.0) % 2.0); }
fn testKind(k: f32) -> i32 { return i32(((k + 0.5) / 8192.0) % 32.0); }

// Lightweight value-noise + 4-octave fbm + capsule SDF. Mirrors
// FRAG_DISK helpers; same numerical formula as shader-test.
fn cellHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn cellNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(cellHash(i),                     cellHash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(cellHash(i + vec2<f32>(0.0, 1.0)), cellHash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y);
}
fn cellFbm(pIn: vec2<f32>) -> f32 {
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  var p = pIn;
  for (var i: i32 = 0; i < 4; i = i + 1) { v = v + a * cellNoise(p); p = p * 2.03; a = a * 0.5; }
  return v;
}
fn cellCapsule(p: vec2<f32>, ca: vec2<f32>, cb: vec2<f32>, r: f32) -> f32 {
  let pa = p - ca;
  let ba = cb - ca;
  let h  = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

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

// Per-test-kind body silhouette ported from docs/shader-test.html.
// Mirrors webgl2's testShape — see the GLSL comment for the rationale.
fn testShape(uv: vec2<f32>, kindF: f32, time: f32) -> f32 {
  let tk = testKind(kindF);
  let ang = atan2(uv.y, uv.x);
  if (tk == 5) {
    return 1.0
         + 0.10 * cos(ang * 6.0  + time * 0.30)
         + 0.12 * pow(0.5 + 0.5 * cos(ang * 12.0 - time * 0.20), 6.0);
  }
  if (tk == 6) {
    return 1.0 / sqrt(uv.x * uv.x * 0.42 + uv.y * uv.y * 1.55);
  }
  if (tk == 7) {
    return 1.10
         + 0.20 * sin(ang * 3.0 + time * 0.40)
         + 0.10 * sin(ang * 7.0 - time * 0.25);
  }
  if (tk == 8)  { return 0.85 + 0.025 * sin(time * 0.4); }
  if (tk == 9) {
    return 1.15
         + 0.06 * sin(ang * 11.0 + time * 0.50)
         + 0.03 * sin(ang * 23.0 - time * 0.30);
  }
  if (tk == 10) { return 1.0 / sqrt(uv.x * uv.x * 0.72 + uv.y * uv.y * 1.21); }
  if (tk == 11) { return 1.0 + 0.45 * pow(0.5 + 0.5 * cos(ang * 6.0 + time * 0.20), 14.0); }
  if (tk == 13) { return 0.85 + 0.10 * cos(ang * 10.0); }
  if (tk == 17) { return 0.95 + 0.16 * cos(ang * 3.0 + time * 0.40); }
  if (tk == 18) {
    return 1.10
         + 0.18 * sin(ang * 4.0  + time * 0.30)
         + 0.10 * sin(ang * 7.0  - time * 0.50)
         + 0.08 * sin(ang * 11.0 + time * 0.80);
  }
  if (tk == 19) { return 1.05 + 0.13 * pow(0.5 + 0.5 * cos(ang * 4.0 + 0.5), 8.0); }
  if (tk == 20) { return 0.95 + 0.30 * pow(0.5 + 0.5 * cos(ang * 10.0 + time * 0.30), 4.0); }
  return 1.0;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let time = u.misc.y;
  let wobbleAmp = u.misc.z;
  let membraneIntensity = u.misc.w;
  let highlight = u.highlight.xyz;

  let d = length(in.uv);
  // Pick the per-cell silhouette: legacy bodyScale (today's 5-kind
  // dispatch on bodyKind) or the per-test-kind testShape with a small
  // wobble overlay so themed cells still breathe.
  let theme = i32(round(u.cameraRot.y));
  var bodyR: f32;
  if (theme == 0) {
    bodyR = bodyScale(in.uv, in.kind, in.phase, time, wobbleAmp);
  } else {
    // Non-legacy themes — match WebGL2 FRAG_DISK: per-blob-kind amp
    // table + 3-term Fourier wobble, ported from shader-test's
    // membraneFor.
    let ang = atan2(in.uv.y, in.uv.x);
    let tk = testKind(in.kind);
    var kAmp: f32 = 1.0;
    if      (tk == 1)  { kAmp = 1.60; }
    else if (tk == 2)  { kAmp = 0.50; }
    else if (tk == 3)  { kAmp = 0.40; }
    else if (tk == 4)  { kAmp = 0.60; }
    else if (tk == 12) { kAmp = 0.30; }
    else if (tk == 14) { kAmp = 0.25; }
    else if (tk == 15) { kAmp = 0.35; }
    // Wobble + testShape pick up the per-cell freq sign + phase so
    // split children diverge and so same-type cells don't wobble in
    // lockstep. Mirrors WebGL2 FRAG_DISK.
    let dirW = sign(in.phase.z + 1e-6);
    let tt   = time * dirW;
    let phi  = in.phase.x;
    var wob = kAmp * (
      0.045 * sin(ang * 5.0  + tt * 0.60 + phi) +
      0.025 * sin(ang * 9.0  - tt * 0.40 + phi * 1.31) +
      0.015 * sin(ang * 17.0 + tt * 1.10 + phi * 0.71)
    );
    wob = wob * max(0.001, wobbleAmp * in.phase.w);
    bodyR = testShape(in.uv, in.kind, tt) + wob;
  }
  // Bump-feedback squash: compress the silhouette on the impact
  // side and bulge it on the far side. in.bump carries the impact
  // normal x intensity (0..1). When magnitude is ~0 this is a no-op.
  let bumpMag = length(in.bump);
  if (bumpMag > 0.001) {
    let bumpDir = in.bump / bumpMag;
    let along = dot(in.uv / max(1e-4, d), bumpDir);
    bodyR = bodyR * (1.0 - 0.30 * bumpMag * along);
  }
  let sdf = d - bodyR;
  let sel = isSelected(in.kind);

  // Outside the body: glow ring only when selected.
  if (sdf > 0.015) {
    if (sel == 0) { discard; }
    let ringT = sdf / (bodyR * 0.30);
    if (ringT >= 1.0) { discard; }
    let ringA = smoothstep(0.0, 0.20, ringT) * (1.0 - smoothstep(0.65, 1.0, ringT));
    return vec4<f32>(highlight, ringA * in.diskAlpha);
  }

  // Soft body edge AA.
  let bodyA = 1.0 - smoothstep(-0.005, 0.015, sdf);
  if (bodyA <= 0.0) { discard; }

  // Cytoplasm gradient — top-left highlight, body fill toward rim.
  let gradT = clamp(d / max(0.001, bodyR * 0.65), 0.0, 1.0);
  var cyto = mix(in.cytoTop, in.cytoBot, vec3<f32>(gradT));
  let topLift = max(0.0, 0.55 - distance(in.uv, vec2<f32>(-0.30, -0.40))) * 0.65;
  cyto = mix(cyto, in.cytoTop, vec3<f32>(topLift));

  // Non-legacy themes: shader-test cyto texturing — granular fbm
  // subtracted, sheets fbm added, b-cell ER stripes if testKind
  // == 4. Per-cell phase + seed shift the fbm domain + ER phase so
  // every cell renders a unique cyto pattern. Mirrors WebGL2 FRAG_DISK.
  if (theme != 0) {
    let cellOff = vec2<f32>(in.phase.y * 1.31, in.phase.y * 0.83 + in.phase.x);
    let granular = cellFbm(in.uv * 22.0 + cellOff * 7.0
                           + vec2<f32>(time * 0.02, 0.0));
    cyto = cyto - vec3<f32>(0.10, 0.07, 0.08) * granular;
    let sheets = cellFbm(in.uv * 6.0 + cellOff * 2.5
                         - vec2<f32>(time * 0.03, time * 0.02));
    cyto = cyto + vec3<f32>(0.08, 0.04, 0.05) * (sheets - 0.5);
    if (testKind(in.kind) == 4) {
      let er = sin(in.uv.x * 14.0 + in.uv.y * 6.0
                   + time * 0.4 + in.phase.x) * 0.5 + 0.5;
      cyto = cyto + vec3<f32>(0.10, 0.05, 0.07) * (er - 0.5) * 0.6;
    }
  }

  // Donut-hole darkening for cells flagged bodyHollow (RBCs).
  if (isHollow(in.kind) == 1) {
    let holeT = 1.0 - smoothstep(0.0, 0.45, length(in.uv));
    cyto = mix(cyto, in.cytoBot * 0.42, vec3<f32>(holeT * 0.85));
  }

  // Bold membrane band straddling the body edge. Width scales with
  // u.highlight.w (= S.cellBorderThickness) so the slider can take the
  // rim from a slim Canvas2D-parity look up to a bold cartoon outline.
  let bt = max(u.highlight.w, 0.001);
  let outlineMask = smoothstep(-0.06 * bt, -0.01 * bt, sdf)
                  * (1.0 - smoothstep(0.0, 0.015 * bt, sdf))
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

  // Non-legacy themes — per-theme compose. Mirrors webgl2.js
  // FRAG_DISK: distinct cyto/highlight/outline per theme, plus a
  // kurzgesagt neon halo. Cell organelles (nucleus / mito /
  // vesicles) stay visible in every theme — the in-game deviation
  // from test-shader classic's "strip everything" approach.
  var themedCyto = cyto;
  var themedOutline = in.cytoBot * 0.55;
  var outlineOp: f32 = 1.0;
  var haloAdd: f32 = 0.0;
  if (theme == 1) {
    themedOutline = vec3<f32>(0.16, 0.06, 0.18);
    outlineOp = 0.85;
  } else if (theme == 2) {
    themedCyto = clamp(cyto * 1.30, vec3<f32>(0.0), vec3<f32>(1.0));
    let hi = smoothstep(0.16, 0.0, distance(in.uv, vec2<f32>(-0.30, -0.40)));
    themedCyto = themedCyto + vec3<f32>(0.32, 0.30, 0.28) * hi;
    themedOutline = vec3<f32>(0.0);
    outlineOp = 1.0;
  } else if (theme == 3) {
    themedOutline = vec3<f32>(0.95, 0.92, 0.85);
    outlineOp = 0.4;
    haloAdd = pow(smoothstep(0.55, 0.42, length(in.uv)), 2.0);
  } else if (theme == 4) {
    themedCyto = clamp(cyto * 1.35 + vec3<f32>(0.05), vec3<f32>(0.0), vec3<f32>(1.0));
    let hi = smoothstep(0.7, 0.0, distance(in.uv, vec2<f32>(-0.30, -0.40))) * 0.4;
    themedCyto = mix(themedCyto, in.cytoTop, vec3<f32>(hi));
    themedOutline = vec3<f32>(0.04, 0.02, 0.08);
    outlineOp = 1.0;
  }
  var col = themedCyto;
  col = mix(col, nucColor, vec3<f32>(nucleusMask));
  col = mix(col, themedOutline, vec3<f32>(clamp(outlineMask * outlineOp, 0.0, 1.0)));
  if (theme == 3 && d < bodyR) {
    col = col + cyto * 1.6 * haloAdd;
  }

  // Per-test-kind compose overlays (mirror of webgl2 FRAG_DISK):
  // rbc biconcave, virus capsid lattice, dendritic tendril glow,
  // slime hyphae, toxin glow. Active only when u_theme != 0; each
  // is gated on the matching test kind so per-cell cost stays flat
  // for unrelated cells.
  if (theme != 0 && d < bodyR) {
    let tk = testKind(in.kind);
    let insideMask = 1.0 - smoothstep(-0.005, 0.015, sdf);
    if (tk == 16) {
      let bicon = smoothstep(0.45, 0.10, d);
      col = mix(col, col * 0.45, vec3<f32>(bicon * insideMask));
    } else if (tk == 5) {
      // virus — per-cell phase rotates the hex lattice so adjacent
      // virions don't tile.
      let ca = cos(in.phase.x); let sa = sin(in.phase.x);
      let latUv = vec2<f32>(ca * in.uv.x - sa * in.uv.y,
                            sa * in.uv.x + ca * in.uv.y);
      let h = 0.5 + 0.5 * cos(latUv.x * 16.0) * cos(latUv.y * 16.0);
      col = col + vec3<f32>(0.30, 0.20, 0.45) * pow(h, 6.0) * insideMask;
    } else if (tk == 11) {
      // Tendril rotation follows sign(freq) — split-siblings rotate
      // opposite ways from the same starting phase.
      let dirT = sign(in.phase.z + 1e-6);
      let ang = atan2(in.uv.y, in.uv.x);
      let t6  = pow(0.5 + 0.5 * cos(ang * 6.0 + time * 0.20 * dirT + in.phase.x), 14.0);
      col = col + in.cytoBot * t6 * 0.25 * insideMask;
    } else if (tk == 18) {
      let dirH = sign(in.phase.z + 1e-6);
      let ang = atan2(in.uv.y, in.uv.x);
      let lines = pow(abs(cos(ang * 1.5 + time * 0.10 * dirH + in.phase.x)), 50.0);
      let ring  = smoothstep(1.05, 0.80, d) * smoothstep(0.45, 0.65, d);
      col = mix(col, vec3<f32>(0.20, 0.30, 0.05), vec3<f32>(lines * ring * 0.7));
    } else if (tk == 20) {
      let glow = pow(smoothstep(1.05, 0.80, d), 2.0) * smoothstep(0.55, 0.85, d);
      col = col + vec3<f32>(0.55, 0.30, 0.85) * glow;
    }
  }

  // Mitochondria orbits — 8 capsules drifting around the nucleus.
  // Skipped for prokaryotes / virus / spore / anucleate / toxin
  // (matches shader-test's nMito gate).
  if (theme != 0 && d < bodyR) {
    let tk3 = testKind(in.kind);
    let noMito = (tk3 == 5 || tk3 == 6 || tk3 == 8 || tk3 == 13
               || tk3 == 16 || tk3 == 17 || tk3 == 20);
    if (!noMito) {
      var mito: f32 = 1e9;
      // Orbit direction = sign(freq): split-siblings inherit the
      // parent's phase + seed but their freqs have opposite signs,
      // so their mito orbits spin opposite ways from the same start.
      let orbitDir = sign(in.phase.z + 1e-6);
      for (var i: i32 = 0; i < 8; i = i + 1) {
        let fi = f32(i);
        let baseA = fi * 0.7853 + time * 0.08 * orbitDir + in.phase.x;
        let radM  = 0.40 + 0.05 * sin(fi * 1.7 + in.phase.y * 0.21);
        let centre = vec2<f32>(cos(baseA), sin(baseA)) * radM
                   + vec2<f32>(0.015 * sin(time * 1.3 + fi + in.phase.y),
                               0.015 * cos(time * 1.1 + fi * 2.0 + in.phase.y * 0.7));
        let dir = vec2<f32>(cos(baseA + 1.5708), sin(baseA + 1.5708));
        let capLen: f32 = 0.045;
        let dCap = cellCapsule(in.uv,
                               centre - dir * capLen,
                               centre + dir * capLen, 0.018);
        mito = min(mito, dCap);
      }
      let mitoMask = smoothstep(0.004, -0.004, mito);
      col = mix(col, vec3<f32>(0.95, 0.55, 0.30), vec3<f32>(mitoMask * 0.55));
    }
  }

  // Vesicles / granules — mirror of WebGL2 FRAG_DISK pass.
  if (theme != 0 && d < bodyR) {
    let tk4 = testKind(in.kind);
    var vesCount: i32 = 14;
    if      (tk4 == 1)  { vesCount = 16; }
    else if (tk4 == 2)  { vesCount = 16; }
    else if (tk4 == 3)  { vesCount = 6;  }
    else if (tk4 == 4)  { vesCount = 8;  }
    else if (tk4 == 5)  { vesCount = 0;  }
    else if (tk4 == 6)  { vesCount = 16; }
    else if (tk4 == 7)  { vesCount = 10; }
    else if (tk4 == 8)  { vesCount = 4;  }
    else if (tk4 == 9)  { vesCount = 14; }
    else if (tk4 == 10) { vesCount = 16; }
    else if (tk4 == 11) { vesCount = 6;  }
    else if (tk4 == 12) { vesCount = 16; }
    else if (tk4 == 13) { vesCount = 4;  }
    else if (tk4 == 14) { vesCount = 0;  }
    else if (tk4 == 15) { vesCount = 16; }
    else if (tk4 == 16) { vesCount = 0;  }
    else if (tk4 == 17) { vesCount = 8;  }
    else if (tk4 == 18) { vesCount = 12; }
    else if (tk4 == 19) { vesCount = 10; }
    else if (tk4 == 20) { vesCount = 8;  }
    var vesRadius: f32 = 0.012;
    if      (tk4 == 2)  { vesRadius = 0.008; }
    else if (tk4 == 3)  { vesRadius = 0.020; }
    else if (tk4 == 7)  { vesRadius = 0.022; }
    else if (tk4 == 10) { vesRadius = 0.006; }
    else if (tk4 == 12) { vesRadius = 0.010; }
    else if (tk4 == 13) { vesRadius = 0.014; }
    else if (tk4 == 15) { vesRadius = 0.020; }
    else if (tk4 == 20) { vesRadius = 0.014; }
    var vesCol = vec3<f32>(1.0, 0.92, 0.65);
    if      (tk4 == 3)  { vesCol = vec3<f32>(0.75, 0.85, 1.00); }
    else if (tk4 == 6)  { vesCol = vec3<f32>(0.80, 0.90, 0.55); }
    else if (tk4 == 7)  { vesCol = vec3<f32>(0.55, 0.45, 0.30); }
    else if (tk4 == 10) { vesCol = vec3<f32>(0.12, 0.40, 0.25); }
    else if (tk4 == 12) { vesCol = vec3<f32>(0.20, 0.10, 0.55); }
    else if (tk4 == 13) { vesCol = vec3<f32>(0.55, 0.40, 0.10); }
    else if (tk4 == 15) { vesCol = vec3<f32>(1.00, 0.55, 0.30); }
    else if (tk4 == 17) { vesCol = vec3<f32>(0.70, 0.85, 0.45); }
    else if (tk4 == 18) { vesCol = vec3<f32>(0.60, 0.75, 0.20); }
    else if (tk4 == 19) { vesCol = vec3<f32>(0.90, 0.60, 0.20); }
    else if (tk4 == 20) { vesCol = vec3<f32>(1.00, 0.90, 1.00); }
    if (vesCount > 0) {
      var ves: f32 = 1e9;
      // Per-cell seed shifts every vesicle's phase so granule
      // arrangement is unique to each cell. Drift direction follows
      // sign(freq) — split-siblings diverge in opposite rotation.
      let vSeed = in.phase.y;
      let vDir  = sign(in.phase.z + 1e-6);
      for (var j: i32 = 0; j < 16; j = j + 1) {
        if (j >= vesCount) { break; }
        let fj = f32(j);
        let pos = vec2<f32>(
          0.42 * sin(fj * 1.91 + vSeed * 0.71 + time * (0.18 + 0.03 * fj) * vDir),
          0.42 * cos(fj * 2.37 + vSeed * 0.93 + time * (0.21 + 0.02 * fj) * vDir)
        );
        let jit = vec2<f32>(0.008 * sin(time * 3.0 * vDir + fj * 7.0 + vSeed),
                            0.008 * cos(time * 2.6 * vDir + fj * 5.0 + vSeed * 1.3));
        ves = min(ves, length(in.uv - pos - jit) - vesRadius);
      }
      let vesMask = smoothstep(0.003, -0.003, ves);
      col = mix(col, vesCol, vec3<f32>(vesMask * 0.85));
    }
  }

  // Microscope brownian dots — 18 tan specks drifting inside the
  // cell. Per-cell seed (in.phase.y) shifts the constellation so
  // siblings don't show identical dust. Mirror of WebGL2 FRAG_DISK.
  if (theme == 1 && d < bodyR) {
    let dustCol = vec3<f32>(0.18, 0.14, 0.10);
    let dSeed = in.phase.y * 0.013;
    for (var i: i32 = 0; i < 18; i = i + 1) {
      let fi = f32(i);
      let sx = fract(sin((fi + dSeed) * 12.9898) * 43758.5453);
      let sy = fract(sin((fi + dSeed) * 78.2330) * 43758.5453);
      let base = vec2<f32>(sx, sy) * 1.4 - vec2<f32>(0.7);
      let drift = vec2<f32>(0.04 * sin(time * 0.6 + fi * 1.7),
                            0.04 * cos(time * 0.5 + fi * 2.3));
      let dst = length(in.uv - base - drift);
      let dotA = (1.0 - smoothstep(0.012, 0.018, dst)) * 0.55;
      col = mix(col, dustCol, vec3<f32>(dotA));
    }
  }

  // Tap flash — c.flash decays in Sim.update(); fade across 200 ms.
  let flashA = clamp(in.outline.a / 0.2, 0.0, 1.0) * 0.6;
  col = mix(col, vec3<f32>(1.0), vec3<f32>(flashA));

  // Selection brighten — translucent highlight wash inside the cell.
  if (sel == 1) {
    col = mix(col, highlight, vec3<f32>(0.30));
  }

  return vec4<f32>(col, bodyA * in.diskAlpha);
}
`;

// ---------- metaSplit (S.metaSplit) per-pair metaball pass ----------
// Three small WGSL modules (poly fill, separable Gaussian blur, combined
// threshold + radial-gradient tint). Pipeline + RT-pool design mirrors
// the WebGL2 implementation; see render/webgl2.js for the spec.
//
// WebGPU note: @builtin(position) in the fragment stage is in framebuffer
// coords with y INCREASING DOWNWARD (D3D / canvas-top-left convention),
// opposite of WebGL's gl_FragCoord. Texture sample uv (0,0) is also
// top-left. So this WGSL keeps everything in canvas-top-left coords —
// no y-flips needed (compare with the WebGL2 shader which double-flips).
const META_POLY_WGSL = /* wgsl */ `
struct PolyU {
  // (rtSize.xy, rtOrigin.xy)
  size_origin: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: PolyU;

@vertex fn vs_main(@location(0) pos: vec2<f32>) -> @builtin(position) vec4<f32> {
  let rtSize = u.size_origin.xy;
  let rtOrigin = u.size_origin.zw;
  let local = pos - rtOrigin;
  var ndc = (local / rtSize) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  return vec4<f32>(ndc, 0.0, 1.0);
}

@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

const META_BLUR_WGSL = /* wgsl */ `
struct BlurU {
  // (srcSize.xy, dir.xy)
  size_dir: vec4<f32>,
  // (radius, _, _, _)
  rad: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: BlurU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;

@vertex fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0,  1.0),
  );
  return vec4<f32>(corners[vid], 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let srcSize = u.size_dir.xy;
  let dir = u.size_dir.zw;
  let radius = u.rad.x;
  // pos.xy is top-down framebuffer coords. Convert to uv (top-left).
  let uv = pos.xy / srcSize;
  let sigma = max(radius * 0.5, 0.5);
  let twoS2 = 2.0 * sigma * sigma;
  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var i: i32 = -16; i <= 16; i = i + 1) {
    let d = f32(i);
    let mask = step(abs(d), radius);
    let w = exp(-(d * d) / twoS2) * mask;
    sum = sum + textureSample(src, samp, uv + dir * d) * w;
    wsum = wsum + w;
  }
  return sum / max(wsum, 1e-4);
}
`;

const META_TINT_WGSL = /* wgsl */ `
struct TintU {
  // (srcSize.xy, rtOrigin.xy)
  src_origin: vec4<f32>,
  // (canvasSize.xy, midPx.xy)
  canvas_mid: vec4<f32>,
  // (gr, K, outlineMode, outlineWidth)
  gr_k: vec4<f32>,
  // (cytoTop.rgb, _)
  cytoTop: vec4<f32>,
  // (cytoBot.rgb, _)
  cytoBot: vec4<f32>,
  // (outlineColor.rgb, _)
  outlineCol: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: TintU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;

@vertex fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0,  1.0),
  );
  return vec4<f32>(corners[vid], 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let srcSize = u.src_origin.xy;
  let rtOrigin = u.src_origin.zw;
  let midPx = u.canvas_mid.zw;
  let gr = u.gr_k.x;
  let K = u.gr_k.y;
  let outlineMode = i32(u.gr_k.z + 0.5);
  let outlineWidth = u.gr_k.w;
  // pos is canvas-top-left framebuffer coords. Convert to RT-local uv.
  let canvasPxTL = pos.xy;
  let rtLocalTL = canvasPxTL - rtOrigin;
  let uv = rtLocalTL / srcSize;
  let m = textureSample(src, samp, uv);
  let ctr = midPx + vec2<f32>(0.0, -gr * 0.18);
  let r = distance(canvasPxTL, ctr);
  let t = clamp(r / max(gr, 0.001), 0.0, 1.0);
  var col: vec3<f32>;
  var alphaMul: f32;
  if (t < 0.55) {
    col = mix(u.cytoTop.rgb, u.cytoBot.rgb, t / 0.55);
    alphaMul = 1.0;
  } else {
    col = u.cytoBot.rgb;
    alphaMul = 1.0 - (t - 0.55) / 0.45;
  }
  let thresholded = clamp(K * m.a - K * 0.5, 0.0, 1.0);
  let bodyA = thresholded * alphaMul;

  // Edge-mode rim: thin band along the blurred-mask 0.5 contour. sdf
  // and polygon modes draw rims via the decoration line pipeline so
  // this contributes 0.
  var outlineA = 0.0;
  if (outlineMode == 0) {
    outlineA = 1.0 - smoothstep(0.0, max(outlineWidth, 0.001), abs(m.a - 0.5));
  }
  let finalRGB = mix(col, u.outlineCol.rgb, outlineA);
  let finalA = max(bodyA, outlineA);
  return vec4<f32>(finalRGB, finalA);
}
`;

// ---------- Target marker: dashed lines from selected cells -----------
// Mirrors webgl2.js's VERT_DASH / FRAG_DASH. Each line vertex carries
// (worldX, worldY, distAlongLine_in_screenPx); the fragment shader
// dashes by `mod(dist + offset, 14) > 8 ? discard : white`. dashOffset
// scrolls negatively over time so the pattern marches forward.
const DASH_WGSL = /* wgsl */ `
struct DashU {
  cam: vec4<f32>,        // (scale, tx, ty, _)
  vp_dash: vec4<f32>,    // (viewportW, viewportH, dashOffset, alpha)
};
@group(0) @binding(0) var<uniform> u: DashU;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) dist: f32,
};

@vertex fn vs_main(
  @location(0) pos: vec2<f32>,
  @location(1) dist: f32,
) -> VsOut {
  let camScale = u.cam.x;
  let camT = u.cam.yz;
  let vp = u.vp_dash.xy;
  // Camera transform: scale, rotate by cam.w, then translate.
  // Reduces to "pos * camScale + camT" when rotation == 0.
  let pScaled = pos * camScale;
  let cR = cos(u.cam.w);
  let sR = sin(u.cam.w);
  let screenPos = vec2<f32>(cR * pScaled.x - sR * pScaled.y,
                            sR * pScaled.x + cR * pScaled.y) + camT;
  var clip = (screenPos / vp) * 2.0 - 1.0;
  clip.y = -clip.y;
  var out: VsOut;
  out.pos = vec4<f32>(clip, 0.0, 1.0);
  out.dist = dist;
  return out;
}

@fragment fn fs_main(@location(0) dist: f32) -> @location(0) vec4<f32> {
  let dashOffset = u.vp_dash.z;
  let alpha = u.vp_dash.w;
  // Euclidean mod via fract so negative dashOffset wraps correctly.
  let m = 14.0 * fract((dist + dashOffset) / 14.0);
  if (m > 8.0) { discard; }
  return vec4<f32>(1.0, 1.0, 1.0, alpha);
}
`;

// ---------- Target marker: pulsing-circle quad ----------
// Mirrors webgl2.js's VERT_MARKER / FRAG_MARKER. Reuses the existing
// 6-vertex unit-square corner buffer; the vertex shader scales the
// quad to (markerWorld + corner * scaledRadius), the fragment shader
// composes inner-dot + expanding ring band with smoothstep edges.
const MARKER_WGSL = /* wgsl */ `
struct MarkerU {
  cam: vec4<f32>,         // (scale, tx, ty, _)
  vp_pos: vec4<f32>,      // (viewportW, viewportH, markerX, markerY)
  cfg: vec4<f32>,         // (scaledRadius, age, innerNorm, ringNorm)
  half: vec4<f32>,        // (ringHalfPx, _, _, _)
};
@group(0) @binding(0) var<uniform> u: MarkerU;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex fn vs_main(@location(0) corner: vec2<f32>) -> VsOut {
  let camScale = u.cam.x;
  let camT = u.cam.yz;
  let vp = u.vp_pos.xy;
  let mWorld = u.vp_pos.zw;
  let r = u.cfg.x;
  let worldPos = mWorld + corner * r;
  // Camera transform: scale, rotate by cam.w, then translate.
  // Reduces to "worldPos * camScale + camT" when rotation == 0.
  let wScaled = worldPos * camScale;
  let cR = cos(u.cam.w);
  let sR = sin(u.cam.w);
  let screenPos = vec2<f32>(cR * wScaled.x - sR * wScaled.y,
                            sR * wScaled.x + cR * wScaled.y) + camT;
  var clip = (screenPos / vp) * 2.0 - 1.0;
  clip.y = -clip.y;
  var out: VsOut;
  out.pos = vec4<f32>(clip, 0.0, 1.0);
  out.uv = corner;
  return out;
}

@fragment fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let age = u.cfg.y;
  let innerNorm = u.cfg.z;
  let ringNorm = u.cfg.w;
  let ringHalfPx = u.half.x;
  let d = length(uv);
  let fade = 1.0 - age;
  let dotA = 1.0 - smoothstep(innerNorm * 0.92, innerNorm * 1.05, d);
  let ringA = 1.0 - smoothstep(ringHalfPx, ringHalfPx * 1.4, abs(d - ringNorm));
  let a = max(dotA, ringA) * fade;
  if (a <= 0.0) { discard; }
  return vec4<f32>(1.0, 1.0, 1.0, a);
}
`;

// ---- Reactor (Gray-Scott) shaders ---------------------------------
// WGSL ports of FRAG_REACTOR_STEP / FRAG_REACTOR_SEED in webgl2.js.
// Two RGBA8 textures ping-pong each iteration; encoding stores
// (A * 0.05, B, 0, 1) so both concentrations fit in 0..1.

const REACTOR_STEP_WGSL = /* wgsl */ `
struct StepU {
  // (resolutionX, resolutionY, _, _) — RT pixel size for the laplacian.
  res: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: StepU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;

fn readConc(uv: vec2<f32>) -> vec2<f32> {
  return textureSample(src, samp, uv).rg / vec2<f32>(0.05, 1.0);
}

fn lapConc(uv: vec2<f32>) -> vec2<f32> {
  let du = 1.0 / u.res.x;
  let dv = 1.0 / u.res.y;
  var lap = -readConc(uv);
  lap = lap + 0.20 * readConc(uv + vec2<f32>(-du,  0.0));
  lap = lap + 0.20 * readConc(uv + vec2<f32>( du,  0.0));
  lap = lap + 0.20 * readConc(uv + vec2<f32>( 0.0, -dv));
  lap = lap + 0.20 * readConc(uv + vec2<f32>( 0.0,  dv));
  lap = lap + 0.05 * readConc(uv + vec2<f32>(-du, -dv));
  lap = lap + 0.05 * readConc(uv + vec2<f32>( du, -dv));
  lap = lap + 0.05 * readConc(uv + vec2<f32>( du,  dv));
  lap = lap + 0.05 * readConc(uv + vec2<f32>(-du,  dv));
  return lap;
}

@vertex fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0,  1.0),
  );
  return vec4<f32>(corners[vid], 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / u.res.xy;
  let D_A = 0.8;
  let D_B = 0.4;
  let feed = 0.06 * uv.x;
  let kill = 0.035 + 0.03 * uv.x + (0.022 - 0.015 * uv.x) * uv.y;
  let c   = readConc(uv);
  let lap = lapConc(uv);
  let dA = D_A * lap.x - c.x * c.y * c.y + feed * (1.0 - c.x);
  let dB = D_B * lap.y + c.x * c.y * c.y - (kill + feed) * c.y;
  let cN = c + vec2<f32>(dA, dB);
  return vec4<f32>(cN * vec2<f32>(0.05, 1.0), 0.0, 1.0);
}
`;

const REACTOR_MAX_SEEDS_WGPU = 8;
const REACTOR_SEED_WGSL = /* wgsl */ `
struct SeedU {
  // (resolutionX, resolutionY, seedCount, _)
  res_count: vec4<f32>,
  // Up to 8 discs; (cx, cy, r, _) in UV space. vec4 stride satisfies
  // WGSL's 16-byte uniform-array element alignment.
  seeds: array<vec4<f32>, ${REACTOR_MAX_SEEDS_WGPU}>,
};
@group(0) @binding(0) var<uniform> u: SeedU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;

@vertex fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0,  1.0),
  );
  return vec4<f32>(corners[vid], 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / u.res_count.xy;
  let srcCol = textureSample(src, samp, uv);
  var c = srcCol.rg / vec2<f32>(0.05, 1.0);
  let count = i32(u.res_count.z);
  for (var i: i32 = 0; i < ${REACTOR_MAX_SEEDS_WGPU}; i = i + 1) {
    if (i >= count) { break; }
    let seed = u.seeds[i];
    if (length(uv - seed.xy) < seed.z) {
      c.y = max(c.y, 0.9);
    }
  }
  return vec4<f32>(c * vec2<f32>(0.05, 1.0), 0.0, 1.0);
}
`;


// ---------- Background: gradient + spots + drifting RBC silhouettes ----
// Mirrors webgl2.js FRAG_BG (lines 249-340) bit-for-bit. One uniform
// buffer carries kind/vignette/grid/time + camera + viewport +
// spot/RBC flags + 5 colour vec4s + 8 spot vec4s + 8 spot-colour vec4s.
// Vertex shader is the canonical big-triangle (3 verts cover the clip
// rect) so no VBO is needed.
const MAX_SPOTS = 8;

// Caustics overlay post-process. The bg pass can render to an
// offscreen texture; this pass samples that texture at uv displaced
// by an animated water-turbulence pattern + multiplies by a
// green/teal tint. Adapted from "Tileable Water Caustic" by David
// Hoskins (https://www.shadertoy.com/view/ltSczG · CC BY-NC-SA 3.0).
// Same maths as PR #73's shader-test path.
const CAUSTIC_BG_WGSL = /* wgsl */ `
struct CausticU {
  // (time, _, _, _) header; tint is vec4 for 16-byte alignment.
  hdr:  vec4<f32>,
  tint: vec4<f32>,
};
@group(0) @binding(0) var<uniform> U : CausticU;
@group(0) @binding(1) var bgSamp : sampler;
@group(0) @binding(2) var bgTex  : texture_2d<f32>;

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  // Big-triangle fullscreen pattern: 3 verts covering the screen.
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let dim = vec2<f32>(textureDimensions(bgTex, 0));
  let uv  = frag.xy / dim;
  let TAU: f32 = 6.28318530718;
  // Tile the caustic across the screen, aspect-corrected so each cell
  // stays roughly square. Tile factor 3 ⇒ ~3 cells tall, 3*aspect wide.
  let aspect = dim.x / max(1.0, dim.y);
  let cuv = uv * vec2<f32>(aspect, 1.0) * 3.0;
  let time2 = U.hdr.x * 0.5 + 23.0;
  var p0 = ((cuv * TAU) % vec2<f32>(TAU) + vec2<f32>(TAU)) % vec2<f32>(TAU) - vec2<f32>(150.0);
  var i = p0;
  var c: f32 = 1.0;
  let inten: f32 = 0.005;
  for (var n: i32 = 0; n < 5; n = n + 1) {
    let tn = time2 * (1.0 - (3.5 / f32(n + 1)));
    i = p0 + vec2<f32>(cos(tn - i.x) + sin(tn + i.y),
                       sin(tn - i.y) + cos(tn + i.x));
    let denom = vec2<f32>(p0.x / (sin(i.x + tn) / inten),
                          p0.y / (cos(i.y + tn) / inten));
    c = c + 1.0 / max(length(denom), 1e-4);
  }
  c = c / 5.0;
  c = 1.17 - pow(c, 1.4);
  let shade = pow(abs(c), 8.0);
  let tint = clamp((vec3<f32>(shade) + U.tint.rgb) * 2.0,
                   vec3<f32>(0.0), vec3<f32>(1.0));
  let off = vec2<f32>(cos(c) - 0.75, sin(c) - 0.75) * 0.04;
  let sampleUv = clamp(uv + off, vec2<f32>(0.0), vec2<f32>(1.0));
  let bg = textureSample(bgTex, bgSamp, sampleUv).rgb;
  return vec4<f32>(bg * tint, 1.0);
}
`;

// Microscope FX post-pass — mirror of webgl2.js FRAG_SCENE_FX.
// 16-tap Poisson bokeh blur + 2-stop RGB gradient grade with radial
// chromatic aberration. See FRAG_SCENE_FX for the design rationale
// (RGB gradient beats HSV-duotone; +CA gives the microscopy fringe).
const SCENE_FX_WGSL = /* wgsl */ `
struct SceneFxU {
  // (W, H, _, _)
  res:   vec4<f32>,
  // (blurOn, focusRadius, blurStrength, falloff)
  blur:  vec4<f32>,
  // (gradeOn, hue1, hue2, saturation)
  grade: vec4<f32>,
};
@group(0) @binding(0) var<uniform> U : SceneFxU;
@group(0) @binding(1) var sceneSamp : sampler;
@group(0) @binding(2) var sceneTex  : texture_2d<f32>;

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(c.x) + K.xyz) * 6.0 - vec3<f32>(K.w));
  return c.z * mix(vec3<f32>(K.x), clamp(p - vec3<f32>(K.x), vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

@fragment fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let dim = vec2<f32>(textureDimensions(sceneTex, 0));
  let uv  = frag.xy / dim;
  // Aspect-correct radial distance so the focus zone is circular.
  let ndc = uv * 2.0 - vec2<f32>(1.0);
  let aspect = dim.x / max(1.0, dim.y);
  var nd = ndc;
  if (aspect > 1.0) { nd.x = nd.x * aspect; } else { nd.y = nd.y / aspect; }
  let r = length(nd);

  let blurOn       = U.blur.x;
  let focusRadius  = U.blur.y;
  let blurStrength = U.blur.z;
  let falloff      = U.blur.w;
  let gradeOn     = U.grade.x;
  let hue1        = U.grade.y;
  let hue2        = U.grade.z;
  let saturation  = U.grade.w;
  let LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

  // 16-tap Poisson disk. WGSL arrays are const-init-only at module
  // scope; declare inside fn so the compiler can fold the loop.
  var poisson: array<vec2<f32>, 16> = array<vec2<f32>, 16>(
    vec2<f32>( 0.0,  0.0),
    vec2<f32>( 0.50, 0.0),
    vec2<f32>(-0.50, 0.0),
    vec2<f32>( 0.0,  0.50),
    vec2<f32>( 0.0, -0.50),
    vec2<f32>( 0.92,  0.39),
    vec2<f32>(-0.92,  0.39),
    vec2<f32>( 0.92, -0.39),
    vec2<f32>(-0.92, -0.39),
    vec2<f32>( 0.39,  0.92),
    vec2<f32>(-0.39,  0.92),
    vec2<f32>( 0.39, -0.92),
    vec2<f32>(-0.39, -0.92),
    vec2<f32>( 0.68,  0.68),
    vec2<f32>(-0.68,  0.68),
    vec2<f32>( 0.68, -0.68),
  );

  var col: vec3<f32>;
  if (blurOn > 0.5 && blurStrength > 0.001) {
    let beyond = clamp((r - focusRadius) / max(1e-3, 1.0 - focusRadius), 0.0, 1.0);
    let curve  = mix(1.2, 5.0, falloff);
    let blurAmt = pow(beyond, curve);
    let minDim  = min(dim.x, dim.y);
    let blurRadius = blurStrength * 0.12 * minDim * blurAmt;
    if (blurRadius < 0.5) {
      col = textureSample(sceneTex, sceneSamp, uv).rgb;
    } else {
      let px = vec2<f32>(blurRadius) / dim;
      var sum = vec3<f32>(0.0);
      for (var i: i32 = 0; i < 16; i = i + 1) {
        sum = sum + textureSample(sceneTex, sceneSamp, uv + poisson[i] * px).rgb;
      }
      col = sum / 16.0;
    }
  } else {
    col = textureSample(sceneTex, sceneSamp, uv).rgb;
  }

  if (gradeOn > 0.5) {
    let toCtr = uv - vec2<f32>(0.5);
    let caAmt = 0.006 * dot(toCtr, toCtr) * 4.0;
    let Rc = textureSample(sceneTex, sceneSamp, uv - toCtr * caAmt).r;
    let Bc = textureSample(sceneTex, sceneSamp, uv + toCtr * caAmt).b;
    let src = vec3<f32>(Rc, col.g, Bc);
    let shadowAnchor    = hsv2rgb(vec3<f32>(hue1, saturation, 0.18));
    let highlightAnchor = hsv2rgb(vec3<f32>(hue2, saturation, 0.92));
    let Y = clamp(dot(src, LUMA), 0.0, 1.0);
    let t = smoothstep(0.05, 0.95, Y);
    let graded = mix(shadowAnchor, highlightAnchor, t);
    col = mix(graded, src, 0.15);
  }

  return vec4<f32>(col, 1.0);
}
`;

// Liquid-ripples post-process. Mirror of FRAG_RIPPLE_BG. Each cell
// is packed as vec4(uvX, uvY, uvR, _); WGSL pads vec3 arrays to
// vec4 anyway, so explicit vec4 keeps the JS-side layout simple.
const RIPPLE_MAX_WGPU = 24;
const GLASS_MAX_WGPU = 24;

// Glass-membrane lensing overlay. Mirrors RIPPLE_BG_WGSL's
// scene-FBO sampling + per-cell iteration, but the displacement
// is a half-sine lens peak in a thin band JUST OUTSIDE each cell
// (0.85*r .. 1.15*r). Chromatic split (RGB sampled at slightly
// different displacements) is gated by `params.y`.
const GLASS_BG_WGSL = /* wgsl */ `
struct GlassU {
  header: vec4<f32>,        // (time, cellCount, resW, resH)
  params: vec4<f32>,        // (strength, chroma, size, _)
  cells:  array<vec4<f32>, ${GLASS_MAX_WGPU}>,
};
@group(0) @binding(0) var<uniform> U : GlassU;
@group(0) @binding(1) var bgSamp : sampler;
@group(0) @binding(2) var bgTex  : texture_2d<f32>;

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = vec2<f32>(U.header.z, U.header.w);
  let uv  = frag.xy / res;
  var disp = vec2<f32>(0.0, 0.0);
  let minAx = min(res.x, res.y);
  let n = i32(U.header.y + 0.5);
  let strength = U.params.x;
  let chroma   = U.params.y;
  let size     = max(U.params.z, 0.01);
  let halfBand = 0.15 * size;
  for (var i: i32 = 0; i < ${GLASS_MAX_WGPU}; i = i + 1) {
    if (i >= n) { break; }
    let c = U.cells[i];
    let dvUv = uv - c.xy;
    let dvPx = dvUv * res;
    let dPx  = length(dvPx);
    let rPx  = max(c.z * minAx, 4.0);
    let lo   = rPx * (1.0 - halfBand);
    let hi   = rPx * (1.0 + halfBand);
    if (dPx < lo || dPx > hi) { continue; }
    let t = (dPx - lo) / max(1e-4, hi - lo);
    let lens = sin(t * 3.14159);                     // peak mid-band
    let normal = dvUv / max(1e-4, length(dvUv));
    disp = disp + normal * lens;
  }
  let baseDisp = disp * (8.0 / minAx) * strength;
  if (chroma > 0.5) {
    // Prism-edge: sample R/G/B at slightly different displacements.
    let uvR = clamp(uv + baseDisp * 0.85, vec2<f32>(0.0), vec2<f32>(1.0));
    let uvG = clamp(uv + baseDisp * 1.00, vec2<f32>(0.0), vec2<f32>(1.0));
    let uvB = clamp(uv + baseDisp * 1.15, vec2<f32>(0.0), vec2<f32>(1.0));
    let r = textureSample(bgTex, bgSamp, uvR).r;
    let g = textureSample(bgTex, bgSamp, uvG).g;
    let b = textureSample(bgTex, bgSamp, uvB).b;
    return vec4<f32>(r, g, b, 1.0);
  }
  let uvD = clamp(uv + baseDisp, vec2<f32>(0.0), vec2<f32>(1.0));
  let rgb = textureSample(bgTex, bgSamp, uvD).rgb;
  return vec4<f32>(rgb, 1.0);
}
`;
const RIPPLE_BG_WGSL = /* wgsl */ `
struct RippleU {
  // Header (16 bytes — 4 floats):
  time: f32,
  cellCount: f32,
  resW: f32,
  resH: f32,
  // Tunables (16 bytes — vec4 alignment):
  params: vec4<f32>,        // (density, reach, strength, _)
  cells: array<vec4<f32>, ${RIPPLE_MAX_WGPU}>,
};
@group(0) @binding(0) var<uniform> U : RippleU;
@group(0) @binding(1) var bgSamp : sampler;
@group(0) @binding(2) var bgTex  : texture_2d<f32>;

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = vec2<f32>(U.resW, U.resH);
  let uv  = frag.xy / res;
  var disp = vec2<f32>(0.0, 0.0);
  let minAx = min(res.x, res.y);
  let n = i32(U.cellCount + 0.5);
  let density  = max(U.params.x, 0.001);
  let reach    = max(U.params.y, 0.001);
  let strength = U.params.z;
  for (var i: i32 = 0; i < ${RIPPLE_MAX_WGPU}; i = i + 1) {
    if (i >= n) { break; }
    let c = U.cells[i];
    let dvUv = uv - c.xy;
    let dvPx = dvUv * res;
    let dPx  = length(dvPx);
    let rPx  = max(c.z * minAx, 4.0);
    if (dPx > rPx * 8.0 * reach) { continue; }
    let wavelen = rPx * 0.7 / density;
    let k = 6.28318 / wavelen;
    let wave = sin(dPx * k - U.time * (wavelen * 1.5) * k);
    let falloff = exp(-dPx / (rPx * 4.0 * reach));
    let dirUv = dvUv / max(1e-4, length(dvUv));
    disp = disp + dirUv * wave * falloff;
  }
  let uvDisp = disp * (6.0 / minAx) * strength;
  let bg = textureSample(bgTex, bgSamp,
                         clamp(uv + uvDisp, vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
  return vec4<f32>(bg, 1.0);
}
`;

// FX overlay shader (mirrors webgl2.js FRAG_FX_OVERLAY). One shader,
// three effects, three blend modes — the pipeline cache below uses
// pre-baked blend states per (mode) since WebGPU pipelines bake
// blend state at creation time.
const FX_OVERLAY_WGSL = /* wgsl */ `
struct FxU {
  // (resW, resH, time, intensity)
  v0: vec4<f32>,
  // (effect, mode, _, _)
  v1: vec4<f32>,
};
@group(0) @binding(0) var<uniform> U : FxU;

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn fxHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = vec2<f32>(U.v0.x, U.v0.y);
  let time = U.v0.z;
  let intensity = U.v0.w;
  let effect = i32(U.v1.x + 0.5);
  let mode   = i32(U.v1.y + 0.5);
  var effectCol = vec3<f32>(0.0);
  var effectMask: f32 = 1.0;
  if (effect == 1) {
    let g = fxHash(frag.xy + vec2<f32>(time * 31.7, time * 17.3));
    effectCol = vec3<f32>(g);
  } else if (effect == 2) {
    // Aspect-corrected radial distance — true 1:1 circle, matches
    // the crosshair overlay circle (PR #144). Without correction
    // the falloff was elliptical on widescreen.
    let uv = frag.xy / res;
    var ndc = uv * 2.0 - vec2<f32>(1.0);
    let aspectV = res.x / max(1.0, res.y);
    if (aspectV > 1.0) { ndc.x = ndc.x * aspectV; } else { ndc.y = ndc.y / aspectV; }
    let r = length(ndc);
    effectCol = vec3<f32>(0.05, 0.10, 0.20);
    effectMask = pow(smoothstep(0.6, 1.0, r), 2.0);
  } else {
    // Crosshair — cyan ring + cross. Sets effectCol + effectMask and
    // falls through to the regular mode==1 (normal-blend) return
    // below. An earlier version used an early return inside this
    // else arm; that produced an invisible crosshair on WebGPU
    // (some WGSL to SPIR-V compilers appeared to zero the output
    // when a return lived inside an else branch), while WebGL2's
    // GLSL compiler handled the same shape fine.
    let px = frag.xy - res * 0.5;
    let armLen: f32 = 14.0;
    let thick: f32  = 1.0;
    let ringR: f32  = min(res.x, res.y) * 0.475;
    let horiz = select(0.0, 1.0, abs(px.y) < thick && abs(px.x) < armLen);
    let vert  = select(0.0, 1.0, abs(px.x) < thick && abs(px.y) < armLen);
    let ring  = select(0.0, 0.6, abs(length(px) - ringR) < thick);
    let a = max(max(horiz, vert), ring);
    effectCol  = vec3<f32>(0.42, 0.95, 1.0);
    effectMask = a * 0.6;
  }
  let s = intensity * effectMask;
  if (mode == 1) {
    return vec4<f32>(effectCol, s);
  } else if (mode == 2) {
    return vec4<f32>(vec3<f32>(1.0) - effectCol * s, 1.0);
  }
  return vec4<f32>(effectCol * s, 1.0);
}
`;

const BG_WGSL = /* wgsl */ `
struct BgU {
  // (kind, vignette, gridStep, time)
  misc: vec4<f32>,
  // (camera.scale, camera.tx, camera.ty, camera.rotation) — .w is
  // rotation in radians, consumed by cRBg/sRBg in fs_main so the bg
  // pattern follows pinch-rotation. It is NOT bgScale (earlier bug,
  // pre-fix). bgScale lives in extra.y so the two values don't
  // collide on the same component.
  cam: vec4<f32>,
  // (viewportW, viewportH, spotCount, rbcOn)
  vp: vec4<f32>,
  // Per-layer extras: x=opacity (0..1), y=bgScale (1.0 = default,
  // floor 0.05 at the shader), zw reserved.
  extra: vec4<f32>,
  base: vec4<f32>,
  top: vec4<f32>,
  bot: vec4<f32>,
  ringColor: vec4<f32>,
  gridColor: vec4<f32>,
  spots: array<vec4<f32>, ${MAX_SPOTS}>,
  spotCols: array<vec4<f32>, ${MAX_SPOTS}>,
};
@group(0) @binding(0) var<uniform> u: BgU;
// Reactor display: only sampled when kind == 8. For every other kind a
// 1x1 dummy texture is bound (WebGPU validation requires the bind-group
// to be complete; the shader simply doesn't sample it for kinds 0-7).
@group(0) @binding(1) var reactorSamp: sampler;
@group(0) @binding(2) var reactorTex: texture_2d<f32>;
// Tissue (image-tiled) bg: only sampled when kind == 11. A 1x1
// dummy is bound otherwise so the bind-group stays complete.
@group(0) @binding(3) var tissueSamp: sampler;
@group(0) @binding(4) var tissueTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VsOut {
  // Big-triangle fullscreen pattern.
  //   i=0 -> (-1,-1);  i=1 -> ( 3,-1);  i=2 -> (-1, 3)
  var p: vec2<f32>;
  if (i == 0u) { p = vec2<f32>(-1.0, -1.0); }
  else if (i == 1u) { p = vec2<f32>( 3.0, -1.0); }
  else              { p = vec2<f32>(-1.0,  3.0); }
  var out: VsOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  // uv in canvas convention: v=0 at TOP of the canvas, v=1 at bottom.
  // Cells render in canvas coords (y=0 at top); the bg shader's worldPx
  // reconstruction multiplies uv by the viewport, so uv must use the
  // same y direction as the cell shader or the bg pans opposite to
  // cells in y. The flip is free here; downstream worldPx, gradient,
  // spots and RBC all inherit it. Mirrors webgl2.js VERT_FULLSCREEN.
  out.uv  = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

// ---------- Helper noise for procedural bgs (kinds 4-7) ----------
fn bgHash(p_in: vec2<f32>) -> f32 {
  var p = fract(p_in * vec2<f32>(123.34, 345.45));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(34.345, 34.345)));
  return fract(p.x * p.y);
}
fn bgNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec2<f32>(3.0, 3.0) - 2.0 * f);
  return mix(mix(bgHash(i),                        bgHash(i + vec2<f32>(1.0, 0.0)), u.x),
             mix(bgHash(i + vec2<f32>(0.0, 1.0)),  bgHash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn bgFbm(p_in: vec2<f32>) -> f32 {
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  var p = p_in;
  for (var i: i32 = 0; i < 3; i = i + 1) { v = v + a * bgNoise(p); p = p * 2.0; a = a * 0.5; }
  return v;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let kind = i32(u.misc.x + 0.5);
  let vignette = u.misc.y;
  let gridStep = u.misc.z;
  let time = u.misc.w;
  let camScale = u.cam.x;
  let camTx = u.cam.y;
  let camTy = u.cam.z;
  let viewport = u.vp.xy;
  let spotCount = i32(u.vp.z + 0.5);
  let rbcOn = i32(u.vp.w + 0.5);
  // Background-size slider — multiplier on every bg feature
  // size (ring stride, grid step, spot radii, RBC silhouettes).
  // Floored at 0.05 so the slider's 0 endpoint doesn't collapse
  // strides; at the floor features are ~20× bigger than baseline.
  let bgS = max(u.extra.y, 0.05);

  var col = u.base.rgb;
  if (kind == 1) {
    col = mix(u.top.rgb, u.bot.rgb, uv.y);
  }

  // World-space pixel.
  let screenPx = uv * viewport;
  // Inverse camera transform (screen → world): un-translate, un-rotate, un-scale.
  let dCam = screenPx - vec2<f32>(camTx, camTy);
  let cRBg = cos(u.cam.w);
  let sRBg = sin(u.cam.w);
  let worldPx = vec2<f32>(cRBg * dCam.x + sRBg * dCam.y,
                          -sRBg * dCam.x + cRBg * dCam.y) / max(camScale, 0.0001);

  // Petri-dish concentric rings — 1px thin at every 32*bgS world units.
  if (kind == 2) {
    let ctr = viewport * 0.5;
    let r = length(worldPx - ctr);
    let stride = 32.0 * bgS;
    let nearestRing = floor(r / stride + 0.5) * stride;
    let dToRing = abs(r - nearestRing);
    let pxWorld = 1.0 / max(camScale, 0.0001);
    let band = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.5, dToRing);
    col = mix(col, u.ringColor.rgb, band * 0.18);
  }

  // Cyber grid — thin lines every gridStep*bgS world units in both axes.
  if (kind == 3) {
    let gStep = gridStep * bgS;
    let g = worldPx - floor(worldPx / gStep) * gStep;
    let dToLine = min(g, vec2<f32>(gStep, gStep) - g);
    let pxWorld = 1.0 / max(camScale, 0.0001);
    let lineX = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.x);
    let lineY = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.y);
    let line = max(lineX, lineY);
    col = mix(col, u.gridColor.rgb, line * 0.30);
  }

  // Lung — Smoke FBM port (Apache 2.0, FatumR). See WebGL2 comment.
  // hot/cool ramp reads u.top.rgb / u.bot.rgb so the picker actually
  // drives the smoke palette. Default state colours match the previous
  // hard-coded stops.
  if (kind == 4) {
    // 0.00714 — re-tuned to 0.7× current (was 0.0050).
    let plungP = worldPx * 0.00714 + vec2<f32>(0.0, time * 0.08);
    let breath = 0.55 + 0.20 * sin(time * 0.6);
    let n0 = bgFbm(plungP * 0.5);
    let n1 = bgFbm(plungP + vec2<f32>(2.0 * n0));
    let n2 = bgFbm(plungP + vec2<f32>(n1));
    let n3 = bgFbm(plungP + vec2<f32>(time * 0.04, 0.0) + vec2<f32>(n2));
    let v = breath * n3;
    col = mix(col, mix(u.top.rgb, u.bot.rgb, clamp(v, 0.0, 1.0)), vec3<f32>(0.85));
  }

  // ---- Bloodflow (kind 9): shader-test bloodflow default port. ----
  // Colour ramp reads u.bot → u.top → 1.5×u.top so the in-app
  // picker actually drives the look. Default state colours are
  // calibrated to match the previous hard-coded ramp.
  if (kind == 9) {
    // 0.012 — bloodflow 0.1× (features 10× smaller than original).
    let bfP = worldPx * 0.012 + vec2<f32>(time * 0.04, time * 0.03);
    let bfN = bgFbm(bfP);
    let bfRbc = bgFbm(worldPx * 0.0030 + vec2<f32>(0.0, time * 0.15));
    let bfHi = clamp(u.top.rgb * 1.5, vec3<f32>(0.0), vec3<f32>(1.0));
    var bfBase = mix(u.bot.rgb, u.top.rgb, vec3<f32>(bfN));
    bfBase = mix(bfBase, bfHi, vec3<f32>(smoothstep(0.55, 0.75, bfRbc) * 0.5));
    col = mix(col, bfBase, vec3<f32>(0.85));
  }
  // ---- Cell shadow (kind 10): voronoi port. CC BY-NC-SA 3.0. ----
  if (kind == 10) {
    let csSt = worldPx * 0.005;
    let csCellPos   = floor(csSt);
    let csCellCoord = fract(csSt);
    var csSum: f32 = 0.0;
    for (var ix: i32 = -1; ix <= 1; ix = ix + 1) {
      for (var iy: i32 = -1; iy <= 1; iy = iy + 1) {
        let nb = vec2<f32>(f32(ix), f32(iy));
        let h0 = bgHash(csCellPos + nb);
        let h1 = bgHash(csCellPos + nb + vec2<f32>(17.3, 41.7));
        let nbPos = vec2<f32>(0.5) + vec2<f32>(0.5) * sin(time * 0.4 + vec2<f32>(h0, h1) * 6.0);
        let diff = (nb + nbPos) - csCellCoord;
        csSum = csSum + exp(-32.0 * dot(diff, diff));
      }
    }
    let csV = -(1.0 / 32.0) * log(max(csSum, 1e-6));
    let csIntensity = 0.03 / pow(max(1.2 - sqrt(max(csV, 0.0)), 0.05), 3.0);
    // csBaseCol reads u.base.rgb so the picker drives the voronoi
    // tint. Default state base (#c83245) matches the previous
    // hard-coded colour vec3(200/255, 50/255, 69/255).
    col = mix(col, clamp(u.base.rgb * csIntensity, vec3<f32>(0.0), vec3<f32>(2.0)), vec3<f32>(0.95));
  }
  // ---- Aurora borealis: vertical green/violet ribbons (kind 5) ----
  // Hue oscillates between u.top.rgb and u.bot.rgb over time —
  // defaults match the previous hard-coded green (0.24,0.95,0.52) /
  // violet (0.55,0.35,0.95).
  if (kind == 5) {
    let sky = vec2<f32>(worldPx.x * 0.0015, worldPx.y * 0.001 - time * 0.05);
    let warp = bgFbm(vec2<f32>(sky.x, time * 0.08));
    var ribbon = 0.5 + 0.5 * sin(sky.y * 6.2831 + warp * 6.2831);
    ribbon = pow(ribbon, 4.0);
    let bandH = exp(-pow((sky.y - 0.5) * 1.5, 2.0));
    let hue = mix(u.top.rgb, u.bot.rgb, 0.5 + 0.5 * sin(warp * 3.14159 + time * 0.2));
    col = mix(col, hue, vec3<f32>(ribbon * bandH * 0.85));
  }

  // ---- Underwater: caustic interference (kind 6) ----
  // u.bot.rgb is the deep wash, u.top.rgb is the bright caustic
  // peak — defaults match the previous hard-coded deep
  // (0.04,0.16,0.30) / bright (0.60,0.95,1.00).
  if (kind == 6) {
    let p = worldPx * 0.04;
    let w1 = sin(p.x + time * 0.6 + sin(p.y * 0.75));
    let w2 = sin(p.y * 0.95 + time * 0.85 + sin(p.x * 0.85));
    let c = pow(max(0.0, (w1 + w2) * 0.5 + 0.5), 6.0);
    col = mix(col, u.bot.rgb, vec3<f32>(0.70));
    col = mix(col, u.top.rgb, vec3<f32>(c * 0.55));
  }

  // ---- Lava / fire: boiling fbm (kind 7) ----
  // Hot gradient: base → bot → top → peak (clamped 2×u.top) so the
  // picker drives all the hot tendrils. Default state colours match
  // the previous hard-coded ramp.
  if (kind == 7) {
    var p = worldPx * 0.005;
    p.y = p.y - time * 1.2;
    let n = bgFbm(p + vec2<f32>(bgFbm(p * 0.5 + vec2<f32>(time * 0.05, time * 0.05))));
    let peak = clamp(u.top.rgb * 2.0, vec3<f32>(0.0), vec3<f32>(1.0));
    var hot = mix(u.base.rgb, u.bot.rgb, smoothstep(0.20, 0.45, n));
    hot     = mix(hot,       u.top.rgb, smoothstep(0.45, 0.70, n));
    hot     = mix(hot,       peak,      smoothstep(0.70, 0.95, n));
    col = mix(col, hot, 0.85);
  }

  // Ambient drifting wash for the otherwise-static kinds (flat,
  // gradient, agar, cybergrid). Mirrors WebGL2 FRAG_BG.
  if (kind <= 3) {
    let ambP = worldPx * 0.0009 + vec2<f32>(time * 0.025, time * 0.012);
    let amb = bgFbm(ambP + vec2<f32>(bgFbm(ambP * 0.5))) - 0.5;
    col = col + vec3<f32>(amb * 0.06);
  }

  // Drifting light spots — additive, screen UV. Colours pre-multiplied.
  // Spot radius scaled by bgS.
  for (var i: i32 = 0; i < ${MAX_SPOTS}; i = i + 1) {
    if (i >= spotCount) { break; }
    let s = u.spots[i];
    let d = distance(uv, s.xy);
    let a = 1.0 - smoothstep(0.0, s.z * bgS, d);
    col = col + u.spotCols[i].rgb * a;
  }

  // Drifting RBC silhouettes — bloodstream theme flair. 22 ellipses
  // with darker centre dot. Anchored in world space so they pan + zoom
  // with the camera (matches Canvas2D's drawBackground behaviour where
  // RBCs are drawn inside the camera transform).
  // Bloodstream theme: directional plasma flow + horizontal ribbon
  // bands scrolling downward. Mirrors WebGL2 FRAG_BG. Wavelength
  // scales with bgS via dividing worldPx by bgS.
  if (rbcOn == 1) {
    let bgWorldPx = worldPx / bgS;
    let flow = vec2<f32>(0.10, 1.0);   // downward + slight rightward
    let plasmaP = bgWorldPx * 0.0015 + flow * (time * 0.20);
    let plasma = bgFbm(plasmaP + vec2<f32>(bgFbm(plasmaP * 0.5)));
    let plasmaCol = mix(vec3<f32>(0.30, 0.05, 0.07),
                        vec3<f32>(0.62, 0.12, 0.16),
                        smoothstep(0.30, 0.85, plasma));
    col = mix(col, plasmaCol, 0.55);
    var ribbon = sin(bgWorldPx.x * 0.012 + bgFbm(plasmaP * 0.7) * 6.28
                     + time * 0.6);
    ribbon = pow(max(0.0, ribbon), 6.0);
    col = mix(col, vec3<f32>(0.88, 0.22, 0.25), ribbon * 0.18);
  }

  // RBC donuts — biconcave-disc silhouettes flowing top → bottom
  // with per-cell rotation. Mirror of WebGL2 FRAG_BG. Tile size and
  // disc radius scale with bgS; time-driven motion stays in unscaled
  // world units so on-screen speed is unchanged.
  if (rbcOn == 1) {
    let TS: f32 = 600.0 * bgS;
    let tIdx = floor(worldPx / TS);
    for (var oy: i32 = -1; oy <= 1; oy = oy + 1) {
      for (var ox: i32 = -1; ox <= 1; ox = ox + 1) {
        let cell = tIdx + vec2<f32>(f32(ox), f32(oy));
        let h0 = bgHash(cell);
        for (var k: i32 = 0; k < 4; k = k + 1) {
          let kSeed = h0 * 6.28 + f32(k) * 1.31;
          let inTile = vec2<f32>(fract(kSeed * 1.7), fract(kSeed * 2.3)) * TS;
          let cWorld = cell * TS + inTile
                     + vec2<f32>(28.0 * sin(time * 0.30 + kSeed), 0.0)
                     + vec2<f32>(9.0, 110.0) * time;
          let rWorld = (24.0 + 18.0 * fract(kSeed * 0.41)) * bgS;

          let spin = 0.6 + 0.7 * fract(kSeed * 0.71);
          let ang  = kSeed + time * spin;
          let ca   = cos(ang); let sa = sin(ang);
          let dXY  = worldPx - cWorld;
          let rd   = vec2<f32>(ca * dXY.x + sa * dXY.y, -sa * dXY.x + ca * dXY.y);
          let dE   = rd / vec2<f32>(rWorld, rWorld * 0.92);
          let L    = length(dE);

          let bodyA = (1.0 - smoothstep(0.95, 1.05, L)) * 0.65;
          let dimple = smoothstep(0.55, 0.0, L);
          let rbcCol = mix(vec3<f32>(0.96, 0.32, 0.34),
                           vec3<f32>(0.50, 0.10, 0.12),
                           dimple);
          col = mix(col, rbcCol, bodyA);
          let rim = smoothstep(0.92, 0.99, L) * (1.0 - smoothstep(1.00, 1.04, L));
          col = mix(col, vec3<f32>(0.22, 0.04, 0.06), rim * 0.45);
        }
      }
    }
  }

  // ---- Reactor: Gray-Scott reaction-diffusion display (kind 8) ----
  // Reads the front ping-pong RT (set up by drawBackground before this
  // pass). Decodes (A * 0.05, B, 0, 1), ramps an acid-green palette on
  // the B concentration. Mirrors webgl2.js FRAG_BG kind == 8 branch.
  if (kind == 8) {
    // dark/mid/hot ramp reads u.base.rgb / u.bot.rgb / u.top.rgb so
    // the picker drives the palette. Default state colours match the
    // previous hard-coded stops (0.02,0.06,0.04) / (0.10,0.40,0.20) /
    // (0.49,1.00,0.54 = panel accent #7eff8a).
    let rxColor = textureSample(reactorTex, reactorSamp, uv);
    let rxConc = rxColor.rg / vec2<f32>(0.05, 1.0);
    let bN = clamp(rxConc.y * 1.6, 0.0, 1.0);
    col = mix(mix(u.base.rgb, u.bot.rgb, smoothstep(0.0, 0.45, bN)),
              u.top.rgb, smoothstep(0.45, 0.92, bN));
  }
  if (kind == 11) {
    // Tissue: seamless tile in world coords. 800 world-pixel tile
    // at bgScale = 1; the slider re-scales the wrap frequency.
    let TILE_PX: f32 = 800.0;
    let tuv = fract(worldPx * (bgS / TILE_PX));
    col = textureSample(tissueTex, tissueSamp, tuv).rgb;
  }

  // Vignette: darken the corners. Aspect-corrected so the falloff
  // is a true 1:1 circle in screen pixels (matches the crosshair
  // overlay circle) instead of an ellipse on widescreen.
  if (vignette > 0.0) {
    var d = uv - vec2<f32>(0.5, 0.5);
    let aspectV = viewport.x / max(1.0, viewport.y);
    if (aspectV > 1.0) { d.x = d.x * aspectV; } else { d.y = d.y / aspectV; }
    let v = length(d) * 1.4;
    let vAmt = vignette * smoothstep(0.4, 1.0, v);
    col = col * (1.0 - vAmt);
  }

  // Premultiplied output so the bg pass composites correctly under
  // blendFunc(ONE, ONE_MINUS_SRC_ALPHA) when opacity < 1 (used by
  // non-first layers in the bg stack). First layer is drawn with no
  // blend, in which case opacity = 1 keeps behaviour identical to
  // the legacy single-bg path.
  let opacity = u.extra.x;
  return vec4<f32>(col * opacity, opacity);
}
`;

// ---------- Particles: kill-mode protein/gut explosions ----------
// One instanced quad per particle. Per-instance: (worldX, worldY, r,
// alpha) packed as float32x4. Fragment shader fills a smooth disc.
// Particle colours all live in a small palette (a few cell-type
// colours from sim.killCell), so we pre-multiply the chosen colour
// in the instance data and the shader just modulates by alpha.
const PARTICLE_WGSL = /* wgsl */ `
struct ParticleU {
  cam: vec4<f32>,        // (scale, tx, ty, _)
  vp: vec4<f32>,         // (viewportW, viewportH, _, _)
};
@group(0) @binding(0) var<uniform> u: ParticleU;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) col: vec4<f32>,  // rgb + alpha
};

@vertex fn vs_main(
  @location(0) corner: vec2<f32>,
  @location(1) inst: vec4<f32>,   // (x, y, r, alpha)
  @location(2) rgb: vec4<f32>,    // (r, g, b, _)
) -> VsOut {
  let camScale = u.cam.x;
  let camT = u.cam.yz;
  let vp = u.vp.xy;
  let r = inst.z;
  let worldPos = inst.xy + corner * r;
  // Camera transform: scale, rotate by cam.w, then translate.
  // Reduces to "worldPos * camScale + camT" when rotation == 0.
  let wScaled = worldPos * camScale;
  let cR = cos(u.cam.w);
  let sR = sin(u.cam.w);
  let screenPos = vec2<f32>(cR * wScaled.x - sR * wScaled.y,
                            sR * wScaled.x + cR * wScaled.y) + camT;
  var clip = (screenPos / vp) * 2.0 - 1.0;
  clip.y = -clip.y;
  var out: VsOut;
  out.pos = vec4<f32>(clip, 0.0, 1.0);
  out.uv = corner;
  out.col = vec4<f32>(rgb.rgb, inst.w);
  return out;
}

@fragment fn fs_main(@location(0) uv: vec2<f32>, @location(1) col: vec4<f32>) -> @location(0) vec4<f32> {
  let d = length(uv);
  // Soft disc: full opacity inside 0.85, fades to 0 by 1.0.
  let a = (1.0 - smoothstep(0.85, 1.0, d)) * col.a;
  if (a <= 0.0) { discard; }
  return vec4<f32>(col.rgb, a);
}
`;

// ---------- Antibody Y-sprites ----------
// Six-vertex unit Y in local space, drawn as a line-list pipeline.
// Per-instance: (x, y, angle, alpha) + (R, G, B, scale). Vertex shader
// rotates+scales the local Y, applies the camera, drops to clip space.
const ANTIBODY_WGSL = /* wgsl */ `
struct AntibodyU {
  cam: vec4<f32>,        // (scale, tx, ty, rotation)
  vp:  vec4<f32>,        // (viewportW, viewportH, _, _)
};
@group(0) @binding(0) var<uniform> u: AntibodyU;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) col: vec4<f32>,
};

@vertex fn vs_main(
  @location(0) local: vec2<f32>,        // unit-Y vertex
  @location(1) inst:  vec4<f32>,        // (x, y, angle, alpha)
  @location(2) rgbScale: vec4<f32>,     // (r, g, b, scale)
) -> VsOut {
  let ca = cos(inst.z);
  let sa = sin(inst.z);
  let rotated = vec2<f32>(ca * local.x - sa * local.y,
                          sa * local.x + ca * local.y);
  let worldPos = inst.xy + rotated * rgbScale.w;
  let camScale = u.cam.x;
  let camT = u.cam.yz;
  let vp = u.vp.xy;
  let wScaled = worldPos * camScale;
  let cR = cos(u.cam.w);
  let sR = sin(u.cam.w);
  let screenPos = vec2<f32>(cR * wScaled.x - sR * wScaled.y,
                            sR * wScaled.x + cR * wScaled.y) + camT;
  var clip = (screenPos / vp) * 2.0 - 1.0;
  clip.y = -clip.y;
  var out: VsOut;
  out.pos = vec4<f32>(clip, 0.0, 1.0);
  out.col = vec4<f32>(rgbScale.rgb, inst.w);
  return out;
}

@fragment fn fs_main(@location(0) col: vec4<f32>) -> @location(0) vec4<f32> {
  return col;
}
`;

// ---------- Decorations (per-type spikes / tendrils / flagella / etc.) ----------
// Mirrors webgl2.js's VERT_DECOR / FRAG_DECOR. Two pipelines share this
// module — same vertex layout (x, y, r, g, b, a), one drawn as line-list
// and one as triangle-list.
const DECOR_WGSL = /* wgsl */ `
struct DecorU {
  cam: vec4<f32>,        // (scale, tx, ty, _)
  vp: vec4<f32>,         // (viewportW, viewportH, _, _)
};
@group(0) @binding(0) var<uniform> u: DecorU;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) col: vec4<f32>,
};

@vertex fn vs_main(
  @location(0) pos: vec2<f32>,
  @location(1) col: vec4<f32>,
) -> VsOut {
  let camScale = u.cam.x;
  let camT = u.cam.yz;
  let vp = u.vp.xy;
  // Camera transform: scale, rotate by cam.w, then translate.
  // Reduces to "pos * camScale + camT" when rotation == 0.
  let pScaled = pos * camScale;
  let cR = cos(u.cam.w);
  let sR = sin(u.cam.w);
  let screenPos = vec2<f32>(cR * pScaled.x - sR * pScaled.y,
                            sR * pScaled.x + cR * pScaled.y) + camT;
  var clip = (screenPos / vp) * 2.0 - 1.0;
  clip.y = -clip.y;
  var out: VsOut;
  out.pos = vec4<f32>(clip, 0.0, 1.0);
  out.col = col;
  return out;
}

@fragment fn fs_main(@location(0) col: vec4<f32>) -> @location(0) vec4<f32> {
  return col;
}
`;

// ---------- Cartoon faces (eyes + mouth, S.cartoon = true) ----------
// One instanced quad per face-bearing cell. Fragment shader composes
// 1-2 white eye discs (with dark pupils + glints), or a horizontal
// ellipse squint when blinking, plus a per-type mouth (smile / frown /
// snarl / fangs / tongue / drool). Mouth kind is packed into the
// instance data as a float; the shader branches on it.
//
// MOUTH_KIND_FLOAT mirrors webgl2.js:
//   0=none, 1=smile, 2=frown, 3=snarl, 4=fangs, 5=tongue, 6=drool.
const FACE_WGSL = /* wgsl */ `
struct FaceU {
  cam: vec4<f32>,        // (scale, tx, ty, rotation-radians)
  vp_time: vec4<f32>,    // (viewportW, viewportH, time, faceScale)
};
@group(0) @binding(0) var<uniform> u: FaceU;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,        // -1..1 across the cell-radius quad
  @location(1) cfg0: vec4<f32>,      // (mouthKind, eyesCount, eyeR, eyeY)
  @location(2) cfg1: vec4<f32>,      // (pupilR, lookX, lookY, mouthW)
  @location(3) cfg2: vec4<f32>,      // (blink, mouthY, phase, blur)
  @location(4) mouthCol: vec3<f32>,
  @location(5) alphaMul: f32,        // SPLITTING fade: 1 → 0.2 at peak → 1
};

@vertex fn vs_main(
  @location(0) corner: vec2<f32>,
  @location(1) inst: vec4<f32>,        // (worldX, worldY, r, mouthKind)
  @location(2) eyes: vec4<f32>,        // (eyesCount, eyeR, eyeY, pupilR)
  @location(3) look: vec4<f32>,        // (lookX, lookY, mouthW, blink)
  @location(4) mouth: vec4<f32>,       // (mouthY, phase, blur, alphaMul)
  @location(5) mouthCol: vec3<f32>,
) -> VsOut {
  let camScale = u.cam.x;
  let camT = u.cam.yz;
  let vp = u.vp_time.xy;
  let r = inst.z;
  let worldPos = inst.xy + corner * r;
  // Camera transform: scale, rotate by cam.w, then translate.
  // Reduces to "worldPos * camScale + camT" when rotation == 0.
  let wScaled = worldPos * camScale;
  let cR = cos(u.cam.w);
  let sR = sin(u.cam.w);
  let screenPos = vec2<f32>(cR * wScaled.x - sR * wScaled.y,
                            sR * wScaled.x + cR * wScaled.y) + camT;
  var clip = (screenPos / vp) * 2.0 - 1.0;
  clip.y = -clip.y;
  var out: VsOut;
  out.pos = vec4<f32>(clip, 0.0, 1.0);
  out.uv = corner;
  out.cfg0 = vec4<f32>(inst.w, eyes.x, eyes.y, eyes.z);
  out.cfg1 = vec4<f32>(eyes.w, look.x, look.y, look.z);
  out.cfg2 = vec4<f32>(look.w, mouth.x, mouth.y, mouth.z);
  out.mouthCol = mouthCol;
  out.alphaMul = mouth.w;
  return out;
}

// Edge-widening smoothstep — approximates Gaussian blur by extending the
// AA band by 'blur' (in body-radius units). Used during SPLITTING to
// soften the face without an offscreen pass. Cap blur <= 0.10 so eyes/
// pupils don't dissolve.
fn sstep(a: f32, b: f32, x: f32, blur: f32) -> f32 {
  return smoothstep(a - blur, b + blur, x);
}

// Mirrors webgl2.js's arcA / discA helpers exactly so the visual is
// 1:1 (mouth & eye geometry, sizes, smoothstep edges).
fn discA(uv: vec2<f32>, c: vec2<f32>, r: f32, blur: f32) -> f32 {
  return 1.0 - sstep(r * 0.92, r, length(uv - c), blur);
}
fn arcA(uv: vec2<f32>, c: vec2<f32>, r: f32, hw: f32, a0: f32, a1: f32, blur: f32) -> f32 {
  let d = uv - c;
  let dist = abs(length(d) - r);
  let band = 1.0 - sstep(hw * 0.5, hw, dist, blur);
  let ang = atan2(d.y, d.x);
  // Soft angular endpoints (was hard step() — produced sub-pixel
  // dot artefacts at small zoom because only the angular extrema
  // aliased through). The 0.06 fade is in radians; tuned so the
  // arc reads as a smooth curve at any size.
  let aFade: f32 = 0.06;
  let in_arc = smoothstep(a0 - aFade, a0 + aFade, ang)
             * (1.0 - smoothstep(a1 - aFade, a1 + aFade, ang));
  return band * in_arc;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  // vp_time.w carries S.faceScale (uniform multiplier on every face
  // dimension: eye R, pupil R, eye-X spread, mouth half-width). Default
  // 1.0 keeps the legacy look; 0 hides faces; up to 3 fills the cell.
  let faceScale = u.vp_time.w;
  let FACE_SCALE: f32 = 1.2 * faceScale;
  let PI: f32 = 3.14159;
  let time = u.vp_time.z;
  let mouthKind = i32(in.cfg0.x + 0.5);
  let eyesCount = i32(in.cfg0.y + 0.5);
  let eyeRBase = in.cfg0.z;
  let eyeY = in.cfg0.w;
  let pupilRBase = in.cfg1.x;
  let look = vec2<f32>(in.cfg1.y, in.cfg1.z);
  let mouthW = in.cfg1.w * faceScale;
  let blink = in.cfg2.x;
  let mouthY = in.cfg2.y;
  let phase = in.cfg2.z;
  let blur = in.cfg2.w;

  if (eyesCount == 0 && mouthKind == 0) { discard; }

  let uv = in.uv;
  var col = vec3<f32>(0.0);
  var a = 0.0;

  // ---------- Eyes ----------
  if (eyesCount > 0) {
    let eyeR = eyeRBase * FACE_SCALE;
    let pupilR = pupilRBase * FACE_SCALE;
    let eL = select(vec2<f32>(0.0, eyeY), vec2<f32>(-0.22 * FACE_SCALE, eyeY), eyesCount >= 2);
    let eR = vec2<f32>(0.22 * FACE_SCALE, eyeY);
    for (var i: i32 = 0; i < 2; i = i + 1) {
      if (i >= eyesCount) { break; }
      let ec = select(eR, eL, i == 0);
      let d = uv - ec;
      if (blink > 0.5) {
        let nx = d.x / max(eyeR, 0.001);
        let ny = d.y / max(eyeR * 0.12, 0.001);
        let ed = sqrt(nx * nx + ny * ny);
        let wA = 1.0 - sstep(0.92, 1.0, ed, blur);
        col = mix(col, vec3<f32>(1.0), wA);
        a = max(a, wA);
      } else {
        let ed = length(d) / max(eyeR, 0.001);
        if (ed < 1.05) {
          let white = 1.0 - sstep(0.92, 1.0, ed, blur);
          col = mix(col, vec3<f32>(1.0), white);
          a = max(a, white);
          let pupilCentre = ec + look * (eyeR * 0.45);
          let pd = length(uv - pupilCentre) / max(pupilR, 0.001);
          let pupilA = 1.0 - sstep(0.92, 1.05, pd, blur);
          col = mix(col, vec3<f32>(0.06, 0.07, 0.09), pupilA);
          a = max(a, pupilA);
          let glintCentre = pupilCentre - vec2<f32>(pupilR * 0.35, pupilR * 0.35);
          let gd = length(uv - glintCentre) / max(pupilR * 0.30, 0.001);
          let glintA = (1.0 - sstep(0.92, 1.05, gd, blur)) * 0.85;
          col = mix(col, vec3<f32>(1.0), glintA);
        }
      }
    }
  }

  // ---------- Mouth ----------
  let mc = vec2<f32>(0.0, mouthY);
  let d = uv - mc;

  if (mouthKind == 1 || mouthKind == 6) {
    // SMILE (or DROOL — base smile). Filled circular segment below
    // the chord — solid mouth at every zoom level.
    let sc = vec2<f32>(0.0, mouthY - mouthW * 0.3);
    let chordY = sc.y + mouthW * sin(0.12 * PI);
    let discMask = 1.0 - sstep(mouthW * 0.95, mouthW, length(uv - sc), blur);
    let chordMask = sstep(chordY - 0.005, chordY + 0.005, uv.y, blur);
    let fill = discMask * chordMask;
    col = mix(col, in.mouthCol, fill);
    a = max(a, fill);
    if (mouthKind == 6) {
      let dripPhase = fract(time * 0.6 + phase);
      let dripC = vec2<f32>(mouthW * 0.25, mouthY + mouthW * 0.25 + dripPhase * mouthW * 0.8);
      let dr = (uv - dripC) / vec2<f32>(mouthW * 0.10, mouthW * 0.16);
      let dripA = (1.0 - sstep(0.85, 1.0, length(dr), blur)) * (1.0 - dripPhase);
      col = mix(col, vec3<f32>(0.47, 0.86, 0.51), dripA);
      a = max(a, dripA);
    }
  } else if (mouthKind == 2) {
    // FROWN — filled circular segment above the chord (mirror of smile).
    let fc = vec2<f32>(0.0, mouthY + mouthW * 0.6);
    let chordY = fc.y - mouthW * sin(0.12 * PI);
    let discMask = 1.0 - sstep(mouthW * 0.95, mouthW, length(uv - fc), blur);
    let chordMask = 1.0 - sstep(chordY - 0.005, chordY + 0.005, uv.y, blur);
    let fill = discMask * chordMask;
    col = mix(col, in.mouthCol, fill);
    a = max(a, fill);
  } else if (mouthKind == 3) {
    // SNARL — 5 downward-pointing triangular teeth sharing top
    // edges. Mirror of WebGL2 FRAG_FACE.
    let topY = mouthY - mouthW * 0.05;
    let toothH = mouthW * 0.30;
    let halfStep = mouthW / 5.0;
    let ly = uv.y - topY;
    if (ly > 0.0 && ly < toothH) {
      let xrel = (uv.x + mouthW) / (2.0 * mouthW);
      if (xrel > 0.0 && xrel < 1.0) {
        let idx = floor(xrel * 5.0);
        let cx = -mouthW + (idx + 0.5) * (2.0 * mouthW / 5.0);
        let t = ly / toothH;
        let halfAtY = (1.0 - t) * halfStep;
        let fill = 1.0 - smoothstep(halfAtY - 0.005, halfAtY + 0.005,
                                     abs(uv.x - cx));
        col = mix(col, in.mouthCol, fill);
        a = max(a, fill);
      }
    }
  } else if (mouthKind == 4) {
    // FANGS — open ellipse + two white wedges.
    let dn = d / vec2<f32>(mouthW, mouthW * 0.45);
    let open = 1.0 - sstep(0.92, 1.0, length(dn), blur);
    col = mix(col, in.mouthCol, open);
    a = max(a, open);
    let fL = vec2<f32>(-mouthW * 0.40, mouthY + mouthW * 0.10);
    let fR = vec2<f32>( mouthW * 0.40, mouthY + mouthW * 0.10);
    let fLA = 1.0 - sstep(0.85, 1.0,
      length((uv - fL) / vec2<f32>(mouthW * 0.10, mouthW * 0.32)), blur);
    let fRA = 1.0 - sstep(0.85, 1.0,
      length((uv - fR) / vec2<f32>(mouthW * 0.10, mouthW * 0.32)), blur);
    let fA = max(fLA, fRA);
    col = mix(col, vec3<f32>(1.0), fA);
    a = max(a, fA);
  } else if (mouthKind == 5) {
    // TONGUE — open ellipse + pink wagging tongue below.
    let dn = d / vec2<f32>(mouthW, mouthW * 0.40);
    let open = 1.0 - sstep(0.92, 1.0, length(dn), blur);
    col = mix(col, in.mouthCol, open);
    a = max(a, open);
    let wag = sin(time * 5.0 + phase) * mouthW * 0.18;
    let tc = vec2<f32>(wag, mouthY + mouthW * 0.30);
    let td = (uv - tc) / vec2<f32>(mouthW * 0.32, mouthW * 0.22);
    let tA = 1.0 - sstep(0.85, 1.0, length(td), blur);
    col = mix(col, vec3<f32>(1.0, 0.54, 0.63), tA);
    a = max(a, tA);
  }

  // SPLITTING fade — alphaMul drops to ~0.2 at p=0.5 then returns
  // to 1 at split end. Always 1 outside SPLITTING.
  let finalA = a * in.alphaMul;
  if (finalA <= 0.0) { discard; }
  return vec4<f32>(col, finalA);
}
`;

// ---------- Helpers ----------

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
    this._uniformData = new Float32Array(16); // (cameraVp, misc, highlight, cameraRot) — 64 bytes
    this._cornerBuffer = null;
    this._instanceBuffer = null;
    this._instanceCapacity = 0;
    this._instanceData = new Float32Array(0);

    // metaSplit pipelines + RT pool. See header for the per-pair pass
    // structure. The RT-sizing strategy follows S.metaRtMode.
    this._metaPolyPipeline = null;
    this._metaBlurPipeline = null;
    this._metaTintPipeline = null;
    this._metaSampler = null;
    this._metaPolyBuffer = null;        // dynamic vertex buffer for poly verts
    this._metaPolyCapacity = 0;         // capacity in vec2 verts
    // 34 verts per half (1 fan-centre + 32 rim + 1 closer) × 2 floats × 2 halves.
    this._metaPolyData = new Float32Array(2 * (WOBBLE_VERTS + 2) * 2);
    // Pool entries: { texA, viewA, texB, viewB, w, h }. Indexed by pair
    // index for 'bbox' / 'fullCanvas'; 'sharedMax' uses index 0 only.
    this._metaPool = [];
    this._metaResolvedMode = null;

    // Target marker (dashed lines + pulsing circle, drawn from
    // drawSelection when sim.targetMarker is present).
    this._dashPipeline = null;
    this._dashUniformBuffer = null;
    this._dashBindGroup = null;
    this._dashVertexBuffer = null;
    this._dashCapacity = 0;             // line vertex capacity (each is 3 floats)
    this._markerPipeline = null;
    this._markerUniformBuffer = null;
    this._markerBindGroup = null;

    // Particles (kill-mode protein/gut explosions).
    this._particlePipeline = null;
    this._particleUniformBuffer = null;
    this._particleBindGroup = null;
    this._particleInstanceBuffer = null;
    this._particleCapacity = 0;         // particles
    this._particleData = new Float32Array(0);

    // Decorations (per-type spikes / tendrils / flagella / etc.).
    // Two flat arrays of vertex floats, refilled per frame, then
    // uploaded into separate line / triangle vertex buffers.
    this._decorLines = [];
    this._decorTris = [];
    this._decorLinePipeline = null;
    this._decorTriPipeline = null;
    this._decorUniformBuffer = null;
    this._decorBindGroup = null;
    this._decorLineBuffer = null;
    this._decorTriBuffer = null;
    this._decorLineCap = 0;            // line vert capacity
    this._decorTriCap = 0;             // tri vert capacity

    // Cartoon faces (S.cartoon).
    this._facePipeline = null;
    this._faceUniformBuffer = null;
    this._faceBindGroup = null;
    this._faceInstanceBuffer = null;
    this._faceCapacity = 0;             // face-bearing cells
    this._faceData = new Float32Array(0);

    // Background pass — gradient + spots + drifting RBC silhouettes.
    // Mirrors webgl2.js's bg pipeline 1:1 (FRAG_BG → BG_WGSL).
    this._bgPipeline = null;
    this._bgUniformBuffer = null;
    this._bgBindGroup = null;
    this._bgUniformData = new Float32Array(0);
    // Reactor (Gray-Scott) — eager: sampler + 1x1 dummy texture, lazy:
    // pipelines + ping-pong RT pair. Built in _buildReactorEager().
    this._reactorSampler = null;
    this._reactorDummyTex = null;
    this._reactorDummyView = null;
    this._reactorStepPipeline = null;
    this._reactorSeedPipeline = null;
    this._reactorStepUniformBuffer = null;
    this._reactorSeedUniformBuffer = null;
    this._reactorRtA = null;
    this._reactorRtB = null;
    this._reactorRtSize = { w: 0, h: 0 };
    this._reactorFront = 0;
    this._reactorLastSeedMs = -Infinity;

    // Caustics-overlay post-process (S.causticsOverlay). Lazy: nothing
    // is allocated until the toggle is first turned on, and everything
    // is released on toggle-off.
    // Post-pin chain RTs are allocated in _postEnsureRts.
    this._causticBgPipeline = null;  // GPURenderPipeline
    this._causticBgSampler = null;   // GPUSampler (linear)
    this._causticBgUbo = null;       // GPUBuffer (16 bytes — time + padding)
    this._causticBgUboData = null;   // Float32Array(4)

    // One-time random light-spot layout, mirrors webgl2.js:935.
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
    context.configure({ device, format, alphaMode: RT_ALPHA_MODE });

    this.device = device;
    this.context = context;
    this.format = format;

    this._buildDiskPipeline();
    this._growInstanceBuffer(64);
    this._buildMetaPipelines();
    this._buildOverlayPipelines();
    this._buildReactorEager();
  }

  // Dashed-line target lines, pulsing-circle marker, particles, and
  // cartoon faces. All four use the existing _cornerBuffer (or a
  // dedicated dynamic vertex buffer for dashed lines / particles /
  // faces) and a per-pipeline uniform + bind group.
  _buildOverlayPipelines() {
    const device = this.device;
    const fmt = this.format;

    const stdBlend = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };

    // ---- Dashed lines (LineList) ----
    const dashModule = device.createShaderModule({ code: DASH_WGSL });
    this._dashPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: dashModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 12, // (x, y, dist) — 3 floats
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: dashModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt, blend: stdBlend }],
      },
      primitive: { topology: 'line-list' },
    });
    this._dashUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._dashBindGroup = device.createBindGroup({
      layout: this._dashPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._dashUniformBuffer } }],
    });

    // ---- Marker quad ----
    const markerModule = device.createShaderModule({ code: MARKER_WGSL });
    this._markerPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: markerModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        }],
      },
      fragment: {
        module: markerModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt, blend: stdBlend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this._markerUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._markerBindGroup = device.createBindGroup({
      layout: this._markerPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._markerUniformBuffer } }],
    });

    // ---- Background pass (gradient + spots + drifting RBC silhouettes) ----
    // Single fullscreen triangle; shader reads everything from one
    // uniform buffer. Uniform layout (100 floats / 400 bytes):
    //   [0..3]    misc  (kind, vignette, gridStep, time)
    //   [4..7]    cam   (scale, tx, ty, rotation)
    //   [8..11]   vp    (W, H, spotCount, rbcOn)
    //   [12..15]  extra (opacity, bgScale, _, _)
    //   [16..35]  base, top, bot, ringColor, gridColor (5 × vec4)
    //   [36..67]  spots[8] vec4 (cx, cy, r, _) screen 0..1
    //   [68..99]  spotCols[8] vec4 (r, g, b, _) pre-multiplied
    const bgModule = device.createShaderModule({ code: BG_WGSL });
    this._bgPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bgModule, entryPoint: 'vs_main' },
      fragment: {
        module: bgModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt }],   // opaque base, no blend
      },
      primitive: { topology: 'triangle-list' },
    });
    // Blend-mode pipelines for non-first layers in the bg stack. Each
    // pipeline shares the shader module with _bgPipeline but composites
    // onto whatever the previous layers already wrote. Shader output is
    // pre-multiplied, so 'normal' uses (one, one-minus-src-alpha).
    const bgBlend = {
      normal:   { color: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' } },
      multiply: { color: { srcFactor: 'dst',       dstFactor: 'zero',                operation: 'add' },
                  alpha: { srcFactor: 'one',       dstFactor: 'zero',                operation: 'add' } },
      additive: { color: { srcFactor: 'one',       dstFactor: 'one',                 operation: 'add' },
                  alpha: { srcFactor: 'one',       dstFactor: 'one',                 operation: 'add' } },
    };
    const mkBgBlend = (b) => device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bgModule, entryPoint: 'vs_main' },
      fragment: { module: bgModule, entryPoint: 'fs_main', targets: [{ format: fmt, blend: b }] },
      primitive: { topology: 'triangle-list' },
    });
    this._bgBlendPipelines = {
      normal:   mkBgBlend(bgBlend.normal),
      multiply: mkBgBlend(bgBlend.multiply),
      additive: mkBgBlend(bgBlend.additive),
    };
    this._bgUniformBuffer = device.createBuffer({
      // 100 floats × 4 = 400 bytes. Layout: misc + cam + vp + extra
      // + base + top + bot + ringColor + gridColor + spots[8] + spotCols[8].
      size: 100 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._bgUniformData = new Float32Array(100);
    // Bind group is rebuilt each frame in drawBackground because the
    // texture view at binding 2 changes between the dummy 1x1 (every
    // theme but reactor) and the active reactor RT view (which itself
    // ping-pongs each step). Cached here as null; never read directly.
    this._bgBindGroup = null;

    // ---- Particles (instanced quad, 8 floats per particle) ----
    const partModule = device.createShaderModule({ code: PARTICLE_WGSL });
    this._particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: partModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          {
            arrayStride: 32,             // (x, y, r, alpha, R, G, B, _pad)
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0,  format: 'float32x4' },
              { shaderLocation: 2, offset: 16, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: partModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt, blend: stdBlend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this._particleUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._particleBindGroup = device.createBindGroup({
      layout: this._particlePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._particleUniformBuffer } }],
    });
    this._growParticleBuffer(64);

    // ---- Antibody Y-sprites ----
    const antibodyModule = device.createShaderModule({ code: ANTIBODY_WGSL });
    this._antibodyPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: antibodyModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,                  // unit-Y vertex (vec2)
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          {
            arrayStride: 32,                 // (x, y, angle, alpha) + (R, G, B, scale)
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0,  format: 'float32x4' },
              { shaderLocation: 2, offset: 16, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: antibodyModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt, blend: stdBlend }],
      },
      primitive: { topology: 'line-list' },
    });
    this._antibodyUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._antibodyBindGroup = device.createBindGroup({
      layout: this._antibodyPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._antibodyUniformBuffer } }],
    });
    // Static unit-Y vertex buffer — same coords as the WebGL2 path.
    const antibodyUnitY = new Float32Array([
      -2.4, 0,    0, 0,             // stem
       0, 0,    1.6, -1.2,           // left arm
       0, 0,    1.6,  1.2,           // right arm
    ]);
    this._antibodyUnitBuffer = device.createBuffer({
      size: antibodyUnitY.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._antibodyUnitBuffer, 0, antibodyUnitY);
    this._antibodyInstanceBuffer = null;
    this._antibodyCapacity = 0;
    this._antibodyData = new Float32Array(0);
    this._growAntibodyBuffer(32);

    // ---- Decorations (line-list + triangle-list pipelines) ----
    // Both pipelines share an explicit bind-group layout so a single
    // bind group works for both — auto-derived layouts aren't
    // guaranteed cross-pipeline-compatible by the WebGPU spec.
    const decorModule = device.createShaderModule({ code: DECOR_WGSL });
    const decorBgLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });
    const decorPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [decorBgLayout],
    });
    const decorVertexLayout = {
      arrayStride: 24,                 // (x, y, r, g, b, a) — 6 floats
      stepMode: 'vertex',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32x4' },
      ],
    };
    this._decorLinePipeline = device.createRenderPipeline({
      layout: decorPipelineLayout,
      vertex: { module: decorModule, entryPoint: 'vs_main', buffers: [decorVertexLayout] },
      fragment: {
        module: decorModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt, blend: stdBlend }],
      },
      primitive: { topology: 'line-list' },
    });
    this._decorTriPipeline = device.createRenderPipeline({
      layout: decorPipelineLayout,
      vertex: { module: decorModule, entryPoint: 'vs_main', buffers: [decorVertexLayout] },
      fragment: {
        module: decorModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt, blend: stdBlend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this._decorUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._decorBindGroup = device.createBindGroup({
      layout: decorBgLayout,
      entries: [{ binding: 0, resource: { buffer: this._decorUniformBuffer } }],
    });

    // ---- Cartoon faces (instanced quad, 19 floats per face) ----
    const faceModule = device.createShaderModule({ code: FACE_WGSL });
    this._facePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: faceModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          {
            arrayStride: 76,             // 19 floats per face
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0,  format: 'float32x4' }, // (x, y, r, mouthKind)
              { shaderLocation: 2, offset: 16, format: 'float32x4' }, // (eyesCount, eyeR, eyeY, pupilR)
              { shaderLocation: 3, offset: 32, format: 'float32x4' }, // (lookX, lookY, mouthW, blink)
              { shaderLocation: 4, offset: 48, format: 'float32x4' }, // (mouthY, phase, _, _)
              { shaderLocation: 5, offset: 64, format: 'float32x3' }, // mouthCol
            ],
          },
        ],
      },
      fragment: {
        module: faceModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt, blend: stdBlend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this._faceUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._faceBindGroup = device.createBindGroup({
      layout: this._facePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._faceUniformBuffer } }],
    });
    this._growFaceBuffer(64);
  }

  _growParticleBuffer(target) {
    if (target <= this._particleCapacity) return;
    const newCap = Math.max(64, Math.ceil(target * 1.5));
    this._particleData = new Float32Array(newCap * 8);
    this._particleCapacity = newCap;
    if (this._particleInstanceBuffer) this._particleInstanceBuffer.destroy();
    this._particleInstanceBuffer = this.device.createBuffer({
      size: this._particleData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _growAntibodyBuffer(target) {
    if (target <= this._antibodyCapacity) return;
    const newCap = Math.max(32, Math.ceil(target * 1.5));
    this._antibodyData = new Float32Array(newCap * 8);
    this._antibodyCapacity = newCap;
    if (this._antibodyInstanceBuffer) this._antibodyInstanceBuffer.destroy();
    this._antibodyInstanceBuffer = this.device.createBuffer({
      size: this._antibodyData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _growFaceBuffer(target) {
    if (target <= this._faceCapacity) return;
    const newCap = Math.max(64, Math.ceil(target * 1.5));
    this._faceData = new Float32Array(newCap * 19);
    this._faceCapacity = newCap;
    if (this._faceInstanceBuffer) this._faceInstanceBuffer.destroy();
    this._faceInstanceBuffer = this.device.createBuffer({
      size: this._faceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _ensureDashCapacity(vertCount) {
    if (vertCount <= this._dashCapacity) return;
    const newCap = Math.max(64, Math.ceil(vertCount * 1.5));
    this._dashCapacity = newCap;
    if (this._dashVertexBuffer) this._dashVertexBuffer.destroy();
    this._dashVertexBuffer = this.device.createBuffer({
      size: newCap * 12, // 3 floats per vertex
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _ensureDecorLineCapacity(vertCount) {
    if (vertCount <= this._decorLineCap) return;
    const newCap = Math.max(64, Math.ceil(vertCount * 1.5));
    this._decorLineCap = newCap;
    if (this._decorLineBuffer) this._decorLineBuffer.destroy();
    this._decorLineBuffer = this.device.createBuffer({
      size: newCap * 24, // 6 floats per vertex
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _ensureDecorTriCapacity(vertCount) {
    if (vertCount <= this._decorTriCap) return;
    const newCap = Math.max(64, Math.ceil(vertCount * 1.5));
    this._decorTriCap = newCap;
    if (this._decorTriBuffer) this._decorTriBuffer.destroy();
    this._decorTriBuffer = this.device.createBuffer({
      size: newCap * 24,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _buildMetaPipelines() {
    const device = this.device;
    const fmt = this.format;

    // Shared sampler (linear filter, clamp). Used by blur + tint.
    this._metaSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Polygon-fill pipeline. Vertex layout: (x, y) in canvas physical px.
    const polyModule = device.createShaderModule({ code: META_POLY_WGSL });
    this._metaPolyPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: polyModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        }],
      },
      fragment: {
        module: polyModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt }],
      },
      primitive: { topology: 'triangle-list' }, // triangulate the fan on the JS side
    });

    // Separable Gaussian blur. Fullscreen quad via vertex_index.
    const blurModule = device.createShaderModule({ code: META_BLUR_WGSL });
    this._metaBlurPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blurModule, entryPoint: 'vs_main' },
      fragment: {
        module: blurModule,
        entryPoint: 'fs_main',
        targets: [{ format: fmt }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    // Threshold + radial-gradient tint, alpha-blended to canvas.
    const tintModule = device.createShaderModule({ code: META_TINT_WGSL });
    this._metaTintPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: tintModule, entryPoint: 'vs_main' },
      fragment: {
        module: tintModule,
        entryPoint: 'fs_main',
        targets: [{
          format: fmt,
          blend: {
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
      primitive: { topology: 'triangle-strip' },
    });

    // Polygon vertex buffer. Holds verts for one pair (2 halves × 34
    // verts). The fan is triangulated on the JS side into a triangle
    // list so we can use 'triangle-list' topology and avoid two draws.
    // 34-vert fan = 32 triangles = 96 verts × 2 floats per half.
    this._metaPolyCapacity = 2 * WOBBLE_VERTS * 3 * 2; // halves × tris × verts × xy
    this._metaPolyBuffer = device.createBuffer({
      size: this._metaPolyCapacity * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    // Re-purpose _metaPolyData to hold the triangulated vertex stream.
    this._metaPolyData = new Float32Array(this._metaPolyCapacity);
  }

  // ---- Reactor (Gray-Scott) ---------------------------------------
  // Two ping-pong RTs read+write the Gray-Scott state. Step + seed
  // pipelines compile **lazily** on first reactor frame (most sessions
  // never enter the theme). The sampler + 1x1 dummy texture, however,
  // are eager: BG_WGSL declares the reactor texture binding
  // unconditionally, so every frame's bg bind group must supply a
  // valid texture even when kind != 8. Dummy contents are ignored
  // (the shader only samples the texture inside the kind == 8 branch).
  _buildReactorEager() {
    const device = this.device;
    this._reactorSampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this._reactorDummyTex = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._reactorDummyView = this._reactorDummyTex.createView();
    // Initial fill of the dummy: clear-render-pass with (0, 0, 0, 1).
    // Shader never samples it for non-reactor kinds, but WebGPU
    // validation rejects sampling from a never-written texture.
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this._reactorDummyView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    device.queue.submit([enc.finish()]);

    // Lazy fields (populated on first reactor frame)
    this._reactorStepPipeline = null;
    this._reactorSeedPipeline = null;
    this._reactorStepUniformBuffer = null;
    this._reactorSeedUniformBuffer = null;
    this._reactorRtA = null;
    this._reactorRtB = null;
    this._reactorRtSize = { w: 0, h: 0 };
    this._reactorFront = 0;
    this._reactorLastSeedMs = -Infinity;
    this._reactorSeedScratch = new Float32Array(4 + REACTOR_MAX_SEEDS_WGPU * 4);
    this._reactorStepScratch = new Float32Array(4);
  }

  _reactorEnsurePipelines() {
    if (this._reactorStepPipeline) return;
    const device = this.device;
    const stepModule = device.createShaderModule({ code: REACTOR_STEP_WGSL });
    this._reactorStepPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: stepModule, entryPoint: 'vs_main' },
      fragment: { module: stepModule, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-strip' },
    });
    this._reactorStepUniformBuffer = device.createBuffer({
      size: 16,                          // vec4 (resX, resY, _, _)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const seedModule = device.createShaderModule({ code: REACTOR_SEED_WGSL });
    this._reactorSeedPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: seedModule, entryPoint: 'vs_main' },
      fragment: { module: seedModule, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-strip' },
    });
    this._reactorSeedUniformBuffer = device.createBuffer({
      // 1 vec4 (resX, resY, count, _) + 8 vec4 seed entries = 144 bytes.
      size: 16 + REACTOR_MAX_SEEDS_WGPU * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // ── Tissue (image-tiled) bg — lazy GPU texture upload ──────
  // Cached per-URL. The BG shader binds the 1x1 dummy until the
  // image decodes (`_tissueTexView(url)` returns the dummy view
  // while pending); a one-shot async upload swaps it in on
  // completion and the next frame samples the real bytes.
  _tissueSampler() {
    if (this._tissueSamp) return this._tissueSamp;
    this._tissueSamp = this.device.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat',
    });
    return this._tissueSamp;
  }
  _tissueDummyView() {
    if (this._tissueDummy) return this._tissueDummy;
    const device = this.device;
    const tex = device.createTexture({
      size: [1, 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: tex }, new Uint8Array([64, 32, 36, 255]),
      { bytesPerRow: 4 }, [1, 1],
    );
    this._tissueDummy = tex.createView();
    return this._tissueDummy;
  }
  _tissueTexView(url) {
    if (!this._tissueCache) this._tissueCache = new Map();
    const cache = this._tissueCache;
    const slot = cache.get(url);
    if (slot && slot.view) return slot.view;
    if (slot && slot.pending) return this._tissueDummyView();
    cache.set(url, { pending: true });
    loadTexture(url).then((img) => {
      const device = this.device;
      const w = img.width, h = img.height;
      // Mip count for proper minification on aggressive bgScale.
      const mipCount = Math.max(1, 1 + Math.floor(Math.log2(Math.max(w, h))));
      const tex = device.createTexture({
        size: [w, h, 1],
        format: 'rgba8unorm',
        mipLevelCount: mipCount,
        usage: GPUTextureUsage.TEXTURE_BINDING
             | GPUTextureUsage.COPY_DST
             | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture(
        { source: img }, { texture: tex }, [w, h, 1],
      );
      // Cheap mip-gen via render-pipeline blit chain. Skipped if
      // only one mip level (1×1 texture etc.).
      if (mipCount > 1) this._tissueGenerateMips(tex, w, h, mipCount);
      cache.set(url, { view: tex.createView() });
    }).catch((e) => {
      console.warn('[webgpu tissue] load failed:', e && e.message);
      cache.set(url, { view: this._tissueDummyView() });
    });
    return this._tissueDummyView();
  }
  // Bare-bones mip-chain blitter — draws each mip level into the
  // next using a copy-shader-equivalent (render-pass + sample).
  // For shipping simplicity we use a single linear-min blit per
  // level which is good enough for a static bg.
  _tissueGenerateMips(tex, w, h, mipCount) {
    const device = this.device;
    if (!this._mipPipeline) {
      const mod = device.createShaderModule({ code: /* wgsl */ `
        @vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
          let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
          let y = f32(vi & 2u) * 2.0 - 1.0;
          return vec4<f32>(x, y, 0.0, 1.0);
        }
        @group(0) @binding(0) var s : sampler;
        @group(0) @binding(1) var t : texture_2d<f32>;
        @fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
          let dim = vec2<f32>(textureDimensions(t, 0));
          let uv = p.xy / vec2<f32>(dim.x * 0.5, dim.y * 0.5);
          return textureSample(t, s, uv);
        }
      ` });
      this._mipPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex:   { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
    }
    const enc = device.createCommandEncoder();
    for (let mip = 1; mip < mipCount; mip++) {
      const srcView = tex.createView({ baseMipLevel: mip - 1, mipLevelCount: 1 });
      const dstView = tex.createView({ baseMipLevel: mip, mipLevelCount: 1 });
      const bg = device.createBindGroup({
        layout: this._mipPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this._tissueSampler() },
          { binding: 1, resource: srcView },
        ],
      });
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: dstView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear', storeOp: 'store',
        }],
      });
      pass.setPipeline(this._mipPipeline);
      pass.setBindGroup(0, bg);
      pass.draw(3, 1, 0, 0);
      pass.end();
    }
    device.queue.submit([enc.finish()]);
  }

  _reactorMakeRt(w, h) {
    const device = this.device;
    const tex = device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = tex.createView();
    // Initial fill: encode A=1, B=0 → (0.05, 0, 0, 1). Matches webgl2.js
    // _reactorMakeRt's gl.clearColor / gl.clear pattern.
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.05, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    device.queue.submit([enc.finish()]);
    return { tex, view };
  }

  _reactorEnsureRts() {
    this._reactorEnsurePipelines();
    const targetW = Math.max(64, Math.min(256, Math.floor(this.W * 0.5)));
    const targetH = Math.max(64, Math.min(256, Math.floor(this.H * 0.5)));
    if (this._reactorRtA && this._reactorRtSize.w === targetW && this._reactorRtSize.h === targetH) return;
    if (this._reactorRtA) { try { this._reactorRtA.tex.destroy(); } catch {} }
    if (this._reactorRtB) { try { this._reactorRtB.tex.destroy(); } catch {} }
    this._reactorRtA = this._reactorMakeRt(targetW, targetH);
    this._reactorRtB = this._reactorMakeRt(targetW, targetH);
    this._reactorRtSize = { w: targetW, h: targetH };
    this._reactorFront = 0;
    this._reactorLastSeedMs = -Infinity;
  }

  _reactorRt(idx) { return idx === 0 ? this._reactorRtA : this._reactorRtB; }

  _reactorSeed(seedCount) {
    const device = this.device;
    const front = this._reactorRt(this._reactorFront);
    const back  = this._reactorRt(1 - this._reactorFront);
    // Caller passes the desired count; fall back to a randomised 5..8
    // when called without an argument (legacy path).
    const count = (typeof seedCount === 'number' && seedCount > 0)
      ? Math.max(1, Math.min(REACTOR_MAX_SEEDS_WGPU, seedCount | 0))
      : (5 + Math.floor(Math.random() * 4));
    const u = this._reactorSeedScratch;
    u[0] = this._reactorRtSize.w;
    u[1] = this._reactorRtSize.h;
    u[2] = count;
    u[3] = 0;
    for (let i = 0; i < count; i++) {
      u[4 + i * 4]     = Math.random();
      u[4 + i * 4 + 1] = Math.random();
      u[4 + i * 4 + 2] = 0.025 + Math.random() * 0.015;
      u[4 + i * 4 + 3] = 0;
    }
    // Zero out unused entries so stale data from prior seeds doesn't
    // leak through (count bounds the loop in WGSL, but be defensive).
    for (let i = count; i < REACTOR_MAX_SEEDS_WGPU; i++) {
      u[4 + i * 4]     = 0;
      u[4 + i * 4 + 1] = 0;
      u[4 + i * 4 + 2] = 0;
      u[4 + i * 4 + 3] = 0;
    }
    device.queue.writeBuffer(this._reactorSeedUniformBuffer, 0, u.buffer, u.byteOffset, u.byteLength);

    const bindGroup = device.createBindGroup({
      layout: this._reactorSeedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._reactorSeedUniformBuffer } },
        { binding: 1, resource: this._reactorSampler },
        { binding: 2, resource: front.view },
      ],
    });
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: back.view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this._reactorSeedPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4, 1, 0, 0);
    pass.end();
    this._reactorFront = 1 - this._reactorFront;
  }

  _reactorStep(iters) {
    const device = this.device;
    const u = this._reactorStepScratch;
    u[0] = this._reactorRtSize.w;
    u[1] = this._reactorRtSize.h;
    u[2] = 0;
    u[3] = 0;
    device.queue.writeBuffer(this._reactorStepUniformBuffer, 0, u.buffer, u.byteOffset, u.byteLength);
    for (let i = 0; i < iters; i++) {
      const front = this._reactorRt(this._reactorFront);
      const back  = this._reactorRt(1 - this._reactorFront);
      const bindGroup = device.createBindGroup({
        layout: this._reactorStepPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._reactorStepUniformBuffer } },
          { binding: 1, resource: this._reactorSampler },
          { binding: 2, resource: front.view },
        ],
      });
      const pass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{ view: back.view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(this._reactorStepPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(4, 1, 0, 0);
      pass.end();
      this._reactorFront = 1 - this._reactorFront;
    }
  }

  _reactorDestroy() {
    const tryDestroy = (b) => { if (b) { try { b.destroy(); } catch {} } };
    if (this._reactorRtA) { tryDestroy(this._reactorRtA.tex); this._reactorRtA = null; }
    if (this._reactorRtB) { tryDestroy(this._reactorRtB.tex); this._reactorRtB = null; }
    this._reactorRtSize = { w: 0, h: 0 };
    this._reactorFront = 0;
    this._reactorLastSeedMs = -Infinity;
  }

  // ── Post-FX ping-pong RTs (shared) ──
  // Two canvas-sized RGBA8 textures alternated between by every
  // post-pin overlay. Each chain step reads from _postSource and
  // writes to the other RT, then we swap. The last step writes
  // straight to the canvas surface (_frameView). Mirrors WebGL2.
  _postMakeRt() {
    const device = this.device;
    const w = this.canvas.width | 0;
    const h = this.canvas.height | 0;
    const tex = device.createTexture({
      size: [w, h],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return { tex, view: tex.createView(), w, h };
  }
  _postEnsureRts() {
    const w = this.canvas.width | 0;
    const h = this.canvas.height | 0;
    if (this._postRtA && this._postRtA.w === w && this._postRtA.h === h) return;
    this._postDestroyRts();
    this._postRtA = this._postMakeRt();
    this._postRtB = this._postMakeRt();
  }
  _postDestroyRts() {
    if (this._postRtA) { try { this._postRtA.tex.destroy(); } catch {} this._postRtA = null; }
    if (this._postRtB) { try { this._postRtB.tex.destroy(); } catch {} this._postRtB = null; }
    this._postSource = null;
  }

  // ── Caustics overlay (S.causticsOverlay) ──
  // Pipeline-only helper. RT allocation lives in _postEnsureRts; the
  // shader samples whichever ping-pong RT is currently the chain
  // source and writes to the other (or to the canvas surface for the
  // last chain step).
  _causticBgEnsurePipeline() {
    if (this._causticBgPipeline) return;
    const device = this.device;
    const mod = device.createShaderModule({ code: CAUSTIC_BG_WGSL });
    this._causticBgPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs_main' },
      fragment: { module: mod, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this._causticBgSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    // Layout: hdr (vec4, time at [0]) + tint (vec4, rgb at [4..6]).
    this._causticBgUbo = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._causticBgUboData = new Float32Array(8);
  }
  _causticBgDestroy() {
    if (this._causticBgUbo) { try { this._causticBgUbo.destroy(); } catch {} this._causticBgUbo = null; }
    this._causticBgPipeline = null;
    this._causticBgSampler = null;
    this._causticBgUboData = null;
  }

  // ── Microscope FX post-pass (S.microscopeBlur + S.makeItReal) ──
  // Pipeline-only helper. Bundled shader for scene-wide blur +
  // duotone color grade. Shares the ping-pong RTs.
  _sceneFxEnsurePipeline() {
    if (this._sceneFxPipeline) return;
    const device = this.device;
    const mod = device.createShaderModule({ code: SCENE_FX_WGSL });
    this._sceneFxPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs_main' },
      fragment: { module: mod, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this._sceneFxSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    // 3 × vec4 = 48 bytes. Layout: res, blur (on/focus/strength/falloff),
    // grade (on/hue1/hue2/saturation).
    this._sceneFxUbo = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._sceneFxUboData = new Float32Array(12);
  }
  _sceneFxDestroy() {
    if (this._sceneFxUbo) { try { this._sceneFxUbo.destroy(); } catch {} this._sceneFxUbo = null; }
    this._sceneFxPipeline = null;
    this._sceneFxSampler = null;
    this._sceneFxUboData = null;
  }

  // ── Liquid-ripples overlay (S.liquidRipples) ──
  // Mirror of WebGL2 _ripple* helpers. Shares no state with caustics
  // — separate RT + pipeline + UBO. drawBackground picks one or the
  // other to run; if both toggles are on, ripples wins.
  _rippleBgEnsureRt() {
    const device = this.device;
    const w = this.canvas.width | 0;
    const h = this.canvas.height | 0;
    if (this._rippleBgRt && this._rippleBgRt.w === w && this._rippleBgRt.h === h) return;
    if (this._rippleBgRt) { try { this._rippleBgRt.tex.destroy(); } catch {} }
    const tex = device.createTexture({
      size: [w, h],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this._rippleBgRt = { tex, view: tex.createView(), w, h };
  }
  // FX overlay pipeline cache. WebGPU bakes blend state into the
  // pipeline so we keep three pre-built pipelines (one per blend
  // mode); the draw helper picks the right one per effect.
  _fxOverlayEnsurePipelines() {
    if (this._fxOverlayPipelines) return;
    const device = this.device;
    const mod = device.createShaderModule({ code: FX_OVERLAY_WGSL });
    const blend = {
      normal:   { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' } },
      multiply: { color: { srcFactor: 'dst',       dstFactor: 'zero',                operation: 'add' },
                  alpha: { srcFactor: 'one',       dstFactor: 'zero',                operation: 'add' } },
      additive: { color: { srcFactor: 'one',       dstFactor: 'one',                 operation: 'add' },
                  alpha: { srcFactor: 'one',       dstFactor: 'one',                 operation: 'add' } },
    };
    const mk = (b) => device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs_main' },
      fragment: { module: mod, entryPoint: 'fs_main', targets: [{ format: this.format, blend: b }] },
      primitive: { topology: 'triangle-list' },
    });
    this._fxOverlayPipelines = {
      normal:   mk(blend.normal),
      multiply: mk(blend.multiply),
      additive: mk(blend.additive),
    };
    this._fxOverlayUbo = device.createBuffer({
      size: 32,            // 2 × vec4 = 8 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._fxOverlayUboData = new Float32Array(8);
  }

  _fxOverlayDraw(t) {
    // Order from overlayFxOrder() — the FX subset of S.overlayOrder
    // — so the user can reorder via Settings → Overlays. Mirror of
    // webgl2.js _fxOverlayDraw. Per-frame read means reorders +
    // toggles take effect on the next draw; no pipeline reset needed.
    // Reversed before iteration so the top-of-list FX composites
    // last (= visually on top), matching the UI's "Stack (top runs
    // last)" semantics and the post-pin FBO chain's order.
    const order = overlayFxOrder().slice().reverse();
    const anyOn = order.some(k =>
      (k === 'noise' && S.staticNoise) ||
      (k === 'vignette' && S.vignette) ||
      (k === 'crosshair' && S.crosshair)
    );
    if (!anyOn) return;
    if (!this._frameEncoder || !this._frameView) return;
    this._fxOverlayEnsurePipelines();
    const device = this.device;
    const u = this._fxOverlayUboData;
    const drawOne = (effect, mode, intensity) => {
      u[0] = this.canvas.width;
      u[1] = this.canvas.height;
      u[2] = t;
      u[3] = intensity;
      u[4] = effect;
      u[5] = mode;
      u[6] = 0;
      u[7] = 0;
      device.queue.writeBuffer(this._fxOverlayUbo, 0,
                               u.buffer, u.byteOffset, u.byteLength);
      const blendKey = (mode === 2) ? 'multiply'
                    : (mode === 3) ? 'additive'
                    : 'normal';
      const pipeline = this._fxOverlayPipelines[blendKey];
      const bg = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this._fxOverlayUbo } }],
      });
      const pass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._frameView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bg);
      pass.draw(3, 1, 0, 0);
      pass.end();
    };
    const MODES = { normal: 1, multiply: 2, additive: 3 };
    for (const k of order) {
      if (k === 'noise' && S.staticNoise) {
        drawOne(1, MODES[S.staticNoiseBlend] || 3, S.staticNoiseIntensity ?? 0.4);
      } else if (k === 'vignette' && S.vignette) {
        drawOne(2, MODES[S.vignetteBlend] || 3, S.vignetteIntensity ?? 0.6);
      } else if (k === 'crosshair' && S.crosshair) {
        drawOne(3, 1, 1.0);
      }
    }
  }

  _rippleBgEnsurePipeline() {
    if (this._rippleBgPipeline) return;
    const device = this.device;
    const mod = device.createShaderModule({ code: RIPPLE_BG_WGSL });
    this._rippleBgPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs_main' },
      fragment: { module: mod, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this._rippleBgSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    // Layout: time, cellCount, resW, resH, params (vec4),
    // then 24 × vec4 cells.
    const floats = 4 + 4 + RIPPLE_MAX_WGPU * 4;
    this._rippleBgUbo = device.createBuffer({
      size: floats * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._rippleBgUboData = new Float32Array(floats);
  }
  _rippleBgDestroy() {
    if (this._rippleBgRt) { try { this._rippleBgRt.tex.destroy(); } catch {} this._rippleBgRt = null; }
    if (this._rippleBgUbo) { try { this._rippleBgUbo.destroy(); } catch {} this._rippleBgUbo = null; }
    this._rippleBgPipeline = null;
    this._rippleBgSampler = null;
    this._rippleBgUboData = null;
  }
  // Pack visible cells into the UBO data buffer; returns the count.
  // UBO layout: [0..3] header, [4..7] params vec4, [8..] cells vec4×N.
  _rippleBgCollectCells() {
    const buf = this._rippleBgUboData;
    const cells = (this.sim && this.sim.cells) || [];
    const W = this.W, H = this.H;
    const minAx = Math.max(1, Math.min(W, H));
    const CELLS_OFF = 8;
    let n = 0;
    for (let i = 0; i < cells.length && n < RIPPLE_MAX_WGPU; i++) {
      const c = cells[i];
      const s = this.sim.worldToScreen(c.x, c.y);
      const m = c.r * 1.5;
      if (s.x < -m || s.y < -m || s.x > W + m || s.y > H + m) continue;
      const off = CELLS_OFF + n * 4;
      buf[off + 0] = s.x / W;
      buf[off + 1] = s.y / H;
      buf[off + 2] = (c.r * this.camera.scale) / minAx;
      buf[off + 3] = 0;
      n++;
    }
    for (let i = CELLS_OFF + n * 4; i < buf.length; i++) buf[i] = 0;
    return n;
  }

  // ── Glass-membrane overlay ────────────────────────────────
  // Same per-cell SDF / scene-FBO sampling as ripples; different
  // displacement formula (half-sine lens peak in 0.85*r..1.15*r
  // band). Shares the ripple sampler (linear / clamp-to-edge) but
  // owns its own pipeline + UBO because the params layout differs.
  _glassEnsurePipeline() {
    if (this._glassPipeline) return;
    const device = this.device;
    const mod = device.createShaderModule({ code: GLASS_BG_WGSL });
    this._glassPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs_main' },
      fragment: { module: mod, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    // Reuse ripple sampler if it already exists; allocate a fresh
    // one (same params) otherwise so the glass pass works even
    // when ripples is off.
    if (!this._rippleBgSampler) {
      this._rippleBgSampler = device.createSampler({
        magFilter: 'linear', minFilter: 'linear',
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
      });
    }
    // Layout: header vec4 + params vec4 + N × vec4 cells.
    const floats = 4 + 4 + GLASS_MAX_WGPU * 4;
    this._glassUbo = device.createBuffer({
      size: floats * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._glassUboData = new Float32Array(floats);
  }
  _glassDestroy() {
    if (this._glassUbo) { try { this._glassUbo.destroy(); } catch (_) { /* noop */ } this._glassUbo = null; }
    this._glassPipeline = null;
    this._glassUboData = null;
  }
  // Same cell-pack shape as ripples — copy/paste of the per-cell
  // visibility test + UV/radius pack.
  _glassCollectCells() {
    const buf = this._glassUboData;
    const cells = (this.sim && this.sim.cells) || [];
    const W = this.W, H = this.H;
    const minAx = Math.max(1, Math.min(W, H));
    const CELLS_OFF = 8;
    let n = 0;
    for (let i = 0; i < cells.length && n < GLASS_MAX_WGPU; i++) {
      const c = cells[i];
      const s = this.sim.worldToScreen(c.x, c.y);
      const m = c.r * 1.5;
      if (s.x < -m || s.y < -m || s.x > W + m || s.y > H + m) continue;
      const off = CELLS_OFF + n * 4;
      buf[off + 0] = s.x / W;
      buf[off + 1] = s.y / H;
      buf[off + 2] = (c.r * this.camera.scale) / minAx;
      buf[off + 3] = 0;
      n++;
    }
    for (let i = CELLS_OFF + n * 4; i < buf.length; i++) buf[i] = 0;
    return n;
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
              { shaderLocation: 7, offset: 84, format: 'float32'   }, // a_diskAlpha (split-end crossfade)
              { shaderLocation: 8, offset: 88, format: 'float32x2' }, // a_bump (bump-feedback squash axis)
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

  // RT pool acquisition for the metaball pass. Returns an entry with
  // two textures (A/B for blur ping-pong). Sizing follows S.metaRtMode:
  //   'bbox'        — bbox + padding, rounded up to a 64-px grid.
  //   'fullCanvas'  — full canvas physical size.
  //   'sharedMax'   — pairIdx is forced to 0; size grows monotonically.
  _metaAcquireRt(pairIdx, reqW, reqH) {
    const device = this.device;
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
      const tex = device.createTexture({
        size: { width: targetW, height: targetH },
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      return { tex, view: tex.createView() };
    };
    const a = make();
    const b = make();

    // Persistent per-pair uniform buffers + bind groups, so per-frame
    // work is just writeBuffer + setBindGroup + draw. Bind groups are
    // recreated whenever textures change (i.e. when the entry's size
    // changes or the entry is first allocated).
    const polyU = device.createBuffer({
      size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const blurUH = device.createBuffer({
      size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const blurUV = device.createBuffer({
      size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const tintU = device.createBuffer({
      // 6 vec4: src_origin + canvas_mid + gr_k + cytoTop + cytoBot + outlineCol = 96 bytes.
      size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const polyBg = device.createBindGroup({
      layout: this._metaPolyPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: polyU } }],
    });
    const blurBgH = device.createBindGroup({
      layout: this._metaBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: blurUH } },
        { binding: 1, resource: this._metaSampler },
        { binding: 2, resource: a.view },
      ],
    });
    const blurBgV = device.createBindGroup({
      layout: this._metaBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: blurUV } },
        { binding: 1, resource: this._metaSampler },
        { binding: 2, resource: b.view },
      ],
    });
    const tintBg = device.createBindGroup({
      layout: this._metaTintPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: tintU } },
        { binding: 1, resource: this._metaSampler },
        { binding: 2, resource: a.view },
      ],
    });

    entry = {
      texA: a.tex, viewA: a.view,
      texB: b.tex, viewB: b.view,
      w: targetW, h: targetH,
      polyU, blurUH, blurUV, tintU,
      polyBg, blurBgH, blurBgV, tintBg,
    };
    this._metaPool[pairIdx] = entry;
    return entry;
  }

  _metaFreeEntry(entry) {
    if (!entry) return;
    if (entry.texA) { try { entry.texA.destroy(); } catch {} }
    if (entry.texB) { try { entry.texB.destroy(); } catch {} }
    if (entry.polyU)  { try { entry.polyU.destroy(); }  catch {} }
    if (entry.blurUH) { try { entry.blurUH.destroy(); } catch {} }
    if (entry.blurUV) { try { entry.blurUV.destroy(); } catch {} }
    if (entry.tintU)  { try { entry.tintU.destroy(); }  catch {} }
  }

  _metaDestroyPool() {
    for (const entry of this._metaPool) this._metaFreeEntry(entry);
    this._metaPool = [];
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
    this.context.configure({ device: this.device, format: this.format, alphaMode: RT_ALPHA_MODE });
    // Pool textures are sized to the canvas in 'fullCanvas' mode; force
    // a rebuild on resize. Also invalidates 'sharedMax' / 'bbox' since
    // padding scales with canvas; safest is to wipe the pool.
    this._metaDestroyPool();
  }

  beginFrame(/* timeMs, dt */) {
    if (!this.device || !this.context) return;
    this._frameEncoder = this.device.createCommandEncoder();
    const tex = this.context.getCurrentTexture();
    this._frameView = tex.createView();
    // Build the post-pin chain of enabled FBO passes by walking
    // S.overlayOrder from just-above-pin upward (= rendering order:
    // first item is closest to the scene pin, runs first). Mirrors
    // webgl2.js beginFrame. microscope-blur and duotone share the
    // sceneFx WGSL module so they collapse to a single 'sceneFx'
    // chain step.
    const order = Array.isArray(S.overlayOrder) ? S.overlayOrder : [];
    const pinIdx = order.indexOf('scene');
    this._postChain = [];
    if (pinIdx > 0) {
      for (let i = pinIdx - 1; i >= 0; i--) {
        const k = order[i];
        if (k === 'ripples' && S.liquidRipples) {
          this._postChain.push('ripples');
        } else if (k === 'caustics' && S.causticsOverlay) {
          this._postChain.push('caustics');
        } else if (k === 'glass' && S.glassMembrane) {
          this._postChain.push('glass');
        } else if ((k === 'microscope' || k === 'duotone')
                   && (S.microscopeBlur || S.makeItReal)) {
          if (!this._postChain.includes('sceneFx')) this._postChain.push('sceneFx');
        }
      }
    }
    const ripplesBgOnly = !!S.liquidRipples && !overlayKindRunsAfterScene('ripples');

    // Default scene target is the canvas. If any post-pin chain step
    // is enabled, redirect to the shared ping-pong front RT and the
    // chain in endFrame composites through to the canvas.
    this._sceneView = this._frameView;
    if (this._postChain.length > 0) {
      this._postEnsureRts();
      for (const k of this._postChain) {
        if (k === 'ripples')  this._rippleBgEnsurePipeline();
        if (k === 'caustics') this._causticBgEnsurePipeline();
        if (k === 'glass')    this._glassEnsurePipeline();
        if (k === 'sceneFx')  this._sceneFxEnsurePipeline();
      }
      this._postSource = this._postRtA;
      this._sceneView = this._postSource.view;
    } else if (this._postRtA) {
      this._postDestroyRts();
    }
    if (ripplesBgOnly) {
      this._rippleBgEnsureRt();
      this._rippleBgEnsurePipeline();
    } else if (this._rippleBgRt) {
      this._rippleBgDestroy();
    }
  }

  drawBackground(timeMs) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!this._bgPipeline) return;       // pipeline not yet created
    // Rendertest translucent: skip every bg pipeline and just emit a
    // clear-only pass with alpha=0 to the scene target. Cell passes
    // composite on top with their own alpha where they paint.
    if (RT_TRANSLUCENT) {
      const pass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._sceneView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.end();
      this._lastFrameSec = (timeMs || 0) * 0.001 * (S.bgFlowSpeed || 1);
      return;
    }
    const layers = currentBgLayers();
    const t = (timeMs || 0) * 0.001 * (S.bgFlowSpeed || 1);

    // Reactor (Gray-Scott): run the simulation step once per frame if
    // ANY layer references kind='reactor'. Reactor layers all sample
    // the same RT, so a single step suffices regardless of how many
    // reactor layers exist in the stack. Per-layer fields (seedCount,
    // reseedSec, simSpeed) come from the first reactor layer.
    const reactorLayer = layers.find(l => l.kind === 'reactor');
    const hasReactor = !!reactorLayer;
    if (hasReactor) {
      this._reactorEnsureRts();
      const reseedSec = Math.max(0.1, +reactorLayer.reseedSec || 10);
      if (timeMs - this._reactorLastSeedMs > reseedSec * 1000) {
        const seedCount = Math.max(1, Math.min(REACTOR_MAX_SEEDS_WGPU,
          Math.round(+reactorLayer.seedCount || 6)));
        this._reactorSeed(seedCount);
        this._reactorLastSeedMs = timeMs;
      }
      const simSpeed = Math.max(0, Math.min(15,
        Math.round(+reactorLayer.simSpeed ?? 5)));
      if (simSpeed > 0) this._reactorStep(simSpeed);
    } else if (this._reactorRtA) {
      // No layer references reactor — release RT GPU memory. Pipelines
      // + the sampler + dummy stay so a return to the theme is cheap.
      this._reactorDestroy();
    }

    // Bg-only ripple mode (ripples below the scene pin): redirect
    // the entire bg stack into the ripple RT, then run the ripple
    // post-pass straight back to _frameView. Scene-wide mode
    // (ripples above the pin) is handled by endFrame() instead.
    const bgOnlyRipples = !!S.liquidRipples && !overlayKindRunsAfterScene('ripples');
    let bgTarget = this._sceneView;
    if (bgOnlyRipples) {
      this._rippleBgEnsureRt();
      this._rippleBgEnsurePipeline();
      bgTarget = this._rippleBgRt.view;
    }

    if (layers.length === 0) {
      // No enabled layers — clear-only pass so subsequent draws
      // (cells, particles, …) aren't painted over stale pixels.
      const pass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: bgTarget,
          clearValue: { r: 0, g: 0, b: 0, a: RT_CLEAR_A },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.end();
    } else {
      for (let li = 0; li < layers.length; li++) {
        const bg = layers[li];
        this._writeBgLayerUniforms(bg, t);

        // Pick the texture view BG_WGSL's binding 2 sees for this
        // layer: the active reactor RT (front side, post-step) for
        // kind == 'reactor', else the 1x1 dummy. Built fresh each
        // layer because the front index ping-pongs.
        const isReactor = (bg.kind === 'reactor' && !!this._reactorRtA);
        const bgTexView = isReactor
          ? this._reactorRt(this._reactorFront).view
          : this._reactorDummyView;
        // Tissue (kind == 11) lazy texture lookup. Returns a 1x1
        // dummy view until the image decodes — the shader simply
        // shows uniform tint in the meantime.
        const isTissue = (bg.kind === 'tissue');
        const tissueView = isTissue
          ? this._tissueTexView(bg.textureUrl)
          : this._tissueDummyView();
        const pipeline = (li === 0)
          ? this._bgPipeline
          : (this._bgBlendPipelines[bg.blend] || this._bgBlendPipelines.normal);
        const bgBindGroup = this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this._bgUniformBuffer } },
            { binding: 1, resource: this._reactorSampler },
            { binding: 2, resource: bgTexView },
            { binding: 3, resource: this._tissueSampler() },
            { binding: 4, resource: tissueView },
          ],
        });
        const pass = this._frameEncoder.beginRenderPass({
          colorAttachments: [{
            view: bgTarget,
            // First layer clears; subsequent layers composite onto
            // whatever the previous layers wrote.
            clearValue: { r: 0, g: 0, b: 0, a: RT_CLEAR_A },
            loadOp: (li === 0) ? 'clear' : 'load',
            storeOp: 'store',
          }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bgBindGroup);
        pass.draw(3, 1, 0, 0);             // big-triangle, 3 verts, no VBO
        pass.end();
      }
    }
    if (bgOnlyRipples && this._rippleBgPipeline) {
      const cellCount = this._rippleBgCollectCells();
      const u = this._rippleBgUboData;
      u[0] = t;
      u[1] = cellCount;
      u[2] = this.canvas.width;
      u[3] = this.canvas.height;
      u[4] = S.rippleDensity ?? 1.5;
      u[5] = S.rippleReach ?? 0.7;
      u[6] = S.rippleStrength ?? 1.0;
      u[7] = 0;
      this.device.queue.writeBuffer(
        this._rippleBgUbo, 0,
        u.buffer, u.byteOffset, u.byteLength,
      );
      const bind = this.device.createBindGroup({
        layout: this._rippleBgPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._rippleBgUbo } },
          { binding: 1, resource: this._rippleBgSampler },
          { binding: 2, resource: this._rippleBgRt.view },
        ],
      });
      // Write the rippled bg to the current scene target — _postRtA
      // when the post-pin chain is on, else directly to the canvas
      // surface. Cells/particles render on top after this.
      const post = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._sceneView,
          clearValue: { r: 0, g: 0, b: 0, a: RT_CLEAR_A },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      post.setPipeline(this._rippleBgPipeline);
      post.setBindGroup(0, bind);
      post.draw(3, 1, 0, 0);
      post.end();
    }
    this._lastFrameSec = t;            // endFrame's post-pass reads this
  }

  _writeBgLayerUniforms(bg, t) {
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

    const data = this._bgUniformData;
    // misc (kind, vignette, gridStep, time)
    data[0] = kind;
    data[1] = bg.vignette || 0;
    data[2] = bg.gridStep || 48;
    data[3] = t;
    // cam (.w = camera.rotation in radians — the bg shader reads it
    // via cRBg/sRBg in fs_main so the bg pattern rotates with the
    // camera when pinch-rotation is on). bgScale lives in extra.y.
    data[4] = this.camera.scale;
    data[5] = this.camera.tx;
    data[6] = this.camera.ty;
    data[7] = this.camera.rotation || 0;
    // vp (W, H, spotCount, rbcOn)
    const count = Math.min(MAX_SPOTS, bg.spotCount || 0);
    data[8] = this.W;
    data[9] = this.H;
    data[10] = count;
    data[11] = bg.rbcSilhouettes ? 1 : 0;
    // extra (opacity, bgScale, _, _)
    data[12] = (typeof bg.opacity === 'number') ? bg.opacity : 1;
    data[13] = S.bgScale != null ? S.bgScale : 1;
    data[14] = 0;
    data[15] = 0;
    // base / top / bot / ringColor / gridColor (each vec4 with .a = 0 padding)
    const writeRgb = (off, css, fallback) => {
      const c = cssToGpuColor(css || '', fallback);
      data[off]     = c.r;
      data[off + 1] = c.g;
      data[off + 2] = c.b;
      data[off + 3] = 0;
    };
    writeRgb(16, bg.base,                       { r: 0, g: 0, b: 0, a: 1 });
    writeRgb(20, bg.topColor || bg.base,        { r: 0, g: 0, b: 0, a: 1 });
    writeRgb(24, bg.botColor || bg.base,        { r: 0, g: 0, b: 0, a: 1 });
    writeRgb(28, bg.ringColor || 'rgba(120,80,30,0.5)',  { r: 120/255, g: 80/255, b: 30/255, a: 0.5 });
    writeRgb(32, bg.gridColor || 'rgba(0,255,170,0.5)',  { r: 0, g: 1, b: 170/255, a: 0.5 });
    // spots[8] + spotCols[8]: drift positions and pre-multiplied colours
    const spotCols = Array.isArray(bg.spotColors) ? bg.spotColors : null;
    const fallbackCol = bg.spotColor || 'rgba(255,255,255,0.10)';
    for (let i = 0; i < MAX_SPOTS; i++) {
      const s = this._spots[i];
      const cx = s.ax + s.ox1 * Math.sin(t * s.w1 + s.phx);
      const cy = s.ay + s.oy1 * Math.cos(t * s.w2 + s.phy);
      data[36 + i * 4]     = cx;
      data[36 + i * 4 + 1] = cy;
      data[36 + i * 4 + 2] = s.r;
      data[36 + i * 4 + 3] = 0;
      const colSrc = spotCols ? spotCols[i % spotCols.length] : fallbackCol;
      const c = cssToGpuColor(colSrc, { r: 1, g: 1, b: 1, a: 0.10 });
      data[68 + i * 4]     = c.r * c.a;
      data[68 + i * 4 + 1] = c.g * c.a;
      data[68 + i * 4 + 2] = c.b * c.a;
      data[68 + i * 4 + 3] = 0;
    }
    this.device.queue.writeBuffer(
      this._bgUniformBuffer, 0, data.buffer, data.byteOffset, data.byteLength,
    );
  }

  drawCells(shapes, time /*, timeMs */) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!shapes || shapes.length === 0) return;
    const device = this.device;

    // Partition: SPLITTING-cell halves go through the metaball path
    // when S.metaSplit is on; everything else feeds the disk pass.
    // Pairs with only one half in view fall back to singleton (matches
    // canvas2d / webgl2). See render/webgl2.js for the canonical spec.
    const useMetaSplit = !!S.metaSplit;
    const splittingByCellId = useMetaSplit ? new Map() : null;
    const singletons = useMetaSplit ? [] : shapes;
    if (useMetaSplit) {
      for (const s of shapes) {
        if (s.cell.state === 'SPLITTING') {
          let arr = splittingByCellId.get(s.cell.id);
          if (!arr) { arr = []; splittingByCellId.set(s.cell.id, arr); }
          arr.push(s);
          // Disk-pass crossfade: re-include the half over p ∈ [0.5, 1.0]
          // so the disk content reaches full opacity by the moment
          // finishSplit fires and the metaball pass stops. No pop.
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

    if (singletons.length > 0) {
      this._growInstanceBuffer(singletons.length);
      const data = this._instanceData;
      const outlineRgb = hexToRgb(currentTheme().outline.color);
      const sel = this.sim.selectedCells;
      for (let i = 0; i < singletons.length; i++) {
        const s = singletons[i];
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
        // testKind (0..20) packed at bit 13 (multiplier 8192). Read in
        // fs_main as testKind() and dispatched only when u_theme != 0.
        const tk = testKindFor(c.type);
        const kind = bodyK + nucK * 16 + isSel * 256 + hollow * 4096 + tk * 8192;
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
        data[j + 21] = (s.diskAlpha !== undefined) ? s.diskAlpha : 1;
        data[j + 22] = c.bumpX || 0;
        data[j + 23] = c.bumpY || 0;
      }
      device.queue.writeBuffer(
        this._instanceBuffer, 0,
        data.buffer, data.byteOffset, singletons.length * INSTANCE_STRIDE,
      );

      // Pack uniform buffer: cameraVp, misc, highlight, cameraRot.
      const u = this._uniformData;
      const cam = this.camera;
      u[0] = cam.scale; u[1] = cam.tx; u[2] = cam.ty; u[3] = this.W;
      u[4] = this.H;
      u[5] = time;
      u[6] = S.wobbleAmp || 0;
      u[7] = (typeof S.membraneIntensity === 'number') ? S.membraneIntensity : 0.55;
      const hl = hexToRgb(currentHighlightColor());
      u[8] = hl[0]; u[9] = hl[1]; u[10] = hl[2];
      // GPU border = base cell-border slider × global line-thickness
      // slider (same composition as webgl2.js so the two backends
      // stay visually aligned).
      u[11] = ((typeof S.cellBorderThickness === 'number') ? S.cellBorderThickness : 3.0)
            * ((typeof S.lineThickness === 'number') ? S.lineThickness : 1.0);
      u[12] = cam.rotation || 0;
      // u[13] cell-shader theme id (0 legacy, 1 microscope, 2 cartoon,
      // 3 kurzgesagt, 4 classic) — read by fs_main as u.cameraRot.y.
      u[13] = _wgpuThemeId(S.theme);
      // u[14..15] padding
      device.queue.writeBuffer(this._uniformBuffer, 0, u.buffer, u.byteOffset, u.byteLength);

      const pass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._sceneView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this._diskPipeline);
      pass.setBindGroup(0, this._diskBindGroup);
      pass.setVertexBuffer(0, this._cornerBuffer);
      pass.setVertexBuffer(1, this._instanceBuffer);
      pass.draw(6, singletons.length, 0, 0);
      pass.end();
    }

    if (splittingByCellId && splittingByCellId.size > 0) {
      this._renderSplittingPairs(splittingByCellId, time);
    }

    // Per-cell decorations layer on top of the disk pass (matches
    // webgl2's render order). Faces draw last so they sit above
    // decoration lines.
    this._drawDecorations(shapes, time);
    if (S.cartoon) this._drawFacesPass(shapes, time);
  }

  // Per-pair metaball pass (S.metaSplit). Renders both halves' wobble
  // polygons in white into an offscreen RT, separable Gaussian blur,
  // then a single fragment pass folds together the alpha threshold and
  // the canvas2d 3-stop radial-gradient tint, alpha-blended onto the
  // canvas. See header for the RT-sizing strategy (S.metaRtMode).
  _renderSplittingPairs(splittingByCellId, time) {
    const device = this.device;
    const cam = this.camera;
    const fbW = this.canvas.width;
    const fbH = this.canvas.height;
    // CSS-px → physical-px scale (dpr * renderScale). field.blur is in
    // CSS px; the RT lives at physical px so multiply for the kernel.
    const pxScale = fbW / Math.max(1, this.W);

    // Rebuild the pool when the mode changes so settings toggles take
    // effect on the next frame.
    const mode = (S.metaRtMode === 'fullCanvas' || S.metaRtMode === 'sharedMax')
      ? S.metaRtMode : 'bbox';
    if (mode !== this._metaResolvedMode) {
      this._metaDestroyPool();
      this._metaResolvedMode = mode;
    }

    // Triangulated polygon storage. Each half = WOBBLE_VERTS triangles
    // (centre + two adjacent rim verts), so 32 tris × 3 verts × 2 floats
    // = 192 floats per half, 384 floats per pair.
    const triFloatsPerHalf = WOBBLE_VERTS * 3 * 2;
    const polyData = this._metaPolyData;

    // Per-pair scratch arrays for rim verts (re-used).
    const rimX = new Float32Array(WOBBLE_VERTS);
    const rimY = new Float32Array(WOBBLE_VERTS);

    let pairIdx = 0;
    for (const [, pair] of splittingByCellId) {
      const c = pair[0].cell;
      const cType = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const fld = cType.field || { blur: 6, contrast: 20 };
      const cc = cellColors(c);
      const blurPx = Math.max(0, fld.blur * pxScale);
      const padPx = Math.ceil(blurPx * 3 + 4);

      // Build triangulated polygon vertex stream and the bbox.
      let off = 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let mx = 0, my = 0;
      let maxR = 0;
      for (let p = 0; p < pair.length; p++) {
        const s = pair[p];
        mx += (s.x * cam.scale + cam.tx) * pxScale;
        my += (s.y * cam.scale + cam.ty) * pxScale;
        maxR = Math.max(maxR, s.r * cam.scale * pxScale);
        let cxAcc = 0, cyAcc = 0;
        for (let i = 0; i < WOBBLE_VERTS; i++) {
          const v = shapeVertex(s, THETA_TABLE[i], time);
          const px = (v.x * cam.scale + cam.tx) * pxScale;
          const py = (v.y * cam.scale + cam.ty) * pxScale;
          rimX[i] = px;
          rimY[i] = py;
          cxAcc += px; cyAcc += py;
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        const cxC = cxAcc / WOBBLE_VERTS;
        const cyC = cyAcc / WOBBLE_VERTS;
        // Triangulate as fan: tri[i] = (centre, rim[i], rim[(i+1) % N]).
        for (let i = 0; i < WOBBLE_VERTS; i++) {
          const j = (i + 1) % WOBBLE_VERTS;
          polyData[off++] = cxC;     polyData[off++] = cyC;
          polyData[off++] = rimX[i]; polyData[off++] = rimY[i];
          polyData[off++] = rimX[j]; polyData[off++] = rimY[j];
        }
      }
      mx /= pair.length;
      my /= pair.length;
      const gr = Math.max(maxR, 1) * 1.95;

      // Bbox in canvas physical px (top-left), clamped to canvas.
      const bboxX = Math.max(0, Math.floor(minX - padPx));
      const bboxY = Math.max(0, Math.floor(minY - padPx));
      const bboxRight = Math.min(fbW, Math.ceil(maxX + padPx));
      const bboxBottom = Math.min(fbH, Math.ceil(maxY + padPx));
      const bboxW = bboxRight - bboxX;
      const bboxH = bboxBottom - bboxY;
      if (bboxW <= 0 || bboxH <= 0) { pairIdx++; continue; }

      const acquireIdx = (mode === 'sharedMax') ? 0 : pairIdx;
      const rt = this._metaAcquireRt(
        acquireIdx,
        (mode === 'fullCanvas') ? fbW : bboxW,
        (mode === 'fullCanvas') ? fbH : bboxH,
      );

      // For 'fullCanvas': RT covers the canvas, polygon uses canvas
      // coords directly, tint pass viewport restricts to bbox.
      // For 'bbox' / 'sharedMax': RT origin = bbox top-left, polygon
      // coords subtract that, tint pass converts back via uniform.
      const rtOriginX = (mode === 'fullCanvas') ? 0 : bboxX;
      const rtOriginY = (mode === 'fullCanvas') ? 0 : bboxY;

      // Upload polygon verts to the GPU buffer.
      device.queue.writeBuffer(this._metaPolyBuffer, 0, polyData.buffer, polyData.byteOffset, off * 4);

      // Per-pair uniform writes — bind groups + buffers live on the
      // pool entry so this is just data updates.
      const cytoTop = hexToRgb(cc.cytoTop);
      const cytoBot = hexToRgb(cc.cytoBot);
      device.queue.writeBuffer(rt.polyU, 0,
        new Float32Array([rt.w, rt.h, rtOriginX, rtOriginY]));
      device.queue.writeBuffer(rt.blurUH, 0, new Float32Array([
        rt.w, rt.h,
        1.0 / rt.w, 0,
        blurPx, 0, 0, 0,
      ]));
      device.queue.writeBuffer(rt.blurUV, 0, new Float32Array([
        rt.w, rt.h,
        0, 1.0 / rt.h,
        blurPx, 0, 0, 0,
      ]));
      // Outline mode: 0 = trace blob edge in this shader; 1 = sdf
      // (per-half line strokes), 2 = polygon (union strokes). For 1/2
      // the in-shader rim is suppressed; the line strokes happen via
      // the decoration line pipeline elsewhere.
      const outlineModeIdx = (S.metaOutlineMode === 'sdf') ? 1
        : (S.metaOutlineMode === 'polygon') ? 2 : 0;
      device.queue.writeBuffer(rt.tintU, 0, new Float32Array([
        rt.w, rt.h, rtOriginX, rtOriginY,
        fbW, fbH, mx, my,
        gr, fld.contrast, outlineModeIdx, 0.06,
        cytoTop[0], cytoTop[1], cytoTop[2], 0,
        cytoBot[0], cytoBot[1], cytoBot[2], 0,
        cytoBot[0], cytoBot[1], cytoBot[2], 0,
      ]));

      // Sub-viewport on the RT (for fullCanvas mode the RT is canvas-
      // sized; for bbox / sharedMax the RT IS the bbox region).
      const subX = (mode === 'fullCanvas') ? bboxX : 0;
      const subY = (mode === 'fullCanvas') ? bboxY : 0;

      // ---- Pass 1: poly fill into scratchA ----
      const polyPass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: rt.viewA,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      polyPass.setPipeline(this._metaPolyPipeline);
      polyPass.setBindGroup(0, rt.polyBg);
      polyPass.setVertexBuffer(0, this._metaPolyBuffer);
      polyPass.draw(off / 2, 1, 0, 0);
      polyPass.end();

      // ---- Pass 2: horizontal blur scratchA → scratchB ----
      const blurHPass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: rt.viewB,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      blurHPass.setPipeline(this._metaBlurPipeline);
      blurHPass.setBindGroup(0, rt.blurBgH);
      blurHPass.setViewport(subX, subY, bboxW, bboxH, 0, 1);
      blurHPass.draw(4, 1, 0, 0);
      blurHPass.end();

      // ---- Pass 3: vertical blur scratchB → scratchA ----
      const blurVPass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: rt.viewA,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      blurVPass.setPipeline(this._metaBlurPipeline);
      blurVPass.setBindGroup(0, rt.blurBgV);
      blurVPass.setViewport(subX, subY, bboxW, bboxH, 0, 1);
      blurVPass.draw(4, 1, 0, 0);
      blurVPass.end();

      // ---- Pass 4: tint+threshold scratchA → main canvas ----
      const tintPass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._sceneView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      tintPass.setPipeline(this._metaTintPipeline);
      tintPass.setBindGroup(0, rt.tintBg);
      tintPass.setViewport(bboxX, bboxY, bboxW, bboxH, 0, 1);
      tintPass.draw(4, 1, 0, 0);
      tintPass.end();

      pairIdx++;
    }
  }

  // Selection ring + brighten wash are inline in the disk fragment
  // shader (folded in via the `sel` packed bit, same as webgl2). What's
  // left here is the target marker — pulsing circle + dashed lines from
  // each selected cell to the marker point — drawn when sim.targetMarker
  // is set. Decorations + debug overlay are still deferred.
  drawSelection(/* shapes, time */) {
    if (!this._frameEncoder || !this._frameView) return;
    if (this.sim && this.sim.targetMarker) this._drawTargetMarker();
  }

  _drawTargetMarker() {
    const device = this.device;
    const m = this.sim.targetMarker;
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
    const age = (now - m.t0) / 1500;
    if (age >= 1) {
      this.sim.targetMarker = null;
      return;
    }
    const fade = 1 - age;
    const cam = this.camera;
    const camScale = cam.scale;

    // ---- Dashed lines from each selected cell to the marker ----
    const sel = this.sim.selectedCells;
    if (sel && sel.size > 0) {
      const verts = [];
      for (const c of sel) {
        if (c.state !== 'NORMAL') continue;
        const dx = m.x - c.x, dy = m.y - c.y;
        const screenLen = Math.hypot(dx, dy) * camScale;
        verts.push(c.x, c.y, 0);
        verts.push(m.x, m.y, screenLen);
      }
      if (verts.length > 0) {
        const arr = new Float32Array(verts);
        const vertCount = verts.length / 3;
        this._ensureDashCapacity(vertCount);
        device.queue.writeBuffer(this._dashVertexBuffer, 0, arr.buffer, arr.byteOffset, arr.byteLength);
        device.queue.writeBuffer(this._dashUniformBuffer, 0, new Float32Array([
          camScale, cam.tx, cam.ty, cam.rotation || 0,
          this.W, this.H, -now * 0.04, fade,
        ]));
        const pass = this._frameEncoder.beginRenderPass({
          colorAttachments: [{ view: this._sceneView, loadOp: 'load', storeOp: 'store' }],
        });
        pass.setPipeline(this._dashPipeline);
        pass.setBindGroup(0, this._dashBindGroup);
        pass.setVertexBuffer(0, this._dashVertexBuffer);
        pass.draw(vertCount, 1, 0, 0);
        pass.end();
      }
    }

    // ---- Pulsing circle + inner dot at the marker ----
    const ringWorld = (18 / camScale) * (1 + 0.4 * age);
    const innerWorld = 4 / camScale;
    const quadR = ringWorld + 6 / camScale;
    device.queue.writeBuffer(this._markerUniformBuffer, 0, new Float32Array([
      camScale, cam.tx, cam.ty, cam.rotation || 0,
      this.W, this.H, m.x, m.y,
      quadR, age, innerWorld / quadR, ringWorld / quadR,
      (3 / camScale) / quadR, 0, 0, 0,
    ]));
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: this._sceneView, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this._markerPipeline);
    pass.setBindGroup(0, this._markerBindGroup);
    pass.setVertexBuffer(0, this._cornerBuffer);
    pass.draw(6, 1, 0, 0);
    pass.end();
  }

  // Particle pass — kill-mode protein/gut explosions. One instanced
  // quad per particle. sim.particles entries: { x, y, vx, vy, r, color
  // (hex string), life, maxLife }.
  drawParticles(particles /* , time, timeMs */) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!particles || particles.length === 0) return;
    const device = this.device;
    this._growParticleBuffer(particles.length);
    const data = this._particleData;
    let n = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const a = Math.max(0, Math.min(1, p.life / Math.max(p.maxLife, 1e-3)));
      if (a <= 0) continue;
      const rgb = hexToRgb(p.color || '#ffffff');
      const j = n * 8;
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
    device.queue.writeBuffer(
      this._particleInstanceBuffer, 0,
      data.buffer, data.byteOffset, n * 32,
    );
    const cam = this.camera;
    device.queue.writeBuffer(this._particleUniformBuffer, 0, new Float32Array([
      cam.scale, cam.tx, cam.ty, cam.rotation || 0,
      this.W, this.H, 0, 0,
    ]));
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: this._sceneView, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this._particlePipeline);
    pass.setBindGroup(0, this._particleBindGroup);
    pass.setVertexBuffer(0, this._cornerBuffer);
    pass.setVertexBuffer(1, this._particleInstanceBuffer);
    pass.draw(6, n, 0, 0);
    pass.end();
  }

  // Y-shaped antibody sprites. Per-instance pack:
  //   (x, y, angle, alpha) + (R, G, B, scale)
  // Vertex shader rotates+scales the unit Y by per-instance angle/scale,
  // applies the camera, drops to clip space. Birth flash + expiry fade
  // are computed JS-side from each antibody's life ratio (mirrors
  // canvas2d.drawAntibodies + webgl2.drawAntibodies).
  drawAntibodies(antibodies, _t, ts) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!antibodies || antibodies.length === 0) return;
    const device = this.device;
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
      const rgb = hexToRgb(a.color || '#ffe14a');
      const j = n * 8;
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
    device.queue.writeBuffer(
      this._antibodyInstanceBuffer, 0,
      data.buffer, data.byteOffset, n * 32,
    );
    const cam = this.camera;
    device.queue.writeBuffer(this._antibodyUniformBuffer, 0, new Float32Array([
      cam.scale, cam.tx, cam.ty, cam.rotation || 0,
      this.W, this.H, 0, 0,
    ]));
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: this._sceneView, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this._antibodyPipeline);
    pass.setBindGroup(0, this._antibodyBindGroup);
    pass.setVertexBuffer(0, this._antibodyUnitBuffer);
    pass.setVertexBuffer(1, this._antibodyInstanceBuffer);
    pass.draw(6, n, 0, 0);
    pass.end();
  }

  // Cartoon-face pass. Called from drawCells (after the disk pass)
  // when S.cartoon is on. Per-cell instance: position + radius +
  // mouth kind, eye config (count / size / Y / pupil size), look
  // direction + mouth width + blink, mouth Y + animation phase, mouth
  // colour. Cells with no eyes and no mouth are skipped.
  _drawFacesPass(shapes, time) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!shapes || shapes.length === 0) return;
    const device = this.device;
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
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
      // Smoothed look-at unit vector — see sim.update lerp.
      const lm = Math.hypot(c.lookX, c.lookY) || 1;
      const lookX = c.lookX / lm, lookY = c.lookY / lm;
      if (now > c.nextBlink) c.nextBlink = now + 120 + 3000 + Math.random() * 3500;
      const blink = ((c.nextBlink - now) < 120 && (c.nextBlink - now) > 0) ? 1 : 0;
      // Mouth fill colour: hard-coded black so it reads high-contrast
      // on every theme + at every zoom level. Matches canvas2d +
      // webgl2 paths.
      const mcRgb = [0, 0, 0];
      // Face follows each shape entry. During SPLITTING getShapes
      // emits two entries with correct half centres + radius
      // (shape.js:96-97); for NORMAL cells s.{x,y,r} === c.{x,y,r}.
      const j = n * 19;
      data[j]      = s.x;
      data[j + 1]  = s.y;
      data[j + 2]  = s.r;
      data[j + 3]  = mouthKind;
      data[j + 4]  = eyesCount;
      data[j + 5]  = cfg.eyeR != null ? cfg.eyeR : 0.18;
      data[j + 6]  = cfg.eyeY != null ? cfg.eyeY : -0.10;
      data[j + 7]  = cfg.pupilR != null ? cfg.pupilR : 0.07;
      data[j + 8]  = lookX;
      data[j + 9]  = lookY;
      data[j + 10] = 0.34 * 1.2;          // mouthW (half-extent in body-r units)
      data[j + 11] = blink;
      data[j + 12] = 0.18;                // mouthY
      data[j + 13] = c.phase || 0;
      // SPLITTING envelope (sine, peaks mid-split, zero at endpoints):
      //   blur (slot 14): widens every smoothstep edge in fs_main.
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
    device.queue.writeBuffer(
      this._faceInstanceBuffer, 0,
      data.buffer, data.byteOffset, n * 76,
    );
    const cam = this.camera;
    device.queue.writeBuffer(this._faceUniformBuffer, 0, new Float32Array([
      cam.scale, cam.tx, cam.ty, cam.rotation || 0,
      this.W, this.H, time, (S.faceScale != null ? S.faceScale : 1),
    ]));
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: this._sceneView, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this._facePipeline);
    pass.setBindGroup(0, this._faceBindGroup);
    pass.setVertexBuffer(0, this._cornerBuffer);
    pass.setVertexBuffer(1, this._faceInstanceBuffer);
    pass.draw(6, n, 0, 0);
    pass.end();
  }

  endFrame() {
    if (!this._frameEncoder) return;
    // Walk the post-pin overlay chain (built in beginFrame): each
    // enabled FBO pass reads from _postSource and writes to the
    // other ping-pong RT, then we swap. The last step writes
    // straight to _frameView (the canvas surface). Finally the
    // cheap FX overlays (noise / vignette / crosshair) layer on
    // top via pre-baked blend pipelines — they remain outside the
    // FBO chain.
    const t = this._lastFrameSec || 0;
    if (this._postChain && this._postChain.length > 0 && this._postSource) {
      for (let i = 0; i < this._postChain.length; i++) {
        const kind = this._postChain[i];
        const isLast = (i === this._postChain.length - 1);
        const dst = isLast ? null
                           : (this._postSource === this._postRtA ? this._postRtB : this._postRtA);
        const dstView = dst ? dst.view : this._frameView;
        this._runPostPass(kind, this._postSource.view, dstView, t);
        if (!isLast) this._postSource = dst;
      }
      this._postChain = [];
      this._postSource = null;
    }
    this._fxOverlayDraw(t);
    this.device.queue.submit([this._frameEncoder.finish()]);
    this._frameEncoder = null;
    this._frameView = null;
    this._sceneView = null;
  }

  // Run a single post-pin chain step. Reads from `srcView` and
  // writes to `dstView` (one of the ping-pong RTs, or the canvas
  // surface for the last step).
  _runPostPass(kind, srcView, dstView, t) {
    if (kind === 'ripples' && this._rippleBgPipeline) {
      const cellCount = this._rippleBgCollectCells();
      const u = this._rippleBgUboData;
      u[0] = t;
      u[1] = cellCount;
      u[2] = this.canvas.width;
      u[3] = this.canvas.height;
      u[4] = S.rippleDensity ?? 1.5;
      u[5] = S.rippleReach ?? 0.7;
      u[6] = S.rippleStrength ?? 1.0;
      u[7] = 0;
      this.device.queue.writeBuffer(
        this._rippleBgUbo, 0,
        u.buffer, u.byteOffset, u.byteLength,
      );
      const bg = this.device.createBindGroup({
        layout: this._rippleBgPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._rippleBgUbo } },
          { binding: 1, resource: this._rippleBgSampler },
          { binding: 2, resource: srcView },
        ],
      });
      const post = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: dstView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      post.setPipeline(this._rippleBgPipeline);
      post.setBindGroup(0, bg);
      post.draw(3, 1, 0, 0);
      post.end();
    } else if (kind === 'glass' && this._glassPipeline) {
      const cellCount = this._glassCollectCells();
      const u = this._glassUboData;
      u[0] = t;
      u[1] = cellCount;
      u[2] = this.canvas.width;
      u[3] = this.canvas.height;
      u[4] = S.glassStrength ?? 1.0;
      u[5] = S.glassChroma ? 1.0 : 0.0;
      u[6] = S.glassSize ?? 1.0;
      u[7] = 0;
      this.device.queue.writeBuffer(
        this._glassUbo, 0,
        u.buffer, u.byteOffset, u.byteLength,
      );
      const bg = this.device.createBindGroup({
        layout: this._glassPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._glassUbo } },
          { binding: 1, resource: this._rippleBgSampler },
          { binding: 2, resource: srcView },
        ],
      });
      const post = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: dstView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      post.setPipeline(this._glassPipeline);
      post.setBindGroup(0, bg);
      post.draw(3, 1, 0, 0);
      post.end();
    } else if (kind === 'caustics' && this._causticBgPipeline) {
      this._causticBgUboData[0] = t;
      this._causticBgUboData[4] = S.causticTintR ?? 0.0;
      this._causticBgUboData[5] = S.causticTintG ?? 1.35;
      this._causticBgUboData[6] = S.causticTintB ?? 0.5;
      this.device.queue.writeBuffer(
        this._causticBgUbo, 0,
        this._causticBgUboData.buffer, this._causticBgUboData.byteOffset,
        this._causticBgUboData.byteLength,
      );
      const bg = this.device.createBindGroup({
        layout: this._causticBgPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._causticBgUbo } },
          { binding: 1, resource: this._causticBgSampler },
          { binding: 2, resource: srcView },
        ],
      });
      const post = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: dstView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      post.setPipeline(this._causticBgPipeline);
      post.setBindGroup(0, bg);
      post.draw(3, 1, 0, 0);
      post.end();
    } else if (kind === 'sceneFx' && this._sceneFxPipeline) {
      const u = this._sceneFxUboData;
      u[0] = this.canvas.width;
      u[1] = this.canvas.height;
      u[2] = 0; u[3] = 0;
      u[4] = S.microscopeBlur ? 1 : 0;
      u[5] = S.microscopeFocus ?? 0.35;
      u[6] = S.microscopeBlurStrength ?? 0.5;
      u[7] = S.microscopeFalloff ?? 0.5;
      u[8]  = S.makeItReal ? 1 : 0;
      u[9]  = S.makeItRealHue1 ?? 0.30;
      u[10] = S.makeItRealHue2 ?? 0.55;
      u[11] = S.makeItRealSaturation ?? 0.55;
      this.device.queue.writeBuffer(
        this._sceneFxUbo, 0,
        u.buffer, u.byteOffset, u.byteLength,
      );
      const bg = this.device.createBindGroup({
        layout: this._sceneFxPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._sceneFxUbo } },
          { binding: 1, resource: this._sceneFxSampler },
          { binding: 2, resource: srcView },
        ],
      });
      const post = this._frameEncoder.beginRenderPass({
        colorAttachments: [{
          view: dstView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      post.setPipeline(this._sceneFxPipeline);
      post.setBindGroup(0, bg);
      post.draw(3, 1, 0, 0);
      post.end();
    }
  }

  // Decoration pass (S.metaSplit-independent). Per-type spikes /
  // tendrils / flagella / cilia / drips / legs / fuzz / Y-receptors.
  // Geometry is generated CPU-side (each helper pushes line + triangle
  // verts into shared arrays); two GPU draws upload + render the
  // accumulated data. The helpers are 1:1 ports of webgl2.js's
  // _decor* methods — same Math, same constants — so the visual
  // output matches.
  _drawDecorations(shapes, time) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!shapes || shapes.length === 0) return;
    this._decorLines.length = 0;
    this._decorTris.length = 0;
    // Half-width for thick decoration lines, in world units. Each
    // unit of S.lineThickness ≈ 1 CSS pixel at the current zoom.
    // WebGPU has no line-width API at all, so _pushLine emits a
    // screen-space-thick quad into _decorTris instead — the slider
    // now visibly thickens cell + pathogen decorations (spikes,
    // tendrils, flagella, cilia, drips, …).
    const lt = (typeof S.lineThickness === 'number') ? S.lineThickness : 1.0;
    const cs = (this.camera && this.camera.scale) || 1;
    this._decorHalfW = (lt * 0.5) / Math.max(0.001, cs);
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
  // approximate union of the two halves.
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
        const col = hexToRgb(cc.cytoBot);
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
    // line-list draw path can't honour the lineThickness slider —
    // WebGPU has no line-width API — so all decoration lines go
    // through the triangle pipeline. Endpoints are extended by
    // halfW along the segment direction so chained segments
    // (flagella waves, tendril curves) overlap at joints instead
    // of showing a notch.
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const hw = this._decorHalfW || 0.5;
    const tx = dx / len, ty = dy / len;
    const nx = -ty * hw,  ny =  tx * hw;
    const ex =  tx * hw,  ey =  ty * hw;
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
    arr.push(
      p0[0], p0[1], r, g, b, a,
      p1[0], p1[1], r, g, b, a,
      p2[0], p2[1], r, g, b, a,
    );
  }

  _uploadAndDrawDecorations() {
    const device = this.device;
    const cam = this.camera;
    device.queue.writeBuffer(this._decorUniformBuffer, 0, new Float32Array([
      cam.scale, cam.tx, cam.ty, cam.rotation || 0,
      this.W, this.H, 0, 0,
    ]));

    if (this._decorLines.length > 0) {
      const arr = new Float32Array(this._decorLines);
      const vertCount = this._decorLines.length / 6;
      this._ensureDecorLineCapacity(vertCount);
      device.queue.writeBuffer(
        this._decorLineBuffer, 0,
        arr.buffer, arr.byteOffset, arr.byteLength,
      );
      const pass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{ view: this._sceneView, loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(this._decorLinePipeline);
      pass.setBindGroup(0, this._decorBindGroup);
      pass.setVertexBuffer(0, this._decorLineBuffer);
      pass.draw(vertCount, 1, 0, 0);
      pass.end();
    }
    if (this._decorTris.length > 0) {
      const arr = new Float32Array(this._decorTris);
      const vertCount = this._decorTris.length / 6;
      this._ensureDecorTriCapacity(vertCount);
      device.queue.writeBuffer(
        this._decorTriBuffer, 0,
        arr.buffer, arr.byteOffset, arr.byteLength,
      );
      const pass = this._frameEncoder.beginRenderPass({
        colorAttachments: [{ view: this._sceneView, loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(this._decorTriPipeline);
      pass.setBindGroup(0, this._decorBindGroup);
      pass.setVertexBuffer(0, this._decorTriBuffer);
      pass.draw(vertCount, 1, 0, 0);
      pass.end();
    }
  }

  // ---------- Per-decoration helpers (1:1 with webgl2.js) ----------

  _decorBigSpikes(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const accent = hexToRgb(cc.accent);
    const outline = hexToRgb(theme.outline.color);
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
    const accent = hexToRgb(cc.accent);
    const outline = hexToRgb(theme.outline.color);
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
    const col = hexToRgb(cc.cytoBot);
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
    const col = hexToRgb(cc.cytoBot);
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
    const col = hexToRgb(cc.accent);
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
    const fill = hexToRgb(cc.cytoBot);
    const outline = hexToRgb(theme.outline.color);
    const N = 5;
    for (let i = 0; i < N; i++) {
      const dirAng = Math.PI * 0.5 - 0.40 + (i / (N - 1)) * 0.80;
      const base = shapeVertex(s, dirAng, t);
      const drop = s.r * 0.22 + s.r * 0.06 * Math.sin(t * 1.8 + i);
      const wL = [base.x - s.r * 0.06, base.y];
      const wR = [base.x + s.r * 0.06, base.y];
      const tip = [base.x, base.y + drop * 1.2];
      const ctrl = [base.x, base.y + drop];
      this._pushTri(wL, ctrl, wR, fill[0], fill[1], fill[2], 1.0);
      this._pushTri(wL, tip, ctrl, fill[0], fill[1], fill[2], 1.0);
      this._pushTri(ctrl, tip, wR, fill[0], fill[1], fill[2], 1.0);
      this._pushLine(wL[0], wL[1], tip[0], tip[1], outline[0], outline[1], outline[2], 1.0);
      this._pushLine(tip[0], tip[1], wR[0], wR[1], outline[0], outline[1], outline[2], 1.0);
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
    const outline = hexToRgb(theme.outline.color);
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
    const col = hexToRgb(cc.accent);
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
    const col = hexToRgb(cc.accent);
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

  /** Short identifier for the FPS overlay's renderer suffix. */
  get info() { return 'webgpu'; }

  destroy() {
    this._destroyed = true;
    if (this.context) {
      try { this.context.unconfigure(); } catch {}
      this.context = null;
    }
    const tryDestroy = (b) => { if (b) { try { b.destroy(); } catch {} } };
    tryDestroy(this._instanceBuffer);
    tryDestroy(this._cornerBuffer);
    tryDestroy(this._uniformBuffer);
    tryDestroy(this._metaPolyBuffer);
    tryDestroy(this._dashUniformBuffer);
    tryDestroy(this._dashVertexBuffer);
    tryDestroy(this._markerUniformBuffer);
    tryDestroy(this._particleUniformBuffer);
    tryDestroy(this._particleInstanceBuffer);
    tryDestroy(this._antibodyUniformBuffer);
    tryDestroy(this._antibodyInstanceBuffer);
    tryDestroy(this._antibodyUnitBuffer);
    tryDestroy(this._faceUniformBuffer);
    tryDestroy(this._faceInstanceBuffer);
    tryDestroy(this._bgUniformBuffer);
    tryDestroy(this._decorUniformBuffer);
    tryDestroy(this._decorLineBuffer);
    tryDestroy(this._decorTriBuffer);
    this._metaDestroyPool();
    this._reactorDestroy();
    this._causticBgDestroy();
    this._rippleBgDestroy();
    this._sceneFxDestroy();
    this._postDestroyRts();
    tryDestroy(this._reactorStepUniformBuffer);
    tryDestroy(this._reactorSeedUniformBuffer);
    tryDestroy(this._reactorDummyTex);
    this._instanceBuffer = null;
    this._cornerBuffer = null;
    this._uniformBuffer = null;
    this._metaPolyBuffer = null;
    this._dashUniformBuffer = null;
    this._dashVertexBuffer = null;
    this._markerUniformBuffer = null;
    this._particleUniformBuffer = null;
    this._particleInstanceBuffer = null;
    this._faceUniformBuffer = null;
    this._faceInstanceBuffer = null;
    this._decorUniformBuffer = null;
    this._decorLineBuffer = null;
    this._decorTriBuffer = null;
    this._bgUniformBuffer = null;
    this._diskPipeline = null;
    this._diskBindGroup = null;
    this._metaPolyPipeline = null;
    this._metaBlurPipeline = null;
    this._metaTintPipeline = null;
    this._metaSampler = null;
    this._dashPipeline = null;
    this._dashBindGroup = null;
    this._markerPipeline = null;
    this._markerBindGroup = null;
    this._particlePipeline = null;
    this._particleBindGroup = null;
    this._facePipeline = null;
    this._faceBindGroup = null;
    this._bgPipeline = null;
    this._bgBindGroup = null;
    this._decorLinePipeline = null;
    this._decorTriPipeline = null;
    this._decorBindGroup = null;
    if (this.device) {
      try { this.device.destroy(); } catch {}
      this.device = null;
    }
    this.format = null;
  }
}
