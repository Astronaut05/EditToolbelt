import { describe, expect, it } from 'vitest';

import { gpuStarting } from './gpu';

describe('whether GPU jobs start', () => {
  const today = { jobs: 1, budgetUsd: 1 };

  it('says yes while even the worst case of the running jobs is under the budget', () => {
    expect(gpuStarting({ ...today, spentUsd: 0.2, committedUsd: 0.9 })).toBe('Yes');
  });

  it('says why not', () => {
    expect(gpuStarting({ ...today, spentUsd: 1, committedUsd: 1 })).toBe('No: budget reached');
    expect(gpuStarting({ ...today, spentUsd: 0.2, committedUsd: 1.3 })).toContain(
      'running GPU job',
    );
  });
});
