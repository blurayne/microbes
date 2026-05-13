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
  { id: 'tidal-drift',         src: 'assets/audio/tidal-drift.mp3',         label: 'Tidal Drift' },
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
    // Any in-flight fade is incompatible with an instant toggle —
    // cancel and snap to the requested state.
    this._cancelFade();
    const wasEnabled = this._enabled;
    this._enabled = !!on;
    if (this._enabled) {
      this._ensureAudio();
      if (this._audio) this._audio.volume = this._volume;
      this._attemptPlay();
      if (!wasEnabled) this._emitTrackChange();
    } else if (this._audio) {
      this._audio.pause();
      this._pendingPlay = false;
      // Restore the audio element's volume to the slider value so
      // the next setEnabled(true) starts at the user's chosen level
      // (and not at whatever a prior fade left it at).
      this._audio.volume = this._volume;
    }
  }

  // Smooth enable/disable. On disable, ramps `audio.volume` down to
  // 0 over `ms` (default 200) before calling pause(). On enable,
  // starts the audio silent then ramps up to the slider's level.
  // Used by the auto-pause path so a window-blur doesn't cut the
  // music abruptly. Falls through to instant setEnabled when there
  // is no audio element yet (first call before any user gesture).
  fadeEnabled(on, ms) {
    const dur = (typeof ms === 'number' && ms > 0) ? ms : 200;
    if (!this._audio) {
      this.setEnabled(on);
      return;
    }
    const wasEnabled = this._enabled;
    this._enabled = !!on;
    this._cancelFade();
    const audio = this._audio;
    if (this._enabled) {
      // Fade in: start silent, kick off playback, ramp to slider level.
      this._ensureAudio();
      audio.volume = 0;
      this._attemptPlay();
      if (!wasEnabled) this._emitTrackChange();
      this._fadeVolume(this._volume, dur);
    } else {
      // Fade out: ramp to 0, then pause. After pause, restore the
      // element's volume to the slider level so a later setEnabled
      // doesn't pop in silent.
      this._fadeVolume(0, dur, () => {
        if (!this._audio) return;
        this._audio.pause();
        this._pendingPlay = false;
        this._audio.volume = this._volume;
      });
    }
  }

  _cancelFade() {
    if (this._fadeRaf) {
      cancelAnimationFrame(this._fadeRaf);
      this._fadeRaf = null;
    }
  }

  _fadeVolume(target, ms, done) {
    const audio = this._audio;
    if (!audio) { if (done) done(); return; }
    const startV = audio.volume;
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      audio.volume = Math.max(0, Math.min(1, startV + (target - startV) * k));
      if (k < 1) {
        this._fadeRaf = requestAnimationFrame(step);
      } else {
        this._fadeRaf = null;
        if (done) done();
      }
    };
    this._fadeRaf = requestAnimationFrame(step);
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
