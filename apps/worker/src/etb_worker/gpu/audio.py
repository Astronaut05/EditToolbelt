"""Sound in for the transcription function (A12 Transcribe Audio, V17 Auto Subtitles).

Whisper's own loader runs ffmpeg to the end of the file, however long it
turns out to be. Here ffmpeg makes the same samples (16 kHz mono, 16-bit),
but reads only the input's first ``max_seconds``: what the job was priced
for, which the worker works out from its probe. A file whose header says
less than it holds (a patched FLAC or MKV, a concatenated MP3) is cut there,
and the result says so, instead of being transcribed in full.

Standard library only, like video.py: the Whisper image has ffmpeg and
Python, and the worker's tests run this against the worker's own ffmpeg.
ffmpeg's messages are never read back: they can name what's in a file.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from etb_worker.gpu.remote import CallFailed, guard_inputs, length_label

FFMPEG = "ffmpeg"
#: Whisper's rate (whisper.audio.SAMPLE_RATE), one channel, 16-bit samples.
SAMPLE_RATE = 16_000
_BYTES_PER_SECOND = SAMPLE_RATE * 2
#: Decoding stopped this close to the cap: it stopped at the cap, not at the file's end.
_AT_CAP_SEC = 0.5
#: Four hours of sound decode in a few minutes; this only stops a decoder that hangs.
_DECODE_TIMEOUT_SEC = 30 * 60


def decode_args(source: Path, max_seconds: float) -> list[str]:
    """Whisper's ffmpeg command (whisper.audio.load_audio), reading ``max_seconds`` at most."""
    if max_seconds <= 0:
        raise ValueError("max_seconds must be positive")
    return guard_inputs(
        [
            FFMPEG,
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "0",
            "-t",
            f"{max_seconds:.3f}",
            "-i",
            str(source),
            "-vn",
            "-sn",
            "-dn",
            "-f",
            "s16le",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            "-ar",
            str(SAMPLE_RATE),
            "pipe:1",
        ]
    )


def decode(source: Path, max_seconds: float) -> bytes:
    """The input's first ``max_seconds``, 16 kHz mono s16le; DECODE_FAILED if it can't be read."""
    try:
        done = subprocess.run(  # noqa: S603 - our own command line, our own temp path
            decode_args(source, max_seconds),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=_DECODE_TIMEOUT_SEC,
        )
    except (subprocess.SubprocessError, OSError):
        raise CallFailed(
            "DECODE_FAILED", "The audio couldn't be decoded; it may be damaged."
        ) from None
    return done.stdout


def seconds_of(pcm: bytes) -> float:
    return len(pcm) / _BYTES_PER_SECOND


def reached_cap(pcm: bytes, max_seconds: float) -> bool:
    """Whether decoding stopped at ``max_seconds`` rather than at the end of the sound.

    The cap is the priced length plus a margin of 2 % and a second, so an
    honest file ends well before it.
    """
    return seconds_of(pcm) >= max_seconds - _AT_CAP_SEC


def cut_note(pcm: bytes) -> str:
    """What the result says when the file ran past what was priced."""
    return (
        "The file runs longer than its header says, so only its first "
        f"{length_label(seconds_of(pcm))} were transcribed: the length it was priced for"
    )
