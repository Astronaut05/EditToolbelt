/**
 * A Cloudflare Access session for the browser tests (playwright.prod.config.ts),
 * saved as Playwright storage state: one CF_Authorization cookie for the site.
 *
 * - With CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (the live site): one
 *   request with the service token; Access answers with the cookie, which
 *   then stands in for the token on every later request.
 * - With E2E_FAKE_ACCESS=1 (CI, the production image): a stand-in Access team
 *   on 127.0.0.1. It serves its signing key where Access serves the team's
 *   (`/cdn-cgi/access/certs`) and signs the cookie itself. Start the web
 *   service with CF_ACCESS_TEAM_DOMAIN=http://127.0.0.1:<E2E_FAKE_ACCESS_PORT>
 *   and CF_ACCESS_AUD=<E2E_FAKE_ACCESS_AUD>.
 *
 * Nothing secret is printed: the cookie goes only to the state file.
 */
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATE = fileURLToPath(new URL('../test-results/prod-access.json', import.meta.url));

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
}

function saveCookie(site: URL, value: string): void {
  const cookie: Cookie = {
    name: 'CF_Authorization',
    value,
    domain: site.hostname,
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
    httpOnly: true,
    secure: site.protocol === 'https:',
    sameSite: 'Lax',
  };
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ cookies: [cookie], origins: [] }));
}

/** The cookie Access sets after one request with the service token. */
async function serviceTokenCookie(site: URL, id: string, secret: string): Promise<string> {
  const response = await fetch(new URL('/healthz', site), {
    headers: { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret },
    redirect: 'manual',
  });
  const value = response.headers
    .getSetCookie()
    .map((line) => /^CF_Authorization=([^;]+)/.exec(line)?.[1])
    .find(Boolean);
  if (!response.ok || !value) {
    throw new Error(
      `Access gave no session for the service token (HTTP ${String(response.status)}). ` +
        'Check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET, and the Service Auth policy.',
    );
  }
  return value;
}

/** A stand-in Access team: its key at /cdn-cgi/access/certs, and a token it signed. */
async function fakeAccess(
  port: number,
  audience: string,
): Promise<{ token: string; close: () => Promise<void> }> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const issuer = `http://127.0.0.1:${String(port)}`;
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = base64url(
    JSON.stringify({
      iss: issuer,
      aud: [audience],
      email: 'e2e@example.com',
      sub: randomUUID(),
      iat: now,
      nbf: now,
      exp: now + 2 * 60 * 60,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  const server = createServer((request, response) => {
    if (request.url === '/cdn-cgi/access/certs') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    token: `${head}.${body}.${base64url(signature)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  const site = new URL(process.env.E2E_BASE_URL ?? '');
  const id = process.env.CF_ACCESS_CLIENT_ID?.trim();
  const secret = process.env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (id && secret) {
    saveCookie(site, await serviceTokenCookie(site, id, secret));
    return undefined;
  }
  if (process.env.E2E_FAKE_ACCESS === '1') {
    const access = await fakeAccess(
      Number(process.env.E2E_FAKE_ACCESS_PORT ?? '9797'),
      process.env.E2E_FAKE_ACCESS_AUD ?? 'e2e-audience',
    );
    saveCookie(site, access.token);
    // A page without the cookie is refused, and one with it is let through.
    const refused = await fetch(new URL('/', site), { redirect: 'manual' });
    const allowed = await fetch(new URL('/', site), {
      headers: { Cookie: `CF_Authorization=${access.token}` },
      redirect: 'manual',
    });
    if (refused.status !== 403 || !allowed.ok) {
      await access.close();
      throw new Error(
        `The site doesn't check Access as expected: without a session HTTP ${String(refused.status)} (403 expected), with one HTTP ${String(allowed.status)}.`,
      );
    }
    return access.close;
  }
  throw new Error(
    'No Access session: set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (the live site) or E2E_FAKE_ACCESS=1 (a local image).',
  );
}
