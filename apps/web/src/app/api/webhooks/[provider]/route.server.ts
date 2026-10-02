/**
 * /api/webhooks/<provider> (docs/05 → Payments): Paddle's signed webhooks,
 * Click's Prepare and Complete, Payme's JSON-RPC. Each provider checks its
 * own signature or credentials and answers in its own protocol.
 *
 * Answered while that provider is in this release with every key set,
 * switched on or not: switched off (PAYMENTS_ENABLED or its admin switch),
 * it refuses calls that would start a new payment and still answers those
 * about purchases already made (refunds, chargebacks, a payment for a
 * checkout opened before the switch). Without its keys the path is a 404,
 * as if nothing were there. The path skips the in-app Cloudflare Access
 * check (src/server/access.ts); Access itself needs a path-scoped Bypass for
 * each one (docs/runbooks/turn-on-payments.md). Payloads are never logged.
 */
import { log } from '../../../../lib/log';
import { db } from '../../../../server/db';
import { providerContext } from '../../../../server/payments/checkout';
import { paymentEnv, webhookProvider } from '../../../../server/payments/switches';
import { ApiError, problem } from '../../../../server/problem';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ provider: string }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const id = (await params).provider;
  const env = paymentEnv();
  const found = await webhookProvider(db(), id, env);
  if (!found) return problem(new ApiError(404, 'NOT_FOUND', 'Not found'));
  try {
    const response = await found.provider.handleWebhook(
      request,
      providerContext(db(), env, found.open),
    );
    log.info({ provider: id, status: response.status, open: found.open }, 'payments.webhook');
    return response;
  } catch (error) {
    // The provider retries a 5xx. Errors the provider code catches are kept
    // on the event and alert (the worker's webhook_error rule); this one is
    // only in the log.
    log.error({ err: error, provider: id }, 'payments.webhook_failed');
    return new Response(null, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
