/**
 * Uploads for server jobs (docs/01 → Upload, docs/06 → Endpoints).
 *
 * 1. `create`: checks the tool, the caller's limits and the claimed type, starts
 *    a multipart upload under a random key and hands out the first part URLs.
 * 2. The browser PUTs the parts straight to storage; `partUrls` hands out more.
 * 3. `complete`: joins the parts, checks the size, and wakes the worker, which
 *    probes the file before any job may use it (docs/11 → File intake).
 *
 * Nothing here sees a filename or a byte of the file. An upload nobody
 * completes is aborted by the worker's sweeper after an hour; a completed one
 * no job uses is deleted an hour after it completes.
 */
import { randomUUID } from 'node:crypto';

import { MAX_PART_BATCH, PART_BATCH, partLength, planParts, type PartPlan } from '@etb/core/upload';
import { and, count, eq, gt, isNull, purchases, sql, uploads } from '@etb/db';
import { hasServerPath, isAvailable, limitsOf, tools } from '@etb/registry';

import { log } from '../lib/log';
import type { CurrentUser } from './account';
import { ApiError } from './problem';
import { db } from './db';
import { refreshToolFlags } from './flags';
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  deleteObject,
  headObject,
  presignPart,
  StorageError,
  type CompletedPart,
} from './storage';

/** How long an unfinished upload, or a finished one no job has used, stays. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
/** Unfinished uploads one account may have at once. */
export const MAX_OPEN_UPLOADS = 5;
/** Subtitle files that go beside a video (Burn Subtitles); small, so capped on their own. */
export const SUBTITLE_TYPES: ReadonlySet<string> = new Set([
  'application/x-subrip',
  'text/vtt',
  'text/x-ssa',
]);
const MAX_SUBTITLE_BYTES = 5_000_000;

export type Upload = typeof uploads.$inferSelect;
export type Tier = 'free' | 'paid';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Paid once a purchase has gone through (docs/05 → Free allowance). */
export async function tierOf(userId: string): Promise<Tier> {
  const [row] = await db()
    .select({ n: count() })
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.status, 'completed')));
  return (row?.n ?? 0) > 0 ? 'paid' : 'free';
}

function storageDown(error: unknown): never {
  if (error instanceof StorageError) {
    log.error({ status: error.status, detail: error.message }, 'storage.failed');
    throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is not answering', 'Try again soon.');
  }
  throw error;
}

function planOf(upload: Upload): PartPlan {
  return { partSize: upload.partSize, partCount: upload.partCount };
}

async function urls(upload: Upload, from: number, count: number) {
  const plan = planOf(upload);
  const last = Math.min(plan.partCount, from + count - 1);
  const list: { n: number; url: string }[] = [];
  for (let n = from; n <= last; n += 1) {
    const url = await presignPart(
      upload.storageKey,
      upload.multipartId ?? '',
      n,
      partLength(upload.bytes, plan, n),
    );
    list.push({ n, url });
  }
  return list;
}

export interface NewUpload {
  toolId: string;
  bytes: number;
  mime: string;
}

export async function createUpload(user: CurrentUser, input: NewUpload) {
  const tool = tools.find((candidate) => candidate.id === input.toolId);
  if (!tool) throw new ApiError(404, 'NOT_FOUND', 'No such tool');
  await refreshToolFlags();
  if (!isAvailable(tool) || !hasServerPath(tool)) {
    throw new ApiError(409, 'TOOL_UNAVAILABLE', `${tool.name} doesn’t run on our servers yet`);
  }
  const tier = await tierOf(user.id);
  const limit = limitsOf(tool)?.server?.[tier] ?? limitsOf(tool)?.server?.free;
  if (!limit) {
    throw new ApiError(409, 'TOOL_UNAVAILABLE', `${tool.name} doesn’t run on our servers yet`);
  }
  if (input.bytes > limit.maxBytes) {
    throw new ApiError(
      413,
      'FILE_TOO_LARGE',
      'File too large',
      `This file is ${formatBytes(input.bytes)}; the limit for ${tool.name} is ${formatBytes(limit.maxBytes)}.`,
      { max_bytes: limit.maxBytes },
    );
  }
  const mime = input.mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(tool.accepts ?? []).includes(mime)) {
    throw new ApiError(
      415,
      'UNSUPPORTED_FORMAT',
      'Unsupported file type',
      `${tool.name} takes ${(tool.accepts ?? []).join(', ')}.`,
    );
  }
  if (SUBTITLE_TYPES.has(mime) && input.bytes > MAX_SUBTITLE_BYTES) {
    throw new ApiError(
      413,
      'FILE_TOO_LARGE',
      'File too large',
      `Subtitle files can be up to ${formatBytes(MAX_SUBTITLE_BYTES)}.`,
      { max_bytes: MAX_SUBTITLE_BYTES },
    );
  }
  const now = new Date();
  const [open] = await db()
    .select({ n: count() })
    .from(uploads)
    .where(
      and(
        eq(uploads.userId, user.id),
        isNull(uploads.completedAt),
        isNull(uploads.deletedAt),
        gt(uploads.expiresAt, now),
      ),
    );
  if ((open?.n ?? 0) >= MAX_OPEN_UPLOADS) {
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Too many uploads at once',
      `Finish or cancel an upload first (at most ${String(MAX_OPEN_UPLOADS)} at a time).`,
    );
  }

  const plan = planParts(input.bytes);
  // A random key, never derived from the user or the file (docs/11 → Storage).
  const key = `in/${randomUUID()}`;
  let multipartId: string;
  try {
    multipartId = await createMultipart(key, mime);
  } catch (error) {
    storageDown(error);
  }
  const [upload] = await db()
    .insert(uploads)
    .values({
      userId: user.id,
      storageKey: key,
      bytes: input.bytes,
      mimeClaimed: mime,
      toolId: tool.id,
      multipartId,
      partSize: plan.partSize,
      partCount: plan.partCount,
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
    })
    .returning();
  if (!upload) throw new Error('upload row not written');
  log.info(
    {
      upload_id: upload.id,
      tool_id: tool.id,
      bytes: input.bytes,
      parts: plan.partCount,
      user_ref: user.id,
    },
    'upload.created',
  );
  return {
    upload_id: upload.id,
    part_size: plan.partSize,
    part_count: plan.partCount,
    parts: await urls(upload, 1, PART_BATCH),
    parts_url: `/api/v1/uploads/${upload.id}/parts`,
    complete_url: `/api/v1/uploads/${upload.id}/complete`,
    expires_at: upload.expiresAt.toISOString(),
  };
}

/** The caller's own upload, or 404 (someone else's looks exactly like a missing one). */
export async function ownUpload(user: CurrentUser, id: string): Promise<Upload> {
  if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'No such upload');
  const [upload] = await db()
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, user.id)));
  if (!upload) throw new ApiError(404, 'NOT_FOUND', 'No such upload');
  return upload;
}

function requireOpen(upload: Upload): string {
  if (upload.completedAt) throw new ApiError(409, 'CONFLICT', 'Upload already complete');
  if (upload.deletedAt || !upload.multipartId || upload.expiresAt <= new Date()) {
    throw new ApiError(410, 'NOT_FOUND', 'Upload expired', 'Start the upload again.');
  }
  return upload.multipartId;
}

export async function partUrls(user: CurrentUser, id: string, from: number, count: number) {
  const upload = await ownUpload(user, id);
  requireOpen(upload);
  if (from > upload.partCount) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'No such part',
      `Parts run 1-${String(upload.partCount)}.`,
    );
  }
  return { parts: await urls(upload, from, Math.min(count, MAX_PART_BATCH)) };
}

export async function completeUpload(user: CurrentUser, id: string, parts: CompletedPart[]) {
  const upload = await ownUpload(user, id);
  if (upload.completedAt && !upload.deletedAt) {
    return { upload_id: upload.id, bytes: upload.bytes, status: 'uploaded' as const };
  }
  const multipartId = requireOpen(upload);
  const numbers = new Set(parts.map((part) => part.n));
  const missing: number[] = [];
  for (let n = 1; n <= upload.partCount && missing.length < 10; n += 1) {
    if (!numbers.has(n)) missing.push(n);
  }
  if (missing.length > 0 || numbers.size !== parts.length || parts.length !== upload.partCount) {
    throw new ApiError(
      400,
      'UPLOAD_INCOMPLETE',
      'Some parts are missing',
      `Send each of the ${String(upload.partCount)} parts once with its ETag.`,
      { missing },
    );
  }
  try {
    await completeMultipart(upload.storageKey, multipartId, parts);
  } catch (error) {
    if (error instanceof StorageError && error.status === 400) {
      throw new ApiError(
        400,
        'UPLOAD_INCOMPLETE',
        'Storage refused the parts',
        'Upload them again.',
      );
    }
    storageDown(error);
  }
  let stored: { bytes: number } | null = null;
  try {
    stored = await headObject(upload.storageKey);
  } catch (error) {
    storageDown(error);
  }
  if (stored?.bytes !== upload.bytes) {
    await deleteObject(upload.storageKey).catch(() => undefined);
    await db()
      .update(uploads)
      .set({ multipartId: null, deletedAt: new Date() })
      .where(eq(uploads.id, upload.id));
    throw new ApiError(
      400,
      'UPLOAD_INCOMPLETE',
      'The file arrived at a different size',
      'Start the upload again.',
    );
  }
  const now = new Date();
  await db()
    .update(uploads)
    .set({
      completedAt: now,
      multipartId: null,
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
    })
    .where(eq(uploads.id, upload.id));
  // Wakes a worker to probe it (docs/11 → File intake); workers also poll.
  await db().execute(sql`select pg_notify('etb_uploads', ${upload.id})`);
  log.info(
    { upload_id: upload.id, tool_id: upload.toolId, bytes: upload.bytes },
    'upload.completed',
  );
  return { upload_id: upload.id, bytes: upload.bytes, status: 'uploaded' as const };
}

/** The caller gives up on an upload: abort or delete it now instead of in an hour. */
export async function cancelUpload(user: CurrentUser, id: string): Promise<void> {
  const upload = await ownUpload(user, id);
  if (upload.deletedAt) return;
  try {
    if (upload.multipartId) await abortMultipart(upload.storageKey, upload.multipartId);
    else if (upload.completedAt) await deleteObject(upload.storageKey);
  } catch (error) {
    storageDown(error);
  }
  await db()
    .update(uploads)
    .set({ multipartId: null, deletedAt: new Date() })
    .where(eq(uploads.id, upload.id));
  log.info({ upload_id: upload.id }, 'upload.cancelled');
}

function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? ''}`;
}
