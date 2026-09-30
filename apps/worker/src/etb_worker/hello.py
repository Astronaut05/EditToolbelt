"""The M0 hello-world job.

Proves the worker's wiring end to end before any real processor exists: it can
reach Postgres, round-trip a tiny object through object storage (and delete it
straight away, as every real job must), and log each step as JSON. The real
queue, processors and retention arrive in M4.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import psycopg
from botocore.exceptions import BotoCoreError, ClientError

from etb_worker.logs import get_logger
from etb_worker.settings import Settings
from etb_worker.storage import s3_client

HELLO_TOOL_ID = "hello"
_HELLO_BODY = b"hello from etb-worker\n"


class CheckFailedError(Exception):
    """A dependency check failed. ``code`` is the machine-readable error code."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def _describe(error: Exception) -> str:
    # Short and safe: the logger's redaction scrubs URLs and credentials on top.
    return f"{type(error).__name__}: {error}"[:300]


def check_database(settings: Settings) -> int:
    """Connect to Postgres and return its server version number (e.g. 180000)."""
    try:
        with psycopg.connect(
            settings.database_url.get_secret_value(),
            connect_timeout=5,
            application_name="etb-worker",
        ) as conn:
            return conn.info.server_version
    except psycopg.Error as error:
        raise CheckFailedError("DB_UNAVAILABLE", _describe(error)) from error


def check_storage(settings: Settings) -> int:
    """Put, read back and delete one small object. Returns the byte count read back."""
    client = s3_client(settings)
    bucket = settings.s3_bucket
    key = f"hello/{uuid.uuid4()}"  # random key, never derived from user data (docs/11)
    try:
        if settings.app_env == "local":
            _ensure_local_bucket(client, bucket)
        client.put_object(Bucket=bucket, Key=key, Body=_HELLO_BODY, ContentType="text/plain")
        try:
            head = client.head_object(Bucket=bucket, Key=key)
        finally:
            client.delete_object(Bucket=bucket, Key=key)
        return int(head["ContentLength"])
    except (BotoCoreError, ClientError) as error:
        raise CheckFailedError("STORAGE_UNAVAILABLE", _describe(error)) from error


def _ensure_local_bucket(client, bucket: str) -> None:  # type: ignore[no-untyped-def]
    # Only the local stack creates its own bucket. Staging and production
    # buckets (with lifecycle rules) are provisioned, never created by code.
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        client.create_bucket(Bucket=bucket)


@dataclass(frozen=True)
class HelloResult:
    ok: bool
    error_code: str | None = None


def run_hello(
    settings: Settings,
    *,
    database: Callable[[Settings], int] = check_database,
    storage: Callable[[Settings], int] = check_storage,
) -> HelloResult:
    job_id = str(uuid.uuid4())
    log = get_logger(job_id=job_id, tool_id=HELLO_TOOL_ID)
    started = time.monotonic()

    def elapsed_ms() -> int:
        return round((time.monotonic() - started) * 1000)

    log.info("job.claimed")
    log.info("job.started")
    try:
        server_version = database(settings)
        log.info("hello.database_ok", server_version=server_version)
        read_back = storage(settings)
        log.info("hello.storage_ok", bytes=read_back, deleted=True)
    except CheckFailedError as error:
        # A dependency outage, not a bug: the detail is enough, a stack trace adds noise.
        log.error(  # noqa: TRY400
            "job.failed", error_code=error.code, detail=str(error), duration_ms=elapsed_ms()
        )
        return HelloResult(ok=False, error_code=error.code)

    log.info("job.succeeded", duration_ms=elapsed_ms())
    return HelloResult(ok=True)
