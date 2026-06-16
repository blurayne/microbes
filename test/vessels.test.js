// Vessel geometry unit tests. Pure math — no canvas, no DOM.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  capsuleSDF, capsuleLength, nearestVesselWall, isInsideVessels,
  buildVessels, buildRbcParticles, tickRbcParticles,
  pickSpawnInside, VESSEL_LAYOUTS,
} from '../assets/core/vessels.js';

const horiz = { x1: 0, y1: 0, x2: 100, y2: 0, r: 10, flow: 1 };

test('capsuleSDF reports negative distance inside the tube', () => {
  const s = capsuleSDF(50, 0, horiz);
  assert.equal(s.dist, -10, 'centre is exactly r below the surface');
  assert.equal(s.qx, 50);
  assert.equal(s.qy, 0);
});

test('capsuleSDF reports zero distance on the surface', () => {
  const s = capsuleSDF(50, 10, horiz);
  assert.equal(s.dist, 0);
});

test('capsuleSDF reports positive distance outside the tube', () => {
  const s = capsuleSDF(50, 25, horiz);
  assert.equal(s.dist, 15);
});

test('capsuleSDF clamps to endpoints (rounded caps)', () => {
  const s1 = capsuleSDF(-10, 0, horiz);   // 10 px left of the start cap
  assert.equal(s1.dist, 0, '10 px from the start cap surface');
  const s2 = capsuleSDF(120, 0, horiz);   // 20 px right of the end cap
  assert.equal(s2.dist, 10);
});

test('capsuleLength matches euclidean segment length', () => {
  assert.equal(capsuleLength(horiz), 100);
  assert.equal(capsuleLength({ x1: 0, y1: 0, x2: 3, y2: 4, r: 1 }), 5);
});

test('nearestVesselWall returns inward-pointing normal outside', () => {
  const v = { capsules: [horiz] };
  const w = nearestVesselWall(v, 50, 30);
  // Outward gradient from the surface at (50, 30) points +Y (away
  // from the centerline at y=0). Length normalised.
  assert.ok(Math.abs(w.nx) < 1e-6, `nx should be ~0, got ${w.nx}`);
  assert.ok(Math.abs(w.ny - 1) < 1e-6, `ny should be ~+1, got ${w.ny}`);
  assert.equal(w.signedDist, 20);
});

test('isInsideVessels detects union membership', () => {
  const v = { capsules: [horiz, { x1: 0, y1: 50, x2: 0, y2: 100, r: 5, flow: 1 }] };
  assert.equal(isInsideVessels(v, 50, 0), true);
  assert.equal(isInsideVessels(v, 0, 75), true);
  assert.equal(isInsideVessels(v, 50, 100), false);
});

test('VESSEL_LAYOUTS exports all 3 layout keys', () => {
  assert.deepEqual([...VESSEL_LAYOUTS].sort(), ['branching', 'heart', 'tube']);
});

for (const layout of ['branching', 'tube', 'heart']) {
  test(`buildVessels('${layout}') yields a non-empty bbox-bounded layout`, () => {
    const W = 1600, H = 900;
    const v = buildVessels(layout, W, H, 1.0);
    assert.ok(v.capsules.length >= 4, `${layout} should produce ≥4 capsules`);
    assert.ok(v.spawnSeeds.length >= 1);
    // bbox should overlap the viewport (the vessel network sits inside
    // or close to the screen rect).
    assert.ok(v.bbox.minX < W && v.bbox.maxX > 0);
    assert.ok(v.bbox.minY < H && v.bbox.maxY > 0);
    // Every spawn seed is inside the union it claims to seed.
    for (const seed of v.spawnSeeds) {
      assert.ok(isInsideVessels(v, seed.x, seed.y),
        `spawn seed (${seed.x}, ${seed.y}) should be inside the ${layout} vessel union`);
    }
  });
}

test('buildVessels falls back to branching on unknown layout', () => {
  const def = buildVessels('branching', 800, 600, 1.0);
  const fallback = buildVessels('nonsense-layout', 800, 600, 1.0);
  assert.equal(fallback.capsules.length, def.capsules.length);
});

test('buildRbcParticles seeds N≥3 particles per capsule', () => {
  const v = buildVessels('branching', 1600, 900, 1.0);
  const rbcs = buildRbcParticles(v, 1.0);
  assert.ok(rbcs.length >= v.capsules.length * 3,
    `expected ≥${v.capsules.length * 3} RBCs, got ${rbcs.length}`);
});

test('tickRbcParticles advances each particle, wrapping at 1', () => {
  const v = { capsules: [{ x1: 0, y1: 0, x2: 100, y2: 0, r: 10, flow: 1 }] };
  const rbcs = [{ capsuleIdx: 0, t: 0.95, scale: 1, phase: 0, lateral: 0 }];
  // Pick a flow speed + dt that overshoots t=1 to confirm the wrap.
  tickRbcParticles(rbcs, v, 1.0, 1.0); // baseDelta = 80 * 1 * 1 = 80; dt/len = 0.8
  assert.ok(rbcs[0].t < 0.95 && rbcs[0].t >= 0,
    `t should wrap to [0, 0.95), got ${rbcs[0].t}`);
});

test('tickRbcParticles is a no-op when flow speed is 0', () => {
  const v = { capsules: [horiz] };
  const rbcs = [{ capsuleIdx: 0, t: 0.4, scale: 1, phase: 0, lateral: 0 }];
  tickRbcParticles(rbcs, v, 1.0, 0);
  assert.equal(rbcs[0].t, 0.4);
});

test('pickSpawnInside always returns a point inside the union', () => {
  const v = buildVessels('branching', 1200, 800, 1.0);
  for (let i = 0; i < 20; i++) {
    const p = pickSpawnInside(v);
    assert.ok(p && isInsideVessels(v, p.x, p.y),
      `pickSpawnInside returned ${p ? `(${p.x}, ${p.y})` : 'null'} — not inside the union`);
  }
});
