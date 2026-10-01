/**
 * /api/v1/jobs (docs/06):
 * - POST `{ tool_id, upload_id, options, quote_credits }` with an
 *   `Idempotency-Key` header starts a server job at the quoted price; a
 *   repeat with the same key answers the same job.
 * - GET lists the caller's recent jobs, metadata only, 20 a page by `?cursor=`.
 */
import { z } from 'zod';

import {
  ApiError,
  json,
  preflight,
  rateLimit,
  readJson,
  requireCaller,
  route,
} from '../../../../server/api';
import { createJob, jobView, listJobs } from '../../../../server/jobs';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const Body = z.strictObject({
  tool_id: z.string().min(1).max(64),
  upload_id: z.string().min(1).max(64),
  options: z.record(z.string(), z.unknown()).optional(),
  quote_credits: z.number().int().min(0),
});

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,128}$/;

export const POST = route('jobs.create', async (request) => {
  const { user, ref } = await requireCaller(request, 'jobs:write');
  const limits = rateLimit(`jobs:${ref}`, 30, 60);
  const key = request.headers.get('idempotency-key');
  if (key !== null && !IDEMPOTENCY_KEY.test(key)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Bad Idempotency-Key', '8 to 128 printable characters.');
  }
  const body = await readJson(request, Body);
  const { job, created } = await createJob(
    user,
    {
      toolId: body.tool_id,
      uploadId: body.upload_id,
      options: body.options,
      quoteCredits: body.quote_credits,
    },
    key,
  );
  return json({ job: await jobView(job) }, { status: created ? 201 : 200, headers: limits });
});

export const GET = route('jobs.list', async (request) => {
  const { user, ref } = await requireCaller(request, 'jobs:read');
  const limits = rateLimit(`jobs.read:${ref}`, 120, 60);
  const cursor = new URL(request.url).searchParams.get('cursor');
  return json(await listJobs(user, cursor), { headers: limits });
});
