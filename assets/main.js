(() => {
  'use strict';

  // ---------- Settings ----------
  const SETTINGS_KEY = 'microbes.settings.v2';
  const SETTINGS_KEY_V1 = 'microbes.settings.v1';
  const ALL_CELL_KEYS = ['neutrophil','monocyte','mast','nk','macrophage','dendritic','basophil','platelet','tcell','bcell','eosinophil'];
  const DEFAULTS = {
    splitMode: 'bondDrift',     // 'pushApart' | 'bondDrift' | 'fixedGrid'
    autoSplitSeconds: 10,
    maxCells: 32,
    bgFlowSpeed: 1.0,
    outlinePx: 5,
    showDebugField: false,
    theme: 'microbeGarden',
    activeTypes: ALL_CELL_KEYS.slice(),
    splitOnTap: false,
    randomSplit: false,
    showFPS: false,
    friction: 0.40,         // 0=no drag, 1=instant stop (mapped: dampingPerSec = 0.05^friction)
    bounce: 0.6,            // restitution 0..1
    throwStrength: 1.0,     // multiplier for release velocity
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
      // Sanitize: activeTypes must be a non-empty array of known keys
      if (!Array.isArray(parsed.activeTypes) || parsed.activeTypes.length === 0
          || parsed.activeTypes.some(k => !ALL_CELL_KEYS.includes(k))) {
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
  // Themes paint the *world* (background + outline style + neutral helpers).
  // Each cell type carries its own colour identity (see CELL_TYPES below) so
  // every microbe stays visually distinct regardless of theme.
  const THEMES = {
    microbeGarden: {
      label: 'Microbe Garden',
      bg: { kind: 'flat', base: '#dcecef', spotColor: 'rgba(255,170,140,0.18)', spotCount: 5, vignette: 0.0 },
      outline: { color: '#1a0e10', defaultPx: 5 },
      innerHighlight: 'rgba(255,255,255,0.55)',
      ui: { panelAccent: '#c2375a' },
    },
    pandemic: {
      label: 'Pandemic',
      bg: { kind: 'flat', base: '#f5efe7', spotColor: 'rgba(220,80,110,0.10)', spotCount: 3, vignette: 0.0 },
      outline: { color: '#3a0d1a', defaultPx: 6 },
      innerHighlight: 'rgba(255,255,255,0.5)',
      ui: { panelAccent: '#e35d2a' },
    },
    petriDish: {
      label: 'Petri Dish',
      bg: { kind: 'agar', base: '#f1e1a1', spotColor: 'rgba(170,120,40,0.10)', spotCount: 5, vignette: 0.18, ringColor: 'rgba(120,80,30,0.10)' },
      outline: { color: '#2b1c0a', defaultPx: 5 },
      innerHighlight: 'rgba(255,250,220,0.55)',
      ui: { panelAccent: '#a86a18' },
    },
    bloodstream: {
      label: 'Bloodstream',
      bg: { kind: 'gradient', topColor: '#5b101a', botColor: '#1d0306', spotColor: 'rgba(255,90,100,0.18)', spotCount: 6, vignette: 0.45, rbcSilhouettes: true },
      outline: { color: '#1c0306', defaultPx: 4 },
      innerHighlight: 'rgba(255,210,210,0.42)',
      ui: { panelAccent: '#ff6b6b' },
    },
  };

  function currentTheme() {
    return THEMES[S.theme] || THEMES.microbeGarden;
  }

  // ---------- Cell types ----------
  // Each entry encodes a recognisable immune cell from the reference charts.
  // body.kind  → polygon radius formula in shapeVertex()
  // nucleus.kind → drawNucleus() dispatch
  // decoration.kind → drawDecorations() dispatch
  // granules → number of small dots inside the cell, drawn through the mask
  // description → 1-sentence role shown in the help dialog
  const CELL_TYPES = {
    neutrophil: {
      label: 'Neutrophil',
      body: { kind: 'lobed', aspect: 1.0 },
      nucleus: { kind: 'multilobed' },
      decoration: { kind: 'none' },
      granules: 28,
      splitFactor: 1.0, brownianMul: 1.0,
      colors: { cytoTop: '#ffd28a', cytoBot: '#e58a26', nucleus: '#5a2a05', nucleusHi: '#fff0c8', accent: '#9c4513' },
      description: 'First responder; engulfs bacteria via phagocytosis. The most abundant white blood cell.',
    },
    monocyte: {
      label: 'Monocyte',
      body: { kind: 'rippled', aspect: 1.0 },
      nucleus: { kind: 'kidney' },
      decoration: { kind: 'none' },
      granules: 6,
      splitFactor: 1.0, brownianMul: 1.0,
      colors: { cytoTop: '#cadcfb', cytoBot: '#6d8df0', nucleus: '#1d1c5a', nucleusHi: '#dee8ff', accent: '#2b4d8e' },
      description: 'Circulating sentinel that matures into macrophages or dendritic cells once it enters tissue.',
    },
    mast: {
      label: 'Mast cell',
      body: { kind: 'oblong', aspect: 1.4 },
      nucleus: { kind: 'round' },
      decoration: { kind: 'none' },
      granules: 60,
      splitFactor: 1.2, brownianMul: 0.7,
      colors: { cytoTop: '#c9efd5', cytoBot: '#54a877', nucleus: '#0f4a2e', nucleusHi: '#e6fff0', accent: '#1f6b3f' },
      description: 'Tissue-resident sentinel; releases histamine to trigger inflammation and allergic responses.',
    },
    nk: {
      label: 'NK cell',
      body: { kind: 'round', aspect: 1.0 },
      nucleus: { kind: 'round' },
      decoration: { kind: 'bigSpikes' },
      granules: 8,
      splitFactor: 1.1, brownianMul: 1.1,
      colors: { cytoTop: '#cfd0f7', cytoBot: '#7172c6', nucleus: '#291b5e', nucleusHi: '#eaeaff', accent: '#3f3f8c' },
      description: 'Patrols for virus-infected and tumour cells; kills on contact without prior sensitisation.',
    },
    macrophage: {
      label: 'Macrophage',
      body: { kind: 'pseudopod', aspect: 1.0 },
      nucleus: { kind: 'kidney' },
      decoration: { kind: 'none' },
      granules: 12,
      splitFactor: 1.4, brownianMul: 0.6,
      colors: { cytoTop: '#fbc6de', cytoBot: '#d36699', nucleus: '#3a1029', nucleusHi: '#ffe0ee', accent: '#872a59' },
      description: '"Big eater" — long-lived phagocyte that engulfs pathogens and presents antigens to T cells.',
    },
    dendritic: {
      label: 'Dendritic cell',
      body: { kind: 'round', aspect: 1.0 },
      nucleus: { kind: 'round-small' },
      decoration: { kind: 'tendrils' },
      granules: 0,
      splitFactor: 1.3, brownianMul: 0.8,
      colors: { cytoTop: '#bcdcf6', cytoBot: '#4d8fcf', nucleus: '#102544', nucleusHi: '#dff0ff', accent: '#1d3d68' },
      description: 'Antigen-presenting courier; samples invaders and shows them to T cells in lymph nodes.',
    },
    basophil: {
      label: 'Basophil',
      body: { kind: 'round', aspect: 1.0 },
      nucleus: { kind: 'bilobed' },
      decoration: { kind: 'none' },
      granules: 22,
      splitFactor: 1.0, brownianMul: 1.0,
      colors: { cytoTop: '#fbcfdc', cytoBot: '#d97aa1', nucleus: '#410d2e', nucleusHi: '#ffe1ec', accent: '#4a0d31' },
      description: 'Circulating granulocyte; releases histamine and heparin to reinforce inflammation.',
    },
    platelet: {
      label: 'Platelet',
      body: { kind: 'star', aspect: 1.0 },
      nucleus: { kind: 'none' },
      decoration: { kind: 'none' },
      granules: 4,
      splitFactor: 0.9, brownianMul: 1.6,
      colors: { cytoTop: '#ffe27c', cytoBot: '#d7a614', nucleus: '#4d2f02', nucleusHi: '#fff5c4', accent: '#8a5e0a' },
      description: 'Tiny cell fragment that clots blood at injuries and helps recruit immune cells.',
    },
    tcell: {
      label: 'T-cell',
      body: { kind: 'round', aspect: 1.0 },
      nucleus: { kind: 'round' },
      decoration: { kind: 'yReceptorsFew' },
      granules: 0,
      splitFactor: 1.2, brownianMul: 0.9,
      colors: { cytoTop: '#d6cdf8', cytoBot: '#8d7be0', nucleus: '#2a134d', nucleusHi: '#efeaff', accent: '#4d2c8c' },
      description: 'Adaptive killer / coordinator; recognises specific antigens and kills infected cells.',
    },
    bcell: {
      label: 'B-cell',
      body: { kind: 'round', aspect: 1.0 },
      nucleus: { kind: 'round' },
      decoration: { kind: 'yReceptorsMany' },
      granules: 0,
      splitFactor: 1.2, brownianMul: 0.9,
      colors: { cytoTop: '#fcc9cc', cytoBot: '#df8189', nucleus: '#4a1014', nucleusHi: '#ffe1e3', accent: '#8a323a' },
      description: 'Adaptive antibody factory; secretes antibodies tagged to specific pathogens.',
    },
    eosinophil: {
      label: 'Eosinophil',
      body: { kind: 'round', aspect: 1.0 },
      nucleus: { kind: 'bilobed' },
      decoration: { kind: 'none' },
      granules: 18,
      splitFactor: 1.0, brownianMul: 1.0,
      colors: { cytoTop: '#fcc8a3', cytoBot: '#e0855a', nucleus: '#4d1d09', nucleusHi: '#ffe2cd', accent: '#8c3d18' },
      description: 'Anti-parasite specialist; key in allergic responses, releases toxic granule contents.',
    },
  };

  function cellColors(cell) {
    return (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
  }

  function pickRandomActiveType() {
    const list = (Array.isArray(S.activeTypes) && S.activeTypes.length)
      ? S.activeTypes.filter(k => CELL_TYPES[k])
      : Object.keys(CELL_TYPES);
    return list[Math.floor(Math.random() * list.length)] || 'neutrophil';
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

  // ---------- Camera (pan + zoom) ----------
  const camera = { tx: 0, ty: 0, scale: 1 };
  const MIN_SCALE = 0.25, MAX_SCALE = 4;

  function screenToWorld(sx, sy) {
    return { x: (sx - camera.tx) / camera.scale, y: (sy - camera.ty) / camera.scale };
  }

  // ---------- Drag / pan state ----------
  let drag = null;          // { cell, dx, dy, started, downX, downY }
  let pan = null;           // { lastX, lastY, button }
  const activePointers = new Map();   // pointerId -> { x, y, world }
  let pinch = null;         // { startDist, startMid, startScale, startTx, startTy }
  const DRAG_THRESHOLD = 6;

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
    // Capsule-shaped cells (e.g. mast cells) preferentially split along their long axis.
    const ctype = CELL_TYPES[cell.type];
    if (ctype && ctype.body && ctype.body.kind === 'oblong') {
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
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  function pointerScreen(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function hitCell(worldX, worldY) {
    let hit = -1, hitD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state !== 'NORMAL') continue;
      const dx = c.x - worldX, dy = c.y - worldY;
      const d2 = dx * dx + dy * dy;
      const reach = c.r * 1.4;
      if (d2 < reach * reach && d2 < hitD) { hitD = d2; hit = i; }
    }
    return hit;
  }

  function startPinchIfTwoPointers() {
    if (activePointers.size !== 2) return false;
    const pts = [...activePointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    pinch = {
      startDist: Math.hypot(dx, dy) || 1,
      startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      startScale: camera.scale,
      startTx: camera.tx,
      startTy: camera.ty,
    };
    drag = null;
    pan = null;
    return true;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.target !== canvas) return;
    const sp = pointerScreen(ev);
    activePointers.set(ev.pointerId, { x: sp.x, y: sp.y });
    canvas.setPointerCapture?.(ev.pointerId);

    // Two-finger pinch / pan
    if (startPinchIfTwoPointers()) return;

    // Right mouse button → pan
    if (ev.button === 2) {
      pan = { lastX: sp.x, lastY: sp.y, button: 2 };
      return;
    }

    // Left button: try to grab a cell, else pan-on-background
    const w = screenToWorld(sp.x, sp.y);
    const idx = hitCell(w.x, w.y);
    if (idx >= 0) {
      const c = cells[idx];
      drag = {
        cell: c, dx: w.x - c.x, dy: w.y - c.y,
        started: false, downX: sp.x, downY: sp.y,
        samples: [{ x: c.x, y: c.y, t: performance.now() }],
      };
      c.vx = c.vy = 0;
    } else {
      pan = { lastX: sp.x, lastY: sp.y, button: 0 };
    }
  });

  document.addEventListener('pointermove', (ev) => {
    if (!activePointers.has(ev.pointerId) && !drag && !pan && !pinch) return;
    const sp = pointerScreen(ev);
    const prev = activePointers.get(ev.pointerId);
    if (prev) { prev.x = sp.x; prev.y = sp.y; }

    if (pinch && activePointers.size === 2) {
      const pts = [...activePointers.values()];
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy) || 1;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const factor = dist / pinch.startDist;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinch.startScale * factor));
      // Keep the gesture midpoint stable in world space, then add pan from mid delta
      const wx = (pinch.startMid.x - pinch.startTx) / pinch.startScale;
      const wy = (pinch.startMid.y - pinch.startTy) / pinch.startScale;
      camera.scale = newScale;
      camera.tx = mid.x - wx * newScale;
      camera.ty = mid.y - wy * newScale;
      return;
    }

    if (drag) {
      if (!drag.started) {
        const ddx = sp.x - drag.downX, ddy = sp.y - drag.downY;
        if (ddx * ddx + ddy * ddy > DRAG_THRESHOLD * DRAG_THRESHOLD) drag.started = true;
      }
      if (drag.started) {
        const w = screenToWorld(sp.x, sp.y);
        drag.cell.x = w.x - drag.dx;
        drag.cell.y = w.y - drag.dy;
        drag.cell.vx = drag.cell.vy = 0;
        const now = performance.now();
        drag.samples.push({ x: drag.cell.x, y: drag.cell.y, t: now });
        // Keep only last ~120 ms of samples for velocity estimation
        const cutoff = now - 120;
        while (drag.samples.length > 2 && drag.samples[0].t < cutoff) drag.samples.shift();
      }
      return;
    }

    if (pan && prev) {
      const dx = sp.x - pan.lastX;
      const dy = sp.y - pan.lastY;
      camera.tx += dx;
      camera.ty += dy;
      pan.lastX = sp.x;
      pan.lastY = sp.y;
    }
  });

  function endPointer(ev) {
    activePointers.delete(ev.pointerId);
    if (pinch && activePointers.size < 2) pinch = null;
    if (activePointers.size === 0) {
      if (drag) {
        if (drag.started) {
          // Estimate release velocity from the last ~80ms of samples and apply
          // throw strength.
          const now = performance.now();
          const samples = drag.samples;
          let i = samples.length - 1;
          while (i > 0 && (now - samples[i].t) < 80) i--;
          const a = samples[i];
          const b = samples[samples.length - 1];
          const dt = Math.max(0.016, (b.t - a.t) / 1000);
          const vx = (b.x - a.x) / dt * S.throwStrength;
          const vy = (b.y - a.y) / dt * S.throwStrength;
          drag.cell.vx = vx;
          drag.cell.vy = vy;
        } else if (S.splitOnTap) {
          beginSplit(drag.cell);
        }
      }
      drag = null;
      pan = null;
    }
  }
  document.addEventListener('pointerup', endPointer);
  document.addEventListener('pointercancel', endPointer);

  // Mouse wheel zoom (zoom toward cursor)
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const sp = pointerScreen(ev);
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale * factor));
    const k = newScale / camera.scale;
    camera.tx = sp.x - (sp.x - camera.tx) * k;
    camera.ty = sp.y - (sp.y - camera.ty) * k;
    camera.scale = newScale;
  }, { passive: false });

  // ---------- Update ----------
  function update(dt) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 2);

      if (c.state === 'NORMAL') {
        // Auto-split is gated by the "Random splitting" toggle
        if (S.randomSplit) {
          c.splitTimer -= dt;
          if (c.splitTimer <= 0) {
            if (cells.length < S.maxCells) {
              beginSplit(c);
            } else {
              c.splitTimer = rollSplitTimer(c.type) * 0.5;
            }
          }
        }

        if (S.splitMode !== 'fixedGrid' && c !== (drag && drag.cell)) {
          // Brownian (per-type multiplier)
          const bMul = (CELL_TYPES[c.type] && CELL_TYPES[c.type].brownianMul) || 1.0;
          c.vx += (Math.random() - 0.5) * BROWNIAN * bMul * dt;
          c.vy += (Math.random() - 0.5) * BROWNIAN * bMul * dt;

          // User-controlled friction: dampingPerSec = 0.05^friction
          // friction=0 → 1 (no drag). friction=1 → 0.05. friction=0.4 → ~0.30 (gel default).
          let frictionEff = S.friction;
          if (S.splitMode === 'bondDrift' && c.bondTimer > 0) {
            c.bondTimer -= dt;
            frictionEff = Math.min(1, S.friction + 0.3);
          }
          const dampingPerSec = Math.max(0.001, Math.pow(0.05, frictionEff));
          const k = Math.pow(dampingPerSec, dt);
          c.vx *= k; c.vy *= k;

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

    // Pairwise collision response (skip in fixedGrid; skip pairs while bonded)
    if (S.splitMode !== 'fixedGrid') {
      const e = S.bounce;
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        if (a.state !== 'NORMAL') continue;
        for (let j = i + 1; j < cells.length; j++) {
          const b = cells[j];
          if (b.state !== 'NORMAL') continue;
          if (S.splitMode === 'bondDrift' && (a.bondTimer > 0 || b.bondTimer > 0)) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          const minD = a.r + b.r;
          if (d2 < minD * minD && d2 > 1) {
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            // Position correction (split overlap)
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
            // Velocity reflection (impulse, equal mass)
            const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;
            if (velAlongNormal < 0) {
              const j = -(1 + e) * velAlongNormal / 2;
              if (!aFixed) { a.vx -= j * nx; a.vy -= j * ny; }
              if (!bFixed) { b.vx += j * nx; b.vy += j * ny; }
            }
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

    // Petri dish concentric rings
    if (bg.kind === 'agar') {
      ctx.save();
      ctx.strokeStyle = bg.ringColor || 'rgba(120,80,30,0.10)';
      ctx.lineWidth = 1;
      const cx = W / 2, cy = H / 2;
      const maxR = Math.hypot(W, H) * 0.6;
      for (let r = 32; r < maxR; r += 32) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Drifting red blood cell silhouettes (Bloodstream)
    if (bg.rbcSilhouettes) {
      ctx.save();
      const t2 = ts * 0.00025 * S.bgFlowSpeed;
      const N = 16;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < N; i++) {
        const seed = i * 1.31;
        const fx = ((i / N) + 0.06 * Math.sin(t2 + seed)) % 1;
        const fy = (frac(seed * 0.7 + t2 * 0.6 + i * 0.13)) % 1;
        const px = fx * W;
        const py = fy * H;
        const r = 18 + 16 * frac(seed * 0.21);
        ctx.fillStyle = 'rgba(255,90,90,0.10)';
        ctx.strokeStyle = 'rgba(255,140,140,0.18)';
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.78, seed, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(120,20,20,0.18)';
        ctx.beginPath();
        ctx.arc(px, py, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
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

  function inView(x, y, r) {
    // Frustum check in screen space; cull cells that don't touch the viewport.
    const sx = x * camera.scale + camera.tx;
    const sy = y * camera.scale + camera.ty;
    const sr = (r + 12) * camera.scale; // small slack so spikes/cilia stay visible
    return sx + sr >= 0 && sx - sr <= W && sy + sr >= 0 && sy - sr <= H;
  }

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
        // Cull only when both halves are off-screen.
        if (!inView(c.x - dx, c.y - dy, rr) && !inView(c.x + dx, c.y + dy, rr)) continue;
        out.push({ x: c.x - dx, y: c.y - dy, r: rr, cell: c });
        out.push({ x: c.x + dx, y: c.y + dy, r: rr, cell: c });
      } else {
        if (!inView(c.x, c.y, c.r * 1.6)) continue;
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
  // Used by the metaball polygon and decoration passes so spikes/cilia/etc.
  // align exactly with the wobbly membrane.
  function shapeVertex(s, theta, t) {
    const c = s.cell;
    const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
    const kind = (type.body && type.body.kind) || 'round';
    const aspect = (type.body && type.body.aspect) || 1.0;
    const seed = c.wobbleSeed;
    const phi = c.phase;

    // Per-type radius modulation (relative to s.r)
    let scale = 1;
    switch (kind) {
      case 'lobed':
        scale = 1
          + 0.16 * Math.sin(3 * theta + phi)
          + 0.08 * Math.sin(5 * theta + phi * 1.7);
        break;
      case 'rippled':
        scale = 1
          + 0.04 * Math.sin(24 * theta + phi)
          + 0.015 * Math.sin(8 * theta + phi * 0.7);
        break;
      case 'pseudopod':
        scale = 1
          + 0.20 * Math.sin(3 * theta + 0.8 * t * c.wobbleFreq + phi)
          + 0.06 * Math.sin(5 * theta - 0.5 * t * c.wobbleFreq + seed);
        break;
      case 'star': {
        // 10-pointed soft star
        const N = 10;
        scale = 0.85 + 0.45 * Math.abs(Math.sin((N / 2) * theta + phi));
        break;
      }
      case 'oblong':
      case 'round':
      default:
        scale = 1 + wobbleAt(c, theta, t);
    }

    // Shared subtle wobble layered on top of all kinds (except `star` which has its own profile)
    if (kind !== 'star' && kind !== 'lobed' && kind !== 'pseudopod') {
      scale += wobbleAt(c, theta, t) * 0.4;
    }

    // Apply per-type aspect along cell.orientation (for oblong / mast cell, etc.)
    let rx = Math.cos(theta) * s.r * scale;
    let ry = Math.sin(theta) * s.r * scale;
    if (aspect !== 1.0) {
      rx *= aspect;
      const cosA = Math.cos(c.orientation);
      const sinA = Math.sin(c.orientation);
      const ox = rx * cosA - ry * sinA;
      const oy = rx * sinA + ry * cosA;
      rx = ox; ry = oy;
    }
    return { x: s.x + rx, y: s.y + ry };
  }

  function drawMetaballMask(shapes, t) {
    const ow = off.width, oh = off.height;
    const sx = ow / W;

    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, ow, oh);
    offCtx.fillStyle = '#ffffff';

    const cs = camera.scale, ctx_ = camera.tx, cty = camera.ty;
    const N = WOBBLE_VERTS;
    for (const s of shapes) {
      offCtx.beginPath();
      for (let i = 0; i <= N; i++) {
        const theta = (i / N) * Math.PI * 2;
        const v = shapeVertex(s, theta, t);
        const px = (v.x * cs + ctx_) * sx;
        const py = (v.y * cs + cty) * sx;
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

    // ----- Outline pass: solid offset blits in the theme's outline colour
    tintMask(theme.outline.color);
    const offsets = [
      [-px, 0], [px, 0], [0, -px], [0, px],
      [-px, -px], [px, px], [-px, px], [px, -px],
    ];
    for (const [dx, dy] of offsets) {
      ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, W, H);
    }

    // ----- Per-cell cytoplasm fill: each cell paints its own gradient on
    // off, then we destination-in clip to the global mask in off2 and blit.
    const sx = off.width / W;
    const cs = camera.scale, cTx = camera.tx, cTy = camera.ty;
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, off.width, off.height);
    for (const cell of cells) {
      const subs = (cell.state === 'SPLITTING')
        ? splitVirtualCenters(cell)
        : [{ x: cell.x, y: cell.y, r: cell.r }];
      const cc = cellColors(cell);
      for (const b of subs) {
        const cx = (b.x * cs + cTx) * sx;
        const cy = (b.y * cs + cTy) * sx;
        const r = b.r * 1.6 * cs * sx;
        const g = offCtx.createRadialGradient(cx, cy - r * 0.3, 0, cx, cy, r);
        g.addColorStop(0, cc.cytoTop);
        g.addColorStop(1, cc.cytoBot);
        offCtx.fillStyle = g;
        offCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);

    // ----- Inner highlight per cell (top-left soft glow), clipped to mask
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.clearRect(0, 0, off.width, off.height);
    for (const cell of cells) {
      const subs = (cell.state === 'SPLITTING')
        ? splitVirtualCenters(cell)
        : [{ x: cell.x, y: cell.y, r: cell.r }];
      const cc = cellColors(cell);
      for (const b of subs) {
        const x = ((b.x - b.r * 0.35) * cs + cTx) * sx;
        const y = ((b.y - b.r * 0.45) * cs + cTy) * sx;
        const r = b.r * 0.75 * cs * sx;
        const g = offCtx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, cc.nucleusHi);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = g;
        offCtx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
    ctx.globalAlpha = 1.0;

    // Per-cell granules (drawn through the mask so dots stay inside the membrane)
    drawGranules(shapes, theme, t);

    // Per-type decorations (spikes, tendrils, Y-receptors) on top of the cytoplasm
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

  // ---------- Decorations (per cell type) ----------
  function withCameraCtx(fn) {
    ctx.save();
    ctx.transform(camera.scale, 0, 0, camera.scale, camera.tx, camera.ty);
    try { fn(); } finally { ctx.restore(); }
  }

  function drawDecorations(shapes, theme, t) {
    withCameraCtx(() => {
      for (const s of shapes) {
        const c = s.cell;
        const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
        const kind = (type.decoration && type.decoration.kind) || 'none';
        switch (kind) {
          case 'bigSpikes':       drawBigSpikes(s, theme, t); break;
          case 'tendrils':        drawTendrils(s, theme, t); break;
          case 'yReceptorsFew':   drawYReceptors(s, theme, t, 6); break;
          case 'yReceptorsMany':  drawYReceptors(s, theme, t, 14); break;
          case 'none':
          default: break;
        }
      }
    });
  }

  function drawBigSpikes(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 8;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.7) / camera.scale;
    ctx.strokeStyle = theme.outline.color;
    ctx.fillStyle = cc.accent;
    const tipLen = s.r * 0.55;
    const baseHalf = s.r * 0.09;
    // Irregular angular jitter keyed off cell.id
    for (let i = 0; i < N; i++) {
      const jitter = (frac(c.id * 0.31 + i * 0.71) - 0.5) * 0.25;
      const theta = (i / N) * Math.PI * 2 + jitter;
      const base = shapeVertex(s, theta, t);
      const tx = base.x + Math.cos(theta) * tipLen;
      const ty = base.y + Math.sin(theta) * tipLen;
      ctx.beginPath();
      ctx.moveTo(
        base.x + Math.cos(theta + Math.PI / 2) * baseHalf,
        base.y + Math.sin(theta + Math.PI / 2) * baseHalf
      );
      ctx.lineTo(tx, ty);
      ctx.lineTo(
        base.x + Math.cos(theta - Math.PI / 2) * baseHalf,
        base.y + Math.sin(theta - Math.PI / 2) * baseHalf
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTendrils(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 13;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.5) / camera.scale;
    ctx.strokeStyle = cc.cytoBot;
    for (let i = 0; i < N; i++) {
      const baseAng = (i / N) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, baseAng, t);
      const len = s.r * (1.1 + 0.4 * frac(c.id * 0.13 + i * 0.7));
      // Curving Bezier outward, with a time-based wiggle.
      const sway = 0.4 * Math.sin(t * 0.9 + i * 1.3 + c.wobbleSeed);
      const tipAng = baseAng + sway * 0.4;
      const tipX = base.x + Math.cos(tipAng) * len;
      const tipY = base.y + Math.sin(tipAng) * len;
      const ctrlAng = baseAng + sway;
      const ctrlR = len * 0.6;
      const cpX = base.x + Math.cos(ctrlAng) * ctrlR;
      const cpY = base.y + Math.sin(ctrlAng) * ctrlR;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawYReceptors(s, theme, t, count) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, px * 0.4) / camera.scale;
    ctx.strokeStyle = cc.accent;
    const stem = s.r * 0.22;
    const arms = s.r * 0.13;
    const armSpread = Math.PI * 0.25;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, theta, t);
      const tipX = base.x + Math.cos(theta) * stem;
      const tipY = base.y + Math.sin(theta) * stem;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tipX, tipY);
      const lAng = theta + armSpread;
      const rAng = theta - armSpread;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(lAng) * arms, tipY + Math.sin(lAng) * arms);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(rAng) * arms, tipY + Math.sin(rAng) * arms);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Granules ----------
  // Per-cell dot pattern drawn through the metaball mask so granules can never
  // spill outside the membrane. Each cell's granules use that cell's own
  // nucleus colour (so granules read as the same family as the nucleus).
  function drawGranules(shapes, theme, t) {
    const anyGranules = shapes.some(s => {
      const type = CELL_TYPES[s.cell.type] || CELL_TYPES.neutrophil;
      return (type.granules || 0) > 0;
    });
    if (!anyGranules) return;

    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, off.width, off.height);

    const sx = off.width / W;
    const cs = camera.scale, cTx = camera.tx, cTy = camera.ty;
    for (const s of shapes) {
      const c = s.cell;
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const N = type.granules || 0;
      if (N === 0) continue;
      const seed = c.id * 9.7 + (c.wobbleSeed || 0);
      const isBig = c.type === 'basophil';
      const baseSize = isBig ? 0.115 : 0.05;
      const sizeJitter = isBig ? 0.05 : 0.04;
      const cc = cellColors(c);
      offCtx.fillStyle = cc.nucleus;
      offCtx.globalAlpha = isBig ? 0.85 : 0.55;
      for (let i = 0; i < N; i++) {
        const ang = frac(seed * 1.3 + i * 0.61) * Math.PI * 2;
        const rRel = 0.05 + 0.85 * Math.sqrt(frac(seed + i * 0.317));
        const wob = 0.04 * Math.sin(t * 0.5 + i + seed);
        const wx = s.x + Math.cos(ang) * s.r * (rRel + wob);
        const wy = s.y + Math.sin(ang) * s.r * (rRel + wob);
        const x = (wx * cs + cTx) * sx;
        const y = (wy * cs + cTy) * sx;
        const r = s.r * (baseSize + sizeJitter * frac(seed * 1.7 + i * 0.13)) * cs * sx;
        offCtx.beginPath();
        offCtx.arc(x, y, r, 0, Math.PI * 2);
        offCtx.fill();
      }
    }
    offCtx.globalAlpha = 1;

    // Clip to mask
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
  }

  function frac(v) { return v - Math.floor(v); }

  // ---------- Nuclei ----------
  function drawNuclei(ts) {
    const t = ts * 0.001;
    withCameraCtx(() => drawNucleiInner(ts, t));
  }

  function drawNucleiInner(ts, t) {
    for (const c of cells) {
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      if (type.nucleus.kind === 'none') continue;

      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        const half = c.r * (0.1 + p * 1.0);
        const a = c.splitAngle;
        const cx = Math.cos(a) * half, cy = Math.sin(a) * half;
        const rr = c.r * NUCLEUS_RATIO * (1 - p * 0.2);
        const wob = 1.5 * (1 - p);
        drawNucleus(c,
          c.x - cx + Math.sin(t + c.phase) * wob,
          c.y - cy + Math.cos(t + c.phase * 0.7) * wob,
          rr);
        if (p > 0.04) {
          drawNucleus(c,
            c.x + cx + Math.sin(t + c.phase + 1.7) * wob,
            c.y + cy + Math.cos(t + c.phase * 0.7 + 1.7) * wob,
            rr);
        }
      } else {
        const wx = c.x + Math.sin(t + c.phase) * 1.8;
        const wy = c.y + Math.cos(t + c.phase * 0.7) * 1.8;
        drawNucleus(c, wx, wy, c.r * NUCLEUS_RATIO);
      }
    }
  }

  function drawNucleus(cell, x, y, r) {
    const theme = currentTheme();
    const cc = cellColors(cell);
    ctx.save();
    ctx.lineWidth = Math.max(2, S.outlinePx * 0.6) / camera.scale;
    ctx.strokeStyle = theme.outline.color;
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    let kind = type.nucleus.kind;
    if (kind === 'round-small') { kind = 'round'; r *= 0.7; }

    ctx.fillStyle = cc.nucleus;

    if (kind === 'kidney') {
      // Outer arc + reversed bite arc to get a kidney/horseshoe shape with a
      // strokeable outline.
      const biteAngle = (cell.phase || 0);
      const biteOff = r * 0.6;
      const biteR = r * 0.85;
      const bx = x + Math.cos(biteAngle) * biteOff;
      const by = y + Math.sin(biteAngle) * biteOff;
      // Build the path using the boolean-like trick: fill the outer disk then
      // punch out the bite using destination-out, then re-stroke a precise path.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(bx, by, biteR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Re-stroke: combine outer arc with reversed inner arc to make the kidney path.
      ctx.beginPath();
      // Find intersection-driven sub-arc angles. Approximate by sweeping.
      const dx = bx - x, dy = by - y;
      const d = Math.hypot(dx, dy);
      // The two circles intersect where r² and biteR² match the chord; if d is too
      // small we degenerate, so guard.
      if (d > 0.001 && d < r + biteR && d > Math.abs(r - biteR)) {
        const a = Math.acos((r * r - biteR * biteR + d * d) / (2 * r * d));
        const baseAng = Math.atan2(dy, dx);
        const start = baseAng + a;
        const end = baseAng + Math.PI * 2 - a;
        ctx.arc(x, y, r, start, end);
        const a2 = Math.acos((biteR * biteR - r * r + d * d) / (2 * biteR * d));
        const baseAng2 = Math.atan2(-dy, -dx);
        const start2 = baseAng2 - a2;
        const end2 = baseAng2 + a2;
        ctx.arc(bx, by, biteR, start2, end2, true);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Soft highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'bilobed') {
      // Two overlapping circles.
      const sep = r * 0.7;
      const lr = r * 0.7;
      const ang = cell.phase || 0;
      const ox = Math.cos(ang) * sep * 0.5;
      const oy = Math.sin(ang) * sep * 0.5;
      // Fill both, then stroke the outline of their union via two arcs.
      ctx.beginPath();
      ctx.arc(x - ox, y - oy, lr, 0, Math.PI * 2);
      ctx.arc(x + ox, y + oy, lr, 0, Math.PI * 2);
      ctx.fill();
      // Outline: stroke each circle individually for simplicity (overlapping line in middle is acceptable visually).
      ctx.beginPath();
      ctx.arc(x - ox, y - oy, lr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, lr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - ox - lr * 0.35, y - oy - lr * 0.35, lr * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'multilobed') {
      // 4 overlapping circles arranged on a curved arc.
      const lr = r * 0.55;
      const baseAng = cell.phase || 0;
      const radius = r * 0.65;
      const lobes = [];
      for (let i = 0; i < 4; i++) {
        const a = baseAng + (i - 1.5) * 0.7;
        lobes.push({ x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius * 0.4 });
      }
      ctx.beginPath();
      for (const l of lobes) ctx.arc(l.x, l.y, lr, 0, Math.PI * 2);
      ctx.fill();
      for (const l of lobes) {
        ctx.beginPath();
        ctx.arc(l.x, l.y, lr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(lobes[0].x - lr * 0.35, lobes[0].y - lr * 0.35, lr * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // round (default)
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Debug ----------
  function drawDebug(blobs) {
    withCameraCtx(() => {
      ctx.save();
      ctx.lineWidth = 1 / camera.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      for (const b of blobs) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (S.splitMode === 'fixedGrid') {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        for (const s of gridSlots) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, 2 / camera.scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    });
    // Screen-space text overlay (not transformed)
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`cells: ${cells.length} / ${S.maxCells}  zoom: ${camera.scale.toFixed(2)}×`, 12, 38);
    ctx.restore();
  }

  // ---------- Frame loop ----------
  let lastTs = 0;
  const fpsBuf = [];
  const fpsEl = document.getElementById('fps');

  function updateFPS(dt, ts) {
    if (!S.showFPS || !fpsEl) return;
    fpsBuf.push(dt);
    if (fpsBuf.length > 60) fpsBuf.shift();
    if (Math.floor(ts / 250) === Math.floor((ts - dt * 1000) / 250)) return;
    let sum = 0;
    for (const v of fpsBuf) sum += v;
    const avg = sum / fpsBuf.length;
    const fps = avg > 0 ? Math.round(1 / avg) : 0;
    fpsEl.textContent = `${fps} fps · cells ${cells.length}`;
  }

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

    updateFPS(dt, ts);

    requestAnimationFrame(frame);
  }

  // ---------- Settings UI ----------
  const settingsEl = document.getElementById('settings');
  const gearBtn = document.getElementById('gear');

  const panelEl = settingsEl.querySelector('.settings-panel');
  const helpDialog = document.getElementById('helpDialog');
  const paletteDialog = document.getElementById('paletteDialog');
  const helpBtn = document.getElementById('help');
  const paletteBtn = document.getElementById('palette');
  const reloadBtn = document.getElementById('reload');
  const fabs = [gearBtn, helpBtn, paletteBtn, reloadBtn].filter(Boolean);
  const allDialogs = [settingsEl, helpDialog, paletteDialog].filter(Boolean);

  function openOnly(target) {
    for (const d of allDialogs) {
      if (d === target) d.classList.remove('hidden');
      else d.classList.add('hidden');
    }
  }
  function closeAll() {
    for (const d of allDialogs) d.classList.add('hidden');
  }

  gearBtn.addEventListener('click', () => {
    settingsEl.classList.contains('hidden') ? openOnly(settingsEl) : closeAll();
  });
  if (helpBtn) helpBtn.addEventListener('click', () => {
    helpDialog.classList.contains('hidden') ? openOnly(helpDialog) : closeAll();
  });
  if (paletteBtn) paletteBtn.addEventListener('click', () => {
    if (paletteDialog.classList.contains('hidden')) {
      renderPaletteGrid();
      openOnly(paletteDialog);
    } else closeAll();
  });
  if (reloadBtn) reloadBtn.addEventListener('click', () => {
    const u = new URL(location.href);
    u.searchParams.set('_', Date.now().toString(36));
    location.replace(u.toString());
  });

  for (const d of allDialogs) {
    d.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => d.classList.add('hidden'));
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
  // Tap anywhere outside any panel (and not on a fab) closes whatever is open.
  document.addEventListener('pointerdown', (e) => {
    const anyOpen = allDialogs.some(d => !d.classList.contains('hidden'));
    if (!anyOpen) return;
    if (fabs.some(b => b.contains(e.target))) return;
    if (allDialogs.some(d => d.querySelector('.settings-panel,.dialog-panel')?.contains(e.target))) return;
    closeAll();
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
  bindRange('friction', 'friction', 'frictionVal', v => v.toFixed(2));
  bindRange('bounce', 'bounce', 'bounceVal', v => v.toFixed(2));
  bindRange('throwStrength', 'throwStrength', 'throwVal', v => v.toFixed(2) + '×');

  function bindCheckbox(id, key, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!S[key];
    if (onChange) onChange(el.checked);
    el.addEventListener('change', () => {
      S[key] = el.checked;
      saveSettings();
      if (onChange) onChange(el.checked);
    });
  }
  bindCheckbox('splitOnTap', 'splitOnTap');
  bindCheckbox('randomSplit', 'randomSplit');
  bindCheckbox('showFPS', 'showFPS', (on) => {
    const el = document.getElementById('fps');
    if (el) el.classList.toggle('on', !!on);
  });

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

  // Populate the help dialog list (one entry per cell type).
  const cellListEl = document.getElementById('cellList');
  if (cellListEl) {
    cellListEl.innerHTML = '';
    for (const [, t] of Object.entries(CELL_TYPES)) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = t.label;
      const span = document.createElement('span');
      span.textContent = ' ' + t.description;
      li.appendChild(b);
      li.appendChild(span);
      cellListEl.appendChild(li);
    }
  }

  // Palette grid: a tile per cell type, click to spawn.
  const cellGridEl = document.getElementById('cellGrid');
  function renderPaletteGrid() {
    if (!cellGridEl) return;
    cellGridEl.innerHTML = '';
    for (const [key, t] of Object.entries(CELL_TYPES)) {
      const tile = document.createElement('button');
      tile.className = 'cell-tile';
      tile.type = 'button';
      tile.title = t.description;
      const c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      tile.appendChild(c);
      const span = document.createElement('span');
      span.textContent = t.label;
      tile.appendChild(span);
      tile.addEventListener('click', () => {
        spawnAtCenter(key);
        closeAll();
      });
      cellGridEl.appendChild(tile);
      renderCellPreview(c, key);
    }
  }

  function spawnAtCenter(typeKey) {
    if (cells.length >= S.maxCells) return;
    // Spawn at the centre of the visible viewport in world coords.
    const w = screenToWorld(W / 2, H / 2);
    const jitter = CELL_RADIUS * 0.3;
    const c = makeCell(
      w.x + (Math.random() - 0.5) * jitter,
      w.y + (Math.random() - 0.5) * jitter,
      CELL_RADIUS,
      typeKey,
    );
    cells.push(c);
  }

  // Static preview render used for palette tiles. Reuses the polygon body and
  // the per-type nucleus / decoration drawers but bypasses the metaball pipeline.
  function renderCellPreview(canvasEl, typeKey) {
    const c2 = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    c2.clearRect(0, 0, w, h);
    const fakeCell = {
      id: 1, x: w / 2, y: h / 2, r: w * 0.32,
      type: typeKey,
      vx: 0, vy: 0, state: 'NORMAL',
      splitTimer: 0, splitProgress: 0, splitAngle: 0, bondTimer: 0, gridIndex: -1,
      phase: 0.4, orientation: 0, wobbleSeed: 7, wobbleFreq: 0.7, flash: 0,
    };
    const s = { x: fakeCell.x, y: fakeCell.y, r: fakeCell.r, cell: fakeCell };
    const cc = (CELL_TYPES[typeKey] || CELL_TYPES.neutrophil).colors;
    const theme = currentTheme();
    const t = 0.5;
    // Body fill with outline. We can't easily reuse the metaball pipeline here,
    // so trace the polygon directly.
    const N = 48;
    const path = new Path2D();
    for (let i = 0; i <= N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const v = shapeVertex(s, theta, t);
      if (i === 0) path.moveTo(v.x, v.y);
      else path.lineTo(v.x, v.y);
    }
    path.closePath();
    // Fill
    const grad = c2.createRadialGradient(s.x, s.y - s.r * 0.3, 0, s.x, s.y, s.r * 1.6);
    grad.addColorStop(0, cc.cytoTop);
    grad.addColorStop(1, cc.cytoBot);
    c2.fillStyle = grad;
    c2.fill(path);
    // Outline
    c2.lineWidth = Math.max(2, S.outlinePx);
    c2.strokeStyle = theme.outline.color;
    c2.lineJoin = 'round';
    c2.stroke(path);
    // Per-type nucleus + decoration drawn directly onto c2 (preview-only helpers).
    drawPreviewNucleus(c2, fakeCell, s.x, s.y, s.r * NUCLEUS_RATIO, theme);
    drawPreviewDecorations(c2, s, theme, t);
  }

  function drawPreviewNucleus(c2, cell, x, y, r, theme) {
    const cc = (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    let kind = type.nucleus.kind;
    if (kind === 'none') return;
    if (kind === 'round-small') { kind = 'round'; r *= 0.7; }
    c2.save();
    c2.lineWidth = Math.max(2, S.outlinePx * 0.6);
    c2.strokeStyle = theme.outline.color;
    c2.fillStyle = cc.nucleus;
    if (kind === 'round') {
      c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill(); c2.stroke();
    } else if (kind === 'kidney') {
      c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill();
      c2.globalCompositeOperation = 'destination-out';
      c2.beginPath(); c2.arc(x + r * 0.6, y, r * 0.85, 0, Math.PI * 2); c2.fill();
      c2.globalCompositeOperation = 'source-over';
      c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.stroke();
    } else if (kind === 'bilobed') {
      const sep = r * 0.5, lr = r * 0.7;
      c2.beginPath(); c2.arc(x - sep * 0.5, y, lr, 0, Math.PI * 2); c2.arc(x + sep * 0.5, y, lr, 0, Math.PI * 2); c2.fill();
      c2.beginPath(); c2.arc(x - sep * 0.5, y, lr, 0, Math.PI * 2); c2.stroke();
      c2.beginPath(); c2.arc(x + sep * 0.5, y, lr, 0, Math.PI * 2); c2.stroke();
    } else if (kind === 'multilobed') {
      const lr = r * 0.55, R = r * 0.65;
      const lobes = [-1.05, -0.35, 0.35, 1.05].map(a => ({ x: x + Math.cos(a) * R, y: y + Math.sin(a) * R * 0.4 }));
      c2.beginPath();
      for (const l of lobes) c2.arc(l.x, l.y, lr, 0, Math.PI * 2);
      c2.fill();
      for (const l of lobes) { c2.beginPath(); c2.arc(l.x, l.y, lr, 0, Math.PI * 2); c2.stroke(); }
    }
    c2.restore();
  }

  function drawPreviewDecorations(c2, s, theme, t) {
    const cell = s.cell;
    const cc = (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    const kind = type.decoration && type.decoration.kind;
    if (!kind || kind === 'none') return;
    c2.save();
    c2.lineWidth = Math.max(1.5, S.outlinePx * 0.55);
    c2.strokeStyle = theme.outline.color;
    if (kind === 'bigSpikes') {
      c2.fillStyle = cc.accent;
      const N = 8;
      const tipLen = s.r * 0.55, baseHalf = s.r * 0.09;
      for (let i = 0; i < N; i++) {
        const theta = (i / N) * Math.PI * 2;
        const base = shapeVertex(s, theta, t);
        const tx = base.x + Math.cos(theta) * tipLen;
        const ty = base.y + Math.sin(theta) * tipLen;
        c2.beginPath();
        c2.moveTo(base.x + Math.cos(theta + Math.PI / 2) * baseHalf, base.y + Math.sin(theta + Math.PI / 2) * baseHalf);
        c2.lineTo(tx, ty);
        c2.lineTo(base.x + Math.cos(theta - Math.PI / 2) * baseHalf, base.y + Math.sin(theta - Math.PI / 2) * baseHalf);
        c2.closePath(); c2.fill(); c2.stroke();
      }
    } else if (kind === 'tendrils') {
      c2.strokeStyle = cc.cytoBot;
      c2.lineCap = 'round';
      const N = 13;
      for (let i = 0; i < N; i++) {
        const theta = (i / N) * Math.PI * 2;
        const base = shapeVertex(s, theta, t);
        const len = s.r * 1.2;
        const tx = base.x + Math.cos(theta) * len;
        const ty = base.y + Math.sin(theta) * len;
        const cpX = base.x + Math.cos(theta + 0.4) * len * 0.6;
        const cpY = base.y + Math.sin(theta + 0.4) * len * 0.6;
        c2.beginPath();
        c2.moveTo(base.x, base.y);
        c2.quadraticCurveTo(cpX, cpY, tx, ty);
        c2.stroke();
      }
    } else if (kind === 'yReceptorsFew' || kind === 'yReceptorsMany') {
      c2.strokeStyle = cc.accent;
      c2.lineCap = 'round';
      const count = kind === 'yReceptorsMany' ? 14 : 6;
      const stem = s.r * 0.22, arms = s.r * 0.13, armSpread = Math.PI * 0.25;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const base = shapeVertex(s, theta, t);
        const tx = base.x + Math.cos(theta) * stem;
        const ty = base.y + Math.sin(theta) * stem;
        c2.beginPath();
        c2.moveTo(base.x, base.y); c2.lineTo(tx, ty);
        c2.moveTo(tx, ty); c2.lineTo(tx + Math.cos(theta + armSpread) * arms, ty + Math.sin(theta + armSpread) * arms);
        c2.moveTo(tx, ty); c2.lineTo(tx + Math.cos(theta - armSpread) * arms, ty + Math.sin(theta - armSpread) * arms);
        c2.stroke();
      }
    }
    c2.restore();
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
