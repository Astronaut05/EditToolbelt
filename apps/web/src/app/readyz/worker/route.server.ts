/**
 * docs/07 → Health endpoints: is the worker alive, seen from outside? 200
 * while a worker writes its heartbeat and the retention sweeper finishes its
 * passes; 503 problem+json naming which is stale otherwise
 * (src/server/worker-health.ts). Railway's health check doesn't call it, so a
 * dead worker never blocks the web's deploys. The scheduled Watch workflow
 * reads it. On the public site anyone can: it says two ages in seconds and
 * nothing else, and the answer is remembered for 15 seconds, so asking often
 * costs the database nothing (docs/decisions/2026-11-12-go-public.md).
 */
import { freshWorkerHealth, workerHealthResponse } from '../../../server/worker-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  return workerHealthResponse(await freshWorkerHealth());
}
