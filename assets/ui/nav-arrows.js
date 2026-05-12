// Off-screen navigation arrows.
//
// Four edge-anchored SVG arrows (top / bottom / left / right) that
// appear when sim cells are outside the viewport. Each arrow
// encodes the cells in its direction:
//   - hue: lerp red ↔ green by good/(good+bad) ratio (CELL_TYPES
//     category field)
//   - saturation: 50% at 1 cell → 100% at ≥ 32 cells
//   - size: 18×14 px at 1 cell → 44×32 px at ≥ 32 cells
//
// Renderer-agnostic — pure HTML/SVG overlay; one update per
// frame-loop tick (already throttled to ~4 Hz by the call site).

import { CELL_TYPES } from '../core/state.js';

const EDGES = ['top', 'bottom', 'left', 'right'];
// SVG triangle pointing UP (tip at top, base at bottom). Per-edge
// CSS transforms rotate this into place.
const TRIANGLE_POINTS = '50,8 88,92 12,92';

function makeArrow(edge) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('nav-arrow', `nav-arrow-${edge}`, 'hidden');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', TRIANGLE_POINTS);
  svg.appendChild(poly);
  return { svg, poly };
}

export class NavArrows {
  constructor(parent) {
    this.layer = document.createElement('div');
    this.layer.className = 'nav-arrows-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.arrows = {};
    for (const e of EDGES) {
      const a = makeArrow(e);
      this.arrows[e] = a;
      this.layer.appendChild(a.svg);
    }
    parent.appendChild(this.layer);
  }

  // Iterate cells, bucket the off-screen ones into top/bottom/left/right
  // by which edge they exit through (screen diagonal as the bucket
  // boundary, computed via half-viewport-normalised offsets so the
  // boundary follows the actual aspect ratio of the viewport). Each
  // bucket accumulates good + bad counts; one update per call writes
  // visibility + size + colour to the four SVGs.
  update(sim, enabled) {
    const W = sim && sim.W;
    const H = sim && sim.H;
    if (!enabled || !sim || !sim.cells || !W || !H) {
      for (const e of EDGES) this.arrows[e].svg.classList.add('hidden');
      return;
    }
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
      const ndx = (s.x - cx) / cx;
      const ndy = (s.y - cy) / cy;
      let edge;
      if (Math.abs(ndy) > Math.abs(ndx)) edge = ndy < 0 ? 'top'  : 'bottom';
      else                               edge = ndx < 0 ? 'left' : 'right';
      const meta = CELL_TYPES[c.type];
      const cat = meta && meta.category;
      buckets[edge][cat === 'bad' ? 'bad' : 'good']++;
    }
    for (const e of EDGES) this._renderArrow(e, buckets[e]);
  }

  _renderArrow(edge, { good, bad }) {
    const { svg, poly } = this.arrows[edge];
    const total = good + bad;
    if (total <= 0) {
      svg.classList.add('hidden');
      return;
    }
    svg.classList.remove('hidden');
    // Saturation 50% (1 cell) → 100% (≥ 32 cells), linear.
    const t = Math.min(1, Math.max(0, (total - 1) / 31));
    const sat = 50 + 50 * t;
    // Hue: 0° red (all bad) → 120° green (all good), linear in good-ratio.
    const hue = 120 * (good / total);
    poly.setAttribute('fill', `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, 55%)`);
    // Layout size: physical SVG box is thickness × length. CSS
    // rotate-by-edge swaps which screen axis each maps to.
    const length    = 18 + (44 - 18) * t;
    const thickness = 14 + (32 - 14) * t;
    svg.style.width  = `${thickness.toFixed(1)}px`;
    svg.style.height = `${length.toFixed(1)}px`;
  }
}
