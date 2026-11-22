import { describe, expect, it } from 'vitest';
import { buildExif, readJpegExif } from '../src/metadata/exif.js';
import { buildXmp } from '../src/metadata/xmp.js';
import { muxJpeg, muxWebp, stripJpegMetadata, sameImage } from '../src/metadata/containers.js';

const fourcc = (b, o) => String.fromCharCode(...b.subarray(o, o + 4));

function riffChunks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let o = 12; o + 8 <= bytes.length;) {
    const size = dv.getUint32(o + 4, true);
    out.push({ id: fourcc(bytes, o), size, data: bytes.subarray(o + 8, o + 8 + size) });
    o += 8 + size + (size & 1);
  }
  return out;
}

/** RIFF header + a single VP8 chunk with dummy payload (content is irrelevant for muxing). */
function fakeWebp() {
  const payload = new Uint8Array(11).fill(7);
  const b = new Uint8Array(12 + 8 + 12);
  const dv = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0);
  dv.setUint32(4, b.length - 8, true);
  b.set(new TextEncoder().encode('WEBPVP8 '), 8);
  dv.setUint32(16, payload.length, true);
  b.set(payload, 20);
  return b;
}

describe('EXIF', () => {
  it('round-trips date and GPS through a JPEG', () => {
    const exif = buildExif({
      description: 'Scontrino Caffè',
      artist: 'Mario Rossi',
      title: 'Titolo',
      dateTimeOriginal: '2026:11:14 12:00:00',
      gps: { lat: 45.4371, lon: -12.3326 },
    });
    const jpeg = muxJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { exif });
    const parsed = readJpegExif(jpeg.buffer);
    expect(parsed.date).toEqual(new Date(2026, 10, 14, 12, 0, 0));
    expect(parsed.gps.lat).toBeCloseTo(45.4371, 4);
    expect(parsed.gps.lon).toBeCloseTo(-12.3326, 4);
  });

  it('returns null for non-JPEG data', () => {
    expect(readJpegExif(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
  });
});

describe('XMP', () => {
  it('escapes values and writes Italian custom fields', () => {
    const xmp = buildXmp({ title: 'A & B', custom: { Esercente: '<Lidl>', Vuoto: '' } });
    expect(xmp).toContain('<scontrini:Esercente>&lt;Lidl&gt;</scontrini:Esercente>');
    expect(xmp).not.toContain('Vuoto');
    expect(xmp).toContain('A &amp; B');
    expect(xmp.startsWith('<?xpacket begin="﻿"')).toBe(true);
  });

  it('rejects unsafe property names', () => {
    expect(() => buildXmp({ custom: { 'a b': 'x' } })).toThrow();
  });
});

describe('WebP muxing', () => {
  it('converts to VP8X and appends EXIF + XMP', () => {
    const out = muxWebp(fakeWebp(), { width: 1200, height: 3400, exif: new Uint8Array([1, 2, 3]), xmp: '<x/>' });
    expect(fourcc(out, 0)).toBe('RIFF');
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    const chunks = riffChunks(out);
    expect(chunks.map((c) => c.id)).toEqual(['VP8X', 'VP8 ', 'EXIF', 'XMP ']);
    const x = chunks[0].data;
    expect(x[0] & 0x0c).toBe(0x0c);
    expect(1 + (x[4] | (x[5] << 8) | (x[6] << 16))).toBe(1200);
    expect(1 + (x[7] | (x[8] << 8) | (x[9] << 16))).toBe(3400);
    expect(chunks[2].size).toBe(3);
  });

  it('replaces existing metadata instead of duplicating it', () => {
    const once = muxWebp(fakeWebp(), { width: 10, height: 10, exif: new Uint8Array([1]), xmp: 'a' });
    const twice = muxWebp(once, { width: 10, height: 10, exif: new Uint8Array([2]), xmp: 'b' });
    expect(riffChunks(twice).map((c) => c.id)).toEqual(['VP8X', 'VP8 ', 'EXIF', 'XMP ']);
  });
});

describe('image data without metadata', () => {
  it('strips the EXIF/XMP added to a JPEG, giving back the original bytes', () => {
    // SOI, a quantisation table segment, start of scan + data, EOI
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 1, 2, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);
    const tagged = muxJpeg(jpeg, { exif: new Uint8Array([1, 2, 3]), xmp: '<x/>' });
    expect(tagged.length).toBeGreaterThan(jpeg.length);
    expect(stripJpegMetadata(tagged)).toEqual(jpeg);
    expect(sameImage(tagged, jpeg, 'image/jpeg')).toBe(true);
  });
});
