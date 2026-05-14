// Microbes — entry point. Wires the DOM, settings UI, input handlers,
// and frame loop to a `Sim` instance and a renderer (Canvas2D for now;
// WebGL2 will plug in here in a later phase).

import {
  S, SETTINGS_KEY, DEFAULTS, saveSettings, applyI18n,
  THEMES, BACKGROUNDS, CELL_TYPES, PATHOGEN_GROUPS, LOCALES,
  INTERFACE_ACCENTS,
  T, cellLabel, cellDesc,
  currentTheme, currentBackground, currentInterfaceColor, colorNameFor,
  bgLayerFromPreset, bgLayersFromPreset, makeBgLayerId,
  overlayFxOrder,
  MIN_SCALE, MAX_SCALE, DRAG_THRESHOLD,
} from './core/state.js';
import { openColorPicker } from './ui/color-picker.js';
import { showToast, copyToClipboard } from './ui/toast.js';
import { takeScreenshot } from './ui/screenshot.js';
import { NavArrows } from './ui/nav-arrows.js';
import { Sim } from './core/sim.js';
import {
  URL_OVERRIDES,
  applyOverridesToSettings,
  applyOverridesToSim,
} from './core/url-overrides.js';
import { testKindFor } from './core/cell-kinds.js';
import { CELL_RELATIONS } from './core/cell-relations.js';
import { defaultHp, getRule } from './core/sim-rules.js';
import { FloatingText } from './core/floating-text.js';
import { CellTagOverlay } from './core/cell-tag.js';
import { SpawnBanner } from './core/spawn-banner.js';
import { buildCodename } from './core/build-codename.js';
import { getShapes, inView } from './core/shape.js';
import { Canvas2DRenderer, renderCellPreview } from './render/canvas2d.js';
import { WebGL2Renderer } from './render/webgl2.js';
import { WebGPURenderer } from './render/webgpu.js';
// Static import of TRACKS so the "Now playing" label can be set
// synchronously at boot — the MusicPlayer + SfxPlayer modules still
// load lazily through Promise.all() below (their classes are bigger
// than the TRACKS constant and the live binding takes over from there).
import { TRACKS as _MUSIC_TRACKS } from './core/music.js';

// ---------- DOM ----------
const canvas = document.getElementById('stage');

// ---------- In-settings debug log ----------
// Mobile devices have no DevTools console; intercept the four common
// console methods and mirror their output into a ring buffer. Settings
// → "Debug log" renders the buffer so the user can read runtime
// diagnostics without a desktop. The originals still fire so desktop
// DevTools is unaffected.
const _debugLog = [];
const _DEBUG_LOG_MAX = 200;
function _formatArg(a) {
  if (a == null) return String(a);
  if (typeof a === 'string') return a;
  if (typeof a === 'number' || typeof a === 'boolean') return String(a);
  try {
    const s = JSON.stringify(a);
    return (s == null) ? String(a) : s;
  } catch { return String(a); }
}
['log', 'info', 'warn', 'error', 'debug', 'trace'].forEach((level) => {
  const orig = console[level] ? console[level].bind(console) : console.log.bind(console);
  console[level] = (...args) => {
    orig(...args);
    try {
      const msg = args.map(_formatArg).join(' ');
      // Dedupe consecutive identical messages with a count.
      // Some flows (e.g. the WebGPU duotone validation error)
      // fire the same warning every frame at ~60 Hz; without
      // dedupe the 200-entry buffer evicts every other message
      // within ~3 s. Collapsing here keeps one-shot init logs
      // visible alongside the spammy repeats.
      const last = _debugLog[_debugLog.length - 1];
      if (last && last.level === level && last.msg === msg) {
        last.count = (last.count || 1) + 1;
        last.t = Date.now();
      } else {
        _debugLog.push({ t: Date.now(), level, msg, count: 1 });
        if (_debugLog.length > _DEBUG_LOG_MAX) _debugLog.shift();
      }
      _refreshDebugLog();
    } catch { /* never let logging break the app */ }
  };
});
// console.assert: only logs when the first arg is falsy. We mirror
// the failure into the debug log the same way native consoles do.
const _origAssert = console.assert ? console.assert.bind(console) : null;
console.assert = (cond, ...args) => {
  if (_origAssert) _origAssert(cond, ...args);
  if (cond) return;
  try {
    const msg = ['Assertion failed:', ...args].map(_formatArg).join(' ');
    _debugLog.push({ t: Date.now(), level: 'error', msg });
    if (_debugLog.length > _DEBUG_LOG_MAX) _debugLog.shift();
    _refreshDebugLog();
  } catch { /* never let logging break the app */ }
};
// Uncaught errors + unhandled promise rejections — these bypass the
// console wrappers above but are exactly the events the user wants
// to see in the debug log.
window.addEventListener('error', (e) => {
  try {
    const m = e && (e.error?.stack || e.message) || 'window error';
    _debugLog.push({ t: Date.now(), level: 'error', msg: String(m) });
    if (_debugLog.length > _DEBUG_LOG_MAX) _debugLog.shift();
    _refreshDebugLog();
  } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    const r = e && e.reason;
    const m = (r && (r.stack || r.message)) || String(r);
    _debugLog.push({ t: Date.now(), level: 'error', msg: 'Unhandled rejection: ' + m });
    if (_debugLog.length > _DEBUG_LOG_MAX) _debugLog.shift();
    _refreshDebugLog();
  } catch {}
});
function _refreshDebugLog() {
  const el = document.getElementById('debugLogView');
  if (!el) return;
  // Skip render work when settings is hidden (cheap fast-path).
  const settingsHidden = document.getElementById('settings')?.classList.contains('hidden');
  if (settingsHidden) return;
  // Render as innerHTML so per-level colour tints work via a span class.
  // Escape anything that could be HTML.
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = _debugLog.map((e) => {
    const t = new Date(e.t);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    const ms = String(t.getMilliseconds()).padStart(3, '0');
    const cls = (e.level === 'warn' || e.level === 'error' || e.level === 'info') ? ` class="lvl-${e.level}"` : '';
    const xN = (e.count && e.count > 1) ? ` (×${e.count})` : '';
    return `<span${cls}>[${hh}:${mm}:${ss}.${ms}] ${e.level.toUpperCase().padEnd(5)} ${esc(e.msg)}${xN}</span>`;
  });
  el.innerHTML = lines.join('\n');
  el.scrollTop = el.scrollHeight;
}
function _hookDebugLogButtons() {
  const clearBtn = document.getElementById('debugLogClear');
  const copyBtn  = document.getElementById('debugLogCopy');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      _debugLog.length = 0;
      _refreshDebugLog();
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      // Prepend the build stamp so anything pasted into a bug
      // report carries the exact sha / run / codename / date the
      // user was looking at. Falls back to '(dev)' for local
      // serves where build.js wasn't stamped.
      const header = (typeof _currentBuildLabel === 'string' && _currentBuildLabel)
        ? _currentBuildLabel
        : '(dev)';
      const body = _debugLog.map((e) => {
        const t = new Date(e.t).toISOString().slice(11, 23);
        const xN = (e.count && e.count > 1) ? ` (×${e.count})` : '';
        return `[${t}] ${e.level.toUpperCase().padEnd(5)} ${e.msg}${xN}`;
      }).join('\n');
      const txt = `build: ${header}\n${body}`;
      try {
        await navigator.clipboard.writeText(txt);
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = copyBtn.dataset.label || 'Copy'; }, 800);
      } catch { /* clipboard might be unavailable on some mobile browsers */ }
    });
    copyBtn.dataset.label = copyBtn.textContent;
  }
}

// URL query-param overrides — patches S (theme / renderer /
// extendedCells / cartoon) before any binding reads it. In-memory
// only, never persisted. See assets/core/url-overrides.js for the
// supported params + the skill at
// .claude/skills/import-shader-test-cell/SKILL.md for usage.
applyOverridesToSettings(S);

// ---------- Sim + renderer ----------
const sim = new Sim();
// URL-requested cell spawn (?cellType=…) happens in the boot IIFE
// AFTER `sim.resetSim()` runs — otherwise resetSim's default spawn
// would clobber the override. See bottom-of-file boot block.
const floatingText = new FloatingText(document.getElementById('floatingText'));
const cellTags = new CellTagOverlay(document.getElementById('cellTagLayer'));
const spawnBanner = new SpawnBanner(document.getElementById('spawnBannerLayer'));
const navArrows = new NavArrows(document.body);

async function tryWebGPU() {
  const r = new WebGPURenderer(canvas, sim);
  await r.initAsync();
  return r;
}

async function makeRenderer() {
  const k = S.renderer;
  // Runtime-only fallback: webgpu → webgl2 → canvas2d. If a renderer
  // fails to initialise we cascade to the next-best one for THIS load
  // only — `S.renderer` is left as the user picked it so the dropdown
  // keeps showing their choice and the next reload retries. Each path
  // logs its outcome for DevTools.
  //
  // Strict mode: rendertest with an explicit `?renderer=` rejects
  // fallback so Playwright sees a hard page-error instead of silently
  // capturing a different backend. Normal users (no rendertest) still
  // get the cascade.
  const strict = !!URL_OVERRIDES.rendertest && !!URL_OVERRIDES.renderer;
  if (k === 'webgpu') {
    try {
      const r = await tryWebGPU();
      console.info('[microbes] WebGPURenderer ready');
      return r;
    } catch (e) {
      if (strict) throw new Error('[rendertest] forced webgpu unavailable: ' + (e && e.message));
      console.warn('[microbes] WebGPU unavailable, trying WebGL2:', e && e.message);
    }
  }
  if (k === 'webgl2' || k === 'webgpu') {
    try {
      const r = new WebGL2Renderer(canvas, sim);
      r.init();
      console.info('[microbes] WebGL2Renderer ready' + (k === 'webgpu' ? ' (WebGPU fallback)' : ''));
      return r;
    } catch (e) {
      if (strict) throw new Error('[rendertest] forced ' + k + ' unavailable: ' + (e && e.message));
      console.warn('[microbes] WebGL2 unavailable, falling back to Canvas2D for this load:', e && e.message);
    }
  }
  if (strict && k !== 'canvas2d') {
    throw new Error('[rendertest] forced ' + k + ' unavailable: no Canvas2D fallback in strict mode');
  }
  const r = new Canvas2DRenderer(canvas, sim);
  r.init();
  console.info('[microbes] Canvas2DRenderer ready (S.renderer="' + k + '")');
  return r;
}

// Renderer construction is async (WebGPU needs `await device.requestDevice()`).
// Boot finishes via the bottom-of-file `bootRenderer` async block.
let renderer = null;

// ---------- Resize ----------
let dpr = 1;
function resize() {
  // Rendertest mode locks the canvas to a deterministic size with
  // dpr=1 so Playwright captures match across machines (no Retina
  // doubling, no viewport-dependent jitter). Viewport-resize events
  // are short-circuited so the user resizing the browser mid-capture
  // doesn't move the cell.
  if (URL_OVERRIDES.rendertest) {
    const W = URL_OVERRIDES.w || 512;
    const H = URL_OVERRIDES.h || 512;
    dpr = 1;
    sim.setViewport(W, H);
    renderer.resize(W, H, 1, 1);
    applyRendertestCamera(sim, W, H);
    sim.clampAllInside();
    return;
  }
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  sim.setViewport(W, H);
  const rs = Math.max(0.125, Math.min(1, S.renderScale || 1));
  renderer.resize(W, H, dpr, rs);
  sim.clampAllInside();
}

// Frame the single spawned cell so its bbox + 10% padding fills the
// shorter canvas axis. Called after `applyOverridesToSim` has dropped
// the cell at world centre. Idempotent — safe to call from `resize`.
function applyRendertestCamera(sim, W, H) {
  if (!sim || !sim.camera || !Array.isArray(sim.cells) || sim.cells.length === 0) return;
  const c = sim.cells[0];
  if (!c || !(c.r > 0)) return;
  const half = Math.min(W, H) / 2;
  const scale = half / (c.r * 1.1);
  sim.camera.scale = scale;
  sim.camera.tx = W / 2 - scale * c.x;
  sim.camera.ty = H / 2 - scale * c.y;
  sim.camera.rotation = 0;
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
    // Angle between the two fingers at the start of the gesture; the
    // rotation delta is (currentAngle - startAngle), applied to
    // sim.camera.rotation. Pinch midpoint stays anchored in world space.
    startAngle: Math.atan2(dy, dx),
    startRotation: sim.camera.rotation,
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
  // Mutual exclusion with the other top-screen mode buttons —
  // add-mode is the fourth peer of target / split / kill. Clear
  // the others; their setters re-run applyModeUi which we also
  // call below to sync the `+` FAB's .active ring.
  if (sim.killMode) setKillMode(false);
  if (S.splitOnTap) setSplitOnTap(false);
  applyModeUi();
  console.info('[add] enter', typeKey);
}
function cancelAddMode() {
  if (sim.addMode) console.info('[add] cancel', sim.addMode.type);
  sim.addMode = null;
  document.body.classList.remove('adding');
  applyModeUi();
}

canvas.addEventListener('pointerdown', (ev) => {
  // When in add mode, allow the click to spawn regardless of the
  // event target — a stale spawn-banner or other floating overlay
  // can briefly shift ev.target away from the canvas even though the
  // overlay has pointer-events: none. Strict target check stays for
  // the normal drag/select path.
  if (ev.target !== canvas && !sim.addMode) return;
  const sp = pointerScreen(ev);
  sim.activePointers.set(ev.pointerId, { x: sp.x, y: sp.y });
  canvas.setPointerCapture?.(ev.pointerId);

  if (startPinchIfTwoPointers()) return;

  if (sim.addMode && ev.button === 0) {
    const w0 = sim.screenToWorld(sp.x, sp.y);
    const justSpawnedType = sim.addMode.type;
    const spawned = sim.spawnAtWorld(justSpawnedType, w0.x, w0.y);
    console.info('[add] canvas-spawn',
      justSpawnedType,
      'at', Math.round(w0.x), Math.round(w0.y),
      spawned ? 'ok' : 'CAP',
    );
    // First-spawn banner: SpawnBanner.notify is a no-op for any
    // type the user has already seen (localStorage-tracked) so
    // it's safe to call unconditionally.
    spawnBanner.notify(justSpawnedType);
    // Sticky add-mode: stay armed so subsequent clicks keep
    // spawning the same type. Exit via the `+` FAB toggle, another
    // mode button, Esc, or the badge `×`.
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
    // Two-finger rotation is opt-in — off by default. When disabled the
    // camera's rotation stays pinned to the gesture's start value (which
    // is also the pre-gesture rotation, since the toggle is global), so
    // the pinch becomes a pure scale+pan.
    const newRotation = S.pinchRotation
      ? sim.pinch.startRotation + (Math.atan2(dy, dx) - sim.pinch.startAngle)
      : sim.pinch.startRotation;
    // Rotation-aware re-anchor: keep the world point that was under the
    // pinch midpoint at gesture start under the current pinch midpoint
    // as scale + rotation change. (When rotation collapses to 0 this
    // reduces to the original wx/wy formula.)
    const c0 = Math.cos(sim.pinch.startRotation);
    const s0 = Math.sin(sim.pinch.startRotation);
    const dx0 = sim.pinch.startMid.x - sim.pinch.startTx;
    const dy0 = sim.pinch.startMid.y - sim.pinch.startTy;
    const wx = ( c0 * dx0 + s0 * dy0) / sim.pinch.startScale;
    const wy = (-s0 * dx0 + c0 * dy0) / sim.pinch.startScale;
    const cN = Math.cos(newRotation);
    const sN = Math.sin(newRotation);
    const wsx = wx * newScale;
    const wsy = wy * newScale;
    sim.camera.scale = newScale;
    sim.camera.rotation = newRotation;
    sim.camera.tx = mid.x - (cN * wsx - sN * wsy);
    sim.camera.ty = mid.y - (sN * wsx + cN * wsy);
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
      } else if (sim.killMode) {
        sim.killCell(sim.drag.cell);
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

// Add-mode safety net. If something between body and canvas swallows
// the click (a misbehaving overlay with pointer-events: auto, a
// captured pointer never released, etc.) the user is stuck — the
// "Adding: …" badge says we're armed but the spawn never fires.
// Listen at window-level too: when in addMode, treat any non-UI
// pointerdown as the spawn click. Logs into the in-app Debug log
// (settings → Debug log) so we can see whether this fallback is
// what actually fired the spawn.
function _isOverUi(target) {
  if (!target || target.nodeType !== 1) return false;
  return !!target.closest(
    '.fab,.mode-btn,#gear,#addBadge,.dialog,.settings-panel,.spawn-banner'
  );
}
window.addEventListener('pointerdown', (ev) => {
  if (!sim.addMode || ev.button !== 0) return;
  // The canvas-level listener already handles clicks whose target
  // is the canvas itself — bailing here prevents a double-spawn
  // when both listeners fire on the same event.
  if (ev.target === canvas) return;
  if (_isOverUi(ev.target)) return;
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return;
  const w = sim.screenToWorld(sx, sy);
  const justSpawnedType = sim.addMode.type;
  const spawned = sim.spawnAtWorld(justSpawnedType, w.x, w.y);
  console.info('[add] window-spawn', justSpawnedType,
    'tgt', ev.target && ev.target.id ? '#' + ev.target.id : (ev.target && ev.target.tagName),
    spawned ? 'ok' : 'CAP',
  );
  spawnBanner.notify(justSpawnedType);
  // Sticky add-mode (same contract as the canvas-level handler).
}, true);   // capture phase — runs before any inner-element handler

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
// helpDialog markup was removed late 2026 — the help content (cell
// list with descriptions + relations) is now the list view of the
// unified addDialog. ?-FAB just opens addDialog forced to list view.
const aboutDialog = document.getElementById('aboutDialog');
const addDialog = document.getElementById('addDialog');
// Back-compat: parts of the code still reference helpDialog. Make it
// an alias for addDialog so closeAll() / outside-click logic keeps
// working without an audit of every call site.
const helpDialog = addDialog;
// Compatibility shims so the rest of the file's references to
// `paletteDialog` / `paletteBadDialog` keep pointing somewhere
// sensible — they're now both views into the same merged dialog.
const paletteDialog = addDialog;
const paletteBadDialog = addDialog;
const paletteBtn = document.getElementById('palette');
// #paletteBad FAB was removed (PR #?? — unified add-dialog); the
// const stays as null so other references that filter Boolean
// don't break.
const paletteBadBtn = null;
const reloadBtn = document.getElementById('reload');
const pauseBtn = document.getElementById('pause');
const eyeBtn = document.getElementById('eyeToggle');
const pauseOverlay = document.getElementById('pauseOverlay');
const fabs = [gearBtn, paletteBtn, paletteBadBtn, reloadBtn, pauseBtn, eyeBtn].filter(Boolean);

// Eye-toggle: flips S.cellTypeOverlay. Persists in settings; the
// per-frame cellTags.render() pass reads S directly so no listener
// hook is needed — just keep the aria-pressed attr in sync for
// styling + accessibility.
if (eyeBtn) {
  const syncEye = () => eyeBtn.setAttribute('aria-pressed', String(!!S.cellTypeOverlay));
  syncEye();
  eyeBtn.addEventListener('click', () => {
    S.cellTypeOverlay = !S.cellTypeOverlay;
    saveSettings();
    syncEye();
    // Keep the overlay-stack list checkbox in sync.
    renderOverlayOrderList();
  });
}

// Pause state. Frame loop skips sim.update when _paused; the music
// player (assigned later by the music import block) is muted in
// parallel without touching S.musicEnabled. Pause state is transient
// — not persisted across reloads. _pauseFreezeTs holds the rAF ts
// captured at pause-onset; while paused, every renderer call gets
// that frozen value so shader u_time stops advancing too (background
// fbm, virus capsid pulse, kurzgesagt halo, etc. all freeze).
//
// `_autoPaused` is a SECOND pause flag tracking window focus /
// visibility — set by the `blur` + `visibilitychange` listeners
// further down. It freezes the sim + mutes music identically to
// `_paused`, but does NOT touch the PAUSE overlay, the pause
// button's aria-pressed state, or the body.is-paused class. Auto-
// resume is automatic once focus returns; user-pause stays in
// effect across focus changes (the two flags compose with OR).
let _paused = false;
let _autoPaused = false;
let _pauseFreezeTs = null;
let _musicPlayer = null;
// Effective pause = either the user clicked pause OR the window
// lost focus. Frame loop + music gate read this.
function _isPausedOrAuto() { return _paused || _autoPaused; }
function _musicShouldPlay() {
  return !_isPausedOrAuto() && !!S.musicEnabled && (S.musicVolume || 0) > 0;
}
function setPaused(p) {
  _paused = !!p;
  if (pauseBtn) pauseBtn.setAttribute('aria-pressed', String(_paused));
  if (pauseOverlay) {
    pauseOverlay.classList.toggle('shown', _paused);
    pauseOverlay.setAttribute('aria-hidden', String(!_paused));
  }
  // body.is-paused disables every FAB / dialog button via CSS so
  // the user has to interact with the overlay to resume (no
  // accidental side-clicks behind the blur).
  document.body.classList.toggle('is-paused', _paused);
  // Music plays when (a) the dedicated toggle is on, (b) the sim isn't
  // paused (user OR auto), and (c) the volume slider isn't dialled to 0.
  if (_musicPlayer) _musicPlayer.setEnabled(_musicShouldPlay());
}
// Focus / visibility-driven pause. Skips every user-pause side
// effect (overlay, aria-pressed, body class) so the moment the
// window regains focus the sim resumes without an explicit user
// gesture. Music fades in/out over 200 ms so a quick alt-tab
// doesn't pop the audio — the user explicitly asked for a soft
// dip rather than an abrupt cut.
const AUTO_PAUSE_FADE_MS = 200;
function setAutoPaused(p) {
  const next = !!p;
  if (next === _autoPaused) return;
  _autoPaused = next;
  if (_musicPlayer) _musicPlayer.fadeEnabled(_musicShouldPlay(), AUTO_PAUSE_FADE_MS);
}
// `?pose=1` URL override → freeze the sim AND mark the document with
// `body.is-pose-clean` so every chrome layer (pause overlay, FABs,
// scanlines, build stamp, floating text, nav-arrows, composition HUD,
// spawn banner) hides via CSS. Result: the canvas renders cells only,
// suitable for visual-diff screenshots (cell-zoo iframes, Playwright
// snapshots, side-by-side compare with shader-test).
if (URL_OVERRIDES.pose) {
  document.body.classList.add('is-pose-clean');
  setPaused(true);
}
// `?screenshot=1` URL override → fire `_screenshotNow()` after the
// first couple of frames so the paused pose has rendered + the cell
// has settled. Two rAFs is a defensive belt-and-braces: one to flush
// pause state, one to settle the renderer's first paint.
if (URL_OVERRIDES.screenshot) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { _screenshotNow(); });
  });
}
// `?rendertest=1` (or `?debug=1&test=render`) → after the first two
// frames settle, expose `window.__RENDERTEST_READY__ = true` so
// Playwright's `waitForFunction` can pick up the captured PNG. If
// `?download=1` is also set, trigger an automatic browser download
// with the deterministic filename pattern. Filename:
//   {origin}_cell-{cellType}{kindN}_{theme}[_translucent].png
if (URL_OVERRIDES.rendertest) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Re-frame in case spawn settled the cell radius after the
      // first resize() call (decoration sizing, etc.).
      applyRendertestCamera(sim, sim.W, sim.H);
      if (URL_OVERRIDES.download) {
        const cellType = URL_OVERRIDES.cellType || (sim.cells[0] && sim.cells[0].type) || 'unknown';
        const kindN = testKindFor(cellType);
        const theme = URL_OVERRIDES.theme || S.theme || 'legacy';
        const origin = 'game-' + ((renderer && renderer.info) || S.renderer || 'unknown');
        const suffix = URL_OVERRIDES.translucent ? '_translucent' : '';
        const filename = `${origin}_cell-${cellType}${kindN}_${theme}${suffix}.png`;
        takeScreenshot({ S, sim, renderer, filename, skipSidecar: true })
          .catch(err => console.warn('[rendertest] download failed:', err));
      }
      try { window.__RENDERTEST_READY__ = true; } catch {}
    });
  });
}
if (pauseBtn) {
  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPaused(!_paused);
  });
}
// Resume on ANY tap / click on the overlay (covers the whole
// viewport while shown). The overlay's pointer-events:auto only
// applies when .shown is set, so this listener doesn't fire when
// the sim is running.
if (pauseOverlay) {
  pauseOverlay.addEventListener('click', () => {
    if (_paused) setPaused(false);
  });
}
// Keyboard: Space resumes / pauses (symmetric toggle). Ignored
// when typing in an input — AND skipped when any dialog is open
// (settings / help / add / about). The latter prevents the
// stuck-pause bug: dialog z-index sits above the pause overlay,
// so a stray Space-press would silently pause the game with no
// way out except finding the bare overlay area.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const anyDialogOpen =
    (settingsEl && !settingsEl.classList.contains('hidden')) ||
    (helpDialog && !helpDialog.classList.contains('hidden')) ||
    (addDialog && !addDialog.classList.contains('hidden')) ||
    (aboutDialog && !aboutDialog.classList.contains('hidden'));
  if (anyDialogOpen) return;
  e.preventDefault();
  setPaused(!_paused);
});
// helpDialog now aliases addDialog (the unified dialog); the Set
// dedupes that so closeAll() doesn't iterate the same element twice.
const allDialogs = [...new Set([settingsEl, helpDialog, addDialog, aboutDialog,
  document.getElementById('applySettingsDialog')].filter(Boolean))];
const aboutBtn = document.getElementById('aboutBtn');
if (aboutBtn) aboutBtn.addEventListener('click', () => openOnly(aboutDialog));
const copyBuildBtn = document.getElementById('copyBuildBtn');
if (copyBuildBtn) copyBuildBtn.addEventListener('click', copyBuildSha);
// Screenshot helper — both a footer button AND a global so DevTools
// users can grab a frame without opening Settings. See
// assets/ui/screenshot.js for the dump format (PNG + JSON sidecar).
async function _screenshotNow() {
  try {
    const stamp = await takeScreenshot({ S, sim, renderer });
    showToast(T('toast_screenshot_saved') || `Screenshot saved (${stamp})`);
  } catch (err) {
    console.warn('[screenshot] failed:', err);
    showToast(T('toast_screenshot_failed') || 'Screenshot failed');
  }
}
const screenshotBtn = document.getElementById('screenshotBtn');
if (screenshotBtn) screenshotBtn.addEventListener('click', _screenshotNow);
if (typeof window !== 'undefined') window.__SCREENSHOT__ = _screenshotNow;

// Snapshot the live settings object S — which loadSettings()
// already merged with DEFAULTS, so every known setting is
// present. Reading raw localStorage here would miss any DEFAULTS
// keys added after the user last touched a slider, because
// saveSettings() only writes when a setting changes.
function _currentSettingsJson() {
  return JSON.stringify(S, null, 2);
}

// Copy: write the JSON to console + clipboard. Cheap roundtrip
// for sharing the active config in a bug report.
async function _copySettings() {
  try {
    const json = _currentSettingsJson();
    // eslint-disable-next-line no-console
    console.log('[settings] %s\n%s', SETTINGS_KEY, json);
    const ok = await copyToClipboard(json);
    showToast(ok
      ? (T('toast_settings_copied') || 'Settings copied to clipboard')
      : (T('toast_settings_dump_failed') || 'Copy failed'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[settings] copy failed:', err);
    showToast(T('toast_settings_dump_failed') || 'Copy failed');
  }
}

// Save: download the same JSON as a .json file. Filename includes
// the short build SHA + a timestamp so multiple dumps don't collide.
function _saveSettings() {
  try {
    const json = _currentSettingsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sha = (_currentBuildSha || 'dev').slice(0, 7);
    const a = document.createElement('a');
    a.href = url;
    a.download = `microbes-settings-${sha}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(T('toast_settings_saved') || 'Settings saved to file');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[settings] save failed:', err);
    showToast(T('toast_settings_dump_failed') || 'Save failed');
  }
}

// Apply: open the paste dialog so the user can paste a previously-
// saved JSON blob and load it back into the app.
const applySettingsDialog = document.getElementById('applySettingsDialog');
const applySettingsText   = document.getElementById('applySettingsText');
function _openApplySettingsDialog() {
  if (!applySettingsDialog || !applySettingsText) return;
  applySettingsText.value = '';
  openOnly(applySettingsDialog);
  setTimeout(() => applySettingsText.focus(), 0);
}

// Parse + persist the pasted JSON, then reload. The cleanest way
// to apply arbitrary settings to every UI binding is to write +
// reload — beats wiring per-setting hot-reload for the rare import
// path.
function _applyPastedSettings() {
  if (!applySettingsText) return;
  let parsed;
  try {
    parsed = JSON.parse(applySettingsText.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
  } catch {
    showToast(T('toast_settings_apply_failed') || 'Apply failed — paste was not valid JSON');
    return;
  }
  // Filter incoming keys to ones we recognise from DEFAULTS. An
  // older export blob might carry settings we've since renamed
  // (e.g. showObjectCount → showCellTotal); a newer one might
  // carry fields this build doesn't yet know about. Skip both
  // rather than corrupt S with surprises. loadSettings() will
  // then merge the filtered blob over DEFAULTS on reload, so
  // any setting we didn't include falls back to its default.
  const known = new Set(Object.keys(DEFAULTS));
  const filtered = {};
  const skipped = [];
  for (const k of Object.keys(parsed)) {
    if (known.has(k)) filtered[k] = parsed[k];
    else skipped.push(k);
  }
  if (skipped.length) {
    // eslint-disable-next-line no-console
    console.warn('[settings] apply: skipped unknown keys:', skipped);
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(filtered));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[settings] apply persist failed:', err);
    showToast(T('toast_settings_apply_failed') || 'Apply failed');
    return;
  }
  showToast(T('toast_settings_applied') || 'Settings applied — reloading');
  setTimeout(() => location.reload(), 400);
}

const copySettingsBtn         = document.getElementById('copySettingsBtn');
const saveSettingsBtn         = document.getElementById('saveSettingsBtn');
const applySettingsBtn        = document.getElementById('applySettingsBtn');
const applySettingsConfirmBtn = document.getElementById('applySettingsConfirmBtn');
if (copySettingsBtn)         copySettingsBtn.addEventListener('click', _copySettings);
if (saveSettingsBtn)         saveSettingsBtn.addEventListener('click', _saveSettings);
if (applySettingsBtn)        applySettingsBtn.addEventListener('click', _openApplySettingsDialog);
if (applySettingsConfirmBtn) applySettingsConfirmBtn.addEventListener('click', _applyPastedSettings);

_hookDebugLogButtons();

function openOnly(target) {
  for (const d of allDialogs) {
    if (d === target) d.classList.remove('hidden');
    else d.classList.add('hidden');
  }
  // Re-render the debug log when settings opens (renders are skipped
  // while hidden as a fast-path).
  if (target === settingsEl) _refreshDebugLog();
}
function closeAll() {
  for (const d of allDialogs) d.classList.add('hidden');
}

gearBtn.addEventListener('click', () => {
  settingsEl.classList.contains('hidden') ? openOnly(settingsEl) : closeAll();
});
// Render BOTH grids when the dialog opens (cells always, pathogens
// only when S.allowBadGuys). Also toggles the pathogens section
// title's visibility so the dialog stays clean when bad-guys are
// off.
function renderAddDialogContents() {
  renderPaletteGrid();
  const showBad = !!S.allowBadGuys;
  const pathGrid = document.getElementById('cellGridBad');
  if (pathGrid) pathGrid.hidden = !showBad;
  if (showBad) renderPaletteBadGrid();
  renderHelpList();   // populate the list view in the same dialog
}

// View-mode toggle (grid ↔ list) lives in the addDialog header. Both
// modes share the same dialog; CSS class on the dialog switches body
// visibility. Persist the mode in S.addDialogView; ?-FAB forces list.
function setAddDialogView(view) {
  const v = (view === 'list') ? 'list' : 'grid';
  S.addDialogView = v;
  saveSettings();
  addDialog.classList.toggle('is-view-grid', v === 'grid');
  addDialog.classList.toggle('is-view-list', v === 'list');
  for (const btn of addDialog.querySelectorAll('.view-toggle-btn')) {
    btn.setAttribute('aria-selected', String(btn.dataset.view === v));
  }
}
// Apply the saved view on boot + wire toggle clicks.
setAddDialogView(S.addDialogView);
for (const btn of addDialog.querySelectorAll('.view-toggle-btn')) {
  btn.addEventListener('click', () => setAddDialogView(btn.dataset.view));
}

if (paletteBtn) paletteBtn.addEventListener('click', () => {
  // The + FAB is now a sticky-mode toggle, peer to target / split
  // / kill. Three states drive the click handler:
  //   1. add-mode is on  → exit (toggle off). No dialog reopen.
  //   2. dialog is open  → close it (same as today's `else closeAll()`).
  //   3. neither         → open the dialog so the user can pick a type.
  if (sim.addMode) {
    cancelAddMode();
    return;
  }
  if (addDialog.classList.contains('hidden')) {
    renderAddDialogContents();
    openOnly(addDialog);
  } else closeAll();
});

// `paletteToHelp` / `paletteBadToHelp` are gone from the markup —
// the segmented view-toggle in the dialog header replaces them.

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
// Swipe-right-to-close: every dialog slides in from the right edge,
// so a horizontal rightward swipe is the natural dismiss gesture.
// Wired via pointer events for unified touch + mouse support.
//
// Filters:
//   * skip drags that start on an interactive control (range slider,
//     checkbox, select, button, textarea) so the gesture doesn't
//     hijack form interactions. Adjusting a slider stays a slider
//     adjustment; tapping a button stays a button tap.
//   * skip drags on the .overlay-order-row drag handles — they own
//     their own pointer-drag for re-ordering.
//   * skip drags on the SCROLLABLE pane while it's mid-scroll —
//     vertical scroll always wins; we only act when the gesture is
//     unambiguously horizontal (deltaX > deltaY * 1.5).
//
// Commit threshold + arming threshold:
//   * Arm once the pointer has moved > 16 px horizontally AND the
//     gesture is unambiguously horizontal (|dx| > |dy| * 1.3). At
//     that moment we grab pointer capture so subsequent moves all
//     route to us regardless of which inner element they cross,
//     and any post-gesture `click` on a control is suppressed.
//   * Commit (close the dialog) when the pointerup dx > 80 px.
//   * Below the arm threshold the gesture is treated as a normal
//     click / drag — sliders, checkboxes, scroll all still work.
const SWIPE_CLOSE_ARM_PX = 16;
const SWIPE_CLOSE_DX_PX = 80;
const SWIPE_CLOSE_DOMINANCE = 1.3;
function attachSwipeClose(dialogEl) {
  let startX = 0, startY = 0, pointerId = -1;
  let tracking = false;   // pointerdown was on a non-disqualifying surface
  let armed = false;      // gesture has crossed the horizontal-only threshold
  // Sliders rely on horizontal pointer drag for value adjustment —
  // hijacking those would break the control. The overlay-order
  // rows own a similar drag for re-ordering. Everything else
  // (selects, buttons, checkboxes, summary, hint text, label
  // text) can be the swipe origin because they don't react to
  // pointer DRAG, only to discrete clicks / changes.
  const blockedSel = 'input[type="range"], .overlay-order-row';
  dialogEl.addEventListener('pointerdown', (ev) => {
    armed = false;
    const t = ev.target;
    if (t && t.closest && t.closest(blockedSel)) {
      tracking = false;
      return;
    }
    startX = ev.clientX;
    startY = ev.clientY;
    pointerId = ev.pointerId;
    tracking = true;
  });
  dialogEl.addEventListener('pointermove', (ev) => {
    if (!tracking || armed) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) >= SWIPE_CLOSE_ARM_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_CLOSE_DOMINANCE) {
      armed = true;
      try { dialogEl.setPointerCapture(pointerId); } catch {}
    }
  });
  dialogEl.addEventListener('pointerup', (ev) => {
    if (!tracking) return;
    const wasArmed = armed;
    tracking = false;
    armed = false;
    try { dialogEl.releasePointerCapture(pointerId); } catch {}
    if (!wasArmed) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (dx > SWIPE_CLOSE_DX_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_CLOSE_DOMINANCE) {
      dialogEl.classList.add('hidden');
    }
  });
  dialogEl.addEventListener('pointercancel', () => {
    tracking = false;
    armed = false;
    try { dialogEl.releasePointerCapture(pointerId); } catch {}
  });
  // Once the gesture is armed, swallow the post-up click so a
  // long swipe across a checkbox / summary / button doesn't fire
  // their default action.
  dialogEl.addEventListener('click', (ev) => {
    if (armed) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);
}
for (const d of allDialogs) attachSwipeClose(d);
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

function bindRange(id, key, valId, fmt, onChange) {
  const el = document.getElementById(id);
  const out = valId ? document.getElementById(valId) : null;
  el.value = S[key];
  if (out) out.textContent = fmt(S[key]);
  if (onChange) onChange(S[key]);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    S[key] = v;
    if (out) out.textContent = fmt(v);
    saveSettings();
    if (onChange) onChange(v);
    if (key === 'autoSplitSeconds') {
      for (const c of sim.cells) {
        if (c.state === 'NORMAL' && c.splitTimer > S.autoSplitSeconds * 1.5) {
          c.splitTimer = sim.rollSplitTimer(c.type);
        }
      }
    }
  });
}
bindRange('autoSplitSeconds', 'autoSplitSeconds', 'autoVal', v => v.toFixed(0) + 's');
// maxCells uses a number input (not a slider) so users can type
// values directly. Validation: invalid → 512, otherwise clamp to
// [32, 4096]. Mirrors the loadSettings shim in state.js so a saved
// blob and a UI commit converge on the same value.
const maxCellsEl = document.getElementById('maxCells');
if (maxCellsEl) {
  maxCellsEl.value = S.maxCells;
  const applyMaxCells = (v) => {
    S.maxCells = v;
    maxCellsEl.value = v;
    saveSettings();
    // Lowering the cap mid-game should visibly shrink the population —
    // recycle (silent eviction) until cells.length <= cap. Without
    // this the input only blocks NEW spawns; existing cells stay
    // alive and the user can't tell the change had any effect.
    if (sim && sim.cells && sim.cells.length > v) {
      let removed = 0;
      while (sim.cells.length > v) {
        const before = sim.cells.length;
        sim._recycleOldest();
        if (sim.cells.length === before) break;
        removed++;
      }
      if (removed) console.info('[sim] maxCells', v, '— culled', removed);
    }
  };
  maxCellsEl.addEventListener('change', () => {
    const raw = maxCellsEl.value;
    const parsed = (raw === '' || raw == null) ? NaN : Number(raw);
    let v;
    if (!Number.isFinite(parsed)) {
      v = 512;
    } else {
      v = Math.max(32, Math.min(4096, Math.round(parsed)));
    }
    applyMaxCells(v);
  });
}
bindRange('bgFlowSpeed', 'bgFlowSpeed', 'bgVal', v => v.toFixed(2) + '×');
bindRange('bgScale', 'bgScale', 'bgScaleVal', v => v.toFixed(2) + '×');
// Tissue source-image scale. Canvas2D-only effect: the renderer
// pre-downsamples the decoded image to `tissueScale × naturalSize`
// before createPattern, reducing per-frame GPU/CPU sampling cost
// at the cost of softer tile edges. Slider is hidden on
// webgl2 / webgpu via body[data-renderer] CSS (the bg pass on
// those samples the original mipmapped texture directly). Switching
// the slider invalidates the renderer's tissue cache by URL key, so
// the next frame triggers a fresh load + downsample at the new
// scale; see canvas2d.js _tissuePatternFor.
bindRange('tissueScale', 'tissueScale', 'tissueScaleVal',
          v => Math.round(v * 100) + '%',
          () => { if (renderer && renderer._tissuePatternCache) renderer._tissuePatternCache.clear(); });
bindRange('outlinePx', 'outlinePx', 'outVal', v => v.toFixed(0) + 'px');
bindRange('membraneIntensity', 'membraneIntensity', 'membraneVal', v => v.toFixed(2));
bindRange('cellBorderThickness', 'cellBorderThickness', 'cellBorderVal', v => v.toFixed(1) + '×');
// Global line-thickness multiplier — scales antibody stroke width
// (canvas2d), cell outline lineWidth (canvas2d), and the GPU
// border-shader uniform (webgl2 / webgpu). GPU antibody Y's are
// `line-list` topology with no thickness control, so the slider
// is a no-op there. See state.js DEFAULTS.lineThickness.
bindRange('lineThickness', 'lineThickness', 'lineThicknessVal', v => v.toFixed(1) + '×');
bindRange('cellSizeMul', 'cellSizeMul', 'cellSizeVal', v => v.toFixed(2) + '×');
bindRange('faceScale', 'faceScale', 'faceScaleVal', v => v.toFixed(2) + '×');
bindRange('friction', 'friction', 'frictionVal', v => v.toFixed(2));
bindRange('bounce', 'bounce', 'bounceVal', v => v.toFixed(2));
bindRange('throwStrength', 'throwStrength', 'throwVal', v => v.toFixed(2) + '×');
bindRange('wobbleAmp', 'wobbleAmp', 'wobbleVal', v => v.toFixed(2));
bindCheckbox('bumpFeedback', 'bumpFeedback');
bindRange('bumpFeedbackIntensity', 'bumpFeedbackIntensity', 'bumpFeedbackIntensityVal', v => v.toFixed(1) + '×');
bindRange('bumpAttack', 'bumpAttack', 'bumpAttackVal', v => (v * 1000).toFixed(0) + ' ms');
bindRange('bumpDuration', 'bumpDuration', 'bumpDurationVal', v => v.toFixed(2) + ' s');

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
const modeKillBtn   = document.getElementById('modeKill');
function applyModeUi() {
  const kill = !!sim.killMode;
  const add  = !!sim.addMode;
  // Add-mode takes priority: when it's on, the other three peers
  // drop their .active ring so only the `+` FAB lights up.
  if (modeKillBtn)   modeKillBtn.classList.toggle('active',   kill && !add);
  if (modeTargetBtn) modeTargetBtn.classList.toggle('active', !kill && !S.splitOnTap && !add);
  if (modeSplitBtn)  modeSplitBtn.classList.toggle('active',  !kill &&  !!S.splitOnTap && !add);
  if (paletteBtn)    paletteBtn.classList.toggle('active',    add);
}
function setSplitOnTap(on) {
  S.splitOnTap = !!on;
  sim.killMode = false;
  // Picking split / kill drops add-mode too (the four FABs are a
  // single mutually-exclusive set).
  if (on && sim.addMode) cancelAddMode();
  saveSettings();
  applyModeUi();
  const cb = document.getElementById('splitOnTap');
  if (cb) cb.checked = S.splitOnTap;
}
function setKillMode(on) {
  sim.killMode = !!on;
  if (on && sim.addMode) cancelAddMode();
  applyModeUi();
}
if (modeTargetBtn) modeTargetBtn.addEventListener('click', () => {
  // Pressing target while already in target mode is a "clear selection"
  // gesture: drops any selected cells and the active target marker.
  if (!sim.killMode && !S.splitOnTap) {
    sim.selectedCells.clear();
    sim.targetMarker = null;
    return;
  }
  setKillMode(false);
  setSplitOnTap(false);
});
if (modeSplitBtn)  modeSplitBtn.addEventListener('click',  () => setSplitOnTap(true));
if (modeKillBtn)   modeKillBtn.addEventListener('click',   () => {
  // Toggle: pressing kill while already active drops back to target mode.
  setKillMode(!sim.killMode);
});
// splitOnTap: settings checkbox removed late 2026; the HUD "Split"
// mode button at modeSplit still toggles S.splitOnTap via setSplitOnTap.
applyModeUi();
bindCheckbox('pinchRotation', 'pinchRotation', (on) => {
  // Disabling the gesture mid-session shouldn't strand the camera in
  // a rotated state — snap back to upright and end any in-flight pinch.
  if (!on) {
    sim.camera.rotation = 0;
    sim.pinch = null;
  }
});
// Settings dialog accordion: when one `<details class="settings-section">`
// opens, close the others. Default on; the user can disable to fall
// back to free-form multi-open. We listen at the panel root via
// event delegation so newly-added sections inherit the behaviour
// automatically. The handler short-circuits when the toggle is off
// AND when the just-fired event is a CLOSE (open=false) — only
// opening a section should collapse its siblings.
bindCheckbox('settingsAccordion', 'settingsAccordion');
(function wireSettingsAccordion() {
  const panel = document.querySelector('#settings .settings-panel');
  if (!panel) return;
  panel.addEventListener('toggle', (ev) => {
    if (!S.settingsAccordion) return;
    const t = ev.target;
    if (!(t instanceof HTMLDetailsElement)) return;
    if (!t.classList.contains('settings-section')) return;
    if (!t.open) return;
    const others = panel.querySelectorAll('details.settings-section');
    for (const d of others) {
      if (d !== t && d.open) d.open = false;
    }
  }, true);   // capture: the `toggle` event doesn't bubble
})();
bindCheckbox('randomSplit', 'randomSplit');
bindCheckbox('metaSplit', 'metaSplit');
// Game mode. Today the simulator IS Free Game (docs/ch04-konzept.md
// §4.3); 'campaign' and 'survival' are reserved for future modes and
// the dropdown shows them as disabled "(soon)" entries. Selecting an
// unknown / disabled value is a no-op — the schema is forward-only.
const gameModeSel = document.getElementById('gameMode');
if (gameModeSel) {
  gameModeSel.value = S.gameMode || 'free';
  gameModeSel.addEventListener('change', () => {
    const v = gameModeSel.value;
    if (v !== 'free') { gameModeSel.value = S.gameMode || 'free'; return; }
    if (v === S.gameMode) return;
    S.gameMode = v;
    saveSettings();
  });
}

const metaRtModeSel = document.getElementById('metaRtMode');
if (metaRtModeSel) {
  metaRtModeSel.value = S.metaRtMode || 'bbox';
  metaRtModeSel.addEventListener('change', () => {
    const v = metaRtModeSel.value;
    if (v !== 'bbox' && v !== 'fullCanvas' && v !== 'sharedMax') return;
    if (v === S.metaRtMode) return;
    S.metaRtMode = v;
    saveSettings();
  });
}
const metaOutlineModeSel = document.getElementById('metaOutlineMode');
if (metaOutlineModeSel) {
  metaOutlineModeSel.value = S.metaOutlineMode || 'edge';
  metaOutlineModeSel.addEventListener('change', () => {
    const v = metaOutlineModeSel.value;
    if (v !== 'edge' && v !== 'sdf' && v !== 'polygon') return;
    if (v === S.metaOutlineMode) return;
    S.metaOutlineMode = v;
    saveSettings();
  });
}
bindCheckbox('cartoon', 'cartoon');
// HUD reacts within the next 250 ms throttle window, fast enough.
bindCheckbox('compositionHud', 'compositionHud');

// Caustics-overlay toggle. Renderer reads S.causticsOverlay each
// frame inside drawBackground; no listener hook needed — the next
// rAF picks up the new value.
const causticsControlsEl = document.getElementById('causticsControls');
function applyCausticsControlsVis() {
  if (causticsControlsEl) causticsControlsEl.hidden = !S.causticsOverlay;
}
// Toggle now lives in the unified overlay list (renderOverlayOrderList);
// applyCausticsControlsVis still runs on first mount + on each toggle.
applyCausticsControlsVis();
// RGB tint sliders feed straight into the caustic shader uniform on
// the next rAF — the renderer reads S.causticTintR/G/B each frame.
bindRange('causticTintR', 'causticTintR', 'causticTintRVal', v => v.toFixed(2));
bindRange('causticTintG', 'causticTintG', 'causticTintGVal', v => v.toFixed(2));
bindRange('causticTintB', 'causticTintB', 'causticTintBVal', v => v.toFixed(2));

// Liquid-ripples toggle. Same per-frame read pattern as caustics;
// the renderer redirects the bg pass through a ripple post-process
// that distorts the bg around each on-screen cell.
const rippleControlsEl = document.getElementById('rippleControls');
function applyRippleControlsVis() {
  if (rippleControlsEl) rippleControlsEl.hidden = !S.liquidRipples;
}
// Toggle now lives in the unified overlay list.
applyRippleControlsVis();

// Ripple sub-controls — feed straight into the renderer's per-frame
// uniform pack on the next rAF, so no listener hook is needed beyond
// the value-label sync that bindRange handles. Wave scope used to
// be its own <select>; it's now derived from the ripples row's
// position relative to the scene pin in the unified overlay list.
bindRange('rippleDensity',  'rippleDensity',  'rippleDensityVal',  v => v.toFixed(1) + '×');
bindRange('rippleReach',    'rippleReach',    'rippleReachVal',    v => v.toFixed(1) + '×');
bindRange('rippleStrength', 'rippleStrength', 'rippleStrengthVal', v => v.toFixed(1) + '×');

// Glass-membrane overlay — mirrors the ripples wiring above. The
// per-frame uniform pack lives inside the renderer; the controls
// block hides itself when the overlay is off.
const glassControlsEl = document.getElementById('glassControls');
function applyGlassControlsVis() {
  if (glassControlsEl) glassControlsEl.hidden = !S.glassMembrane;
}
applyGlassControlsVis();
bindRange('glassStrength', 'glassStrength', 'glassStrengthVal', v => v.toFixed(1) + '×');
bindRange('glassSize',     'glassSize',     'glassSizeVal',     v => v.toFixed(1) + '×');
bindCheckbox('glassChroma', 'glassChroma');

// Static-noise overlay. Renderer reads S.staticNoise* each frame
// inside the post-pass, so the sliders + blend dropdown just
// persist to settings — no per-change handler needed.
const staticNoiseControlsEl = document.getElementById('staticNoiseControls');
function applyStaticNoiseVis() {
  if (staticNoiseControlsEl) staticNoiseControlsEl.hidden = !S.staticNoise;
}
// Toggle now lives in the unified overlay list.
applyStaticNoiseVis();
bindRange('staticNoiseIntensity', 'staticNoiseIntensity', 'staticNoiseIntensityVal', v => v.toFixed(2));
const staticNoiseBlendEl = document.getElementById('staticNoiseBlend');
if (staticNoiseBlendEl) {
  staticNoiseBlendEl.value = S.staticNoiseBlend || 'additive';
  staticNoiseBlendEl.addEventListener('change', () => {
    S.staticNoiseBlend = staticNoiseBlendEl.value;
    saveSettings();
  });
}

// Vignette overlay (microscope-style blue tint at corners).
const vignetteControlsEl = document.getElementById('vignetteControls');
function applyVignetteVis() {
  if (vignetteControlsEl) vignetteControlsEl.hidden = !S.vignette;
}
// Toggle now lives in the unified overlay list.
applyVignetteVis();
bindRange('vignetteIntensity', 'vignetteIntensity', 'vignetteIntensityVal', v => v.toFixed(2));
const vignetteBlendEl = document.getElementById('vignetteBlend');
if (vignetteBlendEl) {
  vignetteBlendEl.value = S.vignetteBlend || 'additive';
  vignetteBlendEl.addEventListener('change', () => {
    S.vignetteBlend = vignetteBlendEl.value;
    saveSettings();
  });
}

// Crosshair overlay — toggle lives in the unified overlay list.

// Unified overlay-stack list: every overlay (FX blends + FBO passes +
// the cell-type HTML overlay) is one row containing a drag handle, a
// checkbox bound to its toggle, the i18n label, and ▲/▼ buttons. The
// 'scene' entry renders as a fixed dashed pin — not draggable, no
// checkbox — marking where the cell pass runs in the stack. Renderers
// read overlayFxOrder() + overlayKindRunsAfterScene() each frame so
// reorders + toggles take effect on the next draw with no pipeline
// reset needed.
const overlayOrderListEl = document.getElementById('overlayOrderList');
const OVERLAY_KIND_META = {
  duotone:    { stateField: 'makeItReal',      labelKey: 'overlay_kind_duotone',    subId: 'makeItRealControls',     onChange: () => applyMakeItRealVis() },
  noise:      { stateField: 'staticNoise',     labelKey: 'overlay_kind_noise',      subId: 'staticNoiseControls',    onChange: () => applyStaticNoiseVis() },
  vignette:   { stateField: 'vignette',        labelKey: 'overlay_kind_vignette',   subId: 'vignetteControls',       onChange: () => applyVignetteVis() },
  crosshair:  { stateField: 'crosshair',       labelKey: 'overlay_kind_crosshair',  subId: null,                     onChange: () => {} },
  microscope: { stateField: 'microscopeBlur',  labelKey: 'overlay_kind_microscope', subId: 'microscopeBlurControls', onChange: () => applyMicroscopeBlurVis() },
  caustics:   { stateField: 'causticsOverlay', labelKey: 'overlay_kind_caustics',   subId: 'causticsControls',       onChange: () => applyCausticsControlsVis() },
  celltype:   { stateField: 'cellTypeOverlay', labelKey: 'overlay_kind_celltype',   subId: null,                     onChange: () => {
    // Keep the eye-FAB's aria-pressed in sync with the list checkbox.
    if (eyeBtn) eyeBtn.setAttribute('aria-pressed', String(!!S.cellTypeOverlay));
  } },
  ripples:    { stateField: 'liquidRipples',   labelKey: 'overlay_kind_ripples',    subId: 'rippleControls',         onChange: () => applyRippleControlsVis() },
  glass:      { stateField: 'glassMembrane',   labelKey: 'overlay_kind_glass',      subId: 'glassControls',          onChange: () => applyGlassControlsVis() },
};
let _overlayDragFromIndex = -1;
function renderOverlayOrderList() {
  if (!overlayOrderListEl) return;
  overlayOrderListEl.innerHTML = '';
  const order = Array.isArray(S.overlayOrder) ? S.overlayOrder : [];
  order.forEach((kind, index) => {
    if (kind === 'scene') {
      const row = document.createElement('div');
      row.className = 'overlay-order-row scene-pin';
      row.dataset.index = String(index);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = T('overlay_pin_scene') || '— scene —';
      row.appendChild(label);
      overlayOrderListEl.appendChild(row);
      return;
    }
    const meta = OVERLAY_KIND_META[kind];
    if (!meta) return;
    const row = document.createElement('div');
    row.className = 'overlay-order-row';
    row.draggable = true;
    row.dataset.index = String(index);

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '☰';
    handle.title = T('fx_drag_reorder') || 'Drag to reorder';
    row.appendChild(handle);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'row-checkbox';
    cb.checked = !!S[meta.stateField];
    cb.addEventListener('change', () => {
      S[meta.stateField] = cb.checked;
      saveSettings();
      meta.onChange();
    });
    row.appendChild(cb);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = T(meta.labelKey) || kind;
    row.appendChild(label);

    const up = document.createElement('button');
    up.type = 'button'; up.className = 'move-btn'; up.textContent = '▲';
    up.title = T('fx_move_up') || 'Move up';
    up.disabled = index === 0;
    up.addEventListener('click', () => moveOverlayOrder(index, index - 1));
    row.appendChild(up);

    const down = document.createElement('button');
    down.type = 'button'; down.className = 'move-btn'; down.textContent = '▼';
    down.title = T('fx_move_down') || 'Move down';
    down.disabled = index === order.length - 1;
    down.addEventListener('click', () => moveOverlayOrder(index, index + 1));
    row.appendChild(down);

    row.addEventListener('dragstart', (e) => {
      _overlayDragFromIndex = index;
      row.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', String(index)); } catch {}
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      _overlayDragFromIndex = -1;
      document.querySelectorAll('.overlay-order-row.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (_overlayDragFromIndex < 0 || _overlayDragFromIndex === index) return;
      moveOverlayOrder(_overlayDragFromIndex, index);
    });

    overlayOrderListEl.appendChild(row);
    // Inline sub-controls: move the existing slider/blend block (if
    // any) from wherever it lives in the DOM to directly under this
    // row. We move the same node each time so the bindRange-attached
    // event listeners survive the relocation. The block stays
    // `hidden` until its overlay is enabled (apply*ControlsVis).
    if (meta.subId) {
      const sub = document.getElementById(meta.subId);
      if (sub) overlayOrderListEl.appendChild(sub);
    }
  });
}
function moveOverlayOrder(from, to) {
  if (!Array.isArray(S.overlayOrder)) return;
  if (from < 0 || from >= S.overlayOrder.length) return;
  if (to < 0 || to >= S.overlayOrder.length) return;
  if (from === to) return;
  const moved = S.overlayOrder.splice(from, 1)[0];
  S.overlayOrder.splice(to, 0, moved);
  saveSettings();
  renderOverlayOrderList();
}
renderOverlayOrderList();

// Microscope blur — scene-wide variable-radius blur. Same pattern as
// the caustics / ripples / staticNoise sections: toggle reveals a
// sub-controls block; sliders persist to S without per-change side
// effects (the renderer reads S each frame).
const microscopeBlurControlsEl = document.getElementById('microscopeBlurControls');
function applyMicroscopeBlurVis() {
  if (microscopeBlurControlsEl) microscopeBlurControlsEl.hidden = !S.microscopeBlur;
}
// Toggle now lives in the unified overlay list.
applyMicroscopeBlurVis();
bindRange('microscopeFocus',         'microscopeFocus',         'microscopeFocusVal',         v => v.toFixed(2));
bindRange('microscopeBlurStrength',  'microscopeBlurStrength',  'microscopeBlurStrengthVal',  v => v.toFixed(2));
bindRange('microscopeFalloff',       'microscopeFalloff',       'microscopeFalloffVal',       v => v.toFixed(2));

// "Make it real" microscope-photo color grade — duotone gradient
// (shadow hue → highlight hue) with a saturation knob.
const makeItRealControlsEl = document.getElementById('makeItRealControls');
function applyMakeItRealVis() {
  if (makeItRealControlsEl) makeItRealControlsEl.hidden = !S.makeItReal;
}
// Toggle now lives in the unified overlay list.
applyMakeItRealVis();
bindRange('makeItRealHue1',       'makeItRealHue1',       'makeItRealHue1Val',       v => v.toFixed(2));
bindRange('makeItRealHue2',       'makeItRealHue2',       'makeItRealHue2Val',       v => v.toFixed(2));
bindRange('makeItRealSaturation', 'makeItRealSaturation', 'makeItRealSaturationVal', v => v.toFixed(2));

// Fullscreen toggle. Browsers REQUIRE a user gesture to enter
// fullscreen, so this can't be a saved-and-restored S.* setting —
// we only react to the user's click. The checkbox state is kept
// in sync with the actual fullscreen status via the
// `fullscreenchange` event so e.g. ESC-out updates the box.
{
  const fsBox = document.getElementById('fullscreenToggle');
  if (fsBox) {
    const target = document.documentElement;
    const isOn  = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const enter = () => target.requestFullscreen?.() || target.webkitRequestFullscreen?.();
    const exit  = () => document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    fsBox.checked = isOn();
    fsBox.addEventListener('change', () => {
      const want = fsBox.checked;
      const p = want ? enter() : exit();
      // If the request rejects (e.g. browser blocks), revert the
      // checkbox to the actual state on the next tick.
      Promise.resolve(p).catch(() => { fsBox.checked = isOn(); });
    });
    document.addEventListener('fullscreenchange',       () => { fsBox.checked = isOn(); });
    document.addEventListener('webkitfullscreenchange', () => { fsBox.checked = isOn(); });
  }
}

// ----- Audio: music + SFX volume sliders, music on/off + next track -----
// Spatial-audio volume curve per user spec:
//   on-screen        → 100 %
//   just off-screen  → 80 %   (20 % quieter)
//   far off-screen   → 40 %   (60 % quieter at extreme distance)
// Smooth curve so density of events doesn't cliff at the viewport
// edge. `distScreens` = screen-widths-from-viewport-edge (0 = inside
// viewport, 1 = one screen away, etc.).
// Stereo pan: −1 (full left) … +1 (full right). Linear map from
// the event's normalised screen-x offset relative to viewport
// centre, clamped to [−1, +1]. Off-screen events get the saturating
// edge values, which feels natural ("over there").
function sfxSpatialPan(x, y) {
  const s = sim.worldToScreen(x, y);
  const cx = sim.W * 0.5;
  return Math.max(-1, Math.min(1, (s.x - cx) / Math.max(1, cx)));
}
function sfxSpatialScale(x, y) {
  if (inView(x, y, 0, sim.camera, sim.W, sim.H)) return 1.0;
  // Distance from viewport centre in screen-width units.
  const s = sim.worldToScreen(x, y);
  const cx = sim.W * 0.5, cy = sim.H * 0.5;
  const halfW = sim.W * 0.5, halfH = sim.H * 0.5;
  // 0 at viewport edge, 1 at one screen-radius beyond, …
  const dxN = Math.max(0, (Math.abs(s.x - cx) - halfW) / Math.max(1, halfW));
  const dyN = Math.max(0, (Math.abs(s.y - cy) - halfH) / Math.max(1, halfH));
  const d = Math.hypot(dxN, dyN);
  // Smooth interpolation: 0 → 0.80, ≥1.5 → 0.40, smoothstep in between.
  const t = Math.max(0, Math.min(1, d / 1.5));
  const eased = t * t * (3 - 2 * t);
  return 0.80 - 0.40 * eased;
}
// Legacy constant — kept for the antibody handler that wasn't ported
// to the curve yet; treated as the curve's edge value (just-off).
const SFX_OFFSCREEN_SCALE = 0.8;

Promise.all([import('./core/music.js'), import('./core/sfx.js')]).then(([{ MusicPlayer }, { SfxPlayer }]) => {
  const player = new MusicPlayer();
  player.setVolume(S.musicVolume);
  // Music plays when the dedicated toggle is on AND the volume isn't
  // 0 AND the game isn't paused. The toggle defaults to off so the
  // page loads silent — autoplay policies would block playback even
  // if it were on, but explicit-off is the clearer UX.
  _musicPlayer = player;
  player.setEnabled(_musicShouldPlay());

  const sfx = new SfxPlayer();
  sfx.setVolume(S.sfxVolume);

  // Browser autoplay policies: a play() before any user gesture
  // gets rejected. Hook the very next pointerdown to retry the
  // music start. SFX cloning has the same restriction, but each
  // clone is its own play() — they recover automatically once the
  // user has clicked once.
  document.addEventListener('pointerdown', () => player.retryIfPending(), { once: false });

  // "Now playing" line in settings — updates on every next() + the
  // first setEnabled(true).
  const trackLabelEl = document.getElementById('musicTrackLabel');
  function setTrackLabel(label) {
    if (trackLabelEl) trackLabelEl.textContent = label || '—';
  }
  player.onTrackChange = setTrackLabel;
  setTrackLabel(player.getCurrentLabel());

  bindRange('musicVolume', 'musicVolume', 'musicVolumeVal', v => Math.round(v * 100) + '%');
  bindRange('sfxVolume',   'sfxVolume',   'sfxVolumeVal',   v => Math.round(v * 100) + '%');
  // Music master toggle. Persisted via bindCheckbox (writes S.musicEnabled
  // + saveSettings); explicit change listener re-evaluates the player's
  // enabled state without depending on bindCheckbox's emit order.
  bindCheckbox('musicEnabled', 'musicEnabled');
  const musicEnabledEl = document.getElementById('musicEnabled');
  if (musicEnabledEl) musicEnabledEl.addEventListener('change', () => {
    player.setEnabled(_musicShouldPlay());
  });
  const musicVolEl = document.getElementById('musicVolume');
  if (musicVolEl) musicVolEl.addEventListener('input', () => {
    const v = parseFloat(musicVolEl.value);
    player.setVolume(v);
    // Crossing zero re-arms / silences the player.
    player.setEnabled(_musicShouldPlay());
  });
  const sfxVolEl = document.getElementById('sfxVolume');
  if (sfxVolEl) sfxVolEl.addEventListener('input', () => sfx.setVolume(parseFloat(sfxVolEl.value)));
  const nextBtn = document.getElementById('musicNext');
  if (nextBtn) nextBtn.addEventListener('click', () => player.next());

  // Window focus / visibility — auto-pause the sim + mute music when
  // the tab loses focus or the page is hidden (alt-tab on desktop,
  // home-screen / app-switch on mobile). Auto-resume on return.
  // Uses the dedicated `setAutoPaused` helper so the PAUSE overlay
  // doesn't show — the user didn't ask to pause, the OS did, so
  // we silently freeze + restore without their intervention.
  //
  // Listening to all three events is belt-and-braces:
  //   * `visibilitychange` — most reliable on mobile (tab hidden,
  //     app backgrounded). Document.hidden is the source of truth.
  //   * `blur` — desktop window focus lost (e.g. cmd-tab). Doesn't
  //     fire on every mobile browser, so we still need the above.
  //   * `focus` — desktop window focus restored. Mobile typically
  //     fires `visibilitychange` too, so this is mainly desktop.
  function _syncAutoPauseFromVisibility() {
    setAutoPaused(document.hidden);
  }
  document.addEventListener('visibilitychange', _syncAutoPauseFromVisibility);
  window.addEventListener('blur',  () => setAutoPaused(true));
  window.addEventListener('focus', () => setAutoPaused(false));
  // Seed from whatever the document's current visibility is — in
  // case we boot inside a backgrounded tab.
  _syncAutoPauseFromVisibility();

  // Floating combat text — sim emits {x, y, text, kind} on damage
  // (kind:'damage', "-N") and on fresh activation (kind:'activate',
  // "+1"). The manager owns its own DOM nodes inside #floatingText
  // and gets ticked + rendered from the per-frame loop.
  sim.onFloatingText = (e) => floatingText.push(e);

  // Antibody fire SFX. Spatial volume curve × 0.5 master scale
  // (b-cell sound was too loud; user spec 50% quieter). Stereo
  // pan from event's screen-x position.
  sim.onAntibodyEmit = (owner /*, target */) => {
    sfx.play('antibody', {
      volumeScale: sfxSpatialScale(owner.x, owner.y) * 0.5,
      pan: sfxSpatialPan(owner.x, owner.y),
    });
  };

  sim.onSplit = (e) => {
    sfx.play('split', {
      volumeScale: sfxSpatialScale(e.x, e.y),
      pan: sfxSpatialPan(e.x, e.y),
    });
  };

  sim.onDamage = (e) => {
    let name = null;
    if (e.type === 'virus') name = 'virusHit';
    if (!name) return;
    sfx.play(name, {
      volumeScale: sfxSpatialScale(e.x, e.y),
      pan: sfxSpatialPan(e.x, e.y),
    });
  };

  sim.onKill = (e) => {
    sfx.play('death', {
      volumeScale: sfxSpatialScale(e.x, e.y),
      pan: sfxSpatialPan(e.x, e.y),
    });
  };
}).catch((err) => {
  console.warn('Audio modules failed to load:', err);
});
// FPS toggle gates the whole overlay (fps number + renderer label).
// When off, nothing shows; when on, "15fps (webgpu)" — renderer
// always comes along for the ride.
bindCheckbox('showFPS', 'showFPS', (on) => {
  const el = document.getElementById('fps');
  if (el) el.classList.toggle('on', !!on);
});
function applyBuildInfoVis(on) {
  const el = document.getElementById('build');
  if (el) el.classList.toggle('on', !!on);
  document.body.classList.toggle('show-build', !!on);
}
bindCheckbox('showBuildInfo', 'showBuildInfo', applyBuildInfoVis);
applyBuildInfoVis(S.showBuildInfo);
// Cell total rides on the FPS overlay's visibility. The checkbox
// only persists the toggle; updateFPS reads S.showCellTotal each
// throttled tick and appends "· N cells" to the line when on.
// With the FPS overlay hidden, the count is hidden too.
bindCheckbox('showCellTotal', 'showCellTotal');
// Off-screen navigation arrows: unified 4-way select. 'none' = hidden;
// 'fixed' = 4 fixed-edge aggregate arrows (the original look);
// 'anchored' = per-cell arrows sliding along the screen edge with
// greedy 1D clustering; 'circular' = arrows on a ring just outside the
// microscope focus circle, one per off-screen cell. NavArrows.update
// reads S.navMode directly and short-circuits on 'none'.
const navModeSel = document.getElementById('navMode');
const NAV_MODE_VALUES = ['none', 'fixed', 'anchored', 'circular'];
if (navModeSel) {
  navModeSel.value = S.navMode;
  navModeSel.addEventListener('change', () => {
    if (NAV_MODE_VALUES.includes(navModeSel.value)) {
      S.navMode = navModeSel.value;
      saveSettings();
    }
  });
}

// splitMode radios removed from settings late 2026; field still
// honoured by sim.js (default 'bondDrift' from DEFAULTS).

const dbg = document.getElementById('showDebugField');
if (dbg) {
  dbg.checked = S.showDebugField;
  dbg.addEventListener('change', () => {
    S.showDebugField = dbg.checked;
    saveSettings();
  });
}

function applyThemeToCss(accent) {
  document.documentElement.style.setProperty('--accent', accent.accent);
  document.documentElement.style.setProperty('--accent-ink', accent.accentInk);
}

// Interface-colour accent dropdown. Reads from the new
// INTERFACE_ACCENTS table (separate from scene-render THEMES).
const interfaceColorSelect = document.getElementById('interfaceColorSelect');
for (const [key, a] of Object.entries(INTERFACE_ACCENTS)) {
  const opt = document.createElement('option');
  opt.value = key;
  // Localised name; English `a.label` is the safety net.
  opt.textContent = T('ic_' + key) || a.label;
  interfaceColorSelect.appendChild(opt);
}
interfaceColorSelect.value = S.interfaceColor in INTERFACE_ACCENTS ? S.interfaceColor : 'pink';
applyThemeToCss(currentInterfaceColor());
interfaceColorSelect.addEventListener('change', () => {
  if (INTERFACE_ACCENTS[interfaceColorSelect.value]) {
    S.interfaceColor = interfaceColorSelect.value;
    saveSettings();
    applyThemeToCss(currentInterfaceColor());
  }
});

// Cell-shader theme dropdown (the new S.theme). Five options:
// legacy / microscope / cartoon / kurzgesagt / classic. Per-frame
// uniform read in webgl2.js + webgpu.js disk shaders; canvas2d
// stays in legacy regardless of S.theme.
// Two theme dropdowns now exist: the original in the settings
// panel (themeSelect) and a copy inside the merged add-dialog
// (themeSelectInline). Both write to S.theme and mirror each
// other via change events so picking from one updates both.
const themeSelect = document.getElementById('themeSelect');
const themeSelectInline = document.getElementById('themeSelectInline');
const themeOpts = ['legacy','microscope','cartoon','kurzgesagt','classic'];
function setTheme(v) {
  S.theme = themeOpts.includes(v) ? v : 'legacy';
  if (themeSelect)       themeSelect.value       = S.theme;
  if (themeSelectInline) themeSelectInline.value = S.theme;
  saveSettings();
}
if (themeSelect) {
  themeSelect.value = themeOpts.includes(S.theme) ? S.theme : 'legacy';
  themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
}
if (themeSelectInline) {
  themeSelectInline.value = themeOpts.includes(S.theme) ? S.theme : 'legacy';
  themeSelectInline.addEventListener('change', () => setTheme(themeSelectInline.value));
}

function bgAccent(b) {
  if (Array.isArray(b.spotColors) && b.spotColors[0]) return b.spotColors[0];
  return b.spotColor || b.botColor || b.topColor || b.base || '';
}

// Two background dropdowns: the original in settings + a copy in
// the merged add-dialog. Same mirror pattern as the theme select.
const bgSelect = document.getElementById('bgSelect');
const bgSelectInline = document.getElementById('bgSelectInline');
function populateBgSelect(el) {
  if (!el) return;
  for (const [key, b] of Object.entries(BACKGROUNDS)) {
    const opt = document.createElement('option');
    opt.value = key;
    // Localised label per BG; the colour-in-parens lives inside the
    // i18n string (e.g. "Bloodstream (crimson)" / "Blutstrom (Karmin)")
    // so the dropdown shows ONE colour token, not two stacked.
    opt.textContent = T('bg_' + key) || b.label || key;
    el.appendChild(opt);
  }
  el.value = (S.background in BACKGROUNDS) ? S.background : (S.interfaceColor in BACKGROUNDS ? S.interfaceColor : 'solid');
}
populateBgSelect(bgSelect);
populateBgSelect(bgSelectInline);
// Picking a preset REPLACES S.bgLayers with a single-layer
// derivation of that preset. The legacy S.background string is kept
// in sync because some code paths still read it (interface-accent
// fallbacks, themes that reference bg.label, the no-bgLayers
// fallback in currentBgLayers()). Multi-layer composition was
// removed — only one shader at a time now.
function setBackground(v) {
  if (!BACKGROUNDS[v]) return;
  S.background = v;
  S.bgLayers = bgLayersFromPreset(v);
  if (bgSelect)       bgSelect.value       = v;
  if (bgSelectInline) bgSelectInline.value = v;
  saveSettings();
  renderBgConfig();
}
if (bgSelect)       bgSelect.addEventListener('change',       () => setBackground(bgSelect.value));
if (bgSelectInline) bgSelectInline.addEventListener('change', () => setBackground(bgSelectInline.value));

// ── Background config (single-shader; per-kind sliders + pickers) ──
// Single-layer model. Renders a small set of editable controls under
// the bg dropdown based on what fields the current bg blob uses
// (base / topColor / botColor / spotColor + ringColor + gridColor
// pickers; spotCount + vignette + gridStep sliders). Uses the HSV
// gamut popover from assets/ui/color-picker.js for colour fields.
const bgConfigEl = document.getElementById('bgConfig');

function ensureBgLayersPopulated() {
  if (!Array.isArray(S.bgLayers) || S.bgLayers.length === 0) {
    S.bgLayers = bgLayersFromPreset(S.background || 'solid');
    saveSettings();
  }
}

function renderBgConfig() {
  if (!bgConfigEl) return;
  ensureBgLayersPopulated();
  bgConfigEl.innerHTML = '';
  const layer = S.bgLayers[0];

  const addColor = (key, labelKey, fallback) => {
    if (typeof layer[key] !== 'string') return;
    const v = String(layer[key]);
    const isHex = /^#[0-9a-fA-F]{6}$/.test(v);
    const isRgba = /^rgba?\(/i.test(v);
    if (!isHex && !isRgba) return;
    const row = document.createElement('label');
    row.className = 'bg-config-row';
    const span = document.createElement('span');
    span.textContent = T(labelKey) || fallback || labelKey;
    row.appendChild(span);
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'bg-color-swatch';
    swatch.style.background = v;
    swatch.title = v;
    swatch.addEventListener('click', () => {
      const before = layer[key];
      openColorPicker({
        initial: before,
        allowAlpha: isRgba,
        anchor: swatch,
        onChange: (newVal) => {
          layer[key] = newVal;
          swatch.style.background = newVal;
          swatch.title = newVal;
          saveSettings();
        },
        onCommit: (newVal) => {
          layer[key] = newVal;
          swatch.style.background = newVal;
          swatch.title = newVal;
          saveSettings();
        },
        onCancel: () => {
          layer[key] = before;
          swatch.style.background = before;
          swatch.title = before;
          saveSettings();
        },
      });
    });
    row.appendChild(swatch);
    bgConfigEl.appendChild(row);
  };
  const addRange = (key, labelKey, min, max, step, fallback) => {
    if (typeof layer[key] !== 'number') return;
    const row = document.createElement('label');
    row.className = 'bg-config-row';
    const span = document.createElement('span');
    span.textContent = T(labelKey) || fallback || labelKey;
    row.appendChild(span);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(layer[key]);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = Number(layer[key]).toFixed(step < 1 ? 2 : 0);
    input.addEventListener('input', () => {
      layer[key] = parseFloat(input.value);
      val.textContent = layer[key].toFixed(step < 1 ? 2 : 0);
      saveSettings();
    });
    row.appendChild(input);
    row.appendChild(val);
    bgConfigEl.appendChild(row);
  };

  addColor('base',       'bg_layer_base',       'Base');
  addColor('topColor',   'bg_layer_top',        'Top');
  addColor('botColor',   'bg_layer_bot',        'Bottom');
  addColor('spotColor',  'bg_layer_spot_color', 'Spot color');
  addColor('ringColor',  'bg_layer_ring_color', 'Ring color');
  addColor('gridColor',  'bg_layer_grid_color', 'Grid color');
  addRange('spotCount',  'bg_layer_spot_count', 0, 16,   1,    'Spots');
  addRange('gridStep',   'bg_layer_grid_step',  16, 200, 4,    'Grid step');
  addRange('vignette',   'bg_layer_vignette',   0, 1,    0.01, 'Vignette');
  // Reactor-only — see assets/core/state.js (THEMES.reactor.bg).
  addRange('seedCount',  'bg_layer_seed_count', 1, 8,    1,    'Random spots');
  addRange('reseedSec',  'bg_layer_reseed_sec', 0.5, 30, 0.5,  'Randomisation (s)');
  addRange('simSpeed',   'bg_layer_sim_speed',  0, 15,   1,    'Time (steps/frame)');
}
renderBgConfig();


function applyUpscaleMode() {
  canvas.classList.toggle('pixel', S.upscaleMode === 'pixel');
}
function applyScanlines() {
  // alpha 0 → overlay hidden via the body class; > 0 → set the
  // CSS custom prop so the overlay renders at that strength.
  const a = Math.max(0, Math.min(1, Number(S.scanlinesAlpha) || 0));
  document.body.classList.toggle('scanlines', a > 0);
  document.documentElement.style.setProperty('--scanlines-alpha', a.toFixed(3));
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
bindRange('scanlinesAlpha', 'scanlinesAlpha', 'scanlinesVal',
          v => v <= 0 ? 'off' : v.toFixed(2),
          applyScanlines);

// Renderer engine — fundamental change, easiest to handle by reloading.
const rendererSel = document.getElementById('rendererEngine');
if (rendererSel) {
  // Probe WebGL2 + WebGPU support; mark unavailable options as
  // (unsupported) so the dropdown can't strand the user on a broken
  // backend.
  const probe = document.createElement('canvas');
  const webglSupported = !!probe.getContext('webgl2');
  const webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (!webglSupported) {
    const opt = rendererSel.querySelector('option[value="webgl2"]');
    if (opt) { opt.disabled = true; opt.textContent += ' (unsupported)'; }
  }
  if (!webgpuSupported) {
    const opt = rendererSel.querySelector('option[value="webgpu"]');
    if (opt) { opt.disabled = true; opt.textContent += ' (unsupported)'; }
  }
  rendererSel.value = S.renderer;
  // body[data-renderer] gates renderer-conditional UI (Overlays
  // fieldset is GPU-only; Tissue quality slider is Canvas2D-only).
  // Renderer switches reload, so this is set once at init and
  // doesn't need a live updater.
  if (typeof document !== 'undefined' && document.body) {
    document.body.setAttribute('data-renderer', S.renderer);
  }
  rendererSel.addEventListener('change', () => {
    let kind = rendererSel.value;
    const valid = ['canvas2d', 'webgl2', 'webgpu'];
    if (!valid.includes(kind)) kind = 'canvas2d';
    if (kind === 'webgl2' && !webglSupported) kind = 'canvas2d';
    if (kind === 'webgpu' && !webgpuSupported) kind = 'canvas2d';
    if (kind === S.renderer) return;
    S.renderer = kind;
    saveSettings();
    location.reload();
  });
}

// ---------- Palette + help dialog list rendering ----------
// HP label for a cell — finite int for pathogens, ∞ for heroes.
function _hpLabel(key) {
  const v = defaultHp(key);
  return Number.isFinite(v) ? String(v) : '∞';
}

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
  // HP line so the user sees how durable each cell is at a glance.
  const hp = document.createElement('small');
  hp.className = 'cell-tile-hp';
  hp.textContent = `♥ ${_hpLabel(key)}`;
  tile.appendChild(hp);
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

// One row of relations chips (Allies / Prey / Foes). Each chip shows
// the other cell's HP. For prey, also shows this cell's DPS against
// it ("⚔ 8"); for foes, the inverse (their DPS against us).
function appendRelationsRow(parent, labelKey, keys, kind, viewerKey) {
  const row = document.createElement('div');
  row.className = 'cell-list-relations-row';
  const lbl = document.createElement('span');
  lbl.className = 'cell-list-relations-label';
  lbl.textContent = T(labelKey) || labelKey;
  row.appendChild(lbl);
  const list = document.createElement('span');
  list.className = 'cell-list-relations-list';
  if (!keys || !keys.length) {
    const empty = document.createElement('span');
    empty.className = 'empty';
    empty.textContent = '—';
    list.appendChild(empty);
  } else {
    for (const k of keys) {
      const cfg = CELL_TYPES[k];
      if (!cfg) continue;
      const chip = document.createElement('span');
      chip.className = 'cell-list-relations-chip';
      chip.style.setProperty('--chip-color', (cfg.colors && cfg.colors.accent) || '#6663');
      const hp = _hpLabel(k);
      let attack = null;
      if (kind === 'prey') {
        const r = getRule(viewerKey, k);
        if (r && r.dps > 0) attack = r.dps;
      } else if (kind === 'foes') {
        const r = getRule(k, viewerKey);
        if (r && r.dps > 0) attack = r.dps;
      }
      const parts = [cellLabel(k), `♥${hp}`];
      if (attack != null) parts.push(`⚔${attack}`);
      chip.textContent = parts.join(' ');
      list.appendChild(chip);
    }
  }
  row.appendChild(list);
  parent.appendChild(row);
}

function appendHelpSection(parent, title, entries, headingClass) {
  if (!entries.length) return;
  const section = document.createElement('li');
  section.className = 'cell-list-section';
  section.style.listStyle = 'none';
  const h = document.createElement('h3');
  if (headingClass) h.classList.add(headingClass);
  h.textContent = title;
  section.appendChild(h);
  for (const [key] of entries) {
    const row = document.createElement('div');
    row.className = 'cell-list-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
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
    // Friends / Prey / Foes — each rendered as one line of chips.
    // Chips show prey/foe HP + this cell's DPS against them.
    const rel = CELL_RELATIONS[key];
    if (rel) {
      const relsBox = document.createElement('div');
      relsBox.className = 'cell-list-relations';
      appendRelationsRow(relsBox, 'spawn_banner_friends', rel.friends, 'friends', key);
      appendRelationsRow(relsBox, 'spawn_banner_prey',    rel.prey,    'prey',    key);
      appendRelationsRow(relsBox, 'spawn_banner_foes',    rel.foes,    'foes',    key);
      text.appendChild(relsBox);
    }
    row.appendChild(cv);
    row.appendChild(text);
    // Click → enter add mode (the list view IS the add dialog now).
    const activate = () => {
      enterAddMode(key);
      closeAll();
    };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    section.appendChild(row);
    renderCellPreview(cv, key);
  }
  parent.appendChild(section);
}

const cellListEl = document.getElementById('cellList');
// CELL_TYPES entries flagged `extended: true` (e.g. the eukaryote from
// the shader-test port) are hidden from the Add dialog + help list
// unless the user opts in via Settings → Display → "Show extended
// (non-game) cells". Centralised here so every renderer of the cell
// menu shares the same gate.
function isVisibleCell(t) {
  return !(t && t.extended) || S.extendedCells;
}
function renderHelpList() {
  if (!cellListEl) return;
  cellListEl.innerHTML = '';
  const goodEntries = Object.entries(CELL_TYPES).filter(([, t]) => t.category === 'good' && isVisibleCell(t));
  appendHelpSection(cellListEl, T('help_group_good'), goodEntries, 'good');
  if (S.allowBadGuys) {
    for (const g of PATHOGEN_GROUPS) {
      const entries = g.members.map(k => [k, CELL_TYPES[k]]).filter(([, t]) => t && isVisibleCell(t));
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
    ['bar','Bayrisch'], ['hes','Hessisch'], ['mainz','Mainzerisch'],
    ['latin','Latina'],
    // Constructed / historical languages — partial translations
    // (fall through to English for keys not localised). Order is
    // chronological-ish: medieval German → ancient → Tolkien →
    // Star Trek. Native script labels where the language has a
    // canonical name.
    ['gmh','Mittelhochdeutsch'],
    ['pie','Proto-Indogermanisch *'],
    ['qya','Quenya (Eldarin)'],
    ['sjn','Sindarin (Eldarin)'],
    ['mor','Burzum-zat (Mordor)'],
    ['tlh','tlhIngan Hol'],
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
    // Re-localise the BG and interface-color dropdown options. The
    // <select> values stay valid across locales (we key by const
    // background-id / accent-id), only the visible textContent changes.
    if (interfaceColorSelect) {
      const cur = interfaceColorSelect.value;
      interfaceColorSelect.innerHTML = '';
      for (const [key, a] of Object.entries(INTERFACE_ACCENTS)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = T('ic_' + key) || a.label;
        interfaceColorSelect.appendChild(opt);
      }
      interfaceColorSelect.value = cur;
    }
    for (const sel of [bgSelect, bgSelectInline]) {
      if (!sel) continue;
      const cur = sel.value;
      sel.innerHTML = '';
      populateBgSelect(sel);
      sel.value = cur;
    }
  });
}
applyI18n();

// Seed the "Now playing" label synchronously — the async music init
// below replaces this with a live-updating subscription, but if that
// promise hasn't resolved yet (or fails) the label still shows the
// initial track instead of the literal "—" placeholder. Uses index 1
// to mirror MusicPlayer's default _idx (starts at the second track).
{
  const trackLabelEl = document.getElementById('musicTrackLabel');
  const firstTrack = _MUSIC_TRACKS[1 % Math.max(1, _MUSIC_TRACKS.length)];
  if (trackLabelEl && firstTrack) trackLabelEl.textContent = firstTrack.label;
}

const cellGridEl = document.getElementById('cellGrid');
const cellGridBadEl = document.getElementById('cellGridBad');
function renderPaletteGrid() {
  if (!cellGridEl) return;
  cellGridEl.innerHTML = '';
  const goodEntries = Object.entries(CELL_TYPES).filter(([, t]) => t.category === 'good' && isVisibleCell(t));
  appendGridSection(cellGridEl, T('help_group_good'), goodEntries);
}
function renderPaletteBadGrid() {
  if (!cellGridBadEl) return;
  cellGridBadEl.innerHTML = '';
  if (!S.allowBadGuys) return;
  for (const g of PATHOGEN_GROUPS) {
    const entries = g.members.map(k => [k, CELL_TYPES[k]]).filter(([, t]) => t && isVisibleCell(t));
    appendGridSection(cellGridBadEl, `${g.icon} ${T('pgroup_' + g.key)}`, entries);
  }
}

// Extended (non-game) cells toggle — adds CELL_TYPES entries flagged
// `extended: true` (currently just `eukaryote` from the shader-test
// port) to the Add dialog + help list. Re-renders all three dialog
// views on change. Placed AFTER renderPalette* / cellGrid* setup so
// the callback's immediate init invocation (bindCheckbox runs
// onChange once on bind) finds the cellGrid* DOM refs initialised.
bindCheckbox('extendedCells', 'extendedCells', () => {
  renderHelpList();
  renderPaletteGrid();
  renderPaletteBadGrid();
});

// Pathogens are always allowed — the "Allow pathogens" checkbox was
// removed. S.allowBadGuys stays in DEFAULTS as a no-op so existing
// `if (S.allowBadGuys)` guards keep evaluating truthy.

// ---------- Build stamp ----------
// The current build label — same string shown in the on-screen
// #build pill. The full SHA is kept separately so the copy
// handler can write the complete commit hash to the clipboard
// even though the displayed pill abbreviates it to 7 chars.
let _currentBuildLabel = '';
let _currentBuildSha = '';
function renderBuildStamp() {
  const el = document.getElementById('build');
  const b = window.__BUILD__ || { sha: 'dev', run: 0, dateUtc: null, branch: null };
  const fullSha = b.sha || 'dev';
  _currentBuildSha = fullSha;
  const sha = fullSha.slice(0, 7);
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
  // Short branches (≤ 5 chars like "main") read fine inline as
  // the first element. Longer branches (e.g. "claude/hud-rework")
  // dominate the row and push the useful sha/run/codename off the
  // right edge on narrow viewports, so promote them to their own
  // second line below the main info row.
  const branch = b.branch || '';
  const promote = branch && branch.length > 5;
  const head = [];
  if (branch && !promote) head.push(branch);
  head.push(sha);
  if (b.run > 0) {
    // Each deploy run gets a deterministic codename so the user
    // can tell at a glance which build is loaded after a refresh.
    // See assets/core/build-codename.js for the word lists.
    head.push(`#${b.run} · ${buildCodename(b.run)}`);
  }
  if (when) head.push(when);
  _currentBuildLabel = promote
    ? `${head.join(' · ')}\n${branch}`
    : head.join(' · ');
  if (el) {
    if (promote) {
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      el.innerHTML = `${esc(head.join(' · '))}<br>${esc(branch)}`;
    } else {
      el.textContent = _currentBuildLabel;
    }
  }
  // CSS reads .build-2line to offset the #fps pill further down
  // when the build stamp wraps to two rows.
  document.body.classList.toggle('build-2line', !!promote);
}
renderBuildStamp();

// Click the build stamp / press the Settings "Copy build" button →
// copy the FULL commit SHA (not the 7-char abbreviated display) to
// the clipboard. Toast confirms.
async function copyBuildSha() {
  const ok = await copyToClipboard(_currentBuildSha);
  showToast(ok
    ? (T('toast_build_copied') || 'Build SHA copied')
    : (T('toast_build_copy_failed') || 'Copy failed'));
}
const buildStampEl = document.getElementById('build');
if (buildStampEl) {
  buildStampEl.addEventListener('click', copyBuildSha);
  buildStampEl.setAttribute('role', 'button');
  buildStampEl.setAttribute('tabindex', '0');
  buildStampEl.title = T('build_stamp_copy_hint') || 'Click to copy build SHA';
  buildStampEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      copyBuildSha();
    }
  });
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
  const info = (renderer && typeof renderer.info === 'string') ? renderer.info : '';
  // "15fps (webgpu)" — renderer is always part of the overlay when
  // it's visible at all (user spec). With showCellTotal on, the
  // live cell count is appended after a separator.
  let line = info ? `${fps}fps (${info})` : `${fps}fps`;
  if (S.showCellTotal && sim) {
    const cells = (sim.cells && sim.cells.length) || 0;
    line += ` · ${cells} cells`;
  }
  fpsEl.textContent = line;
}

// Composition HUD — top-right widget. Hidden when S.compositionHud
// is off OR when there are no pathogens on the field (otherwise it'd
// just say "Fully covered" forever during early sim, which is noise).
// Throttled to ~4 updates / second by string-equality dedupe — DOM
// stays untouched on frames with the same content.
const compHudEl = document.getElementById('compositionHud');
let _compHudThrottle = 0;
let _compHudLast = '';
function updateCompositionHud(ts) {
  if (!compHudEl) return;
  if (!S.compositionHud) { compHudEl.classList.remove('on'); return; }
  if (ts - _compHudThrottle < 250) return;
  _compHudThrottle = ts;
  const status = sim.getCompositionStatus();
  if (status.pathogens === 0) { compHudEl.classList.remove('on'); return; }
  const lines = [`<div class="title">${T('counters_needed')}</div>`];
  const entries = Object.entries(status.needed);
  if (entries.length === 0) {
    lines.push(`<div class="empty">${T('counters_covered')}</div>`);
  } else {
    for (const [type, count] of entries) {
      lines.push(`<div class="item">+${count} · ${cellLabel(type)}</div>`);
    }
  }
  const html = lines.join('');
  if (html !== _compHudLast) { compHudEl.innerHTML = html; _compHudLast = html; }
  compHudEl.classList.add('on');
}

// Off-screen navigation arrows. Same 250 ms throttle pattern as the
// composition HUD; per-frame iteration of sim.cells is cheap (single
// worldToScreen call + a few branches per cell) but the DOM writes
// would be wasteful at full 60 Hz.
let _navArrowsThrottle = 0;
function updateNavArrows(ts) {
  if (ts - _navArrowsThrottle < 250) return;
  _navArrowsThrottle = ts;
  navArrows.update(sim, S.navMode !== 'none');
}

function frame(ts) {
  // Pause: freeze ts at the moment pause started so shader u_time stops
  // advancing too. Renderer + sim see the frozen value; lastTs is held
  // at the frozen ts, then re-anchored on resume so dt doesn't blow up.
  // Auto-pause (window blur / hidden tab) freezes identically.
  const _frozen = _isPausedOrAuto();
  if (_frozen) {
    if (_pauseFreezeTs == null) _pauseFreezeTs = ts;
    ts = _pauseFreezeTs;
    lastTs = ts;
  } else if (_pauseFreezeTs != null) {
    lastTs = ts;
    _pauseFreezeTs = null;
  }
  if (!lastTs) lastTs = ts;
  const dt = _frozen ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  // Skip simulation when paused; the renderer still runs so the
  // PAUSE overlay can fade in over the existing field, and the
  // resume transition is seamless.
  if (!_frozen) sim.update(dt);

  const t = ts * 0.001;
  const shapes = getShapes(sim.cells, t, sim.camera, sim.W, sim.H);

  renderer.beginFrame(ts, dt);
  renderer.drawBackground(ts);
  // Always call drawCells / drawParticles so the renderer can clear
  // its own state. Both handle empty input cleanly (early-return after
  // the initial clear).
  renderer.drawCells(shapes, t, ts);
  renderer.drawParticles(sim.particles, t, ts);
  // Antibodies have their own Y-sprite pipeline per renderer. The
  // birth flash, velocity-aligned rotation, and expiry fade live
  // inside each renderer's drawAntibodies. See sim.js ANTIBODY_*
  // constants for emit cadence + travel speed.
  renderer.drawAntibodies(sim.antibodies, t, ts);
  renderer.drawSelection(shapes, t);
  if (S.showDebugField) renderer.drawDebug(shapes);
  renderer.endFrame();

  // Floating combat text — tick the lifetimes (skipped while paused
  // so labels freeze in place under the PAUSE overlay) and re-place
  // every active label using the current camera transform.
  if (!_frozen) floatingText.tick(dt);
  floatingText.render(sim);

  // Cell-type overlay (S.cellTypeOverlay / eye-toggle FAB). Always
  // render — even paused — so the labels stay glued to entities
  // that the user is inspecting under the PAUSE overlay.
  cellTags.render(sim);

  updateFPS(dt, ts);
  updateCompositionHud(ts);
  updateNavArrows(ts);

  requestAnimationFrame(frame);
}

// ---------- Boot ----------
// Renderer init is async (WebGPU). We await it before the first
// resize() / frame() so those calls always see a live renderer.
(async () => {
  renderer = await makeRenderer();
  resize();
  // Rendertest locks the canvas to a deterministic size — listening
  // for viewport resizes would re-trigger framing math on every
  // browser drag, defeating the determinism.
  if (!URL_OVERRIDES.rendertest) {
    window.addEventListener('resize', resize);
  }
  sim.resetSim();
  // Apply URL overrides after the reset so the requested specimen
  // isn't wiped by resetSim's default spawn. When `?cellType=` is
  // set we drop the default cell first so only the override remains
  // — rendertest mode in particular needs a single subject in frame.
  if (URL_OVERRIDES.cellType) {
    sim.cells.length = 0;
    sim.cellId = 0;
    applyOverridesToSim(sim);
  }
  if (URL_OVERRIDES.rendertest) {
    applyRendertestCamera(sim, sim.W, sim.H);
  }
  requestAnimationFrame(frame);
})();
