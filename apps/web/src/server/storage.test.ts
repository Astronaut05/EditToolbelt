import { describe, expect, it, vi } from 'vitest';

import { completeBody, StorageError } from './storage';

describe('completeBody', () => {
  it('lists parts in order with quoted, escaped ETags', () => {
    expect(
      completeBody([
        { n: 2, etag: 'bbb' },
        { n: 1, etag: '"aaa-2"' },
      ]),
    ).toBe(
      '<CompleteMultipartUpload>' +
        '<Part><PartNumber>1</PartNumber><ETag>&quot;aaa-2&quot;</ETag></Part>' +
        '<Part><PartNumber>2</PartNumber><ETag>&quot;bbb&quot;</ETag></Part>' +
        '</CompleteMultipartUpload>',
    );
  });

  it('refuses an ETag that could smuggle XML', () => {
    expect(() => completeBody([{ n: 1, etag: '"a"</ETag><x>' }])).toThrow(StorageError);
  });
});

describe('storageReady', () => {
  const env = {
    S3_ENDPOINT: 'https://acct.eu.r2.cloudflarestorage.com/',
    S3_BUCKET: 'edittoolbelt-files',
    S3_REGION: 'auto',
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secret',
  };

  async function check(answer: Response | Error) {
    vi.resetModules();
    vi.doMock('./env', () => ({ serverEnv: () => env }));
    const seen: Request[] = [];
    vi.stubGlobal('fetch', (request: Request) => {
      seen.push(request);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    });
    try {
      const { storageReady } = await import('./storage');
      return { result: await storageReady(), seen };
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('./env');
    }
  }

  it('lists one key in the bucket, which object-level tokens may do', async () => {
    const { result, seen } = await check(new Response('<ListBucketResult/>', { status: 200 }));
    expect(result).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    const [request] = seen;
    if (!request) throw new Error('no request');
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(url.origin + url.pathname).toBe(
      'https://acct.eu.r2.cloudflarestorage.com/edittoolbelt-files',
    );
    expect(url.searchParams.get('list-type')).toBe('2');
    expect(url.searchParams.get('max-keys')).toBe('1');
    expect(url.searchParams.get('prefix')).toBe('.readyz/');
  });

  it('says why when storage refuses, without keys', async () => {
    const { result } = await check(
      new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
    );
    expect(result).toEqual({ ok: false, detail: 'GET storage: 403 AccessDenied' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('names a missing bucket', async () => {
    const { result } = await check(
      new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 }),
    );
    expect(result).toEqual({ ok: false, detail: 'GET storage: 404 NoSuchBucket' });
  });

  it('says unreachable when the request never lands', async () => {
    const { result } = await check(new TypeError('fetch failed'));
    expect(result).toEqual({ ok: false, detail: 'GET storage: unreachable' });
  });
});
