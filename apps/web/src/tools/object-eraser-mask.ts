/**
 * Object Eraser's mask (tools/photo.md → P17), drawn in the browser from the
 * brush strokes: a PNG, white where to erase and black elsewhere, sent beside
 * the photo. Strokes are in the photo's px; a photo over 16 MP gets a mask of
 * the same shape scaled down to 16 MP (what every browser's canvas takes,
 * Safari's included), which the GPU function scales back up.
 */
import { drawStrokes, type MaskStroke, type StrokeTarget } from '@etb/ui';

/** The largest mask drawn, in pixels. */
export const MAX_MASK_PIXELS = 16_000_000;

export interface MaskSize {
  width: number;
  height: number;
  /** Mask px per photo px (1, or less for a big photo). */
  scale: number;
}

/** The mask's size for a photo: the same, or the same shape at 16 MP. */
export function maskSize(width: number, height: number): MaskSize {
  const scale = Math.min(1, Math.sqrt(MAX_MASK_PIXELS / Math.max(1, width * height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Whether the strokes mark anything to erase (Unmark alone marks nothing). */
export function marksSomething(strokes: readonly MaskStroke[]): boolean {
  return strokes.some((stroke) => stroke.mode === 'mark');
}

/** Paints the mask: black, then each stroke in order, white where marked, black where unmarked. */
export function paintMask(
  target: StrokeTarget & { fillRect(x: number, y: number, w: number, h: number): void },
  strokes: readonly MaskStroke[],
  size: MaskSize,
): void {
  target.globalCompositeOperation = 'source-over';
  target.globalAlpha = 1;
  target.fillStyle = '#000000';
  target.fillRect(0, 0, size.width, size.height);
  drawStrokes(
    target,
    strokes,
    { mark: { colour: '#ffffff' }, unmark: { colour: '#000000' } },
    size.scale,
  );
}

/** The mask as a PNG file, for a photo of `width` × `height` px as shown. */
export async function renderMask(
  strokes: readonly MaskStroke[],
  width: number,
  height: number,
): Promise<File> {
  const size = maskSize(width, height);
  let blob: Blob | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    paintMask(ctx, strokes, size);
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    paintMask(ctx, strokes, size);
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
  }
  if (!blob) throw new Error('the mask wasn’t drawn');
  return new File([blob], 'mask.png', { type: 'image/png' });
}
