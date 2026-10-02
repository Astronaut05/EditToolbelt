/**
 * Fails on hard-coded domains or hosts in code and config. Run: `pnpm hosts:check`.
 *
 * Every absolute URL comes from SITE_URL and every model/WASM file from
 * MODELS_BASE_URL (docs/01-architecture.md → Hosting), so going public, or
 * moving hosts later, is a config change. Allowed in code: loopback addresses,
 * reserved example names (example.com, *.test, *.example, *.invalid,
 * *.localhost; RFC 2606/6761), single-label names such as compose service
 * names (`postgres`, `storage`), `$schema` URLs for editors, and the few
 * third-party API endpoints in THIRD_PARTY_APIS: fixed by their provider, so
 * no move of ours ever changes them.
 *
 * Prose is not scanned (Markdown, docs/, tools/), nor lockfiles,
 * licenses.json and models.json, whose URLs point at packages, license texts
 * and third-party model downloads.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-hosts.ts';

const SKIP_PATH = [
  /\.md$/i,
  /^docs\//,
  /^tools\//,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)uv\.lock$/,
  /^licenses\.json$/,
  /^models\.json$/,
  /\.(png|jpe?g|webp|avif|gif|ico|mp4|mov|webm|wav|mp3|flac|onnx|wasm|woff2?|pdf|zip)$/i,
];

/** scheme://[userinfo@]host[:port] */
const URL_PATTERN =
  /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@"'`<>]*@)?(\[[0-9a-f:.]+\]|[^\s/:?#"'`<>)\]},]+)/gi;

/** Our own candidate domains and hosting-provider hosts, even without a scheme. */
const DENY_PATTERN =
  /\b(?:edittoolbelt\.(?:com|app|io)|[a-z0-9-]+\.(?:pages\.dev|workers\.dev|r2\.dev)|[a-z0-9.-]*r2\.cloudflarestorage\.com)\b/gi;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]']);
const RESERVED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost'];
const RESERVED_NAMES = /(^|\.)example\.(com|net|org)$/;
/** Each needs a reason. */
const THIRD_PARTY_APIS = new Set([
  // Telegram's Bot API: the worker's alerts (docs/07 → Alerts).
  'api.telegram.org',
  // Cloudflare's API: the ops checks read R2, DNS and Access settings (scripts/ops/verify.ts).
  'api.cloudflare.com',
  // Paddle Billing's API, live and sandbox: checkout transactions, customers and refunds
  // (apps/web/src/server/payments/providers/paddle.ts).
  'api.paddle.com',
  'sandbox-api.paddle.com',
  // Click's payment page, where checkout sends Uzbek buyers (providers/click.ts).
  'my.click.uz',
  // Payme's checkout, live and test, where checkout sends Uzbek buyers (providers/payme.ts).
  'checkout.paycom.uz',
  'checkout.test.paycom.uz',
]);

function isAllowedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/\.$/, '');
  if (host === '' || LOOPBACK.has(host)) return true;
  // Placeholders in templates and CI expressions, e.g. ${HOST} or ${{ vars.X }}.
  if (host.includes('${') || host.includes('{{')) return true;
  if (!host.includes('.') && !host.startsWith('[')) return true; // single-label, e.g. `storage`
  if (RESERVED_NAMES.test(host) || THIRD_PARTY_APIS.has(host)) return true;
  return RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export interface Finding {
  line: number;
  host: string;
}

export function findHosts(text: string): Finding[] {
  const findings: Finding[] = [];
  text.split('\n').forEach((line, index) => {
    if (/["']?\$schema["']?\s*:/.test(line)) return;
    // XML namespace URIs (xmlns="http://www.w3.org/2000/svg"), the JSON-LD
    // vocabulary (@context: https://schema.org) and the identifiers XMP blocks
    // start with inside JPEGs are names, never fetched.
    line = line
      .replace(/\bxmlns(?::\w+)?\s*=\s*(["'])[^"']*\1/g, '')
      .replace(/(["'])https:\/\/schema\.org\1/g, '')
      .replace(/http:\/\/ns\.adobe\.com\/(?:xap\/1\.0|xmp\/extension)\//g, '');
    for (const match of line.matchAll(URL_PATTERN)) {
      const host = match[1] ?? '';
      if (!isAllowedHost(host)) findings.push({ line: index + 1, host });
    }
    for (const match of line.matchAll(DENY_PATTERN)) {
      if (!findings.some((f) => f.line === index + 1 && f.host.includes(match[0]))) {
        findings.push({ line: index + 1, host: match[0] });
      }
    }
  });
  return findings;
}

function trackedFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  return [...new Set(out.split('\0').filter(Boolean))].filter(
    (path) => path !== SELF && !SKIP_PATH.some((pattern) => pattern.test(path)),
  );
}

function main(): number {
  const problems: string[] = [];
  for (const path of trackedFiles()) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, path), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    if (text.includes('\0')) continue; // binary
    for (const finding of findHosts(text))
      problems.push(`${path}:${String(finding.line)}  ${finding.host}`);
  }
  if (problems.length > 0) {
    console.error(
      'Hard-coded hosts found. Use SITE_URL / MODELS_BASE_URL (or an env var) instead:',
    );
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  console.log('Host check passed: no hard-coded domains or hosts.');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
