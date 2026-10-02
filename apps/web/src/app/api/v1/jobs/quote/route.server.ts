/**
 * POST /api/v1/jobs/quote (docs/06): `{ tool_id, upload_id, options }` → the
 * price from the worker's probe, what pays for it and the balance after.
 * While the worker is still probing it answers 202 `{ status: "probing" }`
 * with `Retry-After`; ask again.
 */
import { Quote, QuoteRequest } from '@etb/core/api';

import { json, limit, readJson, preflight, requireCaller, route } from '../../../../../server/api';
import { quote } from '../../../../../server/jobs';
import { quoteFor } from '../../../../../server/scoped';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export const POST = route('jobs.quote', async (request) => {
  const caller = await requireCaller(request, 'jobs:write');
  const { user, ref } = caller;
  limit(request, `jobs.quote:${ref}`, 60, 60);
  const body = await readJson(request, QuoteRequest);
  const priced: Quote = await quote(user, {
    toolId: body.tool_id,
    uploadId: body.upload_id,
    options: body.options,
  });
  const answer = quoteFor(caller, priced);
  if (answer.status === 'probing') {
    return json(answer, { status: 202, headers: { 'Retry-After': '1' } });
  }
  return json(answer);
});
