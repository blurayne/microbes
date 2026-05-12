// Tiny transient toast. Single live element at the bottom of the
// viewport that auto-dismisses after a few seconds. Calls reuse the
// same DOM node — a second call before the first dismisses just
// replaces the text and resets the timer.

let _el = null;
let _hideTimer = 0;

function ensureEl() {
  if (_el && _el.isConnected) return _el;
  _el = document.createElement('div');
  _el.className = 'toast';
  _el.setAttribute('role', 'status');
  _el.setAttribute('aria-live', 'polite');
  document.body.appendChild(_el);
  return _el;
}

export function showToast(message, durationMs = 1800) {
  const el = ensureEl();
  el.textContent = message;
  el.classList.add('on');
  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    el.classList.remove('on');
    _hideTimer = 0;
  }, durationMs);
}

// Copy `text` to the OS clipboard. Tries navigator.clipboard first
// (modern, requires secure context), falls back to a hidden textarea
// + document.execCommand for older browsers. Returns a Promise that
// resolves to true on success, false on failure. Never throws.
export async function copyToClipboard(text) {
  const str = String(text == null ? '' : text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(str);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}
