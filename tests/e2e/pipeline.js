// Browser-side harness for run-pipeline.mjs
import { loadOpenCV } from '/src/imaging/opencv.js';
import { detectCorners } from '/src/imaging/corners.js';
import { warpDocument } from '/src/imaging/perspective.js';
import { enhance, prepareEnhance, renderEnhanced } from '/src/imaging/enhance.js';
import { composeDocument } from '/src/imaging/stitch.js';
import { encodeFinal } from '/src/imaging/encode.js';
import { embedMetadata } from '/src/metadata/document-metadata.js';
import { createCanvas, ctx2d } from '/src/imaging/canvas.js';

// Deterministic PRNG so failures are reproducible
function rng(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const WORDS = ['PANE', 'LATTE', 'UOVA', 'MELE', 'PASTA', 'RISO', 'OLIO', 'SALE', 'CAFFE', 'ACQUA', 'BURRO', 'TONNO'];

function makeReceipt(w, h, seed) {
  const r = rng(seed);
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#222';
  ctx.font = 'bold 30px monospace';
  ctx.fillText(`NEGOZIO ${seed}`, 40, 60);
  ctx.font = '22px monospace';
  for (let y = 110; y < h - 30; y += 34) {
    if (r() < 0.12) {
      for (let x = 40; x < w - 40; x += 3 + ((r() * 6) | 0)) ctx.fillRect(x, y - 18, 1 + ((r() * 3) | 0), 22);
      continue;
    }
    const word = `${WORDS[(r() * WORDS.length) | 0]} ${WORDS[(r() * WORDS.length) | 0]}`;
    const price = `${(r() * 99).toFixed(2).replace('.', ',')}`;
    ctx.fillText(word, 40, y);
    ctx.fillText(price, w - 40 - ctx.measureText(price).width, y);
  }
  return c;
}

function crop(src, y0, y1) {
  const c = createCanvas(src.width, y1 - y0);
  ctx2d(c).drawImage(src, 0, -y0);
  return c;
}

function transform(src, scale, deg) {
  const c = createCanvas(src.width * scale, src.height * scale);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function photoOf(receipt, deg) {
  const W = 1800,
    H = 2400;
  const c = createCanvas(W, H);
  const ctx = ctx2d(c);
  const r = rng(7);
  ctx.fillStyle = '#3b352f';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.25})`;
    ctx.fillRect(r() * W, r() * H, 3, 3);
  }
  const s = 0.75;
  const a = (deg * Math.PI) / 180;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(a);
  ctx.drawImage(receipt, (-receipt.width * s) / 2, (-receipt.height * s) / 2, receipt.width * s, receipt.height * s);
  const hw = (receipt.width * s) / 2,
    hh = (receipt.height * s) / 2;
  const truth = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({
    x: W / 2 + x * Math.cos(a) - y * Math.sin(a),
    y: H / 2 + x * Math.sin(a) + y * Math.cos(a),
  }));
  return { canvas: c, truth };
}

const step = (name) => console.log(`step: ${name}`);

/** Multiplies a diagonal shade and a hand-shaped dark blob over the image. */
function withShadow(src) {
  const c = createCanvas(src.width, src.height);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'multiply';
  const lin = g.createLinearGradient(0, 0, src.width, src.height);
  lin.addColorStop(0, 'rgb(85,85,85)');
  lin.addColorStop(0.6, 'rgb(205,205,205)');
  lin.addColorStop(1, '#fff');
  g.fillStyle = lin;
  g.fillRect(0, 0, src.width, src.height);
  const [x, y, r] = [src.width * 0.7, src.height * 0.35, src.width * 0.45];
  const blob = g.createRadialGradient(x, y, 0, x, y, r);
  blob.addColorStop(0, 'rgb(110,110,110)');
  blob.addColorStop(1, '#fff');
  g.fillStyle = blob;
  g.fillRect(0, 0, src.width, src.height);
  return c;
}

/**
 * Paper pixels (white in the clean result) measured in the shaded result:
 * low 2% and median luminance.
 */
function paperEvenness(clean, shaded) {
  const a = ctx2d(clean).getImageData(0, 0, clean.width, clean.height).data;
  const b = ctx2d(shaded).getImageData(0, 0, shaded.width, shaded.height).data;
  const vals = [];
  for (let p = 0; p < a.length; p += 4) if (a[p] >= 245) vals.push(b[p]);
  vals.sort((x, y) => x - y);
  return { paperLow: vals[Math.floor(vals.length * 0.02)], paperMedian: vals[vals.length >> 1] };
}

async function run() {
  const results = {};
  step('load opencv');
  const t0 = performance.now();
  await loadOpenCV();
  results.opencvLoadMs = Math.round(performance.now() - t0);

  const receipt = makeReceipt(800, 2600, 1);

  step('1)');
  // 1) Detection on a synthetic photo
  const { canvas: photo, truth } = photoOf(receipt, 6);
  let t = performance.now();
  const det = await detectCorners(photo);
  const err = Math.max(...det.corners.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)));
  results.detection = {
    detected: det.detected,
    maxCornerErrorPx: Math.round(err),
    ms: Math.round(performance.now() - t),
  };

  // 1b) Same photo cut through the receipt: the top corners belong on the cut
  // edge, the bottom ones on the receipt's real corners
  const cut = crop(photo, 600, photo.height);
  const detCut = await detectCorners(cut);
  const [tl, tr, br, bl] = detCut.corners;
  results.detectionCut = {
    detected: detCut.detected,
    topOnEdgePx: Math.round(Math.max(tl.y, tr.y)),
    bottomErrorPx: Math.round(
      Math.max(
        Math.hypot(br.x - truth[2].x, br.y - (truth[2].y - 600)),
        Math.hypot(bl.x - truth[3].x, bl.y - (truth[3].y - 600)),
      ),
    ),
  };

  step('2)');
  // 2) Warp + enhance
  t = performance.now();
  const warped = await warpDocument(photo, det.corners);
  const enhanced = await enhance(warped, { mode: 'gray' }); // auto intensity
  results.warpEnhance = { width: enhanced.width, height: enhanced.height, ms: Math.round(performance.now() - t) };

  step('2b)');
  // 2b) The same receipt under a strong, uneven shadow: the paper must still
  // come out evenly white (no grey patches, no whiter blotches)
  const shaded = withShadow(warped);
  const evened = await enhance(shaded, { mode: 'gray' });
  results.shadow = paperEvenness(enhanced, evened);

  // Live preview: one slider move = one render of the prepared photo
  const prep = await prepareEnhance(shaded);
  const out = new ImageData(prep.w, prep.h);
  t = performance.now();
  for (let i = 0; i < 10; i++) renderEnhanced(prep, { intensity: i * 10, mode: 'gray' }, out);
  results.previewRender = {
    megapixels: +((prep.w * prep.h) / 1e6).toFixed(1),
    msPerMove: Math.round((performance.now() - t) / 10),
  };

  step('3)');
  // 3) Two overlapping pieces, second slightly scaled/rotated
  const p1 = crop(receipt, 0, 1500);
  const p2 = transform(crop(receipt, 1100, 2600), 1.04, 1.5);
  t = performance.now();
  const two = await composeDocument([p1, p2]);
  results.stitchTwo = {
    groups: two.groups,
    width: two.canvas.width,
    height: two.canvas.height,
    ms: Math.round(performance.now() - t),
  };

  step('4)');
  // 4) Three pieces in shuffled order
  const parts = [crop(receipt, 1700, 2600), crop(receipt, 0, 1000), crop(receipt, 800, 1900)];
  t = performance.now();
  const three = await composeDocument(parts);
  results.stitchThreeShuffled = {
    groups: three.groups,
    width: three.canvas.width,
    height: three.canvas.height,
    ms: Math.round(performance.now() - t),
  };

  step('5)');
  // 5) Unrelated documents must NOT be merged
  const other = makeReceipt(700, 1400, 99);
  const sep = await composeDocument([crop(receipt, 0, 1300), other]);
  results.unrelated = { groups: sep.groups, width: sep.canvas.width, height: sep.canvas.height };

  step('6)');
  // 6) Final encoding with metadata
  const encoded = await encodeFinal(two.canvas);
  const blob = embedMetadata(encoded, two.canvas, {
    id: 'abcde',
    fileName: 'x.webp',
    date: '2026-11-14',
    merchant: 'Lidl',
    branca: 'LC',
    year: '2026-2027',
    userName: 'Test',
    device: 'Chrome',
    gps: { lat: 45.4, lon: 12.3 },
    pageCount: 2,
    composition: '2 foto unite automaticamente',
    createdAt: new Date(),
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  results.encoding = {
    mime: blob.type,
    sizeKB: Math.round(blob.size / 1024),
    hasVP8X: text.includes('VP8X'),
    hasEXIF: text.includes('EXIF'),
    hasXMP: text.includes('XMP '),
    hasItalianField: text.includes('scontrini:Esercente'),
  };
  // Must decode again in the browser
  const bmp = await createImageBitmap(blob);
  results.encoding.decodes = bmp.width === two.canvas.width && bmp.height === two.canvas.height;
  window.__images = {
    stitchTwo: two.canvas.toDataURL('image/jpeg', 0.9),
    stitchThree: three.canvas.toDataURL('image/jpeg', 0.9),
    unrelated: sep.canvas.toDataURL('image/jpeg', 0.9),
    enhanced: enhanced.toDataURL('image/jpeg', 0.9),
    shaded: shaded.toDataURL('image/jpeg', 0.8),
    evened: evened.toDataURL('image/jpeg', 0.9),
    photo: photo.toDataURL('image/jpeg', 0.8),
  };
  return results;
}

run()
  .then((r) => (window.__result = { ok: true, r }))
  .catch((e) => (window.__result = { ok: false, error: String(e?.stack || e) }))
  .finally(() => (document.getElementById('out').textContent = JSON.stringify(window.__result, null, 2)));
