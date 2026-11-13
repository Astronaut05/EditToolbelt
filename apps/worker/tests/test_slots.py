"""The slot loops and the probe loop: a GPU slot runs GPU jobs and nothing else, uploads
are probed whatever the slots are doing, and no error ends a loop
(the DB tests cover the claims and the probe)."""

from __future__ import annotations

import contextlib
import threading
from collections.abc import Callable, Iterator
from typing import Any, cast

import psycopg
import pytest

from etb_worker import slots
from etb_worker.main import slot_threads
from etb_worker.runner import JobRunner
from etb_worker.settings import Settings
from etb_worker.storage import Storage, StorageError


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


class InAJob:
    """A slot's runner inside one long job: run_next doesn't come back until it's released."""

    def __init__(self, release: threading.Event, pool: str = "cpu") -> None:
        self.release, self.pool = release, pool
        self.started = threading.Event()
        self.runs = 0

    def run_next(self) -> bool:
        self.runs += 1
        self.started.set()
        self.release.wait(120)
        return False


def test_an_upload_is_probed_while_every_slot_is_inside_a_job(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Finding W3: only CPU slots probed, between jobs. With both of production's inside a
    two-hour job no upload was probed, so no tool, GPU tools included, could quote a job."""

    @contextlib.contextmanager
    def connect(_settings: Settings) -> Iterator[object]:
        yield object()

    waiting: list[str] = []  # uploads completed and not yet probed
    probed = threading.Event()

    def probe_next(_conn: object, _storage: Storage) -> bool:
        if not waiting:
            return False
        waiting.pop()
        probed.set()
        return True

    monkeypatch.setattr(slots, "connect", connect)
    monkeypatch.setattr(slots, "probe_next", probe_next)
    monkeypatch.setattr(slots, "POLL_SEC", 0.01)
    stop, wake, release = threading.Event(), threading.Event(), threading.Event()
    # Production's slots: two for CPU jobs, and here one for GPU jobs.
    busy = [InAJob(release), InAJob(release), InAJob(release, pool="gpu")]
    threads = slot_threads(
        settings, cast(Storage, object()), cast(list[JobRunner], busy), wake, stop
    )
    for thread in threads:
        thread.start()
    try:
        for runner in busy:
            assert runner.started.wait(5)
        # Every slot is busy. Now someone's upload completes (NOTIFY etb_uploads).
        waiting.append("an upload")
        wake.set()
        assert probed.wait(5), "the upload waits for a job to end"
        # No slot came back from its job to do it.
        assert [runner.runs for runner in busy] == [1, 1, 1]
    finally:
        stop.set()
        release.set()
        wake.set()
        for thread in threads:
            thread.join(5)
    assert not any(thread.is_alive() for thread in threads)


def test_the_probe_loop_runs_on_after_any_error_and_waits_before_trying_again(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    log_lines: Callable[[], list[dict[str, Any]]],
) -> None:
    connects: list[Any] = [psycopg.OperationalError("connection refused")]

    @contextlib.contextmanager
    def connect(_settings: Settings) -> Iterator[object]:
        if connects:
            raise connects.pop()
        yield object()

    stop, wake = threading.Event(), threading.Event()
    probes: list[Any] = [
        KeyError("rotate: from-the-file"),
        StorageError("UNREACHABLE", "download failed: UNREACHABLE"),
        psycopg.OperationalError("server closed the connection"),
        True,
        False,
        True,
    ]

    def probe_next(_conn: object, _storage: Storage) -> bool:
        answer = probes.pop(0)
        if not probes:
            stop.set()
        if isinstance(answer, BaseException):
            raise answer
        return bool(answer)

    waits: list[float | None] = []

    def wait(timeout: float | None = None) -> bool:
        waits.append(timeout)
        return stop.is_set()

    monkeypatch.setattr(slots, "connect", connect)
    monkeypatch.setattr(slots, "probe_next", probe_next)
    monkeypatch.setattr(slots, "POLL_SEC", 0.01)
    monkeypatch.setattr(stop, "wait", wait)
    slots.run_probes(settings, cast(Storage, object()), wake, stop)
    # Every upload after the failures was still probed.
    assert probes == []
    # After each failure it waited 5 s: storage or the database being down isn't hammered.
    assert waits == [5, 5, 5, 5]
    seen = [
        (line["event"], line.get("detail") or line.get("error_code"))
        for line in log_lines()
        if line.get("pool") == "probe"
    ]
    assert seen == [
        ("slot.db_unavailable", "OperationalError"),
        ("slot.error", "KeyError"),
        ("slot.storage_unavailable", "UNREACHABLE"),
        ("slot.db_unavailable", "OperationalError"),
    ]
    # Only the type: the message can quote a file's metadata.
    assert "from-the-file" not in str(log_lines())
