import { describe, expect, it } from 'vitest';

import { canonicalJson, requestHash } from './idempotency';

const body = {
  toolId: 'compress-video',
  uploadId: '0190f1c2-0000-7000-8000-000000000001',
  options: { mode: 'size', targetMb: 10, nested: { b: 1, a: [2, { d: 1, c: 2 }] } },
  quoteCredits: 2,
};

describe('the idempotency hash', () => {
  it('reads keys in any order as the same body', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,2]},"b":1}',
    );
    const reordered = {
      quoteCredits: 2,
      options: { nested: { a: [2, { c: 2, d: 1 }], b: 1 }, targetMb: 10, mode: 'size' },
      uploadId: body.uploadId,
      toolId: 'compress-video',
    };
    expect(requestHash(reordered)).toBe(requestHash(body));
    expect(requestHash(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('takes no options as empty options', () => {
    const bare = { ...body, options: undefined };
    expect(requestHash(bare)).toBe(requestHash({ ...body, options: {} }));
  });

  it('tells any change apart', () => {
    const base = requestHash(body);
    expect(requestHash({ ...body, quoteCredits: 3 })).not.toBe(base);
    expect(requestHash({ ...body, toolId: 'vfr-to-cfr' })).not.toBe(base);
    expect(requestHash({ ...body, uploadId: `${body.uploadId.slice(0, -1)}2` })).not.toBe(base);
    expect(requestHash({ ...body, options: { ...body.options, targetMb: 11 } })).not.toBe(base);
    expect(requestHash({ ...body, options: { ...body.options, targetMb: '10' } })).not.toBe(base);
    // Array order matters; only object keys are sorted.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});
