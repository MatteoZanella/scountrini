// Identifiers and OneDrive-safe file naming.

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars (0/o, 1/l/i)

export function makeId(len = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${makeId(12)}`;
}

/**
 * Makes free text safe for a OneDrive/Windows file name:
 * strips reserved characters, collapses whitespace into dashes, caps length.
 */
export function sanitizeForFileName(s, maxLen = 40) {
  let t = (s || '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f"*:<>?/\\|#%&{}~+_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (t.length > maxLen) t = t.slice(0, maxLen).replace(/[.-]+$/, '');
  return t;
}

/**
 * `2026-11-21_18-42_LC_Lidl.webp`: date and print time make it practically
 * unique and sort it chronologically. The time is left out when unknown.
 * Clashes get `-2`, `-3`, … at upload time (see uploadFile).
 */
export function buildFileName({ date, time, branca, merchant, ext = 'webp' }) {
  const m = sanitizeForFileName(merchant) || 'documento';
  const hm = time ? `_${time.replace(':', '-')}` : '';
  return `${date}${hm}_${branca}_${m}.${ext}`;
}

/** `a.webp` → `a-2.webp` for n = 2; n = 1 keeps the name. */
export const withCounter = (name, n) => (n < 2 ? name : name.replace(/(\.[^.]*)?$/, (ext) => `-${n}${ext}`));
