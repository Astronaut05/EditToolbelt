from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest

from etb_worker.sandbox import Limits, ToolError, ffmpeg, run

QUICK = Limits(timeout_sec=10)


def test_passes_stdout_lines_and_returns_the_stderr_tail(tmp_path: Path) -> None:
    lines: list[str] = []
    tail = run(
        ["sh", "-c", "echo one; echo two; echo oops >&2"],
        cwd=tmp_path,
        limits=QUICK,
        on_line=lines.append,
    )
    assert lines == ["one", "two"]
    assert tail == "oops"


def test_a_failing_tool_reports_its_exit_code(tmp_path: Path) -> None:
    with pytest.raises(ToolError) as caught:
        run(["sh", "-c", "echo broken >&2; exit 3"], cwd=tmp_path, limits=QUICK)
    assert caught.value.code == "TOOL_FAILED"
    assert "exit 3" in str(caught.value)
    assert "broken" in str(caught.value)


def test_the_timeout_kills_the_whole_process_group(tmp_path: Path) -> None:
    marker = tmp_path / "late"
    started = time.monotonic()
    with pytest.raises(ToolError) as caught:
        # The child in the background would write the file after 2 s if it survived.
        run(
            ["sh", "-c", f"(sleep 2; touch {marker}) & sleep 30"],
            cwd=tmp_path,
            limits=Limits(timeout_sec=0.5),
        )
    assert caught.value.code == "TIMEOUT"
    assert time.monotonic() - started < 5
    time.sleep(2.5)
    assert not marker.exists()


def test_cancel_stops_the_tool(tmp_path: Path) -> None:
    cancel = threading.Event()
    threading.Timer(0.3, cancel.set).start()
    with pytest.raises(ToolError) as caught:
        run(["sleep", "30"], cwd=tmp_path, limits=QUICK, cancel=cancel)
    assert caught.value.code == "CANCELLED"


def test_the_tool_gets_a_clean_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://etb:secret-pass@db/etb")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "super-secret")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    lines: list[str] = []
    run(["env"], cwd=tmp_path, limits=QUICK, on_line=lines.append)
    names = {line.split("=", 1)[0] for line in lines}
    assert names <= {"PATH", "LC_ALL", "HOME", "PWD", "SHLVL", "_"}


def test_memory_is_capped(tmp_path: Path) -> None:
    grab = "b = bytearray(600 * 1024 * 1024)"
    with pytest.raises(ToolError) as caught:
        run(
            [sys.executable, "-c", grab],
            cwd=tmp_path,
            limits=Limits(timeout_sec=20, memory_bytes=200 * 1024 * 1024),
        )
    assert caught.value.code == "TOOL_FAILED"


def test_refuses_anything_but_an_argument_list(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="list of strings"):
        run([], cwd=tmp_path, limits=QUICK)


def test_ffmpeg_never_reads_urls_or_stdin() -> None:
    args = ffmpeg("-i", "input", "out.mp4")
    assert args[0] == "ffmpeg"
    assert args[args.index("-protocol_whitelist") + 1] == "file,pipe"
    assert "-nostdin" in args
    assert args[-3:] == ["-i", "input", "out.mp4"]
