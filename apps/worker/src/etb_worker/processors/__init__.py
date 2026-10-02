"""Processors: what each server tool does to a file (docs/01 -> Workers).

A processor is keyed by its registry tool id and has two parts:
- ``estimate(meta, options)``: how long it will take, from the probe (for the
  queue's estimate and, with M5, pricing);
- ``run(ctx)``: does the work in ``ctx.workdir`` through ``ctx.run`` (the
  sandbox) and reports progress through ``ctx.progress(pct, stage)``.

A processor raises ``JobFailed`` with an API code for anything the user
should see ("the video has no video stream"); everything else is a bug and
fails the job as INTERNAL. Processors never see a filename: the input is
``ctx.input_path``, named ``input``.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from etb_worker.sandbox import Limits, run


class JobFailed(Exception):  # it names the outcome, like the job status
    """The job can't be done; ``code`` and ``detail`` are shown to the user."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


@dataclass(frozen=True)
class Estimate:
    seconds: float


@dataclass(frozen=True)
class Output:
    path: Path
    content_type: str
    ext: str
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class JobContext:
    job_id: str
    tool_id: str
    input_path: Path
    workdir: Path
    options: dict[str, Any]
    meta: dict[str, Any]
    limits: Limits
    cancel: threading.Event
    progress: Callable[[int, str], None]
    #: The tool's other inputs, in order (Burn Subtitles: the subtitle file; Merge Videos: the
    #: clips after the first), named extra-0, extra-1, ...
    extra_paths: list[Path] = field(default_factory=list)

    def run(self, args: list[str], on_line: Callable[[str], None] | None = None) -> str:
        """Runs a tool in the sandbox, in the job's temp dir, under the job's time limit."""
        return run(args, cwd=self.workdir, limits=self.limits, cancel=self.cancel, on_line=on_line)


class Processor(Protocol):
    tool_id: str

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate: ...

    def run(self, ctx: JobContext) -> Output: ...


def ffmpeg_progress(
    duration_ms: int, report: Callable[[int, str], None], stage: str, start: int = 0, end: int = 100
) -> Callable[[str], None]:
    """ffmpeg's ``-progress`` lines as ``report(pct, stage)``, scaled to ``start``-``end``."""

    def on_line(line: str) -> None:
        key, _, value = line.partition("=")
        if key == "out_time_us" and value.isdigit() and duration_ms > 0:
            done = min(1.0, int(value) / 1000 / duration_ms)
            report(start + round(done * (end - start)), stage)

    return on_line


# The tool modules import the helpers above, so they come last.
from etb_worker.processors import (  # noqa: E402
    burn_subtitles,
    compress_video,
    merge_videos,
    vfr_to_cfr,
)

PROCESSORS: dict[str, Processor] = {
    processor.tool_id: processor
    for processor in (
        compress_video.PROCESSOR,
        vfr_to_cfr.PROCESSOR,
        burn_subtitles.PROCESSOR,
        merge_videos.PROCESSOR,
    )
}
