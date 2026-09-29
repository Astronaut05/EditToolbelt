from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from etb_worker.redact import REDACTED, redact

# Shared with packages/core so both loggers redact identically.
CASES_FILE = Path(__file__).resolve().parents[3] / "fixtures" / "logging" / "redaction-cases.json"
CASES: list[dict[str, Any]] = json.loads(CASES_FILE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_shared_cases(case: dict[str, Any]) -> None:
    assert redact(case["input"]) == case["expected"]


def test_errors_become_dicts_with_scrubbed_text() -> None:
    try:
        raise TypeError("upload to https://x.test/o?X-Amz-Signature=1 failed")
    except TypeError as error:
        out = redact({"err": error})
    assert out["err"]["type"] == "TypeError"
    assert out["err"]["message"] == "upload to https://x.test/o?[redacted] failed"
    assert "X-Amz-Signature" not in out["err"]["stack"]


def test_file_bytes_never_pass() -> None:
    assert redact({"chunk": b"\x00\x01", "buf": bytearray(2), "view": memoryview(b"ab")}) == {
        "chunk": "[binary]",
        "buf": "[binary]",
        "view": "[binary]",
    }


def test_circular_references() -> None:
    a: dict[str, Any] = {"name": "a"}
    a["self"] = a
    assert redact(a) == {"name": "a", "self": "[circular]"}


def test_does_not_mutate_input() -> None:
    data = {"email": "x@y.io"}
    redact(data)
    assert data == {"email": "x@y.io"}
    assert REDACTED == "[redacted]"
