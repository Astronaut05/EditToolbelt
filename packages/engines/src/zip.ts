/**
 * A ZIP written as its files arrive, stored without compression (fflate's
 * streaming `Zip`). Each file's bytes go into the archive's Blob as soon as
 * they are added, so only the file being added is held as an array: the
 * browser keeps the rest, and can move a large Blob out of memory.
 */
import { Zip, ZipPassThrough } from 'fflate';

/**
 * The most a ZIP made in the browser holds. fflate writes no ZIP64, so sizes
 * and offsets must stay under 4 GB; 2 GB is also the browser limit for video
 * (`VIDEO_LIMITS`).
 */
export const ZIP_MAX_BYTES = 2 * 1024 ** 3;

export class ZipTooLargeError extends Error {}

export class StoredZip {
  private readonly zip: Zip;
  private readonly parts: Blob[] = [];
  private chunks: Uint8Array[] = [];
  private failed: Error | null = null;
  private names = new Set<string>();
  /** The files' bytes so far. */
  bytes = 0;
  files = 0;

  constructor(private readonly maxBytes = ZIP_MAX_BYTES) {
    this.zip = new Zip((error, chunk) => {
      if (error) this.failed = error;
      else this.chunks.push(chunk);
    });
  }

  /** Whether `bytes` more would still fit. */
  fits(bytes: number): boolean {
    return this.bytes + bytes <= this.maxBytes;
  }

  /** Adds a file; a name already used gets "-2", "-3" … before its extension. */
  add(name: string, data: Uint8Array): void {
    if (!this.fits(data.byteLength)) {
      throw new ZipTooLargeError(`A ZIP made here holds up to ${String(this.maxBytes)} bytes.`);
    }
    let unique = name;
    for (let n = 2; this.names.has(unique); n += 1) {
      unique = name.replace(/(\.[^.]+)?$/, `-${String(n)}$1`);
    }
    this.names.add(unique);
    const entry = new ZipPassThrough(unique);
    this.zip.add(entry);
    entry.push(data, true);
    this.bytes += data.byteLength;
    this.files += 1;
    this.flush();
  }

  /** The archive, once every file is in. */
  finish(): Blob {
    this.zip.end();
    this.flush();
    if (this.failed) throw this.failed;
    return new Blob(this.parts, { type: 'application/zip' });
  }

  /** Hands what's written to a Blob, so the arrays can go. */
  private flush(): void {
    if (this.failed) throw this.failed;
    if (this.chunks.length === 0) return;
    this.parts.push(new Blob(this.chunks as Uint8Array<ArrayBuffer>[]));
    this.chunks = [];
  }
}
