import { randomUUID } from 'node:crypto';

import { and, creditTransactions, eq, users, welcomeGrantClaims, type Db } from '@etb/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { balanceOf, newUser, openTestDb, TEST_DATABASE_URL } from './test-db';
import { claimWelcomeGrant, emailHmac, grantSecret, isDisposable, normaliseEmail } from './welcome';

describe('normaliseEmail', () => {
  it.each([
    ['Ann@Example.TEST', 'ann@example.test'],
    ['ann+promo@example.test', 'ann@example.test'],
    [' a.n.n+x@GoogleMail.com ', 'ann@gmail.com'],
    ['a.n.n@gmail.com', 'ann@gmail.com'],
    ['a.n.n@outlook.com', 'a.n.n@outlook.com'],
  ])('%s → %s', (email, expected) => {
    expect(normaliseEmail(email)).toBe(expected);
  });
});

describe('isDisposable', () => {
  it('matches a listed domain and its subdomains, nothing else', () => {
    const domains = ['mailinator.com'];
    expect(isDisposable('x@mailinator.com', domains)).toBe(true);
    expect(isDisposable('x@EU.Mailinator.com', domains)).toBe(true);
    expect(isDisposable('x@notmailinator.com', domains)).toBe(false);
    expect(isDisposable('x@gmail.com', domains)).toBe(false);
    expect(isDisposable('x@yopmail.com')).toBe(true);
  });
});

describe('the grant secret and the email HMAC', () => {
  const auth = 'b'.repeat(40);

  it('uses WELCOME_GRANT_SECRET when set, else one derived from the auth secret', () => {
    expect(grantSecret({ BETTER_AUTH_SECRET: auth, WELCOME_GRANT_SECRET: 's'.repeat(32) })).toBe(
      's'.repeat(32),
    );
    const derived = grantSecret({ BETTER_AUTH_SECRET: auth });
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain(auth);
    expect(grantSecret({ BETTER_AUTH_SECRET: auth })).toBe(derived);
  });

  it('is the same for every alias of one inbox, and never the email', () => {
    const secret = 'k'.repeat(32);
    const one = emailHmac('Ann.Lee@gmail.com', secret);
    expect(emailHmac('annlee+edits@googlemail.com', secret)).toBe(one);
    expect(emailHmac('ann@gmail.com', secret)).not.toBe(one);
    expect(emailHmac('Ann.Lee@gmail.com', 'other'.repeat(8))).not.toBe(one);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('claimWelcomeGrant', () => {
  let db: Db;
  let close: () => Promise<void>;
  const secret = `test-${randomUUID()}`;

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function verifiedUser(email = `${randomUUID()}@example.test`): Promise<string> {
    const id = await newUser(db, email);
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, id));
    return id;
  }

  const grants = (userId: string) =>
    db
      .select()
      .from(creditTransactions)
      .where(
        and(eq(creditTransactions.userId, userId), eq(creditTransactions.kind, 'welcome_grant')),
      );

  it('gives 30 credits once, after verification', async () => {
    const unverified = await newUser(db);
    expect(await claimWelcomeGrant(db, unverified, { secret })).toBe('unverified');
    expect(await balanceOf(db, unverified)).toBe(0);
    const userId = await verifiedUser();
    expect(await claimWelcomeGrant(db, userId, { secret })).toBe('granted');
    expect(await balanceOf(db, userId)).toBe(30);
    expect(await claimWelcomeGrant(db, userId, { secret })).toBe('already');
    expect(await grants(userId)).toHaveLength(1);
  });

  it('gives it once per email, even across a deleted account and aliases', async () => {
    const local = randomUUID().replace(/-/g, '');
    const first = await verifiedUser(`${local}@gmail.com`);
    expect(await claimWelcomeGrant(db, first, { secret })).toBe('granted');
    // The account is scrubbed into a tombstone; the email signs up again as an alias.
    await db.update(users).set({ email: null }).where(eq(users.id, first));
    const again = await verifiedUser(`${local.slice(0, 4)}.${local.slice(4)}+new@gmail.com`);
    expect(await claimWelcomeGrant(db, again, { secret })).toBe('claimed');
    expect(await balanceOf(db, again)).toBe(0);
    const [claim] = await db
      .select()
      .from(welcomeGrantClaims)
      .where(eq(welcomeGrantClaims.emailHmac, emailHmac(`${local}@gmail.com`, secret)));
    expect(claim?.emailHmac).not.toContain(local);
  });

  it('gives it once under concurrent sign-ins', async () => {
    const userId = await verifiedUser();
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => claimWelcomeGrant(db, userId, { secret })),
    );
    expect(outcomes.filter((o) => o === 'granted')).toHaveLength(1);
    expect(await grants(userId)).toHaveLength(1);
    expect(await balanceOf(db, userId)).toBe(30);
  });

  it('refuses throwaway inboxes, and closed or unknown accounts', async () => {
    const throwaway = await verifiedUser(`${randomUUID()}@yopmail.com`);
    expect(await claimWelcomeGrant(db, throwaway, { secret })).toBe('disposable');
    expect(await balanceOf(db, throwaway)).toBe(0);
    const listed = await verifiedUser(`${randomUUID()}@burner.example.test`);
    expect(await claimWelcomeGrant(db, listed, { secret, domains: ['burner.example.test'] })).toBe(
      'disposable',
    );
    const closed = await verifiedUser();
    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, closed));
    expect(await claimWelcomeGrant(db, closed, { secret })).toBe('no_user');
    expect(await claimWelcomeGrant(db, randomUUID(), { secret })).toBe('no_user');
  });
});
