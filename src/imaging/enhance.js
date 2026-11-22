// "Scanner look" enhancement:
//  1. estimate the paper/illumination background (dilate + median blur removes text)
//  2. divide by it → shadows and uneven light disappear, paper becomes even
//  3. measure this receipt's paper and ink, and map them to the paper and ink
//     levels that `intensity` asks for (resultLut). The slider sets the result,
//     not the amount of change: a faded and a dark receipt end up alike.
// The background estimate is split out so the live preview can reuse it while
// the slider moves.

import { CONFIG } from '../config.js';
import { loadOpenCV, withMats } from './opencv.js';
import { createCanvas, ctx2d, scaleCanvas } from './canvas.js';

export async function estimateBackground(src) {
  const cv = await loadOpenCV();
  const small = scaleCanvas(src, 700);
  return withMats((track) => {
    const m = track(cv.imread(small));
    const gray = track(new cv.Mat());
    cv.cvtColor(m, gray, cv.COLOR_RGBA2GRAY);
    const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9)));
    const dil = track(new cv.Mat());
    cv.dilate(gray, dil, kernel);
    const bg = track(new cv.Mat());
    cv.medianBlur(dil, bg, 21);
    const big = track(new cv.Mat());
    cv.resize(bg, big, new cv.Size(src.width, src.height), 0, 0, cv.INTER_LINEAR);
    return new Uint8Array(big.data);
  });
}

const luma = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;

/** Luminance below which a share `q` of the pixels lies. */
function percentile(hist, total, q) {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * q) return v;
  }
  return 255;
}

/**
 * Tone curve chosen by the result. Measures this receipt and maps its ink and
 * paper linearly onto targets set by `intensity` alone: 0 → soft grey ink on
 * off-white, 100 → black on white.
 * - paper: the median luminance (most of a receipt is paper);
 * - ink: the darkest 2%. Print covers more than that, so this level is always
 *   real ink, never the shading of creases on crumpled paper (which a "dark
 *   class" average would include, turning the creases black).
 * @param {Uint32Array} hist luminance histogram (after illumination normalization)
 * @returns {{lut: Uint8ClampedArray, ink: number, paper: number}}
 */
export function resultLut(hist, intensity) {
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const s = Math.max(0, Math.min(1, intensity / 100));
  const paper = percentile(hist, total, 0.5);
  const ink = percentile(hist, total, 0.02);

  const inkTarget = 110 * (1 - s) ** 1.5;
  const paperTarget = 240 + 15 * s;
  const span = Math.max(8, paper - ink);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = inkTarget + ((v - ink) * (paperTarget - inkTarget)) / span;
  return { lut, ink, paper };
}

/**
 * @param {HTMLCanvasElement} src
 * @param {Uint8Array} bg background luminance, same size as src
 * @param {{intensity?: number, mode?: 'color'|'gray'}} opts
 */
export function enhanceWithBackground(src, bg, { intensity = CONFIG.defaultIntensity, mode = 'color' } = {}) {
  const { width: w, height: h } = src;
  const n = w * h;
  const orig = ctx2d(src).getImageData(0, 0, w, h).data;
  const gray = mode === 'gray';
  const out = new Uint8ClampedArray(orig.length);

  // Pass 1: illumination normalization + luminance histogram
  const norm = new Float32Array(n * 3);
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const f = 255 / Math.max(24, bg[i]);
    const r = Math.min(255, orig[p] * f);
    const g = Math.min(255, orig[p + 1] * f);
    const b = Math.min(255, orig[p + 2] * f);
    norm[i * 3] = r;
    norm[i * 3 + 1] = g;
    norm[i * 3 + 2] = b;
    const l = luma(r, g, b) | 0;
    lum[i] = l;
    hist[l]++;
  }

  // Pass 2: map the measured ink/paper to the requested result, keeping colour
  const { lut } = resultLut(hist, intensity);
  const sat = 1 + 0.25 * Math.max(0, Math.min(1, intensity / 100));
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const L = lum[i];
    const Ln = lut[L];
    if (gray) {
      out[p] = out[p + 1] = out[p + 2] = Ln;
    } else {
      const k = L > 0 ? Ln / L : 0;
      out[p] = Ln + (norm[i * 3] * k - Ln) * sat;
      out[p + 1] = Ln + (norm[i * 3 + 1] * k - Ln) * sat;
      out[p + 2] = Ln + (norm[i * 3 + 2] * k - Ln) * sat;
    }
    out[p + 3] = 255;
  }
  const c = createCanvas(w, h);
  ctx2d(c).putImageData(new ImageData(out, w, h), 0, 0);
  return c;
}

export async function enhance(src, opts) {
  return enhanceWithBackground(src, await estimateBackground(src), opts);
}
