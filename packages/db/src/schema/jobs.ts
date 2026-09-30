/**
 * Jobs (docs/04 → Jobs, docs/01 → Queue): the `jobs` table is the queue.
 * Rows hold metadata only: never filenames or file contents.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
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
    outputKey: text('output_key'),
    outputMeta: jsonb('output_meta'),
    creditsQuoted: integer('credits_quoted').notNull().default(0),
    creditsCharged: integer('credits_charged').notNull().default(0),
    progress: smallint('progress').notNull().default(0),
    stage: text('stage'),
    /** Machine code: DECODE_FAILED, TIMEOUT, GPU_UNAVAILABLE. */
    errorCode: text('error_code'),
    /** Safe to show; no content. */
    errorDetail: text('error_detail'),
    attempts: smallint('attempts').notNull().default(0),
    workerId: text('worker_id'),
    gpuSeconds: numeric('gpu_seconds'),
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
    expiresAt: tstz('expires_at').notNull(),
    completedAt: tstz('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('uploads_expires_idx').on(t.expiresAt)],
);
