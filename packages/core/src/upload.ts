/**
 * Multipart upload sizing, shared by the uploads API and the browser uploader
 * (docs/01 → Upload). R2 needs every part except the last to be the same size,
 * at least 5 MiB, and allows at most 10,000 parts; 8 MiB parts keep retries
 * cheap on slow lines.
 */
export const MIB = 1024 * 1024;
export const PART_SIZE = 8 * MIB;
export const MAX_PARTS = 10_000;
/** Part URLs expire after 15 minutes (docs/11 → Storage), so they're handed out in batches. */
export const PART_URL_TTL_SEC = 15 * 60;
/** Part URLs in the first answer, and at most per `POST /uploads/:id/parts`. */
export const PART_BATCH = 20;
export const MAX_PART_BATCH = 50;

export interface PartPlan {
  partSize: number;
  partCount: number;
}

/** One part size for the whole upload: 8 MiB, or whole MiB above that when 10,000 parts aren't enough. */
export function planParts(bytes: number): PartPlan {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new RangeError('bytes must be a positive whole number');
  }
  let partSize = PART_SIZE;
  if (Math.ceil(bytes / partSize) > MAX_PARTS) {
    partSize = Math.ceil(bytes / MAX_PARTS / MIB) * MIB;
  }
  return { partSize, partCount: Math.ceil(bytes / partSize) };
}

/** The byte length of part `n` (1-based): the part size, except for the last part. */
export function partLength(bytes: number, plan: PartPlan, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > plan.partCount) {
    throw new RangeError(`part ${String(n)} is outside 1-${String(plan.partCount)}`);
  }
  return n < plan.partCount ? plan.partSize : bytes - plan.partSize * (plan.partCount - 1);
}
