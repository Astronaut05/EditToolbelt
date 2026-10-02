import { describe, expect, it } from 'vitest';

import { getTool, hasServerPath } from './index';
import { FIRST_LANGUAGES, WHISPER_LANGUAGE_CODES, WHISPER_LANGUAGES } from './languages';
import { parseServerOptions, serverOptions, uploadKinds, uploadOptions } from './options';
import { toolDefSchema } from './schema';

const GPU_TOOLS = [
  'upscale-image',
  'transcribe-audio',
  'auto-subtitles',
  'object-eraser',
  'upscale-video',
  'video-background-remover',
] as const;

describe('the GPU tools (M5, Wave 3)', () => {
  it.each(GPU_TOOLS)('%s is complete enough for an admin to switch on as beta', (id) => {
    const tool = getTool(id);
    // Off by default, like every server-only tool: an admin sets beta in the server build.
    expect(tool.status).toBe('soon');
    const asBeta = toolDefSchema.safeParse({ ...tool, status: 'beta' });
    expect(asBeta.success, asBeta.success ? '' : asBeta.error.message).toBe(true);
    expect(hasServerPath(tool)).toBe(true);
    expect(tool.gpu).toBeDefined();
    expect(id in serverOptions).toBe(true);
  });

  it('runs Whisper on an L4 and Real-ESRGAN on a T4 (gpu/modal_app.py)', () => {
    expect(getTool('upscale-image').gpu).toBe('T4');
    expect(getTool('transcribe-audio').gpu).toBe('L4');
    expect(getTool('auto-subtitles').gpu).toBe('L4');
  });

  it('runs MI-GAN on a T4 and the video models on an L4, priced as tools/README.md says', () => {
    expect(getTool('object-eraser').gpu).toBe('T4');
    expect(getTool('upscale-video').gpu).toBe('L4');
    expect(getTool('video-background-remover').gpu).toBe('L4');
    expect(getTool('object-eraser').cost).toEqual({ kind: 'flat', credits: 3 });
    expect(getTool('upscale-video').cost).toEqual({
      kind: 'perMinute',
      credits: 10,
      minCredits: 10,
    });
    expect(getTool('video-background-remover').cost).toEqual({
      kind: 'perMinute',
      credits: 8,
      minCredits: 8,
    });
    // tools/video.md → V20: 10 min at most.
    expect(getTool('upscale-video').limits?.server?.paid.maxDurationSec).toBe(600);
  });

  it('takes Object Eraser’s mask as a PNG upload of its own', () => {
    const id = '0190f0c8-3f4a-7b6c-9d8e-0a1b2c3d4e5f';
    expect(uploadOptions['object-eraser']).toEqual(['mask']);
    expect(uploadKinds['object-eraser']?.mask?.types).toEqual(['image/png']);
    expect(parseServerOptions('object-eraser', { mask: id })).toEqual({
      ok: true,
      options: { mask: id, format: 'png' },
    });
    expect(parseServerOptions('object-eraser', {}).ok).toBe(false);
    expect(parseServerOptions('object-eraser', { mask: id, format: 'tiff' }).ok).toBe(false);
  });

  it('defaults Upscale Video to 2× General and the background remover to ProRes 4444', () => {
    expect(parseServerOptions('upscale-video', {})).toEqual({
      ok: true,
      options: { scale: '2', model: 'general', denoise: 'medium' },
    });
    expect(parseServerOptions('upscale-video', { scale: '3' }).ok).toBe(false);
    expect(parseServerOptions('video-background-remover', {})).toEqual({
      ok: true,
      options: { output: 'prores', color: '#ffffff' },
    });
    expect(
      parseServerOptions('video-background-remover', { output: 'color', color: '#00ff00' }).ok,
    ).toBe(true);
    expect(parseServerOptions('video-background-remover', { output: 'gif' }).ok).toBe(false);
    expect(parseServerOptions('video-background-remover', { color: 'green' }).ok).toBe(false);
  });

  it('refuses a working server-gpu tool without its GPU, and a GPU on a CPU tool', () => {
    const withoutGpu = { ...getTool('upscale-image'), status: 'beta' as const, gpu: undefined };
    expect(toolDefSchema.safeParse(withoutGpu).success).toBe(false);
    const cpu = { ...getTool('vfr-to-cfr'), gpu: 'T4' as const };
    expect(toolDefSchema.safeParse(cpu).success).toBe(false);
  });

  it('fills in Upscale Image’s defaults and refuses what the model can’t do', () => {
    expect(parseServerOptions('upscale-image', {})).toEqual({
      ok: true,
      options: { scale: '4', model: 'general', denoise: 'medium', format: 'png' },
    });
    expect(parseServerOptions('upscale-image', { scale: '8' }).ok).toBe(false);
    expect(parseServerOptions('upscale-image', { format: 'tiff' }).ok).toBe(false);
  });

  it('takes Whisper’s languages, or auto', () => {
    expect(WHISPER_LANGUAGE_CODES).toHaveLength(100);
    expect(WHISPER_LANGUAGES.uz).toBe('Uzbek');
    for (const code of FIRST_LANGUAGES) expect(WHISPER_LANGUAGE_CODES).toContain(code);
    expect(parseServerOptions('transcribe-audio', {})).toEqual({
      ok: true,
      options: { language: 'auto', format: 'txt' },
    });
    expect(parseServerOptions('transcribe-audio', { language: 'uz', format: 'json' }).ok).toBe(
      true,
    );
    expect(parseServerOptions('transcribe-audio', { language: 'klingon' }).ok).toBe(false);
    expect(parseServerOptions('transcribe-audio', { format: 'docx' }).ok).toBe(false);
  });

  it('gives Auto Subtitles 42 characters on 2 lines, and limits both', () => {
    expect(parseServerOptions('auto-subtitles', { language: 'ru' })).toEqual({
      ok: true,
      options: {
        language: 'ru',
        translate: false,
        format: 'srt',
        maxChars: 42,
        maxLines: 2,
        words: false,
      },
    });
    expect(parseServerOptions('auto-subtitles', { maxChars: 200 }).ok).toBe(false);
    expect(parseServerOptions('auto-subtitles', { maxLines: 0 }).ok).toBe(false);
    expect(parseServerOptions('auto-subtitles', { format: 'json' }).ok).toBe(false);
  });
});
