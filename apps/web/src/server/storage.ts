/**
 * Object storage for the server build (docs/01 → Upload, docs/11 → Storage).
 *
 * The bucket is private. The server talks S3 to it (create, complete and
 * abort multipart uploads, check and delete objects); browsers only ever get
 * URLs presigned for one part of one key, or one download, valid for minutes.
 * Upload part URLs sign the part's exact length, so a browser can't send more.
 * aws4fetch does the SigV4 signing; the S3 calls are plain REST, path-style,
 * which R2 and Versity S3 Gateway both accept.
 */
import { AwsClient } from 'aws4fetch';

import { PART_URL_TTL_SEC } from '@etb/core/upload';

import { serverEnv } from './env';

/** Download URLs expire after 10 minutes (docs/11 → Storage). */
export const DOWNLOAD_URL_TTL_SEC = 10 * 60;

/** A storage call failed; `status` is the HTTP status storage answered with (0: unreachable). */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CompletedPart {
  n: number;
  etag: string;
}

let signer: AwsClient | undefined;

function aws(): AwsClient {
  const env = serverEnv();
  signer ??= new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    service: 's3',
    region: env.S3_REGION,
  });
  return signer;
}

/** `<endpoint>/<bucket>/<key>`, each key segment encoded. */
function objectUrl(key: string, endpoint = serverEnv().S3_ENDPOINT): URL {
  const base = endpoint.replace(/\/+$/, '');
  const path = key.split('/').map(encodeURIComponent).join('/');
  return new URL(`${base}/${serverEnv().S3_BUCKET}/${path}`);
}

function publicEndpoint(): string {
  const env = serverEnv();
  return env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
}

async function call(method: string, url: URL, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await aws().fetch(url.toString(), { ...init, method });
  } catch {
    throw new StorageError(`${method} storage: unreachable`, 0);
  }
  if (!response.ok) {
    // S3 errors are XML with a Code; never echo keys or signatures anywhere.
    const code = /<Code>([^<]+)<\/Code>/.exec(await response.text())?.[1] ?? 'unknown';
    throw new StorageError(
      `${method} storage: ${String(response.status)} ${code}`,
      response.status,
    );
  }
  return response;
}

/** Starts a multipart upload; returns storage's upload id. */
export async function createMultipart(key: string, contentType: string): Promise<string> {
  const url = objectUrl(key);
  url.search = 'uploads';
  const response = await call('POST', url, { headers: { 'Content-Type': contentType } });
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await response.text())?.[1];
  if (!uploadId) throw new StorageError('POST storage: no UploadId in the answer', 502);
  return uploadId;
}

/** A PUT URL for part `n` (1-based) that only accepts exactly `bytes` bytes. */
export async function presignPart(
  key: string,
  uploadId: string,
  n: number,
  bytes: number,
): Promise<string> {
  const url = objectUrl(key, publicEndpoint());
  url.searchParams.set('partNumber', String(n));
  url.searchParams.set('uploadId', uploadId);
  url.searchParams.set('X-Amz-Expires', String(PART_URL_TTL_SEC));
  const signed = await aws().sign(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Length': String(bytes) },
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

const ETAG = /^"?[0-9A-Za-z-]{1,128}"?$/;

/** The CompleteMultipartUpload body; part numbers ascending, ETags checked and quoted. */
export function completeBody(parts: readonly CompletedPart[]): string {
  const rows = [...parts]
    .sort((a, b) => a.n - b.n)
    .map(({ n, etag }) => {
      if (!ETAG.test(etag)) throw new StorageError('complete: malformed ETag', 400);
      const quoted = etag.startsWith('"') ? etag : `"${etag}"`;
      return `<Part><PartNumber>${String(n)}</PartNumber><ETag>${quoted.replaceAll('"', '&quot;')}</ETag></Part>`;
    });
  return `<CompleteMultipartUpload>${rows.join('')}</CompleteMultipartUpload>`;
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: readonly CompletedPart[],
): Promise<void> {
  const url = objectUrl(key);
  url.searchParams.set('uploadId', uploadId);
  const response = await call('POST', url, {
    headers: { 'Content-Type': 'application/xml' },
    body: completeBody(parts),
  });
  // S3 can answer 200 and still report an error in the body.
  const text = await response.text();
  const code = /<Error>[\s\S]*?<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  if (code) throw new StorageError(`complete: ${code}`, 400);
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  const url = objectUrl(key);
  url.searchParams.set('uploadId', uploadId);
  try {
    await call('DELETE', url);
  } catch (error) {
    // Already gone is fine.
    if (!(error instanceof StorageError && error.status === 404)) throw error;
  }
}

/** The object's size in bytes, or null when there is no such object. */
export async function headObject(key: string): Promise<{ bytes: number } | null> {
  try {
    const response = await call('HEAD', objectUrl(key));
    return { bytes: Number(response.headers.get('content-length') ?? Number.NaN) };
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) return null;
    throw error;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await call('DELETE', objectUrl(key));
}

/** A GET URL for 10 minutes; `filename` sets the download name the browser offers. */
export async function presignDownload(key: string, filename?: string): Promise<string> {
  const url = objectUrl(key, publicEndpoint());
  url.searchParams.set('X-Amz-Expires', String(DOWNLOAD_URL_TTL_SEC));
  if (filename) {
    url.searchParams.set(
      'response-content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
  }
  const signed = await aws().sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

/** For /readyz: the bucket answers. */
export async function storageReady(): Promise<boolean> {
  const env = serverEnv();
  try {
    await call('HEAD', new URL(`${env.S3_ENDPOINT.replace(/\/+$/, '')}/${env.S3_BUCKET}`));
    return true;
  } catch {
    return false;
  }
}
