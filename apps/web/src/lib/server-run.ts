/**
 * The server path of a hybrid tool, from the browser (docs/06 → Job
 * lifecycle): upload the parts straight to storage, ask for the server's
 * price, start the job, follow it, and download the result. The ToolShell
 * shows each stage and asks before anything is sent.
 *
 * The file's name never leaves the page: the API gets its size and type, and
 * the result is named here, from the original (docs/02 → Output naming).
 */
import { priceOf } from '@etb/registry/pricing';
import {
  fileOptionFile,
  formatBytes,
  ServerRunError,
  type ServerAccount,
  type ServerInfo,
  type ServerQuote,
  type ServerResult,
  type ServerRunContext,
  type ShellServer,
} from '@etb/ui';

/** Parts in flight at once: enough to fill a home connection, few enough for a phone. */
const PARALLEL_PARTS = 4;
/** Part URLs live 15 minutes; fetch a fresh batch after 12. */
const PART_URL_FRESH_MS = 12 * 60 * 1000;
const PART_TRIES = 3;

/** Types the API takes, for files the browser gives no type (MKV on most systems). */
const TYPE_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
};

/** The worker's stages, in words. */
const STAGES: Record<string, string> = {
  starting: 'Starting',
  downloading: 'Starting',
  processing: 'Working',
  analysing: 'Analysing',
  compressing: 'Compressing',
  uploading: 'Saving the result',
  done: 'Saving the result',
};

interface Problem {
  title?: string;
  detail?: string;
  code?: string;
}

interface JobView {
  id: string;
  status: string;
  progress: number;
  stage: string | null;
  position: number | null;
  error: { code: string; detail: string; credits_returned: boolean } | null;
  result: {
    download_url: string;
    bytes: number | null;
    content_type: string | null;
    ext: string | null;
    width: number | null;
    height: number | null;
    notes: string[];
  } | null;
}

function aborted(): DOMException {
  return new DOMException('Cancelled', 'AbortError');
}

/** A JSON call to our API; a problem answer becomes a ServerRunError in its own words. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the answer's shape
async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal },
): Promise<{ status: number; data: T }> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
    credentials: 'same-origin',
  });
  const data = (await response.json().catch(() => ({}))) as T & Problem;
  if (response.status === 401) {
    throw new ServerRunError('Sign in again to use our servers', 'You’re signed out');
  }
  if (!response.ok) {
    throw new ServerRunError(data.detail ?? data.title ?? 'Our servers said no', data.title);
  }
  return { status: response.status, data };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(aborted());
      },
      { once: true },
    );
  });
}

interface Created {
  upload_id: string;
  part_size: number;
  part_count: number;
  parts: { n: number; url: string }[];
  parts_url: string;
  complete_url: string;
}

/** Uploads the file in parts, several at once, straight to storage. */
async function upload(
  file: File,
  toolId: string,
  ctx: ServerRunContext,
  stage = 'Uploading',
): Promise<string> {
  // By extension first: browsers type subtitle files inconsistently, if at all.
  const type = TYPE_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? file.type;
  const { data: created } = await api<Created>('/api/v1/uploads', {
    method: 'POST',
    body: { tool_id: toolId, bytes: file.size, mime: type },
    signal: ctx.signal,
  });
  const urls = new Map<number, { url: string; at: number }>();
  const remember = (parts: { n: number; url: string }[]) => {
    for (const part of parts) urls.set(part.n, { url: part.url, at: Date.now() });
  };
  remember(created.parts);

  async function urlFor(n: number): Promise<string> {
    const known = urls.get(n);
    if (known && Date.now() - known.at < PART_URL_FRESH_MS) return known.url;
    const { data } = await api<{ parts: { n: number; url: string }[] }>(created.parts_url, {
      method: 'POST',
      body: { from: n, count: 50 },
      signal: ctx.signal,
    });
    remember(data.parts);
    const fresh = urls.get(n);
    if (!fresh) throw new ServerRunError('The upload lost its place. Try again.');
    return fresh.url;
  }

  const etags: { n: number; etag: string }[] = [];
  let sent = 0;
  let next = 1;
  const report = () => {
    ctx.progress({
      stage,
      fraction: sent / file.size,
      amount: `${formatBytes(sent)} of ${formatBytes(file.size)}`,
    });
  };
  report();

  async function sendPart(n: number): Promise<void> {
    const start = (n - 1) * created.part_size;
    const body = file.slice(start, Math.min(file.size, start + created.part_size));
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetch(await urlFor(n), {
          method: 'PUT',
          body,
          signal: ctx.signal,
        });
        if (response.ok) {
          etags.push({ n, etag: response.headers.get('etag') ?? '' });
          sent += body.size;
          report();
          return;
        }
        // An expired URL: forget it and sign a fresh one.
        urls.delete(n);
        if (attempt >= PART_TRIES) {
          throw new ServerRunError(
            `Storage refused part ${String(n)} (${String(response.status)}). Try again.`,
          );
        }
      } catch (error) {
        if (ctx.signal.aborted) throw aborted();
        if (error instanceof ServerRunError || attempt >= PART_TRIES) {
          throw error instanceof ServerRunError
            ? error
            : new ServerRunError(
                'The upload was interrupted. Check your connection and try again.',
              );
        }
        urls.delete(n);
      }
      await wait(1000 * attempt, ctx.signal);
    }
  }

  async function lane(): Promise<void> {
    while (next <= created.part_count) {
      const n = next;
      next += 1;
      await sendPart(n);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, created.part_count) }, lane));
    ctx.progress({ stage: 'Finishing the upload' });
    etags.sort((a, b) => a.n - b.n);
    await api(created.complete_url, { method: 'POST', body: { parts: etags }, signal: ctx.signal });
  } catch (error) {
    forget(`/api/v1/uploads/${created.upload_id}`, 'DELETE');
    throw error;
  }
  return created.upload_id;
}

/** Best effort, even as the page goes: cancel an upload or a job. */
function forget(path: string, method: 'DELETE' | 'POST') {
  void fetch(path, { method, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
}

interface Quote extends ServerQuote {
  status: 'ready';
  can_start: boolean;
  blocked_by?: string;
  free_jobs_left: number;
}

/** The server's price, once the worker has checked the file. */
async function quote(
  toolId: string,
  uploadId: string,
  options: Record<string, unknown>,
  ctx: ServerRunContext,
): Promise<Quote> {
  ctx.progress({ stage: 'Checking the file' });
  for (;;) {
    const { status, data } = await api<Quote | { status: 'probing' }>('/api/v1/jobs/quote', {
      method: 'POST',
      body: { tool_id: toolId, upload_id: uploadId, options },
      signal: ctx.signal,
    });
    if (status === 200 && data.status === 'ready') return data;
    await wait(1000, ctx.signal);
  }
}

/** Follows a job to its end: server-sent events, or polling if they don't get through. */
function follow(id: string, ctx: ServerRunContext): Promise<JobView> {
  return new Promise((resolve, reject) => {
    const source = new EventSource(`/api/v1/jobs/${id}/events`);
    let polling = false;
    const show = (job: Pick<JobView, 'status' | 'progress' | 'stage' | 'position'>) => {
      ctx.progress(
        job.status === 'queued'
          ? {
              stage: 'Waiting in line',
              step: job.position ? `${String(job.position)} ahead` : undefined,
            }
          : {
              stage: STAGES[job.stage ?? ''] ?? 'Working',
              fraction: job.progress / 100,
            },
      );
    };
    const finish = (job: JobView) => {
      source.close();
      resolve(job);
    };
    const poll = async () => {
      polling = true;
      try {
        for (;;) {
          const { data } = await api<{ job: JobView }>(`/api/v1/jobs/${id}`, {
            signal: ctx.signal,
          });
          if (!['queued', 'running'].includes(data.job.status)) {
            finish(data.job);
            return;
          }
          show(data.job);
          await wait(2000, ctx.signal);
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Lost track of the job'));
      }
    };
    ctx.signal.addEventListener(
      'abort',
      () => {
        source.close();
        forget(`/api/v1/jobs/${id}/cancel`, 'POST');
        reject(aborted());
      },
      { once: true },
    );
    source.addEventListener('progress', (event) => {
      show(JSON.parse((event as MessageEvent<string>).data) as JobView);
    });
    source.addEventListener('done', (event) => {
      finish(JSON.parse((event as MessageEvent<string>).data) as JobView);
    });
    source.addEventListener('error', () => {
      // EventSource retries by itself; once it gives up, poll instead.
      if (source.readyState === EventSource.CLOSED && !polling && !ctx.signal.aborted) {
        void poll();
      }
    });
  });
}

/** Downloads the result from storage, with progress. */
async function download(job: JobView, ctx: ServerRunContext): Promise<Blob> {
  const result = job.result;
  if (!result) throw new ServerRunError('The result has already been deleted. Run it again.');
  const response = await fetch(result.download_url, { signal: ctx.signal });
  if (!response.ok || !response.body) {
    throw new ServerRunError('The result couldn’t be downloaded. Try again from the start.');
  }
  const total = result.bytes ?? Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    ctx.progress({
      stage: 'Downloading the result',
      fraction: total ? received / total : undefined,
      amount: total ? `${formatBytes(received)} of ${formatBytes(total)}` : formatBytes(received),
    });
  }
  return new Blob(chunks, { type: result.content_type ?? 'application/octet-stream' });
}

/**
 * The ToolShell's server path for one tool: `toServer` turns the shell's
 * options into the tool's API options (@etb/registry/options). `files` are
 * `file` options whose file goes up as its own upload, its id in their place
 * (Burn Subtitles: `subtitles`).
 */
export function serverPath(
  toolId: string,
  info: ServerInfo,
  toServer: (options: Record<string, string>) => Record<string, unknown>,
  here: string,
  files: readonly { option: string; label: string }[] = [],
): ShellServer {
  return {
    price: info.price,
    maxBytes: info.maxBytes,
    signInHref: `/sign-in?next=${encodeURIComponent(here)}`,
    estimate: (durationSec) =>
      info.rule.kind === 'perMinute' && durationSec === undefined
        ? null
        : priceOf(info.rule, { durationMs: (durationSec ?? 0) * 1000 }),
    async account(): Promise<ServerAccount | null> {
      const response = await fetch('/api/v1/me', { credentials: 'same-origin' });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error('account unavailable');
      const me = (await response.json()) as {
        tier: 'free' | 'paid';
        credit_balance: number;
        free_jobs_left: number;
      };
      return { tier: me.tier, balance: me.credit_balance, freeJobsLeft: me.free_jobs_left };
    },
    async run(file, shellOptions, ctx): Promise<ServerResult> {
      for (const extra of files) {
        if (!shellOptions[extra.option]) {
          throw new ServerRunError(`Choose the ${extra.label} first`, 'Something’s missing');
        }
      }
      const uploadId = await upload(file, toolId, ctx);
      const values = { ...shellOptions };
      const extras: string[] = [];
      let offer: Quote;
      let options: Record<string, unknown>;
      try {
        for (const extra of files) {
          const chosen = fileOptionFile(shellOptions[extra.option] ?? '');
          if (!chosen)
            throw new ServerRunError(`Choose the ${extra.label} again`, 'Something’s missing');
          const id = await upload(chosen, toolId, ctx, `Uploading the ${extra.label}`);
          values[extra.option] = id;
          extras.push(id);
        }
        options = toServer(values);
        offer = await quote(toolId, uploadId, options, ctx);
        if (!offer.can_start) {
          throw new ServerRunError(
            offer.blocked_by === 'QUOTA_EXCEEDED'
              ? `No free server jobs left today, and this needs ${String(offer.credits)} credits; you have ${String(offer.balance)}`
              : `This needs ${String(offer.credits)} credits; you have ${String(offer.balance)}`,
            'Not enough credits',
          );
        }
        const asExpected =
          offer.funding !== 'credits' ||
          (!ctx.offered.free && ctx.offered.credits === offer.credits);
        if (!asExpected && !(await ctx.confirm(offer))) throw aborted();
      } catch (error) {
        for (const id of [uploadId, ...extras]) forget(`/api/v1/uploads/${id}`, 'DELETE');
        throw error;
      }
      const { data } = await api<{ job: JobView }>('/api/v1/jobs', {
        method: 'POST',
        body: { tool_id: toolId, upload_id: uploadId, options, quote_credits: offer.credits },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        signal: ctx.signal,
      });
      const job = await follow(data.job.id, ctx);
      if (job.status !== 'succeeded') {
        throw new ServerRunError(
          job.error?.detail ?? 'It stopped before it finished',
          job.status === 'cancelled' ? 'Cancelled' : 'Our servers couldn’t do this',
          job.error?.credits_returned ?? false,
        );
      }
      const blob = await download(job, ctx);
      return {
        blob,
        ext: job.result?.ext ?? 'bin',
        notes: job.result?.notes,
        width: job.result?.width ?? undefined,
        height: job.result?.height ?? undefined,
      };
    },
  };
}
