// URL query-parameter overrides for the boot sequence.
//
// Mirrors the development helpers documented in
// `.claude/skills/import-shader-test-cell/SKILL.md`. Lets you jump
// straight into a specific cell + theme + renderer combination so the
// shader-test visual-port loop is one URL away from a clean shot —
// e.g. `?cellType=virus&theme=cartoon&renderer=webgl2&pose=1`.
//
// Overrides are **in-memory only**: they mutate `S` for the current
// session but never call saveSettings. The user's persisted prefs are
// restored on the next page load with no query params. If the user
// changes a UI control while overrides are active, that control's
// change persists as normal (no special suppression — the override is
// just a one-tick patch).

import { CELL_TYPES, KNOWN_THEME_KEYS, KNOWN_BACKGROUND_KEYS } from './state.js';

const VALID_RENDERERS = new Set(['canvas2d', 'webgl2', 'webgpu']);
// `?bg=solid` is also accepted — it's the synthetic flat fallback
// the loadSettings shim already treats as a valid background key.
const VALID_BG_KEYS = new Set(['solid', ...KNOWN_BACKGROUND_KEYS]);

// `?test=` selectors. Capability gate is `?debug=1`; the test name
// picks a sub-mode. The shorthand `?rendertest=1` derives to the
// same `render` selection. Whitelist is small on purpose so future
// modes have to opt in explicitly.
const VALID_TESTS = new Set(['render']);

// Canvas-size clamp for `?w=`/`?h=` in rendertest mode. Lower bound
// keeps the framing math sane; upper bound stops a runaway URL from
// allocating a 16 K × 16 K backbuffer.
const SIZE_MIN = 64;
const SIZE_MAX = 4096;

function readParams() {
  // SSR / test environments may not have `window.location`; guard so
  // a Node import doesn't throw.
  if (typeof window === 'undefined' || !window.location) return null;
  return new URLSearchParams(window.location.search);
}

function parseBool(v) {
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parseSize(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(SIZE_MIN, Math.min(SIZE_MAX, n));
}

// Parse once on module load. Frozen so consumers can read but not
// scribble (they should mutate S instead).
function parseOverrides() {
  const p = readParams();
  if (!p) return Object.freeze({});
  const out = {};

  const cellType = p.get('cellType');
  if (cellType && Object.prototype.hasOwnProperty.call(CELL_TYPES, cellType)) {
    out.cellType = cellType;
  } else if (cellType) {
    console.warn(`[url-overrides] unknown cellType=${cellType}`);
  }

  const theme = p.get('theme');
  if (theme && KNOWN_THEME_KEYS.includes(theme)) {
    out.theme = theme;
  } else if (theme) {
    console.warn(`[url-overrides] unknown theme=${theme}`);
  }

  const renderer = p.get('renderer');
  if (renderer && VALID_RENDERERS.has(renderer)) {
    out.renderer = renderer;
  } else if (renderer) {
    console.warn(`[url-overrides] unknown renderer=${renderer}`);
  }

  const bg = p.get('bg');
  if (bg && VALID_BG_KEYS.has(bg)) {
    out.bg = bg;
  } else if (bg) {
    console.warn(`[url-overrides] unknown bg=${bg}`);
  }

  if (p.has('pose')) out.pose = parseBool(p.get('pose'));
  if (p.has('extended')) out.extended = parseBool(p.get('extended'));
  if (p.has('screenshot')) out.screenshot = parseBool(p.get('screenshot'));
  if (p.has('cartoon')) out.cartoon = parseBool(p.get('cartoon'));

  // Debug capability + test selector. `?test=render` requires
  // `?debug=1` to take effect; `?rendertest=1` is sugar for both.
  const debug = p.has('debug') ? parseBool(p.get('debug')) : false;
  const testRaw = p.get('test');
  let test = null;
  if (testRaw && VALID_TESTS.has(testRaw)) {
    test = testRaw;
  } else if (testRaw) {
    console.warn(`[url-overrides] unknown test=${testRaw}`);
  }
  const rendertestRaw = p.has('rendertest') ? parseBool(p.get('rendertest')) : false;

  out.debug = debug;
  if (test) out.test = test;
  out.rendertest = rendertestRaw || (debug && test === 'render');

  // Rendertest mode implies a paused, chrome-hidden pose so the
  // existing pose path runs without the user repeating `?pose=1`.
  if (out.rendertest) out.pose = true;

  if (p.has('translucent')) out.translucent = parseBool(p.get('translucent'));
  if (p.has('download')) out.download = parseBool(p.get('download'));

  const w = p.has('w') ? parseSize(p.get('w')) : null;
  const h = p.has('h') ? parseSize(p.get('h')) : null;
  if (w != null) out.w = w;
  if (h != null) out.h = h;

  // ?diagnose=webgpu,webgl turns on the renderer-specific
  // diagnostic infrastructure (validation scopes, per-frame
  // readbacks, pipeline-creation logging). Off by default so
  // production traffic doesn't pay the readback / log cost.
  // Value is a comma-separated list; accepts 'webgpu' and / or
  // 'webgl' / 'webgl2'. See:
  //   .claude/skills/webgpu-debugger/SKILL.md
  //   .claude/skills/webgl-debugger/SKILL.md
  //   .claude/skills/Mobile-Debüt/SKILL.md
  const diagnoseRaw = p.get('diagnose');
  const diagnose = new Set();
  if (diagnoseRaw) {
    for (const token of diagnoseRaw.split(',').map(s => s.trim().toLowerCase())) {
      if (token === 'webgpu') diagnose.add('webgpu');
      if (token === 'webgl' || token === 'webgl2') diagnose.add('webgl');
    }
  }
  out.diagnose = Object.freeze(diagnose);

  return Object.freeze(out);
}

export const URL_OVERRIDES = parseOverrides();

// Mutates `S` in-memory for settings-shaped overrides. Call early in
// app boot, before any UI bind reads `S`. Returns true if any setting
// was changed (callers may use this to log).
export function applyOverridesToSettings(S) {
  let changed = false;
  if (URL_OVERRIDES.theme) {
    S.theme = URL_OVERRIDES.theme;
    changed = true;
  }
  if (URL_OVERRIDES.renderer) {
    S.renderer = URL_OVERRIDES.renderer;
    changed = true;
  }
  if (URL_OVERRIDES.bg) {
    S.background = URL_OVERRIDES.bg;
    changed = true;
  }
  if (URL_OVERRIDES.extended === true) {
    S.extendedCells = true;
    changed = true;
  }
  if (URL_OVERRIDES.cartoon === true) {
    S.cartoon = true;
    changed = true;
  } else if (URL_OVERRIDES.cartoon === false) {
    S.cartoon = false;
    changed = true;
  }
  return changed;
}

// Spawns the requested specimen at the world centre. Caller is
// responsible for pausing (URL_OVERRIDES.pose) — separated so the
// app's existing `setPaused` helper stays the single source of truth
// for pause state.
export function applyOverridesToSim(sim) {
  if (URL_OVERRIDES.cellType && sim && typeof sim.spawnAtCenter === 'function') {
    sim.spawnAtCenter(URL_OVERRIDES.cellType);
  }
}
