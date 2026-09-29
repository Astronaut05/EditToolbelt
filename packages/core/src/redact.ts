/**
 * Log redaction backstop (docs/07-admin-and-logging.md → Operational logs).
 *
 * Code must not log sensitive data in the first place; this catches mistakes.
 * The worker has a Python twin (apps/worker/src/etb_worker/redact.py). Both are
 * tested against the same cases in fixtures/logging/redaction-cases.json, so
 * change the two together.
 */

export const REDACTED = '[redacted]';

const MAX_DEPTH = 10;

/** Keys (lowercased, non-alphanumerics removed) that are redacted when they contain one of these. */
const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'accesskey',
  'privatekey',
  'authorization',
  'cookie',
  'email',
  'filename',
  'presigned',
  'signedurl',
];

/** Keys (normalised the same way) that are redacted only on an exact match. */
const SENSITIVE_KEYS = new Set([
  'ip',
  'ipaddress',
  'clientip',
  'remoteaddr',
  'remoteaddress',
  'xforwardedfor',
  'cfconnectingip',
  'originalname',
  'filepath',
  'body',
  'requestbody',
  'payload',
  'content',
  'contents',
  'filecontent',
  'filecontents',
  'session',
  'uploadurl',
  'downloadurl',
]);

const URL_WITH_QUERY = /(https?:\/\/[^\s"'<>?#]+)\?[^\s"'<>#]*/g;
const BEARER = /\bbearer\s+[A-Za-z0-9_.~+/=-]+/gi;
const API_KEY = /\betb_(?:live|test)_[A-Za-z0-9]+/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    SENSITIVE_KEYS.has(normalised) || SENSITIVE_KEY_PARTS.some((part) => normalised.includes(part))
  );
}

/** Scrubs signed URL queries, bearer tokens, API keys and email addresses from free text. */
export function redactString(value: string): string {
  return value
    .replace(URL_WITH_QUERY, '$1?[redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(API_KEY, '[redacted-key]')
    .replace(EMAIL, '[redacted-email]');
}

function isBinary(value: object): boolean {
  return (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  );
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  try {
    // File bytes must never reach a log line, whatever key they hide under.
    if (isBinary(value)) return '[binary]';
    if (value instanceof Error) {
      return {
        type: value.name,
        message: redactString(value.message),
        ...(value.stack === undefined ? {} : { stack: redactString(value.stack) }),
      };
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : walk(item, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** Returns a redacted deep copy of a log payload. Never mutates the input. */
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}
