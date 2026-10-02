"""ModalGpu against a stand-in for Modal: spawn, poll, progress, cancel, time out."""

from __future__ import annotations

import threading
from typing import Any

import modal.exception
import pytest
from pydantic import SecretStr

from etb_worker.gpu.backend import (
    GpuCall,
    GpuCancelled,
    GpuError,
    LocalGpu,
    ModalGpu,
    make_backend,
    parse_answer,
)
from etb_worker.settings import Settings

ANSWER = {
    "ok": True,
    "gpu": "T4",
    "gpu_seconds": 12.5,
    "idle_tail_seconds": 10,
    "cold": True,
    "meta": {"width": 64},
    "notes": ["a note"],
}


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class Handle:
    """A FunctionCall: not done for ``polls`` polls (each one 2 s), then ``outcome``."""

    def __init__(self, clock: Clock, polls: int, outcome: Any) -> None:
        self.clock, self.polls, self.outcome = clock, polls, outcome
        self.cancelled = False
        self.gets = 0

    def get(self, timeout: float) -> Any:
        self.gets += 1
        self.clock.now += timeout
        if self.gets <= self.polls:
            raise TimeoutError
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome

    def cancel(self) -> None:
        self.cancelled = True


class Function:
    def __init__(self, handle: Handle) -> None:
        self.handle = handle
        self.spawned: list[dict[str, Any]] = []

    def spawn(self, **kwargs: Any) -> Handle:
        self.spawned.append(kwargs)
        return self.handle


def backend(outcome: Any, polls: int = 0) -> tuple[ModalGpu, Function, Clock]:
    clock = Clock()
    function = Function(Handle(clock, polls, outcome))
    looked_up: list[tuple[str, str]] = []

    def lookup(app: str, name: str) -> Function:
        looked_up.append((app, name))
        return function

    gpu = ModalGpu(lookup=lookup, poll_sec=2.0, clock=clock)
    return gpu, function, clock


def test_a_call_is_spawned_by_name_polled_and_measured() -> None:
    gpu, function, _clock = backend(ANSWER, polls=3)
    waited: list[float] = []
    result = gpu.run(
        GpuCall("upscale_image", {"input_url": "u", "options": {}}, 60, on_wait=waited.append)
    )
    assert function.spawned == [{"input_url": "u", "options": {}}]
    assert waited == [0.0, 2.0, 4.0, 6.0]
    assert result.gpu == "T4"
    assert result.gpu_seconds == 12.5
    assert result.billed_seconds == 22.5  # the idle window after it is billed too
    assert result.wall_seconds == 8.0
    assert result.meta == {"width": 64}
    assert result.notes == ["a note"]


def test_a_cancelled_job_cancels_the_call() -> None:
    gpu, function, _clock = backend(ANSWER, polls=100)
    cancel = threading.Event()

    def on_wait(elapsed: float) -> None:
        if elapsed >= 4:
            cancel.set()

    with pytest.raises(GpuCancelled) as caught:
        gpu.run(GpuCall("transcribe", {}, 600, cancel=cancel, on_wait=on_wait))
    assert function.handle.cancelled
    assert caught.value.code == "CANCELLED"
    assert caught.value.gpu_seconds == 6.0  # wall time stands in for what it used


def test_a_call_past_its_time_is_cancelled() -> None:
    gpu, function, _clock = backend(ANSWER, polls=100)
    with pytest.raises(GpuError) as caught:
        gpu.run(GpuCall("transcribe", {}, 9))
    assert caught.value.code == "TIMEOUT"
    assert function.handle.cancelled
    assert caught.value.gpu_seconds == 10.0


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        (modal.exception.FunctionTimeoutError("slow"), "TIMEOUT"),
        (modal.exception.ExecutionError("boom"), "GPU_UNAVAILABLE"),
        (RuntimeError("CUDA out of memory"), "GPU_FAILED"),
        (
            {"ok": False, "code": "DECODE_FAILED", "detail": "damaged", "gpu_seconds": 3},
            "DECODE_FAILED",
        ),
        ("not a dict", "GPU_FAILED"),
    ],
)
def test_failures_become_job_errors(outcome: Any, code: str) -> None:
    gpu, _function, _clock = backend(outcome, polls=1)
    with pytest.raises(GpuError) as caught:
        gpu.run(GpuCall("transcribe", {}, 60))
    assert caught.value.code == code
    assert caught.value.gpu_seconds > 0
    # The remote error's own words (they might hold anything) never become the detail.
    assert "CUDA" not in str(caught.value)


def test_a_spawn_that_fails_means_the_gpu_is_unavailable() -> None:
    def lookup(app: str, name: str) -> Any:
        raise modal.exception.NotFoundError("no such app")

    with pytest.raises(GpuError) as caught:
        ModalGpu(lookup=lookup).run(GpuCall("transcribe", {}, 60))
    assert caught.value.code == "GPU_UNAVAILABLE"


def test_answers_are_read_defensively() -> None:
    result = parse_answer({"ok": True, "gpu_seconds": -1, "meta": "x", "notes": "y"}, 7.0)
    assert result.gpu_seconds == 7.0
    assert result.billed_seconds == 7.0
    assert result.meta == {}
    assert result.notes == []


def test_the_setting_picks_the_backend(settings: Settings) -> None:
    assert make_backend(settings) is None
    local = settings.model_copy(update={"gpu_backend": "local"})
    assert isinstance(make_backend(local), LocalGpu)
    with pytest.raises(GpuError) as caught:
        LocalGpu().run(GpuCall("transcribe", {}, 60))
    assert caught.value.code == "GPU_UNAVAILABLE"
    no_token = settings.model_copy(update={"gpu_backend": "modal"})
    assert make_backend(no_token) is None
    modal_settings = settings.model_copy(
        update={
            "gpu_backend": "modal",
            "modal_token_id": SecretStr("ak-test"),
            "modal_token_secret": SecretStr("as-test"),
        }
    )
    assert isinstance(make_backend(modal_settings), ModalGpu)
