/**
 * /api/v1/jobs (docs/06):
 * - POST `{ tool_id, upload_id, options, quote_credits, quote_funding }` with
 *   an `Idempotency-Key` header starts a server job at the quoted price, paid
 *   as quoted (409 if either changed); a repeat with the same key answers
 *   the same job.
 * - GET lists the caller's recent jobs, metadata only, 20 a page by `?cursor=`.
 */
import { JobCreate, JobEnvelope, JobList } from '@etb/core/api';

import {
  ApiError,
  json,
  preflight,
  limit,
  readJson,
  requireCaller,
  route,
} from '../../../../server/api';
import { createJob, jobView, listJobs } from '../../../../server/jobs';
import { jobFor } from '../../../../server/scoped';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,128}$/;

export const POST = route('jobs.create', async (request) => {
  const caller = await requireCaller(request, 'jobs:write');
  const { user, ref, keyId } = caller;
  limit(request, `jobs:${ref}`, 30, 60);
  const key = request.headers.get('idempotency-key');
  if (key !== null && !IDEMPOTENCY_KEY.test(key)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Bad Idempotency-Key', '8 to 128 printable characters.');
  }
  const body = await readJson(request, JobCreate);
  const { job, created } = await createJob(
    user,
    {
      toolId: body.tool_id,
      uploadId: body.upload_id,
      options: body.options,
      quoteCredits: body.quote_credits,
      quoteFunding: body.quote_funding,
    },
    key,
    keyId ? 'api' : 'web',
  );
  // A repeat answers a job that may have finished: its result needs jobs:read.
  const answer: JobEnvelope = { job: jobFor(caller, await jobView(job)) };
  return json(answer, { status: created ? 201 : 200 });
});

export const GET = route('jobs.list', async (request) => {
  const { user, ref } = await requireCaller(request, 'jobs:read');
  limit(request, `jobs.read:${ref}`, 120, 60);
  const cursor = new URL(request.url).searchParams.get('cursor');
  const page: JobList = await listJobs(user, cursor);
  return json(page);
});
