/**
 * P11 Watermark Images, the drawing (in the image worker): a text or a logo
 * mark laid on the pixels at its place, or tiled over the whole image, at
 * an opacity. Sizes are shares of the image's width (@etb/core/watermark),
 * so a batch of different sizes gets the same look.
 */
import { markBox, tileBoxes, type Anchor } from '@etb/core/watermark';

export interface WatermarkJob {
  /** The logo's file bytes, or the text to write. */
  logo?: ArrayBuffer;
  text?: string;
  /** Text colour, "#rrggbb". */
  color: string;
  anchor: Anchor;
  /** Shares of the image's width: the mark's width, the edge gap, the tile spacing. */
  size: number;
  margin: number;
  offsetX: number;
  offsetY: number;
  /** 0-1. */
  opacity: number;
  tile: boolean;
}

/** Text drawn this big to measure it; the mark is then scaled to its box. */
const TEXT_PX = 200;

/** The mark as a canvas or bitmap, with its height ÷ width. */
async function markOf(job: WatermarkJob): Promise<{ source: CanvasImageSource; aspect: number }> {
  if (job.logo) {
    const bitmap = await createImageBitmap(new Blob([job.logo]));
    return { source: bitmap, aspect: bitmap.height / bitmap.width };
  }
  const text = (job.text ?? '').trim() || '©';
  const probe = new OffscreenCanvas(1, 1).getContext('2d');
  if (!probe) throw new Error('No 2D canvas in this browser');
  const font = `600 ${String(TEXT_PX)}px sans-serif`;
  probe.font = font;
  const metrics = probe.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || TEXT_PX * 0.8;
  const descent = metrics.actualBoundingBoxDescent || TEXT_PX * 0.2;
  const pad = Math.round(TEXT_PX * 0.05);
  const width = Math.ceil(metrics.width) + pad * 2;
  const height = Math.ceil(ascent + descent) + pad * 2;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.font = font;
  ctx.fillStyle = job.color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, pad, pad + ascent);
  return { source: canvas, aspect: height / width };
}

/** The image with the watermark drawn on it, and what was done, for the notes. */
export async function drawWatermark(
  image: ImageData,
  job: WatermarkJob,
): Promise<{ image: ImageData; note: string }> {
  const { source, aspect } = await markOf(job);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.putImageData(image, 0, 0);
  ctx.globalAlpha = Math.min(1, Math.max(0, job.opacity));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const boxes = job.tile
    ? tileBoxes(image.width, image.height, aspect, job.size, job.size / 2)
    : [
        markBox(image.width, image.height, aspect, {
          anchor: job.anchor,
          size: job.size,
          margin: job.margin,
          offsetX: job.offsetX,
          offsetY: job.offsetY,
        }),
      ];
  for (const box of boxes) ctx.drawImage(source, box.x, box.y, box.width, box.height);
  if ('close' in source && typeof source.close === 'function') source.close();
  const first = boxes[0];
  const note = job.tile
    ? `${job.logo ? 'Logo' : 'Text'} tiled ${String(boxes.length)} times at ${String(Math.round(job.opacity * 100))}%`
    : `${job.logo ? 'Logo' : 'Text'} ${String(first?.width ?? 0)} × ${String(first?.height ?? 0)} px at ${String(Math.round(job.opacity * 100))}%`;
  return { image: ctx.getImageData(0, 0, image.width, image.height), note };
}
