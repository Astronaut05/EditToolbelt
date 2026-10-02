/**
 * V09 Resize & Crop Video for Social (tools/video.md): a video made to a
 * platform's size. Fill crops the largest window of that shape, placed where
 * the framing sliders say, and scales it; Fit keeps the whole picture on a
 * blurred copy of itself or a colour. Sound is copied.
 */
import { Quality, VideoSample } from 'mediabunny';

import { focusCrop } from '../image/social';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { convert, MediaInputError, openInput } from './media';
import { containerFormat, sourceFamily } from './trim';

export interface ReframeOptions {
  /** "1080x1920", or "custom" with `width` and `height`. */
  size?: string;
  width?: string;
  height?: string;
  /** fill, blur or color. */
  fit?: string;
  /** Fit with colour: "#rrggbb". */
  color?: string;
  /** Fill: where the window sits, 0-100 across and down. */
  x?: string;
  y?: string;
}

/** Even, as H.264 needs, and within what browsers encode. */
const even = (value: number) => Math.max(2, Math.min(4096, Math.round(value / 2) * 2));

export function targetOf(opts: ReframeOptions): { width: number; height: number } {
  const [w, h] =
    opts.size && opts.size !== 'custom'
      ? opts.size.split('x').map(Number)
      : [Number(opts.width), Number(opts.height)];
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) {
    throw new MediaInputError('Enter the width and height in px.');
  }
  return { width: even(w), height: even(h) };
}

const share = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0.5;
};

/**
 * Draws one frame fitted on its background: the colour, or the frame itself
 * filling the size and blurred. The blur is a scale down to a 40th of the
 * width, then back up in three steps, each smoothing the last: soft whatever
 * the source's size, and the same in every browser.
 */
function fitter(width: number, height: number, background: { blur: true } | { color: string }) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  const steps = [40, 12, 4].map((divisor) => {
    const step = new OffscreenCanvas(
      Math.max(4, Math.round(width / divisor)),
      Math.max(4, Math.round(height / divisor)),
    );
    const stepCtx = step.getContext('2d');
    if (!stepCtx) throw new Error('No 2D canvas in this browser');
    return { step, stepCtx };
  });
  for (const c of [ctx, ...steps.map((s) => s.stepCtx)]) {
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
  }
  return (sample: VideoSample) => {
    if ('blur' in background) {
      const [first, ...rest] = steps;
      if (first) sample.drawWithFit(first.stepCtx, { fit: 'cover' });
      let from = first?.step;
      for (const { step, stepCtx } of rest) {
        if (from) stepCtx.drawImage(from, 0, 0, step.width, step.height);
        from = step;
      }
      if (from) ctx.drawImage(from, 0, 0, width, height);
    } else {
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, width, height);
    }
    sample.drawWithFit(ctx, { fit: 'contain' });
    return new VideoSample(canvas, { timestamp: sample.timestamp, duration: sample.duration });
  };
}

export const reframeEngine: Engine<ReframeOptions> = {
  ...MEDIA_META.reframe,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const target = targetOf(opts);
    const fit = opts.fit === 'blur' || opts.fit === 'color' ? opts.fit : 'fill';
    const color = /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? (opts.color ?? '#000000') : '#000000';
    const input = openInput(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new MediaInputError('This file has no video in it.');
      const source = {
        width: await video.getDisplayWidth(),
        height: await video.getDisplayHeight(),
      };
      const family = await sourceFamily(input);
      const crop =
        fit === 'fill'
          ? focusCrop(source, target, { x: share(opts.x), y: share(opts.y) })
          : undefined;
      const out = await convert(
        {
          input,
          format: containerFormat(family),
          video: {
            forceTranscode: true,
            allowTransformationMetadata: false,
            quality: new Quality('high'),
            ...(crop
              ? {
                  crop: { left: crop.x, top: crop.y, width: crop.width, height: crop.height },
                  width: target.width,
                  height: target.height,
                  fit: 'cover' as const,
                }
              : {
                  process: fitter(
                    target.width,
                    target.height,
                    fit === 'blur' ? { blur: true } : { color },
                  ),
                  processedWidth: target.width,
                  processedHeight: target.height,
                }),
          },
        },
        ctx.signal,
        (f) => {
          ctx.progress(f, 'Reframing');
        },
      );
      const scale = crop
        ? target.width / crop.width
        : Math.min(target.width / source.width, target.height / source.height);
      return {
        blob: new Blob([out.bytes], { type: out.mime }),
        ext: out.ext,
        width: target.width,
        height: target.height,
        path: 'Browser · WebCodecs',
        notes: [
          crop
            ? `Cropped to ${String(crop.width)} × ${String(crop.height)} px of the ${String(source.width)} × ${String(source.height)} picture, then scaled`
            : fit === 'blur'
              ? 'The whole picture, on a blurred copy of itself'
              : `The whole picture, on ${color.toUpperCase()}`,
          ...(scale > 1.05
            ? [`Enlarged ${scale.toFixed(1)}× from a smaller video, so it may look soft`]
            : []),
          'Re-encoded at high quality; the sound is copied when it can be',
          ...out.dropped,
        ],
        details: [
          { label: 'Size', value: `${String(target.width)} × ${String(target.height)} px` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
