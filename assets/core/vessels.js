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
    if (cap.physics === false) continue;
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
    if (cap.physics === false) continue;
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

// Deterministic mulberry32 PRNG. Seeded from the viewport dims so the
// vascular tree comes out the same shape on each load + resize while
// still looking organic.
function makePrng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vascular tree: a fractally-branching arterial tree growing from one
// corner of the viewport diagonally across, then a second mirror tree
// from the opposite corner so the playfield is bracketed. Each branch
// tapers, with sub-branches at random-ish angles. Minimum capsule
// radius is clamped so cells (~12 px radius) always fit through the
// thinnest leaves.
function buildBranchingNetwork(W, H, radiusMul) {
  const capsules = [];
  const spawnSeeds = [];
  // Physics floor: capsules with `r < physicsMinR` are decorative
  // twigs only — cells aren't confined by them. The thin tips that
  // give the tree its anatomical look would be narrower than a
  // cell, so we draw them but don't enforce them.
  const physicsMinR = 18 * radiusMul;
  const visualMinR = 3 * radiusMul;
  const rng = makePrng((W * 73856093) ^ (H * 19349663));

  const baseSegLen = Math.min(W, H) * 0.30;

  function grow(rootX, rootY, angle, rootR, maxDepth) {
    function recurse(x, y, ang, r, depth) {
      // Each level shortens segments a little — long trunk, shorter
      // outer twigs. Random jitter keeps the silhouette organic.
      const lenScale = Math.pow(0.82, depth) * (0.75 + rng() * 0.5);
      const segLen = baseSegLen * lenScale;
      const x2 = x + Math.cos(ang) * segLen;
      const y2 = y + Math.sin(ang) * segLen;
      const flow = depth === 0 ? 1 : (rng() < 0.5 ? 1 : -1);
      const physics = r >= physicsMinR;
      capsules.push({
        x1: x, y1: y, x2, y2,
        r: Math.max(visualMinR, r),
        flow, physics,
      });
      if (depth === 0) spawnSeeds.push({ x: (x + x2) * 0.5, y: (y + y2) * 0.5 });
      if (depth >= maxDepth) return;
      if (r * 0.50 < visualMinR) return;   // any thinner is invisible
      const n = rng() < 0.25 ? 3 : 2;
      const childR = r * (0.62 + rng() * 0.12);
      // Spread narrows with depth so the trunk fans broadly but
      // the twigs stay pointed outward — keeps branches reaching
      // away from the root instead of doubling back. Reference
      // image shows ~30° per junction at the trunk.
      const spread = Math.PI * (0.45 - depth * 0.04);
      const jitter = 0.30 / Math.max(1, depth);
      for (let i = 0; i < n; i++) {
        const dAng = (i - (n - 1) * 0.5) / Math.max(1, n - 1) * spread
                   + (rng() - 0.5) * jitter;
        recurse(x2, y2, ang + dAng, childR, depth + 1);
      }
    }
    recurse(rootX, rootY, angle, rootR, 0);
  }

  const rootR = Math.max(physicsMinR + 24, Math.min(W, H) * 0.08) * radiusMul;
  // One trunk coming from bottom-left, fanning up and across the
  // canvas — matches the anatomical-illustration reference image.
  const m = Math.min(W, H) * 0.03;
  grow(m, H - m, -Math.PI * 0.30, rootR, 6);
  return {
    capsules,
    spawnSeeds: spawnSeeds.length > 0 ? spawnSeeds : [{ x: W * 0.5, y: H * 0.5 }],
    bbox: bboxOf(capsules),
  };
}

// Grid network (the legacy `branching` layout, kept under a new name).
// One main horizontal artery, four vertical branches, two thin
// bifurcation connectors. Rectilinear; useful when the user wants
// predictable hallways rather than an organic tree.
function buildGridNetwork(W, H, radiusMul) {
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
  grid:      buildGridNetwork,
  tube:      buildSingleTube,
  heart:     buildHeart,
};

export const VESSEL_LAYOUTS = Object.freeze(['branching', 'grid', 'tube', 'heart']);

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
