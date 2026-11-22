// Copies runtime vendor files (OpenCV, Tesseract worker/core/Italian model)
// from node_modules into public/vendor and renders the PWA icons.
// Everything is self-hosted so the app works offline and needs no third-party CDN.

import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const pub = (...p) => join(root, 'public', ...p);

const COPIES = [
  [nm('@techstark/opencv-js/dist/opencv.js'), pub('vendor/opencv.js')],
  [nm('tesseract.js/dist/worker.min.js'), pub('vendor/tesseract/worker.min.js')],
  // Only the LSTM cores are needed (OEM 1); the SIMD one is picked when supported.
  [
    nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
    pub('vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js'),
  ],
  [nm('tesseract.js-core/tesseract-core-lstm.wasm.js'), pub('vendor/tesseract/core/tesseract-core-lstm.wasm.js')],
  [nm('@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz'), pub('vendor/tesseract/lang/ita.traineddata.gz')],
];

const ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180, padding: 0 },
  { file: 'maskable-512.png', size: 512, padding: 0.12 },
];

async function isFresh(src, dst) {
  try {
    const [a, b] = await Promise.all([stat(src), stat(dst)]);
    return b.mtimeMs >= a.mtimeMs && b.size === a.size;
  } catch {
    return false;
  }
}

for (const [src, dst] of COPIES) {
  await mkdir(dirname(dst), { recursive: true });
  if (await isFresh(src, dst)) continue;
  await copyFile(src, dst);
  console.log('copied', dst.slice(root.length + 1));
}

const svg = await readFile(join(root, 'scripts/assets/icon.svg'));
await mkdir(pub('icons'), { recursive: true });
await copyFile(join(root, 'scripts/assets/icon.svg'), pub('icons/icon.svg'));
for (const { file, size, padding = 0 } of ICONS) {
  const inner = Math.round(size * (1 - padding * 2));
  const img = sharp(svg, { density: 384 }).resize(inner, inner);
  const out = padding
    ? sharp({ create: { width: size, height: size, channels: 4, background: '#462678' } }).composite([
        { input: await img.png().toBuffer(), gravity: 'center' },
      ])
    : img;
  await out.png().toFile(pub('icons', file));
}
console.log('icons ready');
