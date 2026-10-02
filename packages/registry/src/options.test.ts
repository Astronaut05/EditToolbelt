import { describe, expect, it } from 'vitest';

import { parseServerOptions, previewSeconds } from './options';

describe('parseServerOptions', () => {
  it('fills in defaults and checks each mode', () => {
    expect(parseServerOptions('compress-video', { targetMb: 25 })).toEqual({
      ok: true,
      options: {
        mode: 'size',
        targetMb: 25,
        resolution: 'auto',
        fps: 'keep',
        codec: 'h264',
        audio: 'keep',
      },
    });
    expect(parseServerOptions('compress-video', { mode: 'quality' })).toEqual({
      ok: false,
      error: 'quality: required in quality mode',
    });
    expect(parseServerOptions('compress-video', { targetMb: 25, filter: 'x' }).ok).toBe(false);
    expect(parseServerOptions('compress-video', { targetMb: 25, codec: 'avc' }).ok).toBe(false);
  });

  it('takes nothing for tools without options', () => {
    expect(parseServerOptions('upscale-video', undefined)).toEqual({ ok: true, options: {} });
    expect(parseServerOptions('upscale-video', { any: 1 }).ok).toBe(false);
  });

  it('needs the subtitle file’s upload for Burn Subtitles, and fills in the style', () => {
    const id = '0190f0c8-3f4a-7b6c-9d8e-0a1b2c3d4e5f';
    expect(parseServerOptions('burn-subtitles', { subtitles: id })).toEqual({
      ok: true,
      options: {
        subtitles: id,
        font: 'sans',
        size: 'medium',
        color: '#ffffff',
        outline: 'thin',
        box: false,
        position: 'bottom',
        width: 'full',
      },
    });
    expect(parseServerOptions('burn-subtitles', {}).ok).toBe(false);
    expect(parseServerOptions('burn-subtitles', { subtitles: id, color: 'red' }).ok).toBe(false);
  });

  it('defaults VFR to CFR to the nearest rate, visually lossless, with the sound', () => {
    expect(parseServerOptions('vfr-to-cfr', {})).toEqual({
      ok: true,
      options: { fps: 'auto', quality: 'best', audio: 'keep' },
    });
    expect(parseServerOptions('vfr-to-cfr', { fps: '29.97' }).ok).toBe(true);
    expect(parseServerOptions('vfr-to-cfr', { fps: '29' }).ok).toBe(false);
  });

  it('cleans speech at Medium in the file’s own format by default, and knows previews', () => {
    expect(parseServerOptions('remove-noise', {})).toEqual({
      ok: true,
      options: { strength: 'medium', dehum: 'off', deess: false, format: 'keep', preview: false },
    });
    expect(parseServerOptions('remove-noise', { dehum: '60', preview: true }).ok).toBe(true);
    expect(parseServerOptions('remove-noise', { dehum: 55 }).ok).toBe(false);
    expect(parseServerOptions('remove-noise', { format: 'aiff' }).ok).toBe(false);
    expect(previewSeconds['remove-noise']).toBe(10);
    expect(previewSeconds['compress-video']).toBeUndefined();
  });
});
