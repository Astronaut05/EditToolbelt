/**
 * Tools and admin (docs/04 → Tools and admin, docs/07): runtime overrides of
 * the registry, free quota, welcome-grant claims, the admin audit log and the
 * daily job stats. Plus three operational tables the admin reads: service
 * heartbeats, the results of scheduled checks and the alerts the worker sent
 * (docs/07 → Dashboard, System, Alerts).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { RUNTIMES, STATUSES } from '@etb/registry/schema';

import { createdAt, id, tstz } from './columns';
import { users } from './identity';

export const toolStatus = pgEnum('tool_status', STATUSES);
export const toolRuntime = pgEnum('tool_runtime', RUNTIMES);

/** Runtime overrides of registry defaults. Resolution: this row, then the code default (docs/02). */
export const toolFlags = pgTable('tool_flags', {
  toolId: text('tool_id').primaryKey(),
  status: toolStatus('status'),
  maintenanceMessage: text('maintenance_message'),
  serverEnabled: boolean('server_enabled').notNull().default(false),
  costOverride: jsonb('cost_override'),
  limitsOverride: jsonb('limits_override'),
  surfacesOverride: text('surfaces_override').array(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const freeQuota = pgTable(
  'free_quota',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    serverJobsUsed: integer('server_jobs_used').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/**
 * HMAC-SHA256(lowercased email, grant secret): outlives account deletion, so
 * deleting and signing up again can't farm the welcome grant. Purged after 12 months.
 */
export const welcomeGrantClaims = pgTable('welcome_grant_claims', {
  emailHmac: text('email_hmac').primaryKey(),
  claimedAt: tstz('claimed_at').notNull().defaultNow(),
});

/** Every admin action, with a required reason. Append-only, like the ledger. */
export const adminAuditLog = pgTable('admin_audit_log', {
  id: id(),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
});

export const toolStatsDaily = pgTable(
  'tool_stats_daily',
  {
    day: date('day').notNull(),
    toolId: text('tool_id').notNull(),
    runtime: toolRuntime('runtime').notNull(),
    jobsTotal: integer('jobs_total').notNull().default(0),
    jobsFailed: integer('jobs_failed').notNull().default(0),
    p50Ms: integer('p50_ms'),
    p95Ms: integer('p95_ms'),
    gpuSeconds: numeric('gpu_seconds')
      .notNull()
      .default(sql`0`),
    creditsCharged: integer('credits_charged').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.toolId, t.runtime] })],
);

/** The last sign of life from each running service (web, worker, GPU backend). */
export const serviceHeartbeats = pgTable(
  'service_heartbeats',
  {
    service: text('service').notNull(),
    instance: text('instance').notNull(),
    version: text('version').notNull(),
    seenAt: tstz('seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.service, t.instance] })],
);

/** The latest result of each scheduled check (ledger invariant, sweeper, lifecycle rules). */
export const systemChecks = pgTable('system_checks', {
  name: text('name').primaryKey(),
  ok: boolean('ok').notNull(),
  detail: jsonb('detail'),
  ranAt: tstz('ran_at').notNull().defaultNow(),
});

/**
 * Every alert the worker raised (docs/07 → Alerts): the 30-minute cool-down
 * per rule and subject reads it, and the System page lists it. Only rule
 * names, tool ids, service names and numbers: never personal data. Kept 90 days.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: id(),
    rule: text('rule').notNull(),
    /** What it's about: a tool id, a service instance, `postgres`; '' for the whole system. */
    subject: text('subject').notNull().default(''),
    message: text('message').notNull(),
    /** Where it went: `telegram`, `email`; empty when neither is set up. */
    channels: text('channels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [index('alerts_rule_subject_idx').on(t.rule, t.subject, t.createdAt.desc())],
);
