"""Storage without a bucket: the errors a transfer raises, the listing's pages, the endpoint."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from boto3.exceptions import RetriesExceededError, S3UploadFailedError

from etb_worker.storage import Storage, StorageError, endpoint_origin


class _Settings:
    s3_bucket = "test-bucket"


class _Pages:
    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self.pages = pages

    def paginate(self, **_: Any) -> list[dict[str, Any]]:
        return self.pages


class _Client:
    def __init__(self, error: Exception | None = None, pages: list[dict[str, Any]] | None = None):
        self.error = error
        self.pages = pages or []
        self.asked: list[str] = []

    def download_file(self, *_: Any, **__: Any) -> None:
        assert self.error is not None
        raise self.error

    def upload_file(self, *_: Any, **__: Any) -> None:
        assert self.error is not None
        raise self.error

    def get_paginator(self, name: str) -> _Pages:
        self.asked.append(name)
        return _Pages(self.pages)


def _storage(client: _Client) -> Storage:
    return Storage(_Settings(), client=client)  # type: ignore[arg-type]


def test_a_download_whose_stream_keeps_failing_is_a_storage_error(tmp_path: Path) -> None:
    # s3transfer gives up after five tries with an error of its own, not botocore's.
    storage = _storage(_Client(RetriesExceededError(OSError("read timed out"))))
    with pytest.raises(StorageError):
        storage.download("uploads/x", tmp_path / "in")


def test_a_failed_upload_is_a_storage_error(tmp_path: Path) -> None:
    source = tmp_path / "out"
    source.write_bytes(b"x")
    storage = _storage(_Client(S3UploadFailedError("Failed to upload: SlowDown")))
    with pytest.raises(StorageError):
        storage.upload(source, "video/mp4", "out/x")


def test_open_uploads_reads_every_page() -> None:
    started = datetime(2026, 11, 12, tzinfo=UTC)

    def page(start: int, count: int) -> dict[str, Any]:
        return {
            "Uploads": [
                {"Key": f"uploads/{n}", "UploadId": f"id-{n}", "Initiated": started}
                for n in range(start, start + count)
            ]
        }

    client = _Client(pages=[page(0, 1000), page(1000, 3), {}])
    found = _storage(client).open_uploads()
    assert client.asked == ["list_multipart_uploads"]
    assert len(found) == 1003
    assert found[-1].key == "uploads/1002"


def test_the_endpoint_is_its_origin_however_it_was_pasted() -> None:
    assert endpoint_origin("https://account.eu.r2.example/edittoolbelt-files") == (
        "https://account.eu.r2.example"
    )
    assert endpoint_origin("https://account.eu.r2.example/") == "https://account.eu.r2.example"
    assert endpoint_origin("http://storage:7070") == "http://storage:7070"
