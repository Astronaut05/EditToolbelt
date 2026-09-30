import { describe, expect, it } from 'vitest';

import { beatMarkers, detectKey, detectTempo, fft, keyFromChroma, keysRelated } from './analysis';

const RATE = 22_050;

/** A seeded noise source, so the fixtures are the same every run. */
function noise(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (x / 2_147_483_648) * 2 - 1;
  };
}

/** A drum loop: kick on 1 and 3, snare on 2 and 4, hi-hat on every eighth. */
function drums(bpm: number, seconds: number, seed: number): Float32Array {
  const out = new Float32Array(seconds * RATE);
  const rand = noise(seed);
  const beat = (60 / bpm) * RATE;
  const add = (at: number, length: number, sample: (i: number) => number) => {
    for (let i = 0; i < length && at + i < out.length; i += 1) {
      out[Math.round(at) + i] = (out[Math.round(at) + i] ?? 0) + sample(i);
    }
  };
  for (let b = 0; b * beat < out.length; b += 1) {
    const t = b * beat;
    if (b % 2 === 0) {
      // Kick: a falling sine, 120 ms.
      add(t, 0.12 * RATE, (i) => {
        const s = i / RATE;
        return Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-s * 30)) * s) * Math.exp(-s * 25);
      });
    } else {
      add(t, 0.08 * RATE, (i) => rand() * 0.6 * Math.exp((-i / RATE) * 40));
    }
    for (const half of [0, 0.5]) {
      add(t + half * beat, 0.03 * RATE, (i) => rand() * 0.25 * Math.exp((-i / RATE) * 120));
    }
  }
  return out;
}

const NOTE = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Chords as sums of harmonic tones; each chord `seconds` long. */
function chords(progression: number[][], seconds: number): Float32Array {
  const per = Math.round(seconds * RATE);
  const out = new Float32Array(per * progression.length);
  progression.forEach((notes, c) => {
    for (const midi of notes) {
      const f = NOTE(midi);
      for (let i = 0; i < per; i += 1) {
        const t = i / RATE;
        const env = Math.min(1, t * 50) * Math.exp(-t * 1.5);
        let v = 0;
        for (let h = 1; h <= 4; h += 1) v += Math.sin(2 * Math.PI * f * h * t) / h;
        out[c * per + i] = (out[c * per + i] ?? 0) + (v * env) / 6;
      }
    }
  });
  return out;
}

/** I–IV–V–I in major, i–iv–V–i in (harmonic) minor, bass an octave down, twice. */
function cadence(tonic: number, mode: 'major' | 'minor'): Float32Array {
  const root = 48 + tonic;
  const third = mode === 'major' ? 4 : 3;
  const triad = (r: number, t: number) => [r - 12, r, r + t, r + 7];
  const one = triad(root, third);
  const four = triad(root + 5, third);
  const five = triad(root + 7, 4); // V is major in both
  return chords([one, four, five, one, one, four, five, one], 1);
}

describe('FFT', () => {
  it('finds a sine in its bin', () => {
    const n = 1024;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 64 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k] ?? 0, im[k] ?? 0));
    expect(mags.indexOf(Math.max(...mags))).toBe(64);
    expect(mags[64]).toBeCloseTo(n / 2, 6);
  });
});

describe('tempo', () => {
  // 30 drum loops from 72 to 174 BPM. The spec's bar: within ±1 BPM of the label, or
  // exactly half or double, for ≥ 90 %.
  const TEMPOS = [
    72, 78, 85, 88, 92, 95, 98, 100, 104, 108, 110, 112, 115, 118, 120, 122, 124, 126, 128, 130,
    132, 135, 138, 140, 145, 150, 160, 165, 170, 174,
  ];

  it('gets ≥ 90 % of 30 drum loops right (baseline: 30 of 30)', () => {
    const misses: string[] = [];
    TEMPOS.forEach((label, i) => {
      const { bpm } = detectTempo(drums(label, 20, i + 1), RATE);
      const ok = [label, label / 2, label * 2].some((l) => Math.abs(bpm - l) <= 1);
      if (!ok) misses.push(`${String(label)} → ${String(bpm)}`);
    });
    expect(misses, misses.join(', ')).toHaveLength(0);
  }, 60_000);

  it('reads the exact tempo, not a multiple, in the usual range', () => {
    const { bpm, alternatives, confidence } = detectTempo(drums(128, 20, 9), RATE);
    expect(Math.abs(bpm - 128)).toBeLessThanOrEqual(0.5);
    // Half tempo; double (256) is past 240.
    expect(alternatives).toEqual([Math.round((bpm / 2) * 10) / 10]);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it('keeps to the range it is given', () => {
    const { bpm } = detectTempo(drums(87, 20, 3), RATE, 'fast');
    expect(Math.abs(bpm - 174)).toBeLessThanOrEqual(1);
  });

  it('puts beats on the kicks and snares', () => {
    const { beats } = detectTempo(drums(120, 10, 5), RATE);
    expect(beats.length).toBeGreaterThanOrEqual(19);
    for (const t of beats.slice(1, 10)) {
      const off = Math.abs(t / 0.5 - Math.round(t / 0.5)) * 0.5;
      expect(off).toBeLessThan(0.03);
    }
    expect(beatMarkers([0.5, 1], 'csv')).toBe('beat,seconds\n1,0.500\n2,1.000\n');
    expect(beatMarkers([0.5, 1], 'txt')).toBe('0.500\n1.000\n');
  });
});

describe('key', () => {
  it('gets ≥ 75 % of 30 progressions right or related (baseline: 30 of 30)', () => {
    const cases: { tonic: number; mode: 'major' | 'minor'; audio: Float32Array }[] = [];
    for (let tonic = 0; tonic < 12; tonic += 1) {
      cases.push({ tonic, mode: 'major', audio: cadence(tonic, 'major') });
      cases.push({ tonic, mode: 'minor', audio: cadence(tonic, 'minor') });
    }
    // Six pop loops (vi–IV–I–V): the key is the major one.
    for (const tonic of [0, 2, 4, 7, 9, 10]) {
      const r = 48 + tonic;
      cases.push({
        tonic,
        mode: 'major',
        audio: chords(
          [
            [r + 9 - 12, r + 9, r + 12, r + 16],
            [r + 5 - 12, r + 5, r + 9, r + 12],
            [r - 12, r, r + 4, r + 7],
            [r + 7 - 12, r + 7, r + 11, r + 14],
          ],
          1,
        ),
      });
    }
    let exact = 0;
    let related = 0;
    for (const c of cases) {
      const key = detectKey(c.audio, RATE);
      if (key.tonic === c.tonic && key.mode === c.mode) exact += 1;
      if (keysRelated(key, c)) related += 1;
    }
    expect(related / cases.length).toBeGreaterThanOrEqual(0.75);
    expect(exact).toBeGreaterThanOrEqual(24);
  }, 60_000);

  it('names keys and Camelot codes', () => {
    const aMinor = keyFromChroma([0.8, 0.1, 0.5, 0.2, 0.9, 0.3, 0.1, 0.5, 0.4, 1, 0.1, 0.3]);
    expect(aMinor).toMatchObject({ name: 'A minor', camelot: '8A' });
    const eFlat = detectKey(cadence(3, 'major'), RATE);
    expect(eFlat).toMatchObject({ name: 'E♭ major', camelot: '5B' });
    expect(keysRelated({ tonic: 0, mode: 'major' }, { tonic: 9, mode: 'minor' })).toBe(true);
    expect(keysRelated({ tonic: 0, mode: 'major' }, { tonic: 7, mode: 'major' })).toBe(true);
    expect(keysRelated({ tonic: 0, mode: 'major' }, { tonic: 6, mode: 'major' })).toBe(false);
  });
});
