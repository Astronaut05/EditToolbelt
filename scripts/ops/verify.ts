/**
 * Checks the production setup from outside, in GitHub Actions (`.github/workflows/ops.yml`):
 * storage, Cloudflare's settings, the site through Cloudflare Access. Each check
 * runs when its secrets are set and is skipped otherwise; OPS_CHECKS picks some
 * by name (`r2,cloudflare`). Run locally with the same variables:
 *
 *   OPS_CHECKS=r2 R2_ENDPOINT=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… node scripts/ops/verify.ts
 *
 * The repo is public and so are its Actions logs: this script never prints a
 * secret, an email address, an account id or a key. It prints what was
 * checked and whether it held.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type Env = Record<string, string | undefined>;

export interface Outcome {
  name: string;
  ok: boolean | null;
  detail: string;
}

/** A failed expectation inside a check: its message is printed, never a value it compared. */
class Failed extends Error {}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Failed(message);
}

// ── S3 (R2) with query-string SigV4, so the same URLs work from a browser ────

export interface S3 {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** A presigned URL for one call on one key (path-style, UNSIGNED-PAYLOAD, host signed). */
export function presign(
  s3: S3,
  method: string,
  key: string,
  { expires = 300, now = new Date() }: { expires?: number; now?: Date } = {},
): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const url = new URL(s3.endpoint);
  url.pathname = `/${s3.bucket}/${key.split('/').map(encode).join('/')}`;
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${s3.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(params)
    .sort()
    .map((name) => `${encode(name)}=${encode(params[name] ?? '')}`)
    .join('&');
  const canonical = [
    method,
    url.pathname,
    query,
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  let signingKey = hmac(`AWS4${s3.secretAccessKey}`, day);
  for (const part of [s3.region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${signature}`;
}

async function checkR2(env: Env, site: string): Promise<string> {
  const s3: S3 = {
    endpoint: env.R2_ENDPOINT ?? '',
    bucket: env.R2_BUCKET ?? 'edittoolbelt-files',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    region: 'auto',
  };
  let endpoint: URL;
  try {
    endpoint = new URL(s3.endpoint);
  } catch {
    throw new Failed(
      `R2_ENDPOINT is not a URL (${shapeOf(s3.endpoint)}): paste the EU endpoint R2 shows, starting with https://`,
    );
  }
  // The endpoint R2 shows has no path; one pasted with the bucket on the end still works.
  s3.endpoint = endpoint.origin;
  expect(
    endpoint.hostname.split('.').includes('eu'),
    'R2_ENDPOINT is not the EU jurisdiction endpoint (its host has no `.eu.` label)',
  );
  const key = `ops-check/${randomUUID()}.txt`;
  const body = `ops check ${new Date().toISOString()}`;

  // Upload the way the browser does: a presigned PUT, from the site's origin.
  const put = await fetch(presign(s3, 'PUT', key), {
    method: 'PUT',
    body,
    headers: { Origin: site },
  });
  expect(put.ok, `PUT with the app's key answered HTTP ${String(put.status)}`);
  expect(put.headers.get('etag'), 'PUT answered no ETag');
  // CORS headers are settings, not secrets: say what came back.
  const allowOrigin = put.headers.get('access-control-allow-origin');
  const exposed = (put.headers.get('access-control-expose-headers') ?? '').toLowerCase();
  expect(
    exposed.includes('etag'),
    `CORS: ETag is not exposed to the site (the upload answered Access-Control-Allow-Origin: ${allowOrigin ?? 'none'}, Access-Control-Expose-Headers: ${exposed || 'none'})`,
  );

  try {
    const get = await fetch(presign(s3, 'GET', key));
    expect(get.ok && (await get.text()) === body, 'GET did not return what was uploaded');

    const preflight = (origin: string) =>
      fetch(presign(s3, 'PUT', key), {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT' },
      });
    const allowed = await preflight(site);
    expect(
      allowed.headers.get('access-control-allow-origin') === site,
      'CORS: the site may not PUT to the bucket (AllowedOrigins / AllowedMethods)',
    );
    const other = await preflight('https://example.com');
    expect(
      !other.headers.get('access-control-allow-origin'),
      'CORS: other sites may PUT to the bucket too',
    );
  } finally {
    const removed = await fetch(presign(s3, 'DELETE', key), { method: 'DELETE' });
    expect(removed.ok, `DELETE answered HTTP ${String(removed.status)}`);
  }
  const gone = await fetch(presign(s3, 'GET', key));
  expect(gone.status === 404, `a deleted object still answers HTTP ${String(gone.status)}`);
  return 'EU endpoint; presigned PUT, GET and DELETE work; CORS allows the site only and exposes ETag';
}

// ── Cloudflare's own settings, read with a read-only API token ───────────────

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

async function cloudflare<T>(env: Env, path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    headers: { Authorization: `Bearer ${env.CF_READ_TOKEN ?? ''}`, ...headers },
  });
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    result?: T;
    errors?: { code: number }[];
  };
  if (!response.ok || !data.success || data.result === undefined) {
    const codes = (data.errors ?? []).map((e) => String(e.code)).join(', ');
    throw new Failed(
      `Cloudflare API ${path.replace(/\/accounts\/[^/]+/, '/accounts/…')} answered HTTP ${String(response.status)}${codes ? ` (error ${codes})` : ''}`,
    );
  }
  return data.result;
}

interface LifecycleRule {
  enabled?: boolean;
  conditions?: { prefix?: string };
  deleteObjectsTransition?: { condition?: { type?: string; maxAge?: number } };
  abortMultipartUploadsTransition?: { condition?: { type?: string; maxAge?: number } };
}

interface CorsRule {
  allowed?: { origins?: string[]; methods?: string[]; headers?: string[] };
  exposeHeaders?: string[];
}

const DAY = 86_400;

/** Lifecycle: every object deleted and every multipart upload aborted within a day (docs/01 → Retention). */
export function lifecycleProblems(rules: LifecycleRule[]): string[] {
  const all = rules.filter((rule) => rule.enabled !== false && !rule.conditions?.prefix);
  const within = (age?: { type?: string; maxAge?: number }) =>
    age?.type === 'Age' && typeof age.maxAge === 'number' && age.maxAge <= DAY;
  const problems: string[] = [];
  if (!all.some((rule) => within(rule.deleteObjectsTransition?.condition)))
    problems.push('no enabled rule deletes every object after 1 day');
  if (!all.some((rule) => within(rule.abortMultipartUploadsTransition?.condition)))
    problems.push('no enabled rule aborts every multipart upload after 1 day');
  return problems;
}

export function corsProblems(rules: CorsRule[], site: string): string[] {
  const rule = rules.find((r) => r.allowed?.origins?.includes(site));
  if (!rule) return ['no CORS rule allows the site'];
  const methods = (rule.allowed?.methods ?? []).map((m) => m.toUpperCase());
  const problems = ['PUT', 'GET']
    .filter((m) => !methods.includes(m))
    .map((m) => `CORS does not allow ${m}`);
  if (!(rule.exposeHeaders ?? []).some((h) => h.toLowerCase() === 'etag'))
    problems.push('CORS does not expose ETag');
  if (rules.some((r) => r.allowed?.origins?.includes('*')))
    problems.push('a CORS rule allows every origin');
  return problems;
}

/** The read-only token works and the account id looks like one; a readable reason if not. */
async function checkToken(env: Env): Promise<void> {
  const account = env.CF_ACCOUNT_ID ?? '';
  expect(
    /^[0-9a-f]{32}$/.test(account),
    `CF_ACCOUNT_ID should be 32 hexadecimal characters (it is ${shapeOf(account)})`,
  );
  const token = env.CF_READ_TOKEN ?? '';
  const verify = async (path: string) => {
    const response = await fetch(`${CLOUDFLARE_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { status?: string };
      errors?: { code: number }[];
    };
    return { ok: Boolean(data.success), status: data.result?.status, errors: data.errors ?? [] };
  };
  // A user token verifies at /user, an account-owned one under its account.
  const asUser = await verify('/user/tokens/verify');
  const asAccount = asUser.ok ? asUser : await verify(`/accounts/${account}/tokens/verify`);
  const result = asUser.ok ? asUser : asAccount;
  const codes = [asUser, ...(asUser.ok ? [] : [asAccount])]
    .map(
      (r, i) =>
        `${i === 0 ? 'as a user token' : 'as an account token'}: ${r.errors.map((e) => String(e.code)).join(', ') || 'no error code'}`,
    )
    .join('; ');
  expect(
    result.ok,
    `CF_READ_TOKEN is not a working API token (${shapeOf(token)}; Cloudflare answered ${codes}). Use the token from My Profile → API Tokens → edittoolbelt-ci-read, not an R2 key or the Global API Key`,
  );
  expect(result.status === 'active', `CF_READ_TOKEN is ${result.status ?? 'not active'}`);
}

async function checkCloudflareR2(env: Env, site: string): Promise<string> {
  await checkToken(env);
  const account = env.CF_ACCOUNT_ID ?? '';
  const bucket = env.R2_BUCKET ?? 'edittoolbelt-files';
  const eu = { 'cf-r2-jurisdiction': 'eu' };
  const base = `/accounts/${account}/r2/buckets/${bucket}`;
  const info = await cloudflare<{ jurisdiction?: string }>(env, base, eu);
  expect(info.jurisdiction === 'eu', 'the bucket is not in the EU jurisdiction');
  const lifecycle = await cloudflare<{ rules?: LifecycleRule[] }>(env, `${base}/lifecycle`, eu);
  const cors = await cloudflare<{ rules?: CorsRule[] }>(env, `${base}/cors`, eu);
  const problems = [
    ...lifecycleProblems(lifecycle.rules ?? []),
    ...corsProblems(cors.rules ?? [], site),
  ];
  // Bucket settings aren't secrets: show what the API answered when it doesn't fit.
  expect(
    problems.length === 0,
    `${problems.join('; ')}. Lifecycle as the API answers it: ${JSON.stringify(lifecycle)}`,
  );
  return 'EU jurisdiction; every object expires and every multipart upload aborts within 1 day; CORS rule for the site';
}

// ── DNS and email records, read with the same token ─────────────────────────

interface DnsRecord {
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

async function zoneRecords(env: Env, host: string): Promise<DnsRecord[]> {
  const zones = await cloudflare<{ id: string; name: string }[]>(
    env,
    `/zones?name=${encodeURIComponent(host)}`,
  );
  const zone = zones[0];
  expect(zone, "the read-only token cannot see the site's zone");
  return cloudflare<DnsRecord[]>(env, `/zones/${zone.id}/dns_records?per_page=500`);
}

/** What the domain's records say about the site and its email; names only, never values. */
export function dnsProblems(records: DnsRecord[], host: string): string[] {
  const problems: string[] = [];
  for (const name of [host, `www.${host}`]) {
    const record = records.find((r) => r.name === name && ['CNAME', 'A', 'AAAA'].includes(r.type));
    if (!record) problems.push(`no record for ${name}`);
    else if (!record.proxied) problems.push(`${name} is not proxied through Cloudflare`);
  }
  const txt = records.filter((r) => r.type === 'TXT');
  const unquote = (value: string) => value.replace(/^"|"$/g, '');
  if (!txt.some((r) => unquote(r.content).startsWith('v=spf1')))
    problems.push('no SPF record (TXT v=spf1)');
  if (!records.some((r) => r.name.includes('._domainkey.')))
    problems.push('no DKIM record (…._domainkey)');
  if (!txt.some((r) => r.name === `_dmarc.${host}` && unquote(r.content).startsWith('v=DMARC1')))
    problems.push('no DMARC record (_dmarc, v=DMARC1)');
  return problems;
}

async function checkDns(env: Env, site: string): Promise<string> {
  const host = new URL(site).hostname;
  const records = await zoneRecords(env, host);
  const problems = dnsProblems(records, host);
  expect(problems.length === 0, problems.join('; '));
  return `${host} and www proxied; SPF, DKIM and DMARC records present`;
}

// ── Cloudflare Access in front of the site ───────────────────────────────────

interface AccessRule {
  email?: { email?: string };
  email_domain?: unknown;
  everyone?: unknown;
  service_token?: { token_id?: string };
  any_valid_service_token?: unknown;
}

interface AccessPolicy {
  decision?: string;
  include?: AccessRule[];
}

interface AccessApp {
  type?: string;
  domain?: string;
  self_hosted_domains?: string[];
  destinations?: { type?: string; uri?: string }[];
  policies?: AccessPolicy[];
}

/** One self-hosted app covering the site and www: one email allowed, CI's service token, nobody else. */
export function accessProblems(apps: AccessApp[], host: string): string[] {
  const covers = (app: AccessApp, name: string) => {
    const domains = [
      app.domain,
      ...(app.self_hosted_domains ?? []),
      ...(app.destinations ?? []).map((d) => d.uri),
    ].filter((d): d is string => typeof d === 'string');
    return domains.some((d) => d === name || d === `${name}/` || d === `${name}/*`);
  };
  const app = apps.find((a) => covers(a, host));
  if (!app) return ['no Access application covers the site'];
  const problems: string[] = [];
  if (!covers(app, `www.${host}`)) problems.push('the Access application does not cover www');
  const policies = app.policies ?? [];
  const rules = (decision: string) =>
    policies.filter((p) => p.decision === decision).flatMap((p) => p.include ?? []);
  const allow = rules('allow');
  const emails = allow.filter((r) => r.email?.email).length;
  if (emails !== 1) problems.push(`the allow policy names ${String(emails)} emails, not 1`);
  if (allow.some((r) => r.everyone !== undefined || r.email_domain !== undefined))
    problems.push('the allow policy lets in more than one person (everyone or a whole domain)');
  if (rules('bypass').length > 0) problems.push('a bypass policy opens the whole site');
  const service = rules('non_identity');
  if (!service.some((r) => r.service_token || r.any_valid_service_token))
    problems.push("no Service Auth policy for CI's service token");
  return problems;
}

async function checkAccess(env: Env, site: string): Promise<string> {
  const host = new URL(site).hostname;
  const apps = await cloudflare<AccessApp[]>(
    env,
    `/accounts/${env.CF_ACCOUNT_ID ?? ''}/access/apps`,
  );
  const problems = accessProblems(apps, host);
  expect(problems.length === 0, problems.join('; '));
  return 'one application covers the site and www; one email allowed; a Service Auth policy for CI';
}

// ── The live site, from outside and through Access ───────────────────────────

async function checkSite(env: Env, site: string): Promise<string> {
  const outside = await fetch(`${site}/`, { redirect: 'manual' });
  const location = outside.headers.get('location') ?? '';
  expect(
    (outside.status >= 300 &&
      outside.status < 400 &&
      new URL(location, site).hostname.endsWith('.cloudflareaccess.com')) ||
      outside.status === 403,
    `without Access the home page answered HTTP ${String(outside.status)}, not the Access login`,
  );
  const token = {
    'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID ?? '',
    'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET ?? '',
  };
  const get = (path: string) => fetch(`${site}${path}`, { headers: token, redirect: 'manual' });
  const health = await get('/healthz');
  expect(health.ok, `/healthz answered HTTP ${String(health.status)} through Access`);
  const { version } = (await health.json()) as { version?: string };
  const ready = await get('/readyz');
  expect(ready.ok, `/readyz answered HTTP ${String(ready.status)}: ${await ready.text()}`);
  const home = await get('/');
  expect(home.ok, `the home page answered HTTP ${String(home.status)} through Access`);
  const missing = [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ].filter((name) => !home.headers.get(name));
  expect(missing.length === 0, `the home page lacks ${missing.join(', ')}`);
  const www = await fetch(`${site.replace('://', '://www.')}/convert?x=1`, {
    headers: token,
    redirect: 'manual',
  });
  expect(
    www.status === 308 && www.headers.get('location') === `${site}/convert?x=1`,
    `www answered HTTP ${String(www.status)}, not a redirect to the site`,
  );
  return `private (Access login without a token); through Access: version ${version ?? '?'}, ready, security headers, www redirects`;
}

// ── Running them ─────────────────────────────────────────────────────────────

/** An error a check didn't expect, named without its message (which may carry a URL or a value). */
function unexpected(error: unknown): string {
  const own = error as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code =
    typeof own?.code === 'string'
      ? ` ${own.code}`
      : typeof own?.cause?.code === 'string'
        ? ` ${own.cause.code}`
        : '';
  return `${error instanceof Error ? error.name : 'Error'}${code} (details withheld)`;
}

/**
 * The shape of a secret, never its content: its length and what is off about
 * it. Secrets pasted into GitHub often carry a space, quotes, a newline or a
 * "Bearer " prefix; values are trimmed before use, and the rest is reported.
 */
export function shapeOf(value: string): string {
  const notes: string[] = [`${String(value.length)} characters`];
  if (/^["']|["']$/.test(value)) notes.push('quoted');
  if (/\s/.test(value)) notes.push('has spaces or line breaks inside');
  if (/^bearer\s/i.test(value)) notes.push('starts with "Bearer "');
  if (/^https?:\/\//.test(value)) notes.push('is a URL');
  // Which kinds of characters, never which characters.
  const kinds = [
    [/[a-z]/, 'lowercase'],
    [/[A-Z]/, 'uppercase'],
    [/[0-9]/, 'digits'],
    [/_/, '_'],
    [/-/, '-'],
    [/\./, '.'],
    [/[^A-Za-z0-9_.\-\s"']/, 'other symbols'],
  ] as const;
  notes.push(
    `made of ${
      kinds
        .filter(([re]) => re.test(value))
        .map(([, name]) => name)
        .join(', ') || 'nothing'
    }`,
  );
  return notes.join(', ');
}

/** Secrets as checked: surrounding whitespace removed, as GitHub's form keeps it. */
export function cleaned(env: Env): Env {
  return Object.fromEntries(Object.entries(env).map(([name, value]) => [name, value?.trim()]));
}

interface Check {
  name: string;
  needs: string[];
  run: (env: Env, site: string) => Promise<string>;
}

export const CHECKS: Check[] = [
  {
    name: 'r2',
    needs: ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
    run: checkR2,
  },
  { name: 'cloudflare-r2', needs: ['CF_READ_TOKEN', 'CF_ACCOUNT_ID'], run: checkCloudflareR2 },
  { name: 'dns', needs: ['CF_READ_TOKEN', 'SITE_URL'], run: checkDns },
  { name: 'access', needs: ['CF_READ_TOKEN', 'CF_ACCOUNT_ID', 'SITE_URL'], run: checkAccess },
  {
    name: 'site',
    needs: ['SITE_URL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'],
    run: checkSite,
  },
];

export async function runChecks(raw: Env): Promise<Outcome[]> {
  const env = cleaned(raw);
  // An unset repository variable arrives as an empty string.
  const site = new URL(env.SITE_URL ? env.SITE_URL : 'http://localhost:3000').origin;
  // A push names its checks in the commit message: a line `ops-checks: r2,dns`.
  const fromMessage = /^ops-checks:\s*(.+)$/m.exec(env.OPS_COMMIT_MESSAGE ?? '')?.[1];
  const wanted = (env.OPS_CHECKS || fromMessage || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = wanted.filter((name) => !CHECKS.some((check) => check.name === name));
  const outcomes: Outcome[] = unknown.map((name) => ({
    name,
    ok: false,
    detail: 'no such check',
  }));
  for (const check of CHECKS) {
    if (wanted.length > 0 && !wanted.includes(check.name)) continue;
    const missing = check.needs.filter((name) => !env[name]);
    if (missing.length > 0) {
      outcomes.push({
        name: check.name,
        ok: wanted.includes(check.name) ? false : null,
        detail: `not set: ${missing.join(', ')}`,
      });
      continue;
    }
    try {
      outcomes.push({ name: check.name, ok: true, detail: await check.run(env, site) });
    } catch (error) {
      outcomes.push({
        name: check.name,
        ok: false,
        detail: error instanceof Failed ? error.message : unexpected(error),
      });
    }
  }
  return outcomes;
}

async function main(): Promise<number> {
  const outcomes = await runChecks(process.env);
  for (const { name, ok, detail } of outcomes) {
    const label = ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL';
    console.log(`${label}  ${name}: ${detail}`);
    if (ok === false && process.env.GITHUB_ACTIONS) console.log(`::error::${name}: ${detail}`);
  }
  return outcomes.some((outcome) => outcome.ok === false) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
