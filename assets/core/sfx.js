// Tiny SFX player — fire-and-forget short sound events. Antibody
// firing is the only consumer today, but the API is generic so other
// game events can hook in later.
//
// Each named SFX has 1+ source files; on `play(name, …)` the player
// picks one at random, instantiates a fresh `Audio()` cloned from a
// pre-loaded source, applies volume, and triggers playback. Cloning
// per shot is what allows multiple SFX to overlap (e.g. two B-cells
// firing simultaneously) without the previous instance being cut off.
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

export class SfxPlayer {
  constructor() {
    this._volume = 0.7;
    this._enabled = true;
    // Pre-load one Audio per source URL. Browsers cache the file, so
    // subsequent `new Audio(url)` clones reuse the bytes. Cheap upfront
    // load (~200 KB per file × 3 = ~600 KB) trades for instant playback
    // on first emit.
    this._sources = Object.create(null);
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
   */
  play(name, opts) {
    if (!this._enabled || this._volume <= 0) return;
    const group = this._sources[name];
    if (!group || group.length === 0) return;
    const proto = group[Math.floor(Math.random() * group.length)];
    if (!proto) return;
    const scale = (opts && typeof opts.volumeScale === 'number') ? opts.volumeScale : 1;
    const pan = (opts && typeof opts.pan === 'number')
      ? Math.max(-1, Math.min(1, opts.pan)) : 0;
    const a = new Audio(proto.src);
    a.volume = Math.max(0, Math.min(1, this._volume * scale));
    // Lazy AudioContext on first play (browser autoplay policy
    // forbids creation before a user gesture).
    if (pan !== 0 && typeof AudioContext !== 'undefined') {
      try {
        if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = this._ctx.createMediaElementSource(a);
        const panner = this._ctx.createStereoPanner();
        panner.pan.value = pan;
        src.connect(panner).connect(this._ctx.destination);
      } catch (_) { /* fall back to mono <audio> playback */ }
    }
    const p = a.play();
    if (p && typeof p.then === 'function') p.catch(() => {});
  }
}
