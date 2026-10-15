import { describe, expect, it } from 'vitest';

import { base64Of, GeminiClient, GeminiError, modelId } from './gemini';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { generationConfig: Record<string, unknown>; contents: unknown[] };
}

/** A fetch that answers from a list in turn and keeps what was sent. */
function fakeFetch(answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Sent['body'],
    });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetcher, sent };
}

const ok = (text: string, finishReason = 'STOP') =>
  new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text: 'thinking…', thought: true }, { text }] }, finishReason },
      ],
    }),
  );

const problem = (status: number, message: string, details: unknown[] = []) =>
  new Response(JSON.stringify({ error: { code: status, message, status: 'X', details } }), {
    status,
  });

const call = (waits: number[] = []) => ({
  system: 'sys',
  prompt: 'prompt',
  audio: { mimeType: 'audio/flac', base64: 'AAAA' },
  schema: { type: 'object' },
  signal: new AbortController().signal,
  onWait: (seconds: number) => {
    waits.push(seconds);
  },
});

const noWait = () => Promise.resolve();

describe('GeminiClient', () => {
  it('sends the key in a header, the audio before the request, JSON to the schema', async () => {
    const { fetcher, sent } = fakeFetch([ok('{"cues":[]}')]);
    const answer = await new GeminiClient('k3y', 'gemini-3.5-flash', fetcher, noWait).generate(
      call(),
    );
    expect(answer).toEqual({ text: '{"cues":[]}', finish: 'STOP' });
    const [request] = sent;
    expect(request?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    );
    expect(request?.url).not.toContain('k3y');
    expect(request?.headers['x-goog-api-key']).toBe('k3y');
    expect(request?.body.contents).toEqual([
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'audio/flac', data: 'AAAA' } }, { text: 'prompt' }],
      },
    ]);
    expect(request?.body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      thinkingConfig: { thinkingLevel: 'low' },
    });
  });

  it('drops a field the API refuses, and keeps it dropped for the next call', async () => {
    const { fetcher, sent } = fakeFetch([
      problem(400, 'Invalid JSON payload received. Unknown name "responseJsonSchema"'),
      problem(400, 'Invalid JSON payload received. Unknown name "responseJsonSchema"'),
      ok('{}'),
      ok('{}'),
    ]);
    const client = new GeminiClient('k', 'gemini-2.5-flash', fetcher, noWait);
    await client.generate(call());
    await client.generate(call());
    expect(sent.map((s) => s.body.generationConfig)).toEqual([
      { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } },
      { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } },
      { responseMimeType: 'application/json' },
      { responseMimeType: 'application/json' },
    ]);
  });

  it('tries again when Gemini is busy or doesn’t answer, then gives up', async () => {
    const waits: number[] = [];
    const { fetcher } = fakeFetch([
      problem(503, 'overloaded'),
      new TypeError('Failed to fetch'),
      ok('{}'),
    ]);
    await new GeminiClient('k', 'm', fetcher, noWait).generate(call(waits));
    expect(waits).toEqual([2, 4]);

    const failing = fakeFetch(Array.from({ length: 5 }, () => problem(500, 'internal')));
    await expect(
      new GeminiClient('k', 'm', failing.fetcher, noWait).generate(call()),
    ).rejects.toThrow('Gemini answered HTTP 500: internal');
  });

  it('waits as long as a rate limit says, but not for a daily quota', async () => {
    const waits: number[] = [];
    const { fetcher } = fakeFetch([
      problem(429, 'Resource exhausted', [
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' },
      ]),
      ok('{}'),
    ]);
    await new GeminiClient('k', 'm', fetcher, noWait).generate(call(waits));
    expect(waits).toEqual([17]);

    const daily = fakeFetch([problem(429, 'Quota exceeded for generate_content requests per day')]);
    await expect(
      new GeminiClient('k', 'm', daily.fetcher, noWait).generate(call()),
    ).rejects.toThrow(/usage limit for this key is used up/);
  });

  it('says plainly what’s wrong with the key or the model', async () => {
    const bad = fakeFetch([problem(400, 'API key not valid. Please pass a valid API key.')]);
    await expect(new GeminiClient('k', 'm', bad.fetcher, noWait).generate(call())).rejects.toThrow(
      /isn’t valid/,
    );
    const referrer = fakeFetch([
      problem(403, 'Requests from referer <empty> are blocked. API_KEY_HTTP_REFERRER_BLOCKED'),
    ]);
    await expect(
      new GeminiClient('k', 'm', referrer.fetcher, noWait).generate(call()),
    ).rejects.toThrow(/limited to other websites/);
    const missing = fakeFetch([problem(404, 'models/gemini-9 is not found')]);
    await expect(
      new GeminiClient('k', 'gemini-9', missing.fetcher, noWait).generate(call()),
    ).rejects.toThrow('Gemini has no model called “gemini-9”');
  });

  it('passes a cut-off answer on and refuses a blocked one', async () => {
    const cut = fakeFetch([ok('{"cues":[', 'MAX_TOKENS')]);
    expect((await new GeminiClient('k', 'm', cut.fetcher, noWait).generate(call())).finish).toBe(
      'MAX_TOKENS',
    );
    const blocked = fakeFetch([
      new Response(JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } })),
    ]);
    await expect(
      new GeminiClient('k', 'm', blocked.fetcher, noWait).generate(call()),
    ).rejects.toThrow(GeminiError);
  });
});

describe('helpers', () => {
  it('reads a model name as typed', () => {
    expect(modelId(' models/gemini-3.5-flash ')).toBe('gemini-3.5-flash');
    expect(modelId('')).toBe('gemini-3.5-flash');
  });

  it('writes base64 for long byte runs', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(Buffer.from(base64Of(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});
