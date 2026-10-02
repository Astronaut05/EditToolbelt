import { describe, expect, it } from 'vitest';

import { ENDPOINTS, openApiDocument, problemsOf, statusesOf } from './openapi';
import { Job, JobCreate, Me, Quote, Tool } from './schemas';

const doc = openApiDocument('https://example.test');

/** Every `$ref` anywhere in `value`. */
function refs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) refs(item, found);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key === '$ref' && typeof inner === 'string') found.push(inner);
      else refs(inner, found);
    }
  }
  return found;
}

describe('the OpenAPI document', () => {
  it('is 3.1 with the API under /api/v1', () => {
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(doc.servers).toEqual([{ url: 'https://example.test/api/v1' }]);
  });

  it('has every endpoint once, by path and method', () => {
    const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method} ${path}`),
    );
    expect(operations).toHaveLength(ENDPOINTS.length);
    expect(new Set(operations).size).toBe(ENDPOINTS.length);
    expect(new Set(ENDPOINTS.map((e) => e.operationId)).size).toBe(ENDPOINTS.length);
  });

  it('resolves every $ref to a component', () => {
    const schemas = doc.components.schemas;
    const all = refs(doc);
    expect(all.length).toBeGreaterThan(20);
    for (const ref of all) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(schemas).toHaveProperty(ref.split('/').pop() ?? '');
    }
  });

  it('names a scope for everything but the public endpoints', () => {
    for (const endpoint of ENDPOINTS) {
      const op = (doc.paths[endpoint.path] as Record<string, { security: unknown[] }>)[
        endpoint.method
      ];
      if (endpoint.auth === 'public') expect(op?.security).toEqual([]);
      else expect(op?.security).toEqual([{ apiKey: [endpoint.auth] }]);
    }
  });

  it('describes bodies as they are on the wire', () => {
    const job = doc.components.schemas.Job as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
    expect(job.required).toContain('status');
    expect(job.additionalProperties).toBe(false);
    // Left out of answers to a key without jobs:read (docs/06 → Auth).
    expect(job.required).not.toContain('result');
    expect(JSON.stringify(job.properties.result)).toContain('jobs:read');
    expect(JSON.stringify(doc.components.schemas.Quote)).toContain('QuoteProbing');
    expect(JSON.stringify(doc.components.schemas.QuoteProbing)).toContain('probing');
    expect(JSON.stringify(doc.components.schemas.QuoteReady)).toContain('account:read');
  });

  /** The responses an operation documents, by status. */
  const responses = (path: string, method: string) =>
    (doc.paths[path] as Record<string, { responses: Record<string, unknown> }>)[method]
      ?.responses ?? {};

  it('documents every status each endpoint answers, and only those', () => {
    for (const endpoint of ENDPOINTS) {
      const documented = Object.keys(responses(endpoint.path, endpoint.method));
      expect(documented, `${endpoint.method} ${endpoint.path}`).toEqual(
        statusesOf(endpoint).map(String),
      );
      expect(documented).not.toContain('default');
      // The general limits and a crash can happen anywhere.
      expect(problemsOf(endpoint)[429]).toContain('RATE_LIMITED');
      expect(problemsOf(endpoint)[500]).toEqual(['INTERNAL']);
    }
  });

  it('says what the routes really answer', () => {
    const cancelUpload = responses('/uploads/{id}', 'delete');
    expect(Object.keys(cancelUpload)).not.toContain('204');
    expect(JSON.stringify(cancelUpload['200'])).toContain('UploadCancelled');
    expect(JSON.stringify(responses('/jobs/quote', 'post')['202'])).toContain('QuoteProbing');
    expect(Object.keys(responses('/jobs', 'post'))).toEqual(
      expect.arrayContaining(['200', '201', '402', '422']),
    );
    expect(JSON.stringify(responses('/jobs', 'post')['422'])).toContain('IDEMPOTENCY_KEY_REUSED');
    const token = responses('/auth/device/token', 'post');
    expect(JSON.stringify(token['409'])).toContain('CONFLICT');
    expect(JSON.stringify(token['429'])).toContain('RATE_LIMITED');
    expect(JSON.stringify(responses('/auth/device', 'post')['429'])).toContain('RATE_LIMITED');
    // Cancelling a job never answers 409: an ended job is answered as it is.
    expect(Object.keys(responses('/jobs/{id}/cancel', 'post'))).not.toContain('409');
    expect(JSON.stringify(responses('/tools', 'get')['200'])).toContain('RateLimit-Remaining');
  });
});

describe('the schemas', () => {
  it('read real answers', () => {
    expect(
      Quote.safeParse({
        status: 'ready',
        tool_id: 'compress-video',
        upload_id: 'u',
        credits: 2,
        funding: 'daily',
        can_start: true,
        free_jobs_left: 3,
        balance: 0,
        balance_after: 0,
        estimate_seconds: null,
        options: { mode: 'size' },
      }).success,
    ).toBe(true);
    expect(
      Job.safeParse({
        id: 'j',
        tool_id: 'compress-video',
        status: 'succeeded',
        progress: 100,
        stage: null,
        position: null,
        funding: 'daily',
        credits_quoted: 2,
        credits_charged: 0,
        created_at: '2026-10-01T00:00:00.000Z',
        started_at: '2026-10-01T00:00:01.000Z',
        finished_at: '2026-10-01T00:00:09.000Z',
        error: null,
        result: { expired: true },
      }).success,
    ).toBe(true);
    expect(Tool.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('take what the quote said pays, and refuse anything else', () => {
    const job = { tool_id: 'compress-video', upload_id: 'u', options: {}, quote_credits: 4 };
    expect(JobCreate.safeParse(job).success).toBe(true);
    expect(JobCreate.safeParse({ ...job, quote_funding: 'daily' }).success).toBe(true);
    expect(JobCreate.safeParse({ ...job, quote_funding: 'free' }).success).toBe(false);
    const create = doc.components.schemas.JobCreate as { properties: Record<string, unknown> };
    expect(create.properties).toHaveProperty('quote_funding');
  });

  it('say where to buy credits, or null while none are on sale', () => {
    const me = {
      email: 'a@example.test',
      name: null,
      tier: 'free',
      credit_balance: -20,
      free_jobs_left: 3,
      max_concurrent_jobs: 2,
      buy_url: null,
    };
    expect(Me.safeParse(me).success).toBe(true);
    expect(Me.safeParse({ ...me, buy_url: 'https://example.test/credits/buy' }).success).toBe(true);
    expect(Me.safeParse({ ...me, buy_url: 'not a url' }).success).toBe(false);
  });
});
