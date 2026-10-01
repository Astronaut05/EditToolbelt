/**
 * GET /api/v1/jobs/:id (docs/06): status, progress and, once done, the
 * result with a download URL that works for 10 minutes. Ask again for a
 * fresh one until the output is deleted at `expires_at`.
 */
import { json, rateLimit, requireUser, route } from '../../../../../server/api';
import { jobView, ownJob } from '../../../../../server/jobs';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = route('jobs.get', async (_request, { params }: Context) => {
  const user = await requireUser();
  const limits = rateLimit(`jobs.read:${user.id}`, 120, 60);
  const job = await ownJob(user, (await params).id);
  return json({ job: await jobView(job) }, { headers: limits });
});
