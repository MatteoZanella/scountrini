// Automatic stitching of several photos of the same document.
//
// 1. ORB keypoints (OpenCV) on every photo, already rectified and enhanced.
// 2. For each pair: matches (Lowe ratio test) + RANSAC of a similarity
//    (scale, rotation, translation), refined by least squares.
// 3. Maximum spanning tree over the valid pairs → groups of stitchable photos.
// 4. Each group becomes one mosaic: in the overlap, dynamic programming finds
//    the seam where the two photos agree best and there is the least text,
//    with a soft blend around it.
// 5. Groups that cannot be stitched are placed side by side on black.

import { loadOpenCV } from './opencv.js';
import { createCanvas, ctx2d } from './canvas.js';
import { nextFrame } from '../core/format.js';
import { CONFIG } from '../config.js';

// ---- Similarities as complex numbers: z ↦ a·z + b ----
const S = {
  id: { ar: 1, ai: 0, br: 0, bi: 0 },
  apply: (T, x, y) => [T.ar * x - T.ai * y + T.br, T.ai * x + T.ar * y + T.bi],
  compose: (A, B) => ({
    ar: A.ar * B.ar - A.ai * B.ai,
    ai: A.ar * B.ai + A.ai * B.ar,
    br: A.ar * B.br - A.ai * B.bi + A.br,
    bi: A.ar * B.bi + A.ai * B.br + A.bi,
  }),
  invert: (T) => {
    const m = T.ar * T.ar + T.ai * T.ai;
    const ir = T.ar / m;
    const ii = -T.ai / m;
    return { ar: ir, ai: ii, br: -(ir * T.br - ii * T.bi), bi: -(ir * T.bi + ii * T.br) };
  },
  scale: (T) => Math.hypot(T.ar, T.ai),
  angle: (T) => Math.atan2(T.ai, T.ar),
};

// --------------------------------------------------------------------------
// Keypoints
// --------------------------------------------------------------------------
function makeOrb(cv, n) {
  try {
    return new cv.ORB(n);
  } catch {
    const o = new cv.ORB();
    o.setMaxFeatures?.(n);
    return o;
  }
}

function extractFeatures(cv, canvas) {
  const s = Math.min(1, 1100 / canvas.width, Math.sqrt(1.8e6 / (canvas.width * canvas.height)));
  const small = createCanvas(canvas.width * s, canvas.height * s);
  ctx2d(small).drawImage(canvas, 0, 0, small.width, small.height);
  const rgba = cv.imread(small);
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  const orb = makeOrb(cv, 3500);
  const kp = new cv.KeyPointVector();
  const des = new cv.Mat();
  const mask = new cv.Mat();
  orb.detectAndCompute(gray, mask, kp, des);
  const n = kp.size();
  const pts = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const k = kp.get(i);
    pts[i * 2] = k.pt.x / s;
    pts[i * 2 + 1] = k.pt.y / s;
  }
  [rgba, gray, kp, mask].forEach((m) => m.delete());
  orb.delete();
  return { pts, des, n, scale: s, w: canvas.width, h: canvas.height };
}

// --------------------------------------------------------------------------
// Robust estimate of the similarity j → i
// --------------------------------------------------------------------------
function lsSimilarity(src, dst, idx) {
  let zr = 0,
    zi = 0,
    wr = 0,
    wi = 0;
  for (const k of idx) {
    zr += src[k * 2];
    zi += src[k * 2 + 1];
    wr += dst[k * 2];
    wi += dst[k * 2 + 1];
  }
  const m = idx.length;
  zr /= m;
  zi /= m;
  wr /= m;
  wi /= m;
  let nr = 0,
    ni = 0,
    den = 0;
  for (const k of idx) {
    const ar = src[k * 2] - zr,
      ai = src[k * 2 + 1] - zi;
    const br = dst[k * 2] - wr,
      bi = dst[k * 2 + 1] - wi;
    nr += br * ar + bi * ai;
    ni += bi * ar - br * ai;
    den += ar * ar + ai * ai;
  }
  if (den < 1e-9) return null;
  const a = { r: nr / den, i: ni / den };
  return { ar: a.r, ai: a.i, br: wr - (a.r * zr - a.i * zi), bi: wi - (a.i * zr + a.r * zi) };
}

function inliersOf(T, src, dst, n, thr2) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = src[k * 2],
      y = src[k * 2 + 1];
    const dx = T.ar * x - T.ai * y + T.br - dst[k * 2];
    const dy = T.ai * x + T.ar * y + T.bi - dst[k * 2 + 1];
    if (dx * dx + dy * dy < thr2) out.push(k);
  }
  return out;
}

function plausible(T) {
  const s = S.scale(T);
  return s > 0.7 && s < 1.43 && Math.abs(S.angle(T)) < 0.35;
}

function ransacSimilarity(src, dst, n, thr) {
  if (n < 10) return null;
  const thr2 = thr * thr;
  let best = null;
  let bestCount = 0;
  const iters = Math.min(4000, 400 + n * 4);
  for (let it = 0; it < iters; it++) {
    const i = (Math.random() * n) | 0;
    const j = (Math.random() * n) | 0;
    if (i === j) continue;
    const dzr = src[j * 2] - src[i * 2],
      dzi = src[j * 2 + 1] - src[i * 2 + 1];
    const dwr = dst[j * 2] - dst[i * 2],
      dwi = dst[j * 2 + 1] - dst[i * 2 + 1];
    const m = dzr * dzr + dzi * dzi;
    if (m < 400) continue;
    const ar = (dwr * dzr + dwi * dzi) / m;
    const ai = (dwi * dzr - dwr * dzi) / m;
    const T = {
      ar,
      ai,
      br: dst[i * 2] - (ar * src[i * 2] - ai * src[i * 2 + 1]),
      bi: dst[i * 2 + 1] - (ai * src[i * 2] + ar * src[i * 2 + 1]),
    };
    if (!plausible(T)) continue;
    let count = 0;
    for (let k = 0; k < n; k++) {
      const x = src[k * 2],
        y = src[k * 2 + 1];
      const dx = ar * x - ai * y + T.br - dst[k * 2];
      const dy = ai * x + ar * y + T.bi - dst[k * 2 + 1];
      if (dx * dx + dy * dy < thr2) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = T;
    }
  }
  if (!best || bestCount < 8) return null;
  let T = best;
  let idx = inliersOf(T, src, dst, n, thr2);
  for (let r = 0; r < 3; r++) {
    const R = lsSimilarity(src, dst, idx);
    if (!R || !plausible(R)) break;
    T = R;
    idx = inliersOf(T, src, dst, n, thr2);
  }
  return { T, idx };
}

function matchPair(cv, fi, fj) {
  if (fi.n < 15 || fj.n < 15 || fi.des.rows === 0 || fj.des.rows === 0) return null;
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const mv = new cv.DMatchVectorVector();
  bf.knnMatch(fj.des, fi.des, mv, 2);
  const src = [];
  const dst = [];
  for (let k = 0; k < mv.size(); k++) {
    const m = mv.get(k);
    if (m.size() >= 2) {
      const a = m.get(0);
      const b = m.get(1);
      if (a.distance < 0.8 * b.distance) {
        src.push(fj.pts[a.queryIdx * 2], fj.pts[a.queryIdx * 2 + 1]);
        dst.push(fi.pts[a.trainIdx * 2], fi.pts[a.trainIdx * 2 + 1]);
      }
    }
    m.delete?.();
  }
  mv.delete();
  bf.delete();
  const n = src.length / 2;
  const thr = 3 / Math.min(fi.scale, fj.scale);
  const r = ransacSimilarity(Float64Array.from(src), Float64Array.from(dst), n, thr);
  if (!r) return null;
  const inl = r.idx.length;
  // Accept: enough consistent, well spread matches
  if (inl < 18 || inl < n * 0.06) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const k of r.idx) {
    x0 = Math.min(x0, src[k * 2]);
    x1 = Math.max(x1, src[k * 2]);
    y0 = Math.min(y0, src[k * 2 + 1]);
    y1 = Math.max(y1, src[k * 2 + 1]);
  }
  if (Math.hypot(x1 - x0, y1 - y0) < 0.2 * Math.min(fj.w, fj.h)) return null;
  // Photo j, transformed, must really overlap photo i
  const c = [
    [0, 0],
    [fj.w, 0],
    [fj.w, fj.h],
    [0, fj.h],
  ].map(([x, y]) => S.apply(r.T, x, y));
  const bx0 = Math.max(0, Math.min(...c.map((p) => p[0])));
  const by0 = Math.max(0, Math.min(...c.map((p) => p[1])));
  const bx1 = Math.min(fi.w, Math.max(...c.map((p) => p[0])));
  const by1 = Math.min(fi.h, Math.max(...c.map((p) => p[1])));
  const ov = Math.max(0, bx1 - bx0) * Math.max(0, by1 - by0);
  if (ov < 0.02 * Math.min(fi.w * fi.h, fj.w * fj.h)) return null;
  return { T: r.T, inliers: inl, matches: n };
}

// --------------------------------------------------------------------------
// Composition along a seam
// --------------------------------------------------------------------------
const lumAt = (d, p) => d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;

function toCanvasMatrix(T, k, ox, oy) {
  return { a: k * T.ar, b: k * T.ai, c: -k * T.ai, d: k * T.ar, e: k * (T.br - ox), f: k * (T.bi - oy) };
}
const applyM = (M, x, y) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f];

function blendInto(ctx, W, H, img, M, childCenter, parentCenter) {
  const pts = [
    [0, 0],
    [img.width, 0],
    [img.width, img.height],
    [0, img.height],
  ].map(([x, y]) => applyM(M, x, y));
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))));
  const x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0]))));
  const y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return;

  const E = ctx.getImageData(x0, y0, rw, rh);
  const tmp = createCanvas(rw, rh);
  const tctx = ctx2d(tmp);
  tctx.setTransform(M.a, M.b, M.c, M.d, M.e - x0, M.f - y0);
  tctx.drawImage(img, 0, 0);
  const e = E.data;
  const c = tctx.getImageData(0, 0, rw, rh).data;
  const N = rw * rh;

  // Overlap mask
  const both = new Uint8Array(N);
  let bx0 = rw,
    by0 = rh,
    bx1 = -1,
    by1 = -1;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (e[i * 4 + 3] >= 250 && c[i * 4 + 3] >= 250) {
        both[i] = 1;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }

  let seam = null,
    horizontal = true,
    sign = 1,
    U,
    V;
  if (bx1 >= 0) {
    const dx = childCenter[0] - parentCenter[0];
    const dy = childCenter[1] - parentCenter[1];
    horizontal = Math.abs(dy) >= Math.abs(dx);
    sign = (horizontal ? dy : dx) >= 0 ? 1 : -1;
    const ow = bx1 - bx0 + 1;
    const oh = by1 - by0 + 1;
    U = horizontal ? ow : oh;
    V = horizontal ? oh : ow;
    const idx = horizontal ? (u, v) => (by0 + v) * rw + bx0 + u : (u, v) => (by0 + u) * rw + bx0 + v;

    // Cost: difference between the photos + ink + closeness to the edges
    const cost = new Float32Array(U * V);
    const MARGIN = 12;
    for (let u = 0; u < U; u++) {
      let first = -1,
        last = -1;
      for (let v = 0; v < V; v++) {
        if (both[idx(u, v)]) {
          if (first < 0) first = v;
          last = v;
        }
      }
      for (let v = 0; v < V; v++) {
        const i = idx(u, v);
        let k;
        if (both[i]) {
          const lE = lumAt(e, i * 4);
          const lC = lumAt(c, i * 4);
          k = Math.abs(lE - lC) * 1.5 + Math.max(0, 215 - Math.min(lE, lC)) * 0.6;
          if (v - first < MARGIN || last - v < MARGIN) k += 180;
        } else {
          k = 700;
        }
        cost[u * V + v] = k;
      }
    }
    // Dynamic programming (cheapest path, steps of ±1)
    const acc = new Float32Array(U * V);
    const back = new Int8Array(U * V);
    acc.set(cost.subarray(0, V), 0);
    for (let u = 1; u < U; u++) {
      const pr = (u - 1) * V;
      const cr = u * V;
      for (let v = 0; v < V; v++) {
        let bestV = acc[pr + v],
          step = 0;
        if (v > 0 && acc[pr + v - 1] < bestV) {
          bestV = acc[pr + v - 1];
          step = -1;
        }
        if (v < V - 1 && acc[pr + v + 1] < bestV) {
          bestV = acc[pr + v + 1];
          step = 1;
        }
        acc[cr + v] = bestV + cost[cr + v];
        back[cr + v] = step;
      }
    }
    seam = new Int32Array(U);
    let v = 0;
    let bestEnd = Infinity;
    const lr = (U - 1) * V;
    for (let t = 0; t < V; t++)
      if (acc[lr + t] < bestEnd) {
        bestEnd = acc[lr + t];
        v = t;
      }
    for (let u = U - 1; u >= 0; u--) {
      seam[u] = v;
      v += back[u * V + v];
    }
  }

  // Blending
  const F = 7;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      const p = i * 4;
      const ca = c[p + 3];
      if (ca === 0) continue;
      if (both[i]) {
        const u = horizontal ? x - bx0 : y - by0;
        const v = horizontal ? y - by0 : x - bx0;
        const s = (v - seam[u]) * sign;
        const w = Math.max(0, Math.min(1, 0.5 + s / (2 * F)));
        e[p] = e[p] + (c[p] - e[p]) * w;
        e[p + 1] = e[p + 1] + (c[p + 1] - e[p + 1]) * w;
        e[p + 2] = e[p + 2] + (c[p + 2] - e[p + 2]) * w;
        e[p + 3] = 255;
      } else {
        const ea = e[p + 3];
        if (ea >= 250) continue; // feathered edge of the new photo over an already filled area
        const a = ca / 255;
        e[p] = c[p] * a + e[p] * (1 - a);
        e[p + 1] = c[p + 1] * a + e[p + 1] * (1 - a);
        e[p + 2] = c[p + 2] * a + e[p + 2] * (1 - a);
        e[p + 3] = Math.min(255, ca + ea * (1 - a));
      }
    }
  }
  ctx.putImageData(E, x0, y0);
}

function fitScale(w, h) {
  return Math.min(1, Math.sqrt(CONFIG.maxOutputPixels / (w * h)), CONFIG.maxOutputSide / w, CONFIG.maxOutputSide / h);
}

function renderGroup(canvases, order, G, parent) {
  if (order.length === 1) return canvases[order[0]];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of order) {
    const im = canvases[n];
    for (const [x, y] of [
      [0, 0],
      [im.width, 0],
      [im.width, im.height],
      [0, im.height],
    ]) {
      const [X, Y] = S.apply(G[n], x, y);
      minX = Math.min(minX, X);
      maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y);
      maxY = Math.max(maxY, Y);
    }
  }
  const k = fitScale(maxX - minX, maxY - minY);
  const W = Math.ceil((maxX - minX) * k);
  const H = Math.ceil((maxY - minY) * k);
  const out = createCanvas(W, H);
  const ctx = ctx2d(out);
  const centers = {};
  for (const n of order) {
    const im = canvases[n];
    const M = toCanvasMatrix(G[n], k, minX, minY);
    centers[n] = applyM(M, im.width / 2, im.height / 2);
    if (n === order[0]) {
      ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
      ctx.drawImage(im, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      blendInto(ctx, W, H, im, M, centers[n], centers[parent[n]]);
    }
  }
  return out;
}

function montage(groupCanvases) {
  const gap = CONFIG.montageGap;
  const W0 = groupCanvases.reduce((s, c) => s + c.width, 0) + gap * (groupCanvases.length - 1);
  const H0 = Math.max(...groupCanvases.map((c) => c.height));
  const k = fitScale(W0, H0);
  const out = createCanvas(W0 * k, H0 * k);
  const ctx = ctx2d(out);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  let x = 0;
  for (const c of groupCanvases) {
    ctx.drawImage(c, Math.round(x), 0, Math.round(c.width * k), Math.round(c.height * k));
    x += (c.width + gap) * k;
  }
  return out;
}

/**
 * Composes the pages into a single image. `parts` are the joined groups on
 * their own (one per PDF page when the document becomes a PDF).
 * @returns {Promise<{canvas, parts: HTMLCanvasElement[], groups:number[][], merged:number}>}
 */
export async function composeDocument(canvases, onProgress = () => {}) {
  if (!canvases.length) throw new Error('Nessuna immagine');
  if (canvases.length === 1) {
    return { canvas: montage([canvases[0]]), parts: [canvases[0]], groups: [[0]], merged: 0 };
  }
  const cv = await loadOpenCV();
  const n = canvases.length;
  onProgress('Analisi delle foto…');
  const feats = [];
  for (let i = 0; i < n; i++) {
    feats.push(extractFeatures(cv, canvases[i]));
    await nextFrame();
  }

  onProgress('Ricerca delle parti in comune…');
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      try {
        const m = matchPair(cv, feats[i], feats[j]);
        if (m) edges.push({ i, j, ...m });
      } catch (e) {
        console.warn('Confronto foto fallito', i, j, e);
      }
      await nextFrame();
    }
  }
  feats.forEach((f) => f.des.delete());

  // Maximum spanning tree (Kruskal) on the number of matches
  edges.sort((a, b) => b.inliers - a.inliers);
  const uf = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (uf[x] === x ? x : (uf[x] = find(uf[x])));
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const a = find(e.i),
      b = find(e.j);
    if (a === b) continue;
    uf[a] = b;
    adj[e.i].push({ to: e.j, T: e.T }); // T: coordinates of j → coordinates of i
    adj[e.j].push({ to: e.i, T: S.invert(e.T) });
  }

  // Groups in order of their first photo; global transforms towards the root
  onProgress('Unione delle foto…');
  const seen = new Array(n).fill(false);
  const groups = [];
  const groupCanvases = [];
  for (let r = 0; r < n; r++) {
    if (seen[r]) continue;
    const G = { [r]: S.id };
    const parent = {};
    const order = [r];
    seen[r] = true;
    for (let q = 0; q < order.length; q++) {
      const p = order[q];
      for (const { to, T } of adj[p]) {
        if (seen[to]) continue;
        seen[to] = true;
        G[to] = S.compose(G[p], T);
        parent[to] = p;
        order.push(to);
      }
    }
    groups.push([...order].sort((a, b) => a - b));
    groupCanvases.push(renderGroup(canvases, order, G, parent));
    await nextFrame();
  }
  const merged = groups.filter((g) => g.length > 1).reduce((s, g) => s + g.length, 0);
  return { canvas: montage(groupCanvases), parts: groupCanvases, groups, merged };
}
