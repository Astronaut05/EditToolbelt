/**
 * GET /api/v1/jobs/:id (docs/06): status, progress and, once done, the
 * result with a download URL that works for 10 minutes. Ask again for a
 * fresh one until the output is deleted at `expires_at`.
 */
import { json, preflight, rateLimit, requireCaller, route } from '../../../../../server/api';
import { jobView, ownJob } from '../../../../../server/jobs';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const GET = route('jobs.get', async (request, { params }: Context) => {
  const { user, ref } = await requireCaller(request, 'jobs:read');
  const limits = rateLimit(`jobs.read:${ref}`, 120, 60);
  const job = await ownJob(user, (await params).id);
  return json({ job: await jobView(job) }, { headers: limits });
});
