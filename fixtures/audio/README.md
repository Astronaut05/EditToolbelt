# Audio fixtures

Made for EditToolbelt's tests from nothing but maths, so there is no recording and no licence to worry about: public domain.

- `noisy-speech.wav`: 6 s, 48 kHz, mono, 16-bit. A speech-like voice (a glottal pulse train through the formants of five vowels, words of 3 to 5 syllables at −23 to −17 dBFS, some led by an "s", pauses of 0.5 to 0.9 s between words) with white noise at about −34 dBFS and 50 Hz mains hum with its 2nd and 3rd harmonics. For Noise Reduction (A10): the worker's tests regenerate the clean voice to measure how much cleaner the result is, and the server e2e test drops this file.

Written by the seeded generator in `apps/worker/tests/noisy_speech.py`:

```sh
cd apps/worker && uv run python -m tests.noisy_speech ../../fixtures/audio
```

A test checks the committed file still matches the generator.
