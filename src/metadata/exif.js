// EXIF (TIFF) reading from JPEG photos and writing for the final document.
// Text tags are written as UTF-8 plus Windows XP* tags (UCS-2), which File
// Explorer shows under Properties → Details.

const enc = new TextEncoder();

// --------------------------------------------------------------------------
// EXIF reading from JPEG (capture date and GPS of gallery photos)
// --------------------------------------------------------------------------
export function readJpegExif(buffer) {
  try {
    const v = new DataView(buffer);
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        return parseTiff(v, off + 10);
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      off += 2 + size;
    }
  } catch {
    /* malformed EXIF: ignore */
  }
  return null;
}

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const readIFD = (o) => {
    const n = u16(o);
    const tags = {};
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), off: e + 8 };
    }
    return tags;
  };
  const valueOffset = (t) => {
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 };
    return (sizes[t.type] || 1) * t.count > 4 ? u32(t.off) : t.off;
  };
  const ascii = (t) => {
    const o = valueOffset(t);
    let s = '';
    for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const rationals = (t) => {
    const o = valueOffset(t);
    const out = [];
    for (let i = 0; i < t.count; i++) out.push(u32(o + i * 8) / (u32(o + i * 8 + 4) || 1));
    return out;
  };
  const ifd0 = readIFD(u32(4));
  const result = { date: null, gps: null };
  if (ifd0[0x8769]) {
    const exif = readIFD(u32(ifd0[0x8769].off));
    const t = exif[0x9003] || exif[0x9004];
    if (t) {
      const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii(t));
      if (m) result.date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
  }
  if (ifd0[0x8825]) {
    const g = readIFD(u32(ifd0[0x8825].off));
    if (g[2] && g[4]) {
      const toDeg = ([d, m, s]) => d + m / 60 + s / 3600;
      let lat = toDeg(rationals(g[2]));
      let lon = toDeg(rationals(g[4]));
      if (g[1] && ascii(g[1]).startsWith('S')) lat = -lat;
      if (g[3] && ascii(g[3]).startsWith('W')) lon = -lon;
      if (isFinite(lat) && isFinite(lon) && (lat || lon)) result.gps = { lat, lon };
    }
  }
  return result;
}

// --------------------------------------------------------------------------
// EXIF writing (little-endian TIFF)
// --------------------------------------------------------------------------
const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 };

const asciiEntry = (tag, str) => {
  const b = enc.encode(str);
  const data = new Uint8Array(b.length + 1);
  data.set(b);
  return { tag, type: T.ASCII, count: data.length, data };
};
const ucs2 = (str) => {
  const out = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
};
// Windows "XP*" tags: UCS-2 LE ending with a double zero (shown in File Explorer → Properties)
const xpEntry = (tag, str) => {
  const u = ucs2(str);
  const data = new Uint8Array(u.length + 2);
  data.set(u);
  return { tag, type: T.BYTE, count: data.length, data };
};
const longEntry = (tag, n) => {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setUint32(0, n, true);
  return { tag, type: T.LONG, count: 1, data };
};
const undefinedEntry = (tag, bytes) => ({ tag, type: T.UNDEFINED, count: bytes.length, data: bytes });
const byteEntry = (tag, bytes) => ({ tag, type: T.BYTE, count: bytes.length, data: Uint8Array.from(bytes) });
const rationalEntry = (tag, pairs) => {
  const data = new Uint8Array(pairs.length * 8);
  const dv = new DataView(data.buffer);
  pairs.forEach(([n, d], i) => {
    dv.setUint32(i * 8, n, true);
    dv.setUint32(i * 8 + 4, d, true);
  });
  return { tag, type: T.RATIONAL, count: pairs.length, data };
};

function ifdSize(entries) {
  let s = 2 + entries.length * 12 + 4;
  for (const e of entries) if (e.data.length > 4) s += e.data.length + (e.data.length & 1);
  return s;
}

function writeIFD(out, dv, offset, entries) {
  entries.sort((a, b) => a.tag - b.tag);
  dv.setUint16(offset, entries.length, true);
  let dataOff = offset + 2 + entries.length * 12 + 4;
  entries.forEach((e, i) => {
    const p = offset + 2 + i * 12;
    dv.setUint16(p, e.tag, true);
    dv.setUint16(p + 2, e.type, true);
    dv.setUint32(p + 4, e.count, true);
    if (e.data.length <= 4) {
      out.set(e.data, p + 8);
    } else {
      dv.setUint32(p + 8, dataOff, true);
      out.set(e.data, dataOff);
      dataOff += e.data.length + (e.data.length & 1);
    }
  });
  dv.setUint32(offset + 2 + entries.length * 12, 0, true); // no next IFD
}

const toRational = (x, den = 1) => [Math.round(x * den), den];
function degToDMS(deg) {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = (a - d - m / 60) * 3600;
  return [toRational(d), toRational(m), toRational(s, 1000)];
}

/**
 * Builds an EXIF (TIFF) block with the main fields.
 * Text fields are UTF-8 (ASCII), and UCS-2 in the Windows XP* tags.
 */
export function buildExif(f) {
  const ifd0 = [];
  if (f.description) ifd0.push(asciiEntry(0x010e, f.description));
  if (f.make) ifd0.push(asciiEntry(0x010f, f.make));
  if (f.model) ifd0.push(asciiEntry(0x0110, f.model));
  if (f.software) ifd0.push(asciiEntry(0x0131, f.software));
  if (f.modifyDate) ifd0.push(asciiEntry(0x0132, f.modifyDate));
  if (f.artist) ifd0.push(asciiEntry(0x013b, f.artist));
  if (f.copyright) ifd0.push(asciiEntry(0x8298, f.copyright));
  if (f.title) ifd0.push(xpEntry(0x9c9b, f.title));
  if (f.comment) ifd0.push(xpEntry(0x9c9c, f.comment));
  if (f.artist) ifd0.push(xpEntry(0x9c9d, f.artist));
  if (f.keywords) ifd0.push(xpEntry(0x9c9e, f.keywords));
  if (f.subject) ifd0.push(xpEntry(0x9c9f, f.subject));

  const exif = [undefinedEntry(0x9000, enc.encode('0232'))];
  if (f.dateTimeOriginal) exif.push(asciiEntry(0x9003, f.dateTimeOriginal));
  if (f.dateTimeDigitized) exif.push(asciiEntry(0x9004, f.dateTimeDigitized));
  if (f.offsetTime) {
    exif.push(asciiEntry(0x9010, f.offsetTime));
    exif.push(asciiEntry(0x9011, f.offsetTime));
  }
  if (f.userComment) {
    const u = ucs2(f.userComment);
    const b = new Uint8Array(8 + u.length);
    b.set(enc.encode('UNICODE\0'));
    b.set(u, 8);
    exif.push(undefinedEntry(0x9286, b));
  }
  if (f.imageUniqueId) exif.push(asciiEntry(0xa420, f.imageUniqueId.padEnd(32, '0').slice(0, 32)));

  let gps = null;
  if (f.gps && isFinite(f.gps.lat) && isFinite(f.gps.lon)) {
    gps = [
      byteEntry(0x0000, [2, 3, 0, 0]),
      asciiEntry(0x0001, f.gps.lat >= 0 ? 'N' : 'S'),
      rationalEntry(0x0002, degToDMS(f.gps.lat)),
      asciiEntry(0x0003, f.gps.lon >= 0 ? 'E' : 'W'),
      rationalEntry(0x0004, degToDMS(f.gps.lon)),
    ];
  }

  // Pointers to the sub-IFDs (placeholders, patched later)
  ifd0.push(longEntry(0x8769, 0));
  if (gps) ifd0.push(longEntry(0x8825, 0));

  const off0 = 8;
  const offExif = off0 + ifdSize(ifd0);
  const offGps = offExif + ifdSize(exif);
  const total = offGps + (gps ? ifdSize(gps) : 0);

  ifd0.find((e) => e.tag === 0x8769).data = longEntry(0, offExif).data;
  if (gps) ifd0.find((e) => e.tag === 0x8825).data = longEntry(0, offGps).data;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0x00]); // "II*\0"
  dv.setUint32(4, off0, true);
  writeIFD(out, dv, off0, ifd0);
  writeIFD(out, dv, offExif, exif);
  if (gps) writeIFD(out, dv, offGps, gps);
  return out;
}
