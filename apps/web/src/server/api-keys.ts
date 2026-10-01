/**
 * API keys (docs/06 → Auth; docs/04 → api_keys): `etb_live_` and 32 random
 * letters and digits, shown once when made. We keep the key's SHA-256 and its
 * first characters, so a key can be found and named but never shown again.
 * `last_used_at` is written at most once a minute.
 */
import { createHash, randomBytes } from 'node:crypto';

import { SCOPES, type Scope } from '@etb/core/api';
import { and, apiKeys, count, desc, eq, isNull, sql, users, type Queryable } from '@etb/db';

import type { CurrentUser } from './account';
import { db } from './db';

export { SCOPES, type Scope };

/** What each scope lets a key do, in the settings page's words. */
export const SCOPE_LABELS: Record<Scope, string> = {
  'jobs:read': 'See jobs and download results',
  'jobs:write': 'Upload files and start jobs',
  'account:read': 'See the balance and free jobs left',
};

export const KEY_PREFIX = 'etb_live_';
const BODY_LENGTH = 32;
/** Live keys per account; revoked ones don't count. */
export const MAX_KEYS = 10;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}[0-9A-Za-z]{${String(BODY_LENGTH)}}$`);

/** A new key: 32 characters from 62, about 190 bits. Bytes ≥ 248 are skipped so each is even. */
export function newKey(): string {
  let body = '';
  while (body.length < BODY_LENGTH) {
    for (const byte of randomBytes(BODY_LENGTH)) {
      if (byte < 248 && body.length < BODY_LENGTH) body += ALPHABET.charAt(byte % 62);
    }
  }
  return KEY_PREFIX + body;
}

export const looksLikeKey = (value: string): boolean => KEY_PATTERN.test(value);

export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

/** What the settings page shows: `etb_live_ab12cd34`. */
export const keyPrefix = (key: string): string => key.slice(0, KEY_PREFIX.length + 8);

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  lastUsedAt: Date | null;
  createdAt: Date;
}

const asScopes = (scopes: string[]): Scope[] =>
  scopes.filter((scope): scope is Scope => (SCOPES as readonly string[]).includes(scope));

/** The account's live keys, newest first. */
export async function listKeys(userId: string, q: Queryable = db()): Promise<KeyRow[]> {
  const rows = await q
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((row) => ({ ...row, scopes: asScopes(row.scopes) }));
}

export class TooManyKeys extends Error {}

/**
 * Makes a key and returns it: the only time it exists outside the caller's
 * hands. The account row is locked so two at once can't pass the cap.
 */
export async function createKey(
  userId: string,
  name: string,
  scopes: readonly Scope[],
  q: Queryable = db(),
): Promise<{ key: string; row: KeyRow }> {
  const key = newKey();
  return q.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [live] = await tx
      .select({ n: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
    if ((live?.n ?? 0) >= MAX_KEYS) throw new TooManyKeys();
    const [row] = await tx
      .insert(apiKeys)
      .values({ userId, name, prefix: keyPrefix(key), hash: hashKey(key), scopes: [...scopes] })
      .returning();
    if (!row) throw new Error('api key insert returned nothing');
    return {
      key,
      row: {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: asScopes(row.scopes),
        lastUsedAt: null,
        createdAt: row.createdAt,
      },
    };
  });
}

/** Revokes one of the account's keys; false if there was no such live key. */
export async function revokeKey(userId: string, keyId: string): Promise<boolean> {
  const done = await db()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return done.length > 0;
}

export interface KeyCaller {
  user: CurrentUser;
  keyId: string;
  scopes: Scope[];
}

/**
 * The account behind a key, or null: unknown, revoked, or its account is
 * closed or disabled. Marks the key used, at most once a minute.
 */
export async function keyCaller(key: string): Promise<KeyCaller | null> {
  if (!looksLikeKey(key)) return null;
  const [row] = await db()
    .select({ user: users, keyId: apiKeys.id, scopes: apiKeys.scopes })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.hash, hashKey(key)), isNull(apiKeys.revokedAt)));
  if (!row || row.user.disabledAt || row.user.deletedAt) return null;
  await db()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, row.keyId),
        sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - interval '1 minute')`,
      ),
    );
  return { user: row.user, keyId: row.keyId, scopes: asScopes(row.scopes) };
}
