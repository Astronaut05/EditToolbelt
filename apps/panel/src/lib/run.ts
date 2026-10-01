/**
 * A server tool from the panel (docs/06 → Flow): upload the clip (and any
 * other file a tool takes) → get the price → the user confirms → run the job
 * → follow it → download the result → into the project. Each step tells the
 * panel where it is; cancelling stops wherever it is.
 */
import type { Client, Job, ReadyQuote } from '@etb/api-client';

import type { Host, PickedFile } from '../host/types';
import { resultName } from './tools';

export type Stage =
  | { stage: 'uploading'; name: string; sent: number; total: number }
  | { stage: 'checking' }
  | { stage: 'running'; job: Job }
  | { stage: 'importing' };

export interface Prepared {
  uploadId: string;
  quote: ReadyQuote;
  options: Record<string, unknown>;
}

type JobClient = Pick<Client, 'uploadFile' | 'readyQuote' | 'createJob' | 'finished' | 'cancelJob'>;

/** Uploads the clip and the other files, and answers the price. */
export async function prepare(
  client: JobClient,
  toolId: string,
  file: PickedFile,
  extra: Record<string, PickedFile>,
  options: Record<string, unknown>,
  hooks: { signal?: AbortSignal; onStage: (stage: Stage) => void },
): Promise<Prepared> {
  const upload = (picked: PickedFile) =>
    client.uploadFile(picked, toolId, picked.type, {
      signal: hooks.signal,
      onProgress: ({ sent, total }) => {
        hooks.onStage({ stage: 'uploading', name: picked.name, sent, total });
      },
    });
  const filled = { ...options };
  for (const [name, picked] of Object.entries(extra)) filled[name] = await upload(picked);
  const uploadId = await upload(file);
  hooks.onStage({ stage: 'checking' });
  const quote = await client.readyQuote(
    { tool_id: toolId, upload_id: uploadId, options: filled },
    hooks.signal,
  );
  return { uploadId, quote, options: quote.options };
}

/** What a finished job left: the result's name and where it went, and the notes. */
export interface Done {
  name: string;
  message: string;
  notes: string[];
  credits: number;
}

export class JobFailed extends Error {
  constructor(
    message: string,
    readonly creditsReturned: boolean,
  ) {
    super(message);
    this.name = 'JobFailed';
  }
}

const EXT_FOR_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'image/png': 'png',
  'application/x-subrip': 'srt',
  'text/vtt': 'vtt',
};

/** Runs the job the user confirmed, follows it, and puts the result in the project. */
export async function run(
  client: JobClient,
  host: Pick<Host, 'importResult'>,
  toolId: string,
  clipName: string,
  prepared: Prepared,
  hooks: {
    signal?: AbortSignal;
    onStage: (stage: Stage) => void;
    fetch?: typeof fetch;
    idempotencyKey?: string;
  },
): Promise<Done> {
  const created = await client.createJob(
    {
      tool_id: toolId,
      upload_id: prepared.uploadId,
      options: prepared.options,
      quote_credits: prepared.quote.credits,
    },
    hooks.idempotencyKey ?? crypto.randomUUID(),
    hooks.signal,
  );
  hooks.onStage({ stage: 'running', job: created });
  const onAbort = () => {
    void client.cancelJob(created.id).catch(() => undefined);
  };
  hooks.signal?.addEventListener('abort', onAbort, { once: true });
  let job: Job;
  try {
    job = await client.finished(created.id, {
      signal: hooks.signal,
      onProgress: (latest) => {
        hooks.onStage({ stage: 'running', job: latest });
      },
    });
  } finally {
    hooks.signal?.removeEventListener('abort', onAbort);
  }
  if (job.status !== 'succeeded' || !job.result || 'expired' in job.result) {
    const returned = job.error?.credits_returned ?? job.status !== 'succeeded';
    const why =
      job.error?.detail ??
      (job.status === 'succeeded' ? 'Its result has expired.' : `The job ${job.status}.`);
    throw new JobFailed(why, returned);
  }
  const result = job.result;
  hooks.onStage({ stage: 'importing' });
  const response = await (hooks.fetch ?? fetch)(result.download_url, { signal: hooks.signal });
  if (!response.ok)
    throw new Error(`The result couldn’t be downloaded (HTTP ${String(response.status)}).`);
  const blob = await response.blob();
  const ext = result.ext ?? EXT_FOR_TYPE[result.content_type ?? ''] ?? 'bin';
  const name = resultName(clipName, toolId, ext);
  const message = await host.importResult(blob, name);
  return { name, message, notes: result.notes, credits: job.credits_charged };
}
