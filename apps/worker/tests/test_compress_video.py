"""V02 Compress Video on the server: the plan (the browser tool's numbers) and real ffmpeg runs."""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

import pytest

from etb_worker.probe import probe_json, summarize
from etb_worker.processors import PROCESSORS, JobContext, JobFailed
from etb_worker.processors.compress_video import plan, size_for_short_side
from etb_worker.sandbox import Limits

# The browser tool's test clip (packages/engines/src/video/video.test.ts): 2 min of 1080p30, AAC.
HD: dict[str, Any] = {
    "duration_ms": 120_000,
    "video": {"codec": "h264", "width": 1920, "height": 1080, "fps": 30, "pix_fmt": "yuv420p"},
    "audio": {"codec": "aac", "channels": 2, "sample_rate": 48000, "bit_rate": 128_000},
}


def test_works_out_the_bitrate_and_steps_the_size_down_like_the_browser() -> None:
    p = plan(HD, {"mode": "size", "targetMb": 25, "resolution": "auto", "codec": "h264"})
    # (25 MB x 0.97 x 8 / 120 s) - 128 kbps, the same as the browser's plan
    assert p.video_bps == pytest.approx(1_488_667, abs=100)
    assert (p.width, p.height) == (1280, 720)
    assert p.notes[0] == "Scaled down to 1280 × 720 px, so 25 MB still looks clean"  # noqa: RUF001
    assert p.audio == "copy"
    # H.265 needs fewer bits, so it keeps 1080p a step longer.
    assert plan(HD, {"mode": "size", "targetMb": 50, "codec": "h265"}).height == 1080


def test_keeps_portrait_video_portrait_even_when_stored_sideways() -> None:
    sideways = {**HD, "video": {**HD["video"], "rotation": 90}}
    p = plan(sideways, {"mode": "size", "targetMb": 10, "resolution": "auto", "codec": "h264"})
    assert p.width < p.height
    assert (p.width % 2, p.height % 2) == (0, 0)
    assert size_for_short_side(1080, 1920, 720) == (720, 1280)


def test_refuses_a_target_the_audio_alone_overflows() -> None:
    with pytest.raises(JobFailed) as caught:
        plan({**HD, "duration_ms": 600_000}, {"mode": "size", "targetMb": 8, "codec": "h264"})
    assert caught.value.code == "TARGET_TOO_SMALL"
    assert "the sound alone takes 9.6 MB" in str(caught.value)
    silent = {**HD, "audio": None, "duration_ms": 3_600_000}
    with pytest.raises(JobFailed, match="too small for 3600 s of video"):
        plan(silent, {"mode": "size", "targetMb": 8, "codec": "h264"})


def test_maps_quality_levels_fixed_sizes_frame_rates_codecs_and_audio() -> None:
    p = plan(
        HD,
        {"mode": "quality", "quality": "small", "resolution": "720", "fps": "24", "codec": "h264"},
    )
    assert (p.crf, p.width, p.height, p.fps, p.container) == (28, 1280, 720, 24, "mp4")
    # Never upscales, never raises the frame rate.
    keep = plan(HD, {"mode": "quality", "quality": "high", "resolution": "1080", "fps": "30"})
    assert (keep.width, keep.height, keep.fps) == (1920, 1080, None)
    # VP9 goes in WebM, with the audio as Opus; AAC can't be copied there.
    vp9 = plan(HD, {"mode": "quality", "quality": "medium", "codec": "vp9"})
    assert (vp9.container, vp9.audio, vp9.audio_bps, vp9.crf) == ("webm", "opus", 96_000, 34)
    muted = plan(HD, {"mode": "size", "targetMb": 25, "codec": "av1", "audio": "remove"})
    assert (muted.audio, muted.audio_bps, muted.container) == (None, 0, "mp4")
    with pytest.raises(JobFailed) as caught:
        plan({**HD, "video": None}, {"mode": "quality", "quality": "high"})
    assert caught.value.code == "NO_VIDEO"


def test_ten_bit_sources_are_saved_in_eight_bit_and_say_so() -> None:
    hdr = {**HD, "video": {**HD["video"], "pix_fmt": "yuv420p10le"}}
    assert "8-bit" in plan(hdr, {"mode": "quality", "quality": "high"}).notes[0]


# Real runs, on a clip ffmpeg makes: noisy enough that its size target means something.


@pytest.fixture(scope="module")
def clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    path = tmp_path_factory.mktemp("compress") / "clip.mp4"
    subprocess.run(  # noqa: S603
        [  # noqa: S607
            "ffmpeg",
            *("-hide_banner", "-loglevel", "error", "-y"),
            *("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=6,noise=alls=30:allf=t"),
            *("-f", "lavfi", "-i", "sine=frequency=330:duration=6"),
            *("-c:v", "libx264", "-preset", "ultrafast", "-b:v", "6M"),
            *("-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest"),
            str(path),
        ],
        check=True,
    )
    return path


def compress(clip: Path, tmp_path: Path, options: dict[str, Any]) -> tuple[Any, list[int]]:
    work = tmp_path / "work"
    work.mkdir()
    shutil.copy(clip, work / "input")
    seen: list[int] = []
    ctx = JobContext(
        job_id="test",
        tool_id="compress-video",
        input_path=work / "input",
        workdir=work,
        options=options,
        meta=summarize(probe_json(clip), "video/mp4"),
        limits=Limits(timeout_sec=120),
        cancel=threading.Event(),
        progress=lambda pct, _stage: seen.append(pct),
    )
    return PROCESSORS["compress-video"].run(ctx), seen


def streams(path: Path) -> dict[str, Any]:
    out = subprocess.run(  # noqa: S603
        [
            *("ffprobe", "-v", "error", "-show_entries"),
            "stream=codec_name,width,height:format=format_name,duration",
            *("-of", "json", str(path)),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    data: dict[str, Any] = json.loads(out)
    return data


def test_a_size_target_lands_just_under_it(clip: Path, tmp_path: Path) -> None:
    target_mb = 1.5
    output, seen = compress(
        clip, tmp_path, {"mode": "size", "targetMb": target_mb, "resolution": "keep"}
    )
    size = output.path.stat().st_size
    assert size <= target_mb * 1_000_000
    assert size >= target_mb * 1_000_000 * 0.75
    info = streams(output.path)
    assert [s["codec_name"] for s in info["streams"]] == ["h264", "aac"]
    assert float(info["format"]["duration"]) == pytest.approx(6, abs=0.1)
    assert (output.ext, output.content_type) == ("mp4", "video/mp4")
    assert output.meta["codec"] == "H.264"
    # Both passes reported, in order.
    assert seen == sorted(seen)
    assert seen[-1] >= 85


def test_quality_mode_vp9_makes_a_webm_with_opus(clip: Path, tmp_path: Path) -> None:
    output, _ = compress(
        clip, tmp_path, {"mode": "quality", "quality": "small", "codec": "vp9", "resolution": "360"}
    )
    info = streams(output.path)
    assert "webm" in info["format"]["format_name"]
    assert [s["codec_name"] for s in info["streams"]] == ["vp9", "opus"]
    assert (output.ext, output.content_type) == ("webm", "video/webm")


def test_h265_with_the_sound_removed_and_a_lower_frame_rate(clip: Path, tmp_path: Path) -> None:
    output, _ = compress(
        clip,
        tmp_path,
        {"mode": "size", "targetMb": 1, "codec": "h265", "audio": "remove", "fps": "15"},
    )
    info = streams(output.path)
    assert [s["codec_name"] for s in info["streams"]] == ["hevc"]
    assert output.path.stat().st_size <= 1_000_000
