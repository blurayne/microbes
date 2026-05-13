// Microbes — pure shape / wobble math.
//
// Module-level pure functions used by both renderers and the metaball pipeline.
// No DOM access; safe to import in Node for tests.

import { CELL_TYPES, S } from './state.js';
import { testKindFor } from './cell-kinds.js';

// Per-test-kind silhouette modulation, ported from the GPU disc
// shader's `testShape()` (webgl2.js / webgpu.js). Active only when
// the user has a non-legacy theme selected, mirroring the
// `themeId != 0` branch in the shader. Keeps the metaball pass
// (which polys this function for every wobble vertex) and any other
// caller of `shapeVertex` aligned with the GPU's per-theme cell
// silhouette — without this, splitting cells turn into smooth blobs
// that ignore the virus capsid lattice, dendritic tendrils, etc.
function _themeShape(tk, ang, t) {
  switch (tk) {
    case 5: // virus — hex capsid + sharp spikes
      return 1.0
        + 0.10 * Math.cos(ang * 6 + t * 0.30)
        + 0.12 * Math.pow(0.5 + 0.5 * Math.cos(ang * 12 - t * 0.20), 6);
    case 6: { // bacterium — ellipse (approx of capsule)
      const cx = Math.cos(ang), sy = Math.sin(ang);
      return 1.0 / Math.sqrt(cx * cx * 0.42 + sy * sy * 1.55);
    }
    case 7: // amoeba — irregular pseudopod blob
      return 1.10
        + 0.20 * Math.sin(ang * 3 + t * 0.40)
        + 0.10 * Math.sin(ang * 7 - t * 0.25);
    case 8: // spore — small disc with a thin breath
      return 0.85 + 0.025 * Math.sin(t * 0.4);
    case 9: // monocyte — high-frequency surface ripple
      return 1.15
        + 0.06 * Math.sin(ang * 11 + t * 0.50)
        + 0.03 * Math.sin(ang * 23 - t * 0.30);
    case 10: { // mast cell — taller than wide
      const cx = Math.cos(ang), sy = Math.sin(ang);
      return 1.0 / Math.sqrt(cx * cx * 0.72 + sy * sy * 1.21);
    }
    case 11: // dendritic — round body + 6 long thin tendrils
      return 1.0 + 0.45 * Math.pow(0.5 + 0.5 * Math.cos(ang * 6 + t * 0.20), 14);
    case 13: // platelet — small 10-point star
      return 0.85 + 0.10 * Math.cos(ang * 10);
    case 17: // germ — small 3-lobe blob
      return 0.95 + 0.16 * Math.cos(ang * 3 + t * 0.40);
    case 18: // slime mold — irregular lobed (chaotic)
      return 1.10
        + 0.18 * Math.sin(ang * 4  + t * 0.30)
        + 0.10 * Math.sin(ang * 7  - t * 0.50)
        + 0.08 * Math.sin(ang * 11 + t * 0.80);
    case 19: // mite — round with 4 small leg bumps
      return 1.05 + 0.13 * Math.pow(0.5 + 0.5 * Math.cos(ang * 4 + 0.5), 8);
    case 20: // toxin — sharp 10-point spike star
      return 0.95 + 0.30 * Math.pow(0.5 + 0.5 * Math.cos(ang * 10 + t * 0.30), 4);
    default:
      // Generic round (eukaryote / macrophage / neutrophil / nk /
      // bcell / basophil / tcell / eosinophil / rbc) — keep round
      // and let the kAmp-weighted wobble below give identity.
      return 1.0;
  }
}

// Per-test-kind wobble amplitude. Same table as the disc-shader's
// non-legacy branch — higher for big soft cells (macrophage, b-cell),
// dialled down for the small hard-edged ones.
function _themeKAmp(tk) {
  switch (tk) {
    case 1:  return 1.60;   // macrophage
    case 2:  return 0.50;   // neutrophil
    case 3:  return 0.40;   // nk
    case 4:  return 0.60;   // bcell
    case 12: return 0.30;   // basophil
    case 14: return 0.25;   // tcell
    case 15: return 0.35;   // eosinophil
    default: return 1.0;    // eukaryote + everyone else
  }
}

// Two-harmonic base jiggle keyed off the cell's stable seed and frequency.
export function wobbleAt(c, theta, t) {
  const s = c.wobbleSeed;
  const w1 = Math.sin(t * 0.55 * c.wobbleFreq + theta * 3 + s);
  const w2 = Math.sin(t * 0.85 * c.wobbleFreq + theta * 5 + s * 1.31 + c.phase);
  const mul = (CELL_TYPES[c.type] && CELL_TYPES[c.type].field && CELL_TYPES[c.type].field.wobbleMul) || 1;
  return (S.wobbleAmp || 0) * mul * (w1 * 0.65 + w2 * 0.45);
}

// Returns the world-space (x,y) of a vertex on the cell's outline at angle theta.
// Used by the metaball polygon and decoration passes so spikes/cilia/etc. align
// exactly with the wobbly membrane.
//
// Theme-aware: when `S.theme !== 'legacy'`, the radial scale is
// derived from the per-test-kind silhouette table (mirroring the
// GPU disc-shader's `testShape()` branch). Without this, splitting
// cells under microscope / cartoon / kurzgesagt / classic themes
// fell back to the bodyKind wobble polygon and lost the
// virus-capsid / dendritic-tendril / star-spike modulation that
// the disc pass shows for non-splitting cells.
export function shapeVertex(s, theta, t) {
  const c = s.cell;
  const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
  const kind = (type.body && type.body.kind) || 'round';
  const aspect = (type.body && type.body.aspect) || 1.0;
  const seed = c.wobbleSeed;
  const phi = c.phase;
  const themeActive = S.theme && S.theme !== 'legacy';

  let scale = 1;
  if (themeActive) {
    // Mirror the disc-shader's non-legacy branch — testShape silhouette
    // + a 3-term Fourier wobble scaled by the per-kind amplitude. The
    // freq-sign trick gives split children divergent wobble even when
    // they inherit the parent's seed.
    const tk = testKindFor(c.type);
    const dir = Math.sign((c.wobbleFreq || 1) + 1e-6);
    const tt = t * dir;
    const kAmp = _themeKAmp(tk);
    let wob = kAmp * (
      0.045 * Math.sin(theta * 5  + tt * 0.60 + phi) +
      0.025 * Math.sin(theta * 9  - tt * 0.40 + phi * 1.31) +
      0.015 * Math.sin(theta * 17 + tt * 1.10 + phi * 0.71)
    );
    const wobbleMul = (type.field && type.field.wobbleMul) || 1.0;
    wob *= Math.max(0.001, (S.wobbleAmp || 0) * wobbleMul);
    scale = _themeShape(tk, theta, tt) + wob;
  } else {
    switch (kind) {
      case 'lobed':
        scale = 1
          + 0.16 * Math.sin(3 * theta + phi)
          + 0.08 * Math.sin(5 * theta + phi * 1.7);
        break;
      case 'rippled':
        scale = 1
          + 0.04 * Math.sin(24 * theta + phi)
          + 0.015 * Math.sin(8 * theta + phi * 0.7);
        break;
      case 'pseudopod':
        scale = 1
          + 0.20 * Math.sin(3 * theta + 0.8 * t * c.wobbleFreq + phi)
          + 0.06 * Math.sin(5 * theta - 0.5 * t * c.wobbleFreq + seed);
        break;
      case 'star': {
        const N = 10;
        scale = 0.85 + 0.45 * Math.abs(Math.sin((N / 2) * theta + phi));
        break;
      }
      case 'oblong':
      case 'round':
      default:
        scale = 1 + wobbleAt(c, theta, t);
    }

    if (kind !== 'star' && kind !== 'lobed' && kind !== 'pseudopod') {
      scale += wobbleAt(c, theta, t) * 0.4;
    }
  }

  let rx = Math.cos(theta) * s.r * scale;
  let ry = Math.sin(theta) * s.r * scale;
  if (aspect !== 1.0) {
    rx *= aspect;
    const cosA = Math.cos(c.orientation);
    const sinA = Math.sin(c.orientation);
    const ox = rx * cosA - ry * sinA;
    const oy = rx * sinA + ry * cosA;
    rx = ox; ry = oy;
  }
  return { x: s.x + rx, y: s.y + ry };
}

// Frustum-cull a circle in world space against a viewport in screen space.
// Mirrors the forward transform in `Sim.worldToScreen` so a rotated camera
// culls correctly: screen = R(θ) · (world · scale) + (tx, ty). Without
// this rotation step, cells whose un-rotated screen position fell outside
// [0, W] × [0, H] were incorrectly culled even when their actual rotated
// position was on-canvas — the body vanished while the nucleus (drawn via
// withCameraCtx without an inView check) stayed visible. Reduces to the
// original `x*scale + t` math when rotation === 0.
export function inView(x, y, r, camera, W, H) {
  const co = Math.cos(camera.rotation || 0);
  const si = Math.sin(camera.rotation || 0);
  const wsx = x * camera.scale;
  const wsy = y * camera.scale;
  const sx = co * wsx - si * wsy + camera.tx;
  const sy = si * wsx + co * wsy + camera.ty;
  const sr = (r + 12) * camera.scale;
  return sx + sr >= 0 && sx - sr <= W && sy + sr >= 0 && sy - sr <= H;
}

// Build the per-frame draw list. Splits a SPLITTING cell into its two virtual
// halves and culls cells outside the viewport. Returns an array of
// `{ x, y, r, cell }` shape records (one per visible body).
export function getShapes(cells, t, camera, W, H) {
  const out = [];
  for (const c of cells) {
    if (c.state === 'SPLITTING') {
      const p = c.splitProgress;
      // Half-centre offset ramps to 1.05·r at p=1 — exactly matching
      // finishSplit's sep (sim.js: cell.r * 1.05) so the new cells
      // appear at the same spot the visual halves had at the moment
      // of transition. Fixes the "split-end jump".
      const half = c.r * (0.05 + p * 1.0);
      const a = c.splitAngle;
      const dx = Math.cos(a) * half;
      const dy = Math.sin(a) * half;
      const rr = c.r * (1.0 - p * 0.05);
      if (!inView(c.x - dx, c.y - dy, rr, camera, W, H)
       && !inView(c.x + dx, c.y + dy, rr, camera, W, H)) continue;
      out.push({ x: c.x - dx, y: c.y - dy, r: rr, cell: c });
      out.push({ x: c.x + dx, y: c.y + dy, r: rr, cell: c });
    } else {
      if (!inView(c.x, c.y, c.r * 1.6, camera, W, H)) continue;
      out.push({ x: c.x, y: c.y, r: c.r, cell: c });
    }
  }
  return out;
}

// Halves of a SPLITTING cell, in world coordinates. Used by drawNuclei
// to draw two nuclei during splitting.
export function splitVirtualCenters(c) {
  const p = c.splitProgress;
  const half = c.r * (0.05 + p * 1.15);
  const a = c.splitAngle;
  const dx = Math.cos(a) * half;
  const dy = Math.sin(a) * half;
  return [
    { x: c.x - dx, y: c.y - dy, r: c.r * (1.0 - p * 0.05) },
    { x: c.x + dx, y: c.y + dy, r: c.r * (1.0 - p * 0.05) },
  ];
}
