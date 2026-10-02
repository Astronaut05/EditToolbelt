"""The step every GPU tool shares (docs/01 -> GPU backend, Retention).

1. Presign: a GET URL for the job's input (and one for each other input,
   such as Object Eraser's mask, when the tool takes them) and a PUT URL for
   a new random output key, valid for the job's time limit plus a margin. The key is
   recorded on the job first, so if this worker dies mid-call, the next
   attempt or the sweeper still finds and deletes what the GPU wrote.
2. Call the backend with those URLs and the options; between polls the
   elapsed time becomes progress (against the processor's estimate) and the
   runner's heartbeat carries it, noticing a cancel within 5 s.
3. Record the call's GPU time on the job whatever happened, then check the
   output is there. A failure deletes whatever the GPU wrote and fails the
   job with its code, so its credits come back the usual way.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from typing import Any

from etb_worker.gpu.backend import GpuCall, GpuCancelled, GpuError, GpuResult
from etb_worker.processors import GpuUsage, JobContext, JobFailed
from etb_worker.sandbox import ToolError
from etb_worker.storage import Storage, StorageError, new_output_key

#: Presigned URLs outlive the job's time limit by this much: the call may queue for a GPU first.
PRESIGN_MARGIN_SEC = 15 * 60

#: What the person reads for failures the GPU function doesn't word itself.
GPU_TEXT = {
    "GPU_UNAVAILABLE": "Our GPU servers aren't available right now. Try again later.",
    "GPU_FAILED": "Our GPU server couldn't finish this one.",
    "TIMEOUT": "It took too long and was stopped.",
}


@dataclass(frozen=True)
class GpuOutcome:
    key: str
    bytes: int
    result: GpuResult


def _storage(ctx: JobContext) -> Storage:
    if ctx.gpu is None:
        raise JobFailed("GPU_UNAVAILABLE", GPU_TEXT["GPU_UNAVAILABLE"])
    if ctx.storage is None or not ctx.input_key:
        raise JobFailed("NOT_FOUND", "the input is gone")
    return ctx.storage


def _drop(storage: Storage, key: str) -> None:
    with contextlib.suppress(StorageError):  # the sweeper gets it within the hour
        storage.delete(key)


def run_on_gpu(  # noqa: PLR0913 - keyword-only settings of one call
    ctx: JobContext,
    *,
    function: str,
    options: dict[str, Any],
    content_type: str,
    estimate_sec: float,
    stage: str = "processing",
    start: int = 2,
    end: int = 95,
    extra_inputs: bool = False,
) -> GpuOutcome:
    """Runs ``function`` on the job's input; the output is stored under the returned key."""
    storage = _storage(ctx)
    assert ctx.gpu is not None  # checked by _storage  # noqa: S101
    timeout = ctx.limits.timeout_sec
    expires = int(timeout + PRESIGN_MARGIN_SEC)
    key = new_output_key()
    ctx.reserve_output(key)
    kwargs: dict[str, Any] = {
        "input_url": storage.presign_get(str(ctx.input_key), expires),
        "output_url": storage.presign_put(key, content_type, expires),
        "options": options,
    }
    if extra_inputs:
        kwargs["extra_urls"] = [storage.presign_get(k, expires) for k in ctx.extra_input_keys]
    span = end - start

    def on_wait(elapsed: float) -> None:
        # Time against the estimate; a call that runs over waits just short of the end.
        share = min(1.0, elapsed / max(estimate_sec, 1.0))
        ctx.progress(start + round(span * share * 0.95), stage)

    ctx.progress(start, stage)
    try:
        result = ctx.gpu.run(GpuCall(function, kwargs, timeout, ctx.cancel, on_wait))
    except GpuCancelled as stopped:
        ctx.record_gpu(GpuUsage(stopped.gpu_seconds, stopped.gpu_seconds))
        _drop(storage, key)
        raise ToolError("CANCELLED", "cancelled") from None
    except GpuError as error:
        ctx.record_gpu(GpuUsage(error.gpu_seconds, error.gpu_seconds))
        _drop(storage, key)
        raise JobFailed(error.code, GPU_TEXT.get(error.code, str(error))) from None
    ctx.record_gpu(GpuUsage(result.gpu_seconds, result.billed_seconds))
    size = storage.size(key)
    if not size:
        _drop(storage, key)
        raise JobFailed("GPU_FAILED", GPU_TEXT["GPU_FAILED"])
    ctx.progress(end, stage)
    return GpuOutcome(key=key, bytes=size, result=result)
