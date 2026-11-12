import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/log', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('./db', () => ({ db: () => ({}) }));
vi.mock('./env', () => ({ serverEnv: () => ({}) }));

const { authPathAllowed, LINK_LIMITS, signInLinkRefused } = await import('./auth');

// With Better Auth's own limiter off (it counts by IP, which we don't keep),
// its HTTP surface is only the landings; the rest is called on the server.
describe('Better Auth over HTTP', () => {
  it('answers only where an emailed link and Google’s redirect land', () => {
    for (const path of ['/magic-link/verify', '/callback/google', '/error', '/callback/google/']) {
      expect(authPathAllowed('GET', `/api/auth${path}`), path).toBe(true);
    }
  });

  it('answers nothing else', () => {
    for (const [method, path] of [
      ['POST', '/sign-in/magic-link'], // would mail anyone, without limit
      ['POST', '/update-user'], // would store a name of any size
      ['POST', '/sign-in/social'],
      ['POST', '/sign-out'],
      ['GET', '/get-session'],
      ['GET', '/list-sessions'],
      ['POST', '/revoke-sessions'],
      ['POST', '/delete-user'],
      ['POST', '/two-factor/enable'],
      ['POST', '/magic-link/verify'],
      ['POST', '/callback/google'],
      ['GET', '/callback/github'],
      ['GET', '/magic-link/verify/x'],
      ['GET', '/Magic-Link/Verify'],
      ['GET', ''],
    ] as const) {
      expect(authPathAllowed(method, `/api/auth${path}`), `${method} ${path}`).toBe(false);
    }
  });
});

describe('asking for a sign-in link', () => {
  const T0 = Date.UTC(2026, 10, 12, 12);

  it('allows three for one email in 15 minutes, then refuses until the window ends', () => {
    const email = 'three@example.com';
    for (let i = 0; i < LINK_LIMITS.perEmail; i += 1) {
      expect(signInLinkRefused(email, `198.51.100.${String(i)}`, T0 + i)).toBeNull();
    }
    expect(signInLinkRefused(email, '198.51.100.99', T0 + 10)).toBe('TOO_MANY_LINKS');
    // However the address is written.
    expect(signInLinkRefused(' Three@Example.com ', '198.51.100.98', T0 + 11)).toBe(
      'TOO_MANY_LINKS',
    );
    expect(
      signInLinkRefused(email, '198.51.100.97', T0 + LINK_LIMITS.windowSec * 1000 + 1),
    ).toBeNull();
  });

  it('allows one caller ten in 15 minutes, whoever they are for', () => {
    const address = '203.0.113.5';
    for (let i = 0; i < LINK_LIMITS.perAddress; i += 1) {
      expect(signInLinkRefused(`caller-${String(i)}@example.com`, address, T0)).toBeNull();
    }
    expect(signInLinkRefused('caller-next@example.com', address, T0)).toBe('TOO_MANY_REQUESTS');
    // A refused request spends nothing of the email's own allowance.
    expect(signInLinkRefused('caller-next@example.com', '203.0.113.6', T0)).toBeNull();
  });

  it('does not count callers from this machine (the local stack), who would all share one count', () => {
    // As addressOf gives them: no proxy, IPv4 loopback, and ::1 by its /64.
    for (const address of ['direct', '127.0.0.1', '0:0:0:0::/64']) {
      for (let i = 0; i < LINK_LIMITS.perAddress + 5; i += 1) {
        expect(
          signInLinkRefused(`local-${address}-${String(i)}@example.com`, address, T0),
          address,
        ).toBeNull();
      }
    }
  });

  it('pauses links for everyone once 300 went out in an hour', () => {
    const later = T0 + 2 * 60 * 60 * 1000;
    let allowed = 0;
    for (let i = 0; i < LINK_LIMITS.all + 20; i += 1) {
      const refused = signInLinkRefused(
        `all-${String(i)}@example.com`,
        `2001:db8:${i.toString(16)}::/64`,
        later,
      );
      if (refused === null) allowed += 1;
      else expect(refused).toBe('LINKS_PAUSED');
    }
    expect(allowed).toBe(LINK_LIMITS.all);
    expect(
      signInLinkRefused(
        'after@example.com',
        '203.0.113.200',
        later + LINK_LIMITS.allWindowSec * 1000 + 1,
      ),
    ).toBeNull();
  });
});
