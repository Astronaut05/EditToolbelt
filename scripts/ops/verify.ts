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
  expect(
    new URL(s3.endpoint).hostname.split('.').includes('eu'),
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
  const exposed = (put.headers.get('access-control-expose-headers') ?? '').toLowerCase();
  expect(exposed.includes('etag'), 'CORS: ETag is not exposed to the site (ExposeHeaders)');

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

async function checkCloudflareR2(env: Env, site: string): Promise<string> {
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
  expect(problems.length === 0, problems.join('; '));
  return 'EU jurisdiction; every object expires and every multipart upload aborts within 1 day; CORS rule for the site';
}

// ── Running them ─────────────────────────────────────────────────────────────

/** An error a check didn't expect, named without its message (which may carry a URL or a value). */
function unexpected(error: unknown): string {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  const code = typeof cause?.code === 'string' ? ` ${cause.code}` : '';
  return `${error instanceof Error ? error.name : 'Error'}${code} (details withheld)`;
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
];

export async function runChecks(env: Env): Promise<Outcome[]> {
  const site = new URL(env.SITE_URL ?? 'http://localhost:3000').origin;
  const wanted = (env.OPS_CHECKS ?? '')
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
