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

Nothing here logs: URLs carry signatures and files are the person's.
"""

from __future__ import annotations

import shutil
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_CHUNK = 1024 * 1024
_TIMEOUT_SEC = 120


class CallFailed(Exception):  # it names the outcome, like a job status
    """A failure the person should read: ``code`` and a sentence without their content."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


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
