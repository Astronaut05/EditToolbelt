from __future__ import annotations

from collections.abc import Callable
from typing import Any

from etb_worker.hello import CheckFailedError, run_hello
from etb_worker.main import run_hello_with_retries
from etb_worker.settings import Settings

Lines = Callable[[], list[dict[str, Any]]]


def ok_database(_: Settings) -> int:
    return 180000


def ok_storage(_: Settings) -> int:
    return 22


def down_database(_: Settings) -> int:
    raise CheckFailedError("DB_UNAVAILABLE", "OperationalError")


def test_success_logs_the_job_lifecycle(settings: Settings, log_lines: Lines) -> None:
    result = run_hello(settings, database=ok_database, storage=ok_storage)
    assert result.ok
    lines = log_lines()
    assert [line["event"] for line in lines] == [
        "job.claimed",
        "job.started",
        "hello.database_ok",
        "hello.storage_ok",
        "job.succeeded",
    ]
    job_ids = {line["job_id"] for line in lines}
    assert len(job_ids) == 1
    assert all(line["tool_id"] == "hello" for line in lines)
    assert isinstance(lines[-1]["duration_ms"], int)


def test_failure_reports_an_error_code_and_no_secrets(settings: Settings, log_lines: Lines) -> None:
    result = run_hello(settings, database=down_database, storage=ok_storage)
    assert not result.ok
    assert result.error_code == "DB_UNAVAILABLE"
    failed = log_lines()[-1]
    assert failed["event"] == "job.failed"
    assert failed["level"] == "error"
    assert failed["error_code"] == "DB_UNAVAILABLE"
    text = str(log_lines())
    assert "secret" not in text


def test_retries_until_success(settings: Settings, log_lines: Lines) -> None:
    outcomes = iter([down_database, down_database, ok_database])
    waits: list[float] = []

    def wait(seconds: float) -> bool:
        waits.append(seconds)
        return False

    ok = run_hello_with_retries(
        settings,
        hello=lambda s: run_hello(s, database=next(outcomes), storage=ok_storage),
        wait=wait,
    )
    assert ok
    assert waits == [1, 2]
    assert [line["attempt"] for line in log_lines() if line["event"] == "hello.retry"] == [1, 2]


def test_gives_up_after_the_last_retry(settings: Settings, log_lines: Lines) -> None:
    ok = run_hello_with_retries(
        settings,
        hello=lambda s: run_hello(s, database=down_database, storage=ok_storage),
        wait=lambda _: False,
    )
    assert not ok
    assert log_lines()[-1]["event"] == "hello.gave_up"
    assert log_lines()[-1]["attempts"] == 6


def test_stops_retrying_when_asked_to_stop(settings: Settings, log_lines: Lines) -> None:
    calls = 0

    def hello(s: Settings):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        return run_hello(s, database=down_database, storage=ok_storage)

    assert not run_hello_with_retries(settings, hello=hello, wait=lambda _: True)
    assert calls == 1
