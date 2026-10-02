/**
 * Jobs (docs/04 → Jobs, docs/01 → Queue): the `jobs` table is the queue.
 * Rows hold metadata only: never filenames or file contents.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tstz, updatedAt } from './columns';
import { users } from './identity';

export const jobSource = pgEnum('job_source', ['web', 'mobile', 'panel', 'api']);

export const jobStatus = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    /** Registry id. */
    toolId: text('tool_id').notNull(),
    /** Every server job belongs to a signed-in user. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    source: jobSource('source').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    priority: smallint('priority').notNull().default(0),
    /** Validated tool options; never a filename. */
    options: jsonb('options').notNull().default({}),
    /** Probed: bytes, mime, width, height, duration_ms, fps, codec, sample_rate, channels. */
    inputMeta: jsonb('input_meta'),
    /** Random storage keys, nulled when the object is deleted. */
    inputKey: text('input_key'),
    /**
     * More inputs a tool takes beside the main one, in the order it reads
     * them (Burn Subtitles: the subtitle file). Emptied when they're deleted.
     */
    extraInputKeys: text('extra_input_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    outputKey: text('output_key'),
    outputMeta: jsonb('output_meta'),
    /**
     * What pays for it: `daily` a free daily job (docs/05 → Free allowance),
     * `credits` the reserved credits, `none` a free tool. A failed, cancelled
     * or expired daily job gives its slot back: the allowance counts jobs.
     */
    funding: text('funding').notNull().default('none'),
    creditsQuoted: integer('credits_quoted').notNull().default(0),
    creditsCharged: integer('credits_charged').notNull().default(0),
    progress: smallint('progress').notNull().default(0),
    stage: text('stage'),
    /** Machine code: DECODE_FAILED, TIMEOUT, GPU_UNAVAILABLE. */
    errorCode: text('error_code'),
    /** Safe to show; no content. */
    errorDetail: text('error_detail'),
    attempts: smallint('attempts').notNull().default(0),
    /** From the registry when the job is created: the worker kills the run after this (docs/11). */
    timeoutSec: integer('timeout_sec').notNull().default(900),
    /** From the registry: at most this many of the tool's jobs run at once (docs/01 → Queue). */
    maxConcurrent: smallint('max_concurrent'),
    workerId: text('worker_id'),
    /** GPU seconds of the job's GPU calls, measured inside the function (docs/01 → GPU backend). */
    gpuSeconds: numeric('gpu_seconds'),
    /**
     * USD a second of this tool's GPU function costs (GPU, CPU and memory),
     * from config/business.ts when the job is created; null for CPU jobs.
     * The worker prices the job's GPU time with it.
     */
    gpuRateUsd: numeric('gpu_rate_usd'),
    /** What the job's GPU calls cost, idle window included (docs/05 → GPU costs). */
    gpuCostUsd: numeric('gpu_cost_usd'),
    cpuSeconds: numeric('cpu_seconds'),
    heartbeatAt: tstz('heartbeat_at'),
    queuedAt: tstz('queued_at').notNull().defaultNow(),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    filesDeletedAt: tstz('files_deleted_at'),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_queue_idx')
      .on(t.status, t.priority.desc(), t.createdAt)
      .where(sql`${t.status} = 'queued'`),
    check('jobs_funding', sql`${t.funding} in ('daily', 'credits', 'none')`),
    index('jobs_running_idx')
      .on(t.heartbeatAt)
      .where(sql`${t.status} = 'running'`),
    index('jobs_user_idx').on(t.userId, t.createdAt.desc()),
    index('jobs_tool_idx').on(t.toolId, t.createdAt),
    index('jobs_sweeper_idx')
      .on(t.finishedAt)
      .where(sql`${t.outputKey} is not null`),
    uniqueIndex('jobs_idempotency_key')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

/** Multipart uploads waiting for a job; unconsumed ones go after an hour with their objects. */
/**
 * A file on its way to a server job (docs/01 → Upload): the browser puts its
 * parts straight into storage under a random key; the worker probes it once
 * it's complete. The object goes when a job has used it, or when the upload
 * is abandoned (`expires_at`, swept by the worker).
 */
export const uploads = pgTable(
  'uploads',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull().unique(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    mimeClaimed: text('mime_claimed').notNull(),
    toolId: text('tool_id').notNull(),
    /** Storage's multipart upload id while parts arrive; null once completed or aborted. */
    multipartId: text('multipart_id'),
    partSize: integer('part_size').notNull(),
    partCount: integer('part_count').notNull(),
    /** Incomplete: when to abort it. Complete: when to delete it if no job has used it. */
    expiresAt: tstz('expires_at').notNull(),
    completedAt: tstz('completed_at'),
    /** The worker's probe (docs/11 → File intake): container, streams, duration, size. No filename. */
    probe: jsonb('probe'),
    probedAt: tstz('probed_at'),
    /** Why the probe refused the file, as an API code (UNSUPPORTED_FORMAT, FILE_TOO_LARGE). */
    probeError: text('probe_error'),
    /** The object is gone from storage. */
    deletedAt: tstz('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('uploads_expires_idx').on(t.expiresAt),
    index('uploads_to_probe_idx')
      .on(t.completedAt)
      .where(
        sql`${t.probedAt} is null and ${t.deletedAt} is null and ${t.completedAt} is not null`,
      ),
  ],
);
