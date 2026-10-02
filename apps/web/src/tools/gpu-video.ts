/**
 * What the video GPU pages (V20, V21) show about a file before anything is
 * sent: the result's size, and the limits it would pass (src/lib/gpu-limits.ts,
 * which the jobs API applies before anything is charged).
 */
import type { ProbeInfo } from '@etb/ui';

import {
  fits4k,
  fpsLabel,
  framesOf,
  MAX_PRORES_BYTES,
  MAX_VIDEO_FRAMES,
  proresBytesOf,
  workingFps,
} from '../lib/gpu-limits';

interface Fact {
  label: string;
  value: string;
}

type Media = Pick<ProbeInfo, 'width' | 'height' | 'fps' | 'durationSec'> | null;

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/** A clip past the frame cap: how long it may be at its frame rate. */
export function lengthFacts(media: Media): Fact[] {
  if (!media) return [];
  const frames = framesOf(media.durationSec, media.fps);
  if (frames <= MAX_VIDEO_FRAMES) return [];
  const fps = workingFps(media.fps);
  return [
    {
      label: 'Length',
      value: `${frames.toLocaleString('en-US')} frames, over the ${MAX_VIDEO_FRAMES.toLocaleString('en-US')} we take: up to ${(MAX_VIDEO_FRAMES / fps / 60).toFixed(1)} min at ${fpsLabel(fps)} fps. Trim it first`,
    },
  ];
}

/** Upscale Video: the result's size, or why it's too big. */
export function upscaleVideoFacts(options: Record<string, string>, media: Media): Fact[] {
  if (!media?.width || !media.height) return [];
  const scale = options.scale === '4' ? 4 : 2;
  const width = media.width * scale;
  const height = media.height * scale;
  const size = `${String(width)} × ${String(height)} px`;
  return [
    {
      label: 'Result',
      value: fits4k(width, height)
        ? `${size} · H.264 MP4`
        : `${size}, over 4K: pick 2× or a smaller video`,
    },
    ...lengthFacts(media),
  ];
}

const OUTPUT_LABELS: Record<string, string> = {
  prores: 'ProRes 4444 MOV with transparency',
  webm: 'WebM (VP9) with transparency',
  green: 'H.264 MP4 on green',
  color: 'H.264 MP4 on your color',
};

/** Video Background Remover: what the result is, and how big ProRes would be. */
export function backgroundFacts(options: Record<string, string>, media: Media): Fact[] {
  const output = options.output ?? 'prores';
  const facts: Fact[] = [{ label: 'Result', value: OUTPUT_LABELS[output] ?? output }];
  if (!media?.width || !media.height) return facts;
  if (!fits4k(media.width, media.height)) {
    facts.push({ label: 'Size', value: 'Over 4K: we take up to 3840 × 2160' });
  }
  if (output === 'prores') {
    const bytes = proresBytesOf(media.width, media.height, framesOf(media.durationSec, media.fps));
    facts.push({
      label: 'ProRes size',
      value:
        bytes > MAX_PRORES_BYTES
          ? `About ${gb(bytes)}, over the ${gb(MAX_PRORES_BYTES)} we make: pick WebM or green, or trim it`
          : `About ${gb(bytes)}`,
    });
  }
  return [...facts, ...lengthFacts(media)];
}
