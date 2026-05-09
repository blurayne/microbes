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
  currentBackground, currentTheme, currentHighlightColor, cellColors, frac,
} from '../core/state.js';
import { shapeVertex } from '../core/shape.js';
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
const INSTANCE_FLOATS = 22;
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
  out.diskAlpha = in.diskAlpha;
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

  var col = cyto;
  col = mix(col, nucColor, vec3<f32>(nucleusMask));
  // Border colour: 0.55 × cytoBot — darker than the previous 0.80 so a
  // bolder rim reads with more contrast against the body fill.
  col = mix(col, in.cytoBot * 0.55, vec3<f32>(clamp(outlineMask, 0.0, 1.0)));

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
  let screenPos = pos * camScale + camT;
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
  let screenPos = worldPos * camScale + camT;
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

// ---------- Background: gradient + spots + drifting RBC silhouettes ----
// Mirrors webgl2.js FRAG_BG (lines 249-340) bit-for-bit. One uniform
// buffer carries kind/vignette/grid/time + camera + viewport +
// spot/RBC flags + 5 colour vec4s + 8 spot vec4s + 8 spot-colour vec4s.
// Vertex shader is the canonical big-triangle (3 verts cover the clip
// rect) so no VBO is needed.
const MAX_SPOTS = 8;
const BG_WGSL = /* wgsl */ `
struct BgU {
  // (kind, vignette, gridStep, time)
  misc: vec4<f32>,
  // (camera.scale, camera.tx, camera.ty, _)
  cam: vec4<f32>,
  // (viewportW, viewportH, spotCount, rbcOn)
  vp: vec4<f32>,
  base: vec4<f32>,
  top: vec4<f32>,
  bot: vec4<f32>,
  ringColor: vec4<f32>,
  gridColor: vec4<f32>,
  spots: array<vec4<f32>, ${MAX_SPOTS}>,
  spotCols: array<vec4<f32>, ${MAX_SPOTS}>,
};
@group(0) @binding(0) var<uniform> u: BgU;

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
  // 0..1 with v=0 at the bottom of the framebuffer (matches webgl2).
  out.uv  = (p + vec2<f32>(1.0, 1.0)) * 0.5;
  return out;
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

  var col = u.base.rgb;
  if (kind == 1) {
    col = mix(u.top.rgb, u.bot.rgb, uv.y);
  }

  // World-space pixel.
  let screenPx = uv * viewport;
  let worldPx = (screenPx - vec2<f32>(camTx, camTy)) / max(camScale, 0.0001);

  // Petri-dish concentric rings — 1px thin at every 32 world units.
  if (kind == 2) {
    let ctr = viewport * 0.5;
    let r = length(worldPx - ctr);
    let nearestRing = floor(r / 32.0 + 0.5) * 32.0;
    let dToRing = abs(r - nearestRing);
    let pxWorld = 1.0 / max(camScale, 0.0001);
    let band = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.5, dToRing);
    col = mix(col, u.ringColor.rgb, band * 0.18);
  }

  // Cyber grid — thin lines every gridStep world units in both axes.
  if (kind == 3) {
    let g = worldPx - floor(worldPx / gridStep) * gridStep;
    let dToLine = min(g, vec2<f32>(gridStep, gridStep) - g);
    let pxWorld = 1.0 / max(camScale, 0.0001);
    let lineX = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.x);
    let lineY = 1.0 - smoothstep(pxWorld * 0.4, pxWorld * 1.4, dToLine.y);
    let line = max(lineX, lineY);
    col = mix(col, u.gridColor.rgb, line * 0.30);
  }

  // Drifting light spots — additive, screen UV. Colours pre-multiplied.
  for (var i: i32 = 0; i < ${MAX_SPOTS}; i = i + 1) {
    if (i >= spotCount) { break; }
    let s = u.spots[i];
    let d = distance(uv, s.xy);
    let a = 1.0 - smoothstep(0.0, s.z, d);
    col = col + u.spotCols[i].rgb * a;
  }

  // Drifting RBC silhouettes — bloodstream theme flair. 22 ellipses
  // with darker centre dot, drift on screen UV with time.
  if (rbcOn == 1) {
    for (var i: i32 = 0; i < 22; i = i + 1) {
      let seed = f32(i) * 1.31;
      let fx = fract(f32(i) / 22.0 + 0.06 * sin(time * 0.25 + seed));
      let fy = fract(fract(seed * 0.7) + time * 0.15 + f32(i) * 0.13);
      let c = vec2<f32>(fx, fy);
      let r = 0.018 + 0.016 * fract(seed * 0.21);
      let dEll = (uv - c) / vec2<f32>(r, r * 0.78);
      let ellA = (1.0 - smoothstep(0.85, 1.0, length(dEll))) * 0.10;
      col = mix(col, vec3<f32>(1.0, 0.35, 0.35), ellA);
      let dDot = length(uv - c) / (r * 0.32);
      let dotA = (1.0 - smoothstep(0.88, 1.0, dDot)) * 0.18;
      col = mix(col, vec3<f32>(0.47, 0.08, 0.08), dotA);
    }
  }

  // Vignette: darken the corners.
  if (vignette > 0.0) {
    let v = length(uv - vec2<f32>(0.5, 0.5)) * 1.4;
    let vAmt = vignette * smoothstep(0.4, 1.0, v);
    col = col * (1.0 - vAmt);
  }

  return vec4<f32>(col, 1.0);
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
  let screenPos = worldPos * camScale + camT;
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
  let screenPos = pos * camScale + camT;
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
  cam: vec4<f32>,        // (scale, tx, ty, _)
  vp_time: vec4<f32>,    // (viewportW, viewportH, time, _)
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
  let screenPos = worldPos * camScale + camT;
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
  let in_arc = step(a0, ang) * step(ang, a1);
  return band * in_arc;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let FACE_SCALE: f32 = 1.2;
  let PI: f32 = 3.14159;
  let time = u.vp_time.z;
  let mouthKind = i32(in.cfg0.x + 0.5);
  let eyesCount = i32(in.cfg0.y + 0.5);
  let eyeRBase = in.cfg0.z;
  let eyeY = in.cfg0.w;
  let pupilRBase = in.cfg1.x;
  let look = vec2<f32>(in.cfg1.y, in.cfg1.z);
  let mouthW = in.cfg1.w;
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
    // SMILE (or DROOL — base smile)
    let arc = arcA(uv, vec2<f32>(0.0, mouthY - mouthW * 0.3), mouthW, 0.04,
      0.12 * PI, 0.88 * PI, blur);
    col = mix(col, in.mouthCol, arc);
    a = max(a, arc);
    if (mouthKind == 6) {
      let dripPhase = fract(time * 0.6 + phase);
      let dripC = vec2<f32>(mouthW * 0.25, mouthY + mouthW * 0.25 + dripPhase * mouthW * 0.8);
      let dr = (uv - dripC) / vec2<f32>(mouthW * 0.10, mouthW * 0.16);
      let dripA = (1.0 - sstep(0.85, 1.0, length(dr), blur)) * (1.0 - dripPhase);
      col = mix(col, vec3<f32>(0.47, 0.86, 0.51), dripA);
      a = max(a, dripA);
    }
  } else if (mouthKind == 2) {
    // FROWN
    let arc = arcA(uv, vec2<f32>(0.0, mouthY + mouthW * 0.6), mouthW, 0.04,
      1.12 * PI, 1.88 * PI, blur);
    col = mix(col, in.mouthCol, arc);
    a = max(a, arc);
  } else if (mouthKind == 3) {
    // SNARL — 5-segment zig-zag teeth.
    let xrel = uv.x / max(mouthW, 0.001);
    if (abs(xrel) < 1.0) {
      let seg = floor((xrel + 1.0) * 2.5);
      let segMod = seg - 2.0 * floor(seg * 0.5);
      let yTarget = mouthY + select(0.0, mouthW * 0.18, segMod >= 0.5);
      let dy = abs(uv.y - yTarget);
      let zigA = 1.0 - sstep(0.02, 0.04, dy, blur);
      col = mix(col, in.mouthCol, zigA);
      a = max(a, zigA);
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
    this._uniformData = new Float32Array(12); // (cameraVp, misc, highlight) — 48 bytes
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
    context.configure({ device, format, alphaMode: 'opaque' });

    this.device = device;
    this.context = context;
    this.format = format;

    this._buildDiskPipeline();
    this._growInstanceBuffer(64);
    this._buildMetaPipelines();
    this._buildOverlayPipelines();
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
    // uniform buffer. Uniform layout (96 floats / 384 bytes):
    //   [0..3]    misc (kind, vignette, gridStep, time)
    //   [4..7]    cam  (scale, tx, ty, _)
    //   [8..11]   vp   (W, H, spotCount, rbcOn)
    //   [12..31]  base, top, bot, ringColor, gridColor (5 × vec4)
    //   [32..63]  spots[8] vec4 (cx, cy, r, _) screen 0..1
    //   [64..95]  spotCols[8] vec4 (r, g, b, _) pre-multiplied
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
    this._bgUniformBuffer = device.createBuffer({
      size: 96 * 4,                    // 384 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._bgUniformData = new Float32Array(96);
    this._bgBindGroup = device.createBindGroup({
      layout: this._bgPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._bgUniformBuffer } }],
    });

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
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
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
  }

  drawBackground(timeMs) {
    if (!this._frameEncoder || !this._frameView) return;
    if (!this._bgPipeline) return;       // pipeline not yet created
    const bg = currentBackground();
    const t = (timeMs || 0) * 0.001 * (S.bgFlowSpeed || 1);

    let kind = 0; // flat
    if (bg.kind === 'gradient') kind = 1;
    else if (bg.kind === 'agar') kind = 2;
    else if (bg.kind === 'cybergrid') kind = 3;

    const data = this._bgUniformData;
    // misc
    data[0] = kind;
    data[1] = bg.vignette || 0;
    data[2] = bg.gridStep || 48;
    data[3] = t;
    // cam
    data[4] = this.camera.scale;
    data[5] = this.camera.tx;
    data[6] = this.camera.ty;
    data[7] = 0;
    // vp + spotCount + rbcOn
    const count = Math.min(MAX_SPOTS, bg.spotCount || 0);
    data[8] = this.W;
    data[9] = this.H;
    data[10] = count;
    data[11] = bg.rbcSilhouettes ? 1 : 0;
    // base / top / bot / ringColor / gridColor (each as vec4 with .a = 0 padding)
    const writeRgb = (off, css, fallback) => {
      const c = cssToGpuColor(css || '', fallback);
      data[off]     = c.r;
      data[off + 1] = c.g;
      data[off + 2] = c.b;
      data[off + 3] = 0;
    };
    writeRgb(12, bg.base,                       { r: 0, g: 0, b: 0, a: 1 });
    writeRgb(16, bg.topColor || bg.base,        { r: 0, g: 0, b: 0, a: 1 });
    writeRgb(20, bg.botColor || bg.base,        { r: 0, g: 0, b: 0, a: 1 });
    writeRgb(24, bg.ringColor || 'rgba(120,80,30,0.5)',  { r: 120/255, g: 80/255, b: 30/255, a: 0.5 });
    writeRgb(28, bg.gridColor || 'rgba(0,255,170,0.5)',  { r: 0, g: 1, b: 170/255, a: 0.5 });
    // spots[8] + spotCols[8]: drift positions and pre-multiplied colours
    const spotCols = Array.isArray(bg.spotColors) ? bg.spotColors : null;
    const fallbackCol = bg.spotColor || 'rgba(255,255,255,0.10)';
    for (let i = 0; i < MAX_SPOTS; i++) {
      const s = this._spots[i];
      const cx = s.ax + s.ox1 * Math.sin(t * s.w1 + s.phx);
      const cy = s.ay + s.oy1 * Math.cos(t * s.w2 + s.phy);
      data[32 + i * 4]     = cx;
      data[32 + i * 4 + 1] = cy;
      data[32 + i * 4 + 2] = s.r;
      data[32 + i * 4 + 3] = 0;
      const colSrc = spotCols ? spotCols[i % spotCols.length] : fallbackCol;
      const c = cssToGpuColor(colSrc, { r: 1, g: 1, b: 1, a: 0.10 });
      // Pre-multiply rgb by source alpha so the shader can add directly.
      data[64 + i * 4]     = c.r * c.a;
      data[64 + i * 4 + 1] = c.g * c.a;
      data[64 + i * 4 + 2] = c.b * c.a;
      data[64 + i * 4 + 3] = 0;
    }
    this.device.queue.writeBuffer(
      this._bgUniformBuffer, 0, data.buffer, data.byteOffset, data.byteLength,
    );

    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{
        view: this._frameView,
        // Clear value irrelevant — fragment writes every pixel.
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this._bgPipeline);
    pass.setBindGroup(0, this._bgBindGroup);
    pass.draw(3, 1, 0, 0);             // big-triangle, 3 verts, no VBO
    pass.end();
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
        data[j + 21] = (s.diskAlpha !== undefined) ? s.diskAlpha : 1;
      }
      device.queue.writeBuffer(
        this._instanceBuffer, 0,
        data.buffer, data.byteOffset, singletons.length * INSTANCE_STRIDE,
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
      u[8] = hl[0]; u[9] = hl[1]; u[10] = hl[2];
      u[11] = (typeof S.cellBorderThickness === 'number') ? S.cellBorderThickness : 3.0;
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
          view: this._frameView,
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
          camScale, cam.tx, cam.ty, 0,
          this.W, this.H, -now * 0.04, fade,
        ]));
        const pass = this._frameEncoder.beginRenderPass({
          colorAttachments: [{ view: this._frameView, loadOp: 'load', storeOp: 'store' }],
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
      camScale, cam.tx, cam.ty, 0,
      this.W, this.H, m.x, m.y,
      quadR, age, innerWorld / quadR, ringWorld / quadR,
      (3 / camScale) / quadR, 0, 0, 0,
    ]));
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: this._frameView, loadOp: 'load', storeOp: 'store' }],
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
      cam.scale, cam.tx, cam.ty, 0,
      this.W, this.H, 0, 0,
    ]));
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: this._frameView, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this._particlePipeline);
    pass.setBindGroup(0, this._particleBindGroup);
    pass.setVertexBuffer(0, this._cornerBuffer);
    pass.setVertexBuffer(1, this._particleInstanceBuffer);
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
      const mouthName = cfg.mouth || 'none';
      const mouthKind = MOUTH_KIND_FLOAT[mouthName] || 0;
      if (eyesCount === 0 && mouthKind === 0) continue;
      let lookX = c.vx, lookY = c.vy;
      if (c.alarmTimer > 0 && c.alarmTarget && c.alarmTarget.state === 'NORMAL') {
        lookX = c.alarmTarget.x - c.x;
        lookY = c.alarmTarget.y - c.y;
      }
      const lm = Math.hypot(lookX, lookY) || 1;
      lookX /= lm; lookY /= lm;
      if (now > c.nextBlink) c.nextBlink = now + 120 + 3000 + Math.random() * 3500;
      const blink = ((c.nextBlink - now) < 120 && (c.nextBlink - now) > 0) ? 1 : 0;
      const mc = (CELL_TYPES[c.type] || CELL_TYPES.neutrophil).colors;
      const mcRgb = hexToRgb(mc.nucleus);
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
      cam.scale, cam.tx, cam.ty, 0,
      this.W, this.H, time, 0,
    ]));
    const pass = this._frameEncoder.beginRenderPass({
      colorAttachments: [{ view: this._frameView, loadOp: 'load', storeOp: 'store' }],
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
    this.device.queue.submit([this._frameEncoder.finish()]);
    this._frameEncoder = null;
    this._frameView = null;
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
    const arr = this._decorLines;
    arr.push(x1, y1, r, g, b, a, x2, y2, r, g, b, a);
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
      cam.scale, cam.tx, cam.ty, 0,
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
        colorAttachments: [{ view: this._frameView, loadOp: 'load', storeOp: 'store' }],
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
        colorAttachments: [{ view: this._frameView, loadOp: 'load', storeOp: 'store' }],
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
    tryDestroy(this._faceUniformBuffer);
    tryDestroy(this._faceInstanceBuffer);
    tryDestroy(this._bgUniformBuffer);
    tryDestroy(this._decorUniformBuffer);
    tryDestroy(this._decorLineBuffer);
    tryDestroy(this._decorTriBuffer);
    this._metaDestroyPool();
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
