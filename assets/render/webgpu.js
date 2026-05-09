// Microbes — hand-rolled WebGPU renderer.
//
// Companion to assets/render/webgl2.js — same author, same layering,
// using the WebGPU API + WGSL shaders. Independent from Pixi's
// internal WebGPU backend (reachable via the "Pixi (WebGPU)" dropdown
// option).
//
// Coverage: instanced SDF disks (round / lobed / rippled / oblong /
// pseudopod / star) with per-type nucleus, membrane, selection ring,
// flash overlay; per-pair metaSplit metaball merge with three
// configurable RT-sizing strategies (S.metaRtMode). Decorations,
// cartoon faces, dashed-line target marker, particles, and the debug
// overlay are still deferred — they layer on top in follow-up commits.
//
// Async note: WebGPU's adapter + device requests are async, but the
// IRenderer interface's init() is sync. Mirroring the PixiRenderer
// pattern, init() is a no-op and a separate initAsync() does the real
// work; app.js's makeRenderer awaits it.

import {
  S, FACE, CELL_TYPES, WOBBLE_VERTS, THETA_TABLE,
  currentBackground, currentTheme, currentHighlightColor, cellColors,
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
const INSTANCE_FLOATS = 21;
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
  // (gr, K, _, _)
  gr_k: vec4<f32>,
  // (cytoTop.rgb, _)
  cytoTop: vec4<f32>,
  // (cytoBot.rgb, _)
  cytoBot: vec4<f32>,
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
  let a = thresholded * alphaMul;
  return vec4<f32>(col, a);
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
  @location(3) cfg2: vec4<f32>,      // (blink, mouthY, phase, _)
  @location(4) mouthCol: vec3<f32>,
};

@vertex fn vs_main(
  @location(0) corner: vec2<f32>,
  @location(1) inst: vec4<f32>,        // (worldX, worldY, r, mouthKind)
  @location(2) eyes: vec4<f32>,        // (eyesCount, eyeR, eyeY, pupilR)
  @location(3) look: vec4<f32>,        // (lookX, lookY, mouthW, blink)
  @location(4) mouth: vec4<f32>,       // (mouthY, phase, _, _)
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
  out.cfg2 = vec4<f32>(look.w, mouth.x, mouth.y, 0.0);
  out.mouthCol = mouthCol;
  return out;
}

// Mirrors webgl2.js's arcA / discA helpers exactly so the visual is
// 1:1 (mouth & eye geometry, sizes, smoothstep edges).
fn discA(uv: vec2<f32>, c: vec2<f32>, r: f32) -> f32 {
  return 1.0 - smoothstep(r * 0.92, r, length(uv - c));
}
fn arcA(uv: vec2<f32>, c: vec2<f32>, r: f32, hw: f32, a0: f32, a1: f32) -> f32 {
  let d = uv - c;
  let dist = abs(length(d) - r);
  let band = 1.0 - smoothstep(hw * 0.5, hw, dist);
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
        let wA = 1.0 - smoothstep(0.92, 1.0, ed);
        col = mix(col, vec3<f32>(1.0), wA);
        a = max(a, wA);
      } else {
        let ed = length(d) / max(eyeR, 0.001);
        if (ed < 1.05) {
          let white = 1.0 - smoothstep(0.92, 1.0, ed);
          col = mix(col, vec3<f32>(1.0), white);
          a = max(a, white);
          let pupilCentre = ec + look * (eyeR * 0.45);
          let pd = length(uv - pupilCentre) / max(pupilR, 0.001);
          let pupilA = 1.0 - smoothstep(0.92, 1.05, pd);
          col = mix(col, vec3<f32>(0.06, 0.07, 0.09), pupilA);
          a = max(a, pupilA);
          let glintCentre = pupilCentre - vec2<f32>(pupilR * 0.35, pupilR * 0.35);
          let gd = length(uv - glintCentre) / max(pupilR * 0.30, 0.001);
          let glintA = (1.0 - smoothstep(0.92, 1.05, gd)) * 0.85;
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
      0.12 * PI, 0.88 * PI);
    col = mix(col, in.mouthCol, arc);
    a = max(a, arc);
    if (mouthKind == 6) {
      let dripPhase = fract(time * 0.6 + phase);
      let dripC = vec2<f32>(mouthW * 0.25, mouthY + mouthW * 0.25 + dripPhase * mouthW * 0.8);
      let dr = (uv - dripC) / vec2<f32>(mouthW * 0.10, mouthW * 0.16);
      let dripA = (1.0 - smoothstep(0.85, 1.0, length(dr))) * (1.0 - dripPhase);
      col = mix(col, vec3<f32>(0.47, 0.86, 0.51), dripA);
      a = max(a, dripA);
    }
  } else if (mouthKind == 2) {
    // FROWN
    let arc = arcA(uv, vec2<f32>(0.0, mouthY + mouthW * 0.6), mouthW, 0.04,
      1.12 * PI, 1.88 * PI);
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
      let zigA = 1.0 - smoothstep(0.02, 0.04, dy);
      col = mix(col, in.mouthCol, zigA);
      a = max(a, zigA);
    }
  } else if (mouthKind == 4) {
    // FANGS — open ellipse + two white wedges.
    let dn = d / vec2<f32>(mouthW, mouthW * 0.45);
    let open = 1.0 - smoothstep(0.92, 1.0, length(dn));
    col = mix(col, in.mouthCol, open);
    a = max(a, open);
    let fL = vec2<f32>(-mouthW * 0.40, mouthY + mouthW * 0.10);
    let fR = vec2<f32>( mouthW * 0.40, mouthY + mouthW * 0.10);
    let fLA = 1.0 - smoothstep(0.85, 1.0,
      length((uv - fL) / vec2<f32>(mouthW * 0.10, mouthW * 0.32)));
    let fRA = 1.0 - smoothstep(0.85, 1.0,
      length((uv - fR) / vec2<f32>(mouthW * 0.10, mouthW * 0.32)));
    let fA = max(fLA, fRA);
    col = mix(col, vec3<f32>(1.0), fA);
    a = max(a, fA);
  } else if (mouthKind == 5) {
    // TONGUE — open ellipse + pink wagging tongue below.
    let dn = d / vec2<f32>(mouthW, mouthW * 0.40);
    let open = 1.0 - smoothstep(0.92, 1.0, length(dn));
    col = mix(col, in.mouthCol, open);
    a = max(a, open);
    let wag = sin(time * 5.0 + phase) * mouthW * 0.18;
    let tc = vec2<f32>(wag, mouthY + mouthW * 0.30);
    let td = (uv - tc) / vec2<f32>(mouthW * 0.32, mouthW * 0.22);
    let tA = 1.0 - smoothstep(0.85, 1.0, length(td));
    col = mix(col, vec3<f32>(1.0, 0.54, 0.63), tA);
    a = max(a, tA);
  }

  if (a <= 0.0) { discard; }
  return vec4<f32>(col, a);
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

    // Cartoon faces (S.cartoon).
    this._facePipeline = null;
    this._faceUniformBuffer = null;
    this._faceBindGroup = null;
    this._faceInstanceBuffer = null;
    this._faceCapacity = 0;             // face-bearing cells
    this._faceData = new Float32Array(0);

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
      size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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

    // Partition: SPLITTING-cell halves go through the metaball path
    // when S.metaSplit is on; everything else feeds the disk pass.
    // Pairs with only one half in view fall back to singleton (matches
    // canvas2d / pixi). See render/webgl2.js for the canonical spec.
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
      pass.draw(6, singletons.length, 0, 0);
      pass.end();
    }

    if (splittingByCellId && splittingByCellId.size > 0) {
      this._renderSplittingPairs(splittingByCellId, time);
    }

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
      device.queue.writeBuffer(rt.tintU, 0, new Float32Array([
        rt.w, rt.h, rtOriginX, rtOriginY,
        fbW, fbH, mx, my,
        gr, fld.contrast, 0, 0,
        cytoTop[0], cytoTop[1], cytoTop[2], 0,
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
      const j = n * 19;
      data[j]      = c.x;
      data[j + 1]  = c.y;
      data[j + 2]  = c.r;
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
      data[j + 14] = 0;
      data[j + 15] = 0;
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
    if (this.device) {
      try { this.device.destroy(); } catch {}
      this.device = null;
    }
    this.format = null;
  }
}
