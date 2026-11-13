"""A finished job is recorded even when its account's row is held for a moment (W10).

Connections give up on a lock after 5 s (db.py). Without another try, a
purchase being credited at the wrong moment would fail a finished job.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

import psycopg
import pytest

from etb_worker import jobqueue, runner
from etb_worker.runner import JobRunner

JOB: jobqueue.Job = {"id": "00000000-0000-0000-0000-000000000001", "tool_id": "hello"}


@contextlib.contextmanager
def no_conn() -> Iterator[None]:
    yield None


def a_runner() -> JobRunner:
    made = JobRunner.__new__(JobRunner)
    made.connect = no_conn  # type: ignore[assignment]  # succeed is replaced: no database
    made.worker_id = "test"
    return made


def test_a_held_account_row_is_asked_again(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def succeed(*_args: Any) -> bool:
        calls.append(1)
        if len(calls) < runner.SUCCEED_TRIES:
            raise psycopg.errors.LockNotAvailable("the row is held")
        return True

    monkeypatch.setattr(jobqueue, "succeed", succeed)
    assert a_runner()._succeed(JOB, "out/key", {}) is True
    assert len(calls) == runner.SUCCEED_TRIES


def test_a_row_held_through_every_try_fails_the_job_as_before(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []

    def succeed(*_args: Any) -> bool:
        calls.append(1)
        raise psycopg.errors.LockNotAvailable("the row is held")

    monkeypatch.setattr(jobqueue, "succeed", succeed)
    with pytest.raises(psycopg.errors.LockNotAvailable):
        a_runner()._succeed(JOB, "out/key", {})
    assert len(calls) == runner.SUCCEED_TRIES


def test_a_cancelled_job_is_not_asked_again(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def succeed(*_args: Any) -> bool:
        calls.append(1)
        return False

    monkeypatch.setattr(jobqueue, "succeed", succeed)
    assert a_runner()._succeed(JOB, "out/key", {}) is False
    assert len(calls) == 1
