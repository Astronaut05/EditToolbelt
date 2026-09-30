import { describe, expect, it } from 'vitest';

import { parseServerOptions } from './options';

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
    expect(parseServerOptions('vfr-to-cfr', undefined)).toEqual({ ok: true, options: {} });
    expect(parseServerOptions('vfr-to-cfr', { any: 1 }).ok).toBe(false);
  });
});
