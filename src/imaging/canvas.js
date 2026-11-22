// Canvas helpers: creation, scaling, rotation, decoding and blob conversion.

import { CONFIG } from '../config.js';

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Downscales (never upscales) to fit `maxSide` and `maxPixels`. */
export function scaleCanvas(src, maxSide, maxPixels = Infinity) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height), Math.sqrt(maxPixels / (src.width * src.height)));
  if (s >= 1) return src;
  const c = createCanvas(src.width * s, src.height * s);
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function rotateCanvas(src, quarterTurns) {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (!q) return src;
  const swap = q % 2 === 1;
  const c = createCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = ctx2d(c);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Codifica immagine fallita'))), type, quality),
  );
}

export async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = createCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Formato immagine non supportato'));
    };
    img.src = url;
  });
}

/** Decodes a photo applying EXIF orientation and capping its resolution. */
export async function decodeImageFile(file) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await loadImageElement(file);
  }
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  const s = Math.min(1, CONFIG.maxPhotoSide / Math.max(w, h));
  const c = createCanvas(w * s, h * s);
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c;
}
