"""The GPU functions' own ffmpeg and ffprobe inputs may read only local files and pipes.

The worker's commands get ``-protocol_whitelist file,pipe`` before every input
(``sandbox.ffmpeg``). The GPU functions build theirs in gpu/video.py and
gpu/audio.py, for Modal's containers, and now get the same, so what a file
names (a playlist's segments, a reference) is never fetched over the network,
whatever ffmpeg build the image has. The commands run against real files in
test_gpu_decode_caps.py; here their inputs are checked.
"""

from __future__ import annotations

import subprocess
from fractions import Fraction
from pathlib import Path
from typing import Any

import pytest

from etb_worker.gpu import audio, video
from etb_worker.gpu.remote import CallFailed, guard_inputs
from tests.test_sandbox import assert_every_input_reads_local_files_only

INFO = video.parse_probe(
    {"streams": [{"codec_type": "video", "width": 64, "height": 48, "avg_frame_rate": "25/1"}]}
)


def test_the_whitelist_goes_before_every_input() -> None:
    assert guard_inputs(["ffmpeg", "-f", "rawvideo", "-i", "pipe:0", "-i", "in", "out"]) == [
        *("ffmpeg", "-f", "rawvideo", "-protocol_whitelist", "file,pipe", "-i", "pipe:0"),
        *("-protocol_whitelist", "file,pipe", "-i", "in", "out"),
    ]


@pytest.mark.parametrize("encoding", ["h264", "prores4444", "vp9alpha"])
def test_every_gpu_command_reads_local_files_only(tmp_path: Path, encoding: Any) -> None:
    source = tmp_path / "input"
    assert_every_input_reads_local_files_only(
        video.decode_args(source, INFO, max_seconds=6.1, max_frames=180)
    )
    encode, _ = video.encode_args(
        tmp_path / "out",
        encoding=encoding,
        width=64,
        height=48,
        fps=Fraction(25),
        source=source,
        audio="aac",
        max_seconds=6.1,
    )
    # Two inputs: the frames on stdin, and the user's file for its sound.
    assert encode.count("-i") == 2
    assert_every_input_reads_local_files_only(encode)
    assert_every_input_reads_local_files_only(audio.decode_args(source, 60.0))


def test_the_gpu_probe_reads_local_files_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[list[str]] = []

    def spy(args: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        seen.append(args)
        return subprocess.CompletedProcess(args, 0, stdout=b'{"streams": []}', stderr=b"")

    monkeypatch.setattr(subprocess, "run", spy)
    with pytest.raises(CallFailed):  # no picture: refused, as before
        video.probe(tmp_path / "input")
    [args] = seen
    assert args[args.index("-protocol_whitelist") + 1] == "file"
    assert args.index("-protocol_whitelist") < args.index(str(tmp_path / "input"))
