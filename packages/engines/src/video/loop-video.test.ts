import { describe, expect, it } from 'vitest';

import { loopPlan } from './loop-video';

describe('loopPlan', () => {
  it('repeats a number of times', () => {
    expect(loopPlan({ mode: 'times', times: '3' }, 4)).toEqual({
      loops: 3,
      total: 12,
      label: '3×',
    });
  });

  it('repeats up to a length, the last copy cut short', () => {
    expect(loopPlan({ mode: 'length', length: '10' }, 4)).toMatchObject({ loops: 3, total: 10 });
    // A whole number of loops needs no cut.
    expect(loopPlan({ mode: 'length', length: '12' }, 4)).toMatchObject({ loops: 3, total: 12 });
  });

  it('refuses what it can’t make', () => {
    expect(() => loopPlan({ mode: 'times', times: '1' }, 4)).toThrow(/2 to 50/);
    expect(() => loopPlan({ mode: 'times', times: '51' }, 4)).toThrow(/2 to 50/);
    expect(() => loopPlan({ mode: 'times', times: '50' }, 120)).toThrow(/limit of 60/);
    expect(() => loopPlan({ mode: 'length', length: '3' }, 4)).toThrow(/already 4.00 s/);
    expect(() => loopPlan({ mode: 'length', length: '4000' }, 4)).toThrow(/60 min/);
  });
});
