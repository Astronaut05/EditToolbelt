import { describe, expect, it } from 'vitest';

import { previewTerms, serverTerms, type ShellServer } from './server';

const GB = 1024 ** 3;
const server: ShellServer = {
  price: '1 credit a minute, at least 2',
  estimate: () => 2,
  maxBytes: { free: 2 * GB, paid: 10 * GB },
  signInHref: '/sign-in',
  account: () => Promise.resolve(null),
  run: () => Promise.reject(new Error('not here')),
};
const free = { tier: 'free' as const, balance: 0, freeJobsLeft: 3 };

describe('serverTerms', () => {
  it('offers a free daily job first', () => {
    expect(serverTerms(server, free, GB, 5)).toEqual({
      ok: true,
      line: 'Free: uses 1 of your free server jobs today (3 left).',
    });
    expect(serverTerms(server, free, GB, 0).line).toBe('Free.');
  });

  it('then credits, and says when there are too few', () => {
    const spent = { ...free, freeJobsLeft: 0, balance: 10 };
    expect(serverTerms(server, spent, GB, 4)).toEqual({
      ok: true,
      line: 'About 4 credits; you have 10.',
    });
    const broke = { ...spent, balance: 1 };
    const terms = serverTerms(server, broke, GB, 4);
    expect(terms.ok).toBe(false);
    expect(terms.needsCredits).toBe(true);
    expect(serverTerms(server, spent, GB, 4).needsCredits).toBeUndefined();
    expect(serverTerms(server, { ...spent, balance: 0 }, GB, null).needsCredits).toBe(true);
    expect(terms.line).toMatch(/No free server jobs left today.*come back tomorrow/);
    // A price the server works out from the file it checks.
    expect(serverTerms(server, spent, GB, null).line).toMatch(/confirmed before it starts/);
  });

  it('holds files over the tier’s limit, and says what a paid account takes', () => {
    const terms = serverTerms(server, free, 3 * GB, 5);
    expect(terms.ok).toBe(false);
    // Credits don't fix a file that's too big for the tool.
    expect(terms.needsCredits).toBeUndefined();
    expect(terms.line).toBe(
      'Our servers take up to 2.1 GB on a free account, and 10.7 GB once you’ve bought credits.',
    );
    const paid = { tier: 'paid' as const, balance: 100, freeJobsLeft: 0 };
    expect(serverTerms(server, paid, 11 * GB, 5)).toEqual({
      ok: false,
      line: 'Our servers take up to 10.7 GB for this tool.',
    });
  });
});

describe('previewTerms', () => {
  it('spends a never-paid account’s free job, and nothing of a paid one', () => {
    expect(previewTerms(free)).toEqual({
      ok: true,
      line: 'Free: uses 1 of your free server jobs today (3 left).',
    });
    expect(previewTerms({ ...free, freeJobsLeft: 0 }).ok).toBe(false);
    expect(previewTerms({ tier: 'paid', balance: 0, freeJobsLeft: 0 })).toEqual({
      ok: true,
      line: 'Free: no credits used.',
    });
  });
});
