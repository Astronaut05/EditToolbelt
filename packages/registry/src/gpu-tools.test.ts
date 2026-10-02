import { describe, expect, it } from 'vitest';

import { getTool, hasServerPath } from './index';
import { FIRST_LANGUAGES, WHISPER_LANGUAGE_CODES, WHISPER_LANGUAGES } from './languages';
import { parseServerOptions, serverOptions } from './options';
import { toolDefSchema } from './schema';

const GPU_TOOLS = ['upscale-image', 'transcribe-audio', 'auto-subtitles'] as const;

describe('the GPU tools (M5)', () => {
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
