// Microbes — pure shape / wobble math.
//
// Module-level pure functions used by both renderers and the metaball pipeline.
// No DOM access; safe to import in Node for tests.

import { CELL_TYPES, S } from './state.js';

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
export function shapeVertex(s, theta, t) {
  const c = s.cell;
  const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
  const kind = (type.body && type.body.kind) || 'round';
  const aspect = (type.body && type.body.aspect) || 1.0;
  const seed = c.wobbleSeed;
  const phi = c.phase;

  let scale = 1;
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
