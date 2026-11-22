// Embeds EXIF/XMP into WebP (extended VP8X RIFF container) or JPEG (APP1).

const enc = new TextEncoder();

// --------------------------------------------------------------------------
// Embedding into the containers
// --------------------------------------------------------------------------
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function riffChunk(id, data) {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(enc.encode(id));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

/** Adds EXIF and XMP to a WebP file (converting it to the extended VP8X format). */
export function muxWebp(webp, { width, height, exif, xmp }) {
  const b = webp instanceof Uint8Array ? webp : new Uint8Array(webp);
  if (fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') throw new Error('WebP non valido');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunks = [];
  let off = 12;
  while (off + 8 <= b.length) {
    const id = fourcc(b, off);
    const size = dv.getUint32(off + 4, true);
    chunks.push({ id, data: b.subarray(off + 8, off + 8 + size) });
    off += 8 + size + (size & 1);
  }
  const vp8x = chunks.find((c) => c.id === 'VP8X');
  let flags = 0;
  if (vp8x) {
    flags = vp8x.data[0];
  } else {
    const img = chunks.find((c) => c.id === 'VP8L');
    if (img && img.data.length >= 5) {
      const bits = new DataView(img.data.buffer, img.data.byteOffset + 1, 4).getUint32(0, true);
      if ((bits >> 28) & 1) flags |= 0x10;
    }
  }
  if (exif) flags |= 0x08;
  if (xmp) flags |= 0x04;
  const head = new Uint8Array(10);
  head[0] = flags;
  const w = (vp8x ? 1 + (vp8x.data[4] | (vp8x.data[5] << 8) | (vp8x.data[6] << 16)) : width) - 1;
  const h = (vp8x ? 1 + (vp8x.data[7] | (vp8x.data[8] << 8) | (vp8x.data[9] << 16)) : height) - 1;
  head.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);

  const parts = [riffChunk('VP8X', head)];
  for (const c of chunks) {
    if (c.id === 'VP8X' || c.id === 'EXIF' || c.id === 'XMP ') continue;
    parts.push(riffChunk(c.id, c.data));
  }
  if (exif) parts.push(riffChunk('EXIF', exif));
  if (xmp) parts.push(riffChunk('XMP ', enc.encode(xmp)));

  const bodyLen = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(12 + bodyLen);
  out.set(enc.encode('RIFF'));
  new DataView(out.buffer).setUint32(4, 4 + bodyLen, true);
  out.set(enc.encode('WEBP'), 8);
  let p = 12;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** Adds EXIF and XMP to a JPEG (used only when WebP is not available). */
export function muxJpeg(jpeg, { exif, xmp }) {
  const b = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  const segs = [];
  const app1 = (payload) => {
    const s = new Uint8Array(4 + payload.length);
    s[0] = 0xff;
    s[1] = 0xe1;
    s[2] = ((payload.length + 2) >> 8) & 0xff;
    s[3] = (payload.length + 2) & 0xff;
    s.set(payload, 4);
    return s;
  };
  if (exif && exif.length < 65000) {
    const p = new Uint8Array(6 + exif.length);
    p.set(enc.encode('Exif\0\0'));
    p.set(exif, 6);
    segs.push(app1(p));
  }
  if (xmp) {
    const x = enc.encode(xmp);
    const ns = enc.encode('http://ns.adobe.com/xap/1.0/\0');
    if (x.length + ns.length < 65000) {
      const p = new Uint8Array(ns.length + x.length);
      p.set(ns);
      p.set(x, ns.length);
      segs.push(app1(p));
    }
  }
  // Skip SOI and the APP0 (JFIF) segment, if any
  let off = 2;
  if (b[2] === 0xff && b[3] === 0xe0) off = 4 + ((b[4] << 8) | b[5]);
  const total = off + segs.reduce((s, x) => s + x.length, 0) + (b.length - off);
  const out = new Uint8Array(total);
  out.set(b.subarray(0, off));
  let p = off;
  for (const s of segs) {
    out.set(s, p);
    p += s.length;
  }
  out.set(b.subarray(off), p);
  return out;
}

// --------------------------------------------------------------------------
// Image data without metadata
// --------------------------------------------------------------------------
const META_CHUNKS = new Set(['VP8X', 'EXIF', 'XMP ', 'ICCP']);

/** JPEG without APP1 segments (EXIF/XMP): still a valid JPEG. */
export function stripJpegMetadata(jpeg) {
  const b = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  const keep = [b.subarray(0, 2)];
  let off = 2;
  while (off + 4 <= b.length && b[off] === 0xff && b[off + 1] !== 0xda) {
    const end = off + 2 + ((b[off + 2] << 8) | b[off + 3]);
    if (b[off + 1] !== 0xe1) keep.push(b.subarray(off, end));
    off = end;
  }
  keep.push(b.subarray(off)); // start of scan onwards: the compressed image
  const out = new Uint8Array(keep.reduce((s, k) => s + k.length, 0));
  let p = 0;
  for (const k of keep) {
    out.set(k, p);
    p += k.length;
  }
  return out;
}

/**
 * The encoded pixels only, without EXIF/XMP: two files with equal image data
 * show the same picture whatever their metadata says.
 */
export function imageData(bytes, mime) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (mime === 'image/jpeg') return stripJpegMetadata(b);
  if (fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') return b;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts = [];
  for (let off = 12; off + 8 <= b.length;) {
    const size = dv.getUint32(off + 4, true);
    if (!META_CHUNKS.has(fourcc(b, off))) parts.push(b.subarray(off, off + 8 + size));
    off += 8 + size + (size & 1);
  }
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of parts) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

/** True when both files carry the same image data. */
export function sameImage(a, b, mime) {
  const x = imageData(a, mime);
  const y = imageData(b, mime);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
