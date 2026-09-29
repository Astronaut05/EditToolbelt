import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line) lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  const log = createLogger({
    service: 'web',
    env: 'test',
    version: 'abc123',
    level: 'info',
    destination,
  });
  return { log, lines };
}

describe('createLogger', () => {
  it('writes one JSON object per event with the shared fields', () => {
    const { log, lines } = capture();
    log.info({ tool_id: 'crop-image', duration_ms: 12 }, 'job.succeeded');

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatchObject({
      level: 'info',
      service: 'web',
      env: 'test',
      version: 'abc123',
      event: 'job.succeeded',
      tool_id: 'crop-image',
      duration_ms: 12,
    });
    expect(typeof line?.ts).toBe('string');
    expect(new Date(String(line?.ts)).toISOString()).toBe(line?.ts);
    expect(line).not.toHaveProperty('time');
    expect(line).not.toHaveProperty('msg');
  });

  it('respects the level', () => {
    const { log, lines } = capture();
    log.debug('noise');
    expect(lines).toHaveLength(0);
  });

  it('redacts payloads and event strings', () => {
    const { log, lines } = capture();
    log.warn({ email: 'a@b.io', detail: 'token for a@b.io' }, 'retry for a@b.io');
    expect(lines[0]).toMatchObject({
      level: 'warn',
      email: '[redacted]',
      detail: 'token for [redacted-email]',
      event: 'retry for [redacted-email]',
    });
  });

  it('logs errors with type, message and stack', () => {
    const { log, lines } = capture();
    log.error({ err: new Error('boom'), error_code: 'TEST' }, 'job.failed');
    expect(lines[0]).toMatchObject({
      level: 'error',
      event: 'job.failed',
      error_code: 'TEST',
      err: { type: 'Error', message: 'boom' },
    });
    expect(String((lines[0]?.err as { stack?: string }).stack)).toContain('boom');
  });

  it('scrubs the event pino derives from an error message', () => {
    const { log, lines } = capture();
    log.error(new Error('upload for a@b.io failed'));
    expect(lines[0]).toMatchObject({
      event: 'upload for [redacted-email] failed',
      err: { message: 'upload for [redacted-email] failed' },
    });
  });

  it('redacts child logger bindings', () => {
    const { log, lines } = capture();
    log.child({ job_id: 'j1', filename: 'holiday.mov' }).info('job.claimed');
    expect(lines[0]).toMatchObject({ job_id: 'j1', filename: '[redacted]', event: 'job.claimed' });
  });

  it('keeps parent bindings in grandchildren', () => {
    const { log, lines } = capture();
    log.child({ job_id: 'j1' }).child({ tool_id: 't1', email: 'a@b.io' }).info('job.started');
    expect(lines[0]).toMatchObject({ job_id: 'j1', tool_id: 't1', email: '[redacted]' });
  });
});
