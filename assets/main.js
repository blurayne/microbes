(() => {
  'use strict';

  // ---------- Settings ----------
  const SETTINGS_KEY = 'microbes.settings.v2';
  const SETTINGS_KEY_V1 = 'microbes.settings.v1';
  const DEFAULTS = {
    splitMode: 'bondDrift',     // 'pushApart' | 'bondDrift' | 'fixedGrid'
    autoSplitSeconds: 10,
    maxCells: 32,
    bgFlowSpeed: 1.0,
    outlinePx: 5,
    showDebugField: false,
    theme: 'microbeGarden',
    activeTypes: ['sphere', 'virus', 'rod', 'ciliated'],
  };

  function loadSettings() {
    try {
      let raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        const v1 = localStorage.getItem(SETTINGS_KEY_V1);
        if (v1) {
          try { localStorage.removeItem(SETTINGS_KEY_V1); } catch {}
          return { ...DEFAULTS, ...JSON.parse(v1) };
        }
        return { ...DEFAULTS };
      }
      const parsed = JSON.parse(raw);
      // Sanitize: activeTypes must be a non-empty array
      if (!Array.isArray(parsed.activeTypes) || parsed.activeTypes.length === 0) {
        parsed.activeTypes = [...DEFAULTS.activeTypes];
      }
      return { ...DEFAULTS, ...parsed };
    } catch { return { ...DEFAULTS }; }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch {}
  }

  const S = loadSettings();

  // ---------- Themes ----------
  const THEMES = {
    microbeGarden: {
      label: 'Microbe Garden',
      bg: { kind: 'flat', base: '#cfe5e9', spotColor: 'rgba(255,170,140,0.18)', spotCount: 5, vignette: 0.0 },
      outline: { kind: 'solid', color: '#1a0e10', defaultPx: 5 },
      palette: {
        cytoplasmTop: '#ffd6a5', cytoplasmBot: '#f8978c',
        nucleus: '#5a1f30', nucleusHi: '#ffe2c2',
        accent: '#c2375a', innerHighlight: 'rgba(255,235,200,0.45)',
      },
      ui: { panelAccent: '#c2375a' },
    },
    pandemic: {
      label: 'Pandemic',
      bg: { kind: 'flat', base: '#f5efe7', spotColor: 'rgba(220,80,110,0.10)', spotCount: 3, vignette: 0.0 },
      outline: { kind: 'solid', color: '#3a0d1a', defaultPx: 6 },
      palette: {
        cytoplasmTop: '#ffadc6', cytoplasmBot: '#d1457c',
        nucleus: '#56112c', nucleusHi: '#ffd0dd',
        accent: '#e35d2a', innerHighlight: 'rgba(255,235,240,0.5)',
      },
      ui: { panelAccent: '#e35d2a' },
    },
    neonBloom: {
      label: 'Neon Bloom',
      bg: { kind: 'navy-ghost', base: '#0e1840', spotColor: 'rgba(80,40,160,0.25)', spotCount: 7, vignette: 0.4 },
      outline: { kind: 'glow', color: '#ff4fbf', glow: 18, innerColor: '#1a0a2a', defaultPx: 4 },
      palette: {
        cytoplasmTop: 'rgba(40,15,80,0.65)', cytoplasmBot: 'rgba(15,5,35,0.65)',
        nucleus: '#ff8000', nucleusHi: '#ffe070',
        accent: '#56ffb0', innerHighlight: 'rgba(255,180,255,0.18)',
      },
      organelleColors: ['#56ffb0', '#ff4fbf', '#ffe070', '#34d8ff', '#ff8000'],
      ui: { panelAccent: '#ff4fbf' },
    },
    aquaticGlow: {
      label: 'Aquatic Glow',
      bg: { kind: 'gradient', topColor: '#001a4a', botColor: '#00050f', spotColor: 'rgba(80,200,255,0.10)', spotCount: 4, vignette: 0.3 },
      outline: { kind: 'glow', color: '#5ce7ff', glow: 14, innerColor: '#08172e', defaultPx: 4 },
      palette: {
        cytoplasmTop: 'rgba(80,90,220,0.6)', cytoplasmBot: 'rgba(30,40,120,0.6)',
        nucleus: '#9be7ff', nucleusHi: '#ffffff',
        accent: '#5ce7ff', innerHighlight: 'rgba(160,220,255,0.22)',
      },
      starChromatin: true,
      ui: { panelAccent: '#5ce7ff' },
    },
  };

  function currentTheme() {
    return THEMES[S.theme] || THEMES.microbeGarden;
  }

  // ---------- Cell types ----------
  const CELL_TYPES = {
    sphere:   { label: 'Sphere',        shape: 'round',   spikes: 0,  cilia: 0,  aspect: 1.0,  splitFactor: 1.0, brownianMul: 1.0 },
    virus:    { label: 'Spiked virus',  shape: 'round',   spikes: 14, cilia: 0,  aspect: 1.0,  splitFactor: 1.2, brownianMul: 0.8 },
    rod:      { label: 'Rod bacterium', shape: 'capsule', spikes: 0,  cilia: 0,  aspect: 2.1,  splitFactor: 0.8, brownianMul: 1.2 },
    ciliated: { label: 'Ciliated cell', shape: 'round',   spikes: 0,  cilia: 32, aspect: 1.05, splitFactor: 1.4, brownianMul: 1.6 },
  };

  function pickRandomActiveType() {
    const list = (Array.isArray(S.activeTypes) && S.activeTypes.length)
      ? S.activeTypes.filter(k => CELL_TYPES[k])
      : ['sphere'];
    return list[Math.floor(Math.random() * list.length)] || 'sphere';
  }

  // ---------- Constants ----------
  const SPLIT_DURATION = 0.9;
  const BOND_DURATION = 2.0;
  const CELL_RADIUS = 52;          // 2× original
  const NUCLEUS_RATIO = 0.30;
  const BROWNIAN = 18;             // softer jiggle for gel feel
  const REPULSION = 180;
  const MARGIN = 80;
  const MARGIN_SPRING = 5;
  const DOWNSAMPLE = 0.5;
  const WOBBLE_VERTS = 32;         // polygon resolution for membrane
  const WOBBLE_AMP = 0.085;        // ±fraction of r added by wobble

  // ---------- Canvas + offscreens ----------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');
  const off2 = document.createElement('canvas');
  const off2Ctx = off2.getContext('2d');

  let dpr = 1, W = 0, H = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ow = Math.max(2, Math.floor(W * DOWNSAMPLE));
    const oh = Math.max(2, Math.floor(H * DOWNSAMPLE));
    off.width = ow; off.height = oh;
    off2.width = ow; off2.height = oh;

    if (S.splitMode === 'fixedGrid') buildGrid();
    clampAllInside();
  }

  // ---------- Cells ----------
  const cells = [];
  let cellId = 0;

  function makeCell(x, y, r = CELL_RADIUS, type = null) {
    const t = (type && CELL_TYPES[type]) ? type : pickRandomActiveType();
    return {
      id: ++cellId,
      x, y, r,
      vx: 0, vy: 0,
      type: t,
      state: 'NORMAL',
      splitTimer: rollSplitTimer(t),
      splitProgress: 0,
      splitAngle: 0,
      bondTimer: 0,
      gridIndex: -1,
      phase: Math.random() * Math.PI * 2,
      orientation: Math.random() * Math.PI * 2,
      wobbleSeed: Math.random() * 1000,
      wobbleFreq: 0.55 + Math.random() * 0.45,
      flash: 0,
    };
  }

  function rollSplitTimer(type) {
    const factor = (type && CELL_TYPES[type]) ? CELL_TYPES[type].splitFactor : 1.0;
    const j = (Math.random() * 0.6) - 0.3;
    return Math.max(1.5, S.autoSplitSeconds * factor * (1 + j));
  }

  function clampAllInside() {
    for (const c of cells) {
      c.x = Math.max(MARGIN, Math.min(W - MARGIN, c.x));
      c.y = Math.max(MARGIN, Math.min(H - MARGIN, c.y));
    }
  }

  // ---------- Hex grid ----------
  let gridSlots = [];

  function buildGrid() {
    gridSlots = [];
    const r = CELL_RADIUS;
    const dx = r * 2.6, dy = r * 2.25;
    const cols = Math.max(2, Math.floor((W - MARGIN * 2) / dx));
    const rows = Math.max(2, Math.floor((H - MARGIN * 2) / dy));
    const ox = (W - (cols - 1) * dx) / 2;
    const oy = (H - (rows - 1) * dy) / 2;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = ox + col * dx + (row % 2 ? dx * 0.5 : 0);
        const y = oy + row * dy;
        gridSlots.push({ x, y, occupiedBy: 0 });
      }
    }
    // Re-snap any existing cells
    for (const c of cells) c.gridIndex = -1;
    for (const c of cells) {
      const idx = nearestFreeSlot(c.x, c.y);
      if (idx >= 0) {
        gridSlots[idx].occupiedBy = c.id;
        c.gridIndex = idx;
        c.x = gridSlots[idx].x;
        c.y = gridSlots[idx].y;
        c.vx = c.vy = 0;
      }
    }
  }

  function nearestFreeSlot(x, y) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < gridSlots.length; i++) {
      const s = gridSlots[i];
      if (s.occupiedBy) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ---------- Splitting ----------
  function beginSplit(cell) {
    if (cell.state !== 'NORMAL') return;
    if (cells.length >= S.maxCells) {
      cell.flash = 0.5;
      cell.splitTimer = rollSplitTimer(cell.type) * 0.5;
      return;
    }
    cell.state = 'SPLITTING';
    cell.splitProgress = 0;
    // Rods preferentially split along their long axis for a believable look
    if (cell.type === 'rod') {
      cell.splitAngle = cell.orientation;
    } else {
      cell.splitAngle = Math.random() * Math.PI * 2;
    }
    cell.vx *= 0.3;
    cell.vy *= 0.3;
  }

  function finishSplit(cell, idx) {
    const a = cell.splitAngle;
    const cx = Math.cos(a), cy = Math.sin(a);
    const sep = cell.r * 1.05;
    const left = makeCell(cell.x - cx * sep, cell.y - cy * sep, cell.r, cell.type);
    const right = makeCell(cell.x + cx * sep, cell.y + cy * sep, cell.r, cell.type);
    // Daughters inherit parent orientation so rods stay aligned with their lineage
    left.orientation = cell.orientation;
    right.orientation = cell.orientation;
    // Inherit some of parent velocity
    left.vx = cell.vx; left.vy = cell.vy;
    right.vx = cell.vx; right.vy = cell.vy;

    if (S.splitMode === 'pushApart') {
      const speed = 70;
      left.vx -= cx * speed; left.vy -= cy * speed;
      right.vx += cx * speed; right.vy += cy * speed;
    } else if (S.splitMode === 'bondDrift') {
      const speed = 14;
      left.vx -= cx * speed; left.vy -= cy * speed;
      right.vx += cx * speed; right.vy += cy * speed;
      left.bondTimer = BOND_DURATION;
      right.bondTimer = BOND_DURATION;
    } else if (S.splitMode === 'fixedGrid') {
      if (cell.gridIndex >= 0) gridSlots[cell.gridIndex].occupiedBy = 0;
      const li = nearestFreeSlot(left.x, left.y);
      if (li >= 0) {
        gridSlots[li].occupiedBy = left.id;
        left.gridIndex = li;
        left.x = gridSlots[li].x; left.y = gridSlots[li].y;
        left.vx = left.vy = 0;
      }
      const ri = nearestFreeSlot(right.x, right.y);
      if (ri >= 0) {
        gridSlots[ri].occupiedBy = right.id;
        right.gridIndex = ri;
        right.x = gridSlots[ri].x; right.y = gridSlots[ri].y;
        right.vx = right.vy = 0;
      }
    }

    cells.splice(idx, 1, left, right);
  }

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.target !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let hit = -1, hitD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state !== 'NORMAL') continue;
      const dx = c.x - x, dy = c.y - y;
      const d2 = dx * dx + dy * dy;
      const reach = c.r * 1.4;
      if (d2 < reach * reach && d2 < hitD) { hitD = d2; hit = i; }
    }
    if (hit >= 0) beginSplit(cells[hit]);
  });

  // ---------- Update ----------
  function update(dt) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 2);

      if (c.state === 'NORMAL') {
        c.splitTimer -= dt;
        if (c.splitTimer <= 0) {
          if (cells.length < S.maxCells) {
            beginSplit(c);
          } else {
            c.splitTimer = rollSplitTimer(c.type) * 0.5;
          }
        }

        if (S.splitMode !== 'fixedGrid') {
          // Brownian (per-type multiplier)
          const bMul = (CELL_TYPES[c.type] && CELL_TYPES[c.type].brownianMul) || 1.0;
          c.vx += (Math.random() - 0.5) * BROWNIAN * bMul * dt;
          c.vy += (Math.random() - 0.5) * BROWNIAN * bMul * dt;

          let damping = 0.30;     // gel-like viscous drag
          if (S.splitMode === 'bondDrift' && c.bondTimer > 0) {
            c.bondTimer -= dt;
            damping = 0.15;
          }
          const k = Math.pow(damping, dt);
          c.vx *= k; c.vy *= k;

          // Margin spring
          if (c.x < MARGIN) c.vx += (MARGIN - c.x) * MARGIN_SPRING * dt;
          if (c.x > W - MARGIN) c.vx -= (c.x - (W - MARGIN)) * MARGIN_SPRING * dt;
          if (c.y < MARGIN) c.vy += (MARGIN - c.y) * MARGIN_SPRING * dt;
          if (c.y > H - MARGIN) c.vy -= (c.y - (H - MARGIN)) * MARGIN_SPRING * dt;

          const sp = Math.hypot(c.vx, c.vy);
          const maxSp = (S.splitMode === 'bondDrift' && c.bondTimer > 0) ? 14 : 45;
          if (sp > maxSp) { c.vx = c.vx / sp * maxSp; c.vy = c.vy / sp * maxSp; }

          c.x += c.vx * dt;
          c.y += c.vy * dt;
        }
      } else if (c.state === 'SPLITTING') {
        c.splitProgress += dt / SPLIT_DURATION;
        if (c.splitProgress >= 1) {
          finishSplit(c, i);
        }
      }
    }

    // Pairwise repulsion (skip in fixedGrid; skip pairs while bonded)
    if (S.splitMode !== 'fixedGrid') {
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        if (a.state !== 'NORMAL') continue;
        for (let j = i + 1; j < cells.length; j++) {
          const b = cells[j];
          if (b.state !== 'NORMAL') continue;
          if (S.splitMode === 'bondDrift' && (a.bondTimer > 0 || b.bondTimer > 0)) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          const minD = (a.r + b.r) * 0.95;
          if (d2 < minD * minD && d2 > 1) {
            const d = Math.sqrt(d2);
            const overlap = minD - d;
            const nx = dx / d, ny = dy / d;
            const f = REPULSION * overlap * dt;
            a.vx -= nx * f; a.vy -= ny * f;
            b.vx += nx * f; b.vy += ny * f;
          }
        }
      }
    }
  }

  // ---------- Background ----------
  const SPOTS = [];
  for (let i = 0; i < 7; i++) {
    SPOTS.push({
      ax: 0.15 + Math.random() * 0.7,
      ay: 0.15 + Math.random() * 0.7,
      ox1: 0.12 + Math.random() * 0.18,
      oy1: 0.12 + Math.random() * 0.18,
      ox2: 0.04 + Math.random() * 0.08,
      oy2: 0.04 + Math.random() * 0.08,
      w1: 0.10 + Math.random() * 0.18,
      w2: 0.05 + Math.random() * 0.10,
      phx: Math.random() * Math.PI * 2,
      phy: Math.random() * Math.PI * 2,
      r: 0.32 + Math.random() * 0.30,
    });
  }

  function drawBackground(ts) {
    const theme = currentTheme();
    const bg = theme.bg;

    // Base fill
    if (bg.kind === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg.topColor);
      g.addColorStop(1, bg.botColor);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg.base;
    }
    ctx.fillRect(0, 0, W, H);

    // Ghost cell silhouettes (Neon Bloom flavour)
    if (bg.kind === 'navy-ghost') {
      ctx.save();
      ctx.globalAlpha = 1;
      const t2 = ts * 0.0003 * S.bgFlowSpeed;
      ctx.fillStyle = 'rgba(8,12,40,0.7)';
      const ghostCount = 4;
      for (let i = 0; i < ghostCount; i++) {
        const seed = i * 1.7;
        const cx = (0.2 + 0.6 * (i / ghostCount) + 0.05 * Math.sin(t2 + seed)) * W;
        const cy = (0.3 + 0.4 * Math.sin(t2 * 0.7 + seed * 2)) * H;
        const r = 0.22 * Math.min(W, H) * (1 + 0.05 * Math.sin(t2 * 1.3 + seed));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(8,12,40,0.55)');
        g.addColorStop(0.7, 'rgba(8,12,40,0.25)');
        g.addColorStop(1, 'rgba(8,12,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }

    // Drifting light spots
    const t = ts * 0.001 * S.bgFlowSpeed;
    const count = Math.min(SPOTS.length, bg.spotCount || SPOTS.length);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const s = SPOTS[i];
      const cx = (s.ax
        + s.ox1 * Math.sin(t * s.w1 + s.phx)
        + s.ox2 * Math.sin(t * s.w1 * 2.3 + s.phx * 0.7)) * W;
      const cy = (s.ay
        + s.oy1 * Math.cos(t * s.w2 + s.phy)
        + s.oy2 * Math.sin(t * s.w2 * 1.7 + s.phy * 1.3)) * H;
      const radius = s.r * Math.max(W, H);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, bg.spotColor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    // Vignette
    if (bg.vignette > 0) {
      const pulse = 0.92 + 0.08 * Math.sin(ts * 0.0006);
      const vg = ctx.createLinearGradient(0, 0, 0, H);
      const a = bg.vignette * pulse;
      vg.addColorStop(0, `rgba(0,0,0,${a})`);
      vg.addColorStop(0.5, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- Metaball mask ----------
  // Each cell renders as one or two "shapes" (two while splitting). Each shape
  // is a wobbly closed polygon filled hard-white onto the offscreen, then
  // blur+contrast carves the metaball edge. Hard fills + 'source-over' avoid
  // the outward bleed that radial gradients had between neighbouring cells.

  function getShapes(t) {
    const out = [];
    for (const c of cells) {
      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        const half = c.r * (0.05 + p * 1.15); // 0.1r..2.4r total separation
        const a = c.splitAngle;
        const dx = Math.cos(a) * half;
        const dy = Math.sin(a) * half;
        const rr = c.r * (1.0 - p * 0.05);
        out.push({ x: c.x - dx, y: c.y - dy, r: rr, cell: c });
        out.push({ x: c.x + dx, y: c.y + dy, r: rr, cell: c });
      } else {
        out.push({ x: c.x, y: c.y, r: c.r, cell: c });
      }
    }
    return out;
  }

  function wobbleAt(c, theta, t) {
    // Two harmonics + slow precession give an organic, non-spinning jiggle.
    const s = c.wobbleSeed;
    const w1 = Math.sin(t * 0.55 * c.wobbleFreq + theta * 3 + s);
    const w2 = Math.sin(t * 0.85 * c.wobbleFreq + theta * 5 + s * 1.31 + c.phase);
    return WOBBLE_AMP * (w1 * 0.65 + w2 * 0.45);
  }

  // Returns the world-space (x,y) of a vertex on the cell's outline at angle theta.
  // Used by the metaball polygon and decoration passes so spikes/cilia
  // align exactly with the wobbly membrane.
  function shapeVertex(s, theta, t) {
    const c = s.cell;
    const type = CELL_TYPES[c.type] || CELL_TYPES.sphere;
    const rr = s.r * (1 + wobbleAt(c, theta, t));
    if (type.shape === 'capsule') {
      const aspect = type.aspect;
      const cosA = Math.cos(c.orientation);
      const sinA = Math.sin(c.orientation);
      const dx = Math.cos(theta) * rr * aspect;
      const dy = Math.sin(theta) * rr;
      return {
        x: s.x + dx * cosA - dy * sinA,
        y: s.y + dx * sinA + dy * cosA,
      };
    }
    return {
      x: s.x + Math.cos(theta) * rr,
      y: s.y + Math.sin(theta) * rr,
    };
  }

  function drawMetaballMask(shapes, t) {
    const ow = off.width, oh = off.height;
    const sx = ow / W;

    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, ow, oh);
    offCtx.fillStyle = '#ffffff';

    const N = WOBBLE_VERTS;
    for (const s of shapes) {
      offCtx.beginPath();
      for (let i = 0; i <= N; i++) {
        const theta = (i / N) * Math.PI * 2;
        const v = shapeVertex(s, theta, t);
        const px = v.x * sx;
        const py = v.y * sx;
        if (i === 0) offCtx.moveTo(px, py);
        else offCtx.lineTo(px, py);
      }
      offCtx.closePath();
      offCtx.fill();
    }

    // Filter pass: off → off2 (mask)
    off2Ctx.setTransform(1, 0, 0, 1, 0, 0);
    off2Ctx.globalCompositeOperation = 'copy';
    off2Ctx.filter = 'blur(6px) contrast(20)';
    off2Ctx.drawImage(off, 0, 0);
    off2Ctx.filter = 'none';
    off2Ctx.globalCompositeOperation = 'source-over';
  }

  function tintMask(color) {
    // Re-uses `off` as scratch, leaving `off2` (mask) intact.
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'copy';
    offCtx.filter = 'none';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-in';
    if (typeof color === 'function') {
      color(offCtx, off.width, off.height);
    } else {
      offCtx.fillStyle = color;
      offCtx.fillRect(0, 0, off.width, off.height);
    }
    offCtx.globalCompositeOperation = 'source-over';
  }

  function drawMetaballToMain(shapes, t) {
    const theme = currentTheme();
    const px = S.outlinePx;
    const pal = theme.palette;

    if (theme.outline.kind === 'glow') {
      // Glow outline: a single dilated coloured copy with shadowBlur, then
      // a darker inner body on top, then cytoplasm tint.
      tintMask(theme.outline.color);
      ctx.save();
      ctx.shadowColor = theme.outline.color;
      ctx.shadowBlur = theme.outline.glow;
      const offsets = [
        [-px, 0], [px, 0], [0, -px], [0, px],
        [-px, -px], [px, px], [-px, px], [px, -px],
      ];
      for (const [dx, dy] of offsets) {
        ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, W, H);
      }
      ctx.restore();

      // Inner dark body so the cytoplasm gradient reads through nicely
      tintMask(theme.outline.innerColor);
      ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
    } else {
      // Solid outline (offset blits)
      tintMask(theme.outline.color);
      const offsets = [
        [-px, 0], [px, 0], [0, -px], [0, px],
        [-px, -px], [px, px], [-px, px], [px, -px],
      ];
      for (const [dx, dy] of offsets) {
        ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, W, H);
      }
    }

    // Cytoplasm fill
    tintMask((c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, pal.cytoplasmTop);
      g.addColorStop(1, pal.cytoplasmBot);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);

    // Inner highlight: lighter blob top-left of each cell, clipped to mask
    tintMask((c, w, h) => {
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = 'rgba(255,255,255,0)';
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-atop';
      for (const cell of cells) {
        const subs = (cell.state === 'SPLITTING')
          ? splitVirtualCenters(cell)
          : [{ x: cell.x, y: cell.y, r: cell.r }];
        for (const b of subs) {
          const x = (b.x - b.r * 0.4) * (w / W);
          const y = (b.y - b.r * 0.5) * (h / H);
          const r = b.r * 0.7 * (w / W);
          const g = c.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, pal.innerHighlight);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g;
          c.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    });
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);

    // Theme-specific extras drawn through the mask (organelles, etc.)
    if (theme.organelleColors) {
      drawOrganelles(theme, t);
    }

    // Per-type decorations (spikes, cilia) on top of the cytoplasm
    drawDecorations(shapes, theme, t);
  }

  function splitVirtualCenters(c) {
    const p = c.splitProgress;
    const half = c.r * (0.05 + p * 1.15);
    const a = c.splitAngle;
    const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
    const rr = c.r * (1.0 - p * 0.05);
    return [{ x: c.x - dx, y: c.y - dy, r: rr }, { x: c.x + dx, y: c.y + dy, r: rr }];
  }

  // ---------- Decorations (spikes + cilia) ----------
  function drawDecorations(shapes, theme, t) {
    const accent = theme.palette.accent;
    const outlineCol = theme.outline.color;
    const isGlow = theme.outline.kind === 'glow';
    const px = S.outlinePx;

    for (const s of shapes) {
      const c = s.cell;
      const type = CELL_TYPES[c.type] || CELL_TYPES.sphere;

      // Cilia: short hairs around the perimeter
      if (type.cilia > 0) {
        const N = type.cilia;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.5, px * 0.45);
        ctx.strokeStyle = accent;
        if (isGlow) {
          ctx.shadowColor = accent;
          ctx.shadowBlur = theme.outline.glow * 0.6;
        }
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const theta = (i / N) * Math.PI * 2;
          const a = shapeVertex(s, theta, t);
          // Tip wobbles slightly with time so the cilia "swim"
          const len = s.r * 0.28;
          const bend = 0.25 * Math.sin(t * 2.4 + i * 1.31 + c.wobbleSeed);
          const dir = theta + bend;
          const tipX = a.x + Math.cos(dir) * len;
          const tipY = a.y + Math.sin(dir) * len;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(tipX, tipY);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Spikes: small triangle pegs around the perimeter
      if (type.spikes > 0) {
        const N = type.spikes;
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1.5, px * 0.6);
        ctx.strokeStyle = outlineCol;
        ctx.fillStyle = accent;
        if (isGlow) {
          ctx.shadowColor = accent;
          ctx.shadowBlur = theme.outline.glow * 0.5;
        }
        const tipLen = s.r * 0.32;
        const baseHalf = s.r * 0.10;
        for (let i = 0; i < N; i++) {
          const theta = (i / N) * Math.PI * 2;
          const base = shapeVertex(s, theta, t);
          const tipX = base.x + Math.cos(theta) * tipLen;
          const tipY = base.y + Math.sin(theta) * tipLen;
          // Knob at the tip (image 1 / 2 viruses)
          ctx.beginPath();
          ctx.moveTo(
            base.x + Math.cos(theta + Math.PI / 2) * baseHalf,
            base.y + Math.sin(theta + Math.PI / 2) * baseHalf
          );
          ctx.lineTo(tipX, tipY);
          ctx.lineTo(
            base.x + Math.cos(theta - Math.PI / 2) * baseHalf,
            base.y + Math.sin(theta - Math.PI / 2) * baseHalf
          );
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // Tip knob
          ctx.beginPath();
          ctx.arc(tipX, tipY, baseHalf * 0.95, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // ---------- Organelles (Neon Bloom flavour) ----------
  function drawOrganelles(theme, t) {
    const colors = theme.organelleColors || [];
    if (!colors.length) return;
    // Build dot list onto a tinted scratch, blit through the metaball mask
    // so dots can never spill outside any cell.
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'copy';
    offCtx.filter = 'none';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-in';
    // Draw onto the offscreen in main canvas coords by scaling
    const sx = off.width / W;
    for (const cell of cells) {
      const subs = (cell.state === 'SPLITTING')
        ? splitVirtualCenters(cell)
        : [{ x: cell.x, y: cell.y, r: cell.r }];
      for (const b of subs) {
        // Deterministic dot pattern keyed off cell.id
        const seed = cell.id * 9.7;
        const N = 5;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + seed;
          const rad = b.r * (0.15 + 0.45 * frac(seed + i * 1.7));
          const wobble = 0.05 * Math.sin(t * 0.6 + seed + i);
          const x = (b.x + Math.cos(a) * rad * (1 + wobble)) * sx;
          const y = (b.y + Math.sin(a) * rad * (1 + wobble)) * sx;
          const r = b.r * (0.06 + 0.05 * frac(seed * 1.7 + i)) * sx;
          offCtx.fillStyle = colors[(cell.id + i) % colors.length];
          offCtx.beginPath();
          offCtx.arc(x, y, r, 0, Math.PI * 2);
          offCtx.fill();
        }
      }
    }
    offCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
  }

  function frac(v) { return v - Math.floor(v); }

  // ---------- Nuclei ----------
  function drawNuclei(ts) {
    const t = ts * 0.001;
    for (const c of cells) {
      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        // Nuclei separate slightly faster than cytoplasm so they appear inside daughters
        const half = c.r * (0.1 + p * 1.0);
        const a = c.splitAngle;
        const cx = Math.cos(a) * half, cy = Math.sin(a) * half;
        const rr = c.r * NUCLEUS_RATIO * (1 - p * 0.2);
        const wob = 1.5 * (1 - p);
        drawNucleus(
          c.x - cx + Math.sin(t + c.phase) * wob,
          c.y - cy + Math.cos(t + c.phase * 0.7) * wob,
          rr
        );
        if (p > 0.04) {
          drawNucleus(
            c.x + cx + Math.sin(t + c.phase + 1.7) * wob,
            c.y + cy + Math.cos(t + c.phase * 0.7 + 1.7) * wob,
            rr
          );
        }
      } else {
        const wx = c.x + Math.sin(t + c.phase) * 1.8;
        const wy = c.y + Math.cos(t + c.phase * 0.7) * 1.8;
        drawNucleus(wx, wy, c.r * NUCLEUS_RATIO);
      }
    }
  }

  function drawNucleus(x, y, r) {
    const theme = currentTheme();
    const pal = theme.palette;
    ctx.save();
    ctx.lineWidth = Math.max(2, S.outlinePx * 0.6);
    ctx.strokeStyle = theme.outline.color;
    if (theme.outline.kind === 'glow') {
      ctx.shadowColor = theme.outline.color;
      ctx.shadowBlur = theme.outline.glow * 0.5;
    }

    if (theme.starChromatin) {
      // 5-lobe rose curve for the Aquatic Glow chromatin look
      ctx.fillStyle = pal.nucleus;
      ctx.beginPath();
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const rr = r * (1 + 0.28 * Math.sin(5 * a));
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Inner ring
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pal.nucleusHi;
      ctx.lineWidth = Math.max(1, S.outlinePx * 0.35);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = pal.nucleus;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = pal.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Debug ----------
  function drawDebug(blobs) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    for (const b of blobs) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (S.splitMode === 'fixedGrid') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (const s of gridSlots) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Cell count
    ctx.fillStyle = '#fff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`cells: ${cells.length} / ${S.maxCells}`, 12, 18);
    ctx.restore();
  }

  // ---------- Frame loop ----------
  let lastTs = 0;
  let fpsAcc = 0, fpsFrames = 0, fpsLastReport = 0;

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    update(dt);

    drawBackground(ts);
    const t = ts * 0.001;
    const shapes = getShapes(t);
    if (shapes.length) {
      drawMetaballMask(shapes, t);
      drawMetaballToMain(shapes, t);
    }
    drawNuclei(ts);
    if (S.showDebugField) drawDebug(shapes);

    fpsAcc += dt; fpsFrames++;
    if (ts - fpsLastReport > 1000) {
      fpsLastReport = ts;
      // (No-op; fps could be displayed via debug overlay if extended.)
    }

    requestAnimationFrame(frame);
  }

  // ---------- Settings UI ----------
  const settingsEl = document.getElementById('settings');
  const gearBtn = document.getElementById('gear');

  const panelEl = settingsEl.querySelector('.settings-panel');

  gearBtn.addEventListener('click', () => settingsEl.classList.toggle('hidden'));
  settingsEl.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => settingsEl.classList.add('hidden'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') settingsEl.classList.add('hidden');
  });
  // Tap anywhere outside the panel (and not on the gear) closes the dialog.
  document.addEventListener('pointerdown', (e) => {
    if (settingsEl.classList.contains('hidden')) return;
    if (gearBtn.contains(e.target)) return;
    if (panelEl.contains(e.target)) return;
    settingsEl.classList.add('hidden');
  }, true);

  function bindRange(id, key, valId, fmt) {
    const el = document.getElementById(id);
    const out = valId ? document.getElementById(valId) : null;
    el.value = S[key];
    if (out) out.textContent = fmt(S[key]);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      S[key] = v;
      if (out) out.textContent = fmt(v);
      saveSettings();
      if (key === 'autoSplitSeconds') {
        for (const c of cells) {
          if (c.state === 'NORMAL' && c.splitTimer > S.autoSplitSeconds * 1.5) {
            c.splitTimer = rollSplitTimer(c.type);
          }
        }
      }
    });
  }
  bindRange('maxCells', 'maxCells', 'maxCellsVal', v => v.toFixed(0));
  bindRange('autoSplitSeconds', 'autoSplitSeconds', 'autoVal', v => v.toFixed(0) + 's');
  bindRange('bgFlowSpeed', 'bgFlowSpeed', 'bgVal', v => v.toFixed(2) + '×');
  bindRange('outlinePx', 'outlinePx', 'outVal', v => v.toFixed(0) + 'px');

  for (const r of settingsEl.querySelectorAll('input[name="splitMode"]')) {
    r.checked = (r.value === S.splitMode);
    r.addEventListener('change', () => {
      if (!r.checked) return;
      const prev = S.splitMode;
      S.splitMode = r.value;
      saveSettings();
      if (S.splitMode === 'fixedGrid') {
        buildGrid();
      } else if (prev === 'fixedGrid') {
        for (const s of gridSlots) s.occupiedBy = 0;
        for (const c of cells) c.gridIndex = -1;
      }
    });
  }

  const dbg = document.getElementById('showDebugField');
  dbg.checked = S.showDebugField;
  dbg.addEventListener('change', () => {
    S.showDebugField = dbg.checked;
    saveSettings();
  });

  // Theme selector
  function applyThemeToCss(theme) {
    const root = document.documentElement;
    root.style.setProperty('--accent', theme.ui.panelAccent);
  }

  const themeSelect = document.getElementById('themeSelect');
  for (const [key, t] of Object.entries(THEMES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = t.label;
    themeSelect.appendChild(opt);
  }
  themeSelect.value = S.theme in THEMES ? S.theme : 'microbeGarden';
  applyThemeToCss(currentTheme());
  themeSelect.addEventListener('change', () => {
    if (THEMES[themeSelect.value]) {
      S.theme = themeSelect.value;
      saveSettings();
      applyThemeToCss(currentTheme());
    }
  });

  // Cell-type checklist
  const cellTypeListEl = document.getElementById('cellTypeList');
  const typeCheckboxes = {};
  for (const [key, t] of Object.entries(CELL_TYPES)) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `type-${key}`;
    cb.checked = S.activeTypes.includes(key);
    typeCheckboxes[key] = cb;
    const lbl = document.createElement('label');
    lbl.htmlFor = cb.id;
    lbl.textContent = t.label;
    li.appendChild(cb);
    li.appendChild(lbl);
    cellTypeListEl.appendChild(li);

    cb.addEventListener('change', () => {
      const next = Object.keys(CELL_TYPES).filter(k => typeCheckboxes[k].checked);
      if (next.length === 0) {
        // Refuse to leave the list empty — bounce this checkbox back on
        cb.checked = true;
        return;
      }
      S.activeTypes = next;
      saveSettings();
    });
  }

  document.getElementById('resetSim').addEventListener('click', resetSim);

  function resetSim() {
    cells.length = 0;
    cellId = 0;
    if (gridSlots.length) for (const s of gridSlots) s.occupiedBy = 0;
    if (S.splitMode === 'fixedGrid') buildGrid();
    const c = makeCell(W / 2, H / 2);
    if (S.splitMode === 'fixedGrid') {
      const idx = nearestFreeSlot(c.x, c.y);
      if (idx >= 0) {
        gridSlots[idx].occupiedBy = c.id;
        c.gridIndex = idx;
        c.x = gridSlots[idx].x;
        c.y = gridSlots[idx].y;
      }
    }
    cells.push(c);
  }

  // ---------- Build stamp ----------
  function renderBuildStamp() {
    const el = document.getElementById('build');
    if (!el) return;
    const b = window.__BUILD__ || { sha: 'dev', run: 0, dateUtc: null };
    const sha = (b.sha || 'dev').slice(0, 7);
    const run = (b.run !== undefined && b.run !== null) ? b.run : 0;
    let when = '—';
    if (b.dateUtc) {
      const d = new Date(b.dateUtc);
      if (!isNaN(d.getTime())) {
        const offMin = -d.getTimezoneOffset();
        const sign = offMin >= 0 ? '+' : '-';
        const abs = Math.abs(offMin);
        const oh = String(Math.floor(abs / 60)).padStart(2, '0');
        const om = String(abs % 60).padStart(2, '0');
        const local = d.toLocaleString(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        when = `${local} UTC${sign}${oh}:${om}`;
      }
    }
    el.textContent = `sha ${sha} · build #${run} · ${when}`;
  }
  renderBuildStamp();

  // ---------- Boot ----------
  resize();
  window.addEventListener('resize', resize);
  resetSim();
  requestAnimationFrame(frame);
})();
