/**
 * Model files for the in-browser AI tools (P07, P12): read from the models
 * cache, or downloaded into it with progress and checked against their
 * pinned SHA-256 before anything runs them.
 */
import { EngineAbortError } from '../dummy';

export async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !('subtle' in crypto)) return null;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ModelUnavailable extends Error {}

/** One file from the models cache, or downloaded into it with progress. */
export async function fetchCached(
  url: string,
  cache: Cache | null,
  signal: AbortSignal,
  onBytes: (loaded: number) => void,
  expected?: string | null,
): Promise<ArrayBuffer> {
  const hit = await cache?.match(url);
  if (hit) {
    const bytes = await hit.arrayBuffer();
    onBytes(bytes.byteLength);
    return bytes;
  }
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw new EngineAbortError();
    throw new ModelUnavailable(error instanceof Error ? error.message : 'network error');
  }
  if (!response.ok || !response.body) {
    throw new ModelUnavailable(`HTTP ${String(response.status)}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (expected) {
    const actual = await sha256(bytes.buffer);
    if (actual && actual !== expected) {
      throw new ModelUnavailable('the file doesn’t match its checksum');
    }
  }
  await cache
    ?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }))
    .catch(() => undefined);
  return bytes.buffer;
}
