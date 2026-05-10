// Start-banner overlay (PR-E phase 2). Pops a small floating panel
// the FIRST time the user spawns each cell type, listing that type's
// friends / prey / foes from the docs-derived CELL_RELATIONS table.
// Subsequent spawns of the same type are silent (one-shot per type
// per browser, persisted via localStorage).
//
// HTML overlay above the canvas (mirrors floating-text.js +
// cell-tag.js); pointer-events: auto on the panel itself so the
// "Got it" close button works, but pointer-events: none on the
// surrounding layer so canvas drag/click pass through.

import { CELL_TYPES, T } from './state.js';
import { CELL_RELATIONS } from './cell-relations.js';

const SEEN_PREFIX = 'mb.seenSpawn.';

function alreadySeen(type) {
  try { return localStorage.getItem(SEEN_PREFIX + type) === '1'; }
  catch (_) { return false; }
}
function markSeen(type) {
  try { localStorage.setItem(SEEN_PREFIX + type, '1'); } catch (_) {}
}

export class SpawnBanner {
  constructor(container) {
    this.container = container;
    this.current = null;          // currently-open banner element
  }

  // Show the banner for `type` if we haven't seen this type yet.
  // No-op if already seen, or if there's no relation entry for the
  // type (some sim-only kinds aren't documented yet).
  notify(type) {
    if (!type || alreadySeen(type)) return;
    const rel = CELL_RELATIONS[type];
    const cfg = CELL_TYPES[type];
    if (!rel || !cfg) return;     // no doc entry → silent
    markSeen(type);
    this._open(type, cfg, rel);
  }

  _open(type, cfg, rel) {
    if (this.current) this.current.remove();
    const el = document.createElement('div');
    el.className = 'spawn-banner';
    el.style.setProperty('--accent', cfg.colors?.accent || '#ffffff');

    const head = document.createElement('header');
    const title = document.createElement('h3');
    title.textContent = cfg.label || type;
    head.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'spawn-banner-close';
    close.setAttribute('aria-label', T('spawn_banner_close') || 'Got it');
    close.textContent = '×';
    close.addEventListener('click', () => this._dismiss());
    head.appendChild(close);
    el.appendChild(head);

    el.appendChild(this._row('spawn_banner_friends', rel.friends));
    el.appendChild(this._row('spawn_banner_prey',    rel.prey));
    el.appendChild(this._row('spawn_banner_foes',    rel.foes));

    const foot = document.createElement('button');
    foot.type = 'button';
    foot.className = 'spawn-banner-cta';
    foot.textContent = T('spawn_banner_close') || 'Got it';
    foot.addEventListener('click', () => this._dismiss());
    el.appendChild(foot);

    this.container.appendChild(el);
    this.current = el;

    // Auto-dismiss after 8 s if the user hasn't clicked.
    this._timer = setTimeout(() => this._dismiss(), 8000);
  }

  _row(labelKey, keys) {
    const row = document.createElement('div');
    row.className = 'spawn-banner-row';
    const lbl = document.createElement('span');
    lbl.className = 'spawn-banner-label';
    lbl.textContent = T(labelKey) || labelKey;
    row.appendChild(lbl);
    const list = document.createElement('span');
    list.className = 'spawn-banner-list';
    if (!keys || !keys.length) {
      list.classList.add('spawn-banner-empty');
      list.textContent = '—';
    } else {
      keys.forEach((k, i) => {
        const cfg = CELL_TYPES[k];
        if (!cfg) return;
        const chip = document.createElement('span');
        chip.className = 'spawn-banner-chip';
        chip.style.setProperty('--chip-color', cfg.colors?.accent || '#fff');
        chip.textContent = cfg.label || k;
        list.appendChild(chip);
      });
    }
    row.appendChild(list);
    return row;
  }

  _dismiss() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this.current) return;
    const el = this.current;
    this.current = null;
    el.classList.add('dismissing');
    setTimeout(() => el.remove(), 220);
  }

  // Test / debug hook: clear the localStorage seen-state so banners
  // re-appear next time. Not currently wired anywhere.
  resetSeen() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(SEEN_PREFIX)) localStorage.removeItem(k);
      }
    } catch (_) {}
  }
}
