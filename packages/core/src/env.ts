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

/** true/false, 1/0, yes/no, on/off (any case). */
const flag = (fallback: boolean) =>
  z
    .stringbool({ error: 'must be true or false' })
    .default(fallback)
    .describe(`boolean, default ${String(fallback)}`);

/** A root-relative path (`/models`) or an absolute http(s) URL. */
const baseUrl = z
  .string()
  .trim()
  .refine(
    (value) => (value.startsWith('/') && !value.startsWith('//')) || /^https?:\/\/[^/]/.test(value),
    'must be a root-relative path like /models or an http(s) URL',
  );

const webShape = {
  ...sharedShape,
  /** Origin for canonical, sitemap, OG, JSON-LD and robots.txt URLs. */
  SITE_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  /** Where model and WASM files load from: a local path until Go public, then the R2 `models.` host. */
  MODELS_BASE_URL: baseUrl.default('/models'),
  /**
   * Cookieless analytics (docs/09 → Measuring): the base URL of a self-hosted,
   * Umami-compatible collector and the site's id there. Both unset = off.
   */
  ANALYTICS_URL: z.url({ protocol: /^https?$/ }).optional(),
  ANALYTICS_WEBSITE_ID: z.uuid().optional(),
};

type WebShared = Shared & {
  SITE_URL: string;
  ANALYTICS_URL?: string | undefined;
  ANALYTICS_WEBSITE_ID?: string | undefined;
};

function checkWeb(env: WebShared, ctx: z.RefinementCtx): void {
  checkShared(env, ctx);
  if (Boolean(env.ANALYTICS_URL) !== Boolean(env.ANALYTICS_WEBSITE_ID)) {
    ctx.addIssue({
      code: 'custom',
      path: [env.ANALYTICS_URL ? 'ANALYTICS_WEBSITE_ID' : 'ANALYTICS_URL'],
      message: 'set both ANALYTICS_URL and ANALYTICS_WEBSITE_ID, or neither',
    });
  }
  if (DEPLOYED.includes(env.APP_ENV) && LOCAL_HOSTNAMES.has(new URL(env.SITE_URL).hostname)) {
    ctx.addIssue({
      code: 'custom',
      path: ['SITE_URL'],
      message: `must be the public URL when APP_ENV=${env.APP_ENV}`,
    });
  }
}

/**
 * Env for apps/web. No domain or host is hard-coded anywhere (CI enforces it):
 * every absolute URL comes from SITE_URL, every model/WASM file from
 * MODELS_BASE_URL. next.config.ts inlines both into server and client code.
 */
export const webEnvSchema = z.object(webShape).superRefine(checkWeb);
export type WebEnv = z.output<typeof webEnvSchema>;

/** Object storage (S3-compatible: R2 in production, Versity S3 Gateway locally). */
const storageShape = {
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  S3_REGION: z.string().trim().min(1).default('auto'),
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid S3 bucket name'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
};

/**
 * Env for the web server build (`ETB_TARGET=server`: the local stack from M3,
 * production from M5): the static site's variables plus the database,
 * accounts and sign-in email (docs/11 → Auth). Secrets come from the host's
 * secret store; compose.yaml sets local-only placeholders.
 */
export const webServerEnvSchema = z
  .object({
    ...webShape,
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    ...storageShape,
    /**
     * Where browsers reach storage, for presigned upload and download URLs;
     * defaults to S3_ENDPOINT. Differs only when the server reaches storage by
     * another name (compose: `storage:7070` inside, `localhost:7070` outside).
     */
    S3_PUBLIC_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    /** Signs sessions and encrypts TOTP secrets: 32+ random characters, one per environment. */
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Google sign-in: both set, or neither (then the button is hidden). */
    GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
    /** Sign-in email over SMTP: smtp://host:port or smtps://user:pass@host:465. */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    /** From address; defaults to no-reply@ the SITE_URL host. */
    MAIL_FROM: z.string().trim().min(3).optional(),
    /** local and test only: write each email as JSON into this folder instead of sending it. */
    MAIL_OUTBOX_DIR: z.string().trim().min(1).optional(),
    /** Optional: only these client IPs (comma-separated) reach /admin; anyone else gets a 404. */
    ADMIN_IP_ALLOWLIST: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F:.]+(\s*,\s*[0-9a-fA-F:.]+)*$/, 'comma-separated IP addresses')
      .optional(),
    /**
     * Payments' kill switch (docs/05 → Payments): nothing is sold unless this
     * is true, an admin switched the provider on and its keys are set.
     */
    PAYMENTS_ENABLED: flag(false),
    /**
     * Click's Merchant API base URL, ending in `/`: where Click's fiscal
     * receipts go (`payment/ofd_data/submit_items`). No default, since no host
     * is written in the code; the value is in docs/runbooks/turn-on-payments.md.
     * Click's keys are read by name like every provider's (`requiredEnv`).
     */
    CLICK_MERCHANT_API_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** test only: a stand-in for one provider (paddle, click or payme) that pays without money. */
    PAYMENTS_STUB: z.enum(['paddle', 'click', 'payme']).optional(),
    /**
     * The welcome grant after email verification (docs/05 → Free allowance).
     * On unless set to false: a fast stop if the grant is being farmed. The
     * server build's end-to-end tests turn it off so their accounts start at 0.
     */
    WELCOME_GRANT_ENABLED: flag(true),
    /**
     * Keys `welcome_grant_claims.email_hmac`: long-lived, 32+ characters. Unset:
     * derived from BETTER_AUTH_SECRET, so rotating that one would let each
     * email claim the grant again; set this before rotating it.
     */
    WELCOME_GRANT_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  })
  .superRefine((env, ctx) => {
    checkWeb(env, ctx);
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
        message: 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
      });
    }
    if (env.MAIL_OUTBOX_DIR && env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_OUTBOX_DIR'],
        message: 'is for local and test only; set SMTP_URL',
      });
    }
    if (
      env.CLICK_MERCHANT_API_URL &&
      DEPLOYED.includes(env.APP_ENV) &&
      !env.CLICK_MERCHANT_API_URL.startsWith('https:')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLICK_MERCHANT_API_URL'],
        message: `must be an https URL when APP_ENV=${env.APP_ENV}`,
      });
    }
    if (env.PAYMENTS_STUB && env.APP_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENTS_STUB'],
        message: 'is for the end-to-end tests only (APP_ENV=test)',
      });
    }
    if (!env.SMTP_URL && !env.MAIL_OUTBOX_DIR) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message:
          'required: sign-in links go out by email (or MAIL_OUTBOX_DIR, local and test only)',
      });
    }
  });
export type WebServerEnv = z.output<typeof webServerEnvSchema>;

/**
 * Env for server processes that touch the database and object storage.
 * The worker mirrors it; the web server build has its own schema above.
 */
export const serverEnvSchema = z
  .object({
    ...sharedShape,
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    ...storageShape,
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
