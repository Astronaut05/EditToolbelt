'use client';

import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '../cn';
import { Button } from '../primitives/Button';
import { Slider } from '../primitives/fields';
import { MonoLabel } from '../primitives/MonoLabel';
import { SegmentedControl } from '../primitives/SegmentedControl';

type Side = 'original' | 'result';

interface Loaded {
  context: AudioContext;
  buffers: Record<Side, AudioBuffer>;
  gains: Record<Side, GainNode>;
  sources: AudioBufferSourceNode[];
  /** context.currentTime when position 0 last played. */
  zero: number;
}

const SIDES = [
  { value: 'original' as const, label: 'Original' },
  { value: 'result' as const, label: 'Cleaned' },
];

/** Switching sides fades over this long (s): no click, and too short to hear as a fade. */
const SWITCH_SEC = 0.008;

function clock(seconds: number): string {
  const whole = Math.max(0, seconds);
  return `${String(Math.floor(whole / 60))}:${(whole % 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * The audio A/B toggle (docs/03 → BeforeAfter): two versions of one snippet,
 * playing together and looping, one heard at a time, so switching keeps the
 * place. Web Audio, so the two stay sample-aligned; it starts on the first
 * press of Play (browsers allow sound only after a gesture). Give each new
 * preview its own `key`, so it starts from the top.
 */
export function ABPlayer({
  original,
  result,
  fromSec,
  durationSec,
  className,
}: {
  original: Blob;
  result: Blob;
  /** Where the snippet starts in the file, and how long it is, seconds. */
  fromSec: number;
  durationSec: number;
  className?: string;
}) {
  const [side, setSide] = useState<Side>('result');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const audio = useRef<Loaded | null>(null);
  /** The one decode in flight: a second Play while it runs waits for it, never starts another. */
  const loading = useRef<Promise<Loaded> | null>(null);
  const mounted = useRef(true);
  const sideRef = useRef(side);
  const frame = useRef(0);

  const stop = useCallback(() => {
    const now = audio.current;
    if (!now) return;
    for (const source of now.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    now.sources = [];
    cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
      void audio.current?.context.close();
      audio.current = null;
    };
  }, [stop]);

  const load = useCallback(async (): Promise<Loaded> => {
    const context = new AudioContext();
    try {
      const [a, b] = await Promise.all(
        [original, result].map(async (blob) => context.decodeAudioData(await blob.arrayBuffer())),
      );
      if (!a || !b) throw new Error('nothing decoded');
      const gains = { original: context.createGain(), result: context.createGain() };
      gains.original.connect(context.destination);
      gains.result.connect(context.destination);
      return { context, buffers: { original: a, result: b }, gains, sources: [], zero: 0 };
    } catch (error) {
      void context.close();
      throw error;
    }
  }, [original, result]);

  const start = useCallback(
    async (at: number) => {
      try {
        if (!audio.current) {
          loading.current ??= load();
          const loaded = await loading.current.finally(() => {
            loading.current = null;
          });
          if (!mounted.current) {
            loaded.context.close().catch(() => undefined);
            return;
          }
          audio.current ??= loaded;
          setDuration(Math.min(loaded.buffers.original.duration, loaded.buffers.result.duration));
        }
        const now = audio.current;
        await now.context.resume();
        // After the await: a second Play that got here first is stopped, so one set plays.
        stop();
        const length = Math.min(now.buffers.original.duration, now.buffers.result.duration);
        const offset = at % length;
        const when = now.context.currentTime + 0.02;
        for (const each of ['original', 'result'] as const) {
          now.gains[each].gain.value = sideRef.current === each ? 1 : 0;
          const source = now.context.createBufferSource();
          source.buffer = now.buffers[each];
          source.loop = true;
          source.loopEnd = length;
          source.connect(now.gains[each]);
          source.start(when, offset);
          now.sources.push(source);
        }
        now.zero = when - offset;
        const tick = () => {
          setPosition((now.context.currentTime - now.zero) % length);
          frame.current = requestAnimationFrame(tick);
        };
        frame.current = requestAnimationFrame(tick);
        setPlaying(true);
      } catch {
        setFailed(true);
        setPlaying(false);
      }
    },
    [load, stop],
  );

  const pause = useCallback(() => {
    stop();
    setPlaying(false);
  }, [stop]);

  const choose = (next: Side) => {
    setSide(next);
    sideRef.current = next;
    const now = audio.current;
    if (!now) return;
    const at = now.context.currentTime;
    for (const each of ['original', 'result'] as const) {
      now.gains[each].gain.setTargetAtTime(each === next ? 1 : 0, at, SWITCH_SEC / 3);
    }
  };

  const length = duration || durationSec;
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <MonoLabel>
          Preview · {clock(fromSec)} to {clock(fromSec + length)}
        </MonoLabel>
        <span className="font-mono text-12.5 text-text-muted" aria-hidden="true">
          {clock(position)} / {clock(length)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            if (playing) pause();
            else void start(position);
          }}
          icon={
            playing ? (
              <Pause aria-hidden="true" size={18} strokeWidth={2} />
            ) : (
              <Play aria-hidden="true" size={18} strokeWidth={2} />
            )
          }
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <SegmentedControl label="Listen to" options={SIDES} value={side} onChange={choose} />
      </div>
      <Slider
        aria-label="Position in the preview"
        aria-valuetext={`${clock(position)} of ${clock(length)}`}
        min={0}
        max={length}
        step={0.1}
        value={Math.min(position, length)}
        onChange={(event) => {
          const at = Number(event.target.value);
          setPosition(at);
          if (playing) void start(at);
        }}
        className="w-full"
      />
      <p className="text-14 leading-body text-text-muted" role="status">
        {failed
          ? 'This browser couldn’t play the preview.'
          : side === 'result'
            ? 'You’re hearing the cleaned version. Switch to Original to compare; it keeps the place.'
            : 'You’re hearing the original. Switch to Cleaned to compare; it keeps the place.'}
      </p>
    </div>
  );
}
