"""A10 Noise Reduction (tools/audio.md -> A10 tests): a noisy speech fixture
comes out cleaner by at least the recorded baseline, the same length to the
sample, with the sound where it was, and never over -1 dBTP."""

from __future__ import annotations

import math
import shutil
import subprocess
import threading
from array import array
from pathlib import Path
from typing import Any

import pytest

from etb_worker.probe import probe_json, summarize
from etb_worker.processors import PROCESSORS, JobContext, JobFailed, Output
from etb_worker.processors.remove_noise import (
    Background,
    background,
    denoise_delay,
    denoiser,
    gain_for,
    parse_levels,
    parse_peak,
    prefilter,
    target,
)
from etb_worker.sandbox import Limits, ToolError
from tests.noisy_speech import mix, noise, speech, write_wav

RATE = 48000
FIXTURE = Path(__file__).parents[3] / "fixtures" / "audio" / "noisy-speech.wav"
#: Recorded on the generated fixture (white noise and 50 Hz hum, 4.6 dB SNR
#: against the clean speech through the same high-pass and notches) with
#: ffmpeg 6.1: 17.5 dB out, so +12.9 dB, and the pauses 27 dB quieter. The
#: test allows 1.5 dB for other ffmpeg builds.
BASELINE_SNR_GAIN_DB = 11.4
BASELINE_PAUSE_DROP_DB = 22.0


def needs_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")


def decode(path: Path, rate: int = RATE, channels: int = 1) -> array[float]:
    """The file as 32-bit float samples (interleaved)."""
    raw = subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-v", "error", "-i", str(path)),
            *("-f", "f32le", "-ar", str(rate), "-ac", str(channels), "-"),
        ],
        check=True,
        capture_output=True,
    ).stdout
    samples = array("f")
    samples.frombytes(raw)
    return samples


def filtered(path: Path, chain: list[str], out: Path) -> Path:
    subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-v", "error", "-y", "-i", str(path)),
            *("-af", ",".join(chain), "-c:a", "pcm_f32le", str(out)),
        ],
        check=True,
    )
    return out


def snr(reference: array[float], estimate: array[float]) -> float:
    signal = sum(r * r for r in reference)
    error = sum((e - r) ** 2 for r, e in zip(reference, estimate, strict=True))
    return 10 * math.log10(signal / error)


def level(samples: array[float], start: float, end: float, rate: int = RATE) -> float:
    stretch = samples[int(start * rate) : int(end * rate)]
    return 10 * math.log10(sum(v * v for v in stretch) / len(stretch) + 1e-30)


def tone(samples: array[float], freq: float, rate: int = RATE) -> float:
    """Goertzel: the level of one frequency across the whole signal, dB."""
    k = 2 * math.cos(2 * math.pi * freq / rate)
    s1 = s2 = 0.0
    for value in samples:
        s1, s2 = value + k * s1 - s2, s1
    power = s1 * s1 + s2 * s2 - k * s1 * s2
    return 10 * math.log10(power / len(samples) ** 2 + 1e-30)


def true_peak(path: Path) -> float:
    log = subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-hide_banner", "-nostats", "-i", str(path)),
            *("-af", "ebur128=peak=true", "-f", "null", "-"),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stderr
    return float(log.rsplit("Peak:", 1)[1].split("dBFS")[0])


def result_path(output: Output) -> Path:
    """The result file: Noise Reduction always writes one here."""
    assert output.path is not None
    return output.path


def clean(
    source: Path,
    tmp_path: Path,
    options: dict[str, Any],
    *,
    mime: str = "audio/wav",
    cancel_at: int | None = None,
) -> Output:
    needs_ffmpeg()
    work = tmp_path / "work"
    work.mkdir(parents=True)
    shutil.copy(source, work / "input")
    cancel = threading.Event()

    def progress(pct: int, _stage: str) -> None:
        if cancel_at is not None and pct >= cancel_at:
            cancel.set()

    ctx = JobContext(
        job_id="test",
        tool_id="remove-noise",
        input_path=work / "input",
        workdir=work,
        options={"strength": "medium", "dehum": "off", "deess": False, "format": "keep"} | options,
        meta=summarize(probe_json(work / "input"), mime),
        limits=Limits(timeout_sec=120),
        cancel=cancel,
        progress=progress,
    )
    return PROCESSORS["remove-noise"].run(ctx)


@pytest.fixture(scope="module")
def voice() -> array[float]:
    return speech(RATE, 6.0)


@pytest.fixture(scope="module")
def noisy(voice: array[float], tmp_path_factory: pytest.TempPathFactory) -> Path:
    folder = tmp_path_factory.mktemp("noisy")
    return write_wav(folder / "noisy.wav", [mix(voice, noise(RATE, len(voice)))], RATE)


def test_the_committed_fixture_is_the_generated_one(noisy: Path) -> None:
    committed, generated = decode(FIXTURE), decode(noisy)
    assert len(committed) == len(generated)
    # Within one 16-bit step: float maths may round differently on another machine.
    assert max(abs(a - b) for a, b in zip(committed, generated, strict=True)) <= 1.5 / 32767


def test_strength_sets_the_attenuation_and_the_floor_follows_the_noise() -> None:
    hiss = Background(level_db=-40.0, white=True, windows=100)
    assert denoiser({"strength": "light"}, hiss) == "afftdn=nr=12:nf=-38.0:nt=w"
    assert denoiser({"strength": "medium"}, hiss) == "afftdn=nr=24:nf=-35.0:nt=w:gs=3"
    rumble = Background(level_db=-50.0, white=False, windows=100)
    assert denoiser({"strength": "strong"}, rumble) == "afftdn=nr=40:nf=-42.0:nt=v:gs=6"
    # afftdn takes floors from -80 to -20 dB.
    assert ":nf=-20.0:" in denoiser({}, Background(-12.0, True, 9))
    assert ":nf=-80.0:" in denoiser({}, Background(-math.inf, True, 9))


def test_the_background_is_the_quietest_tenth_and_its_tilt_names_the_noise() -> None:
    speechy = [(-20.0, -22.0, -30.0)] * 90
    hiss = [(-50.0, -62.0, -49.0)] * 10  # more over 3 kHz than under 1 kHz
    found = background(speechy + hiss, 48000)
    assert (round(found.level_db), found.white) == (-50, True)
    rumble = [(-50.0, -51.0, -60.0)] * 10
    assert background(speechy + rumble, 48000).white is False
    # A muted start (digital silence) isn't the background.
    silence = [(-math.inf, -math.inf, -math.inf)] * 30
    assert round(background(silence + speechy + hiss, 48000).level_db) == -50
    assert background(silence, 48000).level_db == -math.inf


def test_the_levels_and_peaks_ffmpeg_prints_are_read() -> None:
    text = (
        "frame:0    pts:0       pts_time:0\n"
        "lavfi.astats.1.RMS_level=-30.5\nlavfi.astats.2.RMS_level=-31\n"
        "lavfi.astats.3.RMS_level=-inf\n"
        "frame:1    pts:2400    pts_time:0.05\n"
        "lavfi.astats.1.RMS_level=-29\nlavfi.astats.2.RMS_level=-30\n"
        "lavfi.astats.3.RMS_level=-40\n"
    )
    assert parse_levels(text) == [(-30.5, -31.0, -math.inf), (-29.0, -30.0, -40.0)]
    assert parse_peak("lavfi.r128.true_peak=0.5\nlavfi.r128.true_peak=1.000\n") == 0.0
    assert parse_peak("") == -math.inf
    assert gain_for(-3.0) == 0.0
    assert gain_for(0.5) == pytest.approx(-1.6)


def test_the_format_and_its_quality_are_kept_unless_another_is_picked() -> None:
    mp3 = {"container": "mp3", "audio": {"codec": "mp3", "sample_rate": 44100, "bit_rate": 191000}}
    assert target(mp3, {"format": "keep"}).codec == ["-c:a", "libmp3lame", "-b:a", "192k"]
    m4a = {"container": "mp4", "audio": {"codec": "aac", "sample_rate": 48000, "channels": 2}}
    assert target(m4a, {}).ext == "m4a"
    assert target(m4a, {"format": "ogg"}).rate is None
    flac24 = {"container": "flac", "audio": {"codec": "flac", "sample_rate": 96000}}
    assert "24" in target(flac24, {}, depth=24).codec
    assert target(flac24, {"format": "wav"}, depth=24).codec == ["-c:a", "pcm_s24le"]
    assert target(flac24, {"format": "mp3"}, depth=24).rate == 48000
    vorbis = {"container": "ogg", "audio": {"codec": "vorbis", "sample_rate": 44100}}
    assert target(vorbis, {}).ext == "ogg"
    assert target(vorbis, {}).rate == 48000
    assert "Vorbis" in target(vorbis, {}).notes[0]
    # A preview is always WAV, for the page's player.
    assert target(mp3, {"format": "mp3", "preview": True}).ext == "wav"


def test_the_hum_notches_cover_the_harmonics() -> None:
    assert prefilter({"dehum": "off"}) == ["highpass=f=60:p=2"]
    sixty = prefilter({"dehum": "60"})
    assert len(sixty) == 9
    assert sixty[-1] == "bandreject=f=480:width_type=q:width=25"


def test_noisy_speech_comes_out_cleaner_by_the_baseline(
    voice: array[float], noisy: Path, tmp_path: Path
) -> None:
    options = {"strength": "medium", "dehum": "50"}
    output = clean(noisy, tmp_path, options)
    assert output.ext == "wav"
    # The reference: the clean speech through the same linear filters, so only
    # what the noise reduction leaves (or takes from the voice) counts as error.
    reference_wav = write_wav(tmp_path / "voice.wav", [voice], RATE)
    reference = decode(filtered(reference_wav, prefilter(options), tmp_path / "ref.wav"))
    before, after = decode(noisy), decode(result_path(output))
    assert len(after) == len(before)
    gain = snr(reference, after) - snr(reference, before)
    assert gain >= BASELINE_SNR_GAIN_DB, f"SNR improved by {gain:.1f} dB"
    # The pause between the first two words: noise only.
    drop = level(before, 1.45, 1.75) - level(after, 1.45, 1.75)
    assert drop >= BASELINE_PAUSE_DROP_DB, f"pause {drop:.1f} dB quieter"
    assert tone(before, 50) - tone(after, 50) >= 25
    assert true_peak(result_path(output)) <= -1.0
    assert output.meta["notes"][0] == "Medium: background noise down by up to 24 dB"
    assert "hiss-like" in output.meta["notes"][1]
    assert "50 Hz hum removed" in output.meta["notes"][2]


def test_strength_orders_how_much_is_taken_out(noisy: Path, tmp_path: Path) -> None:
    pauses = []
    for strength in ("light", "medium", "strong"):
        folder = tmp_path / strength
        folder.mkdir()
        output = clean(noisy, folder, {"strength": strength, "dehum": "50"})
        pauses.append(level(decode(result_path(output)), 1.45, 1.75))
    assert pauses[0] > pauses[1] > pauses[2]


def test_pink_noise_is_taken_for_rumble(voice: array[float], tmp_path: Path) -> None:
    source = write_wav(
        tmp_path / "pink.wav", [mix(voice, noise(RATE, len(voice), level=0.05, pink=True))], RATE
    )
    output = clean(source, tmp_path, {"strength": "medium"})
    assert "rumble-heavy" in output.meta["notes"][1]
    drop = level(decode(source), 1.45, 1.75) - level(decode(result_path(output)), 1.45, 1.75)
    assert drop >= 15, f"pause {drop:.1f} dB quieter"


def test_the_sound_stays_where_it_was(tmp_path: Path) -> None:
    """afftdn delays its output by half a window; that delay is taken off, to the sample."""
    rate = 44100
    hiss = noise(rate, rate * 2, level=0.003, hum=0.0)
    clicks = [int(rate * t) for t in (0.5, 1.0, 1.5)]
    for at in clicks:
        hiss[at] = 0.8
    source = write_wav(tmp_path / "clicks.wav", [hiss], rate)
    output = clean(source, tmp_path, {"strength": "light"})
    after = decode(result_path(output), rate)
    assert len(after) == rate * 2
    for at in clicks:
        stretch = [abs(v) for v in after[at - 200 : at + 200]]
        assert max(range(len(stretch)), key=stretch.__getitem__) - 200 in (-1, 0, 1, 2)


def test_a_loud_stereo_mp3_stays_under_minus_one_dbtp(voice: array[float], tmp_path: Path) -> None:
    rate = 44100
    loud = speech(rate, 4.0, seed=3)
    left = mix(loud, noise(rate, len(loud), level=0.01, hum=0.0), gain=2.6)
    right = mix(loud, noise(rate, len(loud), level=0.01, hum=0.0, seed=5), gain=2.4)
    wav = write_wav(tmp_path / "loud.wav", [left, right], rate)
    assert true_peak(wav) > -1.0
    mp3 = tmp_path / "loud.mp3"
    subprocess.run(  # noqa: S603
        ["ffmpeg", "-v", "error", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "192k", str(mp3)],  # noqa: S607
        check=True,
    )
    output = clean(mp3, tmp_path, {"strength": "medium"}, mime="audio/mpeg")
    assert (output.ext, output.content_type) == ("mp3", "audio/mpeg")
    assert true_peak(result_path(output)) <= -1.0
    assert any(note.startswith("Turned down") for note in output.meta["notes"])
    assert "MP3 at 192 kbps" in output.meta["notes"]
    # The same length within an MP3 frame.
    frames = len(decode(result_path(output), rate, 2)) // 2
    assert abs(frames - len(decode(mp3, rate, 2)) // 2) <= 1152


def test_a_24_bit_flac_stays_24_bit_and_de_essing_softens_the_s(
    voice: array[float], tmp_path: Path
) -> None:
    source = write_wav(tmp_path / "voice.wav", [mix(voice, noise(RATE, len(voice), hum=0.0))], RATE)
    flac = tmp_path / "voice.flac"
    subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-v", "error", "-i", str(source)),
            *("-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", str(flac)),
        ],
        check=True,
    )
    plain = clean(flac, tmp_path / "plain", {"deess": False}, mime="audio/flac")
    soft = clean(flac, tmp_path / "soft", {"deess": True}, mime="audio/flac")
    for output in (plain, soft):
        probe = summarize(probe_json(result_path(output)), "audio/flac")
        assert probe["audio"]["codec"] == "flac"
        bits = subprocess.run(  # noqa: S603
            [
                *("ffprobe", "-v", "error", "-show_entries", "stream=bits_per_raw_sample"),
                *("-of", "csv=p=0", str(result_path(output))),
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        assert bits == "24"
    highs = tmp_path / "highs.wav"
    sibilance = [
        level(decode(filtered(result_path(out), ["highpass=f=5000:p=2"], highs)), 0, 6)
        for out in (plain, soft)
    ]
    assert sibilance[0] - sibilance[1] >= 2
    assert "Gently de-essed: sharp s sounds softened" in soft.meta["notes"]


def test_a_preview_is_wav_whatever_the_format(noisy: Path, tmp_path: Path) -> None:
    output = clean(noisy, tmp_path, {"format": "mp3", "preview": True})
    assert (output.ext, output.content_type) == ("wav", "audio/wav")
    # What was done to the snippet; its length and the format are the page's business.
    assert not any(note.startswith(("MP3", "Same length")) for note in output.meta["notes"])


def test_the_delay_is_measured_once_per_rate(tmp_path: Path) -> None:
    needs_ffmpeg()
    ctx = JobContext(
        job_id="test",
        tool_id="remove-noise",
        input_path=tmp_path / "input",
        workdir=tmp_path,
        options={},
        meta={},
        limits=Limits(timeout_sec=60),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
    )
    # Half of afftdn's 50 ms window, rounded down to a multiple of 4 samples.
    assert denoise_delay(ctx, 48000) == 1200
    assert denoise_delay(ctx, 22050) == 550
    assert list(tmp_path.iterdir()) == []


def test_a_cancel_stops_it_at_once(noisy: Path, tmp_path: Path) -> None:
    with pytest.raises(ToolError) as stopped:
        clean(noisy, tmp_path, {}, cancel_at=16)
    assert stopped.value.code == "CANCELLED"


def test_a_file_without_sound_or_a_broken_one_fails_cleanly(tmp_path: Path) -> None:
    needs_ffmpeg()
    work = tmp_path / "work"
    work.mkdir()
    (work / "input").write_bytes(bytes(range(256)) * 64)
    ctx = JobContext(
        job_id="test",
        tool_id="remove-noise",
        input_path=work / "input",
        workdir=work,
        options={"strength": "medium"},
        meta={"container": "wav", "duration_ms": 1000, "audio": None},
        limits=Limits(timeout_sec=30),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
    )
    processor = PROCESSORS["remove-noise"]
    with pytest.raises(JobFailed) as no_audio:
        processor.run(ctx)
    assert no_audio.value.code == "NO_AUDIO"
    ctx.meta = {
        "container": "wav",
        "audio": {"codec": "pcm_s16le", "sample_rate": 48000, "channels": 1},
    }
    with pytest.raises(ToolError) as broken:
        processor.run(ctx)
    assert broken.value.code == "TOOL_FAILED"
    ctx.meta = {"audio": {"codec": "pcm_s16le", "sample_rate": 48000, "channels": 12}}
    with pytest.raises(JobFailed) as wide:
        processor.run(ctx)
    assert wide.value.code == "TOO_MANY_CHANNELS"
    # An hour of 8 channels at 192 kHz: a few MB as FLAC, 44 GB raw on the disk.
    ctx.meta = {
        "duration_ms": 3_600_000,
        "audio": {"codec": "flac", "sample_rate": 192000, "channels": 8},
    }
    with pytest.raises(JobFailed) as long:
        processor.run(ctx)
    assert long.value.code == "TOO_LARGE"
