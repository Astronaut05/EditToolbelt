"""A GPU call decodes no more than its job was priced for (V20, V21, A12, V17).

Every job is priced and checked from the probe, which reads the file's
header, and a header can say less than the file holds (an MKV with a patched
duration, a FLAC with a patched sample count). Here a processor gets a probe
that says less than the real file (just what such a header does to it), and
the Modal function then runs on its own code (``.local()``) against the
worker's ffmpeg, with stand-ins for the models only. The worker must send
the caps, and the decoders must stop at them; an honest file must never be
cut.
"""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
import threading
import time
from collections.abc import Callable
from fractions import Fraction
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

import pytest

from etb_worker.gpu import audio, modal_app, video
from etb_worker.gpu.backend import GpuCall, GpuResult, parse_answer
from etb_worker.gpu.remote import CallFailed, float_cap, int_cap
from etb_worker.probe import probe_json, summarize
from etb_worker.processors import PROCESSORS, JobContext, JobFailed, Output, upscale_video
from etb_worker.processors.remote import length_cap
from etb_worker.sandbox import Limits
from etb_worker.storage import Storage

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"
pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")

#: The test clip: 4 s at 10 fps (40 frames), 32 x 24, with a tone.
CLIP_SEC, CLIP_FPS, CLIP_W, CLIP_H = 4, 10, 32, 24
#: The tone for transcription: 6 s.
SPEECH_SEC = 6


def ffmpeg(*args: str) -> None:
    subprocess.run([FFMPEG, "-v", "error", "-y", *args], check=True, timeout=60)  # noqa: S603


@pytest.fixture(scope="module")
def media(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Tiny files made here: nothing licensed, nothing kept."""
    root = tmp_path_factory.mktemp("caps")
    clip, sound, flac = root / "clip.mp4", root / "sound.m4a", root / "tone.flac"
    picture = f"testsrc=size={CLIP_W}x{CLIP_H}:rate={CLIP_FPS}:duration={CLIP_SEC}"
    ffmpeg(
        *("-f", "lavfi", "-i", picture, "-f", "lavfi", "-i", f"sine=duration={CLIP_SEC}"),
        *("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(clip)),
    )
    ffmpeg("-f", "lavfi", "-i", f"sine=duration={SPEECH_SEC}", "-c:a", "aac", str(sound))
    ffmpeg("-f", "lavfi", "-i", f"sine=duration={SPEECH_SEC}", "-c:a", "flac", str(flac))
    return {"clip": clip, "sound": sound, "flac": flac}


def streams(path: Path) -> dict[str, dict[str, Any]]:
    """ffprobe's own count of a result: its video and audio streams by type."""
    out = subprocess.run(  # noqa: S603
        [FFPROBE, "-v", "error", "-count_frames", "-of", "json", "-show_streams", str(path)],
        capture_output=True,
        check=True,
        timeout=60,
    )
    found: list[dict[str, Any]] = json.loads(out.stdout)["streams"]
    return {stream["codec_type"]: stream for stream in found}


def sound_sec(path: Path) -> float:
    """How long a result's sound plays, decoded (WebM keeps no length per stream)."""
    return audio.seconds_of(audio.decode(path, 600.0))


def lying(seconds: float, *, fps: float = CLIP_FPS) -> dict[str, Any]:
    """The probe of the clip, had its header said it lasts ``seconds``."""
    return {
        "duration_ms": round(seconds * 1000),
        "video": {"width": CLIP_W, "height": CLIP_H, "fps": fps},
        "audio": {"codec": "aac"},
    }


# --- the worker: what it sends -------------------------------------------------------


def test_the_caps_are_the_priced_length_with_a_margin() -> None:
    meta = lying(60, fps=30)
    assert upscale_video.frame_cap(meta) == 1800 + 30
    assert length_cap(meta) == pytest.approx(62.2)
    # 29.97 fps rounds up to a whole second's worth of margin.
    assert upscale_video.frame_cap(lying(10, fps=29.97)) == 300 + 30
    # Never past the tools' 18,000 frames, however long the clip says it is.
    assert upscale_video.frame_cap(lying(600, fps=60)) == upscale_video.MAX_FRAMES


@pytest.mark.parametrize(
    ("average", "real"),
    [
        ("30/1", "30/1"),
        ("30000/1001", "30000/1001"),
        ("28771/1000", "30/1"),  # a phone's variable rate
        ("0/0", "24000/1001"),
        ("0/0", "0/0"),
        ("1/2", "30/1"),  # under 1 fps on average: the GPU reads the other rate
        ("1/2", "60/1"),
        ("1/2", "1/2"),
        ("1/10000", "60/1"),
        ("240/1", "30/1"),
        ("240/1", "240/1"),
    ],
)
def test_the_frame_cap_counts_at_the_rate_the_gpu_reads_or_more(average: str, real: str) -> None:
    """The worker's probe keeps one rate; the function picks its own from both (pick_fps).
    The cap must never count fewer frames than the function will make of an honest clip."""
    raw = {
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "10.0"},
        "streams": [
            {
                "codec_type": "video",
                "width": 64,
                "height": 48,
                "avg_frame_rate": average,
                "r_frame_rate": real,
            }
        ],
    }
    meta = summarize(raw, "video/mp4")
    made = video.parse_probe(raw)
    # The probe keeps 3 decimals (23.976): the second's margin covers that many times over.
    assert upscale_video.reading_fps(meta) >= float(made.fps) - 0.001
    assert upscale_video.frame_cap(meta) >= made.frames + math.ceil(made.fps)


def test_the_frame_cap_in_numbers() -> None:
    def cap(fps: float | None) -> tuple[float, int]:
        meta = {"duration_ms": 10_000, "video": {"width": 64, "height": 48, "fps": fps}}
        return upscale_video.reading_fps(meta), upscale_video.frame_cap(meta)

    assert cap(None) == (30.0, 330)
    assert cap(25.0) == (25.0, 275)
    assert cap(240.0) == (120.0, 1320)
    assert cap(0.5) == (120.0, 1320)


# --- the GPU side, unit by unit ------------------------------------------------------


def test_the_decoder_reads_the_priced_time_and_one_frame_past_the_cap(tmp_path: Path) -> None:
    info = video.parse_probe(
        {"streams": [{"codec_type": "video", "width": 64, "height": 48, "avg_frame_rate": "25/1"}]}
    )
    args = video.decode_args(tmp_path / "input", info, max_seconds=6.1, max_frames=180)
    # -t before -i: the input is read no further (the sound's input too, in the encoder).
    assert args[args.index("-t") + 1 : args.index("-t") + 3] == ["6.100", "-i"]
    assert args[args.index("-frames:v") + 1] == "181"
    encode, _ = video.encode_args(
        tmp_path / "out.mp4",
        encoding="h264",
        width=64,
        height=48,
        fps=Fraction(25),
        source=tmp_path / "input",
        audio="aac",
        max_seconds=6.1,
    )
    at = encode.index(str(tmp_path / "input"))
    assert encode[at - 3 : at] == ["-t", "6.100", "-i"]
    with pytest.raises(ValueError, match="positive"):
        video.decode_args(tmp_path / "input", info, max_seconds=0, max_frames=180)


def pass_through(pipe: video.FramePipe) -> int:
    for frame in pipe.frames():
        pipe.write(frame)
    return pipe.finish()


def test_a_clip_longer_than_priced_is_cut_at_the_cap(
    media: dict[str, Path], tmp_path: Path
) -> None:
    info = video.probe(media["clip"])
    assert info.frames == CLIP_SEC * CLIP_FPS
    target = tmp_path / "out.mp4"
    encode, _ = video.encode_args(
        target,
        encoding="h264",
        width=CLIP_W,
        height=CLIP_H,
        fps=info.fps,
        source=media["clip"],
        audio=info.audio,
        max_seconds=2.02,
    )
    decode = video.decode_args(media["clip"], info, max_seconds=2.02, max_frames=12)
    with video.FramePipe(decode, CLIP_W * CLIP_H * 3, encode, max_frames=12) as pipe:
        assert pass_through(pipe) == 12
    assert (pipe.read, pipe.cut) == (12, True)
    assert streams(target)["video"]["nb_read_frames"] == "12"
    # The sound stops at the priced time too, not at the end of the file.
    assert sound_sec(target) <= 2.02 + 0.1


def test_the_counter_holds_even_without_ffmpegs_own_cap(
    media: dict[str, Path], tmp_path: Path
) -> None:
    """Belt and braces: a decoder that would go on to the end is stopped at the cap."""
    endless = [FFMPEG, "-nostdin", "-v", "error", "-i", str(media["clip"]), "-an"]
    endless += ["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    encode = [FFMPEG, "-nostdin", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24"]
    encode += ["-s", f"{CLIP_W}x{CLIP_H}", "-i", "pipe:0", "-f", "null", "-"]
    with video.FramePipe(endless, CLIP_W * CLIP_H * 3, encode, max_frames=5, depth=1) as pipe:
        assert pass_through(pipe) == 5
    assert pipe.cut


@pytest.mark.parametrize(
    ("name", "make", "mime"),
    [
        ("mp4", ["-c:v", "libx264", "-c:a", "aac"], "video/mp4"),
        ("mkv", ["-c:v", "libx264", "-r", "30000/1001", "-c:a", "flac"], "video/x-matroska"),
        ("webm", ["-c:v", "libvpx-vp9", "-r", "25", "-c:a", "libopus"], "video/webm"),
        # A phone's variable rate: every fifth frame a little late.
        (
            "mov",
            [
                *("-vf", "setpts='if(eq(mod(N,5),0),PTS+0.012/TB,PTS)'", "-fps_mode", "vfr"),
                *("-c:v", "libx264", "-c:a", "aac"),
            ],
            "video/quicktime",
        ),
    ],
)
def test_an_honest_clip_is_never_cut(tmp_path: Path, name: str, make: list[str], mime: str) -> None:
    """The worker's own probe of a real file gives caps it never reaches."""
    source = tmp_path / f"honest.{name}"
    ffmpeg(
        *("-f", "lavfi", "-i", "testsrc=size=48x32:rate=30:duration=3.3"),
        *("-f", "lavfi", "-i", "sine=duration=3.0", *make, "-pix_fmt", "yuv420p"),
        str(source),
    )
    meta = summarize(probe_json(source), mime)
    caps = upscale_video.caps(meta)
    info = video.probe(source)
    whole = subprocess.run(  # noqa: S603 - every frame, with nothing capping it
        [
            *(FFMPEG, "-nostdin", "-v", "error", "-noautorotate", "-i", str(source), "-an"),
            *("-fps_mode", "cfr", "-r", video.rate(info.fps), "-f", "rawvideo"),
            *("-pix_fmt", "rgb24", "pipe:1"),
        ],
        capture_output=True,
        check=True,
        timeout=60,
    ).stdout
    encode = [FFMPEG, "-nostdin", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24"]
    encode += ["-s", "48x32", "-i", "pipe:0", "-f", "null", "-"]
    decode = video.decode_args(
        source, info, max_seconds=caps["max_seconds"], max_frames=caps["max_frames"]
    )
    with video.FramePipe(decode, 48 * 32 * 3, encode, max_frames=caps["max_frames"]) as pipe:
        frames = pass_through(pipe)
    assert not pipe.cut
    assert frames == len(whole) // (48 * 32 * 3)


def test_whisper_hears_no_more_than_the_cap(media: dict[str, Path]) -> None:
    pcm = audio.decode(media["flac"], 3.04)
    assert audio.seconds_of(pcm) == pytest.approx(3.04, abs=0.01)
    assert audio.reached_cap(pcm, 3.04)
    assert "first 3.0 s were transcribed" in audio.cut_note(pcm)
    # Honest: the cap from the real length is never reached.
    honest = length_cap({"duration_ms": SPEECH_SEC * 1000})
    pcm = audio.decode(media["flac"], honest)
    assert audio.seconds_of(pcm) == pytest.approx(SPEECH_SEC, abs=0.01)
    assert not audio.reached_cap(pcm, honest)


def test_audio_that_cant_be_decoded_says_so(tmp_path: Path) -> None:
    broken = tmp_path / "input"
    broken.write_bytes(b"fLaC" + b"\x13" * 300)
    with pytest.raises(CallFailed) as caught:
        audio.decode(broken, 10.0)
    assert caught.value.code == "DECODE_FAILED"


@pytest.mark.parametrize(
    ("value", "frames", "seconds"),
    [
        (None, 18_000, 660.0),  # an older worker: the hard caps, never "no limit"
        (25, 25, 25.0),
        (10**9, 18_000, 660.0),  # never past the hard caps
    ],
)
def test_the_caps_default_to_the_hard_ones(value: int | None, frames: int, seconds: float) -> None:
    options = {} if value is None else {"max_frames": value, "max_seconds": value}
    assert int_cap(options, "max_frames", modal_app.MAX_VIDEO_FRAMES) == frames
    assert float_cap(options, "max_seconds", modal_app.MAX_VIDEO_SECONDS) == seconds


@pytest.mark.parametrize("value", [0, -3, "120", True, float("nan"), float("inf"), 2.5, [1]])
def test_a_cap_that_isnt_a_positive_number_is_refused(value: object) -> None:
    with pytest.raises(CallFailed) as caught:
        int_cap({"max_frames": value}, "max_frames", 100)
    assert caught.value.code == "BAD_INPUT"
    if value != 2.5:  # seconds may be fractional
        with pytest.raises(CallFailed):
            float_cap({"max_seconds": value}, "max_seconds", 100.0)


# --- worker and GPU function together ------------------------------------------------


class Bucket:
    """Storage as a dict; presigned URLs name their key."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def presign_get(self, key: str, expires_sec: int) -> str:
        return f"https://storage.test/{key}?get"

    def presign_put(self, key: str, content_type: str, expires_sec: int) -> str:
        return f"https://storage.test/{key}?put"

    def size(self, key: str) -> int | None:
        return len(self.objects[key]) if key in self.objects else None

    def download(self, key: str, dest: Path) -> int:
        dest.write_bytes(self.objects[key])
        return len(self.objects[key])

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


def key_of(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


class LocalModal:
    """The GPU backend, but the Modal function runs here, on its own code (``.local()``)."""

    name = "local-modal"

    def __init__(self) -> None:
        self.calls: list[GpuCall] = []

    def run(self, call: GpuCall) -> GpuResult:
        self.calls.append(call)
        started = time.monotonic()
        function = getattr(modal_app, call.function)
        answer = function.local(
            call.kwargs["input_url"], call.kwargs["output_url"], call.kwargs["options"]
        )
        return parse_answer(answer, time.monotonic() - started)

    def cancel(self, call_id: str) -> bool:
        return True


class Heard:
    """Whisper's stand-in: what it was given, and one segment over all of it."""

    def __init__(self) -> None:
        self.seconds: list[float] = []

    def transcribe(self, samples: bytes, **_kwargs: Any) -> dict[str, Any]:
        seconds = audio.seconds_of(samples)
        self.seconds.append(seconds)
        return {
            "language": "en",
            "segments": [{"start": 0.0, "end": seconds, "text": " A tone.", "words": []}],
        }


def doubled(_network: Any, frames: list[bytes], width: int, height: int, scale: int) -> list[bytes]:
    """The upscaler's stand-in: each pixel ``scale`` times both ways."""
    out = []
    for frame in frames:
        rows = []
        for y in range(height):
            row = frame[y * width * 3 : (y + 1) * width * 3]
            wide = b"".join(row[x * 3 : x * 3 + 3] * scale for x in range(width))
            rows.append(wide * scale)
        out.append(b"".join(rows))
    return out


def matter(
    _options: dict[str, Any], _call: Any, _width: int, _height: int, *, keyed: bool
) -> Callable[[bytes], bytes]:
    """BiRefNet's stand-in: everything is the subject."""

    def matte(frame: bytes) -> bytes:
        if not keyed:
            return frame
        return b"".join(frame[i : i + 3] + b"\xff" for i in range(0, len(frame), 3))

    return matte


@pytest.fixture
def gpu_here(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Any]:
    """Modal's function bodies with the bucket for storage and stand-ins for the models."""
    bucket = Bucket()
    results: dict[str, Path] = {}
    heard = Heard()

    def fetch(url: str, dest: Path, max_bytes: int) -> int:
        data = bucket.objects[key_of(url)]
        dest.write_bytes(data)
        return len(data)

    def put(url: str | None, path: Path, content_type: str) -> int:
        assert url is not None
        kept = tmp_path / f"result-{len(results)}{path.suffix}"
        shutil.copy(path, kept)  # the function's temp dir goes when it returns
        results[key_of(url)] = kept
        bucket.objects[key_of(url)] = path.read_bytes()
        return path.stat().st_size

    monkeypatch.setattr(modal_app, "fetch_input", fetch)
    monkeypatch.setattr(modal_app, "put_output", put)
    monkeypatch.setattr(modal_app, "_nvenc", lambda: False)
    monkeypatch.setattr(modal_app, "_upscaler", lambda *_args: object())
    monkeypatch.setattr(modal_app, "_upscale_frames", doubled)
    monkeypatch.setattr(modal_app, "_matter", matter)
    monkeypatch.setattr(modal_app, "_whisper", lambda _call: heard)
    monkeypatch.setattr(modal_app, "_samples", lambda pcm: pcm)
    return {"bucket": bucket, "results": results, "heard": heard, "workdir": tmp_path}


def run_job(
    gpu_here: dict[str, Any],
    tool: str,
    source: Path,
    meta: dict[str, Any],
    options: dict[str, Any],
) -> tuple[Output, GpuCall]:
    bucket: Bucket = gpu_here["bucket"]
    bucket.objects["in/file"] = source.read_bytes()
    gpu = LocalModal()
    ctx = JobContext(
        job_id="job",
        tool_id=tool,
        input_path=Path("/nonexistent/input"),
        workdir=gpu_here["workdir"],
        options=options,
        meta=meta,
        limits=Limits(timeout_sec=60),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
        input_key="in/file",
        storage=cast(Storage, bucket),
        gpu=gpu,
    )
    out = PROCESSORS[tool].run(ctx)
    assert len(gpu.calls) == 1
    return out, gpu.calls[0]


VIDEO_JOBS = [
    ("upscale-video", {"scale": "2"}),
    ("video-background-remover", {"output": "webm"}),
    ("video-background-remover", {"output": "green"}),
]


@pytest.mark.parametrize(("tool", "options"), VIDEO_JOBS)
def test_a_clip_whose_header_says_one_second_gets_one_second(
    gpu_here: dict[str, Any], media: dict[str, Path], tool: str, options: dict[str, Any]
) -> None:
    """The reviewer's case: priced as 1 s, decoded in full. Now 1 s and a second's margin."""
    out, call = run_job(gpu_here, tool, media["clip"], lying(1), options)
    sent = call.kwargs["options"]
    assert (sent["max_frames"], sent["max_seconds"]) == (1 * CLIP_FPS + CLIP_FPS, 2.02)
    assert out.key is not None
    made = gpu_here["results"][out.key]
    frames = int(streams(made)["video"]["nb_read_frames"])
    assert frames == sent["max_frames"] < CLIP_SEC * CLIP_FPS
    assert sound_sec(made) <= sent["max_seconds"] + 0.1
    assert any("runs longer than its header says" in note for note in out.meta["notes"])


@pytest.mark.parametrize(("tool", "options"), VIDEO_JOBS)
def test_the_same_clip_honestly_probed_comes_out_whole(
    gpu_here: dict[str, Any], media: dict[str, Path], tool: str, options: dict[str, Any]
) -> None:
    meta = summarize(probe_json(media["clip"]), "video/mp4")
    out, _ = run_job(gpu_here, tool, media["clip"], meta, options)
    assert out.key is not None
    made = gpu_here["results"][out.key]
    assert int(streams(made)["video"]["nb_read_frames"]) == CLIP_SEC * CLIP_FPS
    assert sound_sec(made) == pytest.approx(CLIP_SEC, abs=0.1)
    assert not any("header" in note for note in out.meta["notes"])


@pytest.mark.parametrize("tool", ["transcribe-audio", "auto-subtitles"])
def test_sound_whose_header_says_two_seconds_is_heard_for_two(
    gpu_here: dict[str, Any], media: dict[str, Path], tool: str
) -> None:
    meta = {"duration_ms": 2000, "audio": {"codec": "aac"}}
    out, call = run_job(gpu_here, tool, media["sound"], meta, {})
    assert call.kwargs["options"]["max_seconds"] == 3.04
    assert gpu_here["heard"].seconds == [pytest.approx(3.04, abs=0.03)]
    assert any("runs longer than its header says" in note for note in out.meta["notes"])
    # Honestly probed, Whisper hears all of it and nothing is said about it.
    honest = summarize(probe_json(media["sound"]), "audio/mp4")
    out, _ = run_job(gpu_here, tool, media["sound"], honest, {})
    assert gpu_here["heard"].seconds[-1] == pytest.approx(SPEECH_SEC, abs=0.05)
    assert not any("header" in note for note in out.meta["notes"])


def patch_mkv(path: Path, seconds: float) -> None:
    """The MKV's Segment Duration (EBML 0x4489, an 8-byte float in ms) set to ``seconds``."""
    data = bytearray(path.read_bytes())
    at = data.find(b"\x44\x89\x88")
    assert at > 0
    data[at + 3 : at + 11] = struct.pack(">d", seconds * 1000)
    path.write_bytes(data)


def patch_flac(path: Path, seconds: float) -> None:
    """The FLAC's STREAMINFO sample count (its last 36 bits before the MD5) set to ``seconds``."""
    data = bytearray(path.read_bytes())
    assert data[:4] == b"fLaC"
    assert data[4] & 0x7F == 0  # STREAMINFO, first as it must be
    field = int.from_bytes(data[18:26], "big")  # rate 20 bits, channels 3, bits 5, samples 36
    rate = field >> 44
    field = (field >> 36 << 36) | round(rate * seconds)
    data[18:26] = field.to_bytes(8, "big")
    path.write_bytes(data)


def test_real_files_whose_headers_lie_are_cut_where_they_were_priced(
    gpu_here: dict[str, Any], tmp_path: Path
) -> None:
    """The reviewer's files: an MKV and a FLAC whose headers say less than they hold,
    through the worker's own probe, the processor and the function."""
    clip = tmp_path / "long.mkv"
    ffmpeg(
        *("-f", "lavfi", "-i", f"testsrc=size={CLIP_W}x{CLIP_H}:rate={CLIP_FPS}:duration=6"),
        *("-f", "lavfi", "-i", "sine=duration=6", "-c:v", "libx264", "-c:a", "aac", str(clip)),
    )
    patch_mkv(clip, 1.0)
    meta = summarize(probe_json(clip), "video/x-matroska")
    assert meta["duration_ms"] == 1000
    out, _ = run_job(gpu_here, "upscale-video", clip, meta, {"scale": "2"})
    assert out.key is not None
    assert streams(gpu_here["results"][out.key])["video"]["nb_read_frames"] == "20"
    assert any("runs longer than its header says" in note for note in out.meta["notes"])

    tone = tmp_path / "long.flac"
    ffmpeg("-f", "lavfi", "-i", "sine=duration=6", "-ar", "16000", "-c:a", "flac", str(tone))
    patch_flac(tone, 2.0)
    meta = summarize(probe_json(tone), "audio/flac")
    assert meta["duration_ms"] == 2000
    run_job(gpu_here, "transcribe-audio", tone, meta, {})
    assert gpu_here["heard"].seconds == [pytest.approx(3.04, abs=0.01)]


@pytest.mark.parametrize(
    ("tool", "meta"),
    [
        ("upscale-video", lying(0)),
        ("video-background-remover", {**lying(1), "duration_ms": None}),
        ("transcribe-audio", {"duration_ms": 0, "audio": {"codec": "opus"}}),
        ("auto-subtitles", {"audio": {"codec": "opus"}}),
    ],
)
def test_a_file_that_doesnt_say_its_length_is_refused_before_the_gpu(
    gpu_here: dict[str, Any], tool: str, meta: dict[str, Any]
) -> None:
    """A browser's WebM recording has no length in its header: priced at the minimum, it
    would be decoded in full. It's refused instead, and its credits come back."""
    gpu = LocalModal()
    ctx = JobContext(
        job_id="job",
        tool_id=tool,
        input_path=Path("/nonexistent/input"),
        workdir=gpu_here["workdir"],
        options={},
        meta=meta,
        limits=Limits(timeout_sec=60),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
        input_key="in/file",
        storage=cast(Storage, gpu_here["bucket"]),
        gpu=gpu,
    )
    with pytest.raises(JobFailed) as caught:
        PROCESSORS[tool].run(ctx)
    assert caught.value.code == "NO_DURATION"
    assert gpu.calls == []


@pytest.mark.parametrize("function", ["upscale_video", "remove_video_background", "transcribe"])
def test_a_function_refuses_caps_that_arent_numbers(
    gpu_here: dict[str, Any], function: str
) -> None:
    gpu_here["bucket"].objects["in/file"] = b"never read"
    bad = {"max_frames": "lots", "max_seconds": -1}
    answer = getattr(modal_app, function).local(
        "https://storage.test/in/file?get", "https://storage.test/out?put", bad
    )
    assert (answer["ok"], answer["code"]) == (False, "BAD_INPUT")


def test_a_call_without_caps_still_stops_at_the_hard_ones(
    gpu_here: dict[str, Any], media: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A worker from before the caps: the function's own limits, never the whole file."""
    monkeypatch.setattr(modal_app, "MAX_VIDEO_SECONDS", 1.5)
    gpu_here["bucket"].objects["in/file"] = media["clip"].read_bytes()
    answer = modal_app.upscale_video.local(
        "https://storage.test/in/file?get", "https://storage.test/out?put", {"scale": 2}
    )
    assert answer["ok"], answer
    assert 1.5 * CLIP_FPS <= answer["meta"]["frames"] <= 1.5 * CLIP_FPS + 1
