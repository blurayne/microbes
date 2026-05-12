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

import { CELL_TYPES, KNOWN_THEME_KEYS } from './state.js';

const VALID_RENDERERS = new Set(['canvas2d', 'webgl2', 'webgpu']);

function readParams() {
  // SSR / test environments may not have `window.location`; guard so
  // a Node import doesn't throw.
  if (typeof window === 'undefined' || !window.location) return null;
  return new URLSearchParams(window.location.search);
}

function parseBool(v) {
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
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

  if (p.has('pose')) out.pose = parseBool(p.get('pose'));
  if (p.has('extended')) out.extended = parseBool(p.get('extended'));
  if (p.has('screenshot')) out.screenshot = parseBool(p.get('screenshot'));
  if (p.has('cartoon')) out.cartoon = parseBool(p.get('cartoon'));

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
