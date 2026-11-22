// Perspective correction: maps the 4 selected corners onto an upright rectangle
// at native resolution (capped by CONFIG.maxPagePixels).

import { CONFIG } from '../config.js';
import { loadOpenCV, withMats } from './opencv.js';
import { createCanvas, ctx2d } from './canvas.js';
import { dist } from './corners.js';

export async function warpDocument(src, corners) {
  const cv = await loadOpenCV();
  const [tl, tr, br, bl] = corners;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, Math.sqrt(CONFIG.maxPagePixels / (w * h)));
  w = Math.max(8, Math.round(w * s));
  h = Math.max(8, Math.round(h * s));

  return withMats((track) => {
    const srcMat = track(cv.imread(src));
    const dst = track(new cv.Mat());
    const from = track(cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]));
    const to = track(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]));
    const M = track(cv.getPerspectiveTransform(from, to));
    cv.warpPerspective(srcMat, dst, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    const out = createCanvas(w, h);
    ctx2d(out); // create the context with willReadFrequently before imshow uses it
    cv.imshow(out, dst);
    return out;
  });
}
