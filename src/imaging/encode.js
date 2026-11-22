// Image encoding. WebP natively where supported (Chrome/Firefox/Android);
// Safari cannot encode WebP from a canvas, so a WebAssembly encoder is loaded
// on demand. JPEG is the last-resort fallback.

import { CONFIG } from '../config.js';
import { canvasToBlob, createCanvas, ctx2d, scaleCanvas } from './canvas.js';

let nativeWebp = null;

async function supportsNativeWebp() {
  if (nativeWebp === null) {
    try {
      nativeWebp = (await canvasToBlob(createCanvas(2, 2), 'image/webp', 0.8)).type === 'image/webp';
    } catch {
      nativeWebp = false;
    }
  }
  return nativeWebp;
}

/** @returns {Promise<{bytes: Uint8Array, mime: string, ext: string}>} */
export async function encodeFinal(canvas, quality = CONFIG.webpQuality) {
  if (await supportsNativeWebp()) {
    const b = await canvasToBlob(canvas, 'image/webp', quality);
    return { bytes: new Uint8Array(await b.arrayBuffer()), mime: 'image/webp', ext: 'webp' };
  }
  try {
    const { default: encode } = await import('@jsquash/webp/encode.js');
    const data = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
    const buf = await encode(data, { quality: Math.round(quality * 100), method: 4 });
    return { bytes: new Uint8Array(buf), mime: 'image/webp', ext: 'webp' };
  } catch (e) {
    console.warn('WASM WebP encoder unavailable, falling back to JPEG', e);
    const b = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    return { bytes: new Uint8Array(await b.arrayBuffer()), mime: 'image/jpeg', ext: 'jpg' };
  }
}

/** High-quality intermediate format for drafts (fast, browser-native). */
export async function encodeIntermediate(canvas) {
  return (await supportsNativeWebp())
    ? canvasToBlob(canvas, 'image/webp', 0.95)
    : canvasToBlob(canvas, 'image/jpeg', 0.95);
}

export function makeThumbnail(canvas, maxSide = 360) {
  return canvasToBlob(scaleCanvas(canvas, maxSide), 'image/jpeg', 0.8);
}
