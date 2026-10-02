/**
 * The worker's signs of life, read from outside (docs/07 → Health endpoints):
 * how long ago a worker last wrote its heartbeat (every 30 s) and the
 * retention sweeper last finished a pass (every 5 min). The worker alerts on
 * both itself, but a dead worker can't alert: `/readyz/worker` answers 503
 * when either is too old, and the scheduled Watch workflow
 * (.github/workflows/watch.yml) fails on that, through Cloudflare Access.
 * It says only ages in seconds: no instance names, versions, counts or
 * anything about files.
 */
import { sql } from '@etb/db';

import { db } from './db';

/** Older than this and the outside check fails; loose enough to ride out a deploy. */
export const WORKER_LIMITS_SEC = { heartbeat: 10 * 60, sweeper: 30 * 60 } as const;

export interface WorkerAges {
  /** Seconds since the freshest worker heartbeat; null when no worker has one. */
  heartbeatSec: number | null;
  /** Seconds since the sweeper last finished a pass; null when it never has. */
  sweeperSec: number | null;
}

interface Check {
  ok: boolean;
  age_sec: number | null;
  limit_sec: number;
}

export interface WorkerHealth {
  ok: boolean;
  checks: { worker_heartbeat: Check; retention_sweeper: Check };
}

export function workerHealth(
  ages: WorkerAges,
  limits: { heartbeat: number; sweeper: number } = WORKER_LIMITS_SEC,
): WorkerHealth {
  const check = (age: number | null, limit: number): Check => ({
    ok: age !== null && age <= limit,
    age_sec: age,
    limit_sec: limit,
  });
  const checks = {
    worker_heartbeat: check(ages.heartbeatSec, limits.heartbeat),
    retention_sweeper: check(ages.sweeperSec, limits.sweeper),
  };
  return { ok: checks.worker_heartbeat.ok && checks.retention_sweeper.ok, checks };
}

/** Both ages, measured by the database's own clock (it wrote both times). */
export async function workerAges(): Promise<WorkerAges> {
  const result = await db().execute<{
    heartbeat_sec: number | string | null;
    sweeper_sec: number | string | null;
  }>(sql`
    select
      (select greatest(0, floor(extract(epoch from now() - max(seen_at))))::int
         from service_heartbeats where service = 'worker') as heartbeat_sec,
      (select greatest(0, floor(extract(epoch from now() - ran_at)))::int
         from system_checks where name = 'retention_sweeper') as sweeper_sec
  `);
  const row = result.rows[0];
  const seconds = (value: number | string | null | undefined) =>
    value === null || value === undefined ? null : Number(value);
  return { heartbeatSec: seconds(row?.heartbeat_sec), sweeperSec: seconds(row?.sweeper_sec) };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** The answer: 200 with both checks, or 503 problem+json naming what is stale (null: no database). */
export function workerHealthResponse(health: WorkerHealth | null): Response {
  if (health?.ok) {
    return Response.json({ status: 'ok', checks: health.checks }, { headers: NO_STORE });
  }
  const stale = health
    ? Object.entries(health.checks)
        .filter(([, check]) => !check.ok)
        .map(([name]) => name)
    : [];
  return Response.json(
    {
      type: 'about:blank',
      title: 'Worker not answering',
      status: 503,
      detail: health ? `Stale: ${stale.join(', ')}` : 'Down: database',
      ...(health && { checks: health.checks }),
    },
    {
      status: 503,
      headers: { 'Content-Type': 'application/problem+json', ...NO_STORE },
    },
  );
}
