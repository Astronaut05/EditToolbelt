import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REDACTED, redact } from './redact';

interface Case {
  name: string;
  input: unknown;
  expected: unknown;
}

// Shared with the worker's tests so both loggers redact identically.
const cases = JSON.parse(
  readFileSync(new URL('../../../fixtures/logging/redaction-cases.json', import.meta.url), 'utf8'),
) as Case[];

describe('redact (shared cases)', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(redact(c.input)).toEqual(c.expected);
  });
});

describe('redact (JS-only values)', () => {
  it('turns errors into plain objects and scrubs their text', () => {
    const error = new TypeError('upload to https://x.test/o?X-Amz-Signature=1 failed');
    const out = redact({ err: error }) as {
      err: { type: string; message: string; stack?: string };
    };
    expect(out.err.type).toBe('TypeError');
    expect(out.err.message).toBe('upload to https://x.test/o?[redacted] failed');
    expect(out.err.stack).not.toContain('X-Amz-Signature');
  });

  it('never lets file bytes through', () => {
    expect(redact({ chunk: new Uint8Array([1, 2, 3]), buf: new ArrayBuffer(4) })).toEqual({
      chunk: '[binary]',
      buf: '[binary]',
    });
  });

  it('handles circular references without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(redact(a)).toEqual({ name: 'a', self: '[circular]' });
  });

  it('does not mutate the input', () => {
    const input = { email: 'x@y.io' };
    redact(input);
    expect(input.email).toBe('x@y.io');
    expect(REDACTED).toBe('[redacted]');
  });
});
