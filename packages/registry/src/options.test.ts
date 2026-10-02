import { describe, expect, it } from 'vitest';

import { parseServerOptions, previewSeconds, uploadKinds, uploadOptions } from './options';

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
    expect(parseServerOptions('trim-video', undefined)).toEqual({ ok: true, options: {} });
    expect(parseServerOptions('trim-video', { any: 1 }).ok).toBe(false);
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

  it('takes Merge Videos’ settings as the browser does, and 1 to 19 more clips in order', () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => `0190f0c8-3f4a-7b6c-9d8e-${String(i).padStart(12, '0')}`,
    );
    expect(parseServerOptions('merge-videos', { clips: [ids[1]] })).toEqual({
      ok: true,
      options: {
        clips: [ids[1]],
        transition: 'none',
        transitionLength: '1',
        size: 'first',
        fps: 'first',
      },
    });
    const crossfade = { transition: 'crossfade', transitionLength: '0.5', size: '720', fps: '25' };
    expect(parseServerOptions('merge-videos', { clips: ids.slice(1), ...crossfade })).toMatchObject(
      {
        ok: true,
        options: crossfade,
      },
    );
    // 2 to 20 clips in all: the job's own upload is the first.
    expect(parseServerOptions('merge-videos', { clips: [] }).ok).toBe(false);
    expect(parseServerOptions('merge-videos', {}).ok).toBe(false);
    expect(parseServerOptions('merge-videos', { clips: ids }).ok).toBe(false);
    expect(parseServerOptions('merge-videos', { clips: [ids[1], ids[1]] })).toEqual({
      ok: false,
      error: 'clips: each clip once',
    });
    expect(parseServerOptions('merge-videos', { clips: ['clip.mp4'] }).ok).toBe(false);
    expect(parseServerOptions('merge-videos', { clips: [ids[1]], fps: '29.97' }).ok).toBe(false);
    expect(parseServerOptions('merge-videos', { clips: [ids[1]], size: '1440' }).ok).toBe(false);
    // The clips are videos joined with the job's own: the limits and the price are for them all.
    expect(uploadOptions['merge-videos']).toEqual(['clips']);
    expect(uploadKinds['merge-videos']?.clips).toMatchObject({
      title: 'Not a video',
      joined: true,
    });
  });
});
