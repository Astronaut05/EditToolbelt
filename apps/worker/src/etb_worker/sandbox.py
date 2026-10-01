"""Running ffmpeg and other native tools on user files (docs/11 -> ffmpeg and native tools).

Every run:
- takes an argument list, never a shell string;
- gets a clean environment (no storage keys, database URL or proxy settings);
- runs under ``prlimit``: address space, file size, open files and no core dumps;
- runs in its own process group, killed as a whole on timeout or cancel;
- has stdin closed. Its stdout is read line by line (ffmpeg's ``-progress``),
  and the tail of stderr is kept for error reports.

ffmpeg itself is always started through ``ffmpeg()``, which adds
``-protocol_whitelist file,pipe`` so no user file can make it open a URL.
The container adds the rest in production: non-root, read-only root, a
per-job temp dir as the only writable path.
"""

from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import threading
import time
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

GIB = 1024**3


@dataclass(frozen=True)
class Limits:
    timeout_sec: float
    memory_bytes: int = 6 * GIB
    file_bytes: int = 64 * GIB
    open_files: int = 256


class ToolError(Exception):
    """The tool didn't finish. ``code`` is the job's error code."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def _clean_env(cwd: Path) -> dict[str, str]:
    return {"PATH": "/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C.UTF-8", "HOME": str(cwd)}


def _kill_group(proc: subprocess.Popen[str]) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGKILL)


def run(
    args: Sequence[str],
    *,
    cwd: Path,
    limits: Limits,
    cancel: threading.Event | None = None,
    on_line: Callable[[str], None] | None = None,
) -> str:
    """Runs the tool; returns the tail of its stderr. Raises ToolError on failure."""
    if not args or not all(isinstance(arg, str) for arg in args):
        msg = "args must be a non-empty list of strings"
        raise ValueError(msg)
    command = [
        "prlimit",
        f"--as={limits.memory_bytes}",
        f"--fsize={limits.file_bytes}",
        f"--nofile={limits.open_files}",
        "--core=0",
        "--",
        *args,
    ]
    tail: deque[str] = deque(maxlen=40)
    proc = subprocess.Popen(  # noqa: S603  # an argument list we built, no shell
        command,
        cwd=cwd,
        env=_clean_env(cwd),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
        start_new_session=True,
    )

    def read_stdout() -> None:
        assert proc.stdout is not None  # noqa: S101  # PIPE above
        for line in proc.stdout:
            if on_line is not None:
                on_line(line.rstrip("\n"))

    def read_stderr() -> None:
        assert proc.stderr is not None  # noqa: S101  # PIPE above
        for line in proc.stderr:
            tail.append(line.rstrip("\n"))

    readers = [
        threading.Thread(target=read_stdout, daemon=True),
        threading.Thread(target=read_stderr, daemon=True),
    ]
    for reader in readers:
        reader.start()
    deadline = time.monotonic() + limits.timeout_sec
    reason: str | None = None
    while proc.poll() is None:
        if cancel is not None and cancel.is_set():
            reason = "CANCELLED"
        elif time.monotonic() > deadline:
            reason = "TIMEOUT"
        if reason:
            _kill_group(proc)
            proc.wait()
            break
        time.sleep(0.1)
    for reader in readers:
        reader.join(timeout=5)
    stderr = "\n".join(tail)
    if reason == "CANCELLED":
        raise ToolError("CANCELLED", "cancelled")
    if reason == "TIMEOUT":
        raise ToolError("TIMEOUT", f"stopped after {limits.timeout_sec:.0f} s")
    if proc.returncode != 0:
        raise ToolError("TOOL_FAILED", f"exit {proc.returncode}: {stderr[-600:]}")
    return stderr


def ffmpeg(*args: str) -> list[str]:
    """An ffmpeg command line that never reads a URL or stdin, and reports progress on stdout."""
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-progress",
        "pipe:1",
        "-y",
        *args,
    ]


def ffprobe(*args: str) -> list[str]:
    return [
        "ffprobe",
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file",
        *args,
    ]
