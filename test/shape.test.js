// Pure-math tests for shapeVertex / wobbleAt / getShapes.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { shapeVertex, wobbleAt, getShapes, splitVirtualCenters } from '../assets/core/shape.js';
import { S } from '../assets/core/state.js';

function mkCell(type = 'neutrophil') {
  return {
    id: 1, x: 0, y: 0, r: 50, type,
    vx: 0, vy: 0, state: 'NORMAL',
    splitTimer: 0, splitProgress: 0, splitAngle: 0, bondTimer: 0,
    phase: 0, orientation: 0, wobbleSeed: 1, wobbleFreq: 1, flash: 0,
    category: 'good',
  };
}

test('shapeVertex returns finite coordinates for every body kind', () => {
  S.wobbleAmp = 0.13;
  for (const type of ['neutrophil','monocyte','mast','nk','macrophage','platelet','dendritic','virus','spore','toxin']) {
    const cell = mkCell(type);
    cell.x = 100; cell.y = 100;
    const s = { x: cell.x, y: cell.y, r: cell.r, cell };
    for (let i = 0; i < 32; i++) {
      const theta = (i / 32) * Math.PI * 2;
      const v = shapeVertex(s, theta, 0.5);
      assert.ok(Number.isFinite(v.x), `${type} non-finite x at theta=${theta}`);
      assert.ok(Number.isFinite(v.y), `${type} non-finite y at theta=${theta}`);
    }
  }
});

test('shapeVertex on a round cell at theta=0 with zero wobble = (x+r, y)', () => {
  S.wobbleAmp = 0;
  const cell = mkCell('nk'); // round
  cell.x = 100; cell.y = 200;
  const s = { x: cell.x, y: cell.y, r: 40, cell };
  const v = shapeVertex(s, 0, 0);
  assert.ok(Math.abs(v.x - 140) < 1e-9, `expected ~140, got ${v.x}`);
  assert.ok(Math.abs(v.y - 200) < 1e-9, `expected ~200, got ${v.y}`);
  S.wobbleAmp = 0.13;
});

test('wobbleAt is deterministic for the same cell+theta+t', () => {
  const cell = mkCell();
  const a = wobbleAt(cell, 0.5, 1.0);
  const b = wobbleAt(cell, 0.5, 1.0);
  assert.equal(a, b);
});

test('getShapes culls cells outside the viewport', () => {
  const camera = { scale: 1, tx: 0, ty: 0 };
  const inSide = mkCell(); inSide.x = 500; inSide.y = 384;
  const outSide = mkCell(); outSide.x = 5000; outSide.y = 5000;
  const shapes = getShapes([inSide, outSide], 0, camera, 1024, 768);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].cell, inSide);
});

test('getShapes splits a SPLITTING cell into two halves', () => {
  const camera = { scale: 1, tx: 0, ty: 0 };
  const c = mkCell(); c.x = 500; c.y = 384; c.state = 'SPLITTING'; c.splitProgress = 0.5;
  const shapes = getShapes([c], 0, camera, 1024, 768);
  assert.equal(shapes.length, 2);
});

test('splitVirtualCenters produces two centers offset by splitAngle', () => {
  const c = mkCell(); c.x = 0; c.y = 0; c.r = 100;
  c.state = 'SPLITTING'; c.splitProgress = 0.5; c.splitAngle = 0;
  const [left, right] = splitVirtualCenters(c);
  assert.ok(left.x < right.x);
  assert.ok(Math.abs(left.y) < 1e-9 && Math.abs(right.y) < 1e-9);
});
