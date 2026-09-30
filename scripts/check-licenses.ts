/**
 * License register check (docs/13-licenses.md). Run: `pnpm licenses:check`.
 *
 * Reads licenses.json, the machine-readable copy of the register, and fails when:
 * - a dependency in any workspace package.json isn't registered, is still marked
 *   "verify", or is banned;
 * - an installed package's license differs from the register (a new version
 *   changed its license);
 * - any installed npm package, direct or transitive, has a license that is
 *   banned, unknown, or copyleft without a register entry;
 * - a GitHub Action or Docker image in use isn't registered;
 * - a register entry says something the policy forbids, or has no row in
 *   docs/13-licenses.md.
 * The worker's Python dependencies are checked by apps/worker/scripts/check_licenses.py.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const Ecosystem = z.enum([
  'npm',
  'pypi',
  'github-action',
  'docker',
  'model',
  'font',
  'service',
  'system',
]);

const Register = z.strictObject({
  $comment: z.string(),
  policy: z.strictObject({
    $comment: z.string(),
    allowed: z.array(z.string()),
    copyleftServerOnly: z.array(z.string()),
    banned: z.array(z.string()),
  }),
  entries: z.array(
    z.strictObject({
      label: z.string().min(1),
      section: z.string().min(1),
      ecosystem: Ecosystem,
      packages: z.array(z.string()),
      use: z.string().min(1),
      license: z.string().min(1),
      weightsLicense: z.string().optional(),
      scope: z.enum(['browser', 'server', 'dev', 'local']),
      status: z.enum(['approved', 'conditional', 'verify']),
      condition: z.string().optional(),
      version: z.string().optional(),
      source: z.url().optional(),
      /** Where the source of an LGPL part we ship is offered (shown on /licenses). */
      sourceOffer: z.url().optional(),
      checked: z.iso.date().optional(),
    }),
  ),
  banned: z.array(
    z.strictObject({
      label: z.string().min(1),
      ecosystem: Ecosystem,
      packages: z.array(z.string()),
      reason: z.string().min(1),
    }),
  ),
  reviewedTransitive: z.array(
    z.strictObject({
      ecosystem: Ecosystem,
      package: z.string().min(1),
      license: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
});
type Register = z.infer<typeof Register>;
type Entry = Register['entries'][number];

// ---------------------------------------------------------------------------
// SPDX helpers
// ---------------------------------------------------------------------------

/** LGPL-3.0-only / LGPL-3.0-or-later / LGPL-3.0+ → lgpl-3.0 */
function family(id: string): string {
  return id
    .trim()
    .replace(/(-only|-or-later|\+)$/, '')
    .toLowerCase();
}

function licenseIds(expression: string): string[] {
  return expression
    .split(/[\s()]+/)
    .filter((token) => token !== '' && !['AND', 'OR', 'WITH'].includes(token.toUpperCase()));
}

function splitTopLevel(expression: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  const upper = expression.toUpperCase();
  for (let i = 0; i < expression.length;) {
    const char = expression.charAt(i);
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth === 0 && upper.startsWith(operator, i)) {
      parts.push(current);
      current = '';
      i += operator.length;
      continue;
    }
    current += char;
    i++;
  }
  parts.push(current);
  return parts;
}

function isWrapped(expression: string): boolean {
  if (!expression.startsWith('(') || !expression.endsWith(')')) return false;
  let depth = 0;
  for (const char of expression.slice(1, -1)) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** True if the expression can be met with only `allowed` licenses (OR: any side, AND: every side). */
function isSatisfiable(expression: string, allowed: ReadonlySet<string>): boolean {
  const text = expression.trim();
  if (isWrapped(text)) return isSatisfiable(text.slice(1, -1), allowed);
  const anyOf = splitTopLevel(text, ' OR ');
  if (anyOf.length > 1) return anyOf.some((part) => isSatisfiable(part, allowed));
  const allOf = splitTopLevel(text, ' AND ');
  if (allOf.length > 1) return allOf.every((part) => isSatisfiable(part, allowed));
  return allowed.has(family(text.split(' WITH ')[0] ?? text));
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface Manifest {
  name?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Workspace package dirs from pnpm-workspace.yaml (supports `dir` and `dir/*` globs). */
function workspaceDirs(): string[] {
  const yaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const block = /^packages:\n((?:\s+-\s+.+\n?)+)/m.exec(yaml)?.[1] ?? '';
  const dirs = [ROOT];
  for (const match of block.matchAll(/-\s+['"]?([^'"\n]+)['"]?/g)) {
    const pattern = (match[1] ?? '').trim();
    if (pattern.endsWith('/*')) {
      const parent = join(ROOT, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const child of readdirSync(parent, { withFileTypes: true })) {
        if (child.isDirectory() && existsSync(join(parent, child.name, 'package.json'))) {
          dirs.push(join(parent, child.name));
        }
      }
    } else if (existsSync(join(ROOT, pattern, 'package.json'))) {
      dirs.push(join(ROOT, pattern));
    }
  }
  return dirs;
}

interface PnpmLicensePackage {
  name: string;
  versions: string[];
  license: string;
}

function installedNpmLicenses(): PnpmLicensePackage[] {
  const out = execFileSync('pnpm', ['licenses', 'list', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicense = JSON.parse(out) as Record<string, PnpmLicensePackage[]>;
  return Object.values(byLicense).flat();
}

function workflowActions(): Map<string, string> {
  const found = new Map<string, string>();
  const dir = join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) return found;
  for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const match of text.matchAll(/^\s*(?:-\s+)?uses:\s*['"]?([^@\s'"]+)@/gm)) {
      const action = (match[1] ?? '').split('/').slice(0, 2).join('/');
      if (!action.startsWith('./')) found.set(action, `.github/workflows/${file}`);
    }
  }
  return found;
}

/** `repo/name:tag@sha256:…` → `repo/name` (docker.io/library/ prefix dropped). */
function imageName(reference: string): string {
  const withoutDigest = reference.split('@')[0] ?? reference;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.indexOf(':', lastSlash + 1);
  const name = colon === -1 ? withoutDigest : withoutDigest.slice(0, colon);
  return name.replace(/^docker\.io\//, '').replace(/^library\//, '');
}

function dockerImages(): Map<string, string> {
  const found = new Map<string, string>();
  const compose = join(ROOT, 'compose.yaml');
  if (existsSync(compose)) {
    for (const match of readFileSync(compose, 'utf8').matchAll(/^\s*image:\s*['"]?([^\s'"]+)/gm)) {
      found.set(imageName(match[1] ?? ''), 'compose.yaml');
    }
  }
  const dockerfiles: string[] = [];
  const walk = (dir: string): void => {
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.next', '.venv', '.turbo'].includes(child.name)) continue;
      const path = join(dir, child.name);
      if (child.isDirectory()) walk(path);
      else if (/^Dockerfile(\..+)?$/.test(child.name)) dockerfiles.push(path);
    }
  };
  walk(ROOT);
  for (const path of dockerfiles) {
    const stages = new Set<string>();
    for (const match of readFileSync(path, 'utf8').matchAll(
      /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/gim,
    )) {
      const reference = match[1] ?? '';
      if (!stages.has(reference.toLowerCase()))
        found.set(imageName(reference), relative(ROOT, path));
      if (match[2]) stages.add(match[2].toLowerCase());
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function main(): number {
  const parsed = Register.safeParse(readJson(join(ROOT, 'licenses.json')));
  if (!parsed.success) {
    console.error('licenses.json is malformed:');
    for (const issue of parsed.error.issues)
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    return 1;
  }
  const register = parsed.data;
  const allowed = new Set(register.policy.allowed.map(family));
  const copyleft = new Set(register.policy.copyleftServerOnly.map(family));
  const serverAllowed = new Set([...allowed, ...copyleft]);
  const bannedLicenses = new Set(register.policy.banned.map(family));
  const errors: string[] = [];

  const index = (ecosystem: string): Map<string, Entry> => {
    const map = new Map<string, Entry>();
    for (const entry of register.entries) {
      if (entry.ecosystem === ecosystem) for (const name of entry.packages) map.set(name, entry);
    }
    return map;
  };
  const bannedIndex = (ecosystem: string): Map<string, string> =>
    new Map(
      register.banned
        .filter((item) => item.ecosystem === ecosystem)
        .flatMap((item) => item.packages.map((name) => [name, item.reason] as const)),
    );

  // 1. The register itself follows the policy and matches the human-readable doc.
  const doc = readFileSync(join(ROOT, 'docs', '13-licenses.md'), 'utf8');
  for (const entry of [...register.entries, ...register.banned]) {
    if (!doc.includes(entry.label)) {
      errors.push(`licenses.json entry "${entry.label}" has no row in docs/13-licenses.md.`);
    }
  }
  for (const entry of register.entries) {
    if (entry.status === 'verify') continue;
    const ids = licenseIds(entry.license).filter((id) => !id.startsWith('LicenseRef-'));
    if (
      ids.some((id) => bannedLicenses.has(family(id))) &&
      !isSatisfiable(entry.license, allowed)
    ) {
      errors.push(
        `"${entry.label}" is ${entry.status} but its license ${entry.license} is banned.`,
      );
    } else if (
      entry.status === 'approved' &&
      !isSatisfiable(entry.license, entry.scope === 'browser' ? allowed : serverAllowed)
    ) {
      errors.push(
        `"${entry.label}" (${entry.scope}) is approved under ${entry.license}; ` +
          'that needs status "conditional" with a condition, or a different scope.',
      );
    }
    if (entry.status === 'conditional' && !entry.condition) {
      errors.push(`"${entry.label}" is conditional but states no condition.`);
    }
  }

  // 2. Direct npm dependencies of every workspace package.
  const npm = index('npm');
  const npmBanned = bannedIndex('npm');
  for (const dir of workspaceDirs()) {
    const manifest = readJson(join(dir, 'package.json')) as Manifest;
    const where = relative(ROOT, join(dir, 'package.json')) || 'package.json';
    const deps = {
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
      ...manifest.devDependencies,
      ...manifest.dependencies,
    };
    for (const [name, range] of Object.entries(deps)) {
      if (range.startsWith('workspace:')) continue;
      const entry = npm.get(name);
      const bannedReason = npmBanned.get(name);
      if (bannedReason) {
        errors.push(`${name} (${where}) is banned: ${bannedReason}`);
        continue;
      }
      if (!entry) {
        errors.push(
          `${name} (${where}) is not in licenses.json. Check its license, add it to ` +
            'docs/13-licenses.md and licenses.json, then install.',
        );
        continue;
      }
      if (entry.status === 'verify') {
        errors.push(
          `${name} (${where}) is marked "verify": confirm its license, then set a status.`,
        );
      }
      const installed = join(dir, 'node_modules', name, 'package.json');
      if (!existsSync(installed)) continue; // optional or not installed on this platform
      const license = (readJson(installed) as Manifest).license ?? 'UNKNOWN';
      const registered = new Set(licenseIds(entry.license).map(family));
      const actual = new Set(licenseIds(license).map(family));
      if (registered.size !== actual.size || [...actual].some((id) => !registered.has(id))) {
        errors.push(
          `${name}: installed license "${license}" doesn't match the register ("${entry.license}"). ` +
            'Review it and update the register.',
        );
      }
    }
  }

  // 3. Every installed npm package, including transitive ones.
  const reviewed = new Set(
    register.reviewedTransitive
      .filter((item) => item.ecosystem === 'npm')
      .map((item) => item.package),
  );
  for (const pkg of installedNpmLicenses()) {
    const label = `${pkg.name} ${pkg.versions.join(', ')}`;
    const bannedReason = npmBanned.get(pkg.name);
    if (bannedReason) {
      errors.push(`${label} is installed but banned: ${bannedReason}`);
      continue;
    }
    if (npm.has(pkg.name) || reviewed.has(pkg.name)) continue;
    const license = pkg.license;
    if (!license || /^(unknown|unlicensed|see license)/i.test(license)) {
      errors.push(`${label}: no usable license field ("${license}"). Review it and register it.`);
    } else if (!isSatisfiable(license, allowed)) {
      const kind = licenseIds(license).some((id) => bannedLicenses.has(family(id)))
        ? 'banned'
        : isSatisfiable(license, serverAllowed)
          ? 'copyleft'
          : 'unrecognised';
      errors.push(
        `${label}: ${kind} license "${license}" needs a register entry or a ` +
          'reviewedTransitive note in licenses.json.',
      );
    }
  }

  // 4. GitHub Actions and Docker images.
  const actions = index('github-action');
  for (const [action, where] of workflowActions()) {
    if (!actions.has(action))
      errors.push(`GitHub Action ${action} (${where}) is not in licenses.json.`);
  }
  const images = index('docker');
  const imagesBanned = bannedIndex('docker');
  for (const [image, where] of dockerImages()) {
    const bannedReason = imagesBanned.get(image);
    if (bannedReason) errors.push(`Docker image ${image} (${where}) is banned: ${bannedReason}`);
    else if (!images.has(image))
      errors.push(`Docker image ${image} (${where}) is not in licenses.json.`);
    else if (images.get(image)?.status === 'verify') {
      errors.push(
        `Docker image ${image} is marked "verify": confirm its license, then set a status.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error('License check failed:');
    for (const error of new Set(errors)) console.error(`  - ${error}`);
    return 1;
  }
  console.log('License check passed (npm, GitHub Actions, Docker images).');
  return 0;
}

process.exitCode = main();
