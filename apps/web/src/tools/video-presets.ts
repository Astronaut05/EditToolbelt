import { VIDEO_LIMITS, type MediaInfo } from '@etb/engines';
import type { ProbeInfo, ShellPreset } from '@etb/ui';

/**
 * Shared bits of the video tools' presets (tools/video.md → shared rules):
 * what they take, the probe that reads a file as it arrives, and the
 * warnings worth reading before starting.
 */

export const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv';

export const VIDEO_INTAKE: Pick<
  ShellPreset,
  'noun' | 'accept' | 'maxBytes' | 'sampleUrl' | 'sampleName' | 'formats' | 'formatsShort'
> = {
  noun: 'video',
  accept: VIDEO_ACCEPT,
  maxBytes: VIDEO_LIMITS.maxBytes,
  sampleUrl: '/samples/clip.mp4',
  sampleName: 'clip.mp4',
  formats: 'MP4, MOV, WebM, MKV · up to 2 GB and 60 min',
  formatsShort: 'MP4, MOV, WebM, MKV',
};

/**
 * What to know before starting, in plain words. A server tool (`server`)
 * skips what is only about working in this browser.
 */
export function mediaWarnings(
  info: MediaInfo,
  codecLabel: (codec: string | null | undefined) => string,
  server = false,
): string[] {
  const warnings: string[] = [];
  const video = info.video;
  if (video && !video.canDecode && !server) {
    warnings.push(
      `This browser can’t play ${codecLabel(video.codec)} video, so there’s no preview and nothing can be re-encoded here. Try Chrome, Edge or Safari.`,
    );
  }
  if (video?.variableFrameRate) {
    warnings.push(
      'Variable frame rate: phones and screen recorders make these. Cuts can land a frame off, and editing apps may drift out of sync.',
    );
  }
  if (video?.hdr && !server) {
    warnings.push('HDR video: re-encoding here makes it SDR, so colors can look flatter.');
  }
  if (
    !server &&
    info.durationSec > VIDEO_LIMITS.phoneSeconds &&
    /Mobi|Android/.test(navigator.userAgent)
  ) {
    warnings.push(
      'Long video on a phone: it may run slowly or run out of memory. 10 min or less works best.',
    );
  }
  return warnings;
}

/**
 * Reads a video as it arrives: length, frame rate, codecs, and frames for the
 * timeline. `server`: for a tool that runs on our servers only.
 */
export async function probeVideo(
  file: File,
  audioTracks = false,
  server = false,
): Promise<ProbeInfo> {
  // Mediabunny loads with the first file, not with the page.
  const { codecLabel, describeMedia, probeMedia, thumbnails } = await import('@etb/engines/media');
  const info = await probeMedia(file);
  if (!info.video && !audioTracks) {
    throw new Error('This file has no video in it. Drop an MP4, MOV, WebM or MKV video.');
  }
  return {
    durationSec: info.durationSec,
    fps: info.video?.fps ?? undefined,
    width: info.video?.width,
    height: info.video?.height,
    summary: describeMedia(info),
    warnings: mediaWarnings(info, codecLabel, server),
    frameRate: info.video ? (info.video.variableFrameRate ? 'variable' : 'constant') : undefined,
    thumbnails: (count) => thumbnails(file, count),
    choices: {
      track: info.audio.map((track) => ({
        value: String(track.number),
        label: `${String(track.number)} · ${codecLabel(track.codec)} ${track.channels > 2 ? `${String(track.channels)} ch` : track.channels === 2 ? 'stereo' : 'mono'}`,
      })),
    },
  };
}
