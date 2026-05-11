// Hand-rolled HSV color picker — no library, no build step.
//
// API: openColorPicker({initial, allowAlpha, anchor, onChange,
//                       onCommit, onCancel}) → returns the popover
// element (also auto-mounted to document.body and closed on
// outside-click / Esc). The caller drives an upstream value through
// onChange (live during drag) and onCommit (final value on OK)
// or onCancel (dismissed without commit).
//
// Layout:
//   ┌──────────────────────────┐
//   │ [SV square (256×256)]    │
//   │ [Hue strip]              │
//   │ [Alpha slider]  (opt.)   │
//   │ [Hex input] [swatch]     │
//   │ [Cancel]    [OK]         │
//   └──────────────────────────┘
//
// Color string roundtrip:
//   - hex (#rrggbb)            — used when allowAlpha is false
//   - rgba(r, g, b, a)         — used when allowAlpha is true
// Hex with alpha (#rrggbbaa) is parsed too but never emitted, since
// the existing call sites all use one or the other.

// ── Colour-space helpers ─────────────────────────────────────────

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function hsvToRgb(h, s, v) {
  // h ∈ [0, 1), s, v ∈ [0, 1]. Returns [r, g, b] ∈ [0, 1].
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, v];
}

function rgbToHex(r, g, b) {
  const c = (n) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function parseColor(str) {
  // Returns { r, g, b, a } each 0..1. Accepts #rgb, #rrggbb, #rrggbbaa,
  // rgb(r, g, b), rgba(r, g, b, a). Falls back to opaque black on error.
  const fail = { r: 0, g: 0, b: 0, a: 1 };
  if (typeof str !== 'string') return fail;
  const s = str.trim();
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(s))) {
    const hex = m[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }
  if ((m = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(s))) {
    return {
      r: parseFloat(m[1]) / 255,
      g: parseFloat(m[2]) / 255,
      b: parseFloat(m[3]) / 255,
      a: m[4] !== undefined ? parseFloat(m[4]) : 1,
    };
  }
  return fail;
}

function formatColor(r, g, b, a, allowAlpha) {
  if (allowAlpha) {
    const r255 = Math.round(clamp01(r) * 255);
    const g255 = Math.round(clamp01(g) * 255);
    const b255 = Math.round(clamp01(b) * 255);
    const aRound = Math.round(clamp01(a) * 1000) / 1000;
    return `rgba(${r255}, ${g255}, ${b255}, ${aRound})`;
  }
  return rgbToHex(r, g, b);
}

// ── Picker UI ────────────────────────────────────────────────────

let _activePicker = null;

export function closeColorPicker() {
  if (_activePicker) {
    _activePicker.remove();
    document.removeEventListener('pointerdown', _outsidePointer, true);
    document.removeEventListener('keydown', _escHandler, true);
    _activePicker = null;
  }
}
function _outsidePointer(e) {
  if (_activePicker && !_activePicker.contains(e.target)) closeColorPicker();
}
function _escHandler(e) {
  if (e.key === 'Escape') {
    if (_activePicker && _activePicker.__onCancel) _activePicker.__onCancel();
    closeColorPicker();
  }
}

export function openColorPicker({ initial, allowAlpha = false, anchor, onChange, onCommit, onCancel }) {
  closeColorPicker();
  const initRgba = parseColor(initial);
  const [initH, initS, initV] = rgbToHsv(initRgba.r, initRgba.g, initRgba.b);

  let h = initH, s = initS, v = initV, a = initRgba.a;

  const popover = document.createElement('div');
  popover.className = 'cp-popover';
  popover.__onCancel = () => { if (onCancel) onCancel(); };

  // SV square (canvas).
  const svCanvas = document.createElement('canvas');
  svCanvas.className = 'cp-sv';
  svCanvas.width = 200; svCanvas.height = 160;
  const svCtx = svCanvas.getContext('2d');
  popover.appendChild(svCanvas);

  // Hue strip (vertical band, 1D — drawn as a CSS gradient,
  // overlaid with a draggable thumb).
  const hueStrip = document.createElement('div');
  hueStrip.className = 'cp-hue';
  const hueThumb = document.createElement('div');
  hueThumb.className = 'cp-hue-thumb';
  hueStrip.appendChild(hueThumb);
  popover.appendChild(hueStrip);

  // Alpha slider (optional).
  let alphaStrip = null, alphaThumb = null;
  if (allowAlpha) {
    alphaStrip = document.createElement('div');
    alphaStrip.className = 'cp-alpha';
    alphaThumb = document.createElement('div');
    alphaThumb.className = 'cp-alpha-thumb';
    alphaStrip.appendChild(alphaThumb);
    popover.appendChild(alphaStrip);
  }

  // Hex / rgba text input + live swatch.
  const inputRow = document.createElement('div');
  inputRow.className = 'cp-input-row';
  const swatch = document.createElement('div');
  swatch.className = 'cp-swatch';
  inputRow.appendChild(swatch);
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'cp-text';
  textInput.spellcheck = false;
  inputRow.appendChild(textInput);
  popover.appendChild(inputRow);

  // OK / Cancel.
  const btnRow = document.createElement('div');
  btnRow.className = 'cp-btn-row';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cp-btn cp-cancel';
  cancelBtn.textContent = 'Cancel';
  btnRow.appendChild(cancelBtn);
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'cp-btn cp-ok';
  okBtn.textContent = 'OK';
  btnRow.appendChild(okBtn);
  popover.appendChild(btnRow);

  document.body.appendChild(popover);
  _activePicker = popover;

  // Anchor positioning. Drop the popover below the anchor's bottom-
  // left corner; if it overflows the viewport, flip up / clamp left.
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 6;
    // Measure popover after attach.
    const pop = popover.getBoundingClientRect();
    if (left + pop.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pop.width - 8);
    if (top + pop.height > window.innerHeight - 8) top = Math.max(8, r.top - pop.height - 6);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  } else {
    popover.style.left = '50%';
    popover.style.top = '20%';
    popover.style.transform = 'translateX(-50%)';
  }

  // Outside-click + Esc dismiss.
  setTimeout(() => {
    document.addEventListener('pointerdown', _outsidePointer, true);
    document.addEventListener('keydown', _escHandler, true);
  }, 0);

  // ── Drawing + event wiring ─────────────────────────────────────

  function redrawSV() {
    // SV square gradient: white → fully-saturated hue across X,
    // fully-opaque → black across Y. Two passes is the simplest.
    const w = svCanvas.width, h2 = svCanvas.height;
    const [hr, hg, hb] = hsvToRgb(h, 1, 1);
    const hueStr = `rgb(${(hr * 255) | 0}, ${(hg * 255) | 0}, ${(hb * 255) | 0})`;
    // Horizontal: white → hue.
    const grad1 = svCtx.createLinearGradient(0, 0, w, 0);
    grad1.addColorStop(0, '#fff');
    grad1.addColorStop(1, hueStr);
    svCtx.fillStyle = grad1;
    svCtx.fillRect(0, 0, w, h2);
    // Vertical: transparent → black.
    const grad2 = svCtx.createLinearGradient(0, 0, 0, h2);
    grad2.addColorStop(0, 'rgba(0,0,0,0)');
    grad2.addColorStop(1, 'rgba(0,0,0,1)');
    svCtx.fillStyle = grad2;
    svCtx.fillRect(0, 0, w, h2);
    // Puck.
    const px = s * (w - 1), py = (1 - v) * (h2 - 1);
    svCtx.lineWidth = 2;
    svCtx.strokeStyle = '#000';
    svCtx.beginPath();
    svCtx.arc(px, py, 6, 0, Math.PI * 2);
    svCtx.stroke();
    svCtx.strokeStyle = '#fff';
    svCtx.lineWidth = 1;
    svCtx.beginPath();
    svCtx.arc(px, py, 6, 0, Math.PI * 2);
    svCtx.stroke();
  }

  function refreshSwatch() {
    const [r, g, b] = hsvToRgb(h, s, v);
    swatch.style.background = formatColor(r, g, b, a, allowAlpha);
    if (allowAlpha) {
      const [hr, hg, hb] = hsvToRgb(h, s, v);
      const colStr = `${(hr * 255) | 0},${(hg * 255) | 0},${(hb * 255) | 0}`;
      alphaStrip.style.background =
        `linear-gradient(to right, rgba(${colStr},0), rgba(${colStr},1)),
         repeating-conic-gradient(#444 0% 25%, #888 0% 50%) 50%/8px 8px`;
      alphaThumb.style.left = (a * 100) + '%';
    }
  }

  function refreshHue() {
    hueThumb.style.top = (h * 100) + '%';
  }

  function refreshText() {
    const [r, g, b] = hsvToRgb(h, s, v);
    textInput.value = formatColor(r, g, b, a, allowAlpha);
  }

  function emitChange() {
    if (!onChange) return;
    const [r, g, b] = hsvToRgb(h, s, v);
    onChange(formatColor(r, g, b, a, allowAlpha));
  }

  function refreshAll(emit = true) {
    redrawSV();
    refreshHue();
    refreshSwatch();
    refreshText();
    if (emit) emitChange();
  }

  // SV drag handler — pointer-capture so dragging outside the canvas
  // still updates while held.
  function svPointer(e) {
    const r = svCanvas.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width);
    const y = clamp01((e.clientY - r.top) / r.height);
    s = x; v = 1 - y;
    refreshAll();
  }
  svCanvas.addEventListener('pointerdown', (e) => {
    svCanvas.setPointerCapture(e.pointerId);
    svPointer(e);
  });
  svCanvas.addEventListener('pointermove', (e) => {
    if (e.buttons & 1) svPointer(e);
  });

  // Hue drag.
  function huePointer(e) {
    const r = hueStrip.getBoundingClientRect();
    h = clamp01((e.clientY - r.top) / r.height);
    refreshAll();
  }
  hueStrip.addEventListener('pointerdown', (e) => {
    hueStrip.setPointerCapture(e.pointerId);
    huePointer(e);
  });
  hueStrip.addEventListener('pointermove', (e) => {
    if (e.buttons & 1) huePointer(e);
  });

  // Alpha drag (optional).
  if (alphaStrip) {
    const aPointer = (e) => {
      const r = alphaStrip.getBoundingClientRect();
      a = clamp01((e.clientX - r.left) / r.width);
      refreshAll();
    };
    alphaStrip.addEventListener('pointerdown', (e) => {
      alphaStrip.setPointerCapture(e.pointerId);
      aPointer(e);
    });
    alphaStrip.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) aPointer(e);
    });
  }

  // Text input — typing updates the picker. Bidirectional.
  textInput.addEventListener('input', () => {
    const p = parseColor(textInput.value);
    const [hh, ss, vv] = rgbToHsv(p.r, p.g, p.b);
    h = hh; s = ss; v = vv; a = p.a;
    redrawSV();
    refreshHue();
    refreshSwatch();
    if (allowAlpha) alphaThumb.style.left = (a * 100) + '%';
    emitChange();
  });

  // OK + Cancel.
  okBtn.addEventListener('click', () => {
    if (onCommit) {
      const [r, g, b] = hsvToRgb(h, s, v);
      onCommit(formatColor(r, g, b, a, allowAlpha));
    }
    closeColorPicker();
  });
  cancelBtn.addEventListener('click', () => {
    if (onCancel) onCancel();
    closeColorPicker();
  });

  refreshAll(false);
  // Re-position now that we have real height after refreshAll.
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 6;
    const pop = popover.getBoundingClientRect();
    if (left + pop.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pop.width - 8);
    if (top + pop.height > window.innerHeight - 8) top = Math.max(8, r.top - pop.height - 6);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  }

  return popover;
}
