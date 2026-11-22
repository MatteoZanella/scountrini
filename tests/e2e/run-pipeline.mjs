// Smoke test of the real image pipeline (OpenCV detection, warp, enhancement,
// stitching, WebP + metadata) in headless Chrome.
//   npm run test:e2e        (set CHROME_PATH if Chrome is not auto-detected)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome not found: set CHROME_PATH');

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });

let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => console.log(`[browser] ${m.text()}`));
  page.on('requestfailed', (r) => console.error('request failed:', r.url(), r.failure()?.errorText));
  await page.goto('http://localhost:5199/tests/e2e/pipeline.html');
  await page.waitForFunction('window.__result', { timeout: 180_000, polling: 500 });
  const result = await page.evaluate(() => window.__result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error('pipeline failed');

  // E2E_OUT=<dir> saves the produced images for visual inspection
  if (process.env.E2E_OUT) {
    mkdirSync(process.env.E2E_OUT, { recursive: true });
    const images = await page.evaluate(() => window.__images);
    for (const [name, url] of Object.entries(images)) {
      writeFileSync(join(process.env.E2E_OUT, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
  }

  const { r } = result;
  const checks = [
    ['document detected', r.detection.detected && r.detection.maxCornerErrorPx < 10],
    [
      'cut receipt: corners on the cut edge',
      r.detectionCut.detected && r.detectionCut.topOnEdgePx <= 4 && r.detectionCut.bottomErrorPx < 10,
    ],
    ['shadow evened out (paper white)', r.shadow.paperLow >= 225 && r.shadow.paperMedian >= 245],
    ['two overlapping photos merged', r.stitchTwo.groups.length === 1],
    ['merged height plausible', Math.abs(r.stitchTwo.height - 2600) < 140],
    ['three shuffled photos merged', r.stitchThreeShuffled.groups.length === 1],
    ['shuffled merge height plausible', Math.abs(r.stitchThreeShuffled.height - 2600) < 60],
    ['unrelated documents kept apart', r.unrelated.groups.length === 2],
    [
      'WebP with EXIF + XMP',
      r.encoding.hasVP8X && r.encoding.hasEXIF && r.encoding.hasXMP && r.encoding.hasItalianField,
    ],
    ['output decodes', r.encoding.decodes],
  ];
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok) failed = true;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
