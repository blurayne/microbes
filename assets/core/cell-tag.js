// Cell-type overlay — eye-toggle (S.cellTypeOverlay).
//
// Renders a colored ring + label above each sim cell, identifying
// its type. HTML overlay above the canvas so it's renderer-agnostic
// (works for canvas2d, webgl2, webgpu identically). pointer-events:
// none on the layer + entries so labels never block interaction.
//
// Pool strategy: each render() reuses DOM nodes by index. Trailing
// nodes (when the cell count drops) get .style.display = 'none'
// rather than removed, since spawn / despawn churn during combat
// would otherwise thrash the DOM.

import { S, CELL_TYPES, cellLabel } from './state.js';

export class CellTagOverlay {
  constructor(container) {
    this.container = container;
    this.pool = [];     // Array<{root, ring, label}>
  }

  render(sim) {
    if (!S.cellTypeOverlay) {
      // Hide every active node.
      for (const e of this.pool) {
        if (e.root.style.display !== 'none') e.root.style.display = 'none';
      }
      return;
    }
    if (!sim || !sim.worldToScreen) return;

    const camScale = sim.camera?.scale || 1;
    let i = 0;
    for (const cell of sim.cells) {
      if (!cell || cell.state === 'DEAD') continue;
      const cfg = CELL_TYPES[cell.type];
      if (!cfg) continue;
      let e = this.pool[i];
      if (!e) {
        e = this._make();
        this.pool.push(e);
      }
      const s = sim.worldToScreen(cell.x, cell.y);
      const r = Math.max(8, cell.r * camScale);
      const color = cfg.colors?.accent || cfg.colors?.cytoTop || '#ffffff';
      e.root.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      e.root.style.setProperty('--ring-r', r.toFixed(1) + 'px');
      e.root.style.setProperty('--ring-color', color);
      e.label.textContent = cellLabel(cell.type);
      if (e.root.style.display === 'none') e.root.style.display = '';
      i++;
    }
    // Hide unused trailing nodes.
    for (; i < this.pool.length; i++) {
      const e = this.pool[i];
      if (e.root.style.display !== 'none') e.root.style.display = 'none';
    }
  }

  _make() {
    const root  = document.createElement('div');
    root.className = 'cell-tag';
    const ring  = document.createElement('div');
    ring.className = 'cell-tag-ring';
    const label = document.createElement('div');
    label.className = 'cell-tag-label';
    root.appendChild(ring);
    root.appendChild(label);
    this.container.appendChild(root);
    return { root, ring, label };
  }

  clear() {
    for (const e of this.pool) e.root.remove();
    this.pool.length = 0;
  }
}
