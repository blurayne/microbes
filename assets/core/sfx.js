// Tiny SFX player — fire-and-forget short sound events. Each named
// SFX has 1+ source files; on `play(name, …)` the player picks one
// at random, instantiates a fresh `Audio()` cloned from a pre-loaded
// source, applies volume + optional stereo pan, and triggers
// playback. Cloning per shot is what allows multiple SFX to overlap
// (e.g. two B-cells firing simultaneously) without the previous
// instance being cut off.
//
// Channel limits: browsers cap concurrent HTMLAudioElement
// playback (~16 on iOS, ~32 elsewhere). A swarm of B-cells firing
// in lockstep hits the cap and every subsequent shot — including
// other categories — silently fails. We enforce a smaller
// per-category quota up-front so the bursty `antibody` channel
// can't starve `death`, `virusHit`, `split`. Each shot is tracked
// and released on `ended` so retired Audio elements + Web Audio
// graph nodes free up promptly. Totals sum to TOTAL_LIMIT (40)
// which is well under the browser ceiling.
//
// Browser autoplay policies block playback before the first user
// gesture; play() rejections are silently swallowed. The first
// pointerdown (handled in app.js for the music player too) primes
// the audio context for subsequent SFX.

const SFX_SOURCES = {
  antibody: [
    'assets/audio/sfx/antibody-1.mp3',
    'assets/audio/sfx/antibody-2.mp3',
    'assets/audio/sfx/antibody-3.mp3',
  ],
  split: [
    'assets/audio/sfx/split-1.mp3',
    'assets/audio/sfx/split-2.mp3',
    'assets/audio/sfx/split-3.mp3',
  ],
  virusHit: [
    'assets/audio/sfx/virus-hit-1.mp3',
  ],
  death: [
    'assets/audio/sfx/death-1.mp3',
  ],
};

// Per-category concurrent-shot cap. Sum is the global ceiling
// (TOTAL_LIMIT) — must stay under the browser's
// HTMLAudioElement concurrency limit (~32 on iOS, ~64 on
// desktop). When a category is at quota, new play() calls drop
// silently; the in-game cause (e.g. a B-cell volley) gets fewer
// SFX but the rest of the audio mix stays intact.
const SFX_CATEGORIES = {
  antibody: 20,    // B-cell firing — most frequent, capped first
  virusHit:  6,    // hit feedback — typically 1:1 with antibody but lower priority
  death:    10,    // pathogen destruction
  split:     4,    // mitosis chime
};
const TOTAL_LIMIT = 40;

export class SfxPlayer {
  constructor() {
    this._volume = 0.7;
    this._enabled = true;
    // Pre-load one Audio per source URL. Browsers cache the file, so
    // subsequent `new Audio(url)` clones reuse the bytes. Cheap upfront
    // load (~200 KB per file × 3 = ~600 KB) trades for instant playback
    // on first emit.
    this._sources = Object.create(null);
    // Per-category active set (Audio elements currently playing).
    // Sized only for categories that exist in SFX_CATEGORIES; an
    // unknown name in play() falls through silently.
    this._active = Object.create(null);
    for (const name of Object.keys(SFX_CATEGORIES)) {
      this._active[name] = new Set();
    }
    this._totalActive = 0;
    if (typeof Audio === 'undefined') return;     // node-test guard
    for (const [name, urls] of Object.entries(SFX_SOURCES)) {
      this._sources[name] = urls.map((url) => {
        const a = new Audio();
        a.preload = 'auto';
        a.src = url;
        return a;
      });
    }
  }

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, +v || 0));
  }

  setEnabled(on) {
    this._enabled = !!on;
  }

  /**
   * Trigger one shot of the named SFX with optional stereo panning.
   *
   * @param {string} name — key in SFX_SOURCES
   * @param {{ volumeScale?: number, pan?: number }} [opts]
   *   pan: -1 (full left) … 0 (centre) … +1 (full right). Routes
   *   through a Web Audio MediaElementSource + StereoPannerNode
   *   when an AudioContext is available; falls back to mono
   *   <audio>.volume on older browsers.
   *
   * Returns true if the shot was scheduled, false if it was
   * dropped (channel full, category unknown, or muted).
   */
  play(name, opts) {
    if (!this._enabled || this._volume <= 0) return false;
    const group = this._sources[name];
    if (!group || group.length === 0) return false;
    const limit = SFX_CATEGORIES[name];
    if (limit == null) return false;                          // unknown category
    const activeSet = this._active[name];
    if (activeSet.size >= limit) return false;                // category full
    if (this._totalActive >= TOTAL_LIMIT) return false;       // global ceiling
    const proto = group[Math.floor(Math.random() * group.length)];
    if (!proto) return false;
    const scale = (opts && typeof opts.volumeScale === 'number') ? opts.volumeScale : 1;
    const pan = (opts && typeof opts.pan === 'number')
      ? Math.max(-1, Math.min(1, opts.pan)) : 0;
    const a = new Audio(proto.src);
    a.volume = Math.max(0, Math.min(1, this._volume * scale));
    // Web Audio routing (pan only). Each MediaElementSource is
    // permanently bound to its Audio element, so we keep the node
    // references on the Audio object itself and disconnect them
    // on release — otherwise the panner + source graphs accumulate
    // indefinitely.
    let srcNode = null, pannerNode = null;
    if (pan !== 0 && typeof AudioContext !== 'undefined') {
      try {
        if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        srcNode = this._ctx.createMediaElementSource(a);
        pannerNode = this._ctx.createStereoPanner();
        pannerNode.pan.value = pan;
        srcNode.connect(pannerNode).connect(this._ctx.destination);
      } catch (_) { /* fall back to mono <audio> playback */ }
    }
    activeSet.add(a);
    this._totalActive++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeSet.delete(a);
      this._totalActive = Math.max(0, this._totalActive - 1);
      try { if (srcNode) srcNode.disconnect(); } catch (_) { /* noop */ }
      try { if (pannerNode) pannerNode.disconnect(); } catch (_) { /* noop */ }
      // Help GC reclaim the buffer on platforms that don't free
      // the element automatically after `ended`.
      try { a.src = ''; } catch (_) { /* noop */ }
    };
    a.addEventListener('ended', release, { once: true });
    a.addEventListener('error', release, { once: true });
    // Safety net: if `ended` never fires (occasionally happens on
    // Web Audio-routed Audio elements on iOS), release after the
    // clip's nominal duration + 250 ms padding.
    const fallbackMs = (Number.isFinite(a.duration) && a.duration > 0)
      ? (a.duration + 0.25) * 1000
      : 4000;
    setTimeout(release, fallbackMs);
    const p = a.play();
    if (p && typeof p.then === 'function') p.catch(release);
    return true;
  }
}
