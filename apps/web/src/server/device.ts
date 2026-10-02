/**
 * The panel's connect flow (docs/06 → Auth), after RFC 8628's device grant:
 * 1. The panel asks for a code (`POST /api/v1/auth/device`) and shows the
 *    short one: 8 consonants, `BCDF-GHJK`, no vowels so no words.
 * 2. The person signs in at /connect and approves it.
 * 3. The panel polls (`POST /api/v1/auth/device/token`) every 5 s and, once
 *    approved, collects an API key for that account.
 * The key is made when the panel collects it, so it is never stored. Codes
 * live 10 minutes; the worker deletes them a day later.
 */
import { createHash, randomBytes } from 'node:crypto';

import { and, deviceCodes, eq, gt, users } from '@etb/db';

import { log } from '../lib/log';
import { createKey, listKeys, MAX_KEYS, TooManyKeys, type Scope } from './api-keys';
import { db } from './db';
import { ApiError } from './problem';
import { lockoutLeft, strike } from './rate-limit';

/** What a connected panel may do (docs/06): `jobs:read jobs:write account:read`. */
export const PANEL_SCOPES: Scope[] = ['jobs:read', 'jobs:write', 'account:read'];
export const CODE_TTL_SEC = 600;
export const POLL_INTERVAL_SEC = 5;

const USER_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_LENGTH = 8;
const USER_CODE = new RegExp(`^[${USER_ALPHABET}]{${String(USER_CODE_LENGTH)}}$`);

/** 8 of 20 consonants (about 35 bits); bytes ≥ 240 are skipped so each is even. */
export function newUserCode(): string {
  let code = '';
  while (code.length < USER_CODE_LENGTH) {
    for (const byte of randomBytes(USER_CODE_LENGTH)) {
      if (byte < 240 && code.length < USER_CODE_LENGTH) code += USER_ALPHABET.charAt(byte % 20);
    }
  }
  return code;
}

/** `BCDFGHJK` → `BCDF-GHJK`. */
export const formatUserCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/** What the person typed, as stored: case, spaces and dashes don't matter. Null if it can't be one. */
export function normalizeUserCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return USER_CODE.test(code) ? code : null;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Starts a connect request; the device code goes to the panel only. */
export async function startDevice(
  clientName: string,
): Promise<{ deviceCode: string; userCode: string }> {
  const deviceCode = randomBytes(32).toString('base64url');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const userCode = newUserCode();
    const made = await db()
      .insert(deviceCodes)
      .values({
        deviceHash: sha256(deviceCode),
        userCode,
        clientName,
        scopes: PANEL_SCOPES,
        expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
      })
      .onConflictDoNothing()
      .returning({ id: deviceCodes.id });
    if (made.length > 0) return { deviceCode, userCode };
  }
  throw new Error('no free connect code after 5 tries');
}

export interface ConnectRequest {
  clientName: string;
  scopes: Scope[];
  expiresAt: Date;
}

const live = (userCode: string) =>
  and(
    eq(deviceCodes.userCode, userCode),
    eq(deviceCodes.status, 'pending'),
    gt(deviceCodes.expiresAt, new Date()),
  );

/** A request still waiting for someone to approve it, by its short code. */
export async function pendingRequest(userCode: string): Promise<ConnectRequest | null> {
  const [row] = await db()
    .select({
      clientName: deviceCodes.clientName,
      scopes: deviceCodes.scopes,
      expiresAt: deviceCodes.expiresAt,
    })
    .from(deviceCodes)
    .where(live(userCode));
  return row ? { ...row, scopes: row.scopes as Scope[] } : null;
}

/**
 * Approves or denies a waiting request for `userId`: `gone` if no such code
 * is waiting, `full` (and nothing changes) when approving for an account
 * that already has its 10 keys.
 */
export async function decide(
  userId: string,
  userCode: string,
  approve: boolean,
): Promise<'done' | 'gone' | 'full'> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: deviceCodes.id })
      .from(deviceCodes)
      .where(live(userCode))
      .for('update');
    if (!row) return 'gone';
    if (approve && (await listKeys(userId, tx)).length >= MAX_KEYS) return 'full';
    await tx
      .update(deviceCodes)
      .set({ status: approve ? 'approved' : 'denied', userId })
      .where(eq(deviceCodes.id, row.id));
    return 'done';
  });
}

/**
 * Guessing codes (RFC 8628 §5.1): a wrong, expired or used code typed at
 * /connect, or sent to its approve and decline, is a miss. 10 misses in 10
 * minutes, per account and per address, and every code is refused until
 * that window ends, the right one too.
 */
export const MISS_LIMIT = 10;
export const MISS_WINDOW_SEC = 600;

const missKeys = (userId: string, address: string) => [
  `connect.miss:user:${userId}`,
  `connect.miss:address:${address}`,
];

/** Seconds until this account at this address may try a code again; 0 if it may now. */
export function connectLockout(userId: string, address: string, now = Date.now()): number {
  return Math.max(...missKeys(userId, address).map((key) => lockoutLeft(key, MISS_LIMIT, now)));
}

/** Counts a miss against the account and the address; logs the account only, never the code. */
export function connectMiss(userId: string, address: string, now = Date.now()): void {
  for (const key of missKeys(userId, address)) strike(key, MISS_WINDOW_SEC, now);
  log.warn({ user_ref: userId }, 'device.code_missed');
}

export interface CollectedKey {
  key: string;
  prefix: string;
  name: string;
  scopes: Scope[];
}

type Poll =
  { kind: 'key'; key: CollectedKey } | { kind: 'pending' | 'slow' | 'denied' | 'expired' | 'full' };

/**
 * The panel's poll. Answers the key once, when approved; otherwise throws
 * the RFC 8628 states as problem+json codes: AUTHORIZATION_PENDING,
 * SLOW_DOWN (polled sooner than every 5 s), ACCESS_DENIED, EXPIRED_TOKEN.
 */
export async function collectKey(deviceCode: string): Promise<CollectedKey> {
  // The poll time is written even when the answer is "not yet", so the
  // transaction decides and commits, and the error is thrown after.
  const poll = await db().transaction(async (tx): Promise<Poll> => {
    const [row] = await tx
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.deviceHash, sha256(deviceCode)))
      .for('update');
    const now = new Date();
    if (!row || row.status === 'used' || row.expiresAt <= now) return { kind: 'expired' };
    if (row.status === 'denied') return { kind: 'denied' };
    if (row.status === 'pending' || !row.userId) {
      const soon =
        row.lastPolledAt !== null &&
        now.getTime() - row.lastPolledAt.getTime() < (POLL_INTERVAL_SEC - 1) * 1000;
      await tx.update(deviceCodes).set({ lastPolledAt: now }).where(eq(deviceCodes.id, row.id));
      return { kind: soon ? 'slow' : 'pending' };
    }
    // Approved, but the account was disabled or deleted since: no key for it.
    const [owner] = await tx
      .select({ disabledAt: users.disabledAt, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, row.userId));
    if (!owner || owner.disabledAt || owner.deletedAt) return { kind: 'denied' };
    try {
      const { key, row: made } = await createKey(
        row.userId,
        row.clientName,
        row.scopes as Scope[],
        tx,
      );
      await tx
        .update(deviceCodes)
        .set({ status: 'used', apiKeyId: made.id, lastPolledAt: now })
        .where(eq(deviceCodes.id, row.id));
      return {
        kind: 'key',
        key: { key, prefix: made.prefix, name: made.name, scopes: made.scopes },
      };
    } catch (error) {
      if (error instanceof TooManyKeys) return { kind: 'full' };
      throw error;
    }
  });
  switch (poll.kind) {
    case 'key':
      return poll.key;
    case 'pending':
      throw new ApiError(
        400,
        'AUTHORIZATION_PENDING',
        'Waiting for approval',
        'Nobody has approved this code yet. Poll again in 5 s.',
        { interval: POLL_INTERVAL_SEC },
      );
    case 'slow':
      throw new ApiError(400, 'SLOW_DOWN', 'Polling too fast', 'Poll every 5 s at most.', {
        interval: POLL_INTERVAL_SEC + 5,
      });
    case 'denied':
      throw new ApiError(403, 'ACCESS_DENIED', 'The request was declined');
    case 'full':
      throw new ApiError(
        409,
        'CONFLICT',
        'That account has 10 API keys',
        'It must revoke one in Account → API keys; then poll again.',
      );
    case 'expired':
      throw new ApiError(
        400,
        'EXPIRED_TOKEN',
        'This code has expired or was used',
        'Start connecting again.',
      );
  }
}
