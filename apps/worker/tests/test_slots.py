"""The slot loops: a GPU slot runs GPU jobs and nothing else, and no error ends a slot
(the DB tests cover the claims and the probe)."""

from __future__ import annotations

import contextlib
import threading
from collections.abc import Callable, Iterator
from typing import Any, cast

import psycopg
import pytest

from etb_worker import slots
from etb_worker.runner import JobRunner
from etb_worker.settings import Settings
from etb_worker.storage import Storage


class Runner:
    """Answers run_next from a script; stops the loop when it runs out."""

    def __init__(self, stop: threading.Event, answers: list[Any]) -> None:
        self.stop, self.answers = stop, answers
        self.runs = 0

    def run_next(self) -> bool:
        self.runs += 1
        answer = self.answers.pop(0)
        if not self.answers:
            self.stop.set()
        if isinstance(answer, BaseException):
            raise answer
        return bool(answer)


def test_a_gpu_slot_runs_gpu_jobs_and_never_probes(monkeypatch: pytest.MonkeyPatch) -> None:
    def probed(*_args: Any, **_kwargs: Any) -> bool:
        raise AssertionError("a GPU slot probed an upload")

    monkeypatch.setattr(slots, "probe_next", probed)
    monkeypatch.setattr(slots, "POLL_SEC", 0.01)
    stop, wake = threading.Event(), threading.Event()
    runner = Runner(stop, [True, False, psycopg.OperationalError("db down"), True])
    monkeypatch.setattr(stop, "wait", lambda _timeout=None: stop.is_set())
    slots.run_gpu_slot(cast(JobRunner, runner), wake, stop)
    # It ran on through an idle poll and a database blip.
    assert runner.runs == 4


def test_a_gpu_slot_runs_on_after_a_bug(
    monkeypatch: pytest.MonkeyPatch, log_lines: Callable[[], list[dict[str, Any]]]
) -> None:
    monkeypatch.setattr(slots, "POLL_SEC", 0.01)
    stop, wake = threading.Event(), threading.Event()
    runner = Runner(stop, [ValueError("rotate: from-the-file"), OSError("disk full"), True])
    monkeypatch.setattr(stop, "wait", lambda _timeout=None: stop.is_set())
    slots.run_gpu_slot(cast(JobRunner, runner), wake, stop)
    assert runner.runs == 3
    errors = [line for line in log_lines() if line["event"] == "slot.error"]
    assert [(e["detail"], e["pool"]) for e in errors] == [("ValueError", "gpu"), ("OSError", "gpu")]
    # Only the type: the message can quote a file's metadata.
    assert "from-the-file" not in str(log_lines())


def test_a_cpu_slot_runs_on_after_a_bug_in_the_probe_or_a_job(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    log_lines: Callable[[], list[dict[str, Any]]],
) -> None:
    @contextlib.contextmanager
    def connect(_settings: Settings) -> Iterator[object]:
        yield object()

    probes: list[Any] = [KeyError("rotate"), False, False, False]

    def probe_next(_conn: object, _storage: Storage) -> bool:
        answer = probes.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return bool(answer)

    monkeypatch.setattr(slots, "connect", connect)
    monkeypatch.setattr(slots, "probe_next", probe_next)
    monkeypatch.setattr(slots, "POLL_SEC", 0.01)
    stop, wake = threading.Event(), threading.Event()
    runner = Runner(stop, [RuntimeError("bug"), False, True])
    monkeypatch.setattr(stop, "wait", lambda _timeout=None: stop.is_set())
    slots.run_slot(settings, cast(Storage, object()), cast(JobRunner, runner), wake, stop)
    # The probe's bug cost one turn; the job's bug another; then it carried on.
    assert (len(probes), runner.runs) == (0, 3)
    errors = [line["detail"] for line in log_lines() if line["event"] == "slot.error"]
    assert errors == ["KeyError", "RuntimeError"]
