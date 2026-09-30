/**
 * A03 BPM & Key Finder: the track is decoded, mixed to mono and brought down
 * to 22.05 kHz, then @etb/core finds the tempo, the beats and the key. The
 * download is the beat markers (CSV or plain text), for cutting to the beat.
 */
import { beatMarkers, detectKey, detectTempo, type TempoRange } from '@etb/core';
import { AudioSampleSink } from 'mediabunny';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import { codecLabel, MediaInputError, openInput } from '../video/media';
import { AUDIO_LIMITS } from './convert';

export interface BpmKeyOptions {
  /** auto, slow (60-90), mid (90-140) or fast (140-200) */
  range?: string;
  /** csv or txt: the beat markers file */
  markers?: string;
}

export const ANALYSIS_RATE = 22_050;

/**
 * Mono at `rate`: channels averaged, then each output sample the mean of the
 * input samples it covers (a box filter, enough to keep aliasing out of
 * tempo and key analysis).
 */
export class Downmix {
  private out: number[] = [];
  private acc = 0;
  private count = 0;
  private position = 0;

  constructor(
    private readonly from: number,
    private readonly rate = ANALYSIS_RATE,
  ) {}

  push(planes: Float32Array[]): void {
    const frames = planes[0]?.length ?? 0;
    const step = this.from / this.rate;
    for (let i = 0; i < frames; i += 1) {
      let v = 0;
      for (const plane of planes) v += plane[i] ?? 0;
      this.acc += v / planes.length;
      this.count += 1;
      this.position += 1;
      if (this.position >= step) {
        this.position -= step;
        this.out.push(this.acc / this.count);
        this.acc = 0;
        this.count = 0;
      }
    }
  }

  result(): Float32Array {
    return Float32Array.from(this.out);
  }
}

const RANGES: TempoRange[] = ['auto', 'slow', 'mid', 'fast'];

export const bpmKeyEngine: Engine<BpmKeyOptions> = {
  capabilities: () => ({
    supported: typeof AudioDecoder === 'function',
    reason: 'This browser can’t read audio yet. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: (input) => ({ seconds: Math.max(1, input.size / 20_000_000) }),
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > AUDIO_LIMITS.maxBytes) {
      throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
    }
    const input = openInput(file);
    let samples: Float32Array;
    let duration: number;
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new MediaInputError('This file has no audio in it.');
      if (!(await track.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode the ${codecLabel(await track.getCodec())} audio in this file.`,
        );
      }
      duration = await input.computeDuration();
      if (duration > 30 * 60) {
        throw new MediaInputError('This is over 30 minutes long. Trim it to one song first.');
      }
      const mix = new Downmix(await track.getSampleRate());
      for await (const sample of new AudioSampleSink(track).samples()) {
        if (ctx.signal.aborted) {
          sample.close();
          throw new EngineAbortError();
        }
        const planes = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
          return plane;
        });
        mix.push(planes);
        ctx.progress(Math.min(0.8, (sample.timestamp / duration) * 0.8), 'Reading the audio');
        sample.close();
      }
      samples = mix.result();
    } finally {
      input.dispose();
    }
    if (samples.length < ANALYSIS_RATE * 4) {
      throw new MediaInputError('This is under 4 seconds long: too short to find a tempo.');
    }
    ctx.progress(0.85, 'Finding the tempo');
    const range = RANGES.includes(opts.range as TempoRange) ? (opts.range as TempoRange) : 'auto';
    const tempo = detectTempo(samples, ANALYSIS_RATE, range);
    ctx.progress(0.95, 'Finding the key');
    const key = detectKey(samples, ANALYSIS_RATE);
    const format = opts.markers === 'txt' ? 'txt' : 'csv';
    const percent = (v: number) => `${String(Math.round(v * 100))} %`;
    const bpm = Number.isInteger(tempo.bpm) ? String(tempo.bpm) : tempo.bpm.toFixed(1);
    return {
      blob: new Blob([beatMarkers(tempo.beats, format)], {
        type: format === 'csv' ? 'text/csv' : 'text/plain',
      }),
      ext: format,
      durationSec: duration,
      path: 'Browser',
      notes: [
        tempo.confidence < 0.3
          ? 'Low tempo confidence: the beat isn’t steady or clear. Tap along to check it.'
          : `${String(tempo.beats.length)} beats marked, from ${tempo.beats[0]?.toFixed(2) ?? '0'} s`,
        ...(key.confidence < 0.4
          ? ['Low key confidence: the music may change key, or be mostly drums.']
          : []),
      ],
      details: [
        { label: 'Tempo', value: `${bpm} BPM` },
        {
          label: 'Or',
          value: tempo.alternatives.map((b) => `${String(b)} BPM`).join(' · ') || 'none',
        },
        { label: 'Key', value: key.name },
        { label: 'Camelot', value: key.camelot },
        { label: 'Tempo confidence', value: percent(tempo.confidence) },
        { label: 'Key confidence', value: percent(key.confidence) },
      ],
    };
  },
};
