import { describe, expect, it } from 'vitest';

import { dailyBudgetUsd, gpuStarting } from './gpu';

describe('the admin’s daily GPU budget field', () => {
  it('takes dollars from 0 to 1,000', () => {
    expect(dailyBudgetUsd.parse('2.5')).toBe(2.5);
    expect(dailyBudgetUsd.parse(' 0 ')).toBe(0);
    expect(dailyBudgetUsd.parse('1000')).toBe(1000);
  });

  it('refuses a blank field instead of saving $0', () => {
    expect(dailyBudgetUsd.safeParse('').success).toBe(false);
    expect(dailyBudgetUsd.safeParse('   ').success).toBe(false);
  });

  it('refuses what isn’t a budget', () => {
    for (const value of ['-1', '1000.01', 'abc', 'Infinity']) {
      expect(dailyBudgetUsd.safeParse(value).success).toBe(false);
    }
  });
});

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
