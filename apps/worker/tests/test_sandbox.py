from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from etb_worker.processors import cap_input
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


def assert_every_input_reads_local_files_only(args: list[str]) -> None:
    """Each ``-i`` has the whitelist among its own options: since the input before it."""
    allowed = False
    for at, arg in enumerate(args):
        if arg == "-protocol_whitelist":
            allowed = args[at + 1] == "file,pipe"
        elif arg == "-i":
            assert allowed, f"input {args[at + 1]} may open URLs"
            allowed = False  # an input option applies to the next input only


def test_every_input_reads_local_files_only() -> None:
    # Noise Reduction's encode: the cleaned sound, then the user's file for its tags.
    args = ffmpeg(
        *("-f", "f32le", "-ar", "48000", "-ac", "2", "-i", "cleaned.f32"),
        *("-i", "input", "-map", "0:a:0", "-map_metadata", "1", "out.wav"),
    )
    assert args.count("-protocol_whitelist") == 2
    assert_every_input_reads_local_files_only(args)
    # The job's decode cap (JobContext.run) goes among the same input's options.
    capped = cap_input(args, "input", 9.0)
    second = capped.index("cleaned.f32") + 1
    assert capped[second : second + 6] == [
        *("-protocol_whitelist", "file,pipe", "-t", "9.000", "-i", "input"),
    ]
    assert_every_input_reads_local_files_only(capped)
    with pytest.raises(AssertionError):
        assert_every_input_reads_local_files_only(["ffmpeg", "-i", "input"])


#: A worker in its own process: can a tool it runs read its environment, before and after
#: it hides from them? Printed as JSON.
HIDING = """
import ctypes, json, os
from pathlib import Path
from etb_worker.sandbox import Limits, ToolError, hide_from_tools, run

if os.geteuid() == 0:
    # Root reads any process's files: be a plain user, as the worker is in production.
    # Changing user already makes a process non-dumpable, so it is made dumpable again.
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
    off = ctypes.c_ulong(0)
    ctypes.CDLL(None).prctl(4, ctypes.c_ulong(1), off, off, off)


def leaks():
    lines = []
    try:
        run(
            ["cat", f"/proc/{os.getpid()}/environ"],
            cwd=Path("/"),
            limits=Limits(timeout_sec=10),
            on_line=lines.append,
        )
    except ToolError:
        return False
    return "the-database-password" in "".join(lines)


before = leaks()
hidden = hide_from_tools()
after = leaks()
print(json.dumps({
    "before": before,
    "hidden": hidden,
    "after": after,
    "own_fds": len(os.listdir("/proc/self/fd")),
    "own_status": Path("/proc/self/status").read_text().startswith("Name:"),
    "runs_tools": run(["true"], cwd=Path("/"), limits=Limits(timeout_sec=10)) == "",
}))
"""


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="prctl and /proc are Linux's")
def test_a_tool_cant_read_the_workers_environment_once_it_hides() -> None:
    env = {**os.environ, "DATABASE_URL": "postgresql://etb:the-database-password@db/etb"}
    done = subprocess.run(  # noqa: S603
        [sys.executable, "-c", HIDING],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    seen = json.loads(done.stdout)
    # Running as the worker's own user, a tool could read it ...
    assert seen["before"] is True
    # ... and once the worker hides, it can't.
    assert seen["hidden"] is True
    assert seen["after"] is False
    # The worker still reads its own /proc/self, and still runs tools.
    assert seen["own_fds"] > 0
    assert seen["own_status"] is True
    assert seen["runs_tools"] is True
