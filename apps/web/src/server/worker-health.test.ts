import { describe, expect, it } from 'vitest';

import { WORKER_LIMITS_SEC, workerHealth, workerHealthResponse } from './worker-health';

describe('the worker’s signs of life, from outside', () => {
  it('are fine while the heartbeat and the sweeper are recent', async () => {
    const health = workerHealth({ heartbeatSec: 31, sweeperSec: 290 });
    expect(health.ok).toBe(true);
    const response = workerHealthResponse(health);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: {
        worker_heartbeat: { ok: true, age_sec: 31, limit_sec: WORKER_LIMITS_SEC.heartbeat },
        retention_sweeper: { ok: true, age_sec: 290, limit_sec: WORKER_LIMITS_SEC.sweeper },
      },
    });
  });

  it('name what is stale in a 503 problem', async () => {
    const response = workerHealthResponse(
      workerHealth({ heartbeatSec: WORKER_LIMITS_SEC.heartbeat + 1, sweeperSec: 60 }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    const body = (await response.json()) as { detail: string; checks: object };
    expect(body.detail).toBe('Stale: worker_heartbeat');
    expect(body.checks).toMatchObject({ retention_sweeper: { ok: true } });
  });

  it('count a worker or a sweeper never seen as stale', async () => {
    const health = workerHealth({ heartbeatSec: null, sweeperSec: null });
    expect(health.ok).toBe(false);
    const body = (await workerHealthResponse(health).json()) as { detail: string };
    expect(body.detail).toBe('Stale: worker_heartbeat, retention_sweeper');
  });

  it('hold at the limit and fail just past it', () => {
    const at = { heartbeatSec: WORKER_LIMITS_SEC.heartbeat, sweeperSec: WORKER_LIMITS_SEC.sweeper };
    expect(workerHealth(at).ok).toBe(true);
    expect(workerHealth({ ...at, sweeperSec: at.sweeperSec + 1 }).ok).toBe(false);
  });

  it('say only that the database is down when it is', async () => {
    const response = workerHealthResponse(null);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Worker not answering',
      status: 503,
      detail: 'Down: database',
    });
  });
});
