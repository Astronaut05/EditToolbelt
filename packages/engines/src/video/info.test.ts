import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  aspectLabel,
  bitrateLabel,
  clock,
  describeCodecString,
  reportText,
  videoInfoEngine,
  videoReport,
} from './info';

const fixture = (name: string) =>
  new Blob([
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/video/${name}`, import.meta.url))),
  ]);

const ctx = { signal: new AbortController().signal, progress: () => undefined };

describe('Video Info', () => {
  it('reads the CFR fixture as constant, SDR and ready to edit', async () => {
    const report = await videoReport(fixture('clip-h264-aac.mp4'), 'clip-h264-aac.mp4');
    expect(report.file.container).toBe('MP4');
    expect(report.video).toMatchObject({
      codec: 'H.264',
      profile: 'Main, level 1.2',
      width: 256,
      height: 144,
      displayAspect: '16:9',
      pixelAspect: '1:1 (square)',
      fps: 30,
      frameRate: 'constant',
      frames: 900,
      hdr: null,
      rotation: 0,
    });
    expect(report.audio).toEqual([
      expect.objectContaining({ codec: 'AAC', channels: 2, sampleRate: 48000 }),
    ]);
    expect(report.verdicts[0]).toBe('Constant frame rate, SDR, no rotation: ready to edit.');
  });

  it('flags the phone-style VFR fixture', async () => {
    const report = await videoReport(fixture('clip-vfr.mp4'));
    expect(report.video?.frameRate).toBe('variable');
    expect(report.verdicts[0]).toMatch(/^Variable frame rate \(about 28\.\d+ fps\): it may drift/);
    expect(report.verdicts).toContain('No audio track.');
  });

  it('reports the HDR fixture’s transfer', async () => {
    const report = await videoReport(fixture('clip-hlg.mp4'));
    expect(report.video).toMatchObject({
      colorPrimaries: 'bt2020',
      transfer: 'hlg',
      matrix: 'bt2020-ncl',
      hdr: 'HLG',
      frameRate: 'constant',
    });
    expect(report.verdicts.some((v) => v.startsWith('HDR (HLG): it will look washed out'))).toBe(
      true,
    );
  });

  it('writes text and JSON', async () => {
    const text = await (
      await videoInfoEngine.run(new File([fixture('clip-vp9-opus.webm')], 'c.webm'), {}, ctx)
    ).blob.text();
    expect(text).toMatch(/^FILE\nName {14}c\.webm\nContainer {9}WebM/);
    expect(text).toContain('VIDEO\nCodec             VP9 (Profile 0, level 1)');
    expect(text).toContain('AUDIO\nCodec             Opus');
    const json = await videoInfoEngine.run(fixture('clip-h264-aac.mp4'), { format: 'json' }, ctx);
    expect(json.ext).toBe('json');
    expect(JSON.parse(await json.blob.text())).toMatchObject({ video: { fps: 30 } });
    expect(json.details?.map((d) => d.label)).toEqual([
      'Resolution',
      'Frame rate',
      'Duration',
      'Bitrate',
      'Video',
      'Audio',
    ]);
  });

  it('decodes codec strings, aspect ratios and labels', () => {
    expect(describeCodecString('avc1.64001f')).toEqual({
      profile: 'High, level 3.1',
      bitDepth: null,
    });
    expect(describeCodecString('hvc1.2.4.L153.B0').profile).toBe('Main 10, level 5.1');
    expect(describeCodecString('av01.0.08M.10')).toEqual({
      profile: 'Main, level 4.0',
      bitDepth: 10,
    });
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(1080, 1350)).toBe('4:5');
    expect(aspectLabel(1000, 700)).toBe('10:7');
    expect(clock(62.5)).toBe('00:01:02.500');
    expect(bitrateLabel(12_400_000)).toBe('12.4 Mbps');
    expect(bitrateLabel(192_000)).toBe('192 kbps');
    expect(reportText).toBeTypeOf('function');
  });
});
