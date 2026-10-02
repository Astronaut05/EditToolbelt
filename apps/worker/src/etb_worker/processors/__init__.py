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

A ``remote`` processor (the GPU tools) works on storage keys instead: the
runner downloads and uploads nothing for it. It presigns the input for the
GPU function, which writes the output straight to storage, and returns an
``Output`` with the output's ``key``.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from etb_worker.gpu.backend import GpuBackend
from etb_worker.sandbox import Limits, run
from etb_worker.storage import Storage


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
    #: The file to upload; None when a remote processor already stored it under ``key``.
    path: Path | None
    content_type: str
    ext: str
    meta: dict[str, Any] = field(default_factory=dict)
    key: str | None = None
    bytes: int | None = None


@dataclass(frozen=True)
class GpuUsage:
    """One GPU call's time, as the job records it (docs/01: every GPU job records gpu_seconds)."""

    gpu_seconds: float
    #: What it costs: the GPU seconds plus the function's idle window (an upper bound).
    billed_seconds: float


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
    #: The tool's other inputs, in order (Burn Subtitles: the subtitle file), named extra-0, ...
    extra_paths: list[Path] = field(default_factory=list)
    #: Remote processors: the input's storage key, storage, the GPU backend and where GPU time goes.
    input_key: str | None = None
    storage: Storage | None = None
    gpu: GpuBackend | None = None
    record_gpu: Callable[[GpuUsage], None] = lambda _usage: None
    #: Records a GPU call about to start and the key it may write to, valid for so many
    #: seconds, on the job (see remote.py); False when the job is no longer ours to run.
    start_call: Callable[[str, int], bool] = lambda _key, _expires_sec: True
    #: Records the backend's id for the call once it exists, so it can be cancelled by id.
    call_spawned: Callable[[str], None] = lambda _call_id: None

    def run(self, args: list[str], on_line: Callable[[str], None] | None = None) -> str:
        """Runs a tool in the sandbox, in the job's temp dir, under the job's time limit."""
        return run(args, cwd=self.workdir, limits=self.limits, cancel=self.cancel, on_line=on_line)


class Processor(Protocol):
    tool_id: str

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate: ...

    def run(self, ctx: JobContext) -> Output: ...


def is_remote(processor: Processor) -> bool:
    """Works on storage keys through the GPU backend (see the module's docstring)."""
    return bool(getattr(processor, "remote", False))


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
    transcribe,
    upscale_image,
    vfr_to_cfr,
)

PROCESSORS: dict[str, Processor] = {
    processor.tool_id: processor
    for processor in (
        compress_video.PROCESSOR,
        vfr_to_cfr.PROCESSOR,
        burn_subtitles.PROCESSOR,
        # GPU tools: they run where GPU_BACKEND is set, and fail cleanly (credits back) where not.
        upscale_image.PROCESSOR,
        transcribe.TRANSCRIBE_AUDIO,
        transcribe.AUTO_SUBTITLES,
    )
}
