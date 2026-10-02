#!/usr/bin/env node
// Runs any EditToolbelt server tool with only an API key, as /developers
// describes: upload in parts, price, start, follow, download.
//
//   ETB_API=https://<site>/api/v1 ETB_KEY=etb_live_... \
//     node run-tool.mjs <tool-id> <file> ['<options as JSON>'] [<output file>]
//
//   node run-tool.mjs compress-video clip.mov '{"mode":"size","targetMb":25}'
//   node run-tool.mjs burn-subtitles clip.mp4 '{"subtitles":"@clip.srt"}'
//   node run-tool.mjs merge-videos a.mp4 '{"clips":["@b.mp4","@c.mp4"]}'
//
// An option written "@path" is a file that goes up as its own upload, its id
// in its place; so is each "@path" in a list, in order. Options for each
// tool: GET /tools/<tool-id>. Node 20 or newer; no packages. Prints the
// result's file name.

/* global console, fetch, process, setTimeout */
import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const [toolId, input, optionsJson = '{}', output] = process.argv.slice(2);
const API = (process.env.ETB_API ?? '').replace(/\/$/, '');
const KEY = process.env.ETB_KEY ?? '';
if (!toolId || !input || !API || !KEY) {
  console.error('usage: ETB_API=… ETB_KEY=… node run-tool.mjs <tool-id> <file> [options] [output]');
  process.exit(2);
}

// The type each extension is sent as; the tool says what it takes
// (GET /tools/<tool-id> → accepts), and our servers check the file itself.
const TYPES = {
  // Video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  wmv: 'video/x-ms-wmv',
  mxf: 'application/mxf',
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  weba: 'audio/webm',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  // Subtitles
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
};
const PARALLEL = 4;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (text) => process.stderr.write(`${text}\n`);

/** A JSON call with the key; a problem answer throws with its code and words. */
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${data?.code ?? response.status}: ${data?.detail ?? data?.title ?? ''}`);
  }
  return { status: response.status, data };
}

/** Uploads a file in 8 MiB parts, straight to storage; answers the upload id. */
async function upload(path) {
  const file = await openAsBlob(path);
  const mime = TYPES[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream';
  const { data: started } = await api('/uploads', {
    method: 'POST',
    body: { tool_id: toolId, bytes: file.size, mime },
  });
  const urls = new Map(started.parts.map((part) => [part.n, part.url]));
  const fresh = async (n) => {
    const { data } = await api(`/uploads/${started.upload_id}/parts`, {
      method: 'POST',
      body: { from: n, count: 50 },
    });
    for (const part of data.parts) urls.set(part.n, part.url);
  };
  const etags = [];
  let next = 1;
  let sent = 0;
  async function lane() {
    while (next <= started.part_count) {
      const n = next++;
      const from = (n - 1) * started.part_size;
      const part = file.slice(from, Math.min(file.size, from + started.part_size));
      for (let attempt = 1; ; attempt += 1) {
        // Part URLs last 15 minutes: a missing or refused one is signed again.
        if (!urls.has(n)) await fresh(n);
        const response = await fetch(urls.get(n), { method: 'PUT', body: part });
        if (response.ok) {
          etags.push({ n, etag: response.headers.get('etag') });
          break;
        }
        urls.delete(n);
        if (attempt === 3) throw new Error(`storage refused part ${n} (${response.status})`);
      }
      sent += part.size;
      process.stderr.write(
        `\ruploading ${basename(path)}: ${Math.floor((sent / file.size) * 100)}%`,
      );
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, started.part_count) }, lane));
    process.stderr.write('\n');
    etags.sort((a, b) => a.n - b.n);
    await api(`/uploads/${started.upload_id}/complete`, { method: 'POST', body: { parts: etags } });
  } catch (error) {
    await api(`/uploads/${started.upload_id}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
  return started.upload_id;
}

async function main() {
  const uploadId = await upload(input);
  const options = JSON.parse(optionsJson);
  const file = async (value) =>
    typeof value === 'string' && value.startsWith('@') ? upload(value.slice(1)) : value;
  for (const [name, value] of Object.entries(options)) {
    if (!Array.isArray(value)) {
      options[name] = await file(value);
      continue;
    }
    // One after another: an account may have only a few uploads open at once.
    const ids = [];
    for (const item of value) ids.push(await file(item));
    options[name] = ids;
  }

  say('checking the file…');
  let quote;
  for (;;) {
    ({ data: quote } = await api('/jobs/quote', {
      method: 'POST',
      body: { tool_id: toolId, upload_id: uploadId, options },
    }));
    if (quote.status === 'ready') break;
    await sleep(1000);
  }
  if (!quote.can_start) throw new Error(`${quote.blocked_by}: it costs ${quote.credits} credits`);
  // The balance and free jobs left come only with a key that has account:read.
  say(
    quote.funding === 'credits'
      ? `price: ${quote.credits} credits${quote.balance_after === undefined ? '' : ` (balance after: ${quote.balance_after})`}`
      : quote.funding === 'daily'
        ? `price: one of today's free jobs${quote.free_jobs_left === undefined ? '' : ` (${quote.free_jobs_left} left)`}`
        : 'price: free',
  );

  let {
    data: { job },
  } = await api('/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { tool_id: toolId, upload_id: uploadId, options, quote_credits: quote.credits },
  });
  while (job.status === 'queued' || job.status === 'running') {
    process.stderr.write(
      `\r${job.status === 'queued' ? `waiting in line (${job.position ?? 0} ahead)` : `${job.stage ?? 'working'}: ${job.progress}%`}   `,
    );
    await sleep(2000);
    ({
      data: { job },
    } = await api(`/jobs/${job.id}`));
  }
  process.stderr.write('\n');
  if (job.status !== 'succeeded') {
    throw new Error(`${job.status}: ${job.error?.detail ?? 'it stopped before it finished'}`);
  }
  for (const note of job.result.notes ?? []) say(note);

  const name = output ?? `${basename(input, extname(input))}-${toolId}.${job.result.ext ?? 'bin'}`;
  const download = await fetch(job.result.download_url);
  if (!download.ok || !download.body) throw new Error(`download failed (${download.status})`);
  await pipeline(Readable.fromWeb(download.body), createWriteStream(name));
  console.log(name);
}

main().catch((error) => {
  say(`error: ${error.message}`);
  process.exit(1);
});
