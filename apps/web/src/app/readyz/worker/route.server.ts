/**
 * docs/07 → Health endpoints: is the worker alive, seen from outside? 200
 * while a worker writes its heartbeat and the retention sweeper finishes its
 * passes; 503 problem+json naming which is stale otherwise
 * (src/server/worker-health.ts). Unlike /readyz it sits behind Cloudflare
 * Access, and Railway's health check doesn't call it, so a dead worker never
 * blocks the web's deploys. The scheduled Watch workflow reads it with CI's
 * service token.
 */
import { workerAges, workerHealth, workerHealthResponse } from '../../../server/worker-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ages = await workerAges().catch(() => null);
  return workerHealthResponse(ages && workerHealth(ages));
}
