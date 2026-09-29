/**
 * Environment validation (docs/01-architecture.md → Configuration).
 *
 * Every process validates its env with Zod at boot and exits with a clear
 * message when something is missing or malformed. Messages name the variable,
 * never its value. The worker mirrors these names in Python
 * (apps/worker/src/etb_worker/settings.py); .env.example lists them all.
 */
import { z } from 'zod';

export const APP_ENVS = ['local', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const DEPLOYED: readonly AppEnv[] = ['staging', 'production'];

const sharedShape = {
  APP_ENV: z.enum(APP_ENVS).default('local'),
  /** Commit SHA or release tag; set by CI. */
  APP_VERSION: z.string().trim().min(1).default('dev'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
};

type Shared = { APP_ENV: AppEnv; LOG_LEVEL: LogLevel };

function checkShared(env: Shared, ctx: z.RefinementCtx): void {
  // docs/07: `debug` is off in production.
  if (env.APP_ENV === 'production' && env.LOG_LEVEL === 'debug') {
    ctx.addIssue({
      code: 'custom',
      path: ['LOG_LEVEL'],
      message: 'debug logging is not allowed in production',
    });
  }
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/** A root-relative path (`/models`) or an absolute http(s) URL. */
const baseUrl = z
  .string()
  .trim()
  .refine(
    (value) => (value.startsWith('/') && !value.startsWith('//')) || /^https?:\/\/[^/]/.test(value),
    'must be a root-relative path like /models or an http(s) URL',
  );

/**
 * Env for apps/web. No domain or host is hard-coded anywhere (CI enforces it):
 * every absolute URL comes from SITE_URL, every model/WASM file from
 * MODELS_BASE_URL. next.config.ts inlines both into server and client code.
 */
export const webEnvSchema = z
  .object({
    ...sharedShape,
    /** Origin for canonical, sitemap, OG, JSON-LD and robots.txt URLs. */
    SITE_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
    /** Where model and WASM files load from: a local path until Go public, then the R2 `models.` host. */
    MODELS_BASE_URL: baseUrl.default('/models'),
  })
  .superRefine((env, ctx) => {
    checkShared(env, ctx);
    if (DEPLOYED.includes(env.APP_ENV) && LOCAL_HOSTNAMES.has(new URL(env.SITE_URL).hostname)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SITE_URL'],
        message: `must be the public URL when APP_ENV=${env.APP_ENV}`,
      });
    }
  });
export type WebEnv = z.output<typeof webEnvSchema>;

/**
 * Env for server processes that touch the database and object storage.
 * Web server routes use it from M3; the worker mirrors it today.
 */
export const serverEnvSchema = z
  .object({
    ...sharedShape,
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_REGION: z.string().trim().min(1).default('auto'),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid S3 bucket name'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .superRefine(checkShared);
export type ServerEnv = z.output<typeof serverEnvSchema>;

export type EnvSource = Record<string, string | undefined>;
export type EnvResult<T> = { ok: true; env: T } | { ok: false; errors: string[] };

/** Validates without side effects. Empty strings count as unset, so `FOO=` falls back to the default. */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: EnvSource,
): EnvResult<z.output<S>> {
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') present[key] = value;
  }

  const result = schema.safeParse(present);
  if (result.success) return { ok: true, env: result.data };

  const errors = result.error.issues.map((issue) => {
    const key = issue.path.map(String).join('.') || '(env)';
    return present[key] === undefined && issue.code !== 'custom'
      ? `${key}: required but not set`
      : `${key}: ${issue.message}`;
  });
  return { ok: false, errors };
}

export function formatEnvErrors(processName: string, errors: string[]): string {
  return [
    `Invalid environment for ${processName}:`,
    ...errors.map((error) => `  - ${error}`),
    'See .env.example for every variable and what it is for.',
    '',
  ].join('\n');
}

/** Validates `source` (default: process.env) or exits the process with a readable list of problems. */
export function loadEnv<S extends z.ZodType>(
  processName: string,
  schema: S,
  source: EnvSource = process.env,
): z.output<S> {
  const result = parseEnv(schema, source);
  if (result.ok) return result.env;
  process.stderr.write(formatEnvErrors(processName, result.errors));
  process.exit(1);
}
