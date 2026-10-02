/**
 * The server path of a hybrid tool, from the browser (docs/06 → Job
 * lifecycle): upload the parts straight to storage, ask for the server's
 * price, start the job, follow it, and download the result. The ToolShell
 * shows each stage and asks before anything is sent.
 *
 * The file's name never leaves the page: the API gets its size and type, and
 * the result is named here, from the original (docs/02 → Output naming).
 */
import { ApiError, createClient, type Job, type ReadyQuote } from '@etb/api-client';
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

/** The site's own API, with its session cookie. */
const client = createClient();

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
  joining: 'Joining',
  encoding: 'Re-encoding',
  uploading: 'Saving the result',
  done: 'Saving the result',
};

function aborted(): DOMException {
  return new DOMException('Cancelled', 'AbortError');
}

/** A call to our API; a problem answer becomes a ServerRunError in its own words. */
async function api<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 401) {
      throw new ServerRunError('Sign in again to use our servers', 'You’re signed out');
    }
    throw new ServerRunError(error.detail ?? error.title, error.title);
  }
}

/**
 * Uploads the file in parts, several at once, straight to storage. One of
 * several files (`batch`) shows the bytes sent of them all, and which file.
 */
async function upload(
  file: File,
  toolId: string,
  ctx: ServerRunContext,
  stage = 'Uploading',
  batch?: { before: number; total: number; step: string },
): Promise<string> {
  // By extension first: browsers type subtitle files inconsistently, if at all.
  const type = TYPE_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? file.type;
  try {
    return await api(() =>
      client.uploadFile(file, toolId, type, {
        signal: ctx.signal,
        parallel: PARALLEL_PARTS,
        onProgress: ({ sent: own, total: size }) => {
          const sent = (batch?.before ?? 0) + own;
          const total = batch?.total ?? size;
          ctx.progress(
            own === size && size > 0
              ? { stage: 'Finishing the upload', step: batch?.step }
              : {
                  stage,
                  fraction: total ? sent / total : 0,
                  amount: `${formatBytes(sent)} of ${formatBytes(total)}`,
                  step: batch?.step,
                },
          );
        },
      }),
    );
  } catch (error) {
    if (ctx.signal.aborted) throw aborted();
    if (error instanceof ServerRunError) throw error;
    throw new ServerRunError('The upload was interrupted. Check your connection and try again.');
  }
}

/** Best effort, even as the page goes: cancel an upload or a job. */
function forget(path: string, method: 'DELETE' | 'POST') {
  void fetch(path, { method, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
}

/** The server's price, once the worker has checked the file. */
async function quote(
  toolId: string,
  uploadId: string,
  options: Record<string, unknown>,
  ctx: ServerRunContext,
): Promise<ReadyQuote & ServerQuote> {
  ctx.progress({ stage: 'Checking the file' });
  return api(() =>
    client.readyQuote({ tool_id: toolId, upload_id: uploadId, options }, ctx.signal),
  );
}

/** Follows a job to its end: server-sent events, or polling if they don't get through. */
function follow(id: string, ctx: ServerRunContext): Promise<Job> {
  return new Promise((resolve, reject) => {
    const source = new EventSource(`/api/v1/jobs/${id}/events`);
    let polling = false;
    const show = (job: Pick<Job, 'status' | 'progress' | 'stage' | 'position'>) => {
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
    const finish = (job: Job) => {
      source.close();
      resolve(job);
    };
    const poll = async () => {
      polling = true;
      try {
        finish(await api(() => client.finished(id, { signal: ctx.signal, onProgress: show })));
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
      show(JSON.parse((event as MessageEvent<string>).data) as Job);
    });
    source.addEventListener('done', (event) => {
      finish(JSON.parse((event as MessageEvent<string>).data) as Job);
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
async function download(job: Job, ctx: ServerRunContext): Promise<Blob> {
  const result = job.result;
  if (!result || !('download_url' in result))
    throw new ServerRunError('The result has already been deleted. Run it again.');
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
 * (Burn Subtitles: `subtitles`). `joined` is the option that takes the
 * shell's other files to join, in order, by their upload ids (Merge Videos:
 * `clips`); the first file is the job's own upload.
 */
export function serverPath(
  toolId: string,
  info: ServerInfo,
  toServer: (options: Record<string, string>) => Record<string, unknown>,
  here: string,
  files: readonly { option: string; label: string }[] = [],
  joined?: string,
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
      try {
        const me = await client.me();
        return { tier: me.tier, balance: me.credit_balance, freeJobsLeft: me.free_jobs_left };
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    async run(file, shellOptions, ctx): Promise<ServerResult> {
      for (const extra of files) {
        if (!shellOptions[extra.option]) {
          throw new ServerRunError(`Choose the ${extra.label} first`, 'Something’s missing');
        }
      }
      const all = joined && ctx.files?.length ? ctx.files : [file];
      const total = all.reduce((sum, one) => sum + one.size, 0);
      const values = { ...shellOptions };
      // Every upload made, so a failure or a "Not now" deletes them all.
      const extras: string[] = [];
      let uploadId = '';
      let offer: ReadyQuote & ServerQuote;
      let options: Record<string, unknown>;
      try {
        // One after another: an account may have only a few uploads open at once.
        let before = 0;
        for (const [i, one] of all.entries()) {
          const step = `File ${String(i + 1)} of ${String(all.length)}`;
          const batch = all.length > 1 ? { before, total, step } : undefined;
          const id = await upload(one, toolId, ctx, 'Uploading', batch);
          if (i === 0) uploadId = id;
          else extras.push(id);
          before += one.size;
        }
        const clips = [...extras];
        for (const extra of files) {
          const chosen = fileOptionFile(shellOptions[extra.option] ?? '');
          if (!chosen)
            throw new ServerRunError(`Choose the ${extra.label} again`, 'Something’s missing');
          const id = await upload(chosen, toolId, ctx, `Uploading the ${extra.label}`);
          values[extra.option] = id;
          extras.push(id);
        }
        options = { ...toServer(values), ...(joined && { [joined]: clips }) };
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
        for (const id of [uploadId, ...extras].filter(Boolean)) {
          forget(`/api/v1/uploads/${id}`, 'DELETE');
        }
        throw error;
      }
      const started = await api(() =>
        client.createJob(
          { tool_id: toolId, upload_id: uploadId, options, quote_credits: offer.credits },
          crypto.randomUUID(),
          ctx.signal,
        ),
      );
      const job = await follow(started.id, ctx);
      if (job.status !== 'succeeded') {
        throw new ServerRunError(
          job.error?.detail ?? 'It stopped before it finished',
          job.status === 'cancelled' ? 'Cancelled' : 'Our servers couldn’t do this',
          job.error?.credits_returned ?? false,
        );
      }
      const blob = await download(job, ctx);
      const result = job.result && 'ext' in job.result ? job.result : null;
      return {
        blob,
        ext: result?.ext ?? 'bin',
        notes: result?.notes,
        width: result?.width ?? undefined,
        height: result?.height ?? undefined,
      };
    },
  };
}
