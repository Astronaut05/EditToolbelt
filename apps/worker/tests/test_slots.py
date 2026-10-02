"""The GPU slot loop: it runs GPU jobs and nothing else (the DB tests cover the claims)."""

from __future__ import annotations

import threading
from typing import Any, cast

import psycopg
import pytest

from etb_worker import slots
from etb_worker.runner import JobRunner


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
