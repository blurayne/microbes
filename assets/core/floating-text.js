// Floating combat text — pops "-N" / "+N" labels above sim entities
// when they take damage / get activated, then floats them upward
// while fading out.
//
// Lives in an HTML overlay (#floatingText) above the canvas so the
// same code works for canvas2d, webgl2 and webgpu without per-
// renderer plumbing. World→screen conversion uses sim.worldToScreen
// each frame so the labels stay glued to entities even as the
// camera pans / zooms.

const TTL = 0.9;        // seconds visible
const RISE = 50;        // px the label drifts upward over its life
const FADE_AT = 0.6;    // start fading at 60 % of TTL
const JITTER = 16;      // ± px horizontal to avoid stacks overlapping
const MAX_ENTRIES = 80; // hard cap to keep DOM cost bounded

export class FloatingText {
  constructor(container) {
    this.container = container;
    this.entries = [];
  }

  // Push a new label. `kind` selects the colour:
  //   damage   → pink ('-')        e.g. {text:'-3', kind:'damage'}
  //   heal     → green ('+')       e.g. {text:'+5', kind:'heal'}
  //   activate → cyan accent ('+') e.g. {text:'+1', kind:'activate'}
  // Optionally pass {hp, maxHp} to draw a 2 px HP bar below the
  // text — fill width = hp / maxHp, fill colour interpolates green
  // (100 %) → yellow → orange → red (≤ 20 %). Heroes (Infinity hp)
  // skip the bar.
  push({ x, y, text, kind, hp, maxHp }) {
    if (this.entries.length >= MAX_ENTRIES) {
      const oldest = this.entries.shift();
      oldest.el.remove();
    }
    const el = document.createElement('span');
    el.className = `ft-entry ft-${kind || 'damage'}`;

    const txt = document.createElement('span');
    txt.className = 'ft-text';
    txt.textContent = text;
    el.appendChild(txt);

    if (Number.isFinite(maxHp) && maxHp > 0 && Number.isFinite(hp)) {
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      // 0 = red, 120 = green. Below 20 % stays solid red; above
      // 20 % the hue interpolates linearly to green at 100 %.
      const hue = Math.max(0, Math.min(120, (pct * 100 - 20) / 80 * 120));
      const bar = document.createElement('span');
      bar.className = 'ft-bar';
      const fill = document.createElement('span');
      fill.className = 'ft-bar-fill';
      fill.style.width = (pct * 100).toFixed(1) + '%';
      fill.style.background = `hsl(${hue.toFixed(0)} 80% 55%)`;
      bar.appendChild(fill);
      el.appendChild(bar);
    }

    this.container.appendChild(el);
    this.entries.push({
      x, y, el, age: 0,
      jitterX: (Math.random() - 0.5) * JITTER,
    });
  }

  tick(dt) {
    if (!this.entries.length) return;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.age += dt;
      if (e.age >= TTL) {
        e.el.remove();
        this.entries.splice(i, 1);
      }
    }
  }

  // Re-position every active label to follow its world coordinate.
  // Called every frame after sim.update so the camera transform is
  // current.
  render(sim) {
    if (!sim || !sim.worldToScreen || !this.entries.length) return;
    for (const e of this.entries) {
      const s = sim.worldToScreen(e.x, e.y);
      const lift = -RISE * (e.age / TTL);
      const opacity = e.age < TTL * FADE_AT
        ? 1
        : Math.max(0, 1 - (e.age - TTL * FADE_AT) / (TTL * (1 - FADE_AT)));
      e.el.style.transform = `translate(${s.x + e.jitterX}px, ${s.y + lift}px)`;
      e.el.style.opacity = opacity.toFixed(2);
    }
  }

  clear() {
    for (const e of this.entries) e.el.remove();
    this.entries.length = 0;
  }
}
