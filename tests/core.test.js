import { describe, expect, it } from 'vitest';
import { associativeYear, shortYearLabel, yearOptions, toExifDate, parseISODate } from '../src/core/dates.js';
import { buildFileName, makeId, sanitizeForFileName, withCounter } from '../src/core/naming.js';
import { normalizeAmount } from '../src/core/format.js';
import { brancaLabel, brancaOptions } from '../src/core/branche.js';

describe('associativeYear', () => {
  it('starts on October 1st', () => {
    expect(associativeYear('2025-09-30')).toBe('2024-2025');
    expect(associativeYear('2025-10-01')).toBe('2025-2026');
    expect(associativeYear('2026-01-15')).toBe('2025-2026');
    expect(associativeYear('2026-12-31')).toBe('2026-2027');
  });

  it('formats short labels and options', () => {
    expect(shortYearLabel('2024-2025')).toBe('2024-25');
    const opts = yearOptions('2026-11-21');
    expect(opts[0]).toBe('2027-2028');
    expect(opts).toContain('2026-2027');
    expect(opts).toContain('2021-2022');
  });
});

describe('dates', () => {
  it('rejects invalid ISO dates', () => {
    expect(parseISODate('2026-02-30')).toBeNull();
    expect(parseISODate('nope')).toBeNull();
  });

  it('formats EXIF timestamps', () => {
    expect(toExifDate(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026:01:02 03:04:05');
  });
});

describe('file naming', () => {
  it('sanitizes merchants for OneDrive', () => {
    expect(sanitizeForFileName('  Bar "Da Gigi" / Pizzeria? ')).toBe('Bar-Da-Gigi-Pizzeria');
    expect(sanitizeForFileName('Caffè Città')).toBe('Caffè-Città');
    expect(sanitizeForFileName('a_b')).toBe('a-b');
    expect(sanitizeForFileName('...')).toBe('');
  });

  it('builds sortable names from date and print time', () => {
    expect(buildFileName({ date: '2026-11-21', time: '18:42', branca: 'LC', merchant: 'Lidl' })).toBe(
      '2026-11-21_18-42_LC_Lidl.webp',
    );
    expect(buildFileName({ date: '2026-11-21', time: '', branca: 'EG', merchant: '', ext: 'jpg' })).toBe(
      '2026-11-21_EG_documento.jpg',
    );
  });

  it('numbers clashing names', () => {
    expect(withCounter('2026-11-21_18-42_LC_Lidl.webp', 1)).toBe('2026-11-21_18-42_LC_Lidl.webp');
    expect(withCounter('2026-11-21_18-42_LC_Lidl.webp', 3)).toBe('2026-11-21_18-42_LC_Lidl-3.webp');
    expect(withCounter('senza-estensione', 2)).toBe('senza-estensione-2');
  });

  it('makes short unambiguous ids', () => {
    expect(makeId(5)).toMatch(/^[a-hj-km-np-z2-9]{5}$/);
  });
});

describe('normalizeAmount', () => {
  it.each([
    ['12,5', '12,50'],
    ['12.50', '12,50'],
    ['€ 1.234,56', '1234,56'],
    ['7', '7,00'],
    ['abc', null],
    ['', null],
  ])('%s → %s', (input, out) => expect(normalizeAmount(input)).toBe(out));
});

describe('branche', () => {
  it('shows the official abbreviations while codes stay folder-safe', () => {
    expect(brancaLabel('LC')).toBe('L/C');
    expect(brancaLabel('EG')).toBe('E/G');
    expect(brancaLabel('RS')).toBe('R/S');
    expect(brancaOptions().every((o) => !o.value.includes('/'))).toBe(true);
  });

  it('gives screen readers the full branch name', () => {
    expect(brancaOptions().find((o) => o.value === 'RS').ariaLabel).toBe('R/S, Rover e Scolte');
  });
});
