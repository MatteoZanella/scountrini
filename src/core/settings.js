// Per-device user preferences (localStorage).

const KEY = 'scontrini.settings.v1';

const DEFAULTS = Object.freeze({
  userName: '',
  deviceName: '',
  branca: '',
  saveLocation: true,
  autoOcr: true,
  wifiOnly: false,
  merchants: [], // history used for autocomplete and OCR matching
  merchantByVat: {}, // P.IVA → name the user chose: recognises the shop even when its logo is not text
  installHintDismissed: false,
  theme: 'auto', // 'auto' follows the system, or 'light' / 'dark'
});

let cache = null;

function load() {
  if (!cache) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
      if (cache.branca === 'RG') cache.branca = 'RS'; // renamed: R/S is the official abbreviation
    } catch {
      cache = { ...DEFAULTS };
    }
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full or unavailable: keep in-memory value */
  }
}

export const settings = {
  get(key) {
    return load()[key];
  },
  set(key, value) {
    load()[key] = value;
    persist();
  },
  rememberMerchant(name, vat) {
    const n = (name || '').trim();
    if (!n) return;
    const list = load().merchants.filter((m) => m.toLowerCase() !== n.toLowerCase());
    list.unshift(n);
    this.set('merchants', list.slice(0, 80));
    if (vat) {
      // The latest name wins: correcting the merchant once fixes it for that P.IVA
      const others = Object.entries(load().merchantByVat).filter(([v]) => v !== vat);
      this.set('merchantByVat', Object.fromEntries([[vat, n], ...others].slice(0, 200)));
    }
  },
};
