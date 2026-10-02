/**
 * V11 Rotate & Flip Video (tools/video.md): turn 90°, 180° or 270° and flip
 * either way. Fast sets the container's rotation flag, nothing re-encoded;
 * Burn in turns the picture itself, for players that ignore the flag (the
 * default). WebM has no flag, so it's always burned in.
 */
import { Quality, type Rotation } from 'mediabunny';

import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { convert, MediaInputError, openInput } from './media';
import { containerFormat, sourceFamily } from './trim';

export interface RotateOptions {
  /** 0, 90, 180 or 270: clockwise. */
  rotate?: string;
  /** none, horizontal or vertical: applied to the turned picture. */
  flip?: string;
  /** burn (re-encode) or fast (the rotation flag). */
  mode?: string;
}

const TURNS: readonly Rotation[] = [0, 90, 180, 270];

/**
 * What to ask Mediabunny for, which turns first and then mirrors left to
 * right: a vertical flip is a horizontal one plus half a turn.
 */
export function transformOf(opts: RotateOptions): { rotate: Rotation; flip: boolean } {
  const turn = TURNS.find((t) => String(t) === opts.rotate) ?? 0;
  if (opts.flip === 'vertical') return { rotate: ((turn + 180) % 360) as Rotation, flip: true };
  return { rotate: turn, flip: opts.flip === 'horizontal' };
}

const DESCRIBE: Record<string, string> = {
  '90': 'Turned 90° clockwise',
  '180': 'Turned 180°',
  '270': 'Turned 90° counter-clockwise',
};

export const rotateEngine: Engine<RotateOptions> = {
  ...MEDIA_META.rotate,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const turn = TURNS.find((t) => String(t) === opts.rotate) ?? 0;
    const flip = opts.flip === 'horizontal' || opts.flip === 'vertical' ? opts.flip : 'none';
    if (turn === 0 && flip === 'none') {
      throw new MediaInputError('Pick a turn or a flip.');
    }
    const input = openInput(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new MediaInputError('This file has no video in it.');
      const family = await sourceFamily(input);
      const format = containerFormat(family);
      // WebM can't say how to turn the picture: it is always turned for real.
      const fast = opts.mode === 'fast' && family !== 'webm';
      const before = {
        width: await video.getDisplayWidth(),
        height: await video.getDisplayHeight(),
      };
      const out = await convert(
        {
          input,
          format,
          video: {
            ...transformOf(opts),
            allowTransformationMetadata: fast,
            ...(!fast && { forceTranscode: true, quality: new Quality('high') }),
          },
        },
        ctx.signal,
        (f) => {
          ctx.progress(f, fast ? 'Setting the rotation' : 'Turning every frame');
        },
      );
      const sideways = turn === 90 || turn === 270;
      const width = sideways ? before.height : before.width;
      const height = sideways ? before.width : before.height;
      return {
        blob: new Blob([out.bytes], { type: out.mime }),
        ext: out.ext,
        width,
        height,
        path: fast ? 'Browser · stream copy' : 'Browser · WebCodecs',
        notes: [
          ...(turn ? [DESCRIBE[String(turn)] ?? ''] : []),
          ...(flip !== 'none'
            ? [flip === 'horizontal' ? 'Mirrored left to right' : 'Flipped upside down']
            : []),
          fast
            ? 'Fast: the rotation flag is set and nothing is re-encoded. Phones, players and editors follow it; a few web players don’t.'
            : opts.mode === 'fast'
              ? 'WebM has no rotation flag, so every frame was turned (re-encoded)'
              : 'Every frame turned (re-encoded at high quality), so it plays the same everywhere',
          ...out.dropped,
        ],
        details: [{ label: 'Size', value: `${String(width)} × ${String(height)} px` }],
      };
    } finally {
      input.dispose();
    }
  },
};
