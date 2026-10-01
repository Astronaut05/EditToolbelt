/**
 * POST /api/v1/jobs/:id/cancel (docs/06): stops a queued or running job and
 * gives its credits back. Cancelling a finished job changes nothing and
 * answers it as it is.
 */
import { json, preflight, requireCaller, route } from '../../../../../../server/api';
import { cancelJob, jobView } from '../../../../../../server/jobs';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const POST = route('jobs.cancel', async (request, { params }: Context) => {
  const { user } = await requireCaller(request, 'jobs:write');
  const job = await cancelJob(user, (await params).id);
  return json({ job: await jobView(job) });
});
