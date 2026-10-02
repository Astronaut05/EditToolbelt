/**
 * `pnpm models`: puts the AI models and ONNX Runtime Web where MODELS_BASE_URL
 * serves them locally (apps/web/public/models, git-ignored), the way the R2
 * models host will after Go public (docs/01 → Hosting, docs/10 → models).
 *
 * - ONNX Runtime's module and WASM files are copied from node_modules, and
 *   must be the version packages/engines expects.
 * - Models are downloaded from the sources in models.json and checked against
 *   the SHA-256 pinned in packages/engines; a model not pinned yet prints its
 *   hash to pin.
 * - Files already in place (and matching) are left alone, so it's quick to rerun.
 *
 * Runs before `build` and `dev`. A failed download warns and the build goes
 * on (Remove Background or Find faces then says the model is missing); `--strict` (CI)
 * fails on it instead. The quality model is optional either way: without it
 * the tool uses Light mode. With an absolute MODELS_BASE_URL there is nothing
 * to do here; the files are uploaded to that host instead.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { YUNET } from '../../../packages/engines/src/image/faces/yunet.ts';
import {
  ORT_FILES,
  ORT_VERSION,
  SEGMENT_MODELS,
} from '../../../packages/engines/src/image/rmbg/models.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'apps/web/public/models');
const strict = process.argv.includes('--strict');

interface ModelFile {
  id: string;
  /** Path under MODELS_BASE_URL, and the key of its source in models.json. */
  file: string;
  sha256: string | null;
}

/** P07's two models and P12's face finder. */
const MODELS: ModelFile[] = [...Object.values(SEGMENT_MODELS), { id: 'yunet', ...YUNET }];
const OPTIONAL = new Set(['birefnet-lite']);

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function copyRuntime(): string[] {
  const entry = createRequire(join(ROOT, 'packages/engines/package.json')).resolve(
    'onnxruntime-web',
  );
  const dist = dirname(entry);
  const { version } = JSON.parse(readFileSync(join(dist, '../package.json'), 'utf8')) as {
    version: string;
  };
  if (version !== ORT_VERSION) {
    return [
      `onnxruntime-web is ${version}, but ORT_VERSION in packages/engines/src/image/rmbg/models.ts is ${ORT_VERSION}. Update ORT_VERSION.`,
    ];
  }
  const dir = join(OUT, 'ort', ORT_VERSION);
  mkdirSync(dir, { recursive: true });
  let copied = 0;
  for (const file of ORT_FILES) {
    const from = join(dist, file);
    const to = join(dir, file);
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
    copied += 1;
  }
  console.log(
    `ONNX Runtime ${ORT_VERSION}: ${copied ? `${String(copied)} files copied` : 'up to date'}`,
  );
  return [];
}

async function fetchModel(model: ModelFile, source: string): Promise<string | null> {
  const to = join(OUT, model.file);
  if (existsSync(to)) {
    const hash = sha256(readFileSync(to));
    if (!model.sha256 || hash === model.sha256) {
      console.log(
        `${model.file}: up to date${model.sha256 ? '' : ` (sha256 ${hash}, not pinned yet)`}`,
      );
      return null;
    }
    rmSync(to);
  }
  let bytes: Uint8Array;
  try {
    const response = await fetch(source);
    if (!response.ok) return `${model.file}: download failed (HTTP ${String(response.status)})`;
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return `${model.file}: download failed (${error instanceof Error ? error.message : String(error)})`;
  }
  const hash = sha256(bytes);
  if (model.sha256 && hash !== model.sha256) {
    return `${model.file}: checksum mismatch, expected ${model.sha256}, got ${hash}. Not saved.`;
  }
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, bytes);
  console.log(
    `${model.file}: downloaded, ${(bytes.byteLength / 1e6).toFixed(1)} MB${model.sha256 ? ', checksum ok' : `, sha256 ${hash} (not pinned yet: pin it in models.ts)`}`,
  );
  return null;
}

async function main(): Promise<number> {
  const base = process.env.MODELS_BASE_URL ?? '/models';
  if (!base.startsWith('/')) {
    console.log(`MODELS_BASE_URL is ${base}: models are served from there, nothing to fetch.`);
    return 0;
  }
  const sources = JSON.parse(readFileSync(join(ROOT, 'models.json'), 'utf8')) as Record<
    string,
    string
  >;
  const problems = copyRuntime();
  const warnings: string[] = [];
  for (const model of MODELS) {
    const source = sources[model.file];
    if (!source) {
      problems.push(`${model.file}: no source in models.json`);
      continue;
    }
    const problem = await fetchModel(model, source);
    if (problem) (OPTIONAL.has(model.id) ? warnings : problems).push(problem);
  }
  for (const warning of warnings)
    console.warn(`Warning: ${warning} (optional: Light mode still works)`);
  for (const problem of problems) console.error(`${strict ? 'Error' : 'Warning'}: ${problem}`);
  if (problems.length && !strict) {
    console.warn('Remove Background and Find faces won’t work until `pnpm models` succeeds.');
  }
  return strict && problems.length ? 1 : 0;
}

process.exitCode = await main();
