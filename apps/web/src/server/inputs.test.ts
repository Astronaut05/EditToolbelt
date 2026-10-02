import { getTool, setToolFlags } from '@etb/registry';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkCrossfade,
  checkHasVideo,
  checkInputs,
  checkKind,
  namedUploads,
  type Input,
} from './inputs';
import { ApiError } from './problem';

const GB = 1024 ** 3;
const MINUTE = 60_000;
const merge = getTool('merge-videos');
const ids = ['a', 'b', 'c'].map((c) => `0190f0c8-3f4a-7b6c-9d8e-${c.repeat(12)}`);

function clip(bytes: number, durationMs: number, width = 1920, height = 1080): Input {
  return { bytes, probe: { duration_ms: durationMs, video: { width, height, fps: 30 } } };
}

/** The ApiError a call throws, for its code, status, words and extra fields. */
function refusal(call: () => unknown): ApiError {
  try {
    call();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('it was not refused');
}

afterEach(() => {
  setToolFlags(new Map());
});

describe('namedUploads', () => {
  it('lists Merge Videos’ other clips in order, as clips 2 on', () => {
    expect(namedUploads('merge-videos', { clips: ids, transition: 'none' })).toEqual([
      { option: 'clips', kind: 'video', id: ids[0], label: 'clip 2' },
      { option: 'clips', kind: 'video', id: ids[1], label: 'clip 3' },
      { option: 'clips', kind: 'video', id: ids[2], label: 'clip 4' },
    ]);
  });

  it('names Burn Subtitles’ one subtitle file, and nothing for tools without more files', () => {
    expect(namedUploads('burn-subtitles', { subtitles: ids[0], font: 'sans' })).toEqual([
      { option: 'subtitles', kind: 'subtitles', id: ids[0], label: 'the subtitles file' },
    ]);
    expect(namedUploads('compress-video', { mode: 'size', targetMb: 10 })).toEqual([]);
  });
});

describe('checkKind', () => {
  const [video] = namedUploads('merge-videos', { clips: [ids[0]] });
  const [subtitles] = namedUploads('burn-subtitles', { subtitles: ids[0] });

  it('takes only videos as clips and only subtitle files as subtitles', () => {
    if (!video || !subtitles) throw new Error('nothing named');
    expect(() => {
      checkKind(video, 'video/quicktime');
    }).not.toThrow();
    expect(
      refusal(() => {
        checkKind(video, 'application/x-subrip');
      }),
    ).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      title: 'Not a video',
      detail: 'clips: clip 2 isn’t a video.',
    });
    expect(() => {
      checkKind(subtitles, 'text/vtt');
    }).not.toThrow();
    expect(
      refusal(() => {
        checkKind(subtitles, 'video/mp4');
      }),
    ).toMatchObject({
      title: 'Not a subtitle file',
    });
  });

  it('refuses a clip with only sound in it, by its place in the list', () => {
    expect(
      refusal(() => {
        checkHasVideo({ duration_ms: 1000, video: null }, 'clip 3');
      }),
    ).toMatchObject({
      status: 422,
      code: 'UNSUPPORTED_FORMAT',
      detail: 'Clip 3 has no picture in it, only sound.',
    });
  });
});

describe('checkInputs', () => {
  it('prices several clips on their length together', () => {
    const measured = checkInputs(merge, 'free', [
      clip(0.5 * GB, 2.5 * MINUTE),
      clip(0.2 * GB, 1 * MINUTE, 1280, 720),
    ]);
    expect(measured).toEqual({ durationMs: 3.5 * MINUTE, megapixels: (1920 * 1080) / 1e6 });
  });

  it('holds the clips together to the tier’s size and length, which paid accounts get more of', () => {
    const big = [clip(1.2 * GB, 10 * MINUTE), clip(1.2 * GB, 10 * MINUTE)];
    expect(refusal(() => checkInputs(merge, 'free', big))).toMatchObject({
      status: 413,
      code: 'FILE_TOO_LARGE',
      detail: 'These clips come to 2.6 GB together; the limit for Merge Videos is 2.1 GB.',
      extra: { max_bytes: 2 * GB },
    });
    expect(checkInputs(merge, 'paid', big).durationMs).toBe(20 * MINUTE);

    const long = [clip(GB / 4, 40 * MINUTE), clip(GB / 4, 25 * MINUTE)];
    expect(refusal(() => checkInputs(merge, 'free', long))).toMatchObject({
      code: 'FILE_TOO_LARGE',
      detail: 'These clips come to 65.0 min together; the limit for Merge Videos is 60 min.',
      extra: { max_duration_sec: 3600 },
    });
    expect(() => checkInputs(merge, 'paid', long)).not.toThrow();
  });

  it('checks each clip’s pixels, and the limits an admin set over the registry’s', () => {
    setToolFlags(
      new Map([
        [
          'merge-videos',
          {
            limits: {
              server: {
                free: { maxBytes: GB, maxPixels: 1920 * 1080 },
                paid: { maxBytes: GB, maxPixels: 1920 * 1080 },
              },
            },
          },
        ],
      ]),
    );
    const clips = [clip(GB / 8, MINUTE), clip(GB / 8, MINUTE, 3840, 2160)];
    expect(refusal(() => checkInputs(merge, 'paid', clips))).toMatchObject({
      code: 'FILE_TOO_LARGE',
      title: 'Too many pixels',
    });
  });

  it('keeps one file’s limits as they were: its length, its size checked at upload', () => {
    const compress = getTool('compress-video');
    expect(refusal(() => checkInputs(compress, 'free', [clip(GB, 61 * MINUTE)]))).toMatchObject({
      detail: 'This is 61.0 min; the limit for Compress Video is 60 min.',
    });
    expect(checkInputs(compress, 'free', [clip(3 * GB, MINUTE)]).durationMs).toBe(MINUTE);
  });

  it('refuses a tool without a server path', () => {
    expect(refusal(() => checkInputs(getTool('trim-video'), 'free', [clip(1, 1)]))).toMatchObject({
      status: 409,
      code: 'TOOL_UNAVAILABLE',
    });
  });
});

describe('checkCrossfade', () => {
  const probes = [clip(1, 10_000).probe, clip(1, 3_000).probe];

  it('lets a crossfade be at most half the shortest clip', () => {
    expect(() => {
      checkCrossfade('merge-videos', { transition: 'crossfade', transitionLength: '1' }, probes);
    }).not.toThrow();
    expect(
      refusal(() => {
        checkCrossfade('merge-videos', { transition: 'crossfade', transitionLength: '2' }, probes);
      }),
    ).toMatchObject({
      status: 400,
      title: 'Crossfade too long',
      detail:
        'A 2 s crossfade needs clips of at least 4 s; the shortest is 3.0 s. Pick a shorter crossfade, or a cut.',
    });
    expect(() => {
      checkCrossfade('merge-videos', { transition: 'none', transitionLength: '2' }, probes);
    }).not.toThrow();
  });
});
