/**
 * GET /api/v1/jobs/:id/events (docs/06): the job's progress as server-sent
 * events (`progress`, then `done`), for EventSource. Polling
 * GET /jobs/:id works too.
 */
import { preflight, rateLimit, requireCaller, route } from '../../../../../../server/api';
import { jobEvents, ownJob } from '../../../../../../server/jobs';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const GET = route('jobs.events', async (request, { params }: Context) => {
  const { user, ref } = await requireCaller(request, 'jobs:read');
  const limits = rateLimit(`jobs.events:${ref}`, 30, 60);
  const job = await ownJob(user, (await params).id);
  return new Response(jobEvents(user, job, request.signal), {
    headers: {
      ...limits,
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: compression would hold events back.
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});
