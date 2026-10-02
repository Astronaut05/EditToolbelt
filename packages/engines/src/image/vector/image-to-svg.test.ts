import { describe, expect, it } from 'vitest';

import { traceOptions } from './image-to-svg';

describe('traceOptions', () => {
  it('takes the page’s settings', () => {
    expect(traceOptions({ mode: 'bw', colors: '4', detail: 'high', smoothness: 'sharp' })).toEqual({
      mode: 'bw',
      colors: 4,
      minArea: 4,
      tolerance: 0.75,
      cornerAngle: 40,
    });
    // Pixels keeps every pixel edge.
    expect(traceOptions({ smoothness: 'pixels', detail: 'low' })).toMatchObject({
      minArea: 64,
      tolerance: 0,
      cornerAngle: 0,
      exact: true,
    });
  });

  it('falls back to colour, 6 colours, medium detail and smooth curves', () => {
    expect(traceOptions({})).toEqual({
      mode: 'color',
      colors: 6,
      minArea: 16,
      tolerance: 1,
      cornerAngle: 60,
    });
    expect(traceOptions({ mode: 'x', colors: 'many', detail: 'x', smoothness: 'x' })).toEqual(
      traceOptions({}),
    );
  });

  it('keeps the colours between 2 and 16, whole', () => {
    expect(traceOptions({ colors: '1' }).colors).toBe(2);
    expect(traceOptions({ colors: '40' }).colors).toBe(16);
    expect(traceOptions({ colors: '7.6' }).colors).toBe(8);
  });
});
