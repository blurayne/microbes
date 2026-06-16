// Cardiovascular vessel network — capsule-SDF playfield constraint plus
// flowing-RBC particle field. Renderer-agnostic; the sim drives it,
// each renderer consumes `sim.vessels` + `sim.vesselRbcs` to draw.
//
// A vessel is a set of CAPSULES — line segments with a radius. The
// union SDF is `min(segDist - segRadius)` across the set. Cells inside
// the union are unconstrained; cells outside are pushed back along
// the SDF gradient (i.e. the unit vector from the nearest segment
// point to the cell centre).
//
// All three layouts (`branching`, `tube`, `heart`) reduce to one
// capsule list, so the physics + the three renderer passes only need
// to handle one geometric primitive.

// ── Capsule geometry helpers ─────────────────────────────────────────

// Signed distance from point (px, py) to the capsule (x1,y1)-(x2,y2)
// with radius r. Negative inside, positive outside. Also returns the
// closest-segment-point so callers can derive the outward normal
// without a second sqrt.
export function capsuleSDF(px, py, cap) {
  const dx = cap.x2 - cap.x1;
  const dy = cap.y2 - cap.y1;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-6) {
    t = ((px - cap.x1) * dx + (py - cap.y1) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
  }
  const qx = cap.x1 + t * dx;
  const qy = cap.y1 + t * dy;
  const ex = px - qx;
  const ey = py - qy;
  const d = Math.sqrt(ex * ex + ey * ey);
  return { dist: d - cap.r, qx, qy, d, t };
}

// Length of a capsule's centerline (for RBC flow time-base).
export function capsuleLength(cap) {
  const dx = cap.x2 - cap.x1;
  const dy = cap.y2 - cap.y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// Nearest wall info for the union: returns the signed distance to the
// CLOSEST wall (smallest .dist across all capsules) plus the outward
// normal at that point. Used by the per-tick confinement step.
export function nearestVesselWall(vessels, px, py) {
  let best = null;
  for (const cap of vessels.capsules) {
    const s = capsuleSDF(px, py, cap);
    if (best === null || s.dist < best.dist) {
      best = { dist: s.dist, qx: s.qx, qy: s.qy, d: s.d };
    }
  }
  if (!best) return { signedDist: Infinity, nx: 0, ny: 0 };
  let nx = px - best.qx;
  let ny = py - best.qy;
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len > 1e-4) { nx /= len; ny /= len; } else { nx = 0; ny = 1; }
  return { signedDist: best.dist, nx, ny };
}

export function isInsideVessels(vessels, px, py) {
  for (const cap of vessels.capsules) {
    const s = capsuleSDF(px, py, cap);
    if (s.dist <= 0) return true;
  }
  return false;
}

// ── Layout factories ─────────────────────────────────────────────────
//
// Each factory returns:
//   { capsules: [{x1,y1,x2,y2,r,flow}], spawnSeeds: [{x,y}], bbox: {minX,minY,maxX,maxY} }
//
// All coordinates are world units (same frame as sim.W / sim.H). The
// factories are deterministic given the same (W, H, radiusMul) so
// resize + parameter changes produce stable shapes.

function bboxOf(capsules) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of capsules) {
    minX = Math.min(minX, c.x1 - c.r, c.x2 - c.r);
    minY = Math.min(minY, c.y1 - c.r, c.y2 - c.r);
    maxX = Math.max(maxX, c.x1 + c.r, c.x2 + c.r);
    maxY = Math.max(maxY, c.y1 + c.r, c.y2 + c.r);
  }
  return { minX, minY, maxX, maxY };
}

// Branching network: one main horizontal artery, two vertical branches
// off the centre, two thin bifurcations. 6 capsules. "Großzügig" fill —
// covers ~70 % of the viewport.
function buildBranchingNetwork(W, H, radiusMul) {
  const m = Math.max(80, Math.min(W, H) * 0.10);
  const rMain   = Math.max(40, Math.min(W, H) * 0.16) * radiusMul;
  const rBranch = Math.max(28, Math.min(W, H) * 0.10) * radiusMul;
  const rThin   = Math.max(20, Math.min(W, H) * 0.07) * radiusMul;
  const midY = H * 0.5;
  const xL = m, xR = W - m;
  const xBranchA = W * 0.32;
  const xBranchB = W * 0.68;
  const capsules = [
    // Main horizontal artery (flow left → right).
    { x1: xL,       y1: midY,       x2: xR,       y2: midY,       r: rMain,   flow:  1 },
    // Upper vertical branch from xBranchA (flow up).
    { x1: xBranchA, y1: midY,       x2: xBranchA, y2: m,          r: rBranch, flow: -1 },
    // Lower vertical branch from xBranchA (flow down).
    { x1: xBranchA, y1: midY,       x2: xBranchA, y2: H - m,      r: rBranch, flow:  1 },
    // Upper vertical branch from xBranchB.
    { x1: xBranchB, y1: midY,       x2: xBranchB, y2: m,          r: rBranch, flow: -1 },
    // Lower vertical branch from xBranchB.
    { x1: xBranchB, y1: midY,       x2: xBranchB, y2: H - m,      r: rBranch, flow:  1 },
    // Thin top connector linking the two upper branch tips.
    { x1: xBranchA, y1: m,          x2: xBranchB, y2: m,          r: rThin,   flow:  1 },
    // Thin bottom connector.
    { x1: xBranchA, y1: H - m,      x2: xBranchB, y2: H - m,      r: rThin,   flow: -1 },
  ];
  return {
    capsules,
    spawnSeeds: [
      { x: W * 0.5, y: midY },
      { x: xBranchA, y: midY },
      { x: xBranchB, y: midY },
    ],
    bbox: bboxOf(capsules),
  };
}

// Single tube: an S-shaped polyline, 4 connected segments.
function buildSingleTube(W, H, radiusMul) {
  const m = Math.max(80, Math.min(W, H) * 0.12);
  const r = Math.max(60, Math.min(W, H) * 0.18) * radiusMul;
  const xL = m, xR = W - m;
  const yTop = m + r * 0.6;
  const yMid = H * 0.5;
  const yBot = H - m - r * 0.6;
  const midX = W * 0.5;
  const capsules = [
    { x1: xL,   y1: yTop, x2: midX, y2: yTop, r, flow:  1 },
    { x1: midX, y1: yTop, x2: midX, y2: yMid, r, flow:  1 },
    { x1: midX, y1: yMid, x2: midX, y2: yBot, r, flow:  1 },
    { x1: midX, y1: yBot, x2: xR,   y2: yBot, r, flow:  1 },
  ];
  return {
    capsules,
    spawnSeeds: [
      { x: midX, y: yTop },
      { x: midX, y: yMid },
      { x: midX, y: yBot },
    ],
    bbox: bboxOf(capsules),
  };
}

// Stylised heart: 4-chamber sketch + 4 outflow vessels. 10 capsules.
// Not anatomically accurate — a glanceable cardiac silhouette.
function buildHeart(W, H, radiusMul) {
  const m = Math.max(80, Math.min(W, H) * 0.10);
  const cx = W * 0.5, cy = H * 0.5;
  const heartH = Math.min(H, W * 0.75) * 0.55;
  const heartW = heartH * 1.05;
  const rChamber = heartH * 0.16 * radiusMul;
  const rVessel  = heartH * 0.10 * radiusMul;
  // Chambers: top-left atrium, top-right atrium, bottom-left ventricle,
  // bottom-right ventricle. Each is a short fat capsule.
  const ax = cx - heartW * 0.22, ay = cy - heartH * 0.18;
  const bx = cx + heartW * 0.22, by = cy - heartH * 0.18;
  const dx = cx - heartW * 0.22, dy = cy + heartH * 0.22;
  const ex = cx + heartW * 0.22, ey = cy + heartH * 0.22;
  const capsules = [
    // Four chambers, slightly elongated vertically.
    { x1: ax, y1: ay - rChamber * 0.4, x2: ax, y2: ay + rChamber * 0.4, r: rChamber, flow:  1 },
    { x1: bx, y1: by - rChamber * 0.4, x2: bx, y2: by + rChamber * 0.4, r: rChamber, flow: -1 },
    { x1: dx, y1: dy - rChamber * 0.6, x2: dx, y2: dy + rChamber * 0.6, r: rChamber, flow:  1 },
    { x1: ex, y1: ey - rChamber * 0.6, x2: ex, y2: ey + rChamber * 0.6, r: rChamber, flow: -1 },
    // Septum (vertical bridge through the centre).
    { x1: cx, y1: cy - heartH * 0.32,  x2: cx, y2: cy + heartH * 0.36,  r: rVessel * 0.95, flow:  1 },
    // Atrium → ventricle on each side.
    { x1: ax, y1: ay,                  x2: dx, y2: dy,                  r: rVessel,        flow:  1 },
    { x1: bx, y1: by,                  x2: ex, y2: ey,                  r: rVessel,        flow:  1 },
    // Aorta + pulmonary trunk — short stubs poking out the top.
    { x1: cx - heartW * 0.05, y1: cy - heartH * 0.36, x2: cx - heartW * 0.10, y2: m, r: rVessel * 0.9, flow: -1 },
    { x1: cx + heartW * 0.05, y1: cy - heartH * 0.36, x2: cx + heartW * 0.18, y2: m, r: rVessel * 0.9, flow: -1 },
    // Inferior vena cava — stub poking out the bottom centre.
    { x1: cx, y1: cy + heartH * 0.36,  x2: cx, y2: H - m, r: rVessel * 0.8, flow:  1 },
  ];
  return {
    capsules,
    spawnSeeds: [
      { x: cx, y: cy },
      { x: ax, y: ay },
      { x: bx, y: by },
      { x: dx, y: dy },
      { x: ex, y: ey },
    ],
    bbox: bboxOf(capsules),
  };
}

const LAYOUTS = {
  branching: buildBranchingNetwork,
  tube:      buildSingleTube,
  heart:     buildHeart,
};

export const VESSEL_LAYOUTS = Object.freeze(['branching', 'tube', 'heart']);

// Public builder. `layoutKey` validated against LAYOUTS; falls back
// to 'branching' on unknown input. `radiusMul` is a 0.5..2.0 user
// multiplier on the default radii.
export function buildVessels(layoutKey, W, H, radiusMul) {
  const fn = LAYOUTS[layoutKey] || LAYOUTS.branching;
  return fn(W, H, radiusMul);
}

// ── RBC particle field ───────────────────────────────────────────────

// Build N particles per capsule with t spread evenly + a phase offset
// so they don't all line up. `densityMul` is the user-facing
// multiplier (0..2). Baseline density: 1 particle per ~60 world units
// of capsule centerline, clamped to [3, 24] per capsule so very long
// tubes don't blow the cap.
const RBC_BASE_DENSITY = 1 / 60;
const RBC_PER_CAPSULE_MIN = 3;
const RBC_PER_CAPSULE_MAX = 24;

export function buildRbcParticles(vessels, densityMul) {
  const out = [];
  if (!vessels || !vessels.capsules) return out;
  const mul = Math.max(0, densityMul);
  for (let ci = 0; ci < vessels.capsules.length; ci++) {
    const cap = vessels.capsules[ci];
    const len = capsuleLength(cap);
    let n = Math.round(len * RBC_BASE_DENSITY * mul);
    if (n <= 0) continue;
    n = Math.max(RBC_PER_CAPSULE_MIN, Math.min(RBC_PER_CAPSULE_MAX, n));
    for (let i = 0; i < n; i++) {
      out.push({
        capsuleIdx: ci,
        t: (i + Math.random() * 0.5) / n,
        scale: 0.75 + Math.random() * 0.50,
        phase: Math.random() * Math.PI * 2,
        // Lateral offset within the tube radius — keeps the particles
        // from queuing single-file along the centerline.
        lateral: (Math.random() - 0.5) * 0.7,
      });
    }
  }
  return out;
}

// Per-tick advance. Loops within each capsule (no cross-segment
// handoff in v1). `flowSpeed` is the user-facing 0..3 multiplier;
// base flow is ~80 world units / sec.
const RBC_BASE_FLOW = 80;

export function tickRbcParticles(rbcs, vessels, dt, flowSpeed) {
  if (!rbcs || !vessels || flowSpeed <= 0) return;
  const baseDelta = RBC_BASE_FLOW * flowSpeed * dt;
  for (const p of rbcs) {
    const cap = vessels.capsules[p.capsuleIdx];
    if (!cap) continue;
    const len = capsuleLength(cap);
    if (len < 1e-3) continue;
    p.t += (baseDelta * cap.flow) / len;
    if (p.t > 1) p.t -= 1;
    else if (p.t < 0) p.t += 1;
  }
}

// Resolve a particle's world-space position + orientation for rendering.
// Lateral offset is perpendicular to the centerline, scaled by the
// capsule radius.
export function rbcWorldPos(rbc, vessels) {
  const cap = vessels.capsules[rbc.capsuleIdx];
  if (!cap) return null;
  const dx = cap.x2 - cap.x1;
  const dy = cap.y2 - cap.y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const cx = cap.x1 + ux * dx * 0 + (cap.x2 - cap.x1) * rbc.t;
  const cy = cap.y1 + (cap.y2 - cap.y1) * rbc.t;
  const lateral = rbc.lateral * cap.r * 0.7;
  return {
    x: cx + (-uy) * lateral,
    y: cy + ( ux) * lateral,
    angle: Math.atan2(dy, dx),
    r: cap.r * 0.10 * rbc.scale, // RBC ellipse semi-major
  };
}

// Spawn-safe position picker. Tries `tries` rejection samples inside
// the bbox of the vessel union; on fail returns the first spawn seed
// as a guaranteed-inside fallback.
export function pickSpawnInside(vessels, tries = 30) {
  if (!vessels || !vessels.capsules || vessels.capsules.length === 0) return null;
  const { bbox } = vessels;
  for (let i = 0; i < tries; i++) {
    const x = bbox.minX + Math.random() * (bbox.maxX - bbox.minX);
    const y = bbox.minY + Math.random() * (bbox.maxY - bbox.minY);
    if (isInsideVessels(vessels, x, y)) return { x, y };
  }
  const seed = vessels.spawnSeeds && vessels.spawnSeeds[0];
  return seed ? { x: seed.x, y: seed.y } : null;
}
