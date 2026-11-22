import { describe, expect, it, vi } from 'vitest';

// In-memory localStorage: settings.js persists there
const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
});
const { settings } = await import('../src/core/settings.js');

describe('merchant memory', () => {
  it('remembers the name chosen for a P.IVA, and the latest correction wins', () => {
    settings.rememberMerchant('Lidl Italia', '02275030233');
    settings.rememberMerchant('Lidl', '02275030233'); // the user corrected the name
    expect(settings.get('merchantByVat')['02275030233']).toBe('Lidl');
    expect(Object.keys(settings.get('merchantByVat'))).toHaveLength(1);
  });

  it('keeps the autocomplete list without duplicates, newest first', () => {
    settings.rememberMerchant('Cadoro');
    settings.rememberMerchant('lidl');
    expect(settings.get('merchants').slice(0, 2)).toEqual(['lidl', 'Cadoro']);
    expect(settings.get('merchants').filter((m) => m.toLowerCase() === 'lidl')).toHaveLength(1);
  });
});
