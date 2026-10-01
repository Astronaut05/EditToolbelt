/**
 * API errors and answers (docs/06 → Basics): RFC 9457 problem+json with a
 * stable `code`, and JSON that is never cached.
 */
/** Stable codes clients branch on (docs/06 → Basics). */
export type ApiCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'TOOL_UNAVAILABLE'
  | 'UPLOAD_INCOMPLETE'
  | 'NOTHING_TO_DO'
  | 'AUTHORIZATION_PENDING'
  | 'SLOW_DOWN'
  | 'ACCESS_DENIED'
  | 'EXPIRED_TOKEN'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'INSUFFICIENT_CREDITS'
  | 'STORAGE_UNAVAILABLE'
  | 'INTERNAL';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiCode,
    readonly title: string,
    readonly detail?: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(title);
  }
}

export function problem(error: ApiError): Response {
  return Response.json(
    {
      type: 'about:blank',
      title: error.title,
      status: error.status,
      code: error.code,
      ...(error.detail && { detail: error.detail }),
      ...error.extra,
    },
    {
      status: error.status,
      headers: {
        'Content-Type': 'application/problem+json',
        'Cache-Control': 'no-store',
        ...error.headers,
      },
    },
  );
}

/** JSON with no-store: API answers are per caller. */
export function json(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return Response.json(body, { status: init.status ?? 200, headers });
}
