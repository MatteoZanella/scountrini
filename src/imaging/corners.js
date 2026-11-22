// Document corner detection (jscanify + polygon approximation) and geometry.
// Corners are always ordered [top-left, top-right, bottom-right, bottom-left].

import { getScanner, loadOpenCV, withMats } from './opencv.js';
import { scaleCanvas } from './canvas.js';

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

/**
 * Finds the document outline. Uses jscanify's contour search, then fits a
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
      const contour = scanner.findPaperContour(img);
      if (!contour) return null;
      track(contour);
      const minArea = small.width * small.height * 0.08;
      const quad = quadFromContour(cv, contour, minArea, track);
      if (quad) return quad;
      const c = scanner.getCornerPoints(contour);
      const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
      return pts.every(Boolean) && isConvexQuad(pts) && polygonArea(pts) > minArea ? pts : null;
    });
  } catch (e) {
    console.warn('Document detection failed', e);
  }
  // Not found (e.g. white receipt on white, or an already cropped scan): the whole
  // image loses nothing, while an inset would cut the edges of the text
  if (!result) return { corners: insetCorners(canvas.width, canvas.height, 0), detected: false };
  return { corners: result.map((p) => ({ x: p.x * k, y: p.y * k })), detected: true };
}
