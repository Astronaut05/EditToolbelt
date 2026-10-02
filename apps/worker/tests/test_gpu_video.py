"""Video in and out for the GPU video functions (gpu/video.py), against the worker's own ffmpeg.

The models run only on Modal; here a stand-in (inverting each byte, or
adding an alpha channel) sits where they go, so the decoding, frame
timing, rotation, sound and encoders are checked for real.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path
from typing import Any

import pytest

from etb_worker.gpu import video
from etb_worker.gpu.remote import CallFailed

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"
needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
#: Caps far past the test clips: the tests that aren't about them.
ROOMY_SEC = 600.0
ROOMY_FRAMES = 18_000


def stream(**extra: Any) -> dict[str, Any]:
    base = {
        "codec_type": "video",
        "width": 1920,
        "height": 1080,
        "avg_frame_rate": "30000/1001",
        "r_frame_rate": "30000/1001",
        "pix_fmt": "yuv420p",
        "duration": "10.0",
    }
    base.update(extra)
    return base


def test_the_probe_reads_size_rate_and_frames() -> None:
    info = video.parse_probe({"streams": [stream()], "format": {"duration": "10.0"}})
    assert (info.width, info.height) == (1920, 1080)
    assert info.fps == Fraction(30000, 1001)
    assert info.frames == 300
    assert not info.variable
    assert (info.hdr, info.deep) == (False, False)
    assert info.matrix == "bt709"  # untagged HD is read as BT.709, as players do
    assert info.turn == ""
    assert info.audio is None


def test_a_phone_video_is_turned_upright_and_its_rate_made_constant() -> None:
    raw = {
        "streams": [
            stream(
                width=1920,
                height=1080,
                avg_frame_rate="28999/1000",
                r_frame_rate="30/1",
                side_data_list=[{"rotation": -90}],
                color_transfer="arib-std-b67",
                pix_fmt="yuv420p10le",
                color_space="bt2020nc",
            ),
            {"codec_type": "audio", "codec_name": "aac"},
        ]
    }
    info = video.parse_probe(raw)
    assert (info.width, info.height) == (1080, 1920)
    assert info.turn == "transpose=clock"
    assert info.variable
    assert info.fps == Fraction(28999, 1000)
    assert (info.hdr, info.deep, info.matrix) == (True, True, "bt2020")
    assert info.audio == "aac"


@pytest.mark.parametrize(
    ("average", "real", "expected"),
    [
        ("25/1", "25/1", Fraction(25)),
        ("0/0", "24000/1001", Fraction(24000, 1001)),
        ("1000/1", "240/1", Fraction(120)),
        ("0/0", "0/0", Fraction(30)),
        ("1/5", "0/0", Fraction(30)),
    ],
)
def test_the_rate_to_make(average: str, real: str, expected: Fraction) -> None:
    assert video.pick_fps(average, real) == expected


def test_a_cover_picture_is_not_the_video() -> None:
    cover = stream(disposition={"attached_pic": 1}, index=0)
    with pytest.raises(CallFailed) as caught:
        video.parse_probe({"streams": [cover, {"codec_type": "audio", "codec_name": "mp3"}]})
    assert caught.value.code == "NO_VIDEO"
    # A cover that comes first: the decoder reads the real picture's stream.
    info = video.parse_probe({"streams": [cover, stream(index=1)]})
    assert info.stream == 1
    args = video.decode_args(Path("input"), info, max_seconds=ROOMY_SEC, max_frames=ROOMY_FRAMES)
    assert args[args.index("-map") + 1] == "0:1"


def test_4k_either_way_round() -> None:
    assert video.fits_4k(3840, 2160)
    assert video.fits_4k(2160, 3840)
    assert not video.fits_4k(4096, 2160)
    assert not video.fits_4k(3840, 2400)


@pytest.mark.parametrize(
    ("container", "codec", "copied"),
    [
        ("mp4", "aac", True),
        ("mp4", "opus", False),
        ("mov", "pcm_s24le", True),
        ("mov", "mp3", False),
        ("webm", "opus", True),
        ("webm", "aac", False),
    ],
)
def test_sound_is_copied_when_the_container_takes_it(
    container: str, codec: str, copied: bool
) -> None:
    args, note = video.audio_args(container, codec)
    assert ("copy" in args) is copied
    assert (note is None) is copied
    assert args[:2] == ["-map", "1:a:0?"]
    assert video.audio_args(container, None) == (["-an"], None)


def test_h264_peaks_are_capped_so_ten_minutes_of_4k_fit_one_upload() -> None:
    cap = video.h264_rate_cap(3840, 2160)
    assert cap == 50_000
    assert cap * 1000 / 8 * 600 < 4_000_000_000
    assert video.h264_rate_cap(640, 360) == 8000


def test_the_encoders_get_what_editors_expect(tmp_path: Path) -> None:
    common: dict[str, Any] = {
        "width": 101,
        "height": 75,
        "fps": Fraction(25),
        "source": tmp_path / "input",
        "audio": "aac",
        "max_seconds": 12.5,
    }
    h264, notes = video.encode_args(tmp_path / "o.mp4", encoding="h264", **common)
    assert "crop=trunc(iw/2)*2:trunc(ih/2)*2" in h264[h264.index("-vf") + 1]
    assert h264[h264.index("-pix_fmt") + 1] == "rgb24"
    assert "libx264" in h264
    assert notes == []
    nvenc, _ = video.encode_args(tmp_path / "o.mp4", encoding="h264", nvenc=True, **common)
    assert "h264_nvenc" in nvenc
    prores, notes = video.encode_args(tmp_path / "o.mov", encoding="prores4444", **common)
    assert prores[prores.index("-pix_fmt") + 1] == "rgba"
    assert "yuva444p10le" in prores[prores.index("-vf") + 1]
    assert prores[prores.index("-profile:v") + 1] == "4444"
    webm, notes = video.encode_args(tmp_path / "o.webm", encoding="vp9alpha", **common)
    assert "yuva420p" in webm[webm.index("-vf") + 1]
    assert notes == ["The sound was re-encoded to Opus"]


# --- with ffmpeg ---------------------------------------------------------------


def make_clip(path: Path, *, size: str = "64x48", rate: int = 10, seconds: float = 1.0) -> None:
    subprocess.run(  # noqa: S603
        [
            FFMPEG,
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size={size}:rate={rate}:duration={seconds}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={seconds}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            "-f",
            "mp4",
            str(path),
        ],
        check=True,
        timeout=60,
    )


def ffprobe(path: Path) -> dict[str, Any]:
    out = subprocess.run(  # noqa: S603
        [
            FFPROBE,
            "-v",
            "error",
            "-count_frames",
            "-print_format",
            "json",
            "-show_streams",
            str(path),
        ],
        capture_output=True,
        check=True,
        timeout=60,
    )
    data: dict[str, Any] = json.loads(out.stdout)
    return data


def invert(frame: bytes) -> bytes:
    return bytes(255 - b for b in frame)


@needs_ffmpeg
def test_frames_go_through_the_model_and_come_out_with_the_sound(tmp_path: Path) -> None:
    source = tmp_path / "input"
    make_clip(source)
    info = video.probe(source)
    assert (info.width, info.height, info.fps, info.frames) == (64, 48, Fraction(10), 10)
    assert info.audio == "aac"
    target = tmp_path / "out.mp4"
    encode, notes = video.encode_args(
        target,
        encoding="h264",
        width=128,
        height=96,
        fps=info.fps,
        source=source,
        audio=info.audio,
        max_seconds=ROOMY_SEC,
    )
    assert notes == []
    decode = video.decode_args(source, info, max_seconds=ROOMY_SEC, max_frames=ROOMY_FRAMES)
    with video.FramePipe(decode, 64 * 48 * 3, encode, max_frames=ROOMY_FRAMES) as pipe:
        for frame in pipe.frames():
            assert len(frame) == 64 * 48 * 3
            # A "2x upscale": each pixel doubled both ways.
            rows = [invert(frame[y * 192 : (y + 1) * 192]) for y in range(48)]
            wide = [b"".join(row[x * 3 : x * 3 + 3] * 2 for x in range(64)) for row in rows]
            pipe.write(b"".join(line + line for line in wide))
        written = pipe.finish()
    assert written == 10
    assert not pipe.cut
    out = ffprobe(target)["streams"]
    picture = next(s for s in out if s["codec_type"] == "video")
    assert (picture["width"], picture["height"]) == (128, 96)
    assert picture["nb_read_frames"] == "10"
    assert picture["color_space"] == "bt709"
    assert any(s["codec_type"] == "audio" and s["codec_name"] == "aac" for s in out)


@needs_ffmpeg
def test_a_rotated_phone_clip_is_read_upright_like_a_player_shows_it(tmp_path: Path) -> None:
    plain = tmp_path / "plain.mp4"
    make_clip(plain, size="32x16", seconds=0.3)
    turned = tmp_path / "turned.mp4"
    subprocess.run(  # noqa: S603
        [
            FFMPEG,
            "-v",
            "error",
            "-display_rotation",
            "90",
            "-i",
            str(plain),
            "-c",
            "copy",
            str(turned),
        ],
        check=True,
        timeout=60,
    )
    info = video.probe(turned)
    assert (info.width, info.height) == (16, 32)
    ours = subprocess.run(  # noqa: S603
        video.decode_args(turned, info, max_seconds=ROOMY_SEC, max_frames=ROOMY_FRAMES),
        capture_output=True,
        check=True,
        timeout=60,
    ).stdout
    player = subprocess.run(  # noqa: S603
        [
            FFMPEG,
            "-v",
            "error",
            "-i",
            str(turned),
            "-an",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        capture_output=True,
        check=True,
        timeout=60,
    ).stdout
    assert len(ours) == len(player) == 3 * 16 * 32 * 3
    wrong_way = subprocess.run(  # noqa: S603
        [
            FFMPEG,
            "-v",
            "error",
            "-noautorotate",
            "-i",
            str(turned),
            "-an",
            "-vf",
            "transpose=clock",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        capture_output=True,
        check=True,
        timeout=60,
    ).stdout

    def gap(a: bytes, b: bytes) -> float:
        return sum(abs(x - y) for x, y in zip(a, b, strict=True)) / len(a)

    # Ffmpeg's own autorotation, but for our sharper chroma: far from the other way round.
    assert gap(ours, player) < gap(wrong_way, player) / 4


@needs_ffmpeg
@pytest.mark.parametrize(
    ("encoding", "suffix", "pix_fmt"),
    [
        ("prores4444", "mov", "yuva444p"),
        ("vp9alpha", "webm", "yuva420p"),
    ],
)
def test_the_matte_becomes_the_alpha_channel(
    tmp_path: Path, encoding: video.Encoding, suffix: str, pix_fmt: str
) -> None:
    source = tmp_path / "input"
    make_clip(source, seconds=0.3)
    info = video.probe(source)
    target = tmp_path / f"out.{suffix}"
    encode, _ = video.encode_args(
        target,
        encoding=encoding,
        width=64,
        height=48,
        fps=info.fps,
        source=source,
        audio=info.audio,
        max_seconds=ROOMY_SEC,
    )
    decode = video.decode_args(source, info, max_seconds=ROOMY_SEC, max_frames=ROOMY_FRAMES)
    with video.FramePipe(decode, 64 * 48 * 3, encode, max_frames=ROOMY_FRAMES) as pipe:
        for frame in pipe.frames():
            # Opaque on the left half, clear on the right.
            alpha = (b"\xff" * 32 + b"\x00" * 32) * 48
            pipe.write(
                b"".join(frame[i * 3 : i * 3 + 3] + alpha[i : i + 1] for i in range(64 * 48))
            )
        assert pipe.finish() == 3
    streams = ffprobe(target)["streams"]
    picture = next(s for s in streams if s["codec_type"] == "video")
    if encoding == "prores4444":
        # 4:4:4 with alpha (ffmpeg's ProRes decoder reports 12 bits).
        assert picture["pix_fmt"].startswith(pix_fmt)
    else:
        # WebM keeps VP9's alpha as a second layer that its own decoder reads.
        assert (picture.get("tags") or {}).get("alpha_mode") == "1"
        assert any(s["codec_type"] == "audio" and s["codec_name"] == "opus" for s in streams)


@needs_ffmpeg
def test_a_damaged_file_fails_as_undecodable(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x13" * 4000)
    with pytest.raises(CallFailed) as caught:
        video.probe(source)
    assert caught.value.code in {"DECODE_FAILED", "NO_VIDEO"}


@needs_ffmpeg
def test_an_error_mid_way_stops_both_processes(tmp_path: Path) -> None:
    source = tmp_path / "input"
    make_clip(source, seconds=2.0)
    info = video.probe(source)
    encode, _ = video.encode_args(
        tmp_path / "out.mp4",
        encoding="h264",
        width=64,
        height=48,
        fps=info.fps,
        source=source,
        audio=None,
        max_seconds=ROOMY_SEC,
    )
    decode = video.decode_args(source, info, max_seconds=ROOMY_SEC, max_frames=ROOMY_FRAMES)
    pipe = video.FramePipe(decode, 64 * 48 * 3, encode, max_frames=ROOMY_FRAMES, depth=2)

    def model_fails_on_the_third_frame() -> None:
        with pipe:
            for count, frame in enumerate(pipe.frames()):
                pipe.write(frame)
                if count == 2:
                    raise RuntimeError("the model failed")

    with pytest.raises(RuntimeError):
        model_fails_on_the_third_frame()
    assert pipe._decoder.poll() is not None
    assert pipe._encoder.poll() is not None


@needs_ffmpeg
def test_an_encoder_that_dies_fails_the_call(tmp_path: Path) -> None:
    source = tmp_path / "input"
    make_clip(source, seconds=0.5)
    info = video.probe(source)
    # An encoder that ffmpeg doesn't have: it exits at once, and writing to it fails.
    encode = [
        FFMPEG,
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        "64x48",
        "-i",
        "pipe:0",
        "-c:v",
        "no-such-encoder",
        str(tmp_path / "out.mp4"),
    ]

    def run() -> None:
        decode = video.decode_args(source, info, max_seconds=ROOMY_SEC, max_frames=ROOMY_FRAMES)
        with video.FramePipe(decode, 64 * 48 * 3, encode, max_frames=ROOMY_FRAMES) as pipe:
            for frame in pipe.frames():
                pipe.write(frame)
            pipe.finish()

    with pytest.raises(CallFailed) as caught:
        run()
    assert caught.value.code == "GPU_FAILED"


def test_what_changed_is_said_in_plain_words() -> None:
    phone = video.parse_probe(
        {
            "streams": [
                stream(avg_frame_rate="28771/1000", r_frame_rate="30/1", pix_fmt="yuv420p10le")
            ]
        }
    )
    assert video.notes_for(phone) == [
        "Variable frame rate made constant at 28.77 fps",
        "10-bit video was made 8-bit",
    ]
    long = video.parse_probe(
        {"streams": [stream(avg_frame_rate="60/1", r_frame_rate="60/1", duration="600")]}
    )
    assert video.too_many_frames(long, 18_000) == (
        "This clip is 36,000 frames (10.0 min at 60 fps); we take up to 18,000, "
        "which is 5.0 min at this frame rate. Trim it first."
    )
