import { describe, expect, it } from 'vitest';

import { remembered } from './remember';

describe('an answer remembered for everyone who asks', () => {
  const setup = (answers: boolean[]) => {
    let now = 0;
    let checks = 0;
    const ask = remembered(
      () => Promise.resolve(answers[Math.min(checks++, answers.length - 1)] ?? false),
      { goodMs: 10_000, badMs: 2_000, good: (ok) => ok },
      () => now,
    );
    return { ask, pass: (ms: number) => (now += ms), count: () => checks };
  };

  it('runs one check for callers at the same time, and none for 10 seconds after a good answer', async () => {
    const { ask, pass, count } = setup([true]);
    expect(await Promise.all([ask(), ask(), ask()])).toEqual([true, true, true]);
    expect(count()).toBe(1);
    pass(9_999);
    await ask();
    expect(count()).toBe(1);
    pass(1);
    await ask();
    expect(count()).toBe(2);
  });

  it('keeps a bad answer only 2 seconds, so recovery shows quickly', async () => {
    const { ask, pass, count } = setup([false, true]);
    expect(await ask()).toBe(false);
    pass(1_999);
    expect(await ask()).toBe(false);
    expect(count()).toBe(1);
    pass(1);
    expect(await ask()).toBe(true);
    expect(count()).toBe(2);
  });

  it('remembers nothing of a check that threw', async () => {
    let fail = true;
    const ask = remembered(
      () => (fail ? Promise.reject(new Error('down')) : Promise.resolve(true)),
      { goodMs: 10_000, badMs: 2_000, good: (ok) => ok },
      () => 0,
    );
    await expect(ask()).rejects.toThrow('down');
    fail = false;
    expect(await ask()).toBe(true);
  });
});
