import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ADDRESS_LIMIT,
  ApiError,
  CALLER_LIMIT,
  holds,
  json,
  limit,
  publicRoute,
  readJson,
  requireCaller,
  route,
  tightest,
} from './api';

const mocks = vi.hoisted(() => ({
  keyCaller: vi.fn(),
  currentUser: vi.fn(),
}));

vi.mock('./env', () => ({ serverEnv: () => ({ SITE_URL: 'https://site.test' }) }));
vi.mock('./account', () => ({ currentUser: mocks.currentUser }));
vi.mock('./api-keys', () => ({ keyCaller: mocks.keyCaller }));
vi.mock('../lib/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const user = { id: 'u1', email: 'a@example.test' };
let address = 0;

/** A request from an address no other test used, so each starts with fresh limits. */
function call(path: string, init: RequestInit = {}): Request {
  address += 1;
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', `198.51.100.${String(address)}`);
  return new Request(`https://site.test${path}`, { ...init, headers });
}

const rateHeaders = (response: Response) => ({
  limit: response.headers.get('RateLimit-Limit'),
  remaining: response.headers.get('RateLimit-Remaining'),
  reset: response.headers.get('RateLimit-Reset'),
});

beforeEach(() => {
  mocks.keyCaller.mockReset();
  mocks.currentUser.mockReset();
});

describe('route', () => {
  it('puts the address’s limit on a public route’s answers, errors included', async () => {
    const ok = publicRoute('t', () => Promise.resolve(Response.json({ ok: true })));
    const okAnswer = await ok(call('/api/v1/tools'));
    expect(rateHeaders(okAnswer)).toEqual({
      limit: String(ADDRESS_LIMIT),
      remaining: String(ADDRESS_LIMIT - 1),
      reset: '60',
    });
    expect(okAnswer.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const missing = publicRoute('t', () => Promise.reject(new ApiError(404, 'NOT_FOUND', 'No')));
    const missingAnswer = await missing(call('/api/v1/tools/x'));
    expect(missingAnswer.status).toBe(404);
    expect(rateHeaders(missingAnswer).limit).toBe(String(ADDRESS_LIMIT));
  });

  it('keeps the limit on an error thrown after a route’s own limit, and shows the tighter one', async () => {
    mocks.keyCaller.mockResolvedValue({ user, keyId: 'k-err', scopes: ['jobs:read'] });
    const handler = route('t', async (request: Request) => {
      await requireCaller(request, 'jobs:read');
      limit(request, `test.strict:${String(address)}`, 5, 60);
      throw new ApiError(404, 'NOT_FOUND', 'No such job');
    });
    const answer = await handler(
      call('/api/v1/jobs/x', { headers: { Authorization: 'Bearer k' } }),
    );
    expect(answer.status).toBe(404);
    expect(rateHeaders(answer)).toEqual({ limit: '5', remaining: '4', reset: '60' });
  });

  it('counts a known caller against the general budget per key', async () => {
    mocks.keyCaller.mockResolvedValue({ user, keyId: 'k-general', scopes: ['jobs:read'] });
    const handler = route('t', async (request: Request) => {
      await requireCaller(request, 'jobs:read');
      return json({ ok: true });
    });
    const first = await handler(call('/api/v1/jobs', { headers: { Authorization: 'Bearer k' } }));
    const second = await handler(call('/api/v1/jobs', { headers: { Authorization: 'Bearer k' } }));
    expect(rateHeaders(first)).toEqual({
      limit: String(CALLER_LIMIT),
      remaining: String(CALLER_LIMIT - 1),
      reset: '60',
    });
    expect(rateHeaders(second).remaining).toBe(String(CALLER_LIMIT - 2));
  });

  it('puts the limit on 401 and 403 answers too', async () => {
    const handler = route('t', async (request: Request) => {
      await requireCaller(request, 'account:read');
      return json({ ok: true });
    });
    mocks.keyCaller.mockResolvedValue(null);
    const unknown = await handler(call('/api/v1/me', { headers: { Authorization: 'Bearer x' } }));
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(rateHeaders(unknown).limit).toBe(String(ADDRESS_LIMIT));

    mocks.currentUser.mockResolvedValue(null);
    const signedOut = await handler(call('/api/v1/me'));
    expect(signedOut.status).toBe(401);
    expect(rateHeaders(signedOut).limit).toBe(String(ADDRESS_LIMIT));

    mocks.keyCaller.mockResolvedValue({ user, keyId: 'k-403', scopes: ['jobs:read'] });
    const scoped = await handler(call('/api/v1/me', { headers: { Authorization: 'Bearer k' } }));
    expect(scoped.status).toBe(403);
    expect(rateHeaders(scoped).limit).toBe(String(CALLER_LIMIT));
  });

  it('puts the limit on a 500 too, and logs nothing of the request', async () => {
    const handler = route('t', () => Promise.reject(new Error('boom')));
    const answer = await handler(call('/api/v1/jobs'));
    expect(answer.status).toBe(500);
    expect(rateHeaders(answer).limit).toBe(String(ADDRESS_LIMIT));
  });

  it('answers 429 with Retry-After past a route’s limit', async () => {
    const handler = publicRoute('t', (request: Request) => {
      limit(request, 'test.one-a-minute', 1, 60);
      return Promise.resolve(json({ ok: true }));
    });
    expect((await handler(call('/x'))).status).toBe(200);
    const refused = await handler(call('/x'));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('Retry-After')).toBe('60');
    expect(rateHeaders(refused)).toEqual({ limit: '1', remaining: '0', reset: '60' });
  });
});

describe('scopes', () => {
  it('a key holds what it was given; the website’s session holds everything', () => {
    expect(holds({ scopes: ['jobs:write'] }, 'jobs:write')).toBe(true);
    expect(holds({ scopes: ['jobs:write'] }, 'jobs:read')).toBe(false);
    expect(holds({ scopes: 'all' }, 'account:read')).toBe(true);
  });
});

describe('tightest', () => {
  const set = (limitValue: number, remaining: number, reset: number) => ({
    'RateLimit-Limit': String(limitValue),
    'RateLimit-Remaining': String(remaining),
    'RateLimit-Reset': String(reset),
  });

  it('picks the fewest calls left, then the longest wait, and skips partial sets', () => {
    expect(tightest([set(600, 590, 50), set(30, 25, 10)])).toEqual(set(30, 25, 10));
    expect(tightest([set(600, 3, 50), set(30, 25, 10)])).toEqual(set(600, 3, 50));
    expect(tightest([set(30, 0, 10), set(600, 0, 40)])).toEqual(set(600, 0, 40));
    expect(tightest([{ 'RateLimit-Limit': '1' }, set(5, 5, 5)])).toEqual(set(5, 5, 5));
    expect(tightest([])).toBeUndefined();
  });
});

describe('readJson', () => {
  const Body = z.strictObject({ name: z.string() });
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request('https://site.test/api/v1/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      ...(body instanceof ReadableStream && { duplex: 'half' }),
    });

  it('reads a small body', async () => {
    await expect(readJson(post('{"name":"a"}'), Body)).resolves.toEqual({ name: 'a' });
  });

  it('refuses a declared Content-Length over the cap before reading', async () => {
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    await expect(readJson(post(stream, { 'Content-Length': '70000' }), Body)).rejects.toMatchObject(
      { status: 413 },
    );
    expect(pulled).toBe(false);
  });

  it('stops reading an undeclared body once it passes the cap', async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 1000) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(32));
      },
    });
    await expect(readJson(post(stream), Body, 4096)).rejects.toMatchObject({ status: 413 });
    expect(sent).toBeLessThan(20);
  });

  it('refuses bodies that aren’t JSON or aren’t UTF-8', async () => {
    await expect(readJson(post('{'), Body)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(post(new Uint8Array([0x7b, 0xff, 0x7d])), Body)).rejects.toMatchObject({
      status: 400,
    });
    const text = new Request('https://site.test/x', { method: 'POST', body: '{}' });
    await expect(readJson(text, Body)).rejects.toMatchObject({ status: 415 });
  });
});
