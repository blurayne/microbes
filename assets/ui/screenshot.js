// Debug helper: capture the `#stage` canvas as a PNG plus a JSON
// sidecar describing the sim state at the moment of capture. Used
// during the shader-test visual-port loop to pair a deterministic
// pose with a pixel snapshot for diffing against the shader-test
// reference. Triggered three ways:
//
//   1. `window.__SCREENSHOT__()` from DevTools.
//   2. The Screenshot button in Settings → footer.
//   3. The `?screenshot=1` URL param (handled in app.js, fires one
//      rAF tick after first paused frame).
//
// Both downloads share the same timestamp suffix so they pair up
// in the user's downloads folder.

function tsSuffix() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Defer revoke + remove so the download actually starts in
  // Firefox / Safari (Chrome is more forgiving).
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      reject(new Error('screenshot: #stage canvas missing or unsupported'));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('screenshot: canvas.toBlob returned null'));
      else resolve(blob);
    }, 'image/png');
  });
}

// Build the JSON sidecar. Kept tiny on purpose — just what's
// needed to reproduce the pose, not a full sim dump. Pass the live
// objects; we read them shallowly and don't retain references.
function buildSidecar({ S, sim, renderer }) {
  const out = {
    ts: Date.now(),
    build: (typeof window !== 'undefined' && window.__BUILD__) || null,
    theme: S && S.theme,
    background: S && S.background,
    interfaceColor: S && S.interfaceColor,
    renderer: (S && S.renderer) || (renderer && renderer.kind) || null,
    cartoon: !!(S && S.cartoon),
    extendedCells: !!(S && S.extendedCells),
  };
  if (sim && sim.camera) {
    const c = sim.camera;
    out.camera = {
      x: typeof c.x === 'number' ? c.x : null,
      y: typeof c.y === 'number' ? c.y : null,
      scale: typeof c.scale === 'number' ? c.scale : null,
      tx: typeof c.tx === 'number' ? c.tx : null,
      ty: typeof c.ty === 'number' ? c.ty : null,
      rotation: typeof c.rotation === 'number' ? c.rotation : 0,
    };
  }
  if (sim && Array.isArray(sim.cells)) {
    out.cells = sim.cells.map(c => ({
      id: c.id,
      type: c.type,
      x: c.x, y: c.y, r: c.r,
      hp: c.hp, state: c.state,
    }));
  }
  return out;
}

// Public API. `ctx` is `{ S, sim, renderer? }`; everything is
// optional in case a caller wants a bare PNG with no sidecar.
// Returns the timestamp used in both filenames so the caller can
// surface "saved as microbes-…" in a toast.
//
// Rendertest extras (all optional):
//   filename   — explicit PNG filename. Overrides the default
//                `microbes-${stamp}.png` template. JSON sidecar uses
//                the same basename when `skipSidecar` is false.
//   skipSidecar — when true, suppresses the JSON dump. Used by the
//                 rendertest auto-capture path so the artifact bundle
//                 stays PNGs-only.
//   returnBlob  — when true, resolves with the PNG `Blob` and skips
//                 every download trigger. Used by callers that read
//                 the bytes in-process (e.g. Playwright via
//                 `canvas.toBlob` over `evaluate`).
export async function takeScreenshot(ctx = {}) {
  const canvas = document.getElementById('stage');
  if (!canvas) throw new Error('screenshot: #stage canvas not found');
  const stamp = tsSuffix();

  // PNG first so the user sees the download even if the JSON build
  // throws on weird sim state.
  const png = await canvasToPngBlob(canvas);
  if (ctx.returnBlob) return png;

  const pngName = ctx.filename || `microbes-${stamp}.png`;
  downloadBlob(png, pngName);

  if (!ctx.skipSidecar) {
    try {
      const sidecar = buildSidecar(ctx);
      const jsonBlob = new Blob([JSON.stringify(sidecar, null, 2)], {
        type: 'application/json',
      });
      // JSON sidecar mirrors the PNG basename — `.png` → `.json` so
      // explicit filenames pair correctly. Falls back to the legacy
      // `microbes-${stamp}.json` template when no filename override.
      const jsonName = ctx.filename
        ? ctx.filename.replace(/\.png$/i, '.json')
        : `microbes-${stamp}.json`;
      downloadBlob(jsonBlob, jsonName);
    } catch (err) {
      // Sidecar is debug-only — never block the PNG path.
      // eslint-disable-next-line no-console
      console.warn('[screenshot] sidecar build failed:', err);
    }
  }
  return stamp;
}
