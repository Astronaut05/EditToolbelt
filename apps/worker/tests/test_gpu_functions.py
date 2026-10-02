"""The GPU functions' own error handling, run locally (``.local()``: no Modal, no GPU).

Whatever goes wrong inside a function comes back as an answer, never as an
exception: Modal would log the traceback, and an error's text can quote the
presigned URL (urllib's ValueError does).
"""

from __future__ import annotations

import urllib.error
from pathlib import Path
from typing import Any

import pytest

from etb_worker.gpu import modal_app
from etb_worker.gpu.remote import CallFailed

SIGNED = "https://bucket.example/out/abc?X-Amz-Signature=secret"
TINY = "data:application/octet-stream;base64,AAAA"


def leaks(answer: dict[str, Any]) -> bool:
    return any(part in str(answer) for part in ("https://", "Signature", "secret"))


def test_an_unexpected_error_in_the_upscaler_is_a_fixed_gpu_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken(*_args: Any) -> dict[str, Any]:
        raise ValueError(f"unknown url type: {SIGNED!r}")

    monkeypatch.setattr(modal_app, "_upscale", broken)
    answer = modal_app.upscale_image.local(TINY, SIGNED, {})
    assert answer["ok"] is False
    assert answer["code"] == "GPU_FAILED"
    assert answer["detail"] == "The GPU function failed (ValueError)."
    assert not leaks(answer)
    # Still measured, so the worker bills it.
    assert answer["gpu_seconds"] >= 0
    assert answer["idle_tail_seconds"] == modal_app.SPECS["upscale_image"].scaledown


def test_an_unexpected_error_in_transcription_is_a_fixed_gpu_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unreachable(url: str, dest: Path, max_bytes: int) -> int:
        raise urllib.error.URLError(f"no route to {url}")

    monkeypatch.setattr(modal_app, "fetch_input", unreachable)
    answer = modal_app.transcribe.local(SIGNED, SIGNED, {})
    assert (answer["ok"], answer["code"]) == (False, "GPU_FAILED")
    assert answer["detail"] == "The GPU function failed (URLError)."
    assert not leaks(answer)


def test_failures_the_function_words_keep_their_code(monkeypatch: pytest.MonkeyPatch) -> None:
    def damaged(*_args: Any) -> dict[str, Any]:
        raise CallFailed("DECODE_FAILED", "The image couldn't be decoded; it may be damaged.")

    monkeypatch.setattr(modal_app, "_upscale", damaged)
    answer = modal_app.upscale_image.local(TINY, None, {})
    assert (answer["code"], answer["detail"]) == (
        "DECODE_FAILED",
        "The image couldn't be decoded; it may be damaged.",
    )
