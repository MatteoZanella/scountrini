import { describe, expect, it } from 'vitest';
import { autoIntensity, contrastLut, inkLevel } from '../src/imaging/enhance.js';

// Synthetic receipts: paper, a little ink, and (for the crumpled one) crease
// shading between the two. Each part is a bell holding `count` pixels.
function receipt(parts) {
  const hist = new Uint32Array(256);
  for (const [centre, spread, count] of parts) {
    const peak = count / (spread * Math.sqrt(2 * Math.PI));
    for (let d = -3 * spread; d <= 3 * spread; d++) {
      const v = Math.max(0, Math.min(255, centre + d));
      hist[v] += Math.round(peak * Math.exp(-(d * d) / (2 * spread * spread)));
    }
  }
  return hist;
}

const crisp = receipt([
  [250, 3, 9300],
  [35, 8, 700],
]); // fresh print on white paper
const faded = receipt([
  [232, 4, 9300],
  [165, 8, 700],
]); // faded thermal print, greyish paper
const crumpled = receipt([
  [228, 6, 6800],
  [160, 20, 2500],
  [70, 10, 700],
]); // creases cast shadows between ink and paper

describe('autoIntensity', () => {
  it('measures real ink, not the crease shading', () => {
    expect(inkLevel(crumpled)).toBeLessThan(90); // the ink bell (≈70), not the creases (≈160)
  });

  it('brings very different receipts to the same ink darkness', () => {
    const inks = [crisp, faded, crumpled].map((h) => contrastLut(autoIntensity(h))[inkLevel(h)]);
    for (const ink of inks) expect(Math.abs(ink - 35)).toBeLessThanOrEqual(6);
  });

  it('needs more contrast for a faded receipt than for a crisp one', () => {
    expect(autoIntensity(faded)).toBeGreaterThan(autoIntensity(crisp) + 30);
  });

  it('keeps crease shading away from black', () => {
    expect(contrastLut(autoIntensity(crumpled))[160]).toBeGreaterThan(120);
  });
});

describe('contrastLut', () => {
  it('is the amount of change: 0 leaves the tones as they are', () => {
    const lut = contrastLut(0);
    for (const v of [0, 35, 128, 200, 255]) expect(lut[v]).toBe(v);
  });

  it('darkens ink and whitens paper more as intensity grows', () => {
    const [low, high] = [contrastLut(30), contrastLut(90)];
    expect(high[120]).toBeLessThan(low[120]);
    expect(high[235]).toBeGreaterThanOrEqual(low[235]);
    expect(contrastLut(100)[180]).toBe(0);
  });
});
