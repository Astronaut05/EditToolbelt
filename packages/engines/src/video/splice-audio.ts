/**
 * Joins the kept spans of an audio track end to end (A02 Trim Audio, V01 Trim
 * Video). It decodes only the stretches the spans need, runs them through
 * @etb/core's Splicer (a 10 ms crossfade centred on every join, optional fades
 * at the ends) and hands out blocks on one timeline from 0, exactly as long as
 * the spans, so video cut at the same points stays in sync.
 */
import { Splicer, type Span } from '@etb/core';
import { AudioSample, AudioSampleSink, type InputAudioTrack } from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { MediaInputError } from './media';

export interface SpliceAudioOptions {
  /** The kept spans of the source, seconds, in order and apart. */
  spans: readonly Span[];
  /** Crossfade at each join, seconds (default 10 ms). */
  crossfade?: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** Plays `spans` of `track` end to end into `add`. */
export async function spliceAudio(
  track: InputAudioTrack,
  options: SpliceAudioOptions,
  add: (sample: AudioSample) => Promise<void>,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<void> {
  const duration = await track.computeDuration();
  const make = (rate: number, channels: number) =>
    new Splicer({ ...options, rate, channels, duration });
  // The track's own rate plans what to decode; the decoder's decides the rest
  // (HE-AAC decodes at twice the rate its header gives).
  let rate = await track.getSampleRate();
  const windows = make(rate, await track.getNumberOfChannels()).windows;
  let splicer: Splicer | null = null;

  const emit = async (out: { planes: Float32Array[]; at: number } | null) => {
    const frames = out?.planes[0]?.length ?? 0;
    if (!out || !splicer || frames === 0) return;
    const data = new Float32Array(frames * out.planes.length);
    out.planes.forEach((plane, c) => {
      data.set(plane, c * frames);
    });
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: out.planes.length,
      sampleRate: rate,
      timestamp: out.at / rate,
    });
    try {
      await add(sample);
    } finally {
      sample.close();
    }
    progress(Math.min(1, (out.at + frames) / splicer.length));
  };

  const sink = new AudioSampleSink(track);
  for (const window of windows) {
    // The next source frame this window expects: blocks are kept back to back.
    let next = -Infinity;
    for await (const decoded of sink.samples(window.start, window.end)) {
      try {
        if (signal.aborted) throw new EngineAbortError();
        if (!splicer) {
          rate = decoded.sampleRate;
          splicer = make(rate, decoded.numberOfChannels);
        }
        const frames = decoded.numberOfFrames;
        let first = Math.round(decoded.timestamp * rate);
        // A frame or two either way is timestamp rounding.
        if (Math.abs(first - next) <= 2) first = next;
        const from = Math.max(first, Math.round(window.start * rate), next);
        const to = Math.min(first + frames, Math.round(window.end * rate));
        if (to <= from) continue;
        const planes = Array.from({ length: decoded.numberOfChannels }, (_, c) => {
          const plane = new Float32Array(to - from);
          decoded.copyTo(plane, {
            planeIndex: c,
            format: 'f32-planar',
            frameOffset: from - first,
            frameCount: to - from,
          });
          return plane;
        });
        await emit(splicer.push(planes, from));
        next = to;
      } finally {
        decoded.close();
      }
    }
  }
  if (!splicer) throw new MediaInputError('No audio could be decoded from this file.');
  await emit(splicer.finish());
}
