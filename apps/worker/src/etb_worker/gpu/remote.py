"""What every GPU function does around its model, inside the Modal container.

Standard library only, so the GPU images need nothing extra for it:

- ``fetch_input``: reads the job's input from its presigned GET URL (or a
  ``data:`` URL, which the smoke tests use) into the call's temp dir, with a
  size cap.
- ``put_output``: writes the result to its presigned PUT URL with the type
  the URL was signed for. No URL (the smoke tests) means the result is
  measured and dropped.
- ``Call``: the call's clock and its answer. ``gpu_seconds`` is measured
  here, from the start of the call to its answer, so it includes loading the
  model when the container was cold.
- ``int_cap`` / ``float_cap``: the most the call may decode (``max_frames``,
  ``max_seconds``, ``max_pixels``), which the worker works out from the probe
  the job was priced on. A file's header can say less than the file holds;
  the decoders stop at these, so the GPU never works on more than was paid
  for. A picture can't be cut short, so ``check_pixels`` refuses a bigger one.
- ``guard_inputs``: every ffmpeg input a function opens may read only its
  temp files and pipes, never a URL a file's contents name (playlists,
  concat lists), as the worker's own commands (``sandbox.ffmpeg``).

Nothing here logs: URLs carry signatures and files are the person's.
"""

from __future__ import annotations

import math
import shutil
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_CHUNK = 1024 * 1024
_TIMEOUT_SEC = 120
#: One PUT stores at most 5 GiB (S3 and R2): a bigger result fails instead of half-uploading.
MAX_PUT_BYTES = 4_900_000_000


class CallFailed(Exception):  # it names the outcome, like a job status
    """A failure the person should read: ``code`` and a sentence without their content."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def _cap(options: dict[str, Any], name: str, *, integer: bool) -> float | None:
    """``options[name]`` as a positive, finite number; None when it isn't there."""
    value = options.get(name)
    if value is None:
        return None
    kinds = int if integer else (int, float)
    if (
        isinstance(value, bool)
        or not isinstance(value, kinds)
        or not math.isfinite(value)
        or value <= 0
    ):
        raise CallFailed("BAD_INPUT", f"The call's {name} isn't a positive number.")
    return value


def int_cap(options: dict[str, Any], name: str, most: int) -> int:
    """A whole-number cap the worker sent (``max_frames``), at most ``most``.

    Missing (a worker from before the caps) means ``most``, never unlimited;
    anything but a positive whole number is refused.
    """
    value = _cap(options, name, integer=True)
    return most if value is None else min(int(value), most)


def float_cap(options: dict[str, Any], name: str, most: float) -> float:
    """A cap in seconds the worker sent (``max_seconds``), at most ``most``; as ``int_cap``."""
    value = _cap(options, name, integer=False)
    return most if value is None else min(float(value), most)


#: The only protocols a function's ffmpeg input may open: its temp files, and pipes.
INPUT_WHITELIST = ("-protocol_whitelist", "file,pipe")


def guard_inputs(command: list[str]) -> list[str]:
    """``command`` with the whitelist before every ``-i``: an input option applies to the next
    input only, so each one needs it (the encoder reads the frames' pipe and the user's file)."""
    guarded: list[str] = []
    for i, arg in enumerate(command):
        if arg == "-i" and i + 1 < len(command):
            guarded += INPUT_WHITELIST
        guarded.append(arg)
    return guarded


def check_pixels(width: int, height: int, max_pixels: int) -> None:
    """Refuses a picture with more pixels than its job was priced on (``max_pixels``).

    Read from the image's own header before any pixel is decoded. The worker
    prices from its probe (ffprobe), and a crafted file can show the decoder
    here a bigger picture than the probe saw; it would then cost more GPU
    time than was paid for.
    """
    if width * height > max_pixels:
        raise CallFailed(
            "TOO_LARGE",
            f"This image is {width} × {height} px, bigger than its file said when it "  # noqa: RUF001
            "was priced. Save it again from an image editor and try again.",
        )


def length_label(seconds: float) -> str:
    """3.0 s, 12.5 min: a length as the result's notes give it."""
    return f"{seconds / 60:.1f} min" if seconds >= 60 else f"{seconds:.1f} s"


def fetch_input(url: str, dest: Path, max_bytes: int) -> int:
    """Downloads ``url`` to ``dest``; returns its size. Refuses anything over ``max_bytes``."""
    if not url.startswith(("https://", "http://", "data:")):
        raise CallFailed("BAD_INPUT", "The input URL isn't one we read.")
    total = 0
    with urllib.request.urlopen(url, timeout=_TIMEOUT_SEC) as source, dest.open("wb") as out:  # noqa: S310
        while chunk := source.read(_CHUNK):
            total += len(chunk)
            if total > max_bytes:
                raise CallFailed("TOO_LARGE", "The file is larger than this tool takes.")
            out.write(chunk)
    return total


def put_output(url: str | None, path: Path, content_type: str) -> int:
    """PUTs ``path`` to ``url`` (signed for ``content_type``); returns its size."""
    size = path.stat().st_size
    if size > MAX_PUT_BYTES:
        raise CallFailed("TOO_LARGE", "The result is over 4.9 GB, more than we can store.")
    if url is None:
        return size
    if not url.startswith(("https://", "http://")):
        raise CallFailed("BAD_OUTPUT", "The output URL isn't one we write.")
    with path.open("rb") as body:
        request = urllib.request.Request(  # noqa: S310
            url,
            data=body,
            method="PUT",
            headers={"Content-Type": content_type, "Content-Length": str(size)},
        )
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SEC * 5) as answer:  # noqa: S310
            if answer.status >= 300:
                raise CallFailed("STORAGE_UNAVAILABLE", "Storage refused the result.")
    return size


@dataclass
class Call:
    """One call's clock and answer (backend.parse_answer reads it on the worker)."""

    gpu: str
    idle_tail_seconds: float
    started: float = field(default_factory=time.monotonic)
    cold: bool = False

    def elapsed(self) -> float:
        return round(time.monotonic() - self.started, 3)

    def ok(self, meta: dict[str, Any], notes: list[str] | None = None) -> dict[str, Any]:
        return {
            "ok": True,
            "gpu": self.gpu,
            "gpu_seconds": self.elapsed(),
            "idle_tail_seconds": self.idle_tail_seconds,
            "cold": self.cold,
            "meta": meta,
            "notes": notes or [],
        }

    def failed(self, error: CallFailed) -> dict[str, Any]:
        return {
            "ok": False,
            "gpu": self.gpu,
            "gpu_seconds": self.elapsed(),
            "idle_tail_seconds": self.idle_tail_seconds,
            "code": error.code,
            "detail": str(error),
        }


def clear(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
