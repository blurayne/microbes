// Off-screen navigation arrows.
//
// Two display modes (S.navMode):
//   * 'floating' — four edge-anchored aggregate arrows (top / bottom /
//     left / right). Each arrow encodes ALL cells exiting through that
//     cardinal direction, sized & coloured by counts. Original UX.
//   * 'anchored' — per-cell arrows projected onto the screen rectangle
//     at the cell's exit point, sliding along the edge as the cell
//     moves. When many off-screen cells crowd into the same arc of
//     the perimeter they are merged via 1D greedy threshold clustering
//     (see ALGORITHMS.md → "Edge-anchored navigation arrows: clustering").
//
// In both modes each arrow's appearance encodes:
//   - hue: lerp red ↔ green by good/(good+bad) ratio (CELL_TYPES
//     category field)
//   - saturation: 50% at 1 cell → 100% at ≥ 32 cells
//   - size: 18×14 px at 1 cell → 44×32 px at ≥ 32 cells
// Anchored clusters additionally show a numeric badge above the arrow
// whenever the cluster has > 1 cell, so the user knows how many
// off-screen objects are merged into the single indicator.
//
// Renderer-agnostic — pure HTML/SVG overlay; one update per
// frame-loop tick (already throttled to ~4 Hz by the call site).

import { CELL_TYPES, S } from '../core/state.js';

const EDGES = ['top', 'bottom', 'left', 'right'];
// SVG triangle pointing UP (tip at top, base at bottom). Per-edge
// CSS transforms (floating) or inline rotation (anchored) rotate this
// into place.
const TRIANGLE_POINTS = '50,8 88,92 12,92';

// --- 1D-greedy clustering tuning -------------------------------------
// Maximum gap (in screen px, measured along the rectangular perimeter)
// for two adjacent items to remain in the same cluster. Roughly the
// physical width of a 1-cell anchored arrow plus a little breathing
// room. Lower → more arrows but better positional fidelity; higher →
// fewer arrows but they drift further from any single cell.
const CLUSTER_GAP_PX = 60;
// Inset from each screen edge so the arrow doesn't graze the chrome.
const EDGE_INSET_PX = 8;
// Min DOM-element pool size for anchored mode (we grow on demand).
const ANCHORED_POOL_MIN = 4;

function makeFloatingArrow(edge) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('nav-arrow', 'nav-arrow-floating', `nav-arrow-${edge}`, 'hidden');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', TRIANGLE_POINTS);
  svg.appendChild(poly);
  return { svg, poly };
}

// Anchored arrow: SVG + an HTML count badge inside a positioning <div>.
// The wrapper carries absolute (x, y) + rotation; the badge is a child
// so it stays in formation with its arrow as the cluster slides.
function makeAnchoredArrow() {
  const wrap = document.createElement('div');
  wrap.className = 'nav-arrow-anchor hidden';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('nav-arrow', 'nav-arrow-anchored');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', TRIANGLE_POINTS);
  svg.appendChild(poly);
  const badge = document.createElement('span');
  badge.className = 'nav-arrow-badge';
  wrap.appendChild(svg);
  wrap.appendChild(badge);
  return { wrap, svg, poly, badge };
}

// Project an off-screen point (px, py) onto the nearest edge of the
// [0,W] × [0,H] rectangle by casting a ray from the screen centre. The
// edge hit is whichever of the four sides the ray would exit first.
// Returns { edge, x, y } in screen px. Used by anchored mode only.
function projectToEdge(px, py, W, H) {
  const cx = W * 0.5, cy = H * 0.5;
  const dx = px - cx, dy = py - cy;
  if (dx === 0 && dy === 0) return { edge: 'right', x: W, y: cy };
  // Parameter t for which (cx + t*dx, cy + t*dy) hits an edge. We
  // collect all positive-t candidates and keep the smallest whose
  // intersection lies on the actual edge segment.
  const cands = [];
  if (dx !== 0) {
    const tR = (W - cx) / dx, tL = (0 - cx) / dx;
    if (tR > 0) cands.push({ t: tR, edge: 'right',  x: W, y: cy + tR * dy });
    if (tL > 0) cands.push({ t: tL, edge: 'left',   x: 0, y: cy + tL * dy });
  }
  if (dy !== 0) {
    const tB = (H - cy) / dy, tT = (0 - cy) / dy;
    if (tB > 0) cands.push({ t: tB, edge: 'bottom', x: cx + tB * dx, y: H });
    if (tT > 0) cands.push({ t: tT, edge: 'top',    x: cx + tT * dx, y: 0 });
  }
  cands.sort((a, b) => a.t - b.t);
  for (const c of cands) {
    if (c.edge === 'left' || c.edge === 'right') {
      if (c.y >= 0 && c.y <= H) return c;
    } else {
      if (c.x >= 0 && c.x <= W) return c;
    }
  }
  return cands[0] || { edge: 'right', x: W, y: cy };
}

// Map a point on the screen rectangle perimeter to a 1D arc-length
// parameter s ∈ [0, 2(W+H)), running clockwise starting at top-left.
// Used to sort + greedy-cluster anchored arrows in a single pass.
function perimeterParam(edge, x, y, W, H) {
  switch (edge) {
    case 'top':    return x;
    case 'right':  return W + y;
    case 'bottom': return W + H + (W - x);
    case 'left':   return 2 * W + H + (H - y);
    default:       return 0;
  }
}

// Inverse of perimeterParam — turn a 1D perimeter parameter back into
// a screen-px (x, y) + edge tag. Used to render a CLUSTER, whose
// position is the mean perimeter parameter of its members.
function perimeterPoint(s, W, H) {
  const perim = 2 * (W + H);
  let r = ((s % perim) + perim) % perim;
  if (r < W)                  return { edge: 'top',    x: r,                       y: 0 };
  if (r < W + H)              return { edge: 'right',  x: W,                       y: r - W };
  if (r < 2 * W + H)          return { edge: 'bottom', x: W - (r - W - H),         y: H };
  /* otherwise on left edge */ return { edge: 'left',   x: 0,                       y: H - (r - 2 * W - H) };
}

// Outward-pointing rotation in degrees for each edge.
function edgeRotationDeg(edge) {
  switch (edge) {
    case 'top':    return 0;       // tip up
    case 'right':  return 90;
    case 'bottom': return 180;
    case 'left':   return -90;
    default:       return 0;
  }
}

export class NavArrows {
  constructor(parent) {
    this.layer = document.createElement('div');
    this.layer.className = 'nav-arrows-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.layer);

    // Floating mode: 4 fixed-edge SVGs.
    this.floating = {};
    for (const e of EDGES) {
      const a = makeFloatingArrow(e);
      this.floating[e] = a;
      this.layer.appendChild(a.svg);
    }

    // Anchored mode: dynamically grown pool of arrow elements; only
    // the first `clusters.length` are visible on any given tick.
    this.anchoredPool = [];
    for (let i = 0; i < ANCHORED_POOL_MIN; i++) this._growAnchoredPool();
  }

  _growAnchoredPool() {
    const a = makeAnchoredArrow();
    this.anchoredPool.push(a);
    this.layer.appendChild(a.wrap);
    return a;
  }

  _hideFloating() {
    for (const e of EDGES) this.floating[e].svg.classList.add('hidden');
  }
  _hideAnchored() {
    for (const a of this.anchoredPool) a.wrap.classList.add('hidden');
  }

  // Public: called once per frame-loop tick from app.js. `enabled` is
  // S.navArrows; mode is read from S.navMode so the call site stays
  // tiny.
  update(sim, enabled) {
    const W = sim && sim.W;
    const H = sim && sim.H;
    if (!enabled || !sim || !sim.cells || !W || !H) {
      this._hideFloating();
      this._hideAnchored();
      return;
    }
    const mode = (S.navMode === 'anchored') ? 'anchored' : 'floating';
    if (mode === 'anchored') {
      this._hideFloating();
      this._updateAnchored(sim, W, H);
    } else {
      this._hideAnchored();
      this._updateFloating(sim, W, H);
    }
  }

  // ---- Floating (original): 4 aggregate edge arrows ------------------
  _updateFloating(sim, W, H) {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const buckets = {
      top:    { good: 0, bad: 0 },
      bottom: { good: 0, bad: 0 },
      left:   { good: 0, bad: 0 },
      right:  { good: 0, bad: 0 },
    };
    const cells = sim.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const s = sim.worldToScreen(c.x, c.y);
      const r = c.r || 0;
      if (s.x + r >= 0 && s.x - r <= W && s.y + r >= 0 && s.y - r <= H) continue;
      // Bucket by which axis is dominantly off-screen — uses
      // half-viewport-normalised offsets so the bucket boundary follows
      // the actual viewport aspect ratio.
      const ndx = (s.x - cx) / cx;
      const ndy = (s.y - cy) / cy;
      let edge;
      if (Math.abs(ndy) > Math.abs(ndx)) edge = ndy < 0 ? 'top'  : 'bottom';
      else                               edge = ndx < 0 ? 'left' : 'right';
      const meta = CELL_TYPES[c.type];
      const cat = meta && meta.category;
      buckets[edge][cat === 'bad' ? 'bad' : 'good']++;
    }
    for (const e of EDGES) this._renderFloating(e, buckets[e]);
  }

  _renderFloating(edge, { good, bad }) {
    const { svg, poly } = this.floating[edge];
    const total = good + bad;
    if (total <= 0) {
      svg.classList.add('hidden');
      return;
    }
    svg.classList.remove('hidden');
    const t = Math.min(1, Math.max(0, (total - 1) / 31));
    const sat = 50 + 50 * t;
    const hue = 120 * (good / total);
    poly.setAttribute('fill', `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, 55%)`);
    const length    = 18 + (44 - 18) * t;
    const thickness = 14 + (32 - 14) * t;
    svg.style.width  = `${thickness.toFixed(1)}px`;
    svg.style.height = `${length.toFixed(1)}px`;
  }

  // ---- Anchored: per-cell arrows on the perimeter, 1D-clustered ------
  //
  // Algorithm in three passes:
  //   1. Project each off-screen cell to a point (edge, x, y) on the
  //      screen rectangle via projectToEdge, then to a 1D arc-length s.
  //   2. Sort by s and walk linearly, opening a new cluster every time
  //      the gap to the previous item exceeds CLUSTER_GAP_PX. This is
  //      the greedy-threshold variant of 1D clustering — equivalent to
  //      single-linkage agglomerative clustering with cutoff = gap.
  //   3. Render one arrow per cluster at the cluster's mean s; arrow
  //      size & hue come from the cluster's good/bad counts (same
  //      mapping as floating mode). When count > 1, show a small
  //      count badge above the arrow.
  // See ALGORITHMS.md for full discussion (complexity, wrap-around,
  // hysteresis, alternatives considered).
  _updateAnchored(sim, W, H) {
    const cells = sim.cells;
    const items = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const s = sim.worldToScreen(c.x, c.y);
      const r = c.r || 0;
      if (s.x + r >= 0 && s.x - r <= W && s.y + r >= 0 && s.y - r <= H) continue;
      const proj = projectToEdge(s.x, s.y, W, H);
      const sArc = perimeterParam(proj.edge, proj.x, proj.y, W, H);
      const meta = CELL_TYPES[c.type];
      const cat = meta && meta.category;
      items.push({ s: sArc, cat });
    }
    items.sort((a, b) => a.s - b.s);

    const clusters = [];
    for (const it of items) {
      const cur = clusters[clusters.length - 1];
      if (cur && (it.s - cur.lastS) < CLUSTER_GAP_PX) {
        cur.count++;
        if (it.cat === 'bad') cur.bad++; else cur.good++;
        cur.sumS += it.s;
        cur.lastS = it.s;
      } else {
        clusters.push({
          count: 1,
          good: it.cat === 'bad' ? 0 : 1,
          bad:  it.cat === 'bad' ? 1 : 0,
          sumS: it.s,
          lastS: it.s,
        });
      }
    }
    // Wrap-around merge: if the first and last clusters straddle the
    // top-left corner (s≈0 / s≈perim) and the gap going the "short
    // way" round is below the threshold, fold them into one cluster.
    if (clusters.length > 1) {
      const first = clusters[0];
      const last  = clusters[clusters.length - 1];
      const perim = 2 * (W + H);
      const firstMean = first.sumS / first.count;
      const lastMean  = last.sumS  / last.count;
      const wrapGap   = (perim - lastMean) + firstMean;
      if (wrapGap < CLUSTER_GAP_PX) {
        const merged = {
          count: first.count + last.count,
          good:  first.good  + last.good,
          bad:   first.bad   + last.bad,
          // Average the two cluster means in arc-length space,
          // handling wrap by treating the last cluster's mean as
          // negative-side from 0.
          sumS:  (first.sumS) + (last.sumS - perim * last.count),
          lastS: first.lastS,
        };
        clusters.shift();
        clusters.pop();
        clusters.unshift(merged);
      }
    }

    // Grow pool if we have more clusters than DOM elements.
    while (this.anchoredPool.length < clusters.length) this._growAnchoredPool();

    // Render each cluster.
    for (let i = 0; i < clusters.length; i++) {
      this._renderAnchoredCluster(this.anchoredPool[i], clusters[i], W, H);
    }
    // Hide the remaining unused pool entries.
    for (let i = clusters.length; i < this.anchoredPool.length; i++) {
      this.anchoredPool[i].wrap.classList.add('hidden');
    }
  }

  _renderAnchoredCluster(slot, cluster, W, H) {
    const { wrap, poly, badge } = slot;
    const { count, good, bad, sumS } = cluster;
    if (count <= 0) {
      wrap.classList.add('hidden');
      return;
    }
    const meanS = sumS / count;
    const pt = perimeterPoint(meanS, W, H);
    // Inset the position slightly so the arrow doesn't graze the edge.
    let posX = pt.x, posY = pt.y;
    if (pt.edge === 'top')    posY = EDGE_INSET_PX;
    if (pt.edge === 'bottom') posY = H - EDGE_INSET_PX;
    if (pt.edge === 'left')   posX = EDGE_INSET_PX;
    if (pt.edge === 'right')  posX = W - EDGE_INSET_PX;

    const total = good + bad;
    const t = Math.min(1, Math.max(0, (total - 1) / 31));
    const sat = 50 + 50 * t;
    const hue = 120 * (good / total);
    poly.setAttribute('fill', `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, 55%)`);
    const length    = 18 + (44 - 18) * t;
    const thickness = 14 + (32 - 14) * t;

    wrap.classList.remove('hidden');
    // translate(-50%, -50%) centres the SVG on (posX, posY); the
    // rotation then orients the tip outward.
    wrap.style.left = `${posX.toFixed(1)}px`;
    wrap.style.top  = `${posY.toFixed(1)}px`;
    wrap.style.transform =
      `translate(-50%, -50%) rotate(${edgeRotationDeg(pt.edge)}deg)`;
    // SVG dimensions (pre-rotation: thickness × length, tip pointing
    // along local +Y → after rotation, tip points outward).
    wrap.style.setProperty('--nav-arrow-thickness', `${thickness.toFixed(1)}px`);
    wrap.style.setProperty('--nav-arrow-length',    `${length.toFixed(1)}px`);

    if (count > 1) {
      badge.textContent = String(count);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}
