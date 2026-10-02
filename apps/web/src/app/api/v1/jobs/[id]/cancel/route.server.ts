/**
 * POST /api/v1/jobs/:id/cancel (docs/06): stops a queued or running job and
 * gives its credits back. Cancelling a finished job changes nothing and
 * answers it as it is.
 */
import type { JobEnvelope } from '@etb/core/api';

import { json, preflight, requireCaller, route } from '../../../../../../server/api';
import { cancelJob, jobView } from '../../../../../../server/jobs';
import { jobFor } from '../../../../../../server/scoped';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const POST = route('jobs.cancel', async (request, { params }: Context) => {
  const caller = await requireCaller(request, 'jobs:write');
  const job = await cancelJob(caller.user, (await params).id);
  // A finished job is answered as it is: its result needs jobs:read.
  return json({ job: jobFor(caller, await jobView(job)) } satisfies JobEnvelope);
});
