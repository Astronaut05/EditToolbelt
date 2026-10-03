import type { ImageHeader } from '../image/image-header';

/** `imageHeader` (../image/image-header), loaded with the first image a page reads. */
export async function imageHeader(file: Blob, name?: string): Promise<ImageHeader> {
  const loaded = await import('../image/image-header');
  return loaded.imageHeader(file, name);
}
