import { describe, expect, it } from 'vitest';
import {
  extractDate,
  extractDateTime,
  extractMerchant,
  extractTotal,
  extractVat,
  isValidVat,
  parseReceipt,
} from '../src/ocr/receipt-parser.js';
import { rowsFromLines } from '../src/ocr/layout.js';

const NOW = new Date(2026, 10, 21);

const LIDL = `LIDL ITALIA S.R.L.
Via Roma 12 - 30100 Venezia
P.IVA 02275030233
DOCUMENTO COMMERCIALE
di vendita o prestazione
PANE INTEGRALE      1,29
LATTE PS            0,99
SUBTOTALE           2,28
TOTALE COMPLESSIVO  2,28
Pagamento contante  5,00
Resto               2,72
14-11-2026 18:42 DOC.N. 0123-0456`;

// A real receipt (2014): sign on the first line, owner company on the second
const GELATERIA = `GELATERIA BAR AL PORTO
sas di Soncini Vinicio e Luca
Via Lungolago Marconi N.2 - 37017 Lazise
N. Rea 360493-Verona - Cap.Soc. 5.000'00
P.IVA 03726130234 - TEL. 045/7580538
EURO
TONICA 3,50
3/4 GAS 5,00
TOTALE EURO 8,50
CONTANTE 8,50
RESTO 0,00
Tavolo: 113
14-09-14 15:55 SF. 162
EN 99007862`;

describe('a real receipt', () => {
  it('reads all fields of an older receipt whose owner line starts with "sas di"', () => {
    expect(parseReceipt(GELATERIA, [], NOW)).toEqual({
      date: '2014-09-14',
      time: '15:55',
      merchant: 'Gelateria Bar Al Porto',
      total: '8,50',
      vat: '03726130234',
    });
  });
});

describe('extractDate', () => {
  it('finds dates followed by a time', () => {
    expect(extractDate(LIDL, NOW)).toBe('2026-11-14');
  });

  it('prefers the documento commerciale footer over other dates', () => {
    expect(extractDate('Scadenza buono 30/11/2026\n14-11-2026 18:42 DOCUMENTO N. 0001-0002', NOW)).toBe('2026-11-14');
  });

  it('reads the print time after the date', () => {
    expect(extractDateTime(LIDL, NOW)).toEqual({ date: '2026-11-14', time: '18:42' });
    expect(extractDateTime('del 03.10.26 ore 9.05', NOW)).toEqual({ date: '2026-10-03', time: '09:05' });
    expect(extractDateTime('12 nov 2026', NOW)).toEqual({ date: '2026-11-12', time: null });
    expect(extractDateTime('14/11/2026 25:99', NOW).time).toBeNull();
  });

  it('accepts 2-digit years and dots', () => {
    expect(extractDate('del 03.10.26 ore 10:01', NOW)).toBe('2026-10-03');
  });

  it('accepts month names', () => {
    expect(extractDate('12 nov 2026', NOW)).toBe('2026-11-12');
  });

  it('ignores future and invalid dates', () => {
    expect(extractDate('31/02/2026 01/01/2030', NOW)).toBeNull();
  });

  it('fixes O/0 OCR confusion', () => {
    expect(extractDate('1O/11/2026 12:00', NOW)).toBe('2026-11-10');
  });
});

describe('extractTotal', () => {
  it('prefers TOTALE over payment lines', () => {
    expect(extractTotal(LIDL)).toBe('2,28');
  });

  it('reads the amount from the next line when the OCR splits it', () => {
    expect(extractTotal('TOTALE COMPLESSIVO\n23,40\nPAGAMENTO CONTANTE 50,00\nRESTO 26,60')).toBe('23,40');
  });

  it('does not take DI CUI IVA as the split amount', () => {
    expect(extractTotal('TOTALE COMPLESSIVO\nDI CUI IVA 4,22\nPAGAMENTO ELETTRONICO 23,40')).toBe('23,40');
  });

  it('computes cash minus change when no total line was read', () => {
    expect(extractTotal('PAGAMENTO CONTANTE 50,00\nRESTO 26,60')).toBe('23,40');
  });

  it('prefers electronic payment over cash handed over', () => {
    expect(extractTotal('PAGAMENTO ELETTRONICO 23,40\nCONTANTI 50,00')).toBe('23,40');
  });

  it('trusts the amount that matches the sum of the items over a misread total line', () => {
    const text = [
      '2 X 2,00',
      'Menu Carta 4,00',
      'Gnocchi rosa 10,00',
      'Ravioli Castelmagno 12,00',
      'Secondo Piatto 10,00',
      'Stinco 12,00',
      'Crema di zabaione 5,00',
      'bicchiere abbinato 4,00',
      'Vino rosso 10,00',
      'Caffe al tavolo 2,00',
      'TOTALE EURO 89,00', // the large "69" read as "89"
      'CONTANTI 69,00',
    ].join('\n');
    expect(extractTotal(text)).toBe('69,00');
  });

  it('reads a final zero misread as a bracket', () => {
    expect(extractTotal('TOTALE EURO 8,5)\nCONTANTE 10,00\nRESTO 1,50')).toBe('8,50');
  });

  it('ignores discounts, VAT and item counts', () => {
    expect(extractTotal('TOTALE SCONTI 30,00\nTOTALE PEZZI 3\nTOTALE EURO 12,50\nDI CUI IVA 2,25')).toBe('12,50');
  });

  it('returns null without totals', () => {
    expect(extractTotal('nessun importo')).toBeNull();
  });
});

describe('extractVat', () => {
  it('validates the check digit', () => {
    expect(isValidVat('02275030233')).toBe(true);
    expect(isValidVat('02275030234')).toBe(false);
    expect(isValidVat('00000000000')).toBe(false);
  });

  it('finds the labelled P.IVA, tolerating spaces and O/0 mix-ups', () => {
    expect(extractVat(LIDL)).toBe('02275030233');
    expect(extractVat('P. IVA IT 0227 5O30 233')).toBe('02275030233');
    expect(extractVat('P., Iva: 01522310190')).toBe('01522310190'); // stray comma read by the OCR
  });

  it('rejects numbers that fail the check digit', () => {
    expect(extractVat('P.IVA 02275030234')).toBeNull();
  });
});

describe('extractMerchant', () => {
  it('recognises a shop by its P.IVA even when the name is unreadable', () => {
    expect(extractMerchant('~~ ##\nP.IVA 02275030233', [], { '02275030233': 'Lidl' })).toBe('Lidl');
  });

  it('prefers the line printed larger (the shop sign), when the OCR layout gives heights', () => {
    const text = 'IL MEGLIO PER TE\nSUPERMERCATO ROSSI\nROSSI SRL\nVia Roma 1\nPANE 1,20\nTOTALE 1,20';
    const heights = {
      'IL MEGLIO PER TE': 20,
      'SUPERMERCATO ROSSI': 42,
      'ROSSI SRL': 20,
      'Via Roma 1': 20,
      'PANE 1,20': 21,
      'TOTALE 1,20': 40,
    };
    expect(extractMerchant(text, [], {}, heights)).toBe('Supermercato Rossi');
  });

  it('joins a sign printed over two equally large lines, and ignores large lines in the body', () => {
    const text = 'PIZZERIA\nDA MARIO\nRossi Mario & C.\nVia Roma 1\nTOTALE EURO 23,00\nCONTANTE 23,00';
    const heights = {
      PIZZERIA: 60,
      'DA MARIO': 58,
      'Rossi Mario & C.': 30,
      'Via Roma 1': 30,
      'TOTALE EURO 23,00': 64,
      'CONTANTE 23,00': 30,
    };
    expect(extractMerchant(text, [], {}, heights)).toBe('Pizzeria Da Mario');
  });

  it('matches merchants used before only in the header, never in the body', () => {
    const text = 'GELATERIA BAR AL PORTO\nVia Lungolago 2\nTOTALE EURO 8,50\nCONTANTE 8,50';
    expect(extractMerchant(text, ['Contante'])).toBe('Gelateria Bar Al Porto');
  });

  it('prefers the shop sign over the legal subtitle with the company form', () => {
    expect(extractMerchant('TRATTORIA DA MARIO\nROSSI MARIO SRL\nVia Roma 1')).toBe('Trattoria Da Mario');
  });

  it('uses the company-form line when it is the only name in the header (sign printed as a logo)', () => {
    expect(extractMerchant('LIDL ITALIA S.R.L.\nVia Roma 12\nTOTALE COMPLESSIVO 2,28')).toBe('Lidl Italia');
  });

  it('uses the header line, dropping company suffixes', () => {
    expect(extractMerchant(LIDL)).toBe('Lidl Italia');
  });

  it('fixes the article misread by the OCR when the printed website confirms it', () => {
    const text =
      'Trattoria I Gabbiano\nTarta snc di Fontana Stefania & c.\nTel. 0372-95108 - info@trattoriailgabbiano.it';
    expect(extractMerchant(text)).toBe('Trattoria Il Gabbiano');
    expect(extractMerchant('I Gabbiani\nwww.igabbiani.it')).toBe('I Gabbiani'); // a real "I" stays
  });

  it('accepts short shop names', () => {
    expect(extractMerchant('OVS\nVia Roma 1')).toBe('Ovs');
    expect(extractMerchant('BAR SPORT\nVia Roma 1')).toBe('Bar Sport');
  });

  it('prefers known merchants', () => {
    expect(extractMerchant('xxxx\nSUPERMERCATO CADORO\n', ['Cadoro'])).toBe('Cadoro');
  });
});

it('parseReceipt combines everything', () => {
  expect(parseReceipt(LIDL, [], NOW)).toEqual({
    date: '2026-11-14',
    time: '18:42',
    merchant: 'Lidl Italia',
    total: '2,28',
    vat: '02275030233',
  });
});

describe('rowsFromLines', () => {
  const box = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });

  it('joins a price read as a separate column back onto its label row', () => {
    const rows = rowsFromLines([
      box('TOTALE EURO', 10, 100, 220, 140),
      box('CONTANTE', 10, 160, 160, 190),
      box('8,50', 400, 102, 460, 138), // the price column, read after the labels
      box('10,00', 390, 161, 460, 189),
    ]);
    expect(rows.map((r) => r.text)).toEqual(['TOTALE EURO  8,50', 'CONTANTE  10,00']);
    expect(extractTotal(rows.map((r) => r.text).join('\n'))).toBe('8,50');
  });

  it('keeps rows that only touch apart and reports the tallest piece as the row height', () => {
    const rows = rowsFromLines([box('GELATERIA BAR', 10, 0, 300, 80), box('sas di Rossi', 10, 70, 200, 110)]);
    expect(rows).toEqual([
      { text: 'GELATERIA BAR', height: 80 },
      { text: 'sas di Rossi', height: 40 },
    ]);
  });
});
