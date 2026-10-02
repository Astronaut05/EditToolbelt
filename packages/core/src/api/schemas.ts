/**
 * The public API's bodies, once (docs/06 → Basics: "Schemas defined once in
 * Zod"). The web server reads requests with them, the OpenAPI document and
 * `/developers` are generated from them, and `@etb/api-client` types its calls
 * with them. Field names are the wire's: snake_case.
 */
import { z } from 'zod';

import {
  CATEGORY_IDS,
  creditRuleSchema,
  limitsSchema,
  RUNTIMES,
  STATUSES,
  SURFACES,
} from '@etb/registry/schema';

import { MAX_PART_BATCH, MAX_PARTS } from '../upload';

/** Every named body; the OpenAPI document's `components.schemas` is made from it. */
export const api = z.registry<{ id: string; description?: string }>();

export const SCOPES = ['jobs:read', 'jobs:write', 'account:read'] as const;
export const Scope = z.enum(SCOPES).register(api, { id: 'Scope' });
export type Scope = z.infer<typeof Scope>;

const id = z.string().min(1).max(64);
const time = z.iso.datetime({ offset: true });

/** RFC 9457 problem details with our stable `code`; some codes add fields (`max_bytes`, `interval`). */
export const Problem = z
  .looseObject({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    detail: z.string().optional(),
  })
  .register(api, { id: 'Problem' });

// ── Tools ────────────────────────────────────────────────────────────────

export const Tool = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    category: z.enum(CATEGORY_IDS),
    status: z.enum(STATUSES),
    runtime: z.enum(RUNTIMES),
    surfaces: z.array(z.enum(SURFACES)),
    accepts: z.array(z.string()),
    limits: limitsSchema.nullable(),
    cost: creditRuleSchema,
    /** True when our servers can run it now: the tool to upload for. */
    server: z.boolean(),
    maintenance: z.string().optional(),
  })
  .register(api, { id: 'Tool' });
export type Tool = z.infer<typeof Tool>;

export const ToolList = z.strictObject({ tools: z.array(Tool) }).register(api, { id: 'ToolList' });

export const ToolDetail = Tool.extend({
  /** JSON Schema of the job's `options`, for server tools; null for browser-only ones. */
  options: z.record(z.string(), z.unknown()).nullable(),
  /**
   * More files a job takes beside the main upload, by option name: an upload id
   * (Burn Subtitles: `subtitles`), or a list of them in order (Merge Videos: `clips`).
   */
  extra_uploads: z.array(z.string()),
}).register(api, { id: 'ToolDetail' });
export type ToolDetail = z.infer<typeof ToolDetail>;

// ── Uploads ──────────────────────────────────────────────────────────────

export const UploadCreate = z
  .strictObject({
    tool_id: id,
    bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    mime: z.string().min(3).max(127),
  })
  .register(api, { id: 'UploadCreate' });

const PartUrl = z.strictObject({ n: z.number().int().min(1), url: z.url() });

export const Upload = z
  .strictObject({
    upload_id: z.string(),
    part_size: z.number().int(),
    part_count: z.number().int(),
    /** The first 20 parts' URLs; PUT each part's exact bytes to its URL. */
    parts: z.array(PartUrl),
    parts_url: z.string(),
    complete_url: z.string(),
    expires_at: time,
  })
  .register(api, { id: 'Upload' });

export const PartsRequest = z
  .strictObject({
    from: z.number().int().min(1),
    count: z.number().int().min(1).max(MAX_PART_BATCH),
  })
  .register(api, { id: 'PartsRequest' });

export const PartList = z
  .strictObject({ parts: z.array(PartUrl) })
  .register(api, { id: 'PartList' });

export const UploadComplete = z
  .strictObject({
    parts: z
      .array(
        z.strictObject({
          n: z.number().int().min(1).max(MAX_PARTS),
          etag: z.string().min(1).max(130),
        }),
      )
      .min(1)
      .max(MAX_PARTS),
  })
  .register(api, { id: 'UploadComplete' });

export const UploadDone = z
  .strictObject({ upload_id: z.string(), bytes: z.number().int(), status: z.literal('uploaded') })
  .register(api, { id: 'UploadDone' });

// ── Jobs ─────────────────────────────────────────────────────────────────

export const Funding = z.enum(['daily', 'credits', 'none']).register(api, {
  id: 'Funding',
  description: 'What pays: one of the free daily jobs, credits, or nothing (a free tool).',
});

export const QuoteRequest = z
  .strictObject({
    tool_id: id,
    upload_id: id,
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .register(api, { id: 'QuoteRequest' });

export const Quote = z
  .discriminatedUnion('status', [
    /** The upload is still being probed; ask again in a second. */
    z.strictObject({ status: z.literal('probing') }),
    z.strictObject({
      status: z.literal('ready'),
      tool_id: z.string(),
      upload_id: z.string(),
      credits: z.number().int(),
      funding: Funding,
      can_start: z.boolean(),
      blocked_by: z.enum(['QUOTA_EXCEEDED', 'INSUFFICIENT_CREDITS']).optional(),
      free_jobs_left: z.number().int(),
      balance: z.number().int(),
      balance_after: z.number().int(),
      estimate_seconds: z.number().nullable(),
      /** The options with every default filled in: what the job will run with. */
      options: z.record(z.string(), z.unknown()),
    }),
  ])
  .register(api, { id: 'Quote' });
export type Quote = z.infer<typeof Quote>;

export const JobCreate = QuoteRequest.extend({
  /** The quote's `credits`; the job is refused (409) if the price has changed since. */
  quote_credits: z.number().int().min(0),
}).register(api, { id: 'JobCreate' });

export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;
export const JobStatus = z.enum(JOB_STATUSES).register(api, { id: 'JobStatus' });

export const JobResult = z
  .union([
    z.strictObject({
      /** Presigned, valid 10 minutes; ask for the job again for a fresh one. */
      download_url: z.url(),
      bytes: z.number().int().nullable(),
      content_type: z.string().nullable(),
      ext: z.string().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      notes: z.array(z.string()),
      /** When the output is deleted: an hour after the job finished. */
      expires_at: time,
    }),
    z.strictObject({ expired: z.literal(true) }),
  ])
  .register(api, { id: 'JobResult' });

export const Job = z
  .strictObject({
    id: z.string(),
    tool_id: z.string(),
    status: JobStatus,
    progress: z.number().int().min(0).max(100),
    stage: z.string().nullable(),
    /** Place in the queue while queued. */
    position: z.number().int().nullable(),
    funding: Funding,
    credits_quoted: z.number().int(),
    credits_charged: z.number().int(),
    created_at: time,
    started_at: time.nullable(),
    finished_at: time.nullable(),
    error: z
      .strictObject({ code: z.string(), detail: z.string(), credits_returned: z.boolean() })
      .nullable(),
    result: JobResult.nullable(),
  })
  .register(api, { id: 'Job' });
export type Job = z.infer<typeof Job>;

export const JobEnvelope = z.strictObject({ job: Job }).register(api, { id: 'JobEnvelope' });

export const JobList = z
  .strictObject({ jobs: z.array(Job), next_cursor: z.string().nullable() })
  .register(api, { id: 'JobList' });

/** What `GET /jobs/:id/events` sends as `event: progress`; `event: done` carries a Job. */
export const JobProgress = z
  .strictObject({
    status: JobStatus,
    progress: z.number().int(),
    stage: z.string().nullable(),
    position: z.number().int().nullable(),
  })
  .register(api, { id: 'JobProgress' });

// ── Account ──────────────────────────────────────────────────────────────

export const Me = z
  .strictObject({
    email: z.string(),
    name: z.string().nullable(),
    tier: z.enum(['free', 'paid']),
    credit_balance: z.number().int(),
    free_jobs_left: z.number().int(),
    max_concurrent_jobs: z.number().int(),
  })
  .register(api, { id: 'Me' });
export type Me = z.infer<typeof Me>;

export const CREDIT_KINDS = [
  'purchase',
  'welcome_grant',
  'admin_grant',
  'reserve',
  'capture',
  'release',
  'refund_purchase',
  'admin_debit',
] as const;

export const CreditEntry = z
  .strictObject({
    id: z.string(),
    kind: z.enum(CREDIT_KINDS),
    /** Positive adds to the balance, negative takes from it; `capture` is a 0 marker. */
    amount: z.number().int(),
    balance_after: z.number().int(),
    job_id: z.string().nullable(),
    created_at: time,
  })
  .register(api, { id: 'CreditEntry' });

export const CreditList = z
  .strictObject({ entries: z.array(CreditEntry), next_cursor: z.string().nullable() })
  .register(api, { id: 'CreditList' });

// ── Connecting the panel ─────────────────────────────────────────────────

export const DeviceStart = z
  .strictObject({ client_name: z.string().trim().min(1).max(60).optional() })
  .register(api, { id: 'DeviceStart' });

export const DeviceCode = z
  .strictObject({
    device_code: z.string(),
    user_code: z.string(),
    verification_uri: z.url(),
    verification_uri_complete: z.url(),
    expires_in: z.number().int(),
    interval: z.number().int(),
  })
  .register(api, { id: 'DeviceCode' });

export const DeviceTokenRequest = z
  .strictObject({ device_code: z.string().min(16).max(128) })
  .register(api, { id: 'DeviceTokenRequest' });

export const DeviceToken = z
  .strictObject({
    api_key: z.string(),
    key_prefix: z.string(),
    name: z.string(),
    scopes: z.array(Scope),
  })
  .register(api, { id: 'DeviceToken' });

// Types of every body, by the same names.
export type Problem = z.infer<typeof Problem>;
export type ToolList = z.infer<typeof ToolList>;
export type UploadCreate = z.infer<typeof UploadCreate>;
export type Upload = z.infer<typeof Upload>;
export type PartsRequest = z.infer<typeof PartsRequest>;
export type PartList = z.infer<typeof PartList>;
export type UploadComplete = z.infer<typeof UploadComplete>;
export type UploadDone = z.infer<typeof UploadDone>;
export type Funding = z.infer<typeof Funding>;
export type QuoteRequest = z.infer<typeof QuoteRequest>;
export type JobCreate = z.infer<typeof JobCreate>;
export type JobStatus = z.infer<typeof JobStatus>;
export type JobResult = z.infer<typeof JobResult>;
export type JobEnvelope = z.infer<typeof JobEnvelope>;
export type JobList = z.infer<typeof JobList>;
export type JobProgress = z.infer<typeof JobProgress>;
export type CreditEntry = z.infer<typeof CreditEntry>;
export type CreditList = z.infer<typeof CreditList>;
export type DeviceStart = z.infer<typeof DeviceStart>;
export type DeviceCode = z.infer<typeof DeviceCode>;
export type DeviceTokenRequest = z.infer<typeof DeviceTokenRequest>;
export type DeviceToken = z.infer<typeof DeviceToken>;
