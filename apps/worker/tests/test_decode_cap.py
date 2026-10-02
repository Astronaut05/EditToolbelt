"""A job reads its input only as far as it was priced (docs/11 -> Uploads).

The probe takes the length from the container's header, which the uploader
controls. These tests make a file whose header undersells its length and check
that the job processes the length it was priced for, not the whole file.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import threading
from pathlib import Path

import pytest

from etb_worker.probe import probe_json, summarize
from etb_worker.processors import PROCESSORS, JobContext, cap_input, priced_seconds
from etb_worker.sandbox import Limits


def test_the_priced_length_has_a_margin_for_honest_files() -> None:
    assert priced_seconds({"duration_ms": 60_000}) == 62.2
    assert priced_seconds({"duration_ms": 1}) == 1.001
    # Nothing to cap: an image, subtitles, a broken probe.
    assert priced_seconds({}) is None
    assert priced_seconds({"duration_ms": 0}) is None
    assert priced_seconds({"duration_ms": True}) is None
    assert priced_seconds({"duration_ms": "60000"}) is None


def test_every_read_of_the_input_is_capped_and_nothing_else() -> None:
    args = ["ffmpeg", "-y", "-i", "input", "-i", "extra-0", "-map", "0:v", "-i", "input", "out"]
    assert cap_input(args, "input", 9.5) == [
        *("ffmpeg", "-y", "-t", "9.500", "-i", "input", "-i", "extra-0"),
        *("-map", "0:v", "-t", "9.500", "-i", "input", "out"),
    ]
    assert cap_input(["ffmpeg", "-i", "other", "out"], "input", 9.5) == [
        *("ffmpeg", "-i", "other", "out"),
    ]


def test_a_shorter_limit_of_the_processor_is_kept_a_longer_one_cut() -> None:
    assert cap_input(["ffmpeg", "-t", "3", "-i", "input", "o"], "input", 9.5)[1:3] == [
        *("-t", "3.000"),
    ]
    assert cap_input(["ffmpeg", "-ss", "1", "-to", "20", "-i", "input", "o"], "input", 9.5) == [
        *("ffmpeg", "-ss", "1", "-to", "9.500", "-i", "input", "o"),
    ]
    # Another input's limit is its own business.
    assert cap_input(["ffmpeg", "-t", "60", "-i", "extra-0", "-i", "input", "o"], "input", 2) == [
        *("ffmpeg", "-t", "60", "-i", "extra-0", "-t", "2.000", "-i", "input", "o"),
    ]


def make(path: Path, *args: str) -> Path:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    subprocess.run(  # noqa: S603
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args, str(path)],  # noqa: S607
        check=True,
    )
    return path


def undersell(path: Path, seconds: float) -> None:
    """Rewrites a Matroska file's Segment Duration (an 8-byte float, in ms) to ``seconds``."""
    data = bytearray(path.read_bytes())
    at = data.find(b"\x44\x89\x88")
    assert at > 0, "no 8-byte Duration element"
    data[at + 3 : at + 11] = struct.pack(">d", seconds * 1000)
    path.write_bytes(bytes(data))


def duration(path: Path) -> float:
    out = subprocess.run(  # noqa: S603
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return float(json.loads(out)["format"]["duration"])


def test_a_header_that_undersells_the_length_gets_the_length_it_paid_for(
    tmp_path: Path,
) -> None:
    source = make(
        tmp_path / "long.mkv",
        *("-f", "lavfi", "-i", "testsrc2=size=160x120:rate=25:duration=12"),
        *("-f", "lavfi", "-i", "sine=frequency=440:duration=12"),
        *("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"),
        *("-c:a", "aac", "-shortest"),
    )
    undersell(source, 3)
    meta = summarize(probe_json(source), "video/x-matroska")
    assert meta["duration_ms"] == 3000  # the probe believes the header

    work = tmp_path / "work"
    work.mkdir()
    shutil.copy(source, work / "input")
    ctx = JobContext(
        job_id="test",
        tool_id="vfr-to-cfr",
        input_path=work / "input",
        workdir=work,
        options={"fps": "25", "quality": "high", "audio": "keep"},
        meta=meta,
        limits=Limits(timeout_sec=120),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
    )
    output = PROCESSORS["vfr-to-cfr"].run(ctx)
    assert output.path is not None
    # 3 s priced, so 3 * 1.02 + 1 s read (plus the last AAC frame); without the cap, 12 s.
    assert duration(output.path) < 4.3
