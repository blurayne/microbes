(() => {
  'use strict';

  // ---------- Settings ----------
  const SETTINGS_KEY = 'microbes.settings.v1';
  const DEFAULTS = {
    splitMode: 'pushApart',     // 'pushApart' | 'bondDrift' | 'fixedGrid'
    autoSplitSeconds: 10,
    maxCells: 32,
    bgFlowSpeed: 1.0,
    outlinePx: 3,
    showDebugField: false,
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { return { ...DEFAULTS }; }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch {}
  }

  const S = loadSettings();

  // ---------- Constants ----------
  const SPLIT_DURATION = 0.8;
  const BOND_DURATION = 2.0;
  const CELL_RADIUS = 26;
  const NUCLEUS_RATIO = 0.34;
  const BROWNIAN = 60;
  const REPULSION = 260;
  const MARGIN = 48;
  const MARGIN_SPRING = 6;
  const DOWNSAMPLE = 0.5;

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

  function makeCell(x, y, r = CELL_RADIUS) {
    return {
      id: ++cellId,
      x, y, r,
      vx: 0, vy: 0,
      state: 'NORMAL',
      splitTimer: rollSplitTimer(),
      splitProgress: 0,
      splitAngle: 0,
      bondTimer: 0,
      gridIndex: -1,
      phase: Math.random() * Math.PI * 2,
      flash: 0,
    };
  }

  function rollSplitTimer() {
    const j = (Math.random() * 0.6) - 0.3;
    return Math.max(1.5, S.autoSplitSeconds * (1 + j));
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
      cell.splitTimer = rollSplitTimer() * 0.5;
      return;
    }
    cell.state = 'SPLITTING';
    cell.splitProgress = 0;
    cell.splitAngle = Math.random() * Math.PI * 2;
    cell.vx *= 0.3;
    cell.vy *= 0.3;
  }

  function finishSplit(cell, idx) {
    const a = cell.splitAngle;
    const cx = Math.cos(a), cy = Math.sin(a);
    const sep = cell.r * 1.05;
    const left = makeCell(cell.x - cx * sep, cell.y - cy * sep, cell.r);
    const right = makeCell(cell.x + cx * sep, cell.y + cy * sep, cell.r);
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
            c.splitTimer = rollSplitTimer() * 0.5;
          }
        }

        if (S.splitMode !== 'fixedGrid') {
          // Brownian
          c.vx += (Math.random() - 0.5) * BROWNIAN * dt;
          c.vy += (Math.random() - 0.5) * BROWNIAN * dt;

          let damping = 0.85;
          if (S.splitMode === 'bondDrift' && c.bondTimer > 0) {
            c.bondTimer -= dt;
            damping = 0.4;
          }
          const k = Math.pow(damping, dt);
          c.vx *= k; c.vy *= k;

          // Margin spring
          if (c.x < MARGIN) c.vx += (MARGIN - c.x) * MARGIN_SPRING * dt;
          if (c.x > W - MARGIN) c.vx -= (c.x - (W - MARGIN)) * MARGIN_SPRING * dt;
          if (c.y < MARGIN) c.vy += (MARGIN - c.y) * MARGIN_SPRING * dt;
          if (c.y > H - MARGIN) c.vy -= (c.y - (H - MARGIN)) * MARGIN_SPRING * dt;

          const sp = Math.hypot(c.vx, c.vy);
          const maxSp = (S.splitMode === 'bondDrift' && c.bondTimer > 0) ? 25 : 90;
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
    ctx.fillStyle = '#2a0b14';
    ctx.fillRect(0, 0, W, H);

    const t = ts * 0.001 * S.bgFlowSpeed;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of SPOTS) {
      const cx = (s.ax
        + s.ox1 * Math.sin(t * s.w1 + s.phx)
        + s.ox2 * Math.sin(t * s.w1 * 2.3 + s.phx * 0.7)) * W;
      const cy = (s.ay
        + s.oy1 * Math.cos(t * s.w2 + s.phy)
        + s.oy2 * Math.sin(t * s.w2 * 1.7 + s.phy * 1.3)) * H;
      const radius = s.r * Math.max(W, H);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, 'rgba(255,140,150,0.18)');
      grad.addColorStop(0.5, 'rgba(255,90,110,0.06)');
      grad.addColorStop(1, 'rgba(255,140,150,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    const pulse = 0.92 + 0.08 * Math.sin(ts * 0.0006);
    const vg = ctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, `rgba(20,3,9,${0.55 * pulse})`);
    vg.addColorStop(0.5, 'rgba(20,3,9,0)');
    vg.addColorStop(1, `rgba(20,3,9,${0.55 * pulse})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- Metaball mask ----------
  function getBlobs() {
    const out = [];
    for (const c of cells) {
      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        const half = c.r * (0.05 + p * 1.15); // 0.1r..2.4r total separation
        const a = c.splitAngle;
        const dx = Math.cos(a) * half;
        const dy = Math.sin(a) * half;
        const rr = c.r * (1.0 - p * 0.05);
        out.push({ x: c.x - dx, y: c.y - dy, r: rr });
        out.push({ x: c.x + dx, y: c.y + dy, r: rr });
      } else {
        out.push({ x: c.x, y: c.y, r: c.r });
      }
    }
    return out;
  }

  function drawMetaballMask(blobs) {
    const ow = off.width, oh = off.height;
    const sx = ow / W;

    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.clearRect(0, 0, ow, oh);
    offCtx.globalCompositeOperation = 'lighter';
    offCtx.filter = 'none';
    for (const b of blobs) {
      const x = b.x * sx;
      const y = b.y * sx;
      const r = b.r * sx * 1.8;
      const g = offCtx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      offCtx.fillStyle = g;
      offCtx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    offCtx.globalCompositeOperation = 'source-over';

    // Filter pass: off → off2 (mask)
    off2Ctx.setTransform(1, 0, 0, 1, 0, 0);
    off2Ctx.globalCompositeOperation = 'copy';
    off2Ctx.filter = 'blur(8px) contrast(28)';
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

  function drawMetaballToMain() {
    const px = S.outlinePx;

    // Outline pass
    tintMask('#000000');
    const offsets = [
      [-px, 0], [px, 0], [0, -px], [0, px],
      [-px, -px], [px, px], [-px, px], [px, -px],
    ];
    for (const [dx, dy] of offsets) {
      ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, W, H);
    }

    // Cytoplasm fill
    tintMask((c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffb0c2');
      g.addColorStop(1, '#e76387');
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
        const blobs = (cell.state === 'SPLITTING')
          ? splitVirtualCenters(cell)
          : [{ x: cell.x, y: cell.y, r: cell.r }];
        for (const b of blobs) {
          const x = (b.x - b.r * 0.4) * (w / W);
          const y = (b.y - b.r * 0.5) * (h / H);
          const r = b.r * 0.7 * (w / W);
          const g = c.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, 'rgba(255,235,240,0.55)');
          g.addColorStop(1, 'rgba(255,235,240,0)');
          c.fillStyle = g;
          c.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    });
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
  }

  function splitVirtualCenters(c) {
    const p = c.splitProgress;
    const half = c.r * (0.05 + p * 1.15);
    const a = c.splitAngle;
    const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
    const rr = c.r * (1.0 - p * 0.05);
    return [{ x: c.x - dx, y: c.y - dy, r: rr }, { x: c.x + dx, y: c.y + dy, r: rr }];
  }

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
    ctx.save();
    ctx.lineWidth = Math.max(2, S.outlinePx);
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#3a0d24';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Highlight
    ctx.fillStyle = 'rgba(255,200,210,0.55)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
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
    const blobs = getBlobs();
    if (blobs.length) {
      drawMetaballMask(blobs);
      drawMetaballToMain();
    }
    drawNuclei(ts);
    if (S.showDebugField) drawDebug(blobs);

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

  gearBtn.addEventListener('click', () => settingsEl.classList.toggle('hidden'));
  settingsEl.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => settingsEl.classList.add('hidden'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') settingsEl.classList.add('hidden');
  });

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
            c.splitTimer = rollSplitTimer();
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

  // ---------- Boot ----------
  resize();
  window.addEventListener('resize', resize);
  resetSim();
  requestAnimationFrame(frame);
})();
