// Extracts purchase date, merchant, total and the merchant's VAT number from
// receipt OCR text. Pure functions: unit-tested in tests/receipt-parser.test.js.
//
// The rules follow the Italian "documento commerciale" printed by every
// registratore telematico since 2020: seller name and P.IVA in the header,
// "TOTALE COMPLESSIVO" and "DI CUI IVA", the payment lines (contante /
// elettronico, resto), and date + time + "DOCUMENTO N." in the footer.

import { toISODate } from '../core/dates.js';

const MONTHS = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };

/** OCR often reads 0 as O next to digits, and a final 0 as ")" in amounts ("8,5)"). */
const fixDigits = (text) => text.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').replace(/(?<=\d[.,]\d)[)\]]/g, '0');

function validDate(y, m, d, now) {
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  const max = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (dt > max || y < 2000) return null;
  return dt;
}

/**
 * Most plausible purchase date (not in the future; older than 6 years only
 * scores lower, so an old receipt is still read) with the
 * time printed right after it, if any: { date: "2026-11-14", time: "18:42" | null }.
 */
export function extractDateTime(text, now = new Date()) {
  const cands = [];
  const t = fixDigits(text);
  let m;
  const reNum = /(?<!\d)(\d{1,2})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{4}|\d{2})(?!\d)/g;
  while ((m = reNum.exec(t))) {
    const dt = validDate(+m[3], +m[2], +m[1], now);
    if (dt) {
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 30).toLowerCase();
      const before = t.slice(Math.max(0, m.index - 16), m.index).toLowerCase();
      const hm = /^\s*(?:ore|h)?\s*(\d{1,2})[:.](\d{2})(?!\d)/.exec(after);
      const time = hm && +hm[1] < 24 && +hm[2] < 60 ? `${hm[1].padStart(2, '0')}:${hm[2]}` : null;
      let score = 1;
      if (time) score += 2; // followed by a time
      if (/doc(umento)?\.?\s*n/.test(after)) score += 1; // documento commerciale footer
      if (/data|del|emess/.test(before)) score += 2;
      cands.push({ dt, score, pos: m.index, time });
    }
  }
  const reIso = /(?<!\d)(20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})(?!\d)/g;
  while ((m = reIso.exec(t))) {
    const dt = validDate(+m[1], +m[2], +m[3], now);
    if (dt) cands.push({ dt, score: 1, pos: m.index });
  }
  const reTxt =
    /(?<!\d)(\d{1,2})\s*[-.]?\s*(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?\s*[-.]?\s*(\d{4}|\d{2})(?!\d)/gi;
  while ((m = reTxt.exec(t))) {
    const dt = validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1], now);
    if (dt) cands.push({ dt, score: 1.5, pos: m.index });
  }
  if (!cands.length) return null;
  const recent = new Date(now.getFullYear() - 6, 0, 1);
  for (const c of cands) if (c.dt < recent) c.score -= 1.5;
  cands.sort((a, b) => b.score - a.score || a.pos - b.pos);
  return { date: toISODate(cands[0].dt), time: cands[0].time ?? null };
}

export const extractDate = (text, now) => extractDateTime(text, now)?.date ?? null;

const AMOUNT = /(\d{1,5}(?:[.\s]\d{3})*)\s?[,.]\s?(\d{2})(?!\d)/g;
const amountsIn = (line) =>
  [...line.matchAll(AMOUNT)]
    .map((n) => parseFloat(`${n[1].replace(/[.\s]/g, '')}.${n[2]}`))
    .filter((v) => isFinite(v) && v > 0 && v < 100000);

// Lines whose amounts are never the total
const NOT_TOTAL = /sub\s*tot|resto|\biva\b|imponibile|scont|non\s+riscosso|di\s+cui|pezzi|articoli/i;
// Labels carrying the total, strongest first. Cash paid can exceed the total
// (change is given back), so plain cash lines rank lowest.
const TOTAL_LABELS = [
  [/totale\s+complessivo|importo\s+totale|totale\s+(?:euro|eur|€)/i, 4],
  [/\btotale\b|\btot\b\.?/i, 3],
  [/pagamento\s+(?:elettronico|carta|bancomat|pos)|\bcarta\b|bancomat|\bpos\b/i, 2],
  [/contant|importo\s+pagato|\bpagato\b|da\s+pagare|\beuro\b/i, 1],
];
const CASH = /contant/i;
const CHANGE = /\bresto\b/i;

const QUANTITY = /\d\s*[x×*]\s*\d/i; // "2 X 2,00": the line below carries the item amount

/**
 * Sum of the item lines above the total line (last amount of each line). Null
 * without a total line (payments come after it, so they never count) or with
 * fewer than two items.
 */
function itemsSum(lines) {
  const end = lines.findIndex((line) => TOTAL_LABELS.some(([re, rank]) => rank >= 3 && re.test(line)));
  if (end < 0) return null;
  let sum = 0;
  let items = 0;
  for (const line of lines.slice(0, end)) {
    if (NOT_TOTAL.test(line) || QUANTITY.test(line)) continue;
    const amounts = amountsIn(line);
    if (!amounts.length) continue;
    sum += amounts.at(-1);
    items++;
  }
  return items >= 2 ? Math.round(sum * 100) / 100 : null;
}

/** The receipt total as "12,34", or null. */
export function extractTotal(text) {
  const lines = fixDigits(text).split(/\n/);
  const found = [];
  let cash = null;
  let change = null;
  lines.forEach((line, i) => {
    // Label and amount are sometimes split over two lines by the OCR
    const amounts = () => {
      const own = amountsIn(line);
      const next = lines[i + 1];
      const bareNext = next && !NOT_TOTAL.test(next) && !TOTAL_LABELS.some(([re]) => re.test(next));
      return own.length || !bareNext ? own : amountsIn(next);
    };
    if (CHANGE.test(line)) change = amounts()[0] ?? change;
    if (NOT_TOTAL.test(line)) return;
    const rule = TOTAL_LABELS.find(([re]) => re.test(line));
    if (!rule) return;
    const values = amounts();
    for (const v of values) found.push({ v, rank: rule[1] });
    if (CASH.test(line) && values.length) cash = values[0];
  });
  // Cash minus change is the exact total when no total line was read
  if (cash != null && change != null && cash > change)
    found.push({ v: Math.round((cash - change) * 100) / 100, rank: 2.5 });
  if (!found.length) return null;
  // The items add up to the total: a candidate matching their sum beats a
  // misread total line ("69,00" printed large and read as "89,00")
  const sum = itemsSum(lines);
  const confirmed = sum != null && found.find((f) => Math.abs(f.v - sum) < 0.005);
  if (confirmed) return confirmed.v.toFixed(2).replace('.', ',');
  const best = Math.max(...found.map((f) => f.rank));
  const v = Math.max(...found.filter((f) => f.rank === best).map((f) => f.v));
  return v.toFixed(2).replace('.', ',');
}

/** Italian VAT number check digit (Partita IVA, 11 digits). */
export function isValidVat(d) {
  if (!/^\d{11}$/.test(d) || /^0+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = +d[i];
    if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return (10 - (sum % 10)) % 10 === +d[10];
}

/** The seller's Partita IVA (mandatory on the documento commerciale), or null. */
export function extractVat(text) {
  const t = fixDigits(text);
  const labelled =
    /(?:\bp[.,]*\s*i\.?\s*v\.?\s*a\b\.?|partita\s+iva|vat|c\.?\s?f\.?)[^\d\n]{0,14}((?:\d\s?){11})(?!\d)/gi;
  for (const m of t.matchAll(labelled)) {
    const d = m[1].replace(/\s/g, '');
    if (isValidVat(d)) return d;
  }
  return null;
}

// Header lines that are certainly not the shop name
const NOISE =
  /\b(documento|commerciale|scontrino|fiscale|p\.?\s?iva|partita|c\.?\s?f|codice|via|viale|piazza|corso|tel|telefono|fax|cassa|benvenut\w*|grazie|cap|vendita|descrizione|prezzo|euro|operatore|ricevuta|fattura|cliente|reparto|punto\s+vendita)\b|www|http|@/i;
// Company forms, removed from the suggested name
const COMPANY = /(^|\s)(s\.?p\.?a|s\.?r\.?l\.?s?|s\.?n\.?c|s\.?a\.?s|soc\.?\s*coop\w*)\.?(?=\s|$)/i;
// The shop name sits above the address, P.IVA or "documento commerciale"
const HEADER_END = /\b(via|viale|piazza|corso|largo|p[.,]*\s*i\.?\s*v\.?\s*a|partita|documento|tel)\b/i;
// "sas di Rossi Mario" or "Tarta snc di Fontana" names the owner: not the shop
const OWNER = /(^|\s)(s\.?p\.?a|s\.?r\.?l\.?s?|s\.?n\.?c|s\.?a\.?s|soc\.?\s*coop\w*)\.?\s+di\b/i;

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

function cleanName(line) {
  const name = line
    .replace(/[^\p{L}\d&'’ .-]/gu, ' ')
    .replace(new RegExp(COMPANY.source, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
  // Whole words up to 40 characters (two-line signs fit): never "Gelateria Bar Al"
  let out = '';
  for (const w of name.split(' ')) {
    if (out && out.length + 1 + w.length > 40) break;
    out = out ? `${out} ${w}` : w;
  }
  return titleCase(out.slice(0, 40));
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Website and e-mail domains printed on the receipt spell the name without
 * font ambiguity: when "Trattoria I Gabbiano" does not match but the usual OCR
 * fix "I" → "Il" matches "trattoriailgabbiano.it", the fixed name is right.
 */
function confirmWithDomain(name, text) {
  const domains = [...text.toLowerCase().matchAll(/([a-z0-9-]{4,})\.(?:it|com|eu|net|org|shop|store)\b/g)].map((m) =>
    squash(m[1]),
  );
  if (!domains.length || domains.some((d) => d.includes(squash(name)))) return name;
  const fixed = name.replace(/(^|\s)I(?=\s)/g, '$1Il');
  return fixed !== name && domains.some((d) => d.includes(squash(fixed))) ? fixed : name;
}

/**
 * The shop name: at the top, larger than the rest, on one line unless the
 * line right below is just as large. In order:
 * 1. the name chosen before for this receipt's P.IVA (`byVat`);
 * 2. a merchant used before, only if it appears in the header (words like
 *    "contante" in the body must never match);
 * 3. the tallest header line, clearly taller than the body text, joined with
 *    the next line when that is as tall (`heights`: line text → height, from
 *    the OCR layout);
 * 4. without heights: the first header line, company-form lines (S.r.l.,
 *    snc…: usually the legal subtitle) last.
 * Owner lines ("sas di …") are never the shop.
 */
export function extractMerchant(text, known = [], byVat = {}, heights = {}) {
  const vat = extractVat(text);
  if (vat && byVat[vat]) return byVat[vat];

  // The header: the top lines, ending where the address, P.IVA or "documento" begin
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  const end = lines.findIndex((l) => HEADER_END.test(l));
  const header = (end > 0 ? lines.slice(0, end) : lines.slice(0, 5)).filter((line) => {
    const letters = (line.match(/\p{L}/gu) || []).length;
    return letters >= 3 && letters / line.length >= 0.6 && !NOISE.test(line) && !OWNER.test(line);
  });

  const top = header.join(' ').toLowerCase();
  const knownName = known.find((k) => k.length >= 3 && top.includes(k.toLowerCase()));
  if (knownName) return knownName;

  const size = (l) => heights?.[l] || 0;
  // Normal text height: median of the lines below the header (the sign must not count)
  const below = Object.entries(heights || {}).filter(([l]) => !header.includes(l));
  const sizes = below.map(([, h]) => h).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || Infinity;
  const i = header.reduce((best, l, k) => (size(l) > size(header[best]) ? k : best), 0);
  if (header.length && size(header[i]) >= body * 1.15) {
    const next = header[i + 1];
    const title = next && size(next) >= size(header[i]) * 0.85 ? `${header[i]} ${next}` : header[i];
    const name = cleanName(title);
    if (name.length >= 3) return confirmWithDomain(name, text);
  }

  for (const line of [...header.filter((l) => !COMPANY.test(l)), ...header]) {
    const name = cleanName(line);
    if (name.length >= 3) return confirmWithDomain(name, text);
  }
  return null;
}

export function parseReceipt(text, known = [], now = new Date(), byVat = {}, heights = {}) {
  const dt = extractDateTime(text, now);
  return {
    date: dt?.date ?? null,
    time: dt?.time ?? null,
    merchant: extractMerchant(text, known, byVat, heights),
    total: extractTotal(text),
    vat: extractVat(text),
  };
}
