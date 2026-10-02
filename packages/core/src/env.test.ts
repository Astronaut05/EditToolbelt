import { describe, expect, it } from 'vitest';

import {
  formatEnvErrors,
  parseEnv,
  serverEnvSchema,
  webEnvSchema,
  webServerEnvSchema,
} from './env';

const validServer = {
  DATABASE_URL: 'postgresql://etb:secret-pass@localhost:5432/etb',
  S3_ENDPOINT: 'http://localhost:7070',
  S3_BUCKET: 'etb-local',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'super-secret',
};

describe('webEnvSchema', () => {
  it('has safe local defaults', () => {
    const result = parseEnv(webEnvSchema, {});
    expect(result).toEqual({
      ok: true,
      env: {
        APP_ENV: 'local',
        APP_VERSION: 'dev',
        LOG_LEVEL: 'info',
        SITE_URL: 'http://localhost:3000',
        MODELS_BASE_URL: '/models',
      },
    });
  });

  it('takes analytics as a pair or not at all', () => {
    const id = '0b6f6b7a-6c8e-4f39-9d0e-3f6b5a1c2d4e';
    expect(
      parseEnv(webEnvSchema, {
        ANALYTICS_URL: 'https://stats.example.com',
        ANALYTICS_WEBSITE_ID: id,
      }).ok,
    ).toBe(true);
    expect(parseEnv(webEnvSchema, { ANALYTICS_URL: 'https://stats.example.com' })).toEqual({
      ok: false,
      errors: ['ANALYTICS_WEBSITE_ID: set both ANALYTICS_URL and ANALYTICS_WEBSITE_ID, or neither'],
    });
    expect(parseEnv(webEnvSchema, { ANALYTICS_WEBSITE_ID: 'not-a-uuid' }).ok).toBe(false);
  });

  it('treats empty strings as unset', () => {
    const result = parseEnv(webEnvSchema, { LOG_LEVEL: '' });
    expect(result.ok && result.env.LOG_LEVEL).toBe('info');
  });

  it('requires a public site URL outside local', () => {
    const result = parseEnv(webEnvSchema, { APP_ENV: 'production' });
    expect(result).toEqual({
      ok: false,
      errors: ['SITE_URL: must be the public URL when APP_ENV=production'],
    });
  });

  it('refuses debug logging in production', () => {
    const result = parseEnv(webEnvSchema, {
      APP_ENV: 'production',
      LOG_LEVEL: 'debug',
      SITE_URL: 'https://example.com',
    });
    expect(result).toEqual({
      ok: false,
      errors: ['LOG_LEVEL: debug logging is not allowed in production'],
    });
  });

  it('treats loopback addresses as local too', () => {
    const result = parseEnv(webEnvSchema, {
      APP_ENV: 'staging',
      SITE_URL: 'http://127.0.0.1:4173',
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    '/models',
    '/assets/models/',
    'http://localhost:4173/models',
    'https://models.example.com',
  ])('accepts %s as MODELS_BASE_URL', (value) => {
    expect(parseEnv(webEnvSchema, { MODELS_BASE_URL: value }).ok).toBe(true);
  });

  it.each(['models', '//cdn.example.com/models', 'ftp://example.com/models', 'https://'])(
    'rejects %s as MODELS_BASE_URL',
    (value) => {
      const result = parseEnv(webEnvSchema, { MODELS_BASE_URL: value });
      expect(result).toEqual({
        ok: false,
        errors: ['MODELS_BASE_URL: must be a root-relative path like /models or an http(s) URL'],
      });
    },
  );

  it('rejects unknown enum values', () => {
    const result = parseEnv(webEnvSchema, { APP_ENV: 'prod' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^APP_ENV: /);
  });
});

describe('serverEnvSchema', () => {
  it('accepts a complete config', () => {
    const result = parseEnv(serverEnvSchema, validServer);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.S3_REGION).toBe('auto');
  });

  it('names every missing variable', () => {
    const result = parseEnv(serverEnvSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        'DATABASE_URL: required but not set',
        'S3_ENDPOINT: required but not set',
        'S3_BUCKET: required but not set',
        'S3_ACCESS_KEY_ID: required but not set',
        'S3_SECRET_ACCESS_KEY: required but not set',
      ]);
    }
  });

  it('rejects a non-Postgres database URL', () => {
    const result = parseEnv(serverEnvSchema, { ...validServer, DATABASE_URL: 'mysql://x@y/z' });
    expect(result.ok).toBe(false);
  });

  it('never echoes values in error messages', () => {
    const result = parseEnv(serverEnvSchema, {
      ...validServer,
      DATABASE_URL: 'not a url with secret-pass inside',
      S3_BUCKET: 'Bad_Bucket_super-secret',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const text = formatEnvErrors('worker', result.errors);
      expect(text).toContain('DATABASE_URL');
      expect(text).toContain('S3_BUCKET');
      expect(text).not.toContain('secret');
    }
  });
});

describe('webServerEnvSchema', () => {
  const base = {
    DATABASE_URL: 'postgresql://etb:x@localhost:5432/etb',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    SMTP_URL: 'smtp://localhost:1025',
    S3_ENDPOINT: 'http://storage:7070',
    S3_BUCKET: 'etb-local',
    S3_ACCESS_KEY_ID: 'key-id',
    S3_SECRET_ACCESS_KEY: 'key-secret',
  };

  it('takes the database, the auth secret and a way to send email', () => {
    const result = parseEnv(webServerEnvSchema, base);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.SITE_URL).toBe('http://localhost:3000');
  });

  it('wants a long auth secret and both Google variables or neither', () => {
    expect(parseEnv(webServerEnvSchema, { ...base, BETTER_AUTH_SECRET: 'short' })).toEqual({
      ok: false,
      errors: ['BETTER_AUTH_SECRET: must be at least 32 characters'],
    });
    expect(parseEnv(webServerEnvSchema, { ...base, GOOGLE_CLIENT_ID: 'id' })).toEqual({
      ok: false,
      errors: [
        'GOOGLE_CLIENT_SECRET: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
      ],
    });
  });

  it('writes emails to a folder only on local and test runs', () => {
    const outbox = { ...base, SMTP_URL: undefined, MAIL_OUTBOX_DIR: '/tmp/outbox' };
    expect(parseEnv(webServerEnvSchema, { ...outbox, APP_ENV: 'test' }).ok).toBe(true);
    const staging = parseEnv(webServerEnvSchema, {
      ...outbox,
      APP_ENV: 'staging',
      SITE_URL: 'https://staging.example.com',
    });
    expect(staging.ok).toBe(false);
    if (!staging.ok) {
      expect(staging.errors).toContain('MAIL_OUTBOX_DIR: is for local and test only; set SMTP_URL');
    }
    expect(parseEnv(webServerEnvSchema, { ...base, SMTP_URL: undefined }).ok).toBe(false);
  });

  it('needs storage, and takes a public storage address for browsers', () => {
    const noStorage = parseEnv(webServerEnvSchema, { ...base, S3_ENDPOINT: undefined });
    expect(noStorage).toEqual({ ok: false, errors: ['S3_ENDPOINT: required but not set'] });
    const result = parseEnv(webServerEnvSchema, {
      ...base,
      S3_PUBLIC_ENDPOINT: 'http://localhost:7070',
    });
    expect(result.ok && result.env.S3_PUBLIC_ENDPOINT).toBe('http://localhost:7070');
    expect(result.ok && result.env.S3_REGION).toBe('auto');
  });

  it('keeps payments off unless PAYMENTS_ENABLED says true', () => {
    const off = parseEnv(webServerEnvSchema, base);
    expect(off.ok && off.env.PAYMENTS_ENABLED).toBe(false);
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      const on = parseEnv(webServerEnvSchema, { ...base, PAYMENTS_ENABLED: value });
      expect(on.ok && on.env.PAYMENTS_ENABLED).toBe(true);
    }
    for (const value of ['false', '0', 'no', 'off', '']) {
      const result = parseEnv(webServerEnvSchema, { ...base, PAYMENTS_ENABLED: value });
      expect(result.ok && result.env.PAYMENTS_ENABLED).toBe(false);
    }
    const typo = parseEnv(webServerEnvSchema, { ...base, PAYMENTS_ENABLED: 'ture' });
    expect(typo).toEqual({ ok: false, errors: ['PAYMENTS_ENABLED: must be true or false'] });
  });

  it('allows the payment stub in tests only', () => {
    const stub = { ...base, PAYMENTS_STUB: 'paddle' };
    expect(parseEnv(webServerEnvSchema, { ...stub, APP_ENV: 'test' }).ok).toBe(true);
    expect(parseEnv(webServerEnvSchema, stub)).toEqual({
      ok: false,
      errors: ['PAYMENTS_STUB: is for the end-to-end tests only (APP_ENV=test)'],
    });
  });

  it('gives the welcome grant unless told not to, with a long secret if one is set', () => {
    const result = parseEnv(webServerEnvSchema, base);
    expect(result.ok && result.env.WELCOME_GRANT_ENABLED).toBe(true);
    const off = parseEnv(webServerEnvSchema, { ...base, WELCOME_GRANT_ENABLED: 'false' });
    expect(off.ok && off.env.WELCOME_GRANT_ENABLED).toBe(false);
    expect(parseEnv(webServerEnvSchema, { ...base, WELCOME_GRANT_SECRET: 'short' })).toEqual({
      ok: false,
      errors: ['WELCOME_GRANT_SECRET: must be at least 32 characters'],
    });
  });
});
