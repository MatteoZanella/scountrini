// Date helpers. All dates are handled as *local* calendar dates (YYYY-MM-DD)
// to avoid the classic off-by-one caused by UTC conversion.

import { CONFIG } from '../config.js';

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** Local date as YYYY-MM-DD. */
export function toISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}

export function formatDateIT(s) {
  const d = typeof s === 'string' ? parseISODate(s) : s;
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

export function formatDateTimeIT(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** ISO 8601 local timestamp with offset, e.g. 2026-11-21T13:05:00+01:00 */
export function toLocalISOString(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  const tz = `${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`;
}

/** EXIF timestamp "YYYY:MM:DD HH:MM:SS". */
export function toExifDate(d) {
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** EXIF offset "+01:00". */
export function toExifOffset(d) {
  return toLocalISOString(d).slice(-6);
}

/** Associative year (Oct 1st – Sep 30th) of a YYYY-MM-DD date → "2025-2026". */
export function associativeYear(isoDate) {
  const d = parseISODate(isoDate) || new Date();
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= CONFIG.yearStartMonth ? y : y - 1;
  return `${start}-${start + 1}`;
}

/** "2025-2026" → "2025-26" */
export function shortYearLabel(year) {
  const m = /^(\d{4})-(\d{4})$/.exec(year);
  return m ? `${m[1]}-${m[2].slice(2)}` : year;
}

/** Selectable associative years, newest first. */
export function yearOptions(around = toISODate()) {
  const cur = +associativeYear(around).slice(0, 4);
  const out = [];
  for (let y = cur + 1; y >= cur - 5; y--) out.push(`${y}-${y + 1}`);
  return out;
}
