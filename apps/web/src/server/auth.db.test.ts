/**
 * Better Auth as src/server/auth.ts sets it up, through its HTTP handler, on a
 * real Postgres (TEST_DATABASE_URL; skipped without it):
 * the two-factor endpoints don't answer over HTTP, so a session alone can't
 * read an admin's TOTP secret, mint backup codes or turn TOTP off.
 * Mail and the logger are stand-ins.
 */
import { randomUUID } from 'node:crypto';

import { eq, twoFactors, users, type Db } from '@etb/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from './auth';
import { openTestDb, TEST_DATABASE_URL } from './test-db';

const holder = vi.hoisted(() => ({
  db: null as Db | null,
  links: [] as string[],
  site: 'http://localhost:3000',
}));
const SITE = holder.site;

vi.mock('./db', () => ({
  db: () => {
    if (!holder.db) throw new Error('no test database');
    return holder.db;
  },
}));
vi.mock('./env', () => ({
  serverEnv: () => ({
    SITE_URL: holder.site,
    BETTER_AUTH_SECRET: 'test-only-secret-for-auth-db-test-0123456789',
    WELCOME_GRANT_ENABLED: false,
  }),
}));
vi.mock('./mail', () => ({
  signInMail: (to: string, url: string) => ({ to, url }),
  sendMail: (mail: { url: string }) => {
    holder.links.push(mail.url);
    return Promise.resolve();
  },
}));
vi.mock('../lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Jar = Map<string, string>;

function keep(jar: Jar, response: Response): void {
  for (const line of response.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const at = pair.indexOf('=');
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (/max-age=0/i.test(line) || value === '') jar.delete(name);
    else jar.set(name, value);
  }
}

const cookie = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

async function post(jar: Jar, path: string, body: unknown = {}): Promise<Response> {
  const response = await auth().handler(
    new Request(`${SITE}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE, cookie: cookie(jar) },
      body: JSON.stringify(body),
    }),
  );
  keep(jar, response);
  return response;
}

/** The raw secret behind an authenticator link's base32 key. */
function unbase32(key: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = key
    .replace(/=+$/, '')
    .replace(/./g, (char) => alphabet.indexOf(char).toString(2).padStart(5, '0'));
  const bytes = (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2));
  return Buffer.from(bytes).toString('utf8');
}

/** Signs in with a magic link, as anyone who reads the mailbox could. */
async function signIn(email: string): Promise<Jar> {
  const jar: Jar = new Map();
  expect((await post(jar, '/sign-in/magic-link', { email, callbackURL: '/account' })).status).toBe(
    200,
  );
  const link = holder.links.pop();
  if (!link) throw new Error('no sign-in link');
  keep(jar, await auth().handler(new Request(link, { headers: { origin: SITE } })));
  expect([...jar.keys()].some((name) => name.endsWith('session_token'))).toBe(true);
  return jar;
}

describe.skipIf(!TEST_DATABASE_URL)('accounts', () => {
  let close: () => Promise<void>;

  beforeAll(async () => {
    const made = await openTestDb();
    holder.db = made.db;
    close = made.close;
  });

  afterAll(async () => {
    await close();
  });

  const testDb = () => {
    if (!holder.db) throw new Error('no test database');
    return holder.db;
  };

  it('leave an admin’s TOTP alone over HTTP, whatever the session', async () => {
    const email = `admin-${randomUUID()}@example.test`;
    const [admin] = await testDb()
      .insert(users)
      .values({ email, role: 'admin', emailVerified: true })
      .returning({ id: users.id });
    if (!admin) throw new Error('no admin');

    // Over HTTP, not even setting it up answers.
    const own = await signIn(email);
    expect((await post(own, '/two-factor/enable')).status).toBe(404);

    // The way /admin/two-factor sets it up: auth.api on the server.
    const headers = new Headers({ cookie: cookie(own) });
    await auth().api.enableTwoFactor({ body: {}, headers });
    const { totpURI } = await auth().api.getTOTPURI({ body: {}, headers });
    const secret = new URL(totpURI).searchParams.get('secret') ?? '';
    const { code } = await auth().api.generateTOTP({ body: { secret: unbase32(secret) } });
    await auth().api.verifyTOTP({ body: { code }, headers });
    const [stored] = await testDb()
      .select()
      .from(twoFactors)
      .where(eq(twoFactors.userId, admin.id));
    expect(stored?.verified).toBe(true);

    // Somebody else with a fresh session of the same account (a magic link from the mailbox).
    const other = await signIn(email);
    const tries: [string, unknown][] = [
      ['/two-factor/get-totp-uri', {}],
      ['/two-factor/generate-backup-codes', {}],
      ['/two-factor/disable', {}],
      ['/two-factor/enable', {}],
      ['/two-factor/verify-totp', { code }],
      ['/two-factor/verify-backup-code', { code: 'aaaaa-bbbbb' }],
      ['/two-factor/send-otp', {}],
      ['/two-factor/verify-otp', { code: '000000' }],
      // However the path is spelled.
      ['/two-factor/disable/', {}],
      ['/Two-Factor/disable', {}],
      ['/two%2Dfactor/disable', {}],
      ['/two-factor/%64isable', {}],
    ];
    for (const [path, body] of tries) {
      const response = await post(other, path, body);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type'), path).toBe('application/problem+json');
      expect(await response.text(), path).not.toContain(secret);
    }

    // Still on, with the same secret and backup codes.
    const [user] = await testDb().select().from(users).where(eq(users.id, admin.id));
    expect(user?.twoFactorEnabled).toBe(true);
    const [after] = await testDb().select().from(twoFactors).where(eq(twoFactors.userId, admin.id));
    expect(after).toEqual(stored);
  });
});
