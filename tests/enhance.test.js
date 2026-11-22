import { describe, expect, it } from 'vitest';
import { resultLut } from '../src/imaging/enhance.js';

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

describe('resultLut', () => {
  it('measures paper and real ink, not the crease shading', () => {
    const { ink, paper } = resultLut(crumpled, 50);
    expect(Math.abs(paper - 228)).toBeLessThanOrEqual(6); // a quarter of creases pulls the median a little
    expect(ink).toBeLessThan(90); // the ink bell (≈70), not the creases (≈160)
  });

  it('brings very different receipts to the same result at the same intensity', () => {
    for (const intensity of [20, 50, 90]) {
      const levels = [crisp, faded, crumpled].map((h) => {
        const { lut, ink, paper } = resultLut(h, intensity);
        return [lut[ink], lut[paper]];
      });
      for (const [ink, paper] of levels) {
        expect(Math.abs(ink - levels[0][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(paper - levels[0][1])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps crease shading well away from black', () => {
    const { lut } = resultLut(crumpled, 50);
    expect(lut[160]).toBeGreaterThan(120);
  });

  it('goes from soft grey ink to solid black on white as intensity grows', () => {
    const soft = resultLut(crisp, 0);
    const strong = resultLut(crisp, 100);
    expect(soft.lut[soft.ink]).toBeGreaterThan(90);
    expect(strong.lut[strong.ink]).toBe(0);
    expect(strong.lut[strong.paper]).toBe(255);
  });
});
