import { describe, expect, it } from 'vitest';

import { formatEnvErrors, parseEnv, serverEnvSchema, webEnvSchema } from './env';

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
