/**
 * @etb/api-client: a typed client for the public API (docs/06), used by the
 * web app's server path and, later, the Premiere panel. Types only from
 * `@etb/core/api`, so it adds no runtime dependency to a bundle; answers are
 * trusted as the API's own.
 *
 * The website calls with its cookie (`credentials: 'same-origin'`), scripts
 * and the panel with an API key.
 */
import type {
  CreditList,
  DeviceCode,
  DeviceToken,
  Job,
  JobCreate,
  JobEnvelope,
  JobList,
  Me,
  PartList,
  Problem,
  Quote,
  QuoteRequest,
  ToolDetail,
  ToolList,
  Upload,
  UploadDone,
} from '@etb/core/api';

export type { Job, Me, Quote, ToolDetail };
export type ReadyQuote = Extract<Quote, { status: 'ready' }>;

/** A problem answer (RFC 9457) as an error; `code` is the stable one to branch on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail: string | undefined,
    readonly problem: Partial<Problem>,
  ) {
    super(detail ?? title);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  /** Where the API lives: `https://<site>/api/v1`; `/api/v1` on the site itself. */
  baseUrl?: string;
  /** An API key; without one, the browser's session cookie is sent (same origin only). */
  apiKey?: string;
  fetch?: typeof fetch;
}

const FINAL = new Set(['succeeded', 'failed', 'cancelled', 'expired']);

function aborted(): Error {
  return new DOMException('Cancelled', 'AbortError');
}

export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(aborted());
      },
      { once: true },
    );
  });
}

export interface UploadProgress {
  sent: number;
  total: number;
}

export interface UploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  /** Parts in flight at once. */
  parallel?: number;
}

/** Part URLs live 15 minutes; a fresh batch after 12. */
const PART_URL_FRESH_MS = 12 * 60 * 1000;
const PART_TRIES = 3;

export function createClient(options: ClientOptions = {}) {
  const base = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const auth: Record<string, string> = options.apiKey
    ? { Authorization: `Bearer ${options.apiKey}` }
    : {};

  const url = (path: string) => (/^https?:/.test(path) ? path : `${base}${path}`);

  /** One call; a problem answer throws an ApiError. Answers the status with the body. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the answer's shape
  async function call<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<{ status: number; data: T }> {
    const response = await doFetch(url(path), {
      method: init.method ?? 'GET',
      headers: {
        ...auth,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      ...(!options.apiKey && { credentials: 'same-origin' as const }),
    });
    if (response.status === 204) return { status: 204, data: undefined as T };
    const data = (await response.json().catch(() => ({}))) as T & Partial<Problem>;
    if (!response.ok) {
      throw new ApiError(
        response.status,
        data.code ?? 'UNKNOWN',
        data.title ?? `HTTP ${String(response.status)}`,
        data.detail,
        data,
      );
    }
    return { status: response.status, data };
  }

  const get = async <T>(path: string, signal?: AbortSignal) =>
    (await call<T>(path, { signal })).data;
  const post = async <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    (await call<T>(path, { method: 'POST', body, signal })).data;

  const client = {
    tools: (surface?: string) =>
      get<ToolList>(surface ? `/tools?surface=${encodeURIComponent(surface)}` : '/tools'),
    tool: (id: string) => get<ToolDetail>(`/tools/${encodeURIComponent(id)}`),
    me: (signal?: AbortSignal) => get<Me>('/me', signal),
    credits: (cursor?: string) =>
      get<CreditList>(cursor ? `/me/credits?cursor=${cursor}` : '/me/credits'),

    createUpload: (body: { tool_id: string; bytes: number; mime: string }, signal?: AbortSignal) =>
      post<Upload>('/uploads', body, signal),
    partUrls: (uploadId: string, from: number, count: number, signal?: AbortSignal) =>
      post<PartList>(`/uploads/${uploadId}/parts`, { from, count }, signal),
    completeUpload: (
      uploadId: string,
      parts: { n: number; etag: string }[],
      signal?: AbortSignal,
    ) => post<UploadDone>(`/uploads/${uploadId}/complete`, { parts }, signal),
    cancelUpload: async (uploadId: string) => {
      await call<undefined>(`/uploads/${uploadId}`, { method: 'DELETE' });
    },

    /** The price; `{ status: 'probing' }` until our servers have checked the file. */
    quote: (body: QuoteRequest, signal?: AbortSignal) => post<Quote>('/jobs/quote', body, signal),
    createJob: async (body: JobCreate, idempotencyKey: string, signal?: AbortSignal) =>
      (
        await call<JobEnvelope>('/jobs', {
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': idempotencyKey },
          signal,
        })
      ).data.job,
    job: async (id: string, signal?: AbortSignal) =>
      (await get<JobEnvelope>(`/jobs/${id}`, signal)).job,
    jobs: (cursor?: string) => get<JobList>(cursor ? `/jobs?cursor=${cursor}` : '/jobs'),
    cancelJob: async (id: string) => (await post<JobEnvelope>(`/jobs/${id}/cancel`)).job,

    startDevice: (clientName?: string) =>
      post<DeviceCode>('/auth/device', clientName ? { client_name: clientName } : {}),
    collectDeviceKey: (deviceCode: string) =>
      post<DeviceToken>('/auth/device/token', { device_code: deviceCode }),

    /**
     * Uploads a file in parts, straight to storage, several at once, retrying
     * a part up to 3 times and re-signing URLs older than 12 minutes. Cancels
     * the upload if it fails. Answers the upload id.
     */
    async uploadFile(
      file: Blob,
      toolId: string,
      mime: string,
      opts: UploadOptions = {},
    ): Promise<string> {
      const { signal } = opts;
      const created = await client.createUpload(
        { tool_id: toolId, bytes: file.size, mime },
        signal,
      );
      const urls = new Map<number, { url: string; at: number }>();
      const remember = (parts: { n: number; url: string }[]) => {
        for (const part of parts) urls.set(part.n, { url: part.url, at: Date.now() });
      };
      remember(created.parts);

      const urlFor = async (n: number): Promise<string> => {
        const known = urls.get(n);
        if (known && Date.now() - known.at < PART_URL_FRESH_MS) return known.url;
        remember((await client.partUrls(created.upload_id, n, 50, signal)).parts);
        const fresh = urls.get(n);
        if (!fresh) throw new Error(`no URL for part ${String(n)}`);
        return fresh.url;
      };

      const etags: { n: number; etag: string }[] = [];
      let sent = 0;
      let next = 1;
      opts.onProgress?.({ sent, total: file.size });

      const sendPart = async (n: number): Promise<void> => {
        const start = (n - 1) * created.part_size;
        const body = file.slice(start, Math.min(file.size, start + created.part_size));
        for (let attempt = 1; ; attempt += 1) {
          try {
            const response = await doFetch(await urlFor(n), { method: 'PUT', body, signal });
            if (response.ok) {
              etags.push({ n, etag: response.headers.get('etag') ?? '' });
              sent += body.size;
              opts.onProgress?.({ sent, total: file.size });
              return;
            }
            if (attempt >= PART_TRIES) {
              throw new ApiError(
                response.status,
                'STORAGE_REFUSED',
                `Storage refused part ${String(n)}`,
                undefined,
                {},
              );
            }
          } catch (error) {
            if (signal?.aborted) throw aborted();
            if (error instanceof ApiError || attempt >= PART_TRIES) throw error;
          }
          // An expired or failed URL: sign a fresh one.
          urls.delete(n);
          await wait(1000 * attempt, signal);
        }
      };

      const lane = async (): Promise<void> => {
        while (next <= created.part_count) {
          const n = next;
          next += 1;
          await sendPart(n);
        }
      };

      try {
        await Promise.all(
          Array.from({ length: Math.min(opts.parallel ?? 4, created.part_count) }, lane),
        );
        etags.sort((a, b) => a.n - b.n);
        await client.completeUpload(created.upload_id, etags, signal);
      } catch (error) {
        void client.cancelUpload(created.upload_id).catch(() => undefined);
        throw error;
      }
      return created.upload_id;
    },

    /** Asks for the price until the file has been checked (a second at a time). */
    async readyQuote(body: QuoteRequest, signal?: AbortSignal): Promise<ReadyQuote> {
      for (;;) {
        const answer = await client.quote(body, signal);
        if (answer.status === 'ready') return answer;
        await wait(1000, signal);
      }
    },

    /** Polls a job until it ends; `onProgress` sees each answer on the way. */
    async finished(
      id: string,
      opts: { signal?: AbortSignal; intervalMs?: number; onProgress?: (job: Job) => void } = {},
    ): Promise<Job> {
      for (;;) {
        const job = await client.job(id, opts.signal);
        if (FINAL.has(job.status)) return job;
        opts.onProgress?.(job);
        await wait(opts.intervalMs ?? 2000, opts.signal);
      }
    },
  };
  return client;
}

export type Client = ReturnType<typeof createClient>;
