// "Scanner look" enhancement, in two stages:
//  1. prepare (once per photo): estimate the paper's lighting and divide by it,
//     so shadows and uneven light disappear, then bring the paper to white;
//  2. render (on every slider move): a contrast curve whose strength is the
//     `intensity` (0 = lighting fixed only, 100 = strongest). Cheap: a lookup
//     per pixel on the prepared data.
// `autoIntensity` picks, per photo, the strength that brings its ink to the
// same darkness, so every archived receipt looks alike.

import { loadOpenCV, withMats } from './opencv.js';
import { createCanvas, ctx2d, scaleCanvas } from './canvas.js';

const MAX_GAIN = 4; // deepest shadow we brighten: more only amplifies noise
const INK_TARGET = 35; // auto: where the darkest ink lands (0 = black)
const PAPER_WHITE = 250; // the lighting fix brings the paper here

/**
 * Paper lighting, as luminance per pixel (same size as src). Closing
 * (dilate + erode) with a kernel larger than the print removes the text but
 * keeps the paper's level, the blur smooths it: light varies slowly.
 */
export async function estimateBackground(src) {
  const cv = await loadOpenCV();
  const small = scaleCanvas(src, 500);
  return withMats((track) => {
    const m = track(cv.imread(small));
    const gray = track(new cv.Mat());
    cv.cvtColor(m, gray, cv.COLOR_RGBA2GRAY);
    // ≈ 4% of the long side: wider than a line of receipt text
    const k = Math.max(9, Math.round(Math.max(small.width, small.height) / 25)) | 1;
    const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k)));
    const closed = track(new cv.Mat());
    cv.morphologyEx(gray, closed, cv.MORPH_CLOSE, kernel);
    const bg = track(new cv.Mat());
    cv.GaussianBlur(closed, bg, new cv.Size(0, 0), k / 2);
    const big = track(new cv.Mat());
    cv.resize(bg, big, new cv.Size(src.width, src.height), 0, 0, cv.INTER_LINEAR);
    return new Uint8Array(big.data);
  });
}

const luma = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;

/** Luminance below which a share `q` of the pixels lies. */
function percentile(hist, q) {
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * q) return v;
  }
  return 255;
}

/**
 * Contrast curve for an intensity (0–100), the same for every photo: the black
 * point rises (ink darkens) and the white point falls a little (greyish paper
 * turns white).
 */
export function contrastLut(intensity) {
  const s = Math.max(0, Math.min(100, intensity)) / 100;
  const black = 180 * s;
  const white = 255 - 25 * s;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - black) * 255) / (white - black);
  return lut;
}

/**
 * Ink level: the darkest 2%. Print covers more than that, so it is real ink,
 * never the shading of creases.
 * @param {Uint32Array} hist luminance histogram after the lighting fix
 */
export const inkLevel = (hist) => percentile(hist, 0.02);

/** Intensity that brings this photo's ink to INK_TARGET. */
export function autoIntensity(hist) {
  const ink = inkLevel(hist);
  let best = 0;
  for (let i = 0; i <= 100; i++) {
    if (Math.abs(contrastLut(i)[ink] - INK_TARGET) < Math.abs(contrastLut(best)[ink] - INK_TARGET)) best = i;
  }
  return best;
}

/**
 * Lighting fix, once per photo: the data every render needs.
 * @param {HTMLCanvasElement} src
 */
export async function prepareEnhance(src) {
  const bg = await estimateBackground(src);
  const { width: w, height: h } = src;
  const n = w * h;
  const orig = ctx2d(src).getImageData(0, 0, w, h).data;
  const gain = (i) => Math.min(MAX_GAIN, 255 / Math.max(1, bg[i]));

  // Pass 1: measure the paper after the lighting fix. Where the estimate runs
  // a little high the paper stays greyish: scale it to white.
  let hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4)
    hist[Math.min(255, luma(orig[p], orig[p + 1], orig[p + 2]) * gain(i)) | 0]++;
  const toWhite = Math.min(1.5, Math.max(1, PAPER_WHITE / Math.max(1, percentile(hist, 0.5))));

  // Pass 2: the prepared photo
  const rgb = new Uint8ClampedArray(n * 3);
  const lum = new Uint8Array(n);
  hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const f = gain(i) * toWhite;
    rgb[i * 3] = orig[p] * f;
    rgb[i * 3 + 1] = orig[p + 1] * f;
    rgb[i * 3 + 2] = orig[p + 2] * f;
    const l = luma(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) | 0;
    lum[i] = l;
    hist[l]++;
  }
  return { w, h, rgb, lum, auto: autoIntensity(hist) };
}

/**
 * Applies the curve. Writes into `out` (an ImageData of the same size) when
 * given, so the live preview reuses one buffer.
 * @param {{intensity?: number|null, mode?: 'color'|'gray'}} opts  null intensity: auto
 */
export function renderEnhanced(prep, { intensity = null, mode = 'color' } = {}, out = null) {
  const { w, h, rgb, lum } = prep;
  const level = intensity ?? prep.auto;
  const lut = contrastLut(level);
  const sat = 1 + 0.25 * (level / 100);
  const img = out || new ImageData(w, h);
  const d = img.data;
  const gray = mode === 'gray';
  for (let i = 0, p = 0, n = w * h; i < n; i++, p += 4) {
    const L = lum[i];
    const Ln = lut[L];
    if (gray) {
      d[p] = d[p + 1] = d[p + 2] = Ln;
    } else {
      const k = L > 0 ? Ln / L : 0;
      d[p] = Ln + (rgb[i * 3] * k - Ln) * sat;
      d[p + 1] = Ln + (rgb[i * 3 + 1] * k - Ln) * sat;
      d[p + 2] = Ln + (rgb[i * 3 + 2] * k - Ln) * sat;
    }
    d[p + 3] = 255;
  }
  return img;
}

/** Full-resolution enhancement for the final image. */
export async function enhance(src, opts) {
  const img = renderEnhanced(await prepareEnhance(src), opts);
  const c = createCanvas(img.width, img.height);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}
