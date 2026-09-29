from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from etb_worker.logs import get_logger

Lines = Callable[[], list[dict[str, Any]]]


def test_one_json_object_per_event_with_shared_fields(log_lines: Lines) -> None:
    get_logger().info("job.succeeded", tool_id="crop-image", duration_ms=12)
    [line] = log_lines()
    assert line == {
        "level": "info",
        "ts": line["ts"],
        "service": "worker",
        "env": "test",
        "version": "abc123",
        "tool_id": "crop-image",
        "duration_ms": 12,
        "event": "job.succeeded",
    }
    assert list(line)[:5] == ["level", "ts", "service", "env", "version"]


def test_timestamp_matches_javascript_iso_format(log_lines: Lines) -> None:
    get_logger().info("x")
    ts = log_lines()[0]["ts"]
    assert ts.endswith("Z")
    assert len(ts) == len("2026-09-29T00:00:00.000Z")
    datetime.fromisoformat(ts)


def test_level_names_match_pino(log_lines: Lines) -> None:
    log = get_logger()
    log.debug("hidden")
    log.warning("w")
    log.error("e")
    assert [line["level"] for line in log_lines()] == ["warn", "error"]


def test_redacts_bound_values_and_event(log_lines: Lines) -> None:
    get_logger(filename="holiday.mov").warning("retry for a@b.io", email="a@b.io")
    [line] = log_lines()
    assert line["filename"] == "[redacted]"
    assert line["email"] == "[redacted]"
    assert line["event"] == "retry for [redacted-email]"


def test_exceptions_become_err_like_pino(log_lines: Lines) -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        get_logger().exception("job.failed", error_code="TEST")
    [line] = log_lines()
    assert line["level"] == "error"
    assert line["error_code"] == "TEST"
    assert line["err"]["type"] == "ValueError"
    assert line["err"]["message"] == "boom"
    assert "boom" in line["err"]["stack"]


def test_library_logs_join_the_json_stream(log_lines: Lines) -> None:
    logging.getLogger("botocore.test").warning("slow response from https://x.test/o?sig=1")
    [line] = log_lines()
    assert line["event"] == "lib.log"
    assert line["level"] == "warn"
    assert line["logger"] == "botocore.test"
    assert line["detail"] == "slow response from https://x.test/o?[redacted]"
