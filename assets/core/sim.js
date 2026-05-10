// Microbes — simulation core. Physics, AI, splitting, collision, spatial hash.
//
// `Sim` is a stateful container for the live cell pool. The `update(dt)` loop
// is renderer-agnostic: it never touches `ctx`, FBOs, or DOM. Input handlers
// in `app.js` mutate `sim.drag` / `sim.pan` / `sim.addMode` / camera directly
// — those fields are intentionally public so the input layer can drive them.

import {
  S, CELL_TYPES, DEFAULT_MOVE, ALARM_RADIUS,
  CELL_RADIUS, BROWNIAN, MARGIN, BOND_DURATION, SPLIT_DURATION, HASH_CELL,
  pickRandomActiveType,
} from './state.js';
import { getRule, maxAttractRadius, defaultHp } from './sim-rules.js';

// Push-apart impulse from finishSplit() ramps in linearly over this
// duration so the new cells don't snap outward at the moment of
// transition. 0.30 s reads as "soft drift apart" without delaying the
// physics noticeably.
const SPLIT_IMPULSE_FADE_S = 0.30;

export class Sim {
  constructor() {
    /** @type {Array} */
    this.cells = [];
    this.cellId = 0;

    /** Currently-selected good cells (target-mode). */
    this.selectedCells = new Set();
    /** Last commanded movement target { x, y, t0 }, fades over ~1500ms. */
    this.targetMarker = null;
    /** When non-null, next canvas tap places a cell of `addMode.type`. */
    this.addMode = null;
    /** When true, tapping a cell pops it (overrides splitOnTap). */
    this.killMode = false;
    /**
     * Free-floating particles released by killCell(). Each entry:
     *   { x, y, vx, vy, spin, r, color, life, maxLife }
     * Advanced + pruned in update(dt); renderers read this.particles
     * via drawParticles().
     */
    this.particles = [];

    // Input scratch — mutated by app.js's input handlers.
    /** @type {null|{cell, dx, dy, started, downX, downY, samples }} */
    this.drag = null;
    /** @type {null|{lastX, lastY, startX, startY, moved, button}} */
    this.pan = null;
    /** @type {null|{startDist, startMid, startScale, startTx, startTy }} */
    this.pinch = null;
    /** @type {Map<number, {x, y}>} */
    this.activePointers = new Map();

    /** Camera: world-space → screen-space affine = scale*world + translate. */
    this.camera = { scale: 1, tx: 0, ty: 0, rotation: 0 };

    // Viewport in CSS pixels (set by app.js after each resize).
    this.W = 0;
    this.H = 0;

    /** Uniform-grid spatial hash, rebuilt twice per frame in update(). */
    this.spatialGrid = new Map();
  }

  setViewport(W, H) { this.W = W; this.H = H; }

  // Camera helpers. Pure math; safe to call any time.
  // Forward transform: screen = R(θ) · (world · scale) + (tx, ty).
  // When rotation === 0 the trig collapses to (cos, sin) = (1, 0)
  // and these reduce to the original (sx - tx)/scale form.
  screenToWorld(sx, sy) {
    const s = this.camera.scale;
    const c = Math.cos(this.camera.rotation);
    const r = Math.sin(this.camera.rotation);
    const dx = sx - this.camera.tx;
    const dy = sy - this.camera.ty;
    // Inverse rotation R(-θ) = [[c, r], [-r, c]] then divide by scale.
    return { x: (c * dx + r * dy) / s, y: (-r * dx + c * dy) / s };
  }
  worldToScreen(wx, wy) {
    const s = this.camera.scale;
    const c = Math.cos(this.camera.rotation);
    const r = Math.sin(this.camera.rotation);
    const sx = wx * s;
    const sy = wy * s;
    return { x: c * sx - r * sy + this.camera.tx, y: r * sx + c * sy + this.camera.ty };
  }

  // ---------- Cell lifecycle ----------
  makeCell(x, y, r, type = null) {
    const t = (type && CELL_TYPES[type]) ? type : pickRandomActiveType();
    if (r === undefined || r === null) {
      const sizeMul = (CELL_TYPES[t] && CELL_TYPES[t].sizeMul) || 1;
      r = CELL_RADIUS * sizeMul * (S.cellSizeMul || 1);
    }
    return {
      id: ++this.cellId,
      x, y, r,
      vx: 0, vy: 0,
      type: t,
      state: 'NORMAL',
      splitTimer: this.rollSplitTimer(t),
      splitProgress: 0,
      splitAngle: 0,
      // Set in finishSplit; consumed in update(dt) to fade the
      // push-apart impulse in over SPLIT_IMPULSE_FADE_S.
      splitImpulseDx: 0,
      splitImpulseDy: 0,
      splitImpulseT: 0,
      bondTimer: 0,
      phase: Math.random() * Math.PI * 2,
      orientation: Math.random() * Math.PI * 2,
      wobbleSeed: Math.random() * 1000,
      wobbleFreq: 0.55 + Math.random() * 0.45,
      flash: 0,
      target: null,
      patrolTarget: null,
      patrolTimer: 0,
      alarmTarget: null,
      alarmTimer: 0,
      category: (CELL_TYPES[t] && CELL_TYPES[t].category) || 'good',
      hp: defaultHp(t),
      maxHp: defaultHp(t),
      nextBlink: (typeof performance !== 'undefined' ? performance.now() : 0)
        + 1500 + Math.random() * 4500,
      _colors: (CELL_TYPES[t] || CELL_TYPES.neutrophil).colors,
    };
  }

  // Subtract HP from a cell. Triggers the killCell death + particle
  // burst when HP drops to 0 or below. Heroes start with Infinity HP
  // (defaultHp) so this is a no-op for them in Free Game.
  _applyDamage(cell, amount) {
    if (!cell || cell.hp == null) return;
    if (!Number.isFinite(cell.hp)) return;     // invulnerable (heroes)
    cell.hp -= amount;
    cell.flash = 0.4;
    if (cell.hp <= 0) {
      cell.hp = 0;
      this.killCell(cell);
    }
  }

  rollSplitTimer(type) {
    const factor = (type && CELL_TYPES[type]) ? CELL_TYPES[type].splitFactor : 1.0;
    const j = (Math.random() * 0.6) - 0.3;
    return Math.max(1.5, S.autoSplitSeconds * factor * (1 + j));
  }

  clampAllInside() {
    for (const c of this.cells) {
      c.x = Math.max(MARGIN, Math.min(this.W - MARGIN, c.x));
      c.y = Math.max(MARGIN, Math.min(this.H - MARGIN, c.y));
    }
  }

  // ---------- Splitting ----------
  beginSplit(cell) {
    if (cell.state !== 'NORMAL') return;
    if (this.cells.length >= S.maxCells) {
      cell.flash = 0.5;
      cell.splitTimer = this.rollSplitTimer(cell.type) * 0.5;
      return;
    }
    cell.state = 'SPLITTING';
    cell.splitProgress = 0;
    const ctype = CELL_TYPES[cell.type];
    if (ctype && ctype.body && ctype.body.kind === 'oblong') {
      cell.splitAngle = cell.orientation;
    } else {
      cell.splitAngle = Math.random() * Math.PI * 2;
    }
    // Keep the parent's full pre-split velocity. The SPLITTING-state
    // branch in update() integrates position + friction so the cell
    // drifts naturally throughout the split.
  }

  finishSplit(cell, idx) {
    const a = cell.splitAngle;
    const cx = Math.cos(a), cy = Math.sin(a);
    const sep = cell.r * 1.05;
    const left = this.makeCell(cell.x - cx * sep, cell.y - cy * sep, cell.r, cell.type);
    const right = this.makeCell(cell.x + cx * sep, cell.y + cy * sep, cell.r, cell.type);
    left.orientation = cell.orientation;
    right.orientation = cell.orientation;
    // Inherit parent's velocity. The push-apart impulse below is NOT
    // applied directly — we store it as splitImpulseRemaining* and ramp
    // it in over SPLIT_IMPULSE_FADE_S so the cells don't suddenly snap
    // outward at the moment of transition.
    left.vx = cell.vx; left.vy = cell.vy;
    right.vx = cell.vx; right.vy = cell.vy;

    const speed = (S.splitMode === 'pushApart') ? 70
                : (S.splitMode === 'bondDrift') ? 14 : 0;
    if (speed !== 0) {
      left.splitImpulseDx = -cx * speed;
      left.splitImpulseDy = -cy * speed;
      left.splitImpulseT = SPLIT_IMPULSE_FADE_S;
      right.splitImpulseDx = cx * speed;
      right.splitImpulseDy = cy * speed;
      right.splitImpulseT = SPLIT_IMPULSE_FADE_S;
    }
    if (S.splitMode === 'bondDrift') {
      left.bondTimer = BOND_DURATION;
      right.bondTimer = BOND_DURATION;
    }

    this.cells.splice(idx, 1, left, right);
    this.selectedCells.delete(cell);
  }

  // ---------- Hit test ----------
  /**
   * Pop a cell as if it were a slow balloon, releasing protein/gut
   * particles that swirl outward and fade over ~2 s. The cell itself
   * is removed from the live pool immediately. Accepts either a cell
   * index or a Cell instance.
   */
  killCell(cellOrIdx) {
    let idx, c;
    if (typeof cellOrIdx === 'number') {
      idx = cellOrIdx;
      c = this.cells[idx];
    } else {
      c = cellOrIdx;
      idx = this.cells.indexOf(c);
    }
    if (!c || idx < 0) return;
    const cc = c._colors || {};
    const N = 32;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 50 + Math.random() * 100;
      // Two flavours of debris: protein (cytoBot) and guts (nucleus).
      const isGut = (i % 3) === 0;
      this.particles.push({
        x: c.x + Math.cos(ang) * c.r * 0.30,
        y: c.y + Math.sin(ang) * c.r * 0.30,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        spin: (Math.random() - 0.5) * 5.0,
        r: 2 + Math.random() * (isGut ? 5 : 3),
        color: isGut ? (cc.nucleus || '#3a1029') : (cc.cytoBot || '#d36699'),
        life: 2.0,
        maxLife: 2.0,
      });
    }
    this.cells.splice(idx, 1);
    this.selectedCells.delete(c);
  }

  hitCell(worldX, worldY) {
    let hit = -1, hitD = Infinity;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (c.state !== 'NORMAL') continue;
      const dx = c.x - worldX, dy = c.y - worldY;
      const d2 = dx * dx + dy * dy;
      const reach = c.r * 1.4;
      if (d2 < reach * reach && d2 < hitD) { hitD = d2; hit = i; }
    }
    return hit;
  }

  // ---------- Swarm cohesion + spatial hash ----------
  swarmCentroid(category) {
    let n = 0, sx = 0, sy = 0;
    for (const c of this.cells) {
      if (c.state !== 'NORMAL' || c.category !== category) continue;
      sx += c.x; sy += c.y; n++;
    }
    if (n < 2) return null;
    const cx = sx / n, cy = sy / n;
    let r = 0;
    for (const c of this.cells) {
      if (c.state !== 'NORMAL' || c.category !== category) continue;
      const dx = c.x - cx, dy = c.y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) r = d;
    }
    return { x: cx, y: cy, r: Math.max(200, r) };
  }

  rebuildSpatialGrid() {
    this.spatialGrid.clear();
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (c.state !== 'NORMAL') continue;
      const gx = (c.x / HASH_CELL) | 0;
      const gy = (c.y / HASH_CELL) | 0;
      const k = gx + ',' + gy;
      let arr = this.spatialGrid.get(k);
      if (!arr) { arr = []; this.spatialGrid.set(k, arr); }
      arr.push(c);
    }
  }

  forEachNeighbour(c, radius, fn) {
    const span = Math.max(1, Math.ceil(radius / HASH_CELL));
    const gx = (c.x / HASH_CELL) | 0;
    const gy = (c.y / HASH_CELL) | 0;
    for (let ix = -span; ix <= span; ix++) {
      for (let iy = -span; iy <= span; iy++) {
        const arr = this.spatialGrid.get((gx + ix) + ',' + (gy + iy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          if (o !== c) fn(o);
        }
      }
    }
  }

  // ---------- Frame update ----------
  update(dt) {
    // Particle physics: outward velocity damped by drag, plus a
    // per-particle perpendicular spin force for the swirl effect.
    // Particles are GC'd when life hits zero.
    if (this.particles.length > 0) {
      const dragK = Math.pow(0.45, dt);  // ~55% velocity loss per second
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= dragK;
        p.vy *= dragK;
        // Perpendicular acceleration → swirl.
        const perpScale = p.spin * 1.8;
        p.vx += -p.vy * perpScale * dt;
        p.vy +=  p.vx * perpScale * dt;
        p.life -= dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
    }

    const centroidGood = this.swarmCentroid('good');
    const centroidBad  = this.swarmCentroid('bad');
    this.rebuildSpatialGrid();

    const cells = this.cells;
    const drag = this.drag;

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 2);

      if (c.state === 'NORMAL') {
        if (S.randomSplit) {
          c.splitTimer -= dt;
          if (c.splitTimer <= 0) {
            if (cells.length < S.maxCells) {
              this.beginSplit(c);
            } else {
              c.splitTimer = this.rollSplitTimer(c.type) * 0.5;
            }
          }
        }

        if (c !== (drag && drag.cell)) {
          const moveCfg = (CELL_TYPES[c.type] && CELL_TYPES[c.type].move) || DEFAULT_MOVE;
          const sm = S.speedMul || 1;

          if (c.alarmTimer > 0) c.alarmTimer = Math.max(0, c.alarmTimer - dt);

          let goalX = 0, goalY = 0, accel = 0, maxV = 0, hasGoal = false;

          if (c.target) {
            const dx = c.target.x - c.x, dy = c.target.y - c.y;
            const d = Math.hypot(dx, dy);
            if (d < 12) {
              c.target = null;
            } else {
              goalX = dx / d; goalY = dy / d;
              accel = moveCfg.alarmAccel * sm;
              maxV  = moveCfg.attackSpeed * sm;
              hasGoal = true;
            }
          }

          if (!hasGoal) {
            if (c.alarmTimer === 0 && moveCfg.hostility !== 'idle') {
              // Per-pair targeting matrix (sim-rules.js). Picks the
              // closest neighbour for which getRule returns a rule;
              // attractRadius from that rule is the search bound,
              // capped above by the attacker's max attract radius
              // so a single spatial-grid query covers every rule.
              const searchR = Math.max(ALARM_RADIUS, maxAttractRadius(c.type));
              let bestD = searchR * searchR, enemy = null, enemyRule = null;
              this.forEachNeighbour(c, searchR, (o) => {
                if (o.state !== 'NORMAL') return;
                const rule = getRule(c.type, o.type);
                if (!rule) return;
                const dx = o.x - c.x, dy = o.y - c.y;
                const d2 = dx*dx + dy*dy;
                if (d2 < rule.attract * rule.attract && d2 < bestD) {
                  bestD = d2; enemy = o; enemyRule = rule;
                }
              });
              if (enemy) {
                c.alarmTarget = enemy; c.alarmTimer = 1.6;
                c.alarmRule = enemyRule;
              }
            }

            if (c.alarmTimer > 0 && c.alarmTarget && c.alarmTarget.state === 'NORMAL') {
              const dx = c.alarmTarget.x - c.x, dy = c.alarmTarget.y - c.y;
              const d = Math.hypot(dx, dy) || 1;
              const sign = (moveCfg.hostility === 'flee') ? -1 : 1;
              goalX = sign * dx / d; goalY = sign * dy / d;
              accel = moveCfg.alarmAccel * sm;
              maxV  = moveCfg.attackSpeed * sm;
              hasGoal = true;
              // Apply per-pair damage when inside attack range. Cached
              // alarmRule was set when this target was acquired; if
              // missing (e.g. target type changed), look it up fresh.
              const rule = c.alarmRule || getRule(c.type, c.alarmTarget.type);
              if (rule && rule.dps > 0 && d < rule.attack) {
                this._applyDamage(c.alarmTarget, rule.dps * dt);
                if (c.alarmTarget.hp <= 0) {
                  c.alarmTarget = null;
                  c.alarmTimer = 0;
                  c.alarmRule = null;
                }
              }
            } else {
              const home = (c.category === 'bad') ? centroidBad : centroidGood;
              if (home && home.r > 0) {
                const hdx = home.x - c.x, hdy = home.y - c.y;
                const hd = Math.hypot(hdx, hdy);
                if (hd > 1.30 * home.r) {
                  c.patrolTarget = { x: home.x, y: home.y };
                  c.patrolTimer  = 4;
                }
              }
              c.patrolTimer -= dt;
              const reached = c.patrolTarget &&
                ((c.x - c.patrolTarget.x) ** 2 + (c.y - c.patrolTarget.y) ** 2) < 30 * 30;
              if (!c.patrolTarget || c.patrolTimer <= 0 || reached) {
                let pt = null;
                if (cells.length > 1 && Math.random() < 0.6) {
                  let other = null, tries = 6;
                  while (tries-- > 0) {
                    const o = cells[Math.floor(Math.random() * cells.length)];
                    if (o !== c && o.state === 'NORMAL') { other = o; break; }
                  }
                  if (other) pt = { x: other.x, y: other.y };
                }
                if (!pt) {
                  pt = {
                    x: c.x + (Math.random() - 0.5) * c.r * 12,
                    y: c.y + (Math.random() - 0.5) * c.r * 12,
                  };
                }
                c.patrolTarget = pt;
                c.patrolTimer = 3 + Math.random() * 5;
              }
              const dx = c.patrolTarget.x - c.x, dy = c.patrolTarget.y - c.y;
              const d = Math.hypot(dx, dy) || 1;
              goalX = dx / d; goalY = dy / d;
              accel = moveCfg.patrolAccel * sm;
              maxV  = moveCfg.patrolSpeed * sm;
              hasGoal = true;

              const bMul = (CELL_TYPES[c.type] && CELL_TYPES[c.type].brownianMul) || 1.0;
              c.vx += (Math.random() - 0.5) * BROWNIAN * bMul * dt * 0.3;
              c.vy += (Math.random() - 0.5) * BROWNIAN * bMul * dt * 0.3;
            }
          }

          if (hasGoal) {
            const w = moveCfg.weight || 1;
            c.vx += goalX * accel * dt / w;
            c.vy += goalY * accel * dt / w;
            const sp = Math.hypot(c.vx, c.vy);
            if (sp > maxV) { c.vx = c.vx / sp * maxV; c.vy = c.vy / sp * maxV; }
          }

          // Split-end impulse fade: ramp the push-apart velocity in
          // linearly over SPLIT_IMPULSE_FADE_S instead of snapping it
          // on at finishSplit. Each frame applies (dt / remaining)
          // of the still-pending impulse → total integrates to the
          // original full kick over the fade window.
          if (c.splitImpulseT > 0) {
            const stepDt = Math.min(dt, c.splitImpulseT);
            const frac = stepDt / c.splitImpulseT;
            c.vx += c.splitImpulseDx * frac;
            c.vy += c.splitImpulseDy * frac;
            c.splitImpulseDx *= (1 - frac);
            c.splitImpulseDy *= (1 - frac);
            c.splitImpulseT -= stepDt;
            if (c.splitImpulseT < 1e-4) {
              c.splitImpulseDx = 0;
              c.splitImpulseDy = 0;
              c.splitImpulseT = 0;
            }
          }

          let frictionEff = S.friction * (moveCfg.friction || 1);
          if (S.splitMode === 'bondDrift' && c.bondTimer > 0) {
            c.bondTimer -= dt;
            frictionEff = Math.min(1, frictionEff + 0.3);
          }
          frictionEff = Math.max(0, Math.min(1, frictionEff));
          const dampingPerSec = Math.max(0.001, Math.pow(0.05, frictionEff));
          const k = Math.pow(dampingPerSec, dt);
          c.vx *= k; c.vy *= k;

          c.x += c.vx * dt;
          c.y += c.vy * dt;
        }
      } else if (c.state === 'SPLITTING') {
        c.splitProgress += dt / SPLIT_DURATION;
        // Keep moving with the original velocity — same friction model
        // as the NORMAL block, but no AI / goal / Brownian terms so the
        // splitting cell drifts naturally without picking up new forces.
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const fricEff = Math.max(0, Math.min(1, S.friction));
        const dampingPerSec = Math.max(0.001, Math.pow(0.05, fricEff));
        const k = Math.pow(dampingPerSec, dt);
        c.vx *= k; c.vy *= k;
        if (c.splitProgress >= 1) {
          this.finishSplit(c, i);
        }
      }
    }

    // Pairwise collision response (rebuild grid first since cells just moved).
    {
      const e = S.bounce;
      this.rebuildSpatialGrid();
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        if (a.state !== 'NORMAL') continue;
        this.forEachNeighbour(a, HASH_CELL, (b) => {
          if (b.state !== 'NORMAL') return;
          if (b.id <= a.id) return;
          if (S.splitMode === 'bondDrift' && (a.bondTimer > 0 || b.bondTimer > 0)) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          const minD = a.r + b.r;
          if (d2 < minD * minD && d2 > 1) {
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            const overlap = minD - d;
            const aFixed = (drag && drag.cell === a);
            const bFixed = (drag && drag.cell === b);
            if (aFixed && !bFixed) {
              b.x += nx * overlap; b.y += ny * overlap;
            } else if (bFixed && !aFixed) {
              a.x -= nx * overlap; a.y -= ny * overlap;
            } else if (!aFixed && !bFixed) {
              a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
              b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
            }
            const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;
            if (velAlongNormal < 0) {
              const j = -(1 + e) * velAlongNormal / 2;
              if (!aFixed) { a.vx -= j * nx; a.vy -= j * ny; }
              if (!bFixed) { b.vx += j * nx; b.vy += j * ny; }
            }
          }
        });
      }
    }
  }

  // ---------- Spawning ----------
  spawnAtCenter(typeKey) {
    if (this.cells.length >= S.maxCells) return null;
    const w = this.screenToWorld(this.W / 2, this.H / 2);
    return this.spawnAtWorld(typeKey, w.x, w.y);
  }

  spawnAtWorld(typeKey, wx, wy) {
    if (this.cells.length >= S.maxCells) return null;
    const jitter = CELL_RADIUS * 0.2;
    const c = this.makeCell(
      wx + (Math.random() - 0.5) * jitter,
      wy + (Math.random() - 0.5) * jitter,
      undefined,
      typeKey,
    );
    this.cells.push(c);
    return c;
  }

  resetSim() {
    this.cells.length = 0;
    this.cellId = 0;
    this.selectedCells.clear();
    this.targetMarker = null;
    this.particles.length = 0;
    const c = this.makeCell(this.W / 2, this.H / 2);
    this.cells.push(c);
  }
}
