from __future__ import annotations

import io
import json
from collections.abc import Callable
from typing import Any

import pytest

from etb_worker.logs import configure_logging
from etb_worker.settings import Settings

VALID_ENV = {
    "DATABASE_URL": "postgresql://etb:secret-pass@localhost:5432/etb",
    "S3_ENDPOINT": "http://localhost:7070",
    "S3_REGION": "us-east-1",
    "S3_BUCKET": "etb-local",
    "S3_ACCESS_KEY_ID": "key-id",
    "S3_SECRET_ACCESS_KEY": "super-secret",
}


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Remove every variable Settings reads, so tests only see what they set."""
    for name in (*VALID_ENV, "APP_ENV", "APP_VERSION", "LOG_LEVEL"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture
def settings(clean_env: pytest.MonkeyPatch) -> Settings:
    for name, value in VALID_ENV.items():
        clean_env.setenv(name, value)
    return Settings()


@pytest.fixture
def log_lines() -> Callable[[], list[dict[str, Any]]]:
    """Configure logging into a buffer; call the fixture value to get parsed lines."""
    buffer = io.StringIO()
    configure_logging(service="worker", env="test", version="abc123", level="info", stream=buffer)

    def lines() -> list[dict[str, Any]]:
        return [json.loads(line) for line in buffer.getvalue().splitlines() if line]

    return lines
