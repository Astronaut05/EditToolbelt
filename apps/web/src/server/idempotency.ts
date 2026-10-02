/**
 * `Idempotency-Key` on POST /jobs (docs/06): the key names one request. We
 * keep a SHA-256 of that request's body, in a canonical form (keys sorted at
 * every level, `options` absent the same as `{}`), so a repeat with the same
 * body answers the same job and a different body under the same key is
 * refused with 422, as the IETF draft on the header asks.
 */
import { createHash } from 'node:crypto';

/** JSON with every object's keys sorted, so the same body always reads the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(',')}}`;
  }
  // Only what JSON can carry gets here; undefined (a missing value) reads as null.
  return value === undefined ? 'null' : JSON.stringify(value);
}

export interface JobBody {
  toolId: string;
  uploadId: string;
  options?: unknown;
  quoteCredits: number;
}

/** The SHA-256 of a start request's body, hex. */
export function requestHash(body: JobBody): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        tool_id: body.toolId,
        upload_id: body.uploadId,
        options: body.options ?? {},
        quote_credits: body.quoteCredits,
      }),
    )
    .digest('hex');
}
