import { describe, expect, it } from 'vitest';

import {
  accessConfig,
  accessExempt,
  teamKeys,
  verifyAccessToken,
  type AccessConfig,
} from './access';

const config: AccessConfig = {
  teamDomain: 'https://team.cloudflareaccess.example',
  audience: 'aud-tag',
};
const NOW = Date.UTC(2026, 9, 1, 12);

const pair = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
);
const other = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
);

const b64 = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token(
  claims: Record<string, unknown>,
  { kid = 'k1', alg = 'RS256', key = pair.privateKey } = {},
) {
  const head = b64(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64(new Uint8Array(signature))}`;
}

const valid = {
  iss: config.teamDomain,
  aud: [config.audience],
  exp: NOW / 1000 + 600,
  nbf: NOW / 1000 - 10,
  email: 'someone@example.com',
};
const keyFor = (kid: string) => Promise.resolve(kid === 'k1' ? pair.publicKey : null);

describe('verifyAccessToken', () => {
  it("lets through a person's token and a service token for this application", async () => {
    expect(await verifyAccessToken(await token(valid), config, keyFor, NOW)).toEqual({
      ok: true,
      subject: 'person',
    });
    const service = { ...valid, email: undefined, common_name: 'client-id.access' };
    expect(await verifyAccessToken(await token(service), config, keyFor, NOW)).toEqual({
      ok: true,
      subject: 'service',
    });
  });

  it('refuses a token for another application, another team, or out of date', async () => {
    const check = async (claims: Record<string, unknown>) =>
      verifyAccessToken(await token({ ...valid, ...claims }), config, keyFor, NOW);
    expect(await check({ aud: ['other'] })).toEqual({ ok: false, reason: 'audience' });
    expect(await check({ iss: 'https://other.cloudflareaccess.example' })).toEqual({
      ok: false,
      reason: 'issuer',
    });
    expect(await check({ exp: NOW / 1000 - 60 })).toEqual({ ok: false, reason: 'expired' });
    expect(await check({ exp: undefined })).toEqual({ ok: false, reason: 'expired' });
    expect(await check({ nbf: NOW / 1000 + 120 })).toEqual({
      ok: false,
      reason: 'not yet valid',
    });
  });

  it('refuses a forged, altered, unsigned or unknown-key token', async () => {
    const forged = await token(valid, { key: other.privateKey });
    expect(await verifyAccessToken(forged, config, keyFor, NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
    const [head, , signature] = (await token(valid)).split('.');
    const altered = `${head ?? ''}.${b64(JSON.stringify({ ...valid, aud: ['x'] }))}.${signature ?? ''}`;
    expect((await verifyAccessToken(altered, config, keyFor, NOW)).ok).toBe(false);
    expect(
      await verifyAccessToken(await token(valid, { alg: 'none' }), config, keyFor, NOW),
    ).toEqual({
      ok: false,
      reason: 'algorithm',
    });
    expect(await verifyAccessToken(await token(valid, { kid: 'k9' }), config, keyFor, NOW)).toEqual(
      {
        ok: false,
        reason: 'unknown key',
      },
    );
    expect(await verifyAccessToken('not-a-token', config, keyFor, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('teamKeys', () => {
  it('fetches the keys once an hour, and again (at most once a minute) for an unknown key', async () => {
    const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
    const urls: string[] = [];
    const fetcher = (url: string) => {
      urls.push(url);
      return Promise.resolve(Response.json({ keys: [jwk] }));
    };
    let now = NOW;
    const lookup = teamKeys(config, fetcher, () => now);
    expect(await lookup('k1')).not.toBeNull();
    expect(urls).toEqual(['https://team.cloudflareaccess.example/cdn-cgi/access/certs']);
    expect(await lookup('k1')).not.toBeNull();
    expect(await lookup('k2')).toBeNull();
    expect(urls).toHaveLength(1); // the last fetch was under a minute ago
    now += 61 * 1000;
    expect(await lookup('k2')).toBeNull();
    expect(urls).toHaveLength(2);
    now += 2 * 60 * 60 * 1000;
    expect(await lookup('k1')).not.toBeNull();
    expect(urls).toHaveLength(3);
  });

  it('keeps working on the keys it has when Cloudflare is unreachable', async () => {
    const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
    let up = true;
    let now = NOW;
    const fetcher = () =>
      up ? Promise.resolve(Response.json({ keys: [jwk] })) : Promise.reject(new Error('down'));
    const lookup = teamKeys(config, fetcher, () => now);
    expect(await lookup('k1')).not.toBeNull();
    up = false;
    now += 2 * 60 * 60 * 1000;
    expect(await lookup('k1')).not.toBeNull();
  });
});

describe('accessConfig and accessExempt', () => {
  it('needs both variables', () => {
    expect(accessConfig({})).toBeNull();
    expect(
      accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.example/' }),
    ).toBeNull();
    expect(
      accessConfig({
        CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.example/',
        CF_ACCESS_AUD: ' aud ',
      }),
    ).toEqual({ teamDomain: 'https://team.cloudflareaccess.example', audience: 'aud' });
  });

  it('opens only the health checks and the payment webhooks', () => {
    expect(accessExempt('/readyz')).toBe(true);
    expect(accessExempt('/healthz')).toBe(true);
    expect(accessExempt('/api/webhooks/paddle')).toBe(true);
    expect(accessExempt('/readyz/x')).toBe(false);
    // The worker's ages are for Astro and CI's service token only.
    expect(accessExempt('/readyz/worker')).toBe(false);
    expect(accessExempt('/api/v1/me')).toBe(false);
    expect(accessExempt('/')).toBe(false);
  });
});
