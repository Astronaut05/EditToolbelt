import { describe, expect, it } from 'vitest';

import { dpiOf, largestPaper, PAPERS, pixelsFor, printSize, quality, toInches } from './print';

describe('print size and DPI', () => {
  it('turns pixels into a print size (tools/utility.md → U03)', () => {
    expect(printSize(3000, 300, 'cm')).toBeCloseTo(25.4, 6);
    expect(printSize(2000, 300, 'cm').toFixed(2)).toBe('16.93');
    expect(printSize(3000, 300, 'in')).toBe(10);
    expect(printSize(3000, 300, 'mm')).toBeCloseTo(254, 6);
  });

  it('gives the pixels a print needs, to the nearest pixel', () => {
    // A4 at 300 DPI is the famous 2480 × 3508.
    expect(pixelsFor(210, 'mm', 300)).toBe(2480);
    expect(pixelsFor(297, 'mm', 300)).toBe(3508);
    expect(pixelsFor(10, 'in', 300)).toBe(3000);
    expect(pixelsFor(6, 'in', 150)).toBe(900);
  });

  it('reads the DPI an image gives across a size', () => {
    expect(dpiOf(3000, 10, 'in')).toBe(300);
    expect(dpiOf(2480, 21, 'cm')).toBeCloseTo(299.96, 2);
    expect(toInches(2.54, 'cm')).toBeCloseTo(1, 9);
  });

  it('names what a DPI is good for', () => {
    expect(quality(300).level).toBe('print');
    expect(quality(299.96).level).toBe('print');
    expect(quality(299.4).level).toBe('fair');
    expect(quality(150).level).toBe('fair');
    expect(quality(72).level).toBe('low');
  });

  it('finds the largest paper an image fills at a DPI, either way round', () => {
    expect(largestPaper(2480, 3508, 300)?.id).toBe('a4');
    expect(largestPaper(3508, 2480, 300)?.id).toBe('a4');
    // 20 × 13.3 in at 300 DPI: A3 (16.5 × 11.7 in) is bigger than Tabloid (17 × 11 in).
    expect(largestPaper(6000, 4000, 300)?.id).toBe('a3');
    expect(largestPaper(6000, 4000, 150)?.id).toBe('a1');
    expect(largestPaper(100, 100, 300)).toBeNull();
    expect(PAPERS.every((paper) => paper.width <= paper.height)).toBe(true);
  });
});
