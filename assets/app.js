// Microbes — entry point. Wires the DOM, settings UI, input handlers,
// and frame loop to a `Sim` instance and a renderer (Canvas2D for now;
// WebGL2 will plug in here in a later phase).

import {
  S, saveSettings, applyI18n,
  THEMES, BACKGROUNDS, CELL_TYPES, PATHOGEN_GROUPS, LOCALES,
  T, cellLabel, cellDesc,
  currentTheme, currentBackground, colorNameFor,
  MIN_SCALE, MAX_SCALE, DRAG_THRESHOLD,
} from './core/state.js';
import { Sim } from './core/sim.js';
import { getShapes } from './core/shape.js';
import { Canvas2DRenderer, renderCellPreview } from './render/canvas2d.js';
import { PixiRenderer } from './render/pixi.js';

// ---------- DOM ----------
const canvas = document.getElementById('stage');

// ---------- Sim + renderer ----------
const sim = new Sim();

async function tryPixi(preference) {
  const r = new PixiRenderer(canvas, sim, { preference });
  await r.initAsync();
  return r;
}

async function makeRenderer() {
  const k = S.renderer;
  try {
    if (k === 'pixi') {
      // Auto: try WebGPU, fall back to WebGL2 silently.
      try { return await tryPixi('webgpu'); }
      catch { return await tryPixi('webgl'); }
    }
    if (k === 'pixi-webgpu') return await tryPixi('webgpu');
    if (k === 'pixi-webgl2') return await tryPixi('webgl');
  } catch (e) {
    console.warn('[microbes] PixiJS unavailable, falling back to Canvas2D:', e && e.message);
    S.renderer = 'canvas2d';
    saveSettings();
  }
  const r = new Canvas2DRenderer(canvas, sim);
  r.init();
  return r;
}

// Renderer construction is async (PixiJS needs `await app.init()`).
// Boot finishes via the bottom-of-file `bootRenderer` async block.
let renderer = null;

// ---------- Resize ----------
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  sim.setViewport(W, H);
  const rs = Math.max(0.125, Math.min(1, S.renderScale || 1));
  renderer.resize(W, H, dpr, rs);
  sim.clampAllInside();
}

// ---------- Input ----------
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

function pointerScreen(ev) {
  const rect = canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function startPinchIfTwoPointers() {
  if (sim.activePointers.size !== 2) return false;
  const pts = [...sim.activePointers.values()];
  const dx = pts[1].x - pts[0].x;
  const dy = pts[1].y - pts[0].y;
  sim.pinch = {
    startDist: Math.hypot(dx, dy) || 1,
    startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    startScale: sim.camera.scale,
    startTx: sim.camera.tx,
    startTy: sim.camera.ty,
  };
  sim.drag = null;
  sim.pan = null;
  return true;
}

function enterAddMode(typeKey) {
  const t = CELL_TYPES[typeKey];
  if (!t) return;
  const localised = cellLabel(typeKey);
  sim.addMode = { type: typeKey, label: localised };
  const lbl = document.getElementById('addBadgeLabel');
  if (lbl) lbl.textContent = T('adding', { name: localised });
  document.body.classList.add('adding');
}
function cancelAddMode() {
  sim.addMode = null;
  document.body.classList.remove('adding');
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.target !== canvas) return;
  const sp = pointerScreen(ev);
  sim.activePointers.set(ev.pointerId, { x: sp.x, y: sp.y });
  canvas.setPointerCapture?.(ev.pointerId);

  if (startPinchIfTwoPointers()) return;

  if (sim.addMode && ev.button === 0) {
    const w0 = sim.screenToWorld(sp.x, sp.y);
    sim.spawnAtWorld(sim.addMode.type, w0.x, w0.y);
    cancelAddMode();
    return;
  }

  if (ev.button === 2) {
    sim.pan = { lastX: sp.x, lastY: sp.y, startX: sp.x, startY: sp.y, moved: false, button: 2 };
    return;
  }

  const w = sim.screenToWorld(sp.x, sp.y);
  const idx = sim.hitCell(w.x, w.y);
  if (idx >= 0) {
    const c = sim.cells[idx];
    sim.drag = {
      cell: c, dx: w.x - c.x, dy: w.y - c.y,
      started: false, downX: sp.x, downY: sp.y,
      samples: [{ x: c.x, y: c.y, t: performance.now() }],
    };
    c.vx = c.vy = 0;
    c.target = null;
  } else {
    sim.pan = { lastX: sp.x, lastY: sp.y, startX: sp.x, startY: sp.y, moved: false, button: 0 };
  }
});

document.addEventListener('pointermove', (ev) => {
  if (!sim.activePointers.has(ev.pointerId) && !sim.drag && !sim.pan && !sim.pinch) return;
  const sp = pointerScreen(ev);
  const prev = sim.activePointers.get(ev.pointerId);
  if (prev) { prev.x = sp.x; prev.y = sp.y; }

  if (sim.pinch && sim.activePointers.size === 2) {
    const pts = [...sim.activePointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx, dy) || 1;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const factor = dist / sim.pinch.startDist;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, sim.pinch.startScale * factor));
    const wx = (sim.pinch.startMid.x - sim.pinch.startTx) / sim.pinch.startScale;
    const wy = (sim.pinch.startMid.y - sim.pinch.startTy) / sim.pinch.startScale;
    sim.camera.scale = newScale;
    sim.camera.tx = mid.x - wx * newScale;
    sim.camera.ty = mid.y - wy * newScale;
    return;
  }

  if (sim.drag) {
    if (!sim.drag.started) {
      const ddx = sp.x - sim.drag.downX, ddy = sp.y - sim.drag.downY;
      if (ddx * ddx + ddy * ddy > DRAG_THRESHOLD * DRAG_THRESHOLD) sim.drag.started = true;
    }
    if (sim.drag.started) {
      const w = sim.screenToWorld(sp.x, sp.y);
      sim.drag.cell.x = w.x - sim.drag.dx;
      sim.drag.cell.y = w.y - sim.drag.dy;
      sim.drag.cell.vx = sim.drag.cell.vy = 0;
      const now = performance.now();
      sim.drag.samples.push({ x: sim.drag.cell.x, y: sim.drag.cell.y, t: now });
      const cutoff = now - 120;
      while (sim.drag.samples.length > 2 && sim.drag.samples[0].t < cutoff) sim.drag.samples.shift();
    }
    return;
  }

  if (sim.pan && prev) {
    const dx = sp.x - sim.pan.lastX;
    const dy = sp.y - sim.pan.lastY;
    if (!sim.pan.moved) {
      const tx = sp.x - sim.pan.startX, ty = sp.y - sim.pan.startY;
      if (tx * tx + ty * ty > DRAG_THRESHOLD * DRAG_THRESHOLD) sim.pan.moved = true;
    }
    if (sim.pan.moved) {
      sim.camera.tx += dx;
      sim.camera.ty += dy;
    }
    sim.pan.lastX = sp.x;
    sim.pan.lastY = sp.y;
  }
});

function endPointer(ev) {
  sim.activePointers.delete(ev.pointerId);
  if (sim.pinch && sim.activePointers.size < 2) sim.pinch = null;
  if (sim.activePointers.size === 0) {
    if (sim.drag) {
      if (sim.drag.started) {
        const now = performance.now();
        const samples = sim.drag.samples;
        let i = samples.length - 1;
        while (i > 0 && (now - samples[i].t) < 80) i--;
        const a = samples[i];
        const b = samples[samples.length - 1];
        const dt = Math.max(0.016, (b.t - a.t) / 1000);
        sim.drag.cell.vx = (b.x - a.x) / dt * S.throwStrength;
        sim.drag.cell.vy = (b.y - a.y) / dt * S.throwStrength;
        sim.drag.cell.target = null;
      } else if (S.splitOnTap) {
        sim.beginSplit(sim.drag.cell);
      } else {
        if (sim.drag.cell.category === 'good') {
          if (sim.selectedCells.has(sim.drag.cell)) {
            sim.selectedCells.delete(sim.drag.cell);
          } else {
            sim.selectedCells.add(sim.drag.cell);
            sim.drag.cell.flash = 0.4;
            sim.drag.cell.target = null;
          }
        } else {
          sim.drag.cell.flash = 0.25;
        }
      }
    } else if (sim.pan && !sim.pan.moved) {
      if (sim.selectedCells.size > 0) {
        const w = sim.screenToWorld(sim.pan.lastX, sim.pan.lastY);
        for (const c of sim.selectedCells) {
          if (c.state === 'NORMAL') c.target = { x: w.x, y: w.y };
        }
        sim.targetMarker = { x: w.x, y: w.y, t0: performance.now() };
      }
    }
    sim.drag = null;
    sim.pan = null;
  }
}
document.addEventListener('pointerup', endPointer);
document.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const sp = pointerScreen(ev);
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, sim.camera.scale * factor));
  const k = newScale / sim.camera.scale;
  sim.camera.tx = sp.x - (sp.x - sim.camera.tx) * k;
  sim.camera.ty = sp.y - (sp.y - sim.camera.ty) * k;
  sim.camera.scale = newScale;
}, { passive: false });

// ---------- Settings UI ----------
const settingsEl = document.getElementById('settings');
const gearBtn = document.getElementById('gear');
const helpDialog = document.getElementById('helpDialog');
const paletteDialog = document.getElementById('paletteDialog');
const paletteBadDialog = document.getElementById('paletteBadDialog');
const helpBtn = document.getElementById('help');
const paletteBtn = document.getElementById('palette');
const paletteBadBtn = document.getElementById('paletteBad');
const reloadBtn = document.getElementById('reload');
const fabs = [gearBtn, helpBtn, paletteBtn, paletteBadBtn, reloadBtn].filter(Boolean);
const allDialogs = [settingsEl, helpDialog, paletteDialog, paletteBadDialog].filter(Boolean);

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
if (paletteBadBtn) paletteBadBtn.addEventListener('click', () => {
  if (!S.allowBadGuys) return;
  if (paletteBadDialog.classList.contains('hidden')) {
    renderPaletteBadGrid();
    openOnly(paletteBadDialog);
  } else closeAll();
});

function gotoHelp(ev) {
  if (ev) ev.preventDefault();
  openOnly(helpDialog);
}
const p2h = document.getElementById('paletteToHelp');
if (p2h) p2h.addEventListener('click', gotoHelp);
const pb2h = document.getElementById('paletteBadToHelp');
if (pb2h) pb2h.addEventListener('click', gotoHelp);

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
  if (e.key === 'Escape') {
    if (sim.addMode) cancelAddMode();
    else closeAll();
  }
});
const addBadgeCancelBtn = document.getElementById('addBadgeCancel');
if (addBadgeCancelBtn) addBadgeCancelBtn.addEventListener('click', cancelAddMode);

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
      for (const c of sim.cells) {
        if (c.state === 'NORMAL' && c.splitTimer > S.autoSplitSeconds * 1.5) {
          c.splitTimer = sim.rollSplitTimer(c.type);
        }
      }
    }
  });
}
bindRange('maxCells', 'maxCells', 'maxCellsVal', v => v.toFixed(0));
bindRange('autoSplitSeconds', 'autoSplitSeconds', 'autoVal', v => v.toFixed(0) + 's');
bindRange('bgFlowSpeed', 'bgFlowSpeed', 'bgVal', v => v.toFixed(2) + '×');
bindRange('outlinePx', 'outlinePx', 'outVal', v => v.toFixed(0) + 'px');
bindRange('membraneIntensity', 'membraneIntensity', 'membraneVal', v => v.toFixed(2));
bindRange('cellSizeMul', 'cellSizeMul', 'cellSizeVal', v => v.toFixed(2) + '×');
bindRange('friction', 'friction', 'frictionVal', v => v.toFixed(2));
bindRange('bounce', 'bounce', 'bounceVal', v => v.toFixed(2));
bindRange('throwStrength', 'throwStrength', 'throwVal', v => v.toFixed(2) + '×');
bindRange('wobbleAmp', 'wobbleAmp', 'wobbleVal', v => v.toFixed(2));

const blendSel = document.getElementById('blendMode');
if (blendSel) {
  blendSel.value = S.blendMode || 'source-over';
  blendSel.addEventListener('change', () => {
    S.blendMode = blendSel.value;
    saveSettings();
  });
}

const useHl = document.getElementById('useHighlight');
if (useHl) {
  useHl.checked = !!S.useHighlight;
  useHl.addEventListener('change', () => {
    S.useHighlight = useHl.checked;
    saveSettings();
  });
}

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

const modeTargetBtn = document.getElementById('modeTarget');
const modeSplitBtn  = document.getElementById('modeSplit');
function applyModeUi() {
  if (modeTargetBtn) modeTargetBtn.classList.toggle('active', !S.splitOnTap);
  if (modeSplitBtn)  modeSplitBtn.classList.toggle('active',  !!S.splitOnTap);
}
function setSplitOnTap(on) {
  S.splitOnTap = !!on;
  saveSettings();
  applyModeUi();
  const cb = document.getElementById('splitOnTap');
  if (cb) cb.checked = S.splitOnTap;
}
if (modeTargetBtn) modeTargetBtn.addEventListener('click', () => setSplitOnTap(false));
if (modeSplitBtn)  modeSplitBtn.addEventListener('click',  () => setSplitOnTap(true));
bindCheckbox('splitOnTap', 'splitOnTap', applyModeUi);
applyModeUi();
bindCheckbox('randomSplit', 'randomSplit');
bindCheckbox('cartoon', 'cartoon');
bindCheckbox('showFPS', 'showFPS', (on) => {
  const el = document.getElementById('fps');
  if (el) el.classList.toggle('on', !!on);
});

for (const r of settingsEl.querySelectorAll('input[name="splitMode"]')) {
  r.checked = (r.value === S.splitMode);
  r.addEventListener('change', () => {
    if (!r.checked) return;
    S.splitMode = r.value;
    saveSettings();
  });
}

const dbg = document.getElementById('showDebugField');
if (dbg) {
  dbg.checked = S.showDebugField;
  dbg.addEventListener('change', () => {
    S.showDebugField = dbg.checked;
    saveSettings();
  });
}

function applyThemeToCss(theme) {
  document.documentElement.style.setProperty('--accent', theme.ui.panelAccent);
}

const themeSelect = document.getElementById('themeSelect');
for (const [key, t] of Object.entries(THEMES)) {
  const opt = document.createElement('option');
  opt.value = key;
  // Append the theme's accent colour in parens so users can scan by hue.
  const accent = (t.ui && t.ui.panelAccent) || '';
  opt.textContent = accent ? `${t.label} (${colorNameFor(accent)})` : t.label;
  themeSelect.appendChild(opt);
}
themeSelect.value = S.theme in THEMES ? S.theme : 'petriDish';
applyThemeToCss(currentTheme());
themeSelect.addEventListener('change', () => {
  if (THEMES[themeSelect.value]) {
    S.theme = themeSelect.value;
    saveSettings();
    applyThemeToCss(currentTheme());
  }
});

function bgAccent(b) {
  if (Array.isArray(b.spotColors) && b.spotColors[0]) return b.spotColors[0];
  return b.spotColor || b.botColor || b.topColor || b.base || '';
}

const bgSelect = document.getElementById('bgSelect');
if (bgSelect) {
  for (const [key, b] of Object.entries(BACKGROUNDS)) {
    const opt = document.createElement('option');
    opt.value = key;
    const lbl = b.label || key;
    const accent = bgAccent(b);
    const name = accent ? colorNameFor(accent) : '';
    opt.textContent = name ? `${lbl} (${name})` : lbl;
    bgSelect.appendChild(opt);
  }
  bgSelect.value = (S.background in BACKGROUNDS) ? S.background : (S.theme in BACKGROUNDS ? S.theme : 'solid');
  bgSelect.addEventListener('change', () => {
    if (BACKGROUNDS[bgSelect.value]) {
      S.background = bgSelect.value;
      saveSettings();
    }
  });
}

function applyUpscaleMode() {
  canvas.classList.toggle('pixel', S.upscaleMode === 'pixel');
}
function applyScanlines() {
  document.body.classList.toggle('scanlines', !!S.scanlines);
}
applyUpscaleMode();
applyScanlines();

const renderScaleEl = document.getElementById('renderScale');
if (renderScaleEl) {
  renderScaleEl.value = String(S.renderScale ?? 1);
  renderScaleEl.addEventListener('change', () => {
    const v = parseFloat(renderScaleEl.value);
    if (!isNaN(v)) {
      S.renderScale = Math.max(0.125, Math.min(1, v));
      saveSettings();
      resize();
    }
  });
}
const upscaleEl = document.getElementById('upscaleMode');
if (upscaleEl) {
  upscaleEl.value = S.upscaleMode || 'blur';
  upscaleEl.addEventListener('change', () => {
    S.upscaleMode = upscaleEl.value === 'pixel' ? 'pixel' : 'blur';
    saveSettings();
    applyUpscaleMode();
  });
}
bindCheckbox('scanlinesToggle', 'scanlines', applyScanlines);

// Renderer engine — fundamental change, easiest to handle by reloading.
const rendererSel = document.getElementById('rendererEngine');
if (rendererSel) {
  rendererSel.value = S.renderer;
  rendererSel.addEventListener('change', () => {
    let kind = rendererSel.value;
    const valid = ['canvas2d', 'pixi', 'pixi-webgpu', 'pixi-webgl2'];
    if (!valid.includes(kind)) kind = 'canvas2d';
    if (kind === S.renderer) return;
    S.renderer = kind;
    saveSettings();
    location.reload();
  });
}

// ---------- Palette + help dialog list rendering ----------
function makeTile(key) {
  const tile = document.createElement('button');
  tile.className = 'cell-tile';
  tile.type = 'button';
  tile.title = cellDesc(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  tile.appendChild(c);
  const span = document.createElement('span');
  span.textContent = cellLabel(key);
  tile.appendChild(span);
  tile.addEventListener('click', () => {
    enterAddMode(key);
    closeAll();
  });
  renderCellPreview(c, key);
  return tile;
}

function appendGridSection(parent, title, entries) {
  if (!entries.length) return;
  const section = document.createElement('div');
  section.className = 'cell-grid-section';
  const h = document.createElement('h3');
  h.textContent = title;
  section.appendChild(h);
  const grid = document.createElement('div');
  grid.className = 'cell-grid';
  for (const [key] of entries) grid.appendChild(makeTile(key));
  section.appendChild(grid);
  parent.appendChild(section);
}

function appendHelpSection(parent, title, entries) {
  if (!entries.length) return;
  const section = document.createElement('li');
  section.className = 'cell-list-section';
  section.style.listStyle = 'none';
  const h = document.createElement('h3');
  h.textContent = title;
  section.appendChild(h);
  for (const [key] of entries) {
    const row = document.createElement('div');
    row.className = 'cell-list-row';
    const cv = document.createElement('canvas');
    cv.width = 96;
    cv.height = 96;
    cv.className = 'cell-list-icon';
    const text = document.createElement('div');
    text.className = 'cell-list-text';
    const b = document.createElement('b');
    b.textContent = cellLabel(key);
    const span = document.createElement('span');
    span.textContent = cellDesc(key);
    text.appendChild(b);
    text.appendChild(span);
    row.appendChild(cv);
    row.appendChild(text);
    section.appendChild(row);
    renderCellPreview(cv, key);
  }
  parent.appendChild(section);
}

const cellListEl = document.getElementById('cellList');
function renderHelpList() {
  if (!cellListEl) return;
  cellListEl.innerHTML = '';
  const goodEntries = Object.entries(CELL_TYPES).filter(([, t]) => t.category === 'good');
  appendHelpSection(cellListEl, T('help_group_good'), goodEntries);
  if (S.allowBadGuys) {
    for (const g of PATHOGEN_GROUPS) {
      const entries = g.members.map(k => [k, CELL_TYPES[k]]).filter(([, t]) => t);
      appendHelpSection(cellListEl, `${g.icon} ${T('pgroup_' + g.key)}`, entries);
    }
  }
}
renderHelpList();

// Language selector — re-renders dialogs on change.
const langSelect = document.getElementById('langSelect');
if (langSelect) {
  const langs = [
    ['en','English'], ['de','Deutsch'], ['es','Español'],
    ['bar','Bayrisch'], ['latin','Latina'],
  ];
  for (const [k, label] of langs) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = label;
    langSelect.appendChild(opt);
  }
  langSelect.value = (LOCALES[S.lang] ? S.lang : 'en');
  langSelect.addEventListener('change', () => {
    S.lang = LOCALES[langSelect.value] ? langSelect.value : 'en';
    saveSettings();
    applyI18n();
    renderHelpList();
    renderPaletteGrid();
    renderPaletteBadGrid();
  });
}
applyI18n();

const cellGridEl = document.getElementById('cellGrid');
const cellGridBadEl = document.getElementById('cellGridBad');
function renderPaletteGrid() {
  if (!cellGridEl) return;
  cellGridEl.innerHTML = '';
  const goodEntries = Object.entries(CELL_TYPES).filter(([, t]) => t.category === 'good');
  appendGridSection(cellGridEl, T('help_group_good'), goodEntries);
}
function renderPaletteBadGrid() {
  if (!cellGridBadEl) return;
  cellGridBadEl.innerHTML = '';
  if (!S.allowBadGuys) return;
  for (const g of PATHOGEN_GROUPS) {
    const entries = g.members.map(k => [k, CELL_TYPES[k]]).filter(([, t]) => t);
    appendGridSection(cellGridBadEl, `${g.icon} ${T('pgroup_' + g.key)}`, entries);
  }
}

document.body.classList.toggle('no-bad', !S.allowBadGuys);
bindCheckbox('allowBadGuys', 'allowBadGuys', (on) => {
  document.body.classList.toggle('no-bad', !on);
  if (!on && paletteBadDialog && !paletteBadDialog.classList.contains('hidden')) {
    closeAll();
  }
  renderHelpList();
  renderPaletteBadGrid();
});

// ---------- Reset ----------
const resetBtn = document.getElementById('resetSim');
if (resetBtn) resetBtn.addEventListener('click', () => sim.resetSim());

// ---------- Build stamp ----------
function renderBuildStamp() {
  const el = document.getElementById('build');
  if (!el) return;
  const b = window.__BUILD__ || { sha: 'dev', run: 0, dateUtc: null };
  const sha = (b.sha || 'dev').slice(0, 7);
  let when = '';
  if (b.dateUtc) {
    const d = new Date(b.dateUtc);
    if (!isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      when = `${mm}-${dd} ${hh}:${mi}`;
    }
  }
  el.textContent = when ? `${sha} · ${when}` : sha;
}
renderBuildStamp();

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
  fpsEl.textContent = T('fps_line', { fps, n: sim.cells.length });
}

function frame(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  sim.update(dt);

  const t = ts * 0.001;
  const shapes = getShapes(sim.cells, t, sim.camera, sim.W, sim.H);

  renderer.beginFrame(ts, dt);
  renderer.drawBackground(ts);
  if (shapes.length) renderer.drawCells(shapes, t, ts);
  renderer.drawSelection(shapes, t);
  if (S.showDebugField) renderer.drawDebug(shapes);
  renderer.endFrame();

  updateFPS(dt, ts);

  requestAnimationFrame(frame);
}

// ---------- Boot ----------
// Renderer init is async (PixiJS). We await it before the first
// resize() / frame() so those calls always see a live renderer.
(async () => {
  renderer = await makeRenderer();
  resize();
  window.addEventListener('resize', resize);
  sim.resetSim();
  requestAnimationFrame(frame);
})();
