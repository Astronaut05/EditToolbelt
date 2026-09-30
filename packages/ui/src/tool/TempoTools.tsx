'use client';

import { addTap, tapBpm } from '@etb/engines';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../primitives/Button';
import { NumberWithUnit, Select } from '../primitives/fields';
import { OptionRow } from '../primitives/OptionsPanel';

type Sound = 'click' | 'beep' | 'wood';

const SOUNDS: Record<Sound, { wave: OscillatorType; hz: number; accentHz: number; ms: number }> = {
  click: { wave: 'square', hz: 1000, accentHz: 1500, ms: 15 },
  beep: { wave: 'sine', hz: 880, accentHz: 1320, ms: 60 },
  wood: { wave: 'triangle', hz: 600, accentHz: 900, ms: 30 },
};

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      aria-label={label}
      className="w-40"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** How far ahead the metronome schedules clicks, and how often it looks. */
const AHEAD_S = 0.12;
const TICK_MS = 25;

/**
 * A03's tap tempo pad and metronome, shown by ToolShell under the settings
 * (`preset.tempo`). Tap with the pad or the T key; the metronome schedules
 * its clicks on the Web Audio clock, so they stay steady when the page is busy.
 */
export function TempoTools({ className }: { className?: string }) {
  const [taps, setTaps] = useState<number[]>([]);
  const [bpm, setBpm] = useState('120');
  const [beats, setBeats] = useState('4');
  const [accent, setAccent] = useState('on');
  const [sound, setSound] = useState<Sound>('click');
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(-1);
  const audio = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The scheduler reads the latest settings, so changes apply while it plays.
  const settings = useRef<{ bpm: number; beats: number; accent: boolean; sound: Sound }>({
    bpm: 120,
    beats: 4,
    accent: true,
    sound: 'click',
  });
  useEffect(() => {
    settings.current = {
      bpm: Math.min(240, Math.max(40, Number(bpm) || 120)),
      beats: Number(beats) || 4,
      accent: accent === 'on',
      sound,
    };
  }, [bpm, beats, accent, sound]);
  const tapped = tapBpm(taps);

  const tap = useCallback(() => {
    setTaps((current) => addTap(current, performance.now()));
  }, []);

  // T taps from anywhere on the page, except while typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 't' || event.key === 'T') tap();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [tap]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
    setBeat(-1);
  }, []);

  const start = useCallback(() => {
    audio.current ??= new AudioContext();
    const ctx = audio.current;
    void ctx.resume();
    let next = ctx.currentTime + 0.05;
    let count = 0;
    setPlaying(true);
    timer.current = setInterval(() => {
      const { bpm: tempo, beats: perBar, accent: accented, sound: kind } = settings.current;
      while (next < ctx.currentTime + AHEAD_S) {
        const first = count % perBar === 0;
        const voice = SOUNDS[kind];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = voice.wave;
        osc.frequency.value = first && accented ? voice.accentHz : voice.hz;
        gain.gain.setValueAtTime(first && accented ? 0.6 : 0.35, next);
        gain.gain.exponentialRampToValueAtTime(0.0001, next + voice.ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(next);
        osc.stop(next + voice.ms / 1000 + 0.01);
        const shown = count % perBar;
        const delay = Math.max(0, (next - ctx.currentTime) * 1000);
        setTimeout(() => {
          setBeat(shown);
        }, delay);
        next += 60 / tempo;
        count += 1;
      }
    }, TICK_MS);
  }, []);

  useEffect(() => stop, [stop]);

  return (
    <div className={className}>
      <h2 className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
        Tap tempo
      </h2>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={tap}
          aria-describedby="tap-help"
          className="size-24 flex-none rounded-card border border-border bg-surface text-18 font-medium hover:border-text-muted active:bg-border"
        >
          Tap
        </button>
        <div>
          <p aria-live="polite" className="font-mono text-24 font-medium text-text">
            {tapped ? `${String(Math.round(tapped))} BPM` : '—'}
          </p>
          <p id="tap-help" className="mt-1 text-13 leading-body text-text-muted">
            {taps.length < 3
              ? 'Tap along 4 times or more, or press T.'
              : `${String(taps.length)} taps. Stop for 3 s to start over.`}
          </p>
          {tapped && (
            <button
              type="button"
              onClick={() => {
                setBpm(String(Math.round(tapped)));
              }}
              className="mt-1 min-h-11 text-13 text-text underline underline-offset-2"
            >
              Use for the metronome
            </button>
          )}
        </div>
      </div>

      <h2 className="mt-8 font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
        Metronome
      </h2>
      <div className="mt-2">
        <OptionRow label="Tempo">
          <NumberWithUnit
            aria-label="Tempo"
            unit="BPM"
            min={40}
            max={240}
            value={bpm}
            onChange={(event) => {
              setBpm(event.target.value);
            }}
          />
        </OptionRow>
        <OptionRow label="Beats">
          <Choice
            label="Beats"
            value={beats}
            onChange={setBeats}
            options={[
              { value: '2', label: '2/4' },
              { value: '3', label: '3/4' },
              { value: '4', label: '4/4' },
              { value: '6', label: '6/8' },
            ]}
          />
        </OptionRow>
        <OptionRow label="Accent">
          <Choice
            label="Accent"
            value={accent}
            onChange={setAccent}
            options={[
              { value: 'on', label: 'First beat' },
              { value: 'off', label: 'None' },
            ]}
          />
        </OptionRow>
        <OptionRow label="Sound">
          <Choice
            label="Sound"
            value={sound}
            onChange={(value) => {
              setSound(value as Sound);
            }}
            options={[
              { value: 'click', label: 'Click' },
              { value: 'beep', label: 'Beep' },
              { value: 'wood', label: 'Wood block' },
            ]}
          />
        </OptionRow>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Button variant="secondary" aria-pressed={playing} onClick={playing ? stop : start}>
          {playing ? 'Stop' : 'Start'}
        </Button>
        <span aria-hidden="true" className="flex gap-1.5">
          {Array.from({ length: Number(beats) || 4 }, (_, i) => (
            <span
              key={i}
              className={
                i === beat
                  ? 'size-3 rounded-full bg-accent'
                  : 'size-3 rounded-full border border-border'
              }
            />
          ))}
        </span>
      </div>
    </div>
  );
}
