// Small generic helpers.

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Yields to the event loop so the UI can repaint during long work. */
export const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** Parses an Italian amount ("12,34", "1.234,50") → "12,34" or null. */
export function normalizeAmount(s) {
  const t = String(s || '')
    .trim()
    .replace(/\s|€/g, '');
  if (!t) return null;
  const m = /^(\d{1,6}(?:\.\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const int = m[1].replace(/\./g, '');
  const dec = (m[2] || '00').padEnd(2, '0');
  return `${int},${dec}`;
}
