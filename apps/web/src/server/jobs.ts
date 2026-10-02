/**
 * Server jobs over the API (docs/06 → Endpoints, Job lifecycle; docs/01 → Queue).
 *
 * quote → (the user confirms) → create → progress → result. Everything that
 * decides whether and how a job runs is checked here, on the server, from
 * the worker's probe: the tool and its server path, the caller's tier
 * limits, the options, the price, and what pays for it.
 *
 * What pays (docs/05 → Free allowance): a signed-in account that never paid
 * gets 3 free jobs a day within the tool's free-tier limits; past that, or
 * with paid limits, the job reserves its price in credits. Credits are
 * bought from M5; until then an admin can grant them. The allowance counts
 * job rows, so a daily job that fails, is cancelled or expires gives its
 * slot back. At most 2 jobs (4 once paid) wait or run per account at once.
 */
import { freeAllowance, maxConcurrentServerJobs } from '@etb/config/business';
import type { Job as ApiJob, JobList, Me } from '@etb/core/api';
import {
  and,
  applyCredit,
  count,
  desc,
  eq,
  gte,
  InsufficientCreditsError,
  inArray,
  jobs,
  lt,
  notInArray,
  or,
  sql,
  uploads,
  users,
  type Queryable,
} from '@etb/db';
import { costOf, hasServerPath, isAvailable, limitsOf, priceOf, tools } from '@etb/registry';
import { parseServerOptions, uploadOptions } from '@etb/registry/options';
import type { ToolDef } from '@etb/registry/schema';

import { log } from '../lib/log';
import type { CurrentUser } from './account';
import { db } from './db';
import { refreshToolFlags } from './flags';
import { buyUrl } from './payments/checkout';
import { ApiError } from './problem';
import { deleteObject, presignDownload, StorageError } from './storage';
import { ownUpload, SUBTITLE_TYPES, tierOf, type Tier, type Upload } from './uploads';

export type Job = typeof jobs.$inferSelect;
export type Funding = 'daily' | 'credits' | 'none';

const ACTIVE = ['queued', 'running'] as const;
const GAVE_BACK = ['failed', 'cancelled', 'expired'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** How long a quote waits for the worker's probe before answering "still checking". */
const PROBE_WAIT_MS = 8000;
/** Outputs are deleted this long after the job ends (docs/01 → Retention). */
const OUTPUT_TTL_MS = 60 * 60 * 1000;

interface Probe {
  duration_ms?: number;
  video?: { width?: number; height?: number; fps?: number; vfr?: boolean | null } | null;
}

/**
 * A tool's own reason not to run a file, read from the probe before any job
 * exists: nothing to fix means nothing to pay.
 */
const PRECHECKS: Record<string, (probe: Probe) => string | null> = {
  'vfr-to-cfr': (probe) =>
    probe.video?.vfr === false
      ? `This video already has a constant frame rate${probe.video.fps ? ` (${probe.video.fps.toFixed(2)} fps)` : ''}, so it stays in sync as it is. Nothing to fix, and nothing was charged.`
      : null,
};

export interface JobRequest {
  toolId: string;
  uploadId: string;
  options?: unknown;
}

export type Quote =
  | { status: 'probing' }
  | {
      status: 'ready';
      tool_id: string;
      upload_id: string;
      credits: number;
      funding: Funding;
      can_start: boolean;
      /** Why not, when it can't: QUOTA_EXCEEDED or INSUFFICIENT_CREDITS. */
      blocked_by?: 'QUOTA_EXCEEDED' | 'INSUFFICIENT_CREDITS';
      free_jobs_left: number;
      balance: number;
      balance_after: number;
      estimate_seconds: number | null;
      options: Record<string, unknown>;
    };

function serverTool(toolId: string): ToolDef {
  const tool = tools.find((candidate) => candidate.id === toolId);
  if (!tool) throw new ApiError(404, 'NOT_FOUND', 'No such tool');
  if (!isAvailable(tool) || !hasServerPath(tool)) {
    throw new ApiError(409, 'TOOL_UNAVAILABLE', `${tool.name} doesn’t run on our servers yet`);
  }
  return tool;
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Free daily jobs this account has used today (UTC); failed, cancelled and expired ones don't count. */
async function dailyJobsUsed(userId: string, tx = db()): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.funding, 'daily'),
        gte(jobs.createdAt, startOfUtcDay()),
        notInArray(jobs.status, [...GAVE_BACK]),
      ),
    );
  return row?.n ?? 0;
}

/** One upload feeds one job. */
async function checkUnused(upload: Upload, tx = db()): Promise<void> {
  const [used] = await tx
    .select({ n: count() })
    .from(jobs)
    .where(
      or(
        eq(jobs.inputKey, upload.storageKey),
        sql`${upload.storageKey} = any(${jobs.extraInputKeys})`,
      ),
    );
  if ((used?.n ?? 0) > 0) throw new ApiError(409, 'CONFLICT', 'This upload already has a job');
}

/** A probed upload's record, or the problem answer for a file the probe refused. */
function probeOf(upload: Upload): Probe {
  if (upload.probeError === 'MISSING') {
    throw new ApiError(409, 'UPLOAD_INCOMPLETE', 'The upload is gone', 'Upload the file again.');
  }
  if (upload.probeError) {
    const code = upload.probeError === 'FILE_TOO_LARGE' ? 'FILE_TOO_LARGE' : 'UNSUPPORTED_FORMAT';
    throw new ApiError(422, code, 'We can’t process this file', probeErrorText(upload.probeError));
  }
  return upload.probe ?? {};
}

async function waitForProbe(upload: Upload): Promise<Upload | null> {
  const deadline = Date.now() + PROBE_WAIT_MS;
  let current = upload;
  while (!current.probedAt) {
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const [fresh] = await db().select().from(uploads).where(eq(uploads.id, upload.id));
    if (!fresh) return null;
    current = fresh;
  }
  return current;
}

function checkUpload(upload: Upload, tool: ToolDef): void {
  if (upload.toolId !== tool.id) {
    throw new ApiError(400, 'BAD_REQUEST', 'This upload was made for another tool');
  }
  if (upload.deletedAt)
    throw new ApiError(410, 'NOT_FOUND', 'Upload expired', 'Upload the file again.');
  if (!upload.completedAt) {
    throw new ApiError(409, 'UPLOAD_INCOMPLETE', 'The upload isn’t finished');
  }
}

function checkLimits(tool: ToolDef, tier: Tier, probe: Probe): void {
  const limit = limitsOf(tool)?.server?.[tier];
  if (!limit)
    throw new ApiError(409, 'TOOL_UNAVAILABLE', `${tool.name} doesn’t run on our servers yet`);
  const seconds = (probe.duration_ms ?? 0) / 1000;
  if (limit.maxDurationSec !== undefined && seconds > limit.maxDurationSec) {
    throw new ApiError(
      413,
      'FILE_TOO_LARGE',
      'Too long',
      `This is ${(seconds / 60).toFixed(1)} min; the limit for ${tool.name} is ${String(limit.maxDurationSec / 60)} min.`,
      { max_duration_sec: limit.maxDurationSec },
    );
  }
  const pixels = (probe.video?.width ?? 0) * (probe.video?.height ?? 0);
  if (limit.maxPixels !== undefined && pixels > limit.maxPixels) {
    throw new ApiError(413, 'FILE_TOO_LARGE', 'Too many pixels', undefined, {
      max_pixels: limit.maxPixels,
    });
  }
}

/** "This needs 4 credits; you have 1." A balance below zero comes from a refunded pack. */
function shortfall(credits: number, balance: number): string {
  return balance < 0
    ? `This needs ${String(credits)} credits, and your balance is ${String(balance)} after a refunded pack. Paid jobs start again once it's topped up.`
    : `This needs ${String(credits)} credits; you have ${String(balance)}.`;
}

/** The price and what pays for it: nothing, a free daily job, or credits. */
async function funding(
  user: CurrentUser,
  tier: Tier,
  credits: number,
  tx = db(),
): Promise<
  Pick<
    Extract<Quote, { status: 'ready' }>,
    'funding' | 'can_start' | 'blocked_by' | 'free_jobs_left' | 'balance' | 'balance_after'
  >
> {
  const used = tier === 'free' ? await dailyJobsUsed(user.id, tx) : 0;
  const left = tier === 'free' ? Math.max(0, freeAllowance.signedInDailyServerJobs - used) : 0;
  const [fresh] = await tx
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, user.id));
  const balance = fresh?.balance ?? 0;
  const base = { free_jobs_left: left, balance, balance_after: balance };
  if (credits === 0) return { ...base, funding: 'none', can_start: true };
  if (left > 0) return { ...base, funding: 'daily', can_start: true };
  if (balance >= credits) {
    return { ...base, funding: 'credits', can_start: true, balance_after: balance - credits };
  }
  return {
    ...base,
    funding: 'credits',
    can_start: false,
    blocked_by: tier === 'free' ? 'QUOTA_EXCEEDED' : 'INSUFFICIENT_CREDITS',
  };
}

interface Prepared {
  tool: ToolDef;
  tier: Tier;
  upload: Upload;
  probe: Probe;
  /** The other files the tool takes (Burn Subtitles: the subtitles), in order. */
  extras: { upload: Upload; probe: Probe }[];
  credits: number;
  options: Record<string, unknown>;
}

/**
 * The uploads a tool's options name (`uploadOptions` in the registry): the
 * caller's own, made for this tool, a subtitle file, unused, and probed.
 * Null while one is still being probed.
 */
async function extraUploads(
  user: CurrentUser,
  tool: ToolDef,
  options: Record<string, unknown>,
): Promise<Prepared['extras'] | null> {
  const extras: Prepared['extras'] = [];
  for (const name of uploadOptions[tool.id as keyof typeof uploadOptions] ?? []) {
    const extra = await ownUpload(user, String(options[name]));
    checkUpload(extra, tool);
    if (!SUBTITLE_TYPES.has(extra.mimeClaimed)) {
      throw new ApiError(400, 'BAD_REQUEST', 'Not a subtitle file', `${name}: SRT, VTT or ASS.`);
    }
    await checkUnused(extra);
    const probed = await waitForProbe(extra);
    if (!probed) return null;
    extras.push({ upload: probed, probe: probeOf(probed) });
  }
  return extras;
}

/** Everything a quote and a job both need; null while the worker is still probing. */
async function prepare(user: CurrentUser, request: JobRequest): Promise<Prepared | null> {
  await refreshToolFlags();
  const tool = serverTool(request.toolId);
  const upload = await ownUpload(user, request.uploadId);
  checkUpload(upload, tool);
  if (SUBTITLE_TYPES.has(upload.mimeClaimed)) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'The video goes first',
      'Send the subtitle file as an option.',
    );
  }
  await checkUnused(upload);
  const parsed = parseServerOptions(tool.id, request.options);
  if (!parsed.ok) throw new ApiError(400, 'BAD_REQUEST', 'Invalid options', parsed.error);
  const probed = await waitForProbe(upload);
  if (!probed) return null;
  const probe = probeOf(probed);
  const tier = await tierOf(user.id);
  checkLimits(tool, tier, probe);
  const reason = PRECHECKS[tool.id]?.(probe);
  if (reason) throw new ApiError(422, 'NOTHING_TO_DO', 'Nothing to fix', reason);
  const extras = await extraUploads(user, tool, parsed.options);
  if (!extras) return null;
  const megapixels = ((probe.video?.width ?? 0) * (probe.video?.height ?? 0)) / 1e6;
  const credits = priceOf(costOf(tool), { durationMs: probe.duration_ms ?? 0, megapixels });
  return { tool, tier, upload: probed, probe, extras, credits, options: parsed.options };
}

function probeErrorText(code: string): string {
  if (code === 'FILE_TOO_LARGE') return 'The file is larger or longer than we can take.';
  if (code === 'TIMEOUT') return 'The file took too long to read; it may be damaged.';
  return 'The file isn’t a format this tool takes, or it’s damaged.';
}

export async function quote(user: CurrentUser, request: JobRequest): Promise<Quote> {
  const prepared = await prepare(user, request);
  if (!prepared) return { status: 'probing' };
  const paying = await funding(user, prepared.tier, prepared.credits);
  return {
    status: 'ready',
    tool_id: prepared.tool.id,
    upload_id: prepared.upload.id,
    credits: prepared.credits,
    ...paying,
    estimate_seconds: null,
    options: prepared.options,
  };
}

export async function createJob(
  user: CurrentUser,
  request: JobRequest & { quoteCredits: number; quoteFunding?: Funding | undefined },
  idempotencyKey: string | null,
  /** `api` for a call with an API key, `web` for the website's own. */
  source: 'web' | 'api' = 'web',
): Promise<{ job: Job; created: boolean }> {
  if (idempotencyKey) {
    const [existing] = await db()
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, user.id), eq(jobs.idempotencyKey, idempotencyKey)));
    if (existing) return { job: existing, created: false };
  }
  const prepared = await prepare(user, request);
  if (!prepared) {
    throw new ApiError(
      409,
      'UPLOAD_INCOMPLETE',
      'Still checking the file',
      'Ask for a quote first.',
      {},
      {
        'Retry-After': '1',
      },
    );
  }
  if (request.quoteCredits !== prepared.credits) {
    throw new ApiError(409, 'CONFLICT', 'The price changed', 'Confirm the new quote.', {
      credits: prepared.credits,
    });
  }
  const limits = limitsOf(prepared.tool);
  const outcome = await db().transaction(async (tx) => {
    // One account's creates in a row, so its limits hold under double clicks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`etb.jobs:${user.id}`}))`);
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.userId, user.id), eq(jobs.idempotencyKey, idempotencyKey)));
      if (existing) return { job: existing, created: false };
    }
    await checkUnused(prepared.upload, tx);
    for (const extra of prepared.extras) await checkUnused(extra.upload, tx);
    const [active] = await tx
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.userId, user.id), inArray(jobs.status, [...ACTIVE])));
    const cap = maxConcurrentServerJobs[prepared.tier];
    if ((active?.n ?? 0) >= cap) {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many jobs at once',
        `Wait for one to finish: ${String(cap)} can wait or run at a time.`,
      );
    }
    const paying = await funding(user, prepared.tier, prepared.credits, tx);
    if (!paying.can_start) {
      const quota = paying.blocked_by === 'QUOTA_EXCEEDED';
      // docs/05: the shortfall and, while credits are on sale, where to buy them.
      throw new ApiError(
        quota ? 429 : 402,
        quota ? 'QUOTA_EXCEEDED' : 'INSUFFICIENT_CREDITS',
        quota ? 'No free jobs left today' : 'Not enough credits',
        quota
          ? `You've used today's ${String(freeAllowance.signedInDailyServerJobs)} free server jobs. They come back tomorrow (UTC).`
          : shortfall(prepared.credits, paying.balance),
        {
          credits: prepared.credits,
          balance: paying.balance,
          shortfall: prepared.credits - paying.balance,
          buy_url: await buyUrl(tx),
        },
      );
    }
    // The quote said what pays; never switch a free daily job to credits unasked.
    if (request.quoteFunding !== undefined && request.quoteFunding !== paying.funding) {
      throw new ApiError(
        409,
        'CONFLICT',
        'What pays for this job changed',
        paying.funding === 'credits'
          ? `Today's free server jobs are used up, so this one costs ${String(prepared.credits)} credits. Confirm the new quote.`
          : 'Confirm the new quote.',
        {
          credits: prepared.credits,
          funding: paying.funding,
          free_jobs_left: paying.free_jobs_left,
          balance: paying.balance,
        },
      );
    }
    const [row] = await tx
      .insert(jobs)
      .values({
        toolId: prepared.tool.id,
        userId: user.id,
        source,
        // Paid credits go before free jobs (docs/01 → Queue).
        priority: paying.funding === 'credits' ? 1 : 0,
        options: prepared.options,
        inputMeta: prepared.extras.length
          ? { ...prepared.probe, extras: prepared.extras.map((extra) => extra.probe) }
          : prepared.probe,
        inputKey: prepared.upload.storageKey,
        extraInputKeys: prepared.extras.map((extra) => extra.upload.storageKey),
        funding: paying.funding,
        creditsQuoted: paying.funding === 'credits' ? prepared.credits : 0,
        timeoutSec: limits?.timeoutSec ?? 900,
        maxConcurrent: limits?.maxConcurrent ?? null,
        idempotencyKey,
      })
      .returning();
    if (!row) throw new Error('job row not written');
    if (paying.funding === 'credits') {
      try {
        await applyCredit(tx, user.id, 'reserve', -prepared.credits, { jobId: row.id });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          throw new ApiError(
            402,
            'INSUFFICIENT_CREDITS',
            'Not enough credits',
            shortfall(prepared.credits, error.balance),
            {
              credits: prepared.credits,
              balance: error.balance,
              shortfall: prepared.credits - error.balance,
              buy_url: await buyUrl(db()),
            },
          );
        }
        throw error;
      }
    }
    await tx.execute(sql`select pg_notify('etb_jobs', ${row.id})`);
    return { job: row, created: true };
  });
  if (outcome.created) {
    const { job } = outcome;
    log.info(
      { job_id: job.id, tool_id: job.toolId, funding: job.funding, credits: job.creditsQuoted },
      'job.created',
    );
  }
  return outcome;
}

export async function ownJob(user: CurrentUser, id: string): Promise<Job> {
  if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'No such job');
  const [job] = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, user.id)));
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'No such job');
  return job;
}

/** How many jobs are ahead of a queued one. */
async function position(job: Job): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'queued'),
        or(
          sql`${jobs.priority} > ${job.priority}`,
          and(eq(jobs.priority, job.priority), lt(jobs.createdAt, job.createdAt)),
        ),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Failures the worker reports with a code only. A processor's own failures
 * (TARGET_TOO_SMALL, NO_VIDEO) carry a sentence written for the person,
 * which is shown as it is.
 */
const ERROR_TEXT: Record<string, string> = {
  DECODE_FAILED: 'The file couldn’t be decoded; it may be damaged.',
  TIMEOUT: 'It took too long and was stopped.',
  WORKER_LOST: 'Our server stopped while working on it.',
  EXPIRED: 'It waited too long in the queue. Try again.',
  TOOL_FAILED: 'The tool couldn’t process this file.',
  TOOL_UNAVAILABLE: 'This tool isn’t running on our servers right now.',
  NOT_FOUND: 'The upload was gone before the job started. Try again.',
  STORAGE_UNAVAILABLE: 'Storage wasn’t answering. Try again.',
  INTERNAL: 'Something went wrong on our side.',
};
const PROCESSOR_CODES: ReadonlySet<string> = new Set(['TARGET_TOO_SMALL', 'NO_VIDEO']);

function errorText(job: Job): string {
  const code = job.errorCode ?? '';
  if (PROCESSOR_CODES.has(code) && job.errorDetail) return job.errorDetail;
  return ERROR_TEXT[code] ?? 'Something went wrong.';
}

/** A job as the API shows it: metadata only, and a download URL once it's done. */
export async function jobView(job: Job): Promise<ApiJob> {
  const meta = (job.outputMeta ?? {}) as {
    bytes?: number;
    content_type?: string;
    ext?: string;
    width?: number;
    height?: number;
    notes?: string[];
  };
  const done = job.status === 'succeeded' && job.outputKey && job.finishedAt;
  return {
    id: job.id,
    tool_id: job.toolId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    position: job.status === 'queued' ? await position(job) : null,
    funding: job.funding as Funding,
    credits_quoted: job.creditsQuoted,
    credits_charged: job.creditsCharged,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null,
    error:
      job.status === 'failed' || job.status === 'expired'
        ? {
            code: job.errorCode ?? 'FAILED',
            detail: errorText(job),
            credits_returned: job.creditsQuoted > 0,
          }
        : null,
    result: done
      ? {
          download_url: await presignDownload(
            job.outputKey ?? '',
            `${job.toolId}.${meta.ext ?? 'bin'}`,
          ),
          bytes: meta.bytes ?? null,
          content_type: meta.content_type ?? null,
          ext: meta.ext ?? null,
          width: meta.width ?? null,
          height: meta.height ?? null,
          notes: meta.notes ?? [],
          expires_at: new Date((job.finishedAt?.getTime() ?? 0) + OUTPUT_TTL_MS).toISOString(),
        }
      : job.status === 'succeeded'
        ? { expired: true }
        : null,
  };
}

/**
 * Stops a queued or running job and gives back what it took: its credits,
 * and so its free daily slot. A job that never started loses its input now;
 * a running one's worker notices within 5 s and deletes it. `also` runs in
 * the same transaction (the admin's audit row). Null if it had already ended.
 */
export async function stopJob(
  job: Job,
  also?: (tx: Queryable, row: Job) => Promise<void>,
): Promise<Job | null> {
  const cancelled = await db().transaction(async (tx) => {
    const [row] = await tx
      .update(jobs)
      .set({
        status: 'cancelled',
        errorCode: 'CANCELLED',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, job.id), inArray(jobs.status, [...ACTIVE])))
      .returning();
    if (!row) return null;
    if (row.creditsQuoted > 0) {
      await applyCredit(tx, row.userId, 'release', row.creditsQuoted, { jobId: row.id });
    }
    await also?.(tx, row);
    return row;
  });
  if (!cancelled) return null;
  const keys = [...(job.inputKey ? [job.inputKey] : []), ...job.extraInputKeys];
  if (job.status === 'queued' && keys.length > 0) {
    try {
      for (const key of keys) await deleteObject(key);
      await db()
        .update(jobs)
        .set({ inputKey: null, extraInputKeys: [] })
        .where(eq(jobs.id, job.id));
      await db()
        .update(uploads)
        .set({ deletedAt: new Date() })
        .where(inArray(uploads.storageKey, keys));
    } catch (error) {
      // The sweeper removes it within the hour.
      if (!(error instanceof StorageError)) throw error;
      log.warn({ job_id: job.id }, 'job.input_not_deleted');
    }
  }
  log.info({ job_id: job.id, tool_id: job.toolId }, 'job.cancelled');
  return cancelled;
}

/** The caller cancels their own job; cancelling an ended one answers it as it is. */
export async function cancelJob(user: CurrentUser, id: string): Promise<Job> {
  const job = await ownJob(user, id);
  return (await stopJob(job)) ?? job;
}

/** The caller's recent jobs, newest first, 20 a page; `cursor` is the last id of the previous page. */
export async function listJobs(user: CurrentUser, cursor: string | null): Promise<JobList> {
  if (cursor !== null && !UUID.test(cursor)) throw new ApiError(400, 'BAD_REQUEST', 'Bad cursor');
  const rows = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, user.id), cursor ? lt(jobs.id, cursor) : undefined))
    .orderBy(desc(jobs.id))
    .limit(20);
  return {
    jobs: await Promise.all(rows.map(jobView)),
    next_cursor: rows.length === 20 ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}

const FINAL: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled', 'expired']);
const STREAM_POLL_MS = 1000;
const STREAM_PING_MS = 20_000;
/** A stream closes after this; EventSource reconnects on its own. */
const STREAM_MAX_MS = 15 * 60 * 1000;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * GET /jobs/:id/events as server-sent events: `progress` whenever status,
 * progress, stage or queue position changes, then one `done` with the whole
 * job once it ends, and the stream closes. A comment line every 20 s keeps
 * proxies from closing a quiet stream.
 */
export function jobEvents(
  user: CurrentUser,
  first: Job,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const started = Date.now();
      let quietSince = started;
      let last = '';
      let job: Job | undefined = first;
      send('retry: 2000\n\n');
      try {
        while (job && !closed && !signal.aborted) {
          if (FINAL.has(job.status)) {
            send(`event: done\ndata: ${JSON.stringify(await jobView(job))}\n\n`);
            break;
          }
          const now = JSON.stringify({
            status: job.status,
            progress: job.progress,
            stage: job.stage,
            position: job.status === 'queued' ? await position(job) : null,
          });
          if (now !== last) {
            send(`event: progress\ndata: ${now}\n\n`);
            last = now;
            quietSince = Date.now();
          } else if (Date.now() - quietSince >= STREAM_PING_MS) {
            send(': ping\n\n');
            quietSince = Date.now();
          }
          if (Date.now() - started > STREAM_MAX_MS) break;
          await pause(STREAM_POLL_MS, signal);
          [job] = await db()
            .select()
            .from(jobs)
            .where(and(eq(jobs.id, first.id), eq(jobs.userId, user.id)));
        }
      } catch (error) {
        log.warn({ err: error, job_id: first.id }, 'job.events_failed');
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
}

/** GET /me: who's asking, their tier, balance and free server jobs left today. */
export async function me(user: CurrentUser): Promise<Me> {
  const tier = await tierOf(user.id);
  const used = tier === 'free' ? await dailyJobsUsed(user.id) : 0;
  const buy = await buyUrl(db());
  return {
    email: user.email ?? '',
    name: user.displayName,
    tier,
    credit_balance: user.creditBalance,
    free_jobs_left: tier === 'free' ? Math.max(0, freeAllowance.signedInDailyServerJobs - used) : 0,
    max_concurrent_jobs: maxConcurrentServerJobs[tier],
    buy_url: buy,
  };
}
