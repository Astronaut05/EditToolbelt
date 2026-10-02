"""The GPU backend the worker forwards GPU jobs to (docs/01 -> GPU backend).

``GpuBackend`` runs one call of a GPU function and waits for it, so switching
backend is a config change (``GPU_BACKEND``):

- ``ModalGpu`` (ServerlessGpu): spawns the function on Modal by name and
  polls the call every couple of seconds. Between polls it reports the
  elapsed time (the processor turns it into progress and the runner's
  heartbeat carries it), and it cancels the call when the job is cancelled,
  the worker stops, or the job's time is up. Modal never calls us; files
  move only through the presigned URLs in the call's arguments.
- ``LocalGpu``: the development card in the local stack (docs/01 -> Local
  GPU). Not built yet, so it says so.

A call's GPU time comes back from the function itself (measured inside it).
When a call fails, is cancelled or times out without saying, the wall-clock
time since the spawn stands in: an upper bound, so the daily budget errs on
the safe side.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from etb_worker.gpu import APP_NAME
from etb_worker.settings import Settings

POLL_SEC = 2.0


class GpuError(Exception):
    """A call that didn't produce a result. ``code`` is the job's error code."""

    def __init__(self, code: str, detail: str, *, gpu_seconds: float = 0.0) -> None:
        super().__init__(detail)
        self.code = code
        self.gpu_seconds = gpu_seconds


class GpuCancelled(GpuError):
    """The job was cancelled (or the worker is stopping) and the call with it."""

    def __init__(self, gpu_seconds: float) -> None:
        super().__init__("CANCELLED", "cancelled", gpu_seconds=gpu_seconds)


@dataclass(frozen=True)
class GpuCall:
    function: str
    kwargs: dict[str, Any]
    timeout_sec: float
    cancel: threading.Event = field(default_factory=threading.Event)
    #: Called between polls with the seconds since the spawn.
    on_wait: Callable[[float], None] = lambda _elapsed: None


@dataclass(frozen=True)
class GpuResult:
    #: What the function reported about its output (size, language, notes).
    meta: dict[str, Any]
    notes: list[str]
    #: The GPU type the function ran on, as Modal names it ("T4", "L4").
    gpu: str
    #: Measured inside the function: the call, plus loading the model when it was cold.
    gpu_seconds: float
    #: What it is billed as: the GPU seconds plus the idle window after it (an upper bound).
    billed_seconds: float
    wall_seconds: float


class GpuBackend(Protocol):
    name: str

    def run(self, call: GpuCall) -> GpuResult: ...


def parse_answer(answer: object, wall_seconds: float) -> GpuResult:
    """A function's return value as a result, or GpuError for a failure it reported."""
    if not isinstance(answer, dict):
        raise GpuError("GPU_FAILED", "the GPU function gave no answer", gpu_seconds=wall_seconds)
    gpu_seconds = _seconds(answer.get("gpu_seconds"), wall_seconds)
    if not answer.get("ok"):
        code = str(answer.get("code") or "GPU_FAILED")
        raise GpuError(code, str(answer.get("detail") or "failed"), gpu_seconds=gpu_seconds)
    tail = _seconds(answer.get("idle_tail_seconds"), 0.0)
    notes = answer.get("notes")
    meta = answer.get("meta")
    return GpuResult(
        meta=dict(meta) if isinstance(meta, dict) else {},
        notes=[str(note) for note in notes] if isinstance(notes, list) else [],
        gpu=str(answer.get("gpu") or "unknown"),
        gpu_seconds=gpu_seconds,
        billed_seconds=gpu_seconds + tail,
        wall_seconds=wall_seconds,
    )


def _seconds(value: object, fallback: float) -> float:
    if isinstance(value, int | float) and value >= 0:
        return float(value)
    return fallback


class ModalGpu:
    """ServerlessGpu on Modal: ``Function.from_name(...).spawn(...)``, then poll."""

    name = "modal"

    def __init__(
        self,
        *,
        app_name: str = APP_NAME,
        lookup: Callable[[str, str], Any] | None = None,
        poll_sec: float = POLL_SEC,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.app_name = app_name
        self._lookup = lookup or _modal_lookup
        self.poll_sec = poll_sec
        self._clock = clock

    def run(self, call: GpuCall) -> GpuResult:
        import modal.exception  # noqa: PLC0415 - only workers that use Modal load it

        started = self._clock()
        try:
            handle = self._lookup(self.app_name, call.function).spawn(**call.kwargs)
        except modal.exception.Error as error:
            raise GpuError("GPU_UNAVAILABLE", f"spawn failed: {type(error).__name__}") from None
        while True:
            elapsed = self._clock() - started
            if call.cancel.is_set():
                _cancel(handle)
                raise GpuCancelled(elapsed)
            if elapsed > call.timeout_sec:
                _cancel(handle)
                raise GpuError("TIMEOUT", "the GPU took too long", gpu_seconds=elapsed)
            call.on_wait(elapsed)
            try:
                answer = handle.get(timeout=self.poll_sec)
            except TimeoutError:
                continue  # not done yet (Modal raises the builtin one for a poll)
            except modal.exception.FunctionTimeoutError:
                raise GpuError(
                    "TIMEOUT", "the GPU function ran out of time", gpu_seconds=elapsed
                ) from None
            except modal.exception.Error as error:
                raise GpuError(
                    "GPU_UNAVAILABLE", f"Modal: {type(error).__name__}", gpu_seconds=elapsed
                ) from None
            # Whatever the function itself raised comes back as that exception.
            except Exception as error:  # noqa: BLE001
                detail = f"the GPU function raised {type(error).__name__}"
                raise GpuError("GPU_FAILED", detail, gpu_seconds=elapsed) from None
            return parse_answer(answer, self._clock() - started)


def _modal_lookup(app_name: str, function: str) -> Any:
    import modal  # noqa: PLC0415

    return modal.Function.from_name(app_name, function)


def _cancel(handle: Any) -> None:
    try:
        handle.cancel()
    except Exception:  # noqa: BLE001 - the call may have just ended; the timeout stops it anyway
        return


class LocalGpu:
    """The dev-only card in the local stack (docs/01 -> Local GPU): not built yet."""

    name = "local"

    def run(self, call: GpuCall) -> GpuResult:
        raise GpuError(
            "GPU_UNAVAILABLE",
            "LocalGpu isn't set up on this machine: run GPU tools with GPU_BACKEND=modal",
        )


def make_backend(settings: Settings) -> GpuBackend | None:
    """The backend GPU_BACKEND names; None turns the GPU tools off on this worker."""
    if settings.gpu_backend == "modal":
        return ModalGpu()
    if settings.gpu_backend == "local":
        return LocalGpu()
    return None
