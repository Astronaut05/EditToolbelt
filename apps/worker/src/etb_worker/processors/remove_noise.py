"""A10 Noise Reduction (tools/audio.md -> A10): cleaner speech, same length, no clipping.

The spec asks for a DeepFilterNet-class model. DeepFilterNet's code is MIT /
Apache-2.0, but its weights carry no licence statement of their own (the
author's issues #697 and #700 asking about them are unanswered), so they
aren't used (docs/13 -> Models, CLAUDE.md rule 6). Until that changes this is
classic DSP, all ffmpeg filters, and the copy says so:

1. decode the first audio track to 32-bit float at its own rate and channels,
   and in the same pass measure the background in 100 ms windows (mixed to
   mono, after the fixed filters below): the quietest tenth is the noise, its
   level sets afftdn's noise floor and its tilt (more hiss than rumble, or
   the other way) picks the noise model;
2. clean: a gentle 60 Hz high-pass for rumble, notches at the mains frequency
   and its harmonics when de-hum is on, afftdn (an FFT noise gate whose
   attenuation is the strength), and ffmpeg's de-esser when asked. afftdn
   delays its output by half its window; the delay is measured once per
   sample rate and taken off, so the sound stays where it was (a video's
   lips stay in sync), and the result is padded or cut to the exact sample
   count of the input. The same pass measures the true peak (ebur128, 4x
   oversampled);
3. turn the whole file down just enough to stay at or under -1 dBTP: a
   gain, never a limiter;
4. encode in the asked format (by default the input's, at its bitrate) with
   the input's tags; a lossy result near the ceiling is measured again
   (codecs can overshoot) and, if it went over, encoded once more.

A preview (``preview: true``) is the same run on a snippet the page cut, and
always comes back as WAV for the page's A/B player.
"""

from __future__ import annotations

import math
import re
from array import array
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output, ffmpeg_progress
from etb_worker.sandbox import Limits, ToolError, ffmpeg, ffprobe, run

#: Strength: afftdn's attenuation (dB), how far over the measured noise its floor
#: sits (dB), and how widely its gains are smoothed across bins (against "musical
#: noise", the chirps a hard spectral gate leaves).
STRENGTHS: dict[str, dict[str, float]] = {
    "light": {"reduction": 12, "offset": 2, "smooth": 0},
    "medium": {"reduction": 24, "offset": 5, "smooth": 3},
    "strong": {"reduction": 40, "offset": 8, "smooth": 6},
}
STRENGTH_WORDS = {"light": "Light", "medium": "Medium", "strong": "Strong"}
#: Rumble under the voice.
HIGH_PASS_HZ = 60
#: Notches at the mains frequency and its harmonics up to this many.
HUM_HARMONICS = 8
HUM_Q = 25
#: ffmpeg's de-esser, gently: about 5 dB off the sibilant band, nothing below 3 kHz.
DEESS = "deesser=i=0.4:m=0.5:f=0.5"
#: The background is measured in windows this long; the quietest share of them is the noise.
WINDOW_SEC = 0.1
QUIET_SHARE = 0.1
#: Quieter than this is digital silence, not background.
SILENCE_DB = -90.0
#: afftdn's noise floor range (dB).
FLOOR_MIN, FLOOR_MAX = -80.0, -20.0
#: True peak at or under this (dBTP), with a little room for rounding.
CEILING_DB = -1.0
HEADROOM_DB = 0.1
#: MP3, AAC and Opus can overshoot by a dB or so: a lossy result whose sound
#: peaked closer than this to the ceiling is measured again after encoding.
OVERSHOOT_DB = 2.5
#: Where ebur128 prints the true peak, on the way through.
PEAK_METER = "ebur128=peak=true:metadata=1,ametadata=mode=print:key=lavfi.r128.true_peak:file={}"
#: More channels than this is not speech.
MAX_CHANNELS = 8
#: The decoded and the cleaned sound, raw 32-bit float, kept on the job's disk
#: together: the jobs API refuses more before charging (job-rules.ts,
#: MAX_NOISE_WORK_BYTES); this is the same limit, should a job get here anyway.
MAX_WORK_BYTES = 8 * 1024**3
#: The probe's container and codec -> the format a "keep" writes.
KEEP_CODECS = {"mp3": "mp3", "aac": "m4a", "alac": "m4a", "flac": "flac", "opus": "ogg"}
KEEP_CONTAINERS = {"wav": "wav", "flac": "flac", "ogg": "ogg", "mp3": "mp3"}


@dataclass(frozen=True)
class Target:
    """What the result is written as."""

    fmt: str
    ext: str
    content_type: str
    codec: list[str]
    lossy: bool
    #: Sample rate and channels the codec needs, if not the source's.
    rate: int | None = None
    channels: int | None = None
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Background:
    """The noise, as measured: its level (dBFS RMS) and whether it's hiss-like (white)."""

    level_db: float
    white: bool
    windows: int


def _bitrate(source: int | None, choices: tuple[int, ...], fallback: int) -> int:
    """The source's bitrate, rounded to the nearest standard one."""
    if not source:
        return fallback
    return min(choices, key=lambda choice: abs(choice - source))


MP3_KBPS = (96, 128, 160, 192, 224, 256, 320)
AAC_KBPS = (96, 128, 160, 192, 256, 320)
OPUS_KBPS = (64, 96, 128, 160, 192, 256)


LOSSLESS = ("pcm_", "flac", "alac")


def target(meta: dict[str, Any], options: dict[str, Any], depth: int = 16) -> Target:
    """The format to write: a preview's WAV, the one asked for, or the source's own.

    Lossless output keeps a lossless source's depth (24-bit stays 24-bit, float
    WAV stays float); lossy output keeps a lossy source's bitrate.
    """
    audio = meta.get("audio") or {}
    codec = str(audio.get("codec") or "")
    rate = int(audio.get("sample_rate") or 0)
    channels = int(audio.get("channels") or 0)
    source_bps = audio.get("bit_rate")
    kbps = round(int(source_bps) / 1000) if source_bps else None
    fmt = str(options.get("format") or "keep")
    notes: list[str] = []
    if options.get("preview"):
        fmt = "wav"
    elif fmt == "keep":
        container = str(meta.get("container") or "")
        fmt = KEEP_CODECS.get(codec) or KEEP_CONTAINERS.get(container) or "wav"
        if codec == "vorbis":
            notes.append("Saved as Opus in OGG: Vorbis isn't written here")
    deep = codec.startswith(LOSSLESS) and depth > 16
    if fmt == "wav":
        pcm = "pcm_f32le" if codec == "pcm_f32le" else "pcm_s24le" if deep else "pcm_s16le"
        return Target("wav", "wav", "audio/wav", ["-c:a", pcm], False, notes=notes)
    if fmt == "flac":
        bits = ["-sample_fmt", "s32", "-bits_per_raw_sample", "24"] if deep else []
        bits = bits or ["-sample_fmt", "s16"]
        return Target("flac", "flac", "audio/flac", ["-c:a", "flac", *bits], False, notes=notes)
    if fmt == "m4a" and codec == "alac" and options.get("format") in (None, "keep"):
        return Target("m4a", "m4a", "audio/mp4", ["-c:a", "alac"], False, notes=notes)
    lossy_source = codec in ("mp3", "aac", "opus", "vorbis")
    if fmt == "mp3":
        bitrate = _bitrate(kbps if lossy_source else None, MP3_KBPS, 192)
        notes.append(f"MP3 at {bitrate} kbps")
        return Target(
            "mp3",
            "mp3",
            "audio/mpeg",
            ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k"],
            True,
            rate=48000 if rate > 48000 else None,
            channels=2 if channels > 2 else None,
            notes=notes,
        )
    if fmt == "m4a":
        bitrate = _bitrate(kbps if lossy_source else None, AAC_KBPS, 192)
        notes.append(f"AAC at {bitrate} kbps in M4A")
        return Target(
            "m4a",
            "m4a",
            "audio/mp4",
            ["-c:a", "aac", "-b:a", f"{bitrate}k", "-movflags", "+faststart"],
            True,
            rate=96000 if rate > 96000 else None,
            notes=notes,
        )
    bitrate = _bitrate(kbps if lossy_source else None, OPUS_KBPS, 128)
    notes.append(f"Opus at {bitrate} kbps in OGG")
    return Target(
        "ogg",
        "ogg",
        "audio/ogg",
        ["-c:a", "libopus", "-b:a", f"{bitrate}k"],
        True,
        rate=48000 if rate != 48000 else None,
        channels=2 if channels > 2 else None,
        notes=notes,
    )


def prefilter(options: dict[str, Any]) -> list[str]:
    """The fixed, linear part: rumble, and the mains hum when de-hum is on."""
    chain = [f"highpass=f={HIGH_PASS_HZ}:p=2"]
    mains = str(options.get("dehum") or "off")
    if mains in ("50", "60"):
        base = int(mains)
        chain += [
            f"bandreject=f={base * k}:width_type=q:width={HUM_Q}"
            for k in range(1, HUM_HARMONICS + 1)
        ]
    return chain


def _power_mean(levels: list[float]) -> float:
    powers = [10 ** (level / 10) for level in levels if math.isfinite(level)]
    if not powers:
        return -math.inf
    return 10 * math.log10(sum(powers) / len(powers))


def background(levels: list[tuple[float, float, float]], rate: int) -> Background:
    """The noise from the windows' levels (total, under 1 kHz, over 3 kHz), in dB.

    The quietest tenth of the windows is taken as the noise (speech always
    has gaps); stretches of digital silence (edits, a muted start) don't
    count when there's enough else. Its tilt, the band over 3 kHz against the
    band under 1 kHz, is compared with what white and pink noise give at this
    sample rate.
    """
    if not levels:
        return Background(-math.inf, True, 0)
    audible = [window for window in levels if window[0] > SILENCE_DB]
    pool = audible if len(audible) >= 3 else levels
    quiet = sorted(pool, key=lambda window: window[0])[: max(3, int(len(pool) * QUIET_SHARE))]
    level = _power_mean([window[0] for window in quiet])
    nyquist = rate / 2
    if nyquist <= 3500 or not math.isfinite(level):
        return Background(level, True, len(levels))
    tilt = _power_mean([window[2] for window in quiet]) - _power_mean(
        [window[1] for window in quiet]
    )
    low_band = 1000 - HIGH_PASS_HZ
    white = 10 * math.log10((nyquist - 3000) / low_band)
    pink = 10 * math.log10(math.log2(nyquist / 3000) / math.log2(1000 / HIGH_PASS_HZ))
    return Background(level, not math.isfinite(tilt) or tilt > (white + pink) / 2, len(levels))


def denoiser(options: dict[str, Any], noise: Background) -> str:
    """afftdn for this strength and this noise."""
    spec = STRENGTHS[str(options.get("strength") or "medium")]
    floor = noise.level_db + spec["offset"] if math.isfinite(noise.level_db) else FLOOR_MIN
    floor = min(FLOOR_MAX, max(FLOOR_MIN, floor))
    model = "w" if noise.white else "v"
    smooth = f":gs={int(spec['smooth'])}" if spec["smooth"] else ""
    return f"afftdn=nr={spec['reduction']:g}:nf={floor:.1f}:nt={model}{smooth}"


def parse_levels(text: str) -> list[tuple[float, float, float]]:
    """ametadata's printout of astats' per-window RMS: total, low band, high band."""
    windows: list[tuple[float, float, float]] = []
    current: dict[str, float] = {}
    for line in text.splitlines():
        if line.startswith("frame:"):
            if len(current) == 3:
                windows.append((current["1"], current["2"], current["3"]))
            current = {}
            continue
        match = re.match(r"lavfi\.astats\.(\d)\.RMS_level=(\S+)", line)
        if match:
            try:
                current[match.group(1)] = float(match.group(2))
            except ValueError:
                current[match.group(1)] = -math.inf
    if len(current) == 3:
        windows.append((current["1"], current["2"], current["3"]))
    return windows


def parse_peak(text: str) -> float:
    """The highest true peak ebur128 reported, in dBTP (-inf for silence)."""
    peaks = [float(value) for value in re.findall(r"lavfi\.r128\.true_peak=([0-9.eE+-]+)", text)]
    top = max(peaks, default=0.0)
    return 20 * math.log10(top) if top > 0 else -math.inf


def _raw(rate: int, channels: int, name: str) -> list[str]:
    return ["-f", "f32le", "-ar", str(rate), "-ac", str(channels), "-i", name]


#: afftdn's delay in samples, by sample rate: measured once per worker process.
_DELAYS: dict[int, int] = {}


def _measure_delay(rate: int, workdir: Path, timeout: float) -> int:
    """Puts three clicks through afftdn and finds where they come out."""
    frames = int(rate * 0.8)
    clicks = [int(rate * t) for t in (0.2, 0.35, 0.5)]
    signal = array("f", bytes(4 * frames))
    for at in clicks:
        signal[at] = 0.9
    source, result = workdir / "delay-in.f32", workdir / "delay-out.f32"
    source.write_bytes(signal.tobytes())
    try:
        run(
            ffmpeg(
                *_raw(rate, 1, source.name),
                *("-af", "afftdn=nr=12:nf=-80:nt=w", "-f", "f32le", result.name),
            ),
            cwd=workdir,
            limits=Limits(timeout_sec=timeout),
        )
        out = array("f")
        out.frombytes(result.read_bytes())
    finally:
        source.unlink(missing_ok=True)
        result.unlink(missing_ok=True)
    found = set()
    for at in clicks:
        stretch = [abs(value) for value in out[at : at + rate // 10]]
        if not stretch or max(stretch) < 0.3:
            msg = "the delay check found no click"
            raise ToolError("TOOL_FAILED", msg)
        found.add(max(range(len(stretch)), key=stretch.__getitem__))
    if len(found) != 1:
        msg = f"the delay check disagreed: {sorted(found)}"
        raise ToolError("TOOL_FAILED", msg)
    return found.pop()


def denoise_delay(ctx: JobContext, rate: int) -> int:
    """afftdn's delay in samples at this rate (half its window, 25 ms in ffmpeg 6 and 7).

    Measured rather than assumed, so a new ffmpeg can't shift the sound
    without anyone noticing.
    """
    if rate not in _DELAYS:
        _DELAYS[rate] = _measure_delay(rate, ctx.workdir, min(60.0, ctx.limits.timeout_sec))
    return _DELAYS[rate]


def source_depth(ctx: JobContext) -> int:
    """Bits per sample of a lossless source (16 when it doesn't say)."""
    lines: list[str] = []
    try:
        ctx.run(
            ffprobe(
                *("-select_streams", "a:0", "-show_entries"),
                "stream=sample_fmt,bits_per_raw_sample,bits_per_sample",
                *("-of", "default=nw=1", "-i", ctx.input_path.name),
            ),
            on_line=lines.append,
        )
    except ToolError as error:
        if error.code == "CANCELLED":
            raise
        return 16
    fields = dict(line.partition("=")[::2] for line in lines)
    bits = max(
        (
            int(fields[key])
            for key in ("bits_per_raw_sample", "bits_per_sample")
            if fields.get(key, "").isdigit()
        ),
        default=0,
    )
    if fields.get("sample_fmt", "").startswith(("flt", "dbl")):
        return 32
    return bits if bits > 16 else 16


def gain_for(peak_db: float) -> float:
    """The gain (dB, <= 0) that brings a true peak to the ceiling, with a little room."""
    if peak_db <= CEILING_DB:
        return 0.0
    return CEILING_DB - HEADROOM_DB - peak_db


def clock(seconds: float) -> str:
    minutes, rest = divmod(seconds, 60)
    hours, minutes = divmod(int(minutes), 60)
    if hours:
        return f"{hours}:{minutes:02d}:{rest:06.3f}"
    return f"{minutes}:{rest:06.3f}"


def analysis_graph(options: dict[str, Any], channels: int, rate: int) -> str:
    """Decoding's second output: the background's level per window, total and in two bands."""
    mono = "+".join(f"{1 / channels:.6f}*c{c}" for c in range(channels))
    window = max(1, round(rate * WINDOW_SEC))
    return (
        f"[0:a:0]asplit=2[pcm][an];[an]pan=mono|c0={mono},{','.join(prefilter(options))},"
        "asplit=3[t][l][h];[l]lowpass=f=1000[lo];[h]highpass=f=3000[hi];"
        f"[t][lo][hi]amerge=inputs=3,asetnsamples=n={window}:p=0,"
        "astats=metadata=1:reset=1:measure_perchannel=RMS_level:measure_overall=none,"
        "ametadata=mode=print:file=levels.txt,anullsink"
    )


@dataclass(frozen=True)
class Sound:
    """The decoded sound of one job: raw 32-bit float at the source's rate and channels."""

    ctx: JobContext
    rate: int
    channels: int
    frames: int

    @property
    def length_ms(self) -> int:
        return round(self.frames / self.rate * 1000)

    def raw(self, path: Path) -> list[str]:
        return _raw(self.rate, self.channels, path.name)

    def read_peak(self) -> float:
        peaks = self.ctx.workdir / "peaks.txt"
        try:
            return parse_peak(peaks.read_text(errors="replace"))
        finally:
            peaks.unlink(missing_ok=True)

    def true_peak(self, source: list[str], start: int, end: int) -> float:
        """The highest true peak of ``source`` (an ffmpeg input), in dBTP."""
        ctx = self.ctx
        ctx.run(
            ffmpeg(
                *source,
                *("-map", "0:a:0", "-af", PEAK_METER.format("peaks.txt"), "-f", "null", "-"),
            ),
            on_line=ffmpeg_progress(self.length_ms, ctx.progress, "checking peaks", start, end),
        )
        return self.read_peak()

    def encode(self, cleaned: Path, plan: Target, gain: float, span: tuple[int, int]) -> Path:
        """Writes the result in its format, turned down by ``gain`` dB, with the source's tags."""
        ctx, out = self.ctx, self.ctx.workdir / f"out.{plan.ext}"
        filters = [f"volume={gain:.2f}dB"] if gain < 0 else []
        if plan.rate:
            filters.append(f"aresample={plan.rate}")
        ctx.run(
            ffmpeg(
                *self.raw(cleaned),
                *("-i", ctx.input_path.name, "-map", "0:a:0", "-map_metadata", "1"),
                *(["-af", ",".join(filters)] if filters else []),
                *(["-ac", str(plan.channels)] if plan.channels else []),
                *plan.codec,
                out.name,
            ),
            on_line=ffmpeg_progress(self.length_ms, ctx.progress, "saving", *span),
        )
        return out


def notes(
    options: dict[str, Any], noise: Background, gain: float, sound: Sound, plan: Target
) -> list[str]:
    """What was done, in plain words, for the result's "What changed"."""
    strength = str(options.get("strength") or "medium")
    reduction = STRENGTHS[strength]["reduction"]
    lines = [f"{STRENGTH_WORDS[strength]}: background noise down by up to {reduction:g} dB"]
    if math.isfinite(noise.level_db):
        kind = "hiss-like (broadband)" if noise.white else "rumble-heavy (low)"
        lines.append(f"The background was {kind}, at about {noise.level_db:.0f} dBFS")
    else:
        lines.append("No background noise was found: the quiet parts are digital silence")
    mains = str(options.get("dehum") or "off")
    if mains in ("50", "60"):
        top = int(mains) * HUM_HARMONICS
        lines.append(f"{mains} Hz hum removed, with its harmonics up to {top} Hz")
    if options.get("deess"):
        lines.append("Gently de-essed: sharp s sounds softened")
    if gain < 0:
        lines.append(f"Turned down {-gain:.1f} dB so the peaks stay under −1 dBTP")  # noqa: RUF001
    if not options.get("preview"):
        lines.append(f"Same length as the original: {clock(sound.frames / sound.rate)}")
        lines += plan.notes
    return lines


class RemoveNoise:
    tool_id = "remove-noise"

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        # Decode, measure, clean (afftdn runs ~50x real time on one core), encode.
        seconds = float(meta.get("duration_ms") or 0) / 1000
        return Estimate(seconds=2 + seconds / 25)

    def run(self, ctx: JobContext) -> Output:
        audio = ctx.meta.get("audio")
        if not audio:
            raise JobFailed("NO_AUDIO", "This file has no sound to clean.")
        rate = int(audio.get("sample_rate") or 0)
        channels = int(audio.get("channels") or 0)
        if rate <= 0 or channels <= 0:
            raise JobFailed("DECODE_FAILED", "The sound in this file can't be read.")
        if channels > MAX_CHANNELS:
            raise JobFailed(
                "TOO_MANY_CHANNELS",
                f"This file has {channels} channels; noise reduction takes up to {MAX_CHANNELS}.",
            )
        work = float(ctx.meta.get("duration_ms") or 0) / 1000 * rate * channels * 4 * 2
        if work > MAX_WORK_BYTES:
            raise JobFailed("TOO_LARGE", "This file is too long to clean at once; split it.")
        options = ctx.options
        codec = str(audio.get("codec") or "")
        depth = source_depth(ctx) if codec.startswith(LOSSLESS) else 16
        plan = target(ctx.meta, options, depth)

        # 1. Decode, at the file's own rate and channels, and measure the background.
        decoded = ctx.workdir / "decoded.f32"
        ctx.run(
            ffmpeg(
                *("-i", ctx.input_path.name, "-filter_complex"),
                analysis_graph(options, channels, rate),
                *("-map", "[pcm]", "-ar", str(rate), "-ac", str(channels)),
                *("-f", "f32le", decoded.name),
            ),
            on_line=ffmpeg_progress(
                int(ctx.meta.get("duration_ms") or 0), ctx.progress, "reading", 0, 20
            ),
        )
        frames = decoded.stat().st_size // (4 * channels) if decoded.exists() else 0
        if frames == 0:
            raise JobFailed("DECODE_FAILED", "No sound could be decoded from this file.")
        sound = Sound(ctx, rate, channels, frames)
        levels = ctx.workdir / "levels.txt"
        noise = background(parse_levels(levels.read_text(errors="replace")), rate)
        levels.unlink(missing_ok=True)

        # 2. Clean, with afftdn's delay taken off and the length kept to the sample;
        #    the true peak is measured on the way out.
        delay = denoise_delay(ctx, rate)
        chain = [
            *prefilter(options),
            f"apad=pad_len={delay}",
            denoiser(options, noise),
            f"atrim=start_sample={delay}",
            "asetpts=PTS-STARTPTS",
        ]
        if options.get("deess"):
            chain.append(DEESS)
        chain += [
            f"apad=whole_len={frames}",
            f"atrim=end_sample={frames}",
            PEAK_METER.format("peaks.txt"),
        ]
        cleaned = ctx.workdir / "cleaned.f32"
        ctx.run(
            ffmpeg(*sound.raw(decoded), *("-af", ",".join(chain), "-f", "f32le", cleaned.name)),
            on_line=ffmpeg_progress(sound.length_ms, ctx.progress, "cleaning", 20, 80),
        )
        decoded.unlink(missing_ok=True)
        if cleaned.stat().st_size != frames * 4 * channels:
            raise JobFailed("TOOL_FAILED", "The cleaned sound came out the wrong length.")

        # 3. The gain that keeps the true peak under the ceiling.
        peak = sound.read_peak()
        gain = gain_for(peak)

        # 4. Encode; a lossy result near the ceiling is measured again, as codecs overshoot.
        out = sound.encode(cleaned, plan, gain, (80, 95))
        if plan.lossy and peak + gain > CEILING_DB - OVERSHOOT_DB:
            encoded = sound.true_peak(["-i", out.name], 95, 97)
            if encoded > CEILING_DB:
                gain -= encoded - CEILING_DB + 2 * HEADROOM_DB
                out = sound.encode(cleaned, plan, gain, (97, 99))
        if not out.exists() or out.stat().st_size == 0:
            raise JobFailed("TOOL_FAILED", "The cleaned sound came out empty.")
        return Output(
            path=out,
            content_type=plan.content_type,
            ext=plan.ext,
            meta={"notes": notes(options, noise, gain, sound, plan)},
        )


PROCESSOR: RemoveNoise = RemoveNoise()
