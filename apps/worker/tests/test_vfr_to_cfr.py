"""V15 VFR to CFR (tools/video.md -> V15 tests): the output is constant, the
same length within a frame, and the sound ends with the picture."""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

import pytest

from etb_worker.probe import frame_times, probe_json, summarize, variable_frame_rate
from etb_worker.processors import PROCESSORS, JobContext
from etb_worker.processors.vfr_to_cfr import target_rate
from etb_worker.sandbox import Limits

FIXTURE = Path(__file__).parents[3] / "fixtures" / "video" / "clip-vfr.mp4"


def test_auto_picks_the_nearest_standard_rate() -> None:
    def auto(fps: float) -> str:
        return target_rate({"video": {"fps": fps}}, "auto")[0]

    assert auto(29.6) == "29.97"
    assert auto(24.2) == "24"
    assert auto(58.1) == "59.94"
    assert target_rate({"video": {"fps": 29.6}}, "25") == ("25", "25", 25.0)
    assert target_rate({"video": {"fps": 29.6}}, "23.976")[1] == "24000/1001"


def make(path: Path, *args: str) -> Path:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    subprocess.run(  # noqa: S603
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args, str(path)],  # noqa: S607
        check=True,
    )
    return path


@pytest.fixture(scope="module")
def phone_clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """6 s of picture on a wandering clock (like a phone's) with continuous sound."""
    return make(
        tmp_path_factory.mktemp("vfr") / "phone.mp4",
        *("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=6"),
        *("-f", "lavfi", "-i", "sine=frequency=440:duration=6"),
        *("-vf", "setpts='(N/30+0.009*sin(N*1.7))/TB'", "-fps_mode", "passthrough"),
        *("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"),
        *("-c:a", "aac", "-shortest"),
    )


def convert(source: Path, tmp_path: Path, options: dict[str, Any]) -> Any:
    work = tmp_path / "work"
    work.mkdir()
    shutil.copy(source, work / "input")
    ctx = JobContext(
        job_id="test",
        tool_id="vfr-to-cfr",
        input_path=work / "input",
        workdir=work,
        options=options,
        meta=summarize(probe_json(source), "video/mp4"),
        limits=Limits(timeout_sec=120),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
    )
    return PROCESSORS["vfr-to-cfr"].run(ctx)


def streams(path: Path) -> list[dict[str, Any]]:
    out = subprocess.run(  # noqa: S603
        [
            *("ffprobe", "-v", "error", "-show_entries"),
            "stream=codec_type,codec_name,pix_fmt,r_frame_rate,avg_frame_rate,duration",
            *("-of", "json", str(path)),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    found: list[dict[str, Any]] = json.loads(out)["streams"]
    return found


def test_the_fixture_is_variable_and_the_result_constant(tmp_path: Path) -> None:
    source = summarize(probe_json(FIXTURE), "video/mp4")
    assert source["video"]["vfr"] is True
    output = convert(FIXTURE, tmp_path, {"fps": "auto", "quality": "best"})
    assert variable_frame_rate(frame_times(output.path)) is False
    video = streams(output.path)[0]
    assert video["codec_name"] == "h264"
    assert video["r_frame_rate"] == video["avg_frame_rate"]
    # The same length, within a frame.
    frame = 1 / target_rate(source, "auto")[2]
    assert abs(float(video["duration"]) - source["duration_ms"] / 1000) <= frame + 0.001
    assert output.meta["notes"][0].startswith("Constant ")


def test_the_sound_stays_in_sync_to_the_end(phone_clip: Path, tmp_path: Path) -> None:
    assert summarize(probe_json(phone_clip), "video/mp4")["video"]["vfr"] is True
    output = convert(phone_clip, tmp_path, {"fps": "30", "quality": "high", "audio": "keep"})
    video, audio = streams(output.path)
    assert (video["codec_name"], audio["codec_name"]) == ("h264", "aac")
    assert video["avg_frame_rate"] == "30/1"
    # Picture and sound end together, within a frame.
    assert abs(float(video["duration"]) - float(audio["duration"])) < 1 / 30
    assert abs(float(video["duration"]) - 6) < 1 / 30 + 0.001
    assert "sound was re-timed" in output.meta["notes"][1]


def test_ten_bit_stays_ten_bit_and_the_sound_can_go(tmp_path: Path) -> None:
    source = make(
        tmp_path / "hdr.mp4",
        *("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=3"),
        *("-vf", "setpts='(N/30+0.008*sin(N))/TB'", "-fps_mode", "passthrough"),
        *("-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le"),
        *("-x265-params", "log-level=error"),
    )
    output = convert(source, tmp_path, {"fps": "25", "audio": "remove"})
    [video] = streams(output.path)
    assert (video["codec_name"], video["pix_fmt"]) == ("hevc", "yuv420p10le")
    assert video["avg_frame_rate"] == "25/1"
    assert output.meta["codec"] == "H.265"
