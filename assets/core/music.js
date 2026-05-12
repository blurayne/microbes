// Tiny music-player wrapper around HTMLAudioElement. Three local
// tracks shipped under assets/audio/, played in the order listed
// in TRACKS. Auto-advances to the next track on `ended`. Public
// surface is intentionally minimal: setEnabled, setVolume,
// next, dispose. UI binding happens in app.js.
//
// Browser autoplay policies block any sound until the user has
// interacted with the page. We don't try to circumvent that — if
// the user enables Music before their first click, the first
// play() call will reject silently and the track starts on the
// next user gesture (we re-attempt in a `pointerdown` listener).

export const TRACKS = [
  { id: 'inside-the-artery',   src: 'assets/audio/inside-the-artery.mp3',   label: 'Inside the Artery' },
  { id: 'pulse-through-veins', src: 'assets/audio/pulse-through-veins.mp3', label: 'Pulse Through Veins' },
  { id: 'warm-pulse-drift',    src: 'assets/audio/warm-pulse-drift.mp3',    label: 'Warm Pulse Drift' },
];

export class MusicPlayer {
  constructor() {
    this._audio = null;
    // Start at the SECOND track (per user spec). Tracks loop in order
    // anyway; this just affects which one plays first this session.
    this._idx = 1 % Math.max(1, TRACKS.length);
    this._enabled = false;
    this._volume = 0.5;
    this._pendingPlay = false;
    // Caller can subscribe to track changes (e.g. settings panel
    // "Now playing" line). Fires after next() finishes loading the
    // new src AND on the first setEnabled(true).
    this.onTrackChange = null;
    // Defer the HTMLAudioElement until enabled — no point spinning up
    // a media element if music never gets switched on this session.
  }

  // Currently selected track label, regardless of play state.
  getCurrentLabel() {
    const t = TRACKS[this._idx];
    return t ? t.label : '';
  }

  _emitTrackChange() {
    if (typeof this.onTrackChange === 'function') {
      try { this.onTrackChange(this.getCurrentLabel()); } catch {}
    }
  }

  _ensureAudio() {
    if (this._audio) return;
    if (typeof Audio === 'undefined') return;   // SSR / node-test guard
    const a = new Audio();
    a.preload = 'auto';
    a.volume = this._volume;
    a.addEventListener('ended', () => {
      // Auto-advance through the playlist; loops back to track 0 at
      // the end. No fade — keeps the module dependency-free.
      this.next();
    });
    this._audio = a;
    this._loadCurrent();
  }

  _loadCurrent() {
    if (!this._audio) return;
    const t = TRACKS[this._idx];
    if (!t) return;
    this._audio.src = t.src;
  }

  _attemptPlay() {
    if (!this._audio || !this._enabled) return;
    const p = this._audio.play();
    if (p && typeof p.then === 'function') {
      // Silently swallow autoplay-policy rejections; the user's next
      // pointerdown will re-trigger via the listener in app.js.
      p.catch(() => { this._pendingPlay = true; });
    }
  }

  setEnabled(on) {
    const wasEnabled = this._enabled;
    this._enabled = !!on;
    if (this._enabled) {
      this._ensureAudio();
      this._attemptPlay();
      if (!wasEnabled) this._emitTrackChange();
    } else if (this._audio) {
      this._audio.pause();
      this._pendingPlay = false;
    }
  }

  // Volume = 0 silently stops playback (user spec: muting via the
  // slider should pause music, not just lower the audio output).
  // Setting a non-zero value while previously muted resumes play.
  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, +v || 0));
    if (this._audio) this._audio.volume = this._volume;
    if (this._volume <= 0) {
      if (this._audio) this._audio.pause();
      this._pendingPlay = false;
    } else if (this._enabled) {
      // Coming back from muted — kick playback if the audio was paused.
      this._attemptPlay();
    }
  }

  next() {
    this._idx = (this._idx + 1) % TRACKS.length;
    if (!this._audio) {
      this._emitTrackChange();
      return;
    }
    const wasPlaying = !this._audio.paused;
    this._loadCurrent();
    if (wasPlaying || this._enabled) this._attemptPlay();
    this._emitTrackChange();
  }

  // Called from a user-gesture listener so an autoplay-blocked play()
  // gets a second chance once the user has interacted with the page.
  retryIfPending() {
    if (this._pendingPlay && this._enabled) {
      this._pendingPlay = false;
      this._attemptPlay();
    }
  }

  dispose() {
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio = null;
    }
  }
}
