from __future__ import annotations

import io
import json
import shutil
import subprocess
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

OPTIONAL_ENV = (
    "APP_ENV",
    "APP_VERSION",
    "LOG_LEVEL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "TELEGRAM_API_URL",
    "SMTP_URL",
    "MAIL_FROM",
    "ALERT_EMAIL",
    "WORKER_SLOTS",
    "WORKER_GPU_SLOTS",
    "GPU_BACKEND",
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
)


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Remove every variable Settings reads, so tests only see what they set."""
    for name in (*VALID_ENV, *OPTIONAL_ENV):
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


@pytest.fixture(scope="session")
def media(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    """Small license-free files made by ffmpeg's own test sources, plus broken ones."""
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    folder = tmp_path_factory.mktemp("media")

    def make(name: str, *args: str) -> Any:
        path = folder / name
        subprocess.run(  # noqa: S603
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args, str(path)],  # noqa: S607
            check=True,
        )
        return path

    mp4 = make(
        "clip.mp4",
        *("-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=2"),
        *("-f", "lavfi", "-i", "sine=frequency=440:duration=2"),
        *("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"),
    )
    webm = make(
        "clip.webm",
        *("-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=1"),
        *("-c:v", "libvpx-vp9", "-b:v", "200k"),
    )
    garbage = folder / "garbage.mp4"
    garbage.write_bytes(bytes(range(256)) * 64)
    truncated = folder / "truncated.mp4"
    truncated.write_bytes(mp4.read_bytes()[:1500])
    return {"mp4": mp4, "webm": webm, "garbage": garbage, "truncated": truncated}
