import { describe, expect, it } from 'vitest';

import { ApiError, createClient } from './index';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake fetch: `answer` decides each response; every call is kept. */
function fake(answer: (call: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = init?.body;
    const call: Seen = {
      method: init?.method ?? 'GET',
      url: input instanceof Request ? input.url : input.toString(),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body:
        typeof body === 'string'
          ? (JSON.parse(body) as unknown)
          : body instanceof Blob
            ? await body.text()
            : body,
    };
    seen.push(call);
    return answer(call);
  };
  return { fetch: fetch, seen };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

describe('the API client', () => {
  it('sends the key, and turns a problem into an ApiError with its code', async () => {
    const { fetch, seen } = fake(() =>
      json(
        {
          type: 'about:blank',
          title: 'Too many',
          status: 429,
          code: 'RATE_LIMITED',
          detail: 'Wait',
        },
        429,
      ),
    );
    const client = createClient({ baseUrl: 'https://x.test/api/v1/', apiKey: 'etb_live_k', fetch });
    const error = await client.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      title: 'Too many',
      detail: 'Wait',
    });
    expect(seen[0]).toMatchObject({
      url: 'https://x.test/api/v1/me',
      headers: { authorization: 'Bearer etb_live_k' },
    });
  });

  it('uploads in parts, re-signs a refused part, and completes in order', async () => {
    const file = new Blob(['aaaa', 'bbbb', 'cc']);
    let refusals = 0;
    const { fetch, seen } = fake((call) => {
      if (call.url.endsWith('/uploads')) {
        return json({
          upload_id: 'u1',
          part_size: 4,
          part_count: 3,
          parts: [1, 2, 3].map((n) => ({ n, url: `https://s.test/p${String(n)}?old` })),
          parts_url: '/api/v1/uploads/u1/parts',
          complete_url: '/api/v1/uploads/u1/complete',
          expires_at: '2026-10-01T00:00:00Z',
        });
      }
      if (call.url.endsWith('/parts')) {
        return json({ parts: [{ n: 2, url: 'https://s.test/p2?fresh' }] });
      }
      if (call.url.startsWith('https://s.test/')) {
        if (call.url === 'https://s.test/p2?old' && refusals++ === 0) {
          return new Response('expired', { status: 403 });
        }
        return new Response(null, { status: 200, headers: { ETag: `"${String(call.body)}"` } });
      }
      return json({ upload_id: 'u1', bytes: 10, status: 'uploaded' });
    });
    const progress: number[] = [];
    const client = createClient({ baseUrl: 'https://x.test/api/v1', apiKey: 'k', fetch });
    const id = await client.uploadFile(file, 'compress-video', 'video/mp4', {
      parallel: 2,
      onProgress: ({ sent }) => progress.push(sent),
    });
    expect(id).toBe('u1');
    expect(seen[0]?.body).toEqual({ tool_id: 'compress-video', bytes: 10, mime: 'video/mp4' });
    expect(seen.find((call) => call.url.endsWith('/parts'))?.body).toEqual({ from: 2, count: 50 });
    expect(seen.find((call) => call.url === 'https://s.test/p2?fresh')).toBeDefined();
    expect(seen.at(-1)?.body).toEqual({
      parts: [
        { n: 1, etag: '"aaaa"' },
        { n: 2, etag: '"bbbb"' },
        { n: 3, etag: '"cc"' },
      ],
    });
    expect(progress.at(-1)).toBe(10);
  }, 10_000);

  it('cancels the upload when a part keeps failing', async () => {
    const { fetch, seen } = fake((call) => {
      if (call.url.endsWith('/uploads')) {
        return json({
          upload_id: 'u2',
          part_size: 4,
          part_count: 1,
          parts: [{ n: 1, url: 'https://s.test/p1' }],
          parts_url: '',
          complete_url: '',
          expires_at: '2026-10-01T00:00:00Z',
        });
      }
      if (call.url.endsWith('/parts')) return json({ parts: [{ n: 1, url: 'https://s.test/p1' }] });
      if (call.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response('no', { status: 500 });
    });
    const client = createClient({ baseUrl: 'https://x.test/api/v1', apiKey: 'k', fetch });
    await expect(client.uploadFile(new Blob(['abc']), 't', 'video/mp4')).rejects.toMatchObject({
      code: 'STORAGE_REFUSED',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen.at(-1)).toMatchObject({
      method: 'DELETE',
      url: 'https://x.test/api/v1/uploads/u2',
    });
  }, 10_000);

  it('asks for the price until the file is checked, and follows a job to its end', async () => {
    let quotes = 0;
    let polls = 0;
    const { fetch } = fake((call) => {
      if (call.url.endsWith('/jobs/quote')) {
        return quotes++ === 0
          ? json({ status: 'probing' }, 202)
          : json({ status: 'ready', credits: 2 });
      }
      polls += 1;
      return json({
        job: { id: 'j', status: polls < 3 ? 'running' : 'succeeded', progress: polls * 30 },
      });
    });
    const client = createClient({ fetch });
    expect(await client.readyQuote({ tool_id: 't', upload_id: 'u' })).toMatchObject({ credits: 2 });
    const seen: number[] = [];
    const job = await client.finished('j', {
      intervalMs: 1,
      onProgress: (j) => seen.push(j.progress),
    });
    expect(job.status).toBe('succeeded');
    expect(seen).toEqual([30, 60]);
  }, 10_000);

  it('uses the session cookie on the site itself', async () => {
    let init: RequestInit | undefined;
    const client = createClient({
      fetch: (_input: RequestInfo | URL, given?: RequestInit) => {
        init = given;
        return Promise.resolve(json({ tools: [] }));
      },
    });
    await client.tools('panel');
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });
});
