import { describe, expect, it } from 'vitest';

import { MAX_PARTS, MIB, PART_SIZE, partLength, planParts } from './upload';

describe('planParts', () => {
  it('uses one part for a small file', () => {
    expect(planParts(1000)).toEqual({ partSize: PART_SIZE, partCount: 1 });
  });

  it('uses 8 MiB parts, the last one shorter', () => {
    const bytes = 20 * MIB + 5;
    const plan = planParts(bytes);
    expect(plan).toEqual({ partSize: 8 * MIB, partCount: 3 });
    expect([1, 2, 3].map((n) => partLength(bytes, plan, n))).toEqual([
      8 * MIB,
      8 * MIB,
      4 * MIB + 5,
    ]);
  });

  it('grows the part size in whole MiB to stay within 10,000 parts', () => {
    const bytes = 100 * 1024 * MIB; // 100 GiB
    const plan = planParts(bytes);
    expect(plan.partSize % MIB).toBe(0);
    expect(plan.partSize).toBeGreaterThan(PART_SIZE);
    expect(plan.partCount).toBeLessThanOrEqual(MAX_PARTS);
    expect(plan.partSize * plan.partCount).toBeGreaterThanOrEqual(bytes);
  });

  it('keeps 8 MiB at exactly 10,000 parts', () => {
    expect(planParts(PART_SIZE * MAX_PARTS)).toEqual({ partSize: PART_SIZE, partCount: MAX_PARTS });
  });

  it('refuses sizes that are not a positive whole number', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => planParts(bad)).toThrow(RangeError);
  });

  it('refuses part numbers outside the plan', () => {
    const plan = planParts(10);
    expect(() => partLength(10, plan, 0)).toThrow(RangeError);
    expect(() => partLength(10, plan, 2)).toThrow(RangeError);
  });
});
