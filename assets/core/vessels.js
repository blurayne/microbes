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
    const r2 = c.r2 ?? c.r;          // tapered capsules store the far-end radius
    minX = Math.min(minX, c.x1 - c.r, c.x2 - r2);
    minY = Math.min(minY, c.y1 - c.r, c.y2 - r2);
    maxX = Math.max(maxX, c.x1 + c.r, c.x2 + r2);
    maxY = Math.max(maxY, c.y1 + c.r, c.y2 + r2);
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

// Realistic vascular network. One dominant vertical "aorta" runs through
// the screen-X centre (bottom→top, extending far past the camera). Side
// branches peel off alternating sides at intervals — like intercostal
// arteries off the aorta — and each side branch is a recursive,
// Murray's-law bifurcating sub-tree. Every vessel is CURVED (meandering
// centerline) and TAPERS along its length.
//
// Implementation note — no SDF change: each anatomical vessel is sampled
// into many short, round-capped capsules. Segments are short enough that
// the per-capsule radius steps <~12 %, so the capsule union reads (and
// confines) as a smooth tapered curved tube. Capsules carry an optional
// `r2` (radius at the far end) used only by the renderers for a crisp
// trapezoid taper; the physics SDF keeps using `r` (the start/thicker
// end → safely over-confines). Detail (curves, capillaries) lives in
// `physics:false` capsules, which the confinement loop skips, so the
// per-cell-per-tick cost stays bounded by the trunk + major branches.
function buildBranchingNetwork(W, H, radiusMul, sizeScale = 1.0) {
  const capsules = [];
  const spawnSeeds = [];
  const rng = makePrng((W * 73856093) ^ (H * 19349663));

  const physicsMinR  = 14 * radiusMul;   // confinement floor (skip thinner)
  const visualMinR   = 1.5 * radiusMul;  // thinnest capillary we still draw
  const capillaryR   = 3.0 * radiusMul;  // stop bifurcating below this
  const MAX_GEN      = 7;                 // recursion depth for side trees
  const MAX_CAPSULES = 760;              // hard render-cost cap

  // Emit one curved, tapering vessel as a chain of short round-capped
  // capsules. Returns the tip {x, y, heading, r} so the caller can
  // attach children. `wander` is the per-step heading jitter (radians);
  // `restore` pulls the heading back toward `baseHeading` so meanders
  // don't curl into spirals.
  function emitVessel(x, y, heading, rStart, rEnd, length, opts) {
    const baseHeading = opts.baseHeading ?? heading;
    const wander  = opts.wander  ?? 0.16;
    const restore = opts.restore ?? 0.05;
    const flow    = opts.flow    ?? -1;
    const physics = opts.physics ?? false;
    // Subdivide so (a) the curve is smooth and (b) the radius steps
    // <12 % per segment. Thicker/longer vessels and bigger taper get
    // more segments.
    const radSpan   = Math.abs(rStart - rEnd) / Math.max(1e-3, Math.min(rStart, rEnd));
    const radSteps  = Math.ceil(radSpan / 0.12);
    const curveSteps = Math.ceil(length / (Math.min(W, H) * 0.30));
    const N = Math.max(3, Math.min(48, Math.max(radSteps, curveSteps)));
    const segLen = length / N;
    let px = x, py = y, h = heading, curR = rStart;
    for (let i = 0; i < N; i++) {
      h += (rng() - 0.5) * wander + (baseHeading - h) * restore;
      const nx = px + Math.cos(h) * segLen;
      const ny = py + Math.sin(h) * segLen;
      const nr = rStart + (rEnd - rStart) * ((i + 1) / N);
      const mid = (curR + nr) * 0.5;
      capsules.push({
        x1: px, y1: py, x2: nx, y2: ny,
        r:  Math.max(visualMinR, curR),
        r2: Math.max(visualMinR, nr),
        flow,
        physics: physics && mid >= physicsMinR,
        flowEligible: mid >= physicsMinR,
      });
      px = nx; py = ny; curR = nr;
      if (capsules.length >= MAX_CAPSULES) break;
    }
    return { x: px, y: py, heading: h, r: rEnd };
  }

  // Grow a vessel then bifurcate per Murray's law (r_p³ = r_a³ + r_b³).
  function grow(x, y, heading, r, gen, lenScale) {
    if (gen > MAX_GEN || r < capillaryR || capsules.length >= MAX_CAPSULES) return;
    // Branch segments are short enough that a gen-1 branch + its first
    // few bifurcations fit on screen → the recursive forking structure
    // is visible, not pushed off-frame.
    const length = Math.min(W, H) * 0.34 * lenScale * (0.8 + rng() * 0.5);
    const rEnd = r * (0.60 + rng() * 0.14);
    const tip = emitVessel(x, y, heading, r, rEnd, length, {
      baseHeading: heading,
      wander:  0.14 + gen * 0.05,        // deeper vessels meander more
      restore: 0.06,
      flow: rng() < 0.5 ? 1 : -1,
      physics: r >= physicsMinR,
    });
    if (gen >= MAX_GEN || tip.r < capillaryR) return;
    // Asymmetric flow split → Murray radii. Thinner child peels off at
    // the wider angle (optimality of arterial bifurcations).
    const f  = 0.40 + rng() * 0.20;       // flow fraction to child A
    const rA = tip.r * Math.cbrt(f);
    const rB = tip.r * Math.cbrt(1 - f);
    const spread = 0.45 + rng() * 0.45;   // total bifurcation angle (rad)
    const angA = -spread * (rB / (rA + rB));
    const angB =  spread * (rA / (rA + rB));
    grow(tip.x, tip.y, tip.heading + angA, rA, gen + 1, lenScale * 0.78);
    grow(tip.x, tip.y, tip.heading + angB, rB, gen + 1, lenScale * 0.78);
  }

  // ── Main trunk: dominant vertical aorta through the screen centre ──
  // ~5 viewport-heights tall by default so it clearly extends past the
  // top + bottom of the camera (reads as a long vessel you travel
  // along) while still being short enough that the side branches and
  // their recursive forks fit on screen. `sizeScale` (the runtime
  // "Vessel size" slider) scales this up to the giant version.
  const mainLen = H * 5 * sizeScale;
  const mainX   = W * 0.5;
  const mainBot = H * 0.5 + mainLen * 0.5;   // start below the camera
  const mainR   = Math.max(physicsMinR + 18, Math.min(W, H) * 0.048) * radiusMul;
  const mainREnd = mainR * 0.5;              // tapers toward the top

  // Pass 1 — emit the COMPLETE trunk first (low wander + strong vertical
  // restoring keep it readable as THE main vessel) and record where each
  // slice ends so we can hang side branches off it afterward. Doing the
  // trunk first means it's never truncated by the capsule cap.
  // Branch spacing is set in WORLD units (~0.42·min) so branches stay a
  // readable distance apart regardless of how long the trunk is.
  const branchSpacing = Math.min(W, H) * 0.42;
  const NUM_SLICES = Math.max(6, Math.min(48, Math.round(mainLen / branchSpacing)));
  const branchSeeds = [];
  let tx = mainX, ty = mainBot;
  let th = -Math.PI / 2;                      // heading: straight up
  const upHeading = -Math.PI / 2;
  for (let i = 0; i < NUM_SLICES; i++) {
    const t0 = i / NUM_SLICES, t1 = (i + 1) / NUM_SLICES;
    const r0 = mainR + (mainREnd - mainR) * t0;
    const r1 = mainR + (mainREnd - mainR) * t1;
    const seg = emitVessel(tx, ty, th, r0, r1, mainLen / NUM_SLICES, {
      baseHeading: upHeading,
      wander: 0.05, restore: 0.18,
      flow: -1, physics: true,
    });
    tx = seg.x; ty = seg.y; th = seg.heading;
    if (i > 1 && i < NUM_SLICES - 1) {
      branchSeeds.push({ x: tx, y: ty, heading: th, r: seg.r, side: (i % 2 === 0) ? 1 : -1 });
    }
  }

  // Pass 2 — grow a recursive Murray sub-tree off each trunk slice.
  // ~70–80° off vertical (jittered) so branches leave roughly
  // perpendicular like real arterial offshoots. Stops when the
  // capsule cap is reached.
  for (const b of branchSeeds) {
    if (capsules.length >= MAX_CAPSULES) break;
    const branchHeading = b.heading + b.side * (Math.PI * 0.42 + (rng() - 0.5) * 0.35);
    const branchR = b.r * (0.46 + rng() * 0.16);
    grow(b.x, b.y, branchHeading, branchR, 1, 1.0 + rng() * 0.6);
  }

  // Spawn seed: midpoint of whichever physics capsule sits closest to
  // the viewport centre. A capsule's centerline midpoint has SDF = −r,
  // so it's guaranteed inside the union (the trunk meanders, so a fixed
  // (mainX, H/2) guess can land just outside).
  const cxV = W * 0.5, cyV = H * 0.5;
  let bestSeed = null, bestD2 = Infinity;
  for (const c of capsules) {
    if (c.physics === false) continue;
    const mxC = (c.x1 + c.x2) * 0.5, myC = (c.y1 + c.y2) * 0.5;
    const d2 = (mxC - cxV) ** 2 + (myC - cyV) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestSeed = { x: mxC, y: myC }; }
  }
  spawnSeeds.push(bestSeed || { x: mainX, y: H * 0.5 });

  return {
    capsules,
    spawnSeeds,
    bbox: bboxOf(capsules),
    viewport: { W, H },
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
export function buildVessels(layoutKey, W, H, radiusMul, sizeScale = 1.0) {
  const fn = LAYOUTS[layoutKey] || LAYOUTS.branching;
  return fn(W, H, radiusMul, sizeScale);
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
    // Only the wider, flow-eligible vessels carry visible RBCs — seeding
    // hair-thin capillaries would spawn thousands of sub-pixel particles
    // for no visual gain. Layouts without the flag (grid/tube/heart)
    // leave `flowEligible` undefined → treated as eligible.
    if (cap.flowEligible === false) continue;
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
  const { bbox, viewport } = vessels;
  // Sample inside (bbox ∩ viewport) so cells don't spawn off-screen
  // when the tree extends far beyond the camera (e.g. the vascular
  // tree's 100×-viewport footprint). Falls back to the raw bbox if
  // viewport is missing or the intersection is empty.
  let minX = bbox.minX, maxX = bbox.maxX;
  let minY = bbox.minY, maxY = bbox.maxY;
  if (viewport) {
    const clipMinX = Math.max(bbox.minX, 0);
    const clipMaxX = Math.min(bbox.maxX, viewport.W);
    const clipMinY = Math.max(bbox.minY, 0);
    const clipMaxY = Math.min(bbox.maxY, viewport.H);
    if (clipMaxX > clipMinX && clipMaxY > clipMinY) {
      minX = clipMinX; maxX = clipMaxX;
      minY = clipMinY; maxY = clipMaxY;
    }
  }
  for (let i = 0; i < tries; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (isInsideVessels(vessels, x, y)) return { x, y };
  }
  const seed = vessels.spawnSeeds && vessels.spawnSeeds[0];
  return seed ? { x: seed.x, y: seed.y } : null;
}
