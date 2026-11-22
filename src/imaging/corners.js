// Document corner detection (jscanify + polygon approximation) and geometry.
// Corners are always ordered [top-left, top-right, bottom-right, bottom-left].

import { getScanner, loadOpenCV, withMats } from './opencv.js';
import { ctx2d, scaleCanvas } from './canvas.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function orderCorners(pts) {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  // Angle order on screen (y down) is clockwise: TL → TR → BR → BL
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  let start = 0;
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[start].x + sorted[start].y) start = i;
  });
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function isConvexQuad(p) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const c = p[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

export function insetCorners(w, h, inset = 0.04) {
  const dx = w * inset;
  const dy = h * inset;
  return [
    { x: dx, y: dy },
    { x: w - dx, y: dy },
    { x: w - dx, y: h - dy },
    { x: dx, y: h - dy },
  ];
}

/** Maps corners through a 90° clockwise rotation of a w×h image. */
export function rotateCornersCW(corners, h) {
  const r = corners.map((p) => ({ x: h - p.y, y: p.x }));
  return orderCorners(r);
}

function quadFromContour(cv, contour, minArea, track) {
  const hull = track(new cv.Mat());
  cv.convexHull(contour, hull, false, true);
  const peri = cv.arcLength(hull, true);
  for (const eps of [0.015, 0.02, 0.03, 0.045, 0.06, 0.08]) {
    const approx = track(new cv.Mat());
    cv.approxPolyDP(hull, approx, eps * peri, true);
    if (approx.rows < 4) return null;
    if (approx.rows === 4) {
      const pts = [];
      for (let i = 0; i < 4; i++) pts.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
      const q = orderCorners(pts);
      return isConvexQuad(q) && polygonArea(q) > minArea ? q : null;
    }
  }
  return null;
}

// Margin added around the photo before the search, in px at the search scale.
// jscanify keeps the largest closed outline of the edges it finds; a receipt
// running off the photo has no edge along the frame, so its outline stays
// open and is lost. The margin has the background's colour: no edge where the
// background meets the frame, a clear one where the paper does.
const MARGIN = 12;

/** Background colour: per-channel median of the photo's outermost pixels (a
 *  receipt touching part of the frame doesn't move the median). */
function frameColor(canvas) {
  const { width: w, height: h } = canvas;
  const g = ctx2d(canvas);
  const strips = [
    g.getImageData(0, 0, w, 1).data,
    g.getImageData(0, h - 1, w, 1).data,
    g.getImageData(0, 0, 1, h).data,
    g.getImageData(w - 1, 0, 1, h).data,
  ];
  const median = (ch) => {
    const v = strips.flatMap((d) => Array.from({ length: d.length / 4 }, (_, i) => d[i * 4 + ch]));
    return v.sort((a, b) => a - b)[v.length >> 1];
  };
  return [median(0), median(1), median(2), 255];
}

/**
 * Finds the document outline with jscanify's contour search, fitted to a
 * quadrilateral (robust for rotated receipts), falling back to jscanify's own
 * corner heuristic and finally to the full frame.
 * @returns {Promise<{corners: {x,y}[], detected: boolean}>}
 */
export async function detectCorners(canvas) {
  const cv = await loadOpenCV();
  const scanner = await getScanner();
  const small = scaleCanvas(canvas, 900);
  const k = canvas.width / small.width;
  let result = null;
  try {
    result = withMats((track) => {
      const img = track(cv.imread(small));
      const padded = track(new cv.Mat());
      const m = MARGIN;
      cv.copyMakeBorder(img, padded, m, m, m, m, cv.BORDER_CONSTANT, new cv.Scalar(...frameColor(small)));
      const contour = scanner.findPaperContour(padded);
      if (!contour) return null;
      track(contour);
      const minArea = small.width * small.height * 0.08;
      let pts = quadFromContour(cv, contour, minArea, track);
      if (!pts) {
        const c = scanner.getCornerPoints(contour);
        pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
        if (!pts.every(Boolean) || !isConvexQuad(pts) || polygonArea(pts) <= minArea) return null;
      }
      // Back to photo coordinates; a corner found on the margin is on the frame
      const clamp = (v, max) => Math.max(0, Math.min(max, v - m));
      return pts.map((p) => ({ x: clamp(p.x, small.width), y: clamp(p.y, small.height) }));
    });
  } catch (e) {
    console.warn('Document detection failed', e);
  }
  // Not found (e.g. white receipt on white, or an already cropped scan): the whole
  // image loses nothing, while an inset would cut the edges of the text
  const frame = insetCorners(canvas.width, canvas.height, 0);
  if (!result) return { corners: frame, detected: false };
  const corners = result.map((p) => ({ x: p.x * k, y: p.y * k }));
  // Only the frame was found: nothing detected
  const tol = Math.max(canvas.width, canvas.height) * 0.015;
  if (corners.every((p, i) => dist(p, frame[i]) < tol)) return { corners: frame, detected: false };
  return { corners, detected: true };
}
