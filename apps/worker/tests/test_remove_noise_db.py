"""A10 through the real job path (docs/05 -> Reserve, capture, release): a
clean run captures its credits, a broken file fails and gives them back, and
the input is gone either way. Real Postgres (TEST_DATABASE_URL, migrated) and
ffmpeg; storage is a dictionary, so it runs without the stack's gateway."""

from __future__ import annotations

import os
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from psycopg.types.json import Jsonb

from etb_worker import jobqueue
from etb_worker.db import Conn, connect_url
from etb_worker.probe import probe_json, summarize
from etb_worker.runner import JobRunner
from etb_worker.storage import StorageError

URL = os.environ.get("TEST_DATABASE_URL", "")
FIXTURE = Path(__file__).parents[3] / "fixtures" / "audio" / "noisy-speech.wav"

pytestmark = pytest.mark.skipif(
    not URL or shutil.which("ffmpeg") is None, reason="needs TEST_DATABASE_URL and ffmpeg"
)


class MemoryStorage:
    """Just what the runner uses: download, upload, delete."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.types: dict[str, str] = {}

    def download(self, key: str, dest: Path) -> int:
        if key not in self.objects:
            raise StorageError("NoSuchKey", key)
        dest.write_bytes(self.objects[key])
        return len(self.objects[key])

    def upload(self, source: Path, content_type: str) -> str:
        key = f"out/{uuid.uuid4()}"
        self.objects[key] = source.read_bytes()
        self.types[key] = content_type
        return key

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


@pytest.fixture
def db() -> Iterator[Conn]:
    with connect_url(URL) as conn:
        yield conn


def one(db: Conn, query: str, *params: Any) -> dict[str, Any]:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row


def paid_job(db: Conn, storage: MemoryStorage, data: bytes, meta: dict[str, Any]) -> str:
    """A user with 10 credits and a queued remove-noise job that reserved 2 of them.

    It's dated back, so it's the first claimed even if another test left jobs queued.
    """
    user = str(
        one(
            db,
            "insert into users (email) values (%s) returning id",
            f"{uuid.uuid4().hex[:12]}@example.test",
        )["id"]
    )
    db.execute(
        """
        insert into credit_transactions (user_id, kind, amount, balance_after)
        values (%s, 'welcome_grant', 10, 10)
        """,
        (user,),
    )
    key = f"in/{uuid.uuid4()}"
    storage.objects[key] = data
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at, probed_at)
        values (%s, %s, %s, 'audio/wav', 'remove-noise', 1, 1, now() + interval '1 hour',
                now(), now())
        """,
        (user, key, len(data)),
    )
    job = str(
        one(
            db,
            """
            insert into jobs (tool_id, user_id, source, input_key, input_meta, options,
                              credits_quoted, funding, priority, created_at)
            values ('remove-noise', %s, 'web', %s, %s, %s, 2, 'credits', 10,
                    now() - interval '10 years')
            returning id
            """,
            user,
            key,
            Jsonb(meta),
            Jsonb({"strength": "medium", "dehum": "50", "deess": False, "format": "keep"}),
        )["id"]
    )
    db.execute(
        """
        insert into credit_transactions (user_id, kind, amount, balance_after, job_id)
        values (%s, 'reserve', -2, 8, %s)
        """,
        (user, job),
    )
    db.execute("update users set credit_balance = 8 where id = %s", (user,))
    return job


def run_job(db: Conn, storage: MemoryStorage, job: str) -> dict[str, Any]:
    runner = JobRunner(
        storage,  # type: ignore[arg-type]  # the runner's three calls, in memory
        lambda: connect_url(URL),
        worker_id=f"test-{uuid.uuid4().hex[:6]}",
        heartbeat_sec=0.2,
    )
    claimed = jobqueue.claim(db, runner.worker_id)
    assert claimed is not None
    assert str(claimed["id"]) == job
    runner.run(claimed)
    return one(db, "select * from jobs where id = %s", job)


def ledger(db: Conn, job: str) -> tuple[list[str], int]:
    kinds = [
        row["kind"]
        for row in db.execute(
            "select kind from credit_transactions where job_id = %s order by created_at", (job,)
        ).fetchall()
    ]
    balance = one(
        db,
        "select u.credit_balance from users u join jobs j on j.user_id = u.id where j.id = %s",
        job,
    )["credit_balance"]
    return kinds, int(balance)


def test_a_clean_run_captures_its_credits_and_drops_the_input(db: Conn) -> None:
    storage = MemoryStorage()
    meta = summarize(probe_json(FIXTURE), "audio/wav")
    job = paid_job(db, storage, FIXTURE.read_bytes(), meta)
    row = run_job(db, storage, job)
    assert row["status"] == "succeeded"
    assert row["output_meta"]["ext"] == "wav"
    assert row["output_meta"]["notes"][0].startswith("Medium")
    assert storage.types[row["output_key"]] == "audio/wav"
    assert row["input_key"] is None
    assert list(storage.objects) == [row["output_key"]]
    assert ledger(db, job) == (["reserve", "capture"], 8)


def test_a_broken_file_fails_and_its_credits_come_back(db: Conn) -> None:
    storage = MemoryStorage()
    meta = {
        "container": "wav",
        "duration_ms": 6000,
        "audio": {"codec": "pcm_s16le", "sample_rate": 48000, "channels": 1},
    }
    job = paid_job(db, storage, bytes(range(256)) * 64, meta)
    row = run_job(db, storage, job)
    assert (row["status"], row["error_code"]) == ("failed", "TOOL_FAILED")
    assert row["output_key"] is None
    assert storage.objects == {}
    assert ledger(db, job) == (["reserve", "release"], 10)
