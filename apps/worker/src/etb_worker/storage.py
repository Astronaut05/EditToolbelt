"""Object storage for the worker (docs/01 -> Workers, Retention; docs/11 -> Storage).

The worker downloads a job's input, uploads its output under a random key,
and deletes inputs, outputs and abandoned uploads. Keys are random, never
derived from users or files, and never logged next to anything personal.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from etb_worker.settings import Settings


class StorageError(Exception):
    """A storage call failed. ``code`` is S3's error code, or UNREACHABLE."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


@dataclass(frozen=True)
class StoredObject:
    key: str
    bytes: int
    modified: datetime


@dataclass(frozen=True)
class OpenUpload:
    key: str
    upload_id: str
    started: datetime


def s3_client(settings: Settings) -> Any:  # boto3 ships no types
    return boto3.client(
        "s3",
        endpoint_url=str(settings.s3_endpoint),
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key_id.get_secret_value(),
        aws_secret_access_key=settings.s3_secret_access_key.get_secret_value(),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=60,
        ),
    )


def _code(error: Exception) -> str:
    if isinstance(error, ClientError):
        return str(error.response.get("Error", {}).get("Code", "unknown"))
    return "UNREACHABLE"


class Storage:
    """The bucket named in the settings."""

    def __init__(self, settings: Settings, client: Any = None) -> None:
        self.bucket = settings.s3_bucket
        self._client = client if client is not None else s3_client(settings)

    def download(self, key: str, dest: Path) -> int:
        """Writes the object to ``dest``; returns its size in bytes."""
        try:
            self._client.download_file(self.bucket, key, str(dest))
        except (BotoCoreError, ClientError) as error:
            raise StorageError(_code(error), f"download failed: {_code(error)}") from None
        return dest.stat().st_size

    def upload(self, source: Path, content_type: str) -> str:
        """Uploads ``source`` under a new random ``out/`` key and returns the key."""
        key = f"out/{uuid.uuid4()}"
        try:
            self._client.upload_file(
                str(source), self.bucket, key, ExtraArgs={"ContentType": content_type}
            )
        except (BotoCoreError, ClientError) as error:
            raise StorageError(_code(error), f"upload failed: {_code(error)}") from None
        return key

    def delete(self, key: str) -> None:
        """Deletes the object; an object that is already gone is fine."""
        try:
            self._client.delete_object(Bucket=self.bucket, Key=key)
        except (BotoCoreError, ClientError) as error:
            if _code(error) != "NoSuchKey":
                raise StorageError(_code(error), f"delete failed: {_code(error)}") from None

    def abort_upload(self, key: str, upload_id: str) -> None:
        try:
            self._client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=upload_id)
        except (BotoCoreError, ClientError) as error:
            if _code(error) not in {"NoSuchUpload", "NoSuchKey"}:
                raise StorageError(_code(error), f"abort failed: {_code(error)}") from None

    def objects(self) -> list[StoredObject]:
        """Every object in the bucket (the sweeper's safety check)."""
        found: list[StoredObject] = []
        try:
            for page in self._client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket):
                for item in page.get("Contents", []):
                    found.append(
                        StoredObject(
                            key=str(item["Key"]),
                            bytes=int(item["Size"]),
                            modified=item["LastModified"],
                        )
                    )
        except (BotoCoreError, ClientError) as error:
            raise StorageError(_code(error), f"list failed: {_code(error)}") from None
        return found

    def open_uploads(self) -> list[OpenUpload]:
        """Multipart uploads that were started and never completed or aborted."""
        try:
            answer = self._client.list_multipart_uploads(Bucket=self.bucket)
        except (BotoCoreError, ClientError) as error:
            raise StorageError(_code(error), f"list uploads failed: {_code(error)}") from None
        return [
            OpenUpload(
                key=str(item["Key"]), upload_id=str(item["UploadId"]), started=item["Initiated"]
            )
            for item in answer.get("Uploads", [])
        ]

    def lifecycle(self) -> dict[str, Any] | None:
        """The bucket's lifecycle rules; None where the storage doesn't support them."""
        try:
            return dict(self._client.get_bucket_lifecycle_configuration(Bucket=self.bucket))
        except ClientError as error:
            if _code(error) in {"NotImplemented", "NoSuchLifecycleConfiguration"}:
                return None if _code(error) == "NotImplemented" else {"Rules": []}
            raise StorageError(_code(error), f"lifecycle failed: {_code(error)}") from None
        except BotoCoreError as error:
            raise StorageError(_code(error), f"lifecycle failed: {_code(error)}") from None
