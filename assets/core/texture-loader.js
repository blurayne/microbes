// Tiny image-asset loader.
//
// First image-sampled bg lands in PR-22x (tissue texture). The
// codebase otherwise has zero image-loading precedent — every other
// background is an inline procedural shader. This helper exists so
// future texture-backed bgs (or other layers) don't each invent
// their own decode + cache path.
//
// Loads are LAZY: the image fetch + decode only happens the first
// time a caller asks for it. Repeated calls share the same Promise.
// Renderers attach their own GPU-resource creation to `.then(...)`.

const _cache = new Map();    // url → Promise<ImageBitmap | HTMLImageElement>

// Returns a Promise that resolves to a decoded image. Prefers
// `createImageBitmap` (off-thread decode + GPU-friendly format) and
// falls back to `<img>` for environments that don't expose it
// (rare in shipping browsers; the path mostly catches the node
// import-smoke test where `Image` exists but no DOM is wired).
export function loadTexture(url) {
  if (_cache.has(url)) return _cache.get(url);
  let p;
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    p = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error('texture HTTP ' + r.status + ' ' + url);
        return r.blob();
      })
      .then(blob => createImageBitmap(blob));
  } else if (typeof Image !== 'undefined') {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('texture <img> failed ' + url));
      img.src = url;
    });
  } else {
    p = Promise.reject(new Error('no image loader available'));
  }
  _cache.set(url, p);
  // Drop failed entries from the cache so a retry can re-attempt
  // the network fetch instead of replaying the rejection.
  p.catch(() => _cache.delete(url));
  return p;
}
