/**
 * /api/webhooks/<provider> (docs/05 → Payments): Paddle's signed webhooks,
 * Click's Prepare and Complete, Payme's JSON-RPC. Each provider checks its
 * own signature or credentials and answers in its own protocol.
 *
 * 404 unless that provider is fully on (PAYMENTS_ENABLED, the admin switch,
 * its keys), so a switched-off provider's path looks like nothing is there.
 * The path skips the in-app Cloudflare Access check (src/server/access.ts);
 * Access itself needs a path-scoped Bypass for each one
 * (docs/runbooks/turn-on-payments.md). Payloads are never logged.
 */
import { log } from '../../../../lib/log';
import { db } from '../../../../server/db';
import { providerContext } from '../../../../server/payments/checkout';
import { enabledProvider, paymentEnv } from '../../../../server/payments/switches';
import { ApiError, problem } from '../../../../server/problem';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ provider: string }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const id = (await params).provider;
  const env = paymentEnv();
  const provider = await enabledProvider(db(), id, env);
  if (!provider) return problem(new ApiError(404, 'NOT_FOUND', 'Not found'));
  try {
    const response = await provider.handleWebhook(request, providerContext(db(), env));
    log.info({ provider: id, status: response.status }, 'payments.webhook');
    return response;
  } catch (error) {
    // The provider retries a 5xx; the alert comes from the log (docs/07 → Alerts).
    log.error({ err: error, provider: id }, 'payments.webhook_failed');
    return new Response(null, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
