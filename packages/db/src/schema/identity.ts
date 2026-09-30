/**
 * Identity (docs/04 → Identity): users, the Better Auth tables, API keys.
 *
 * Better Auth reads and writes `users`, `sessions`, `accounts`,
 * `verifications` and `twoFactors` through its Drizzle adapter, by these
 * property names; the columns are ours (snake_case, UUIDv7 ids the database
 * generates). The only personal data is the email (docs/08): sessions keep no
 * IP address or user agent, enforced by a check constraint.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, createdAt, id, tstz, updatedAt } from './columns';

export const userRole = pgEnum('user_role', ['user', 'admin']);

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Null only on a tombstone: a deleted account after its 30-day grace. */
    email: citext('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** Optional; Better Auth's `name`. */
    displayName: text('display_name'),
    /** Better Auth's field. Never filled: no avatar URLs are kept. */
    image: text('image'),
    role: userRole('role').notNull().default('user'),
    /** Cached: always the sum of this user's ledger rows (see credits.ts). */
    creditBalance: integer('credit_balance').notNull().default(0),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    locale: text('locale').default('en'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /** Set by an admin: the account can't sign in. */
    disabledAt: tstz('disabled_at'),
    /** Set when the user deletes the account; scrubbed to a tombstone 30 days later. */
    deletedAt: tstz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key')
      .on(t.email)
      .where(sql`${t.email} is not null`),
    check('users_credit_balance_nonnegative', sql`${t.creditBalance} >= 0`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: tstz('expires_at').notNull(),
    /** Better Auth's fields; always null (docs/08: no IPs, hashed or raw). */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    check('sessions_no_ip_or_user_agent', sql`${t.ipAddress} is null and ${t.userAgent} is null`),
  ],
);

/** Sign-in methods linked to a user (Google); magic links need none. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('accounts_user_id_idx').on(t.userId),
    uniqueIndex('accounts_provider_account_key').on(t.providerId, t.accountId),
  ],
);

/** Magic-link tokens and OAuth state, short-lived. */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/** TOTP secrets and backup codes (Better Auth's two-factor plugin), required for admins. */
export const twoFactors = pgTable(
  'two_factors',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: tstz('locked_until'),
  },
  (t) => [index('two_factors_user_id_idx').on(t.userId)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** "Premiere panel on studio PC" */
    name: text('name').notNull(),
    /** Shown in the UI: `etb_live_ab12cd34`. */
    prefix: text('prefix').notNull(),
    /** SHA-256 of the full key, hex; the key itself is shown once. */
    hash: text('hash').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('api_keys_user_id_idx').on(t.userId)],
);
