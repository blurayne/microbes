// Pure-logic tests for the Sim class: spatial hash, swarm centroid,
// makeCell, split, basic update integration.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Sim } from '../assets/core/sim.js';
import { S } from '../assets/core/state.js';

function fresh() {
  const sim = new Sim();
  sim.setViewport(1024, 768);
  return sim;
}

test('makeCell populates every renderer-consumed field', () => {
  const sim = fresh();
  const c = sim.makeCell(100, 200, 30, 'neutrophil');
  assert.equal(c.type, 'neutrophil');
  assert.equal(c.x, 100);
  assert.equal(c.y, 200);
  assert.equal(c.r, 30);
  assert.equal(c.state, 'NORMAL');
  assert.equal(c.category, 'good');
  assert.ok(c._colors && c._colors.cytoBot, 'cached _colors missing');
  assert.ok(typeof c.id === 'number' && c.id > 0);
});

test('rollSplitTimer respects type splitFactor and min', () => {
  const sim = fresh();
  for (let i = 0; i < 50; i++) {
    const t = sim.rollSplitTimer('neutrophil');
    assert.ok(t >= 1.5, `timer ${t} < 1.5`);
  }
});

test('spawnAtWorld respects S.maxCells cap', () => {
  const sim = fresh();
  S.maxCells = 5;
  for (let i = 0; i < 10; i++) sim.spawnAtWorld('neutrophil', 100 + i, 100);
  assert.equal(sim.cells.length, 5);
  S.maxCells = 32; // restore default
});

test('hitCell finds the closest cell within reach', () => {
  const sim = fresh();
  sim.spawnAtWorld('neutrophil', 100, 100);
  sim.spawnAtWorld('neutrophil', 500, 500);
  const idx = sim.hitCell(102, 100);
  assert.equal(idx, 0);
  const miss = sim.hitCell(900, 900);
  assert.equal(miss, -1);
});

test('swarmCentroid returns null when fewer than 2 same-category cells', () => {
  const sim = fresh();
  sim.spawnAtWorld('neutrophil', 100, 100);
  assert.equal(sim.swarmCentroid('good'), null);
  assert.equal(sim.swarmCentroid('bad'), null);
});

test('swarmCentroid averages positions and returns max-distance radius (>= 200)', () => {
  const sim = fresh();
  // Bypass spawnAtWorld's jitter so the centroid math is exact.
  for (const [x, y] of [[100, 100], [300, 100], [200, 300]]) {
    const c = sim.makeCell(x, y, 30, 'neutrophil');
    sim.cells.push(c);
  }
  const c = sim.swarmCentroid('good');
  assert.ok(c, 'centroid should exist');
  assert.ok(Math.abs(c.x - 200) < 1e-9);
  assert.ok(Math.abs(c.y - (500 / 3)) < 1e-9);
  // max distance from centroid to any cell, floored at 200.
  assert.ok(c.r >= 200, `r=${c.r} should be >= 200 floor`);
});

test('rebuildSpatialGrid + forEachNeighbour finds nearby cells, skips far ones', () => {
  const sim = fresh();
  const a = sim.makeCell(100, 100, 30, 'neutrophil'); sim.cells.push(a);
  const b = sim.makeCell(150, 100, 30, 'neutrophil'); sim.cells.push(b); // close
  const c = sim.makeCell(800, 100, 30, 'neutrophil'); sim.cells.push(c); // far
  sim.rebuildSpatialGrid();
  const neighbours = [];
  sim.forEachNeighbour(a, 200, n => neighbours.push(n));
  assert.ok(neighbours.includes(b), 'close cell missing');
  assert.ok(!neighbours.includes(c), 'far cell incorrectly returned');
});

test('beginSplit transitions cell to SPLITTING; finishSplit produces two cells', () => {
  const sim = fresh();
  const c = sim.makeCell(400, 400, 50, 'neutrophil');
  sim.cells.push(c);
  sim.beginSplit(c);
  assert.equal(c.state, 'SPLITTING');
  c.splitProgress = 1;
  sim.finishSplit(c, 0);
  assert.equal(sim.cells.length, 2);
  assert.equal(sim.cells[0].state, 'NORMAL');
  assert.equal(sim.cells[1].state, 'NORMAL');
});

test('update(dt) advances cell positions over time', () => {
  const sim = fresh();
  sim.resetSim();
  for (let i = 0; i < 5; i++) sim.spawnAtCenter('macrophage');
  const before = sim.cells.map(c => ({ x: c.x, y: c.y }));
  for (let i = 0; i < 60; i++) sim.update(1 / 60);
  const moved = sim.cells.some((c, i) =>
    Math.abs(c.x - before[i].x) > 0.001 || Math.abs(c.y - before[i].y) > 0.001
  );
  assert.ok(moved, 'no cells moved after 60 update ticks');
});
