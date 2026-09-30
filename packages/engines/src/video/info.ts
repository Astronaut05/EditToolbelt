/**
 * V08 Video Info & VFR Check (tools/video.md): what's in a file, read from
 * its headers and packet table (no decoding), with the verdicts editors care
 * about: variable frame rate, HDR, rotation, codecs this browser can't play.
 * Exports as text or JSON.
 */
import type { Engine, EngineOutput } from '../types';
import { codecLabel, MediaInputError, openInput, VIDEO_LIMITS } from './media';
import { MEDIA_META } from '../media-meta';

export interface VideoInfoOptions {
  /** txt or json */
  format?: string;
}

export interface VideoReport {
  file: {
    name: string | null;
    sizeBytes: number;
    container: string;
    mimeType: string;
    durationSec: number;
    bitrate: number | null;
    title: string | null;
    date: string | null;
    comment: string | null;
  };
  video: {
    codec: string;
    codecString: string | null;
    profile: string | null;
    bitDepth: number | null;
    width: number;
    height: number;
    codedWidth: number;
    codedHeight: number;
    displayAspect: string;
    pixelAspect: string;
    rotation: number;
    fps: number | null;
    frameRate: 'constant' | 'variable' | 'unknown';
    frames: number | null;
    bitrate: number | null;
    colorPrimaries: string | null;
    transfer: string | null;
    matrix: string | null;
    fullRange: boolean | null;
    hdr: 'HLG' | 'PQ (HDR10)' | null;
    canDecode: boolean;
  } | null;
  audio: {
    number: number;
    codec: string;
    codecString: string | null;
    channels: number;
    sampleRate: number;
    bitrate: number | null;
    language: string | null;
    canDecode: boolean;
  }[];
  verdicts: string[];
}

const AVC_PROFILES: Record<number, string> = {
  66: 'Baseline',
  77: 'Main',
  88: 'Extended',
  100: 'High',
  110: 'High 10',
  122: 'High 4:2:2',
  244: 'High 4:4:4',
};
const HEVC_PROFILES: Record<number, string> = {
  1: 'Main',
  2: 'Main 10',
  3: 'Main Still',
  4: 'Range extensions',
};

/** Profile, level and bit depth from a codec string: "avc1.64001f" → High, level 3.1. */
export function describeCodecString(codecString: string | null): {
  profile: string | null;
  bitDepth: number | null;
} {
  if (!codecString) return { profile: null, bitDepth: null };
  const [kind = '', ...parts] = codecString.split('.');
  if (/^(avc1|avc3)$/.test(kind) && parts[0]?.length === 6) {
    const profile = parseInt(parts[0].slice(0, 2), 16);
    const level = parseInt(parts[0].slice(4, 6), 16) / 10;
    const name = AVC_PROFILES[profile] ?? `profile ${String(profile)}`;
    return { profile: `${name}, level ${String(level)}`, bitDepth: profile === 110 ? 10 : null };
  }
  if (/^(hev1|hvc1)$/.test(kind)) {
    const profile = Number((parts[0] ?? '').replace(/^[A-C]/, ''));
    const levelPart = parts.find((part) => /^[LH]\d+$/.test(part));
    const level = levelPart ? Number(levelPart.slice(1)) / 30 : null;
    const name = HEVC_PROFILES[profile] ?? `profile ${String(profile)}`;
    return {
      profile: `${name}${levelPart?.startsWith('H') ? ', High tier' : ''}${level ? `, level ${String(Math.round(level * 10) / 10)}` : ''}`,
      bitDepth: profile === 2 ? 10 : profile === 1 ? 8 : null,
    };
  }
  if (kind === 'vp09') {
    const [profile, level, depth] = parts.map(Number);
    return {
      profile: `Profile ${String(profile ?? 0)}${level ? `, level ${String(level / 10)}` : ''}`,
      bitDepth: depth ?? null,
    };
  }
  if (kind === 'av01') {
    const [profile = '0', levelTier = '', depth] = parts;
    const level = Number(levelTier.slice(0, 2));
    const names = ['Main', 'High', 'Professional'];
    return {
      profile: `${names[Number(profile)] ?? `profile ${profile}`}, level ${String(2 + (level >> 2))}.${String(level & 3)}${levelTier.endsWith('H') ? ', High tier' : ''}`,
      bitDepth: depth ? Number(depth) : null,
    };
  }
  return { profile: null, bitDepth: null };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** "1920 × 1080" → "16:9"; near-miss sizes round to the ratio people know. */
export function aspectLabel(width: number, height: number): string {
  if (!width || !height) return 'unknown';
  const known: [number, string][] = [
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [4 / 3, '4:3'],
    [3 / 4, '3:4'],
    [1, '1:1'],
    [4 / 5, '4:5'],
    [21 / 9, '21:9'],
    [2.39, '2.39:1'],
    [1.85, '1.85:1'],
    [3 / 2, '3:2'],
  ];
  const ratio = width / height;
  const match = known.find(([value]) => Math.abs(value - ratio) / value < 0.01);
  if (match) return match[1];
  const d = gcd(width, height);
  return `${String(width / d)}:${String(height / d)}`;
}

/** "00:01:02.500" */
export function clock(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`;
}

/** "12.4 Mbps", "192 kbps" */
export function bitrateLabel(bps: number | null): string {
  if (!bps) return 'unknown';
  return bps >= 1_000_000
    ? `${(bps / 1_000_000).toFixed(1)} Mbps`
    : `${String(Math.round(bps / 1000))} kbps`;
}

const CHANNELS: Record<number, string> = { 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' };

/** Everything the file says about itself. */
export async function videoReport(file: Blob, name: string | null = null): Promise<VideoReport> {
  if (file.size > VIDEO_LIMITS.maxBytes) {
    throw new MediaInputError(
      `This file is ${(file.size / 1024 ** 3).toFixed(1)} GB; the browser limit is 2 GB.`,
    );
  }
  const input = openInput(file);
  try {
    if (!(await input.canRead())) {
      throw new MediaInputError(
        'This isn’t a video this tool can read. Try MP4, MOV, WebM or MKV.',
      );
    }
    const format = await input.getFormat();
    const durationSec = await input.computeDuration();
    const tags = await input.getMetadataTags().catch(() => ({}) as Record<string, never>);
    const track = await input.getPrimaryVideoTrack();
    let video: VideoReport['video'] = null;
    if (track) {
      const [codec, codecString, width, height, codedWidth, codedHeight, squareWidth, rotation] =
        await Promise.all([
          track.getCodec(),
          track.getCodecParameterString(),
          track.getDisplayWidth(),
          track.getDisplayHeight(),
          track.getCodedWidth(),
          track.getCodedHeight(),
          track.getSquarePixelWidth(),
          track.getRotation(),
        ]);
      const metrics = await track.computeFrameRateMetrics().catch(() => null);
      const stats = await track.computePacketStats().catch(() => null);
      const color = await track.getColorSpace().catch((): VideoColorSpaceInit => ({}));
      const { profile, bitDepth } = describeCodecString(codecString);
      // TypeScript's DOM types stop at SDR transfers; files and browsers also say pq and hlg.
      const transfer: string | null = (color.transfer as string | undefined) ?? null;
      const sar = codedWidth ? squareWidth / codedWidth : 1;
      video = {
        codec: codecLabel(codec),
        codecString,
        profile,
        bitDepth,
        width,
        height,
        codedWidth,
        codedHeight,
        displayAspect: aspectLabel(width, height),
        pixelAspect: Math.abs(sar - 1) < 0.001 ? '1:1 (square)' : `${sar.toFixed(3)}:1`,
        rotation,
        fps: metrics ? Math.round(metrics.bestGuessFrameRate * 1000) / 1000 : null,
        frameRate: !metrics
          ? 'unknown'
          : metrics.underlyingFrameRate === null
            ? 'variable'
            : 'constant',
        frames: stats?.packetCount ?? null,
        bitrate: stats?.averageBitrate ? Math.round(stats.averageBitrate) : null,
        colorPrimaries: color.primaries ?? null,
        transfer,
        matrix: color.matrix ?? null,
        fullRange: color.fullRange ?? null,
        hdr: transfer === 'hlg' ? 'HLG' : transfer === 'pq' ? 'PQ (HDR10)' : null,
        canDecode: await track.canDecode(),
      };
    }
    const audio = await Promise.all(
      (await input.getAudioTracks()).map(async (a, i) => {
        const stats = await a.computePacketStats().catch(() => null);
        const language = await a.getLanguageCode();
        return {
          number: i + 1,
          codec: codecLabel(await a.getCodec()),
          codecString: await a.getCodecParameterString(),
          channels: await a.getNumberOfChannels(),
          sampleRate: await a.getSampleRate(),
          bitrate: stats?.averageBitrate ? Math.round(stats.averageBitrate) : null,
          language: language && language !== 'und' ? language : null,
          canDecode: await a.canDecode(),
        };
      }),
    );
    const report: VideoReport = {
      file: {
        name,
        sizeBytes: file.size,
        container: format.name,
        mimeType: format.mimeType,
        durationSec,
        bitrate: durationSec > 0 ? Math.round((file.size * 8) / durationSec) : null,
        title: tags.title ?? null,
        date: tags.date ? tags.date.toISOString() : null,
        comment: tags.comment ?? null,
      },
      video,
      audio,
      verdicts: [],
    };
    report.verdicts = verdicts(report);
    return report;
  } finally {
    input.dispose();
  }
}

/** What an editor should know before importing it. */
export function verdicts(report: VideoReport): string[] {
  const out: string[] = [];
  const v = report.video;
  if (!v) out.push('No video track: this is an audio-only file.');
  if (v?.frameRate === 'variable') {
    out.push(
      `Variable frame rate (about ${String(v.fps)} fps): it may drift out of sync in Premiere Pro and other editors. Convert it to a constant frame rate before editing.`,
    );
  }
  if (v?.hdr) {
    out.push(
      `HDR (${v.hdr}): it will look washed out on an SDR timeline. Edit on an HDR timeline, or convert it to SDR first.`,
    );
  }
  if (v && v.rotation !== 0) {
    out.push(
      `Rotated ${String(v.rotation)}° by metadata: players turn it, but some editors show it sideways.`,
    );
  }
  // The rest is worth knowing but doesn't stop an edit.
  if (v && out.length === 0) out.push('Constant frame rate, SDR, no rotation: ready to edit.');
  if (report.audio.length === 0 && v) out.push('No audio track.');
  if (report.audio.length > 1)
    out.push(`${String(report.audio.length)} audio tracks: editors often import only the first.`);
  if (v && !v.canDecode)
    out.push(`This browser can’t play the ${v.codec} video, but other apps may.`);
  return out;
}

const line = (label: string, value: string | number | null | undefined) =>
  value === null || value === undefined || value === ''
    ? null
    : `${label.padEnd(18)}${String(value)}`;

/** The report as plain text, in sections. */
export function reportText(report: VideoReport): string {
  const { file, video: v, audio } = report;
  const sections: (string | null)[][] = [
    [
      'FILE',
      line('Name', file.name),
      line('Container', `${file.container} (${file.mimeType})`),
      line('Size', `${(file.sizeBytes / 1e6).toFixed(2)} MB`),
      line('Duration', clock(file.durationSec)),
      line('Overall bitrate', bitrateLabel(file.bitrate)),
      line('Title', file.title),
      line('Created', file.date),
      line('Comment', file.comment),
    ],
  ];
  if (v) {
    sections.push([
      'VIDEO',
      line('Codec', `${v.codec}${v.profile ? ` (${v.profile})` : ''}`),
      line('Codec string', v.codecString),
      line('Resolution', `${String(v.width)} × ${String(v.height)} px`),
      line(
        'Coded size',
        v.codedWidth !== v.width || v.codedHeight !== v.height
          ? `${String(v.codedWidth)} × ${String(v.codedHeight)} px`
          : null,
      ),
      line('Aspect ratio', v.displayAspect),
      line('Pixel aspect', v.pixelAspect),
      line('Frame rate', v.fps === null ? 'unknown' : `${String(v.fps)} fps, ${v.frameRate}`),
      line('Frames', v.frames),
      line('Bitrate', bitrateLabel(v.bitrate)),
      line('Bit depth', v.bitDepth ? `${String(v.bitDepth)} bit` : null),
      line('Color primaries', v.colorPrimaries),
      line('Transfer', v.transfer),
      line('Matrix', v.matrix),
      line('Range', v.fullRange === null ? null : v.fullRange ? 'full' : 'limited'),
      line('HDR', v.hdr ?? 'no'),
      line('Rotation', `${String(v.rotation)}°`),
    ]);
  }
  for (const a of audio) {
    sections.push([
      audio.length > 1 ? `AUDIO ${String(a.number)}` : 'AUDIO',
      line('Codec', a.codec),
      line('Codec string', a.codecString),
      line('Channels', `${String(a.channels)} (${CHANNELS[a.channels] ?? 'multichannel'})`),
      line('Sample rate', `${String(a.sampleRate / 1000)} kHz`),
      line('Bitrate', bitrateLabel(a.bitrate)),
      line('Language', a.language),
    ]);
  }
  sections.push(['VERDICT', ...report.verdicts]);
  return `${sections.map((s) => s.filter((l): l is string => l !== null).join('\n')).join('\n\n')}\n`;
}

export const videoInfoEngine: Engine<VideoInfoOptions> = {
  ...MEDIA_META.videoInfo,
  async run(file, opts, ctx): Promise<EngineOutput> {
    ctx.progress(0.2, 'Reading the file');
    const report = await videoReport(file, file instanceof File ? file.name : null);
    const json = opts.format === 'json';
    const v = report.video;
    const a = report.audio[0];
    return {
      blob: new Blob([json ? `${JSON.stringify(report, null, 2)}\n` : reportText(report)], {
        type: json ? 'application/json' : 'text/plain;charset=utf-8',
      }),
      ext: json ? 'json' : 'txt',
      path: 'Browser',
      durationSec: report.file.durationSec,
      notes: report.verdicts,
      details: [
        {
          label: 'Resolution',
          value: v ? `${String(v.width)} × ${String(v.height)}` : 'none',
          ...(v && { unit: 'px' }),
        },
        {
          label: 'Frame rate',
          value: v?.fps ? String(v.fps) : '—',
          unit: v?.frameRate === 'variable' ? 'fps VFR' : 'fps',
        },
        { label: 'Duration', value: clock(report.file.durationSec) },
        { label: 'Bitrate', value: bitrateLabel(report.file.bitrate) },
        { label: 'Video', value: v ? v.codec : 'none', ...(v?.hdr && { unit: v.hdr }) },
        {
          label: 'Audio',
          value: a ? a.codec : 'none',
          ...(a && {
            unit: `${String(a.sampleRate / 1000)} kHz ${CHANNELS[a.channels] ?? ''}`.trim(),
          }),
        },
      ],
    };
  },
};
