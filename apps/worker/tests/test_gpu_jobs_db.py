"""GPU jobs end to end against real Postgres, with stand-ins for storage and the GPU.

Runs when TEST_DATABASE_URL is set (migrated); no storage or GPU needed.
Each processor: presign -> call -> finish (output stored, GPU time and cost
on the job, credits captured, input deleted at once); a failure refunds;
a cancel cancels the call; and the daily budget stops GPU jobs from starting.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

import pytest
from psycopg.types.json import Jsonb

from etb_worker import jobqueue
from etb_worker.db import Conn, connect_url
from etb_worker.gpu import budget
from etb_worker.gpu.backend import GpuBackend, GpuCall, GpuCancelled, GpuError, GpuResult
from etb_worker.notify import Notifier
from etb_worker.runner import JobRunner
from etb_worker.scheduler import Scheduler
from etb_worker.settings import Settings
from etb_worker.storage import Storage, StorageError

URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

RATE = 0.0002  # USD a second, as the web writes it for the tool's GPU


class FakeStorage:
    """The bucket as a dict; presigned URLs name their key, as R2's do."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.presigned: list[tuple[str, str, str]] = []

    def presign_get(self, key: str, expires_sec: int) -> str:
        assert expires_sec > 0
        self.presigned.append(("GET", key, ""))
        return f"https://storage.test/{key}?sig=get"

    def presign_put(self, key: str, content_type: str, expires_sec: int) -> str:
        self.presigned.append(("PUT", key, content_type))
        return f"https://storage.test/{key}?sig=put"

    def size(self, key: str) -> int | None:
        found = self.objects.get(key)
        return len(found[0]) if found else None

    def download(self, key: str, dest: Path) -> int:
        if key not in self.objects:
            raise StorageError("NoSuchKey", "download failed: NoSuchKey")
        dest.write_bytes(self.objects[key][0])
        return dest.stat().st_size

    def upload(self, source: Path, content_type: str) -> str:
        key = f"out/{uuid.uuid4()}"
        self.objects[key] = (source.read_bytes(), content_type)
        return key

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


def key_of(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


Behaviour = Callable[[GpuCall, FakeStorage], GpuResult]


class FakeGpu:
    """A backend whose 'function' is a Python callable that writes to FakeStorage."""

    name = "fake"

    def __init__(self, storage: FakeStorage, behaviour: Behaviour) -> None:
        self.storage, self.behaviour = storage, behaviour
        self.calls: list[GpuCall] = []

    def run(self, call: GpuCall) -> GpuResult:
        self.calls.append(call)
        return self.behaviour(call, self.storage)


def result(**meta: Any) -> GpuResult:
    return GpuResult(
        meta=meta, notes=[], gpu="T4", gpu_seconds=12.0, billed_seconds=22.0, wall_seconds=15.0
    )


def writes(content: bytes, **meta: Any) -> Behaviour:
    def behave(call: GpuCall, storage: FakeStorage) -> GpuResult:
        call.on_wait(1.0)
        url = call.kwargs["output_url"]
        storage.objects[key_of(url)] = (content, "set by the PUT")
        return result(**meta)

    return behave


@pytest.fixture
def db() -> Iterator[Conn]:
    with connect_url(URL) as conn:
        yield conn


def one(db: Conn, query: str, *params: Any) -> dict[str, Any]:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row


def new_user(db: Conn, credits: int = 0) -> str:
    user = str(
        one(
            db,
            "insert into users (email) values (%s) returning id",
            f"{uuid.uuid4().hex[:12]}@example.test",
        )["id"]
    )
    if credits:
        db.execute(
            "insert into credit_transactions (user_id, kind, amount, balance_after)"
            " values (%s, 'welcome_grant', %s, %s)",
            (user, credits, credits),
        )
        db.execute("update users set credit_balance = %s where id = %s", (credits, user))
    return user


def new_job(  # noqa: PLR0913, PLR0917 - a job row has that many parts
    db: Conn,
    storage: FakeStorage,
    user: str,
    tool: str,
    meta: dict[str, Any],
    options: dict[str, Any],
    *,
    quote: int = 0,
    content: bytes = b"input bytes",
) -> str:
    key = f"in/{uuid.uuid4()}"
    storage.objects[key] = (content, "input")
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at, probed_at)
        values (%s, %s, 1, 'image/png', %s, 1, 1, now() + interval '1 hour', now(), now())
        """,
        (user, key, tool),
    )
    job = str(
        one(
            db,
            """
            insert into jobs (tool_id, user_id, source, input_key, input_meta, options,
                              credits_quoted, funding, gpu_rate_usd, timeout_sec)
            values (%s, %s, 'web', %s, %s, %s, %s, %s, %s, 900)
            returning id
            """,
            tool,
            user,
            key,
            Jsonb(meta),
            Jsonb(options),
            quote,
            "credits" if quote else "none",
            RATE,
        )["id"]
    )
    if quote:
        balance = int(
            one(db, "select credit_balance from users where id = %s", user)["credit_balance"]
        )
        db.execute(
            "insert into credit_transactions (user_id, kind, amount, balance_after, job_id)"
            " values (%s, 'reserve', %s, %s, %s)",
            (user, -quote, balance - quote, job),
        )
        db.execute("update users set credit_balance = %s where id = %s", (balance - quote, user))
    return job


def runner(storage: FakeStorage, gpu: GpuBackend | None) -> JobRunner:
    return JobRunner(
        cast(Storage, storage),
        lambda: connect_url(URL),
        worker_id=f"test-gpu-{uuid.uuid4().hex[:6]}",
        heartbeat_sec=0.1,
        gpu=gpu,
    )


def claim_this(db: Conn, run: JobRunner, job: str) -> jobqueue.Job:
    db.execute("update jobs set priority = 20 where id = %s", (job,))
    claimed = jobqueue.claim(db, run.worker_id)
    assert claimed is not None
    assert str(claimed["id"]) == job
    return claimed


def ledger(db: Conn, job: str) -> list[str]:
    rows = db.execute(
        "select kind from credit_transactions where job_id = %s order by created_at, id", (job,)
    ).fetchall()
    return [row["kind"] for row in rows]


IMAGE = {"video": {"width": 100, "height": 50, "codec": "png"}, "duration_ms": 0}
AUDIO = {"audio": {"codec": "aac", "sample_rate": 48000}, "duration_ms": 61_000}


def test_upscale_presigns_calls_and_finishes_like_any_job(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(b"PNG" * 100, width=400, height=200))
    user = new_user(db, credits=10)
    options = {"scale": "4", "model": "general", "denoise": "medium", "format": "png"}
    job = new_job(db, storage, user, "upscale-image", IMAGE, options, quote=4)
    input_key = one(db, "select input_key from jobs where id = %s", job)["input_key"]
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded", row["error_detail"]
    call = gpu.calls[0]
    assert call.function == "upscale_image"
    assert call.kwargs["options"] == {
        "scale": 4,
        "model": "general",
        "denoise": 0.5,
        "format": "png",
    }
    assert key_of(call.kwargs["input_url"]) == input_key
    assert ("PUT", row["output_key"], "image/png") in storage.presigned
    assert storage.objects[row["output_key"]][0] == b"PNG" * 100
    assert row["output_meta"] == {
        "width": 400,
        "height": 200,
        "model": "general",
        "notes": [],
        "bytes": 300,
        "content_type": "image/png",
        "ext": "png",
    }
    assert float(row["gpu_seconds"]) == 12.0
    assert float(row["gpu_cost_usd"]) == pytest.approx(22.0 * RATE)
    # The input went the moment the job ended; the credits were captured.
    assert input_key not in storage.objects
    assert row["input_key"] is None
    assert ledger(db, job) == ["reserve", "capture"]


def transcript(*texts: str) -> bytes:
    segments = []
    for n, text in enumerate(texts):
        words = [
            {"start": n * 3 + i * 0.4, "end": n * 3 + i * 0.4 + 0.3, "word": f" {w}"}
            for i, w in enumerate(text.split())
        ]
        segments.append({"start": n * 3, "end": n * 3 + 2.5, "text": f" {text}", "words": words})
    return json.dumps({"language": "uz", "segments": segments}).encode()


def test_auto_subtitles_turns_the_transcript_into_srt_and_deletes_it(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(transcript("Salom dunyo.", "Qalaysiz?"), language="uz"))
    user = new_user(db)
    options = {"language": "auto", "format": "srt", "maxChars": 42, "maxLines": 2}
    job = new_job(db, storage, user, "auto-subtitles", AUDIO, options)
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded", row["error_detail"]
    assert gpu.calls[0].function == "transcribe"
    assert gpu.calls[0].kwargs["options"] == {"language": "auto", "task": "transcribe"}
    # Only the SRT is left: the transcript the GPU wrote was deleted once read.
    assert list(storage.objects) == [row["output_key"]]
    text, content_type = storage.objects[row["output_key"]]
    assert text.decode().startswith("1\n00:00:00,000 --> ")
    assert "Salom dunyo." in text.decode()
    assert content_type == "application/x-subrip; charset=utf-8"
    assert row["output_meta"]["ext"] == "srt"
    assert row["output_meta"]["notes"] == ["Language: Uzbek (detected)", "2 subtitles"]


def test_transcribe_audio_writes_json_with_every_word(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(transcript("One two three.")))
    user = new_user(db)
    job = new_job(
        db, storage, user, "transcribe-audio", AUDIO, {"language": "uz", "format": "json"}
    )
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded", row["error_detail"]
    data = json.loads(storage.objects[row["output_key"]][0])
    assert [w["text"] for w in data["segments"][0]["words"]] == ["One", "two", "three."]


def test_a_gpu_failure_fails_the_job_and_gives_the_credits_back(db: Conn) -> None:
    storage = FakeStorage()

    def fails(call: GpuCall, store: FakeStorage) -> GpuResult:
        store.objects[key_of(call.kwargs["output_url"])] = (b"half", "x")
        raise GpuError("GPU_FAILED", "the GPU function raised RuntimeError", gpu_seconds=30.0)

    user = new_user(db, credits=10)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {"scale": "2"}, quote=3)
    run = runner(storage, FakeGpu(storage, fails))
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "failed"
    assert row["error_code"] == "GPU_FAILED"
    assert row["error_detail"] == "Our GPU server couldn't finish this one."
    assert ledger(db, job) == ["reserve", "release"]
    assert (
        int(one(db, "select credit_balance from users where id = %s", user)["credit_balance"]) == 10
    )
    # What it cost is still on the job (the budget counts it); nothing it wrote is left.
    assert float(row["gpu_seconds"]) == 30.0
    assert float(row["gpu_cost_usd"]) == pytest.approx(30.0 * RATE)
    assert storage.objects == {}


def test_no_speech_fails_with_its_own_words(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(json.dumps({"language": "en", "segments": []}).encode()))
    user = new_user(db, credits=5)
    job = new_job(db, storage, user, "transcribe-audio", AUDIO, {"format": "txt"}, quote=3)
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "NO_SPEECH")
    assert ledger(db, job) == ["reserve", "release"]
    assert storage.objects == {}


def test_without_a_gpu_backend_gpu_jobs_fail_at_once_with_credits_back(db: Conn) -> None:
    storage = FakeStorage()
    user = new_user(db, credits=5)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {}, quote=2)
    run = runner(storage, None)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "GPU_UNAVAILABLE")
    assert ledger(db, job) == ["reserve", "release"]
    assert row["gpu_seconds"] is None


def test_cancelling_the_job_cancels_the_gpu_call(db: Conn) -> None:
    storage = FakeStorage()

    def waits(call: GpuCall, store: FakeStorage) -> GpuResult:
        store.objects[key_of(call.kwargs["output_url"])] = (b"partial", "x")
        deadline = time.monotonic() + 10
        while not call.cancel.is_set() and time.monotonic() < deadline:
            call.on_wait(0.5)
            time.sleep(0.05)
        raise GpuCancelled(4.0)

    user = new_user(db, credits=5)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {}, quote=2)
    run = runner(storage, FakeGpu(storage, waits))
    claimed = claim_this(db, run, job)
    worker = threading.Thread(target=run.run, args=(claimed,))
    worker.start()
    time.sleep(0.3)
    # As the web's cancel does: the job ends and its credits come back in one go.
    with db.transaction():
        db.execute(
            "update jobs set status = 'cancelled', finished_at = now() where id = %s", (job,)
        )
        db.execute(
            "insert into credit_transactions (user_id, kind, amount, balance_after, job_id)"
            " values (%s, 'release', 2, 5, %s)",
            (user, job),
        )
        db.execute("update users set credit_balance = 5 where id = %s", (user,))
    worker.join(timeout=10)
    assert not worker.is_alive()
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "cancelled"
    assert float(row["gpu_seconds"]) == 4.0
    assert storage.objects == {}  # neither the input nor what the GPU wrote


def test_a_key_left_by_a_dead_attempt_is_deleted_before_the_next(db: Conn) -> None:
    storage = FakeStorage()
    user = new_user(db)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    stale = f"out/{uuid.uuid4()}"
    storage.objects[stale] = (b"from the worker that died", "x")
    db.execute("update jobs set output_key = %s where id = %s", (stale, job))
    run = runner(storage, FakeGpu(storage, writes(b"new")))
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded"
    assert stale not in storage.objects
    assert row["output_key"] != stale


class Outbox:
    """A notifier whose Telegram channel records messages instead of sending them."""

    def __init__(self, settings: Settings) -> None:
        self.sent: list[str] = []

        def record(_: Settings, text: str) -> None:
            self.sent.append(text)

        configured = settings.model_copy(
            update={"telegram_bot_token": "x", "telegram_chat_id": "-1"}
        )
        self.notifier = Notifier(configured, telegram=record)


def test_the_daily_budget_stops_gpu_jobs_and_alerts_once_at_80_and_100(
    db: Conn, settings: Settings
) -> None:
    before = one(db, "select daily_usd from gpu_budget where id = 1")["daily_usd"]
    user = new_user(db)
    storage = FakeStorage()
    gpu_job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    cpu_job = new_job(db, storage, user, "vfr-to-cfr", {}, {})
    db.execute("update jobs set gpu_rate_usd = null where id = %s", (cpu_job,))
    db.execute("update jobs set priority = 30 where id in (%s, %s)", (gpu_job, cpu_job))
    spent_job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    db.execute(
        "update jobs set status = 'succeeded', started_at = now(), finished_at = now(),"
        " gpu_cost_usd = 0.85, gpu_seconds = 100 where id = %s",
        (spent_job,),
    )
    spent = budget.state(db).spent_usd  # every GPU job today, this one's 0.85 included
    outbox = Outbox(settings)
    scheduler = Scheduler(settings, outbox.notifier, connect=lambda _s: connect_url(URL))
    try:
        # 85 % of the budget: GPU jobs still start, and one alert says so.
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (spent / 0.85,))
        assert budget.gpu_open(db)
        scheduler.check_alerts(db)
        scheduler.check_alerts(db)
        sent = [text for text in outbox.sent if "GPU" in text]
        assert len(sent) == 1
        assert "85 %" in sent[0]

        # At the budget: the GPU job waits, the CPU job behind it runs.
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (spent,))
        assert not budget.gpu_open(db)
        claimed = jobqueue.claim(db, "test-budget", gpu=budget.gpu_open(db))
        assert claimed is not None
        assert str(claimed["id"]) == cpu_job
        db.execute("update jobs set status = 'queued', worker_id = null where id = %s", (cpu_job,))
        db.execute("update jobs set priority = 0 where id = %s", (cpu_job,))
        assert one(db, "select status from jobs where id = %s", gpu_job)["status"] == "queued"
        scheduler.check_alerts(db)
        scheduler.check_alerts(db)
        sent = [text for text in outbox.sent if "GPU" in text]
        assert len(sent) == 2
        assert "GPU budget reached" in sent[1]
        assert "@" not in sent[1]

        # Raised in admin: it opens again at once.
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (spent * 2,))
        assert budget.gpu_open(db)
        claimed = jobqueue.claim(db, "test-budget", gpu=budget.gpu_open(db))
        assert claimed is not None
        assert str(claimed["id"]) == gpu_job
    finally:
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (before,))
        db.execute("update jobs set status = 'cancelled' where id in (%s, %s)", (gpu_job, cpu_job))
        day = budget.state(db).day.isoformat()
        db.execute(
            "delete from alerts where rule = 'gpu_budget' and subject like %s", (f"{day}/%",)
        )


def test_a_running_call_counts_against_the_budget_before_it_ends(db: Conn) -> None:
    storage = FakeStorage()
    user = new_user(db)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    before = budget.state(db).spent_usd
    db.execute(
        "update jobs set status = 'running', started_at = now() - interval '100 seconds'"
        " where id = %s",
        (job,),
    )
    try:
        assert budget.state(db).spent_usd == pytest.approx(before + 100 * RATE, abs=1e-3)
    finally:
        db.execute("update jobs set status = 'cancelled' where id = %s", (job,))
