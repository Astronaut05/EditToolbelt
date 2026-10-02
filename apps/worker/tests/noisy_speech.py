"""A speech-like test signal, made from nothing (no recordings, so no licence).

Syllables are a glottal pulse train (F0 105-165 Hz with a little vibrato)
through three formant resonators of one of five vowels, some led by a short
"s" (high-passed noise); words of 3-5 syllables, with 0.5-0.9 s pauses
between them, which is what a noise estimate needs. Each syllable is set to
-23 to -17 dBFS RMS. The noise is white or pink (Paul Kellet's filter) plus
mains hum at 50 Hz with its 2nd and 3rd harmonics. Everything is seeded, so
the same call gives the same samples.

``python -m tests.noisy_speech DIR`` writes the committed fixture
(fixtures/audio/noisy-speech.wav) and its clean reference.
"""

from __future__ import annotations

import math
import random
import sys
import wave
from array import array
from pathlib import Path

#: F1, F2, F3 (Hz) of a, e, i, o, u.
VOWELS = (
    (730, 1090, 2440),
    (530, 1840, 2480),
    (270, 2290, 3010),
    (570, 840, 2410),
    (300, 870, 2240),
)


def _resonator(freq: float, bandwidth: float, rate: int) -> tuple[float, float, float]:
    radius = math.exp(-math.pi * bandwidth / rate)
    theta = 2 * math.pi * freq / rate
    return 1 - radius, -2 * radius * math.cos(theta), radius * radius


def _syllable(rate: int, length: int, vowel: tuple[int, ...], f0: float) -> array[float]:
    out = array("f", bytes(4 * length))
    coeffs = [_resonator(freq, 60 + 30 * k, rate) for k, freq in enumerate(vowel)]
    states = [[0.0, 0.0] for _ in vowel]
    phase = glottal = 0.0
    for k in range(length):
        phase += f0 * (1 + 0.08 * math.sin(2 * math.pi * 3 * k / rate)) / rate
        pulse = 0.0
        if phase >= 1:
            phase -= 1
            pulse = 1.0
        glottal = 0.7 * glottal + pulse
        value = glottal
        for (gain, a1, a2), state in zip(coeffs, states, strict=True):
            filtered = gain * value - a1 * state[0] - a2 * state[1]
            state[1], state[0] = state[0], filtered
            value = filtered
        out[k] = min(1.0, k / (0.02 * rate), (length - k) / (0.03 * rate)) * value
    return out


def speech(rate: int, seconds: float, seed: int = 7) -> array[float]:
    """Mono speech-like samples, -1..1."""
    rng = random.Random(seed)  # noqa: S311  # test signal, not a secret
    total = int(rate * seconds)
    out = array("f", bytes(4 * total))
    t = 0.25
    while t < seconds - 0.3:
        for _ in range(rng.randint(3, 5)):
            length_sec = rng.uniform(0.16, 0.26)
            if t + length_sec > seconds - 0.2:
                break
            start = int(t * rate)
            length = int(length_sec * rate)
            vowel, f0 = rng.choice(VOWELS), rng.uniform(105, 165)
            if rng.random() < 0.3:  # an "s" before it
                hiss = int(0.07 * rate)
                previous = smooth = 0.0
                for i in range(max(0, start - hiss), start):
                    white = rng.gauss(0, 1)
                    smooth = 0.6 * smooth + 0.4 * (white - previous)
                    previous = white
                    out[i] += 0.15 * math.sin(math.pi * (i - start + hiss) / hiss) * smooth
            syllable = _syllable(rate, length, vowel, f0)
            rms = math.sqrt(sum(v * v for v in syllable) / length) or 1.0
            gain = 10 ** (rng.uniform(-23, -17) / 20) / rms
            for k, value in enumerate(syllable):
                out[start + k] += gain * value
            t += length_sec + rng.uniform(0.04, 0.09)
        t += rng.uniform(0.5, 0.9)
    return out


def noise(  # noqa: PLR0913  # the keywords are the noise's settings
    rate: int,
    frames: int,
    *,
    level: float = 0.02,
    hum: float = 0.03,
    mains: float = 50.0,
    pink: bool = False,
    seed: int = 11,
) -> array[float]:
    """White (or pink) noise at ``level`` RMS-ish, plus hum at ``mains`` Hz and 2 harmonics."""
    rng = random.Random(seed)  # noqa: S311  # test signal, not a secret
    out = array("f", bytes(4 * frames))
    b = [0.0] * 7
    for i in range(frames):
        t = i / rate
        buzz = hum * (
            math.sin(2 * math.pi * mains * t)
            + 0.5 * math.sin(2 * math.pi * 2 * mains * t + 0.3)
            + 0.3 * math.sin(2 * math.pi * 3 * mains * t + 1.1)
        )
        white = rng.gauss(0, 1)
        if pink:
            b[0] = 0.99886 * b[0] + white * 0.0555179
            b[1] = 0.99332 * b[1] + white * 0.0750759
            b[2] = 0.96900 * b[2] + white * 0.1538520
            b[3] = 0.86650 * b[3] + white * 0.3104856
            b[4] = 0.55000 * b[4] + white * 0.5329522
            b[5] = -0.7616 * b[5] - white * 0.0168980
            mixed = (sum(b) + white * 0.5362) * 0.11
            b[6] = white * 0.115926
            white = mixed
        out[i] = level * white + buzz
    return out


def mix(*signals: array[float], gain: float = 1.0) -> array[float]:
    return array("f", (gain * sum(values) for values in zip(*signals, strict=True)))


def write_wav(path: Path, channels: list[array[float]], rate: int) -> Path:
    """16-bit PCM WAV, one array per channel."""
    frames = len(channels[0])
    data = array("h", bytes(2 * frames * len(channels)))
    for i in range(frames):
        for c, channel in enumerate(channels):
            data[i * len(channels) + c] = max(-32768, min(32767, round(channel[i] * 32767)))
    if sys.byteorder == "big":
        data.byteswap()
    with wave.open(str(path), "wb") as out:
        out.setnchannels(len(channels))
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(data.tobytes())
    return path


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    clean = speech(48000, 6.0)
    write_wav(folder / "noisy-speech.wav", [mix(clean, noise(48000, len(clean)))], 48000)
