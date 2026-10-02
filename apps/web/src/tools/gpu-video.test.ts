import { describe, expect, it } from 'vitest';

import { backgroundFacts, lengthFacts, upscaleVideoFacts } from './gpu-video';

const clip = (width: number, height: number, durationSec: number, fps = 30) => ({
  width,
  height,
  durationSec,
  fps,
});

describe('Upscale Video’s facts', () => {
  it('shows the result’s size, and says when it passes 4K', () => {
    expect(upscaleVideoFacts({ scale: '2' }, clip(1920, 1080, 30))).toEqual([
      { label: 'Result', value: '3840 × 2160 px · H.264 MP4' },
    ]);
    expect(upscaleVideoFacts({ scale: '4' }, clip(1280, 720, 30))[0]?.value).toBe(
      '5120 × 2880 px, over 4K: pick 2× or a smaller video',
    );
    expect(upscaleVideoFacts({ scale: '2' }, null)).toEqual([]);
  });

  it('says how long a clip may be at its frame rate', () => {
    expect(lengthFacts(clip(640, 360, 600))).toEqual([]);
    expect(lengthFacts(clip(640, 360, 360, 60))[0]?.value).toBe(
      '21,600 frames, over the 18,000 we take: up to 5.0 min at 60 fps. Trim it first',
    );
  });
});

describe('Video Background Remover’s facts', () => {
  it('names the output and estimates ProRes 4444’s size', () => {
    expect(backgroundFacts({ output: 'webm' }, clip(1920, 1080, 60))).toEqual([
      { label: 'Result', value: 'WebM (VP9) with transparency' },
    ]);
    const prores = backgroundFacts({ output: 'prores' }, clip(1920, 1080, 60));
    expect(prores[1]).toEqual({ label: 'ProRes size', value: 'About 3.0 GB' });
    const long = backgroundFacts({ output: 'prores' }, clip(1920, 1080, 120));
    expect(long[1]?.value).toBe(
      'About 6.1 GB, over the 4.5 GB we make: pick WebM or green, or trim it',
    );
    expect(backgroundFacts({ output: 'green' }, clip(4096, 2160, 5))[1]).toEqual({
      label: 'Size',
      value: 'Over 4K: we take up to 3840 × 2160',
    });
  });
});
