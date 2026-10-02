/**
 * The OpenAPI 3.1 document (docs/06 → Basics), made from the endpoint list
 * below and the schemas in `./schemas`. `/api/v1/openapi.json` serves it and
 * `/developers` lists the same endpoints, so the docs can't drift from the API.
 */
import { z } from 'zod';

import * as S from './schemas';

type Method = 'get' | 'post' | 'delete';

export interface Endpoint {
  method: Method;
  /** OpenAPI path under /api/v1, with `{id}` parameters. */
  path: string;
  operationId: string;
  tag: 'Tools' | 'Uploads' | 'Jobs' | 'Account' | 'Connect';
  summary: string;
  description?: string;
  /** The scope a key needs; `public` for anonymous calls. */
  auth: S.Scope | 'public';
  body?: z.ZodType;
  query?: { name: string; description: string }[];
  idempotent?: boolean;
  ok: { status: number; description: string; schema?: z.ZodType; contentType?: string };
  /** Problem codes this endpoint answers with, beyond UNAUTHORIZED, FORBIDDEN and RATE_LIMITED. */
  errors: string[];
}

export const ENDPOINTS: Endpoint[] = [
  {
    method: 'get',
    path: '/tools',
    operationId: 'listTools',
    tag: 'Tools',
    summary: 'List the tools',
    description:
      'Every listed tool with its status, runtime, limits and price rule. `server: true` marks the ones our servers run now. Admin changes show within 30 s.',
    auth: 'public',
    query: [
      { name: 'surface', description: 'Only tools on this surface: web, mobile, panel or api.' },
    ],
    ok: { status: 200, description: 'The tools.', schema: S.ToolList },
    errors: ['BAD_REQUEST'],
  },
  {
    method: 'get',
    path: '/tools/{id}',
    operationId: 'getTool',
    tag: 'Tools',
    summary: 'One tool, with its options',
    description:
      "The tool plus the JSON Schema of a job's `options` (server tools), so a client can build its form.",
    auth: 'public',
    ok: { status: 200, description: 'The tool.', schema: S.ToolDetail },
    errors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/uploads',
    operationId: 'createUpload',
    tag: 'Uploads',
    summary: 'Start an upload',
    description:
      "Checks the size and type against the tool's limits for your tier, then hands out presigned part URLs. PUT each part's exact bytes to its URL (straight to storage) and keep each answer's `ETag`.",
    auth: 'jobs:write',
    body: S.UploadCreate,
    ok: { status: 201, description: 'The upload and its first part URLs.', schema: S.Upload },
    errors: [
      'BAD_REQUEST',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_FORMAT',
      'TOOL_UNAVAILABLE',
      'NOT_FOUND',
      'STORAGE_UNAVAILABLE',
    ],
  },
  {
    method: 'post',
    path: '/uploads/{id}/parts',
    operationId: 'uploadParts',
    tag: 'Uploads',
    summary: 'More part URLs',
    description: 'Part URLs expire after 15 minutes, so big files fetch them 50 at a time.',
    auth: 'jobs:write',
    body: S.PartsRequest,
    ok: { status: 200, description: 'Part URLs.', schema: S.PartList },
    errors: ['BAD_REQUEST', 'NOT_FOUND', 'CONFLICT'],
  },
  {
    method: 'post',
    path: '/uploads/{id}/complete',
    operationId: 'completeUpload',
    tag: 'Uploads',
    summary: 'Finish an upload',
    description:
      'Joins the parts. Our servers then check the file (the probe); a quote answers `probing` until they have.',
    auth: 'jobs:write',
    body: S.UploadComplete,
    ok: { status: 200, description: 'Uploaded.', schema: S.UploadDone },
    errors: ['BAD_REQUEST', 'UPLOAD_INCOMPLETE', 'NOT_FOUND', 'CONFLICT', 'STORAGE_UNAVAILABLE'],
  },
  {
    method: 'delete',
    path: '/uploads/{id}',
    operationId: 'cancelUpload',
    tag: 'Uploads',
    summary: 'Cancel an upload',
    auth: 'jobs:write',
    ok: { status: 204, description: 'Cancelled; the parts are deleted.' },
    errors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/jobs/quote',
    operationId: 'quoteJob',
    tag: 'Jobs',
    summary: 'Price a job',
    description:
      'The price from the probed file, what pays (a free daily job or credits) and whether it can start. Answers 202 `{ "status": "probing" }` until the probe is done: ask again after a second.',
    auth: 'jobs:write',
    body: S.QuoteRequest,
    ok: { status: 200, description: 'The quote.', schema: S.Quote },
    errors: [
      'BAD_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'TOOL_UNAVAILABLE',
      'UPLOAD_INCOMPLETE',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_FORMAT',
      'NOTHING_TO_DO',
    ],
  },
  {
    method: 'post',
    path: '/jobs',
    operationId: 'createJob',
    tag: 'Jobs',
    summary: 'Start a job',
    description:
      'Starts the job at the quoted price: credits are reserved now and taken when it succeeds, or returned if it fails. Send an `Idempotency-Key`; a repeat answers the same job. 409 if the price changed since the quote.',
    auth: 'jobs:write',
    body: S.JobCreate,
    idempotent: true,
    ok: { status: 201, description: 'The job (200 for a repeat).', schema: S.JobEnvelope },
    errors: [
      'BAD_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'TOOL_UNAVAILABLE',
      'UPLOAD_INCOMPLETE',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_FORMAT',
      'QUOTA_EXCEEDED',
      'INSUFFICIENT_CREDITS',
      'NOTHING_TO_DO',
    ],
  },
  {
    method: 'get',
    path: '/jobs',
    operationId: 'listJobs',
    tag: 'Jobs',
    summary: 'Your recent jobs',
    description: 'Newest first, 20 a page; pass `next_cursor` back as `cursor`.',
    auth: 'jobs:read',
    query: [{ name: 'cursor', description: 'The previous page’s `next_cursor`.' }],
    ok: { status: 200, description: 'A page of jobs.', schema: S.JobList },
    errors: ['BAD_REQUEST'],
  },
  {
    method: 'get',
    path: '/jobs/{id}',
    operationId: 'getJob',
    tag: 'Jobs',
    summary: 'One job',
    description:
      'Its status and progress; once it succeeds, `result.download_url` (valid 10 minutes; ask again for a fresh one). Outputs are deleted an hour after the job ends.',
    auth: 'jobs:read',
    ok: { status: 200, description: 'The job.', schema: S.JobEnvelope },
    errors: ['NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/jobs/{id}/events',
    operationId: 'jobEvents',
    tag: 'Jobs',
    summary: 'Live progress',
    description:
      'Server-sent events: `progress` (a JobProgress) whenever it changes, then one `done` with the whole Job, and the stream ends. With a key, read it with `fetch` (EventSource can’t send headers), or poll `GET /jobs/{id}`.',
    auth: 'jobs:read',
    ok: {
      status: 200,
      description: 'An event stream.',
      schema: S.JobProgress,
      contentType: 'text/event-stream',
    },
    errors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/jobs/{id}/cancel',
    operationId: 'cancelJob',
    tag: 'Jobs',
    summary: 'Cancel a job',
    description: 'Stops a queued or running job and returns its credits.',
    auth: 'jobs:write',
    ok: { status: 200, description: 'The job as it ended.', schema: S.JobEnvelope },
    errors: ['NOT_FOUND', 'CONFLICT'],
  },
  {
    method: 'get',
    path: '/me',
    operationId: 'getMe',
    tag: 'Account',
    summary: 'Your account',
    description:
      'Tier, balance, free server jobs left today (UTC), how many may run at once, and `buy_url`: where to buy credits while they are on sale (null otherwise). A balance can be below zero after a refund; paid jobs then wait for a top-up.',
    auth: 'account:read',
    ok: { status: 200, description: 'The account.', schema: S.Me },
    errors: [],
  },
  {
    method: 'get',
    path: '/me/credits',
    operationId: 'listCredits',
    tag: 'Account',
    summary: 'Your credit history',
    description: 'The ledger, newest first, 50 a page; pass `next_cursor` back as `cursor`.',
    auth: 'account:read',
    query: [{ name: 'cursor', description: 'The previous page’s `next_cursor`.' }],
    ok: { status: 200, description: 'A page of ledger entries.', schema: S.CreditList },
    errors: ['BAD_REQUEST'],
  },
  {
    method: 'post',
    path: '/auth/device',
    operationId: 'startDevice',
    tag: 'Connect',
    summary: 'Start connecting an app',
    description:
      'For apps like the Premiere panel: show `user_code` and open `verification_uri_complete`; the person signs in and approves. Then poll `/auth/device/token` every `interval` seconds.',
    auth: 'public',
    body: S.DeviceStart,
    ok: { status: 200, description: 'The codes.', schema: S.DeviceCode },
    errors: ['BAD_REQUEST'],
  },
  {
    method: 'post',
    path: '/auth/device/token',
    operationId: 'collectDeviceKey',
    tag: 'Connect',
    summary: 'Collect the key',
    description:
      'Problem `AUTHORIZATION_PENDING` until the person approves, `SLOW_DOWN` if polled sooner than every 5 s, `ACCESS_DENIED` if declined, `EXPIRED_TOKEN` after 10 minutes or once collected. Then the API key, this once.',
    auth: 'public',
    body: S.DeviceTokenRequest,
    ok: { status: 200, description: 'The API key.', schema: S.DeviceToken },
    errors: ['BAD_REQUEST', 'AUTHORIZATION_PENDING', 'SLOW_DOWN', 'ACCESS_DENIED', 'EXPIRED_TOKEN'],
  },
];

const ref = (schema: z.ZodType) => {
  const id = S.api.get(schema)?.id;
  if (!id) throw new Error('every body in ENDPOINTS must be registered in api');
  return { $ref: `#/components/schemas/${id}` };
};

/** Each schema in `api`, as JSON Schema 2020-12 with `$ref`s between them. */
function components(): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(S.api, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  });
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => {
      // Each would otherwise carry its own `$schema` and `$id`; the document's 3.1 dialect covers them.
      const rest: Record<string, unknown> = { ...schema };
      delete rest.$schema;
      delete rest.$id;
      return [id, rest];
    }),
  );
}

const STANDARD_ERRORS = ['UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED'];

function operation(endpoint: Endpoint) {
  const params = [
    ...[...endpoint.path.matchAll(/\{(\w+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })),
    ...(endpoint.query ?? []).map((q) => ({
      name: q.name,
      in: 'query',
      required: false,
      description: q.description,
      schema: { type: 'string' },
    })),
    ...(endpoint.idempotent
      ? [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description: '8 to 128 printable characters; a repeat answers the same job.',
            schema: { type: 'string', minLength: 8, maxLength: 128 },
          },
        ]
      : []),
  ];
  const errors =
    endpoint.auth === 'public' ? endpoint.errors : [...endpoint.errors, ...STANDARD_ERRORS];
  return {
    operationId: endpoint.operationId,
    tags: [endpoint.tag],
    summary: endpoint.summary,
    ...(endpoint.description && { description: endpoint.description }),
    security: endpoint.auth === 'public' ? [] : [{ apiKey: [endpoint.auth] }],
    ...(params.length > 0 && { parameters: params }),
    ...(endpoint.body && {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: ref(endpoint.body) } },
      },
    }),
    responses: {
      [String(endpoint.ok.status)]: {
        description: endpoint.ok.description,
        ...(endpoint.ok.schema && {
          content: {
            [endpoint.ok.contentType ?? 'application/json']: { schema: ref(endpoint.ok.schema) },
          },
        }),
      },
      ...(errors.length > 0 && {
        default: {
          description: `A problem. Codes: ${errors.join(', ')}.`,
          content: { 'application/problem+json': { schema: ref(S.Problem) } },
        },
      }),
    },
  };
}

/** The whole document, for a server at `serverUrl` (the site's origin). */
export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of ENDPOINTS) {
    const path = (paths[endpoint.path] ??= {});
    path[endpoint.method] = operation(endpoint);
  }
  return {
    openapi: '3.1.1',
    info: {
      title: 'EditToolbelt API',
      version: '1',
      description:
        'Run EditToolbelt’s server tools from scripts and apps. Make a key in Account → API keys and send it as `Authorization: Bearer etb_live_…`. Errors are RFC 9457 problem+json with a stable `code`; every answer carries `RateLimit-*` headers.',
    },
    servers: [{ url: new URL('/api/v1', serverUrl).href }],
    tags: [
      { name: 'Tools', description: 'What there is, and what it takes.' },
      { name: 'Uploads', description: 'Files go straight to storage in parts.' },
      { name: 'Jobs', description: 'Quote, start, follow, download, cancel.' },
      { name: 'Account', description: 'Balance and history.' },
      { name: 'Connect', description: 'Apps that sign in as you, like the Premiere panel.' },
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'etb_live_…',
          description:
            'An API key from Account → API keys, or from the connect flow. Each operation names the scope it needs.',
        },
      },
      schemas: components(),
    },
    paths,
  };
}
