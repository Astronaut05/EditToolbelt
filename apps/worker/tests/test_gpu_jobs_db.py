"""GPU jobs end to end against real Postgres, with stand-ins for storage and the GPU.

Runs when TEST_DATABASE_URL is set (migrated); no storage or GPU needed.
Each processor: presign -> call -> finish (output stored, GPU time and cost
on the job, credits captured, input deleted at once); a failure refunds;
a cancel cancels the call; and the daily budget stops GPU jobs from starting.
Then what happens around a call: GPU and CPU slots claim apart, a stopping
worker cancels its call and hands the job back, a dead worker's call is
cancelled by its id and its time counted, nothing a runaway call writes
outlives the sweeper, and concurrent claims never overshoot the budget.
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
from etb_worker.gpu import MAX_IDLE_TAIL_SEC, budget
from etb_worker.gpu.backend import (
    GpuBackend,
    GpuCall,
    GpuCancelled,
    GpuError,
    GpuResult,
    ModalGpu,
)
from etb_worker.notify import Notifier
from etb_worker.probe import probe_next
from etb_worker.processors import Estimate, JobContext, Output
from etb_worker.retention import sweep
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
        self.deleted: list[str] = []

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
        self.deleted.append(key)
        self.objects.pop(key, None)


def key_of(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


Behaviour = Callable[[GpuCall, FakeStorage], GpuResult]


class FakeGpu:
    """A backend whose 'function' is a Python callable that writes to FakeStorage."""

    name = "fake"

    def __init__(self, storage: FakeStorage, behaviour: Behaviour, *, cancels: bool = True) -> None:
        self.storage, self.behaviour = storage, behaviour
        self.calls: list[GpuCall] = []
        self.cancelled: list[str] = []
        self.cancels = cancels

    def run(self, call: GpuCall) -> GpuResult:
        self.calls.append(call)
        call.on_spawn(f"fc-fake-{len(self.calls)}")
        return self.behaviour(call, self.storage)

    def cancel(self, call_id: str) -> bool:
        self.cancelled.append(call_id)
        return self.cancels


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


@pytest.fixture(autouse=True)
def roomy_budget(db: Conn) -> Iterator[None]:
    """Today's spend by earlier tests (or runs, on a reused database) mustn't close the gate.

    The tests about the budget set their own, relative to what's committed already.
    """
    before = one(db, "select daily_usd from gpu_budget where id = 1")["daily_usd"]
    db.execute("update gpu_budget set daily_usd = 1000 where id = 1")
    yield
    db.execute("update gpu_budget set daily_usd = %s where id = 1", (before,))


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
        pool="gpu",
    )


def claim_this(db: Conn, run: JobRunner, job: str) -> jobqueue.Job:
    db.execute("update jobs set priority = 20 where id = %s", (job,))
    claimed = jobqueue.claim_gpu(db, run.worker_id)
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
        "max_pixels": 100 * 50,  # the probe's picture, priced: no bigger one is decoded
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
    assert gpu.calls[0].kwargs["options"] == {
        "language": "auto",
        "task": "transcribe",
        "max_seconds": 63.22,  # the probe's 61 s, 2 % and a second: no more is decoded
    }
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
    # It didn't say what it used, so its time is billed with the longest idle window.
    assert float(row["gpu_seconds"]) == 30.0
    assert float(row["gpu_cost_usd"]) == pytest.approx((30.0 + MAX_IDLE_TAIL_SEC) * RATE)
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
    # The call's key is remembered for the sweeper, and the call is no longer in flight.
    assert row["gpu_output_keys"] == [row["output_key"]]
    assert row["gpu_put_expires_at"] is not None
    assert (row["gpu_call_at"], row["gpu_call_id"]) == (None, None)


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
    today = budget.state(db).day.isoformat()
    # Another test's scheduler may have alerted today already (a reused database).
    db.execute("delete from alerts where rule = 'gpu_budget' and subject like %s", (f"{today}/%",))
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

        # At the budget: the GPU job waits, the CPU job beside it runs.
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (spent,))
        assert not budget.gpu_open(db)
        assert jobqueue.claim_gpu(db, "test-budget") is None
        claimed = jobqueue.claim(db, "test-budget")
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
        claimed = jobqueue.claim_gpu(db, "test-budget")
        assert claimed is not None
        assert str(claimed["id"]) == gpu_job
    finally:
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (before,))
        # Its spend mustn't count against later tests' budget (none of these has ledger rows).
        db.execute("delete from jobs where id in (%s, %s, %s)", (gpu_job, cpu_job, spent_job))
        db.execute(
            "delete from alerts where rule = 'gpu_budget' and subject like %s", (f"{today}/%",)
        )


def test_a_running_call_counts_against_the_budget_before_it_ends(db: Conn) -> None:
    storage = FakeStorage()
    user = new_user(db)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    before = budget.state(db)
    # A re-run job: its first call already cost 0.01, its second has run 100 s so far.
    db.execute(
        "update jobs set status = 'running', started_at = now() - interval '100 seconds',"
        " gpu_cost_usd = 0.01, gpu_call_at = now() - interval '100 seconds' where id = %s",
        (job,),
    )
    try:
        now = budget.state(db)
        assert now.spent_usd == pytest.approx(before.spent_usd + 0.01 + 100 * RATE, abs=1e-3)
        # The gate counts it at its worst case: its whole time limit and an idle window.
        worst = 0.01 + (900 + MAX_IDLE_TAIL_SEC) * RATE
        assert now.committed_usd == pytest.approx(before.committed_usd + worst, abs=1e-3)
    finally:
        db.execute("update jobs set status = 'cancelled' where id = %s", (job,))


# --- Around a call: slots, a stopping worker, a dead worker, the sweeper, the budget ---------


def wait_for(check: Callable[[], bool], seconds: float = 10) -> None:
    deadline = time.monotonic() + seconds
    while not check():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.05)


class CopyTool:
    """A CPU tool for the slot test: copies its input."""

    remote = False

    def __init__(self) -> None:
        self.tool_id = f"test-cpu-{uuid.uuid4().hex[:6]}"

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        return Estimate(seconds=1)

    def run(self, ctx: JobContext) -> Output:
        out = ctx.workdir / "out.bin"
        out.write_bytes(ctx.input_path.read_bytes())
        return Output(path=out, content_type="application/octet-stream", ext="bin")


def test_a_running_gpu_job_holds_up_neither_probing_nor_cpu_jobs(db: Conn) -> None:
    """Finding: GPU calls held the only slots. Now each pool claims only its own jobs."""
    storage = FakeStorage()
    user = new_user(db)
    release = threading.Event()

    def holds(call: GpuCall, store: FakeStorage) -> GpuResult:
        # An hour-long transcription, as far as the rest of the worker can tell.
        while not release.wait(0.05):
            call.on_wait(1.0)
        store.objects[key_of(call.kwargs["output_url"])] = (b"done", "x")
        return result()

    gpu_job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    waiting_gpu_job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    tool = CopyTool()
    cpu_job = new_job(db, storage, user, tool.tool_id, {}, {}, content=b"cpu input")
    db.execute("update jobs set gpu_rate_usd = null where id = %s", (cpu_job,))
    db.execute("update jobs set priority = 40 where id in (%s, %s)", (gpu_job, cpu_job))
    # A GPU job ahead of everything: a CPU slot must still leave it alone.
    db.execute("update jobs set priority = 50 where id = %s", (waiting_gpu_job,))
    upload_key = f"in/{uuid.uuid4()}"
    storage.objects[upload_key] = (b"just uploaded", "x")
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at)
        values (%s, %s, 13, 'audio/wav', 'transcribe-audio', 13, 1,
                now() + interval '1 hour', now() - interval '1 day')
        """,
        (user, upload_key),
    )
    gpu_slot = runner(storage, FakeGpu(storage, holds))
    cpu_slot = JobRunner(
        cast(Storage, storage),
        lambda: connect_url(URL),
        processors={tool.tool_id: tool},
        worker_id=f"test-cpu-{uuid.uuid4().hex[:6]}",
        heartbeat_sec=0.1,
    )
    db.execute("update jobs set priority = 0 where id = %s", (waiting_gpu_job,))
    gpu_thread = threading.Thread(target=gpu_slot.run_next)
    gpu_thread.start()
    try:
        wait_for(
            lambda: one(db, "select status from jobs where id = %s", gpu_job)["status"] == "running"
        )
        db.execute("update jobs set priority = 50 where id = %s", (waiting_gpu_job,))

        # While the GPU call runs: the upload is probed, and the CPU job runs to the end.
        wanted = {
            "format": {"format_name": "wav", "duration": "1.0"},
            "streams": [{"codec_type": "audio", "codec_name": "pcm_s16le"}],
        }
        while probe_next(db, cast(Storage, storage), probe=lambda _path: wanted):
            pass
        probed = one(db, "select probed_at, probe from uploads where storage_key = %s", upload_key)
        assert probed["probed_at"] is not None
        assert probed["probe"]["container"] == "wav"
        assert cpu_slot.run_next()
        cpu_row = one(db, "select status, worker_id from jobs where id = %s", cpu_job)
        assert cpu_row["status"] == "succeeded"
        assert cpu_row["worker_id"] == cpu_slot.worker_id
        # The CPU slot never took the GPU job waiting ahead of it.
        assert one(db, "select status from jobs where id = %s", waiting_gpu_job)["status"] == (
            "queued"
        )
    finally:
        release.set()
        gpu_thread.join(timeout=10)
    assert not gpu_thread.is_alive()
    assert one(db, "select status from jobs where id = %s", gpu_job)["status"] == "succeeded"
    db.execute("update jobs set status = 'cancelled' where id = %s", (waiting_gpu_job,))


def test_a_gpu_slot_never_takes_a_cpu_job(db: Conn) -> None:
    storage = FakeStorage()
    user = new_user(db)
    tool = CopyTool()
    cpu_job = new_job(db, storage, user, tool.tool_id, {}, {})
    db.execute("update jobs set gpu_rate_usd = null, priority = 60 where id = %s", (cpu_job,))
    assert budget.gpu_open(db)
    try:
        taken = jobqueue.claim_gpu(db, "test-gpu-only")
        if taken is not None:  # another test's leftover GPU job, never ours
            db.execute("update jobs set status = 'cancelled' where id = %s", (taken["id"],))
        assert taken is None or str(taken["id"]) != cpu_job
        assert one(db, "select status from jobs where id = %s", cpu_job)["status"] == "queued"
    finally:
        db.execute("update jobs set status = 'cancelled' where id = %s", (cpu_job,))


class ModalStandIn:
    """Modal's Function and FunctionCall: the call runs until it's cancelled."""

    object_id = "fc-stand-in"

    def __init__(self) -> None:
        self.spawned: list[dict[str, Any]] = []
        self.cancelled = threading.Event()

    def spawn(self, **kwargs: Any) -> ModalStandIn:
        self.spawned.append(kwargs)
        return self

    def get(self, timeout: float) -> Any:
        time.sleep(timeout)
        raise TimeoutError

    def cancel(self) -> None:
        self.cancelled.set()


def test_a_stopping_worker_cancels_its_call_records_it_and_hands_the_job_back(db: Conn) -> None:
    storage = FakeStorage()
    modal = ModalStandIn()
    gpu = ModalGpu(lookup=lambda _app, _fn: modal, poll_sec=0.05)
    user = new_user(db, credits=5)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {}, quote=2)
    input_key = one(db, "select input_key from jobs where id = %s", job)["input_key"]
    run = runner(storage, gpu)
    worker = threading.Thread(target=run.run, args=(claim_this(db, run, job),))
    worker.start()
    # The call's id is on the job while it runs, so a reaper could cancel it.
    wait_for(
        lambda: (
            one(db, "select gpu_call_id from jobs where id = %s", job)["gpu_call_id"]
            == "fc-stand-in"
        )
    )
    time.sleep(0.3)
    run.stop_current()  # SIGTERM: main() does this for every slot
    worker.join(timeout=10)
    assert not worker.is_alive()
    assert modal.cancelled.is_set()

    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["worker_id"], row["attempts"]) == ("queued", None, 1)
    assert (row["gpu_call_at"], row["gpu_call_id"]) == (None, None)
    used = float(row["gpu_seconds"])
    assert used > 0.2
    assert float(row["gpu_cost_usd"]) == pytest.approx((used + MAX_IDLE_TAIL_SEC) * RATE, rel=0.01)
    # Handed back, not finished: the input stays for the next attempt, the credits stay reserved.
    assert input_key in storage.objects
    assert ledger(db, job) == ["reserve"]
    # The key the call could write to is deleted, and remembered for the sweeper.
    assert row["output_key"] in storage.deleted
    assert row["gpu_output_keys"] == [row["output_key"]]
    db.execute("update jobs set status = 'cancelled' where id = %s", (job,))


def dead_worker_call(db: Conn, job: str, *, seconds_ago: int, attempts: int = 1) -> str:
    """The job as a worker that died mid-call leaves it: running, silent, its call in flight."""
    key = f"out/{uuid.uuid4()}"
    db.execute(
        """
        update jobs set status = 'running', worker_id = 'dead-worker', attempts = %s,
               started_at = now() - make_interval(secs => %s),
               heartbeat_at = now() - interval '2 minutes',
               gpu_call_at = now() - make_interval(secs => %s), gpu_call_id = 'fc-orphan',
               output_key = %s, gpu_output_keys = array[%s],
               gpu_put_expires_at = now() + interval '80 minutes'
        where id = %s
        """,
        (attempts, seconds_ago, seconds_ago, key, key, job),
    )
    return key


def test_a_dead_workers_call_is_cancelled_by_its_id_and_its_time_counted(
    db: Conn, settings: Settings
) -> None:
    storage = FakeStorage()
    user = new_user(db, credits=5)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {}, quote=2)
    dead_worker_call(db, job, seconds_ago=100)
    gpu = FakeGpu(storage, writes(b"unused"))
    scheduler = Scheduler(
        settings, Outbox(settings).notifier, connect=lambda _s: connect_url(URL), gpu=gpu
    )
    scheduler.maintain(db)

    assert "fc-orphan" in gpu.cancelled
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["worker_id"]) == ("queued", None)
    assert (row["gpu_call_at"], row["gpu_call_id"]) == (None, None)
    assert float(row["gpu_seconds"]) == pytest.approx(100, abs=2)
    assert float(row["gpu_cost_usd"]) == pytest.approx((100 + MAX_IDLE_TAIL_SEC) * RATE, abs=1e-3)
    # The dead worker, had it only been slow, can't count the same call twice.
    assert not jobqueue.record_gpu(db, job, "dead-worker", 50, 60)
    assert float(one(db, "select gpu_cost_usd from jobs where id = %s", job)["gpu_cost_usd"]) == (
        pytest.approx((100 + MAX_IDLE_TAIL_SEC) * RATE, abs=1e-3)
    )
    db.execute("update jobs set status = 'cancelled' where id = %s", (job,))


def test_a_call_that_cant_be_cancelled_counts_to_its_limit_and_alerts(
    db: Conn, settings: Settings
) -> None:
    storage = FakeStorage()
    user = new_user(db, credits=5)
    job = new_job(db, storage, user, "transcribe-audio", AUDIO, {}, quote=2)
    dead_worker_call(db, job, seconds_ago=100, attempts=3)
    db.execute("delete from alerts where rule = 'gpu_call_not_cancelled'")
    outbox = Outbox(settings)
    gpu = FakeGpu(storage, writes(b"unused"), cancels=False)
    scheduler = Scheduler(settings, outbox.notifier, connect=lambda _s: connect_url(URL), gpu=gpu)
    scheduler.maintain(db)

    row = one(db, "select * from jobs where id = %s", job)
    # The third time its worker was lost: failed for good, credits back.
    assert (row["status"], row["error_code"]) == ("failed", "WORKER_LOST")
    assert ledger(db, job) == ["reserve", "release"]
    # It may run on until the job's limit (900 s here): that's what the budget counts.
    assert float(row["gpu_cost_usd"]) == pytest.approx((900 + MAX_IDLE_TAIL_SEC) * RATE, abs=1e-3)
    sent = [text for text in outbox.sent if "fc-orphan" in text]
    assert len(sent) == 1
    assert "couldn't be cancelled" in sent[0]
    db.execute("delete from alerts where rule = 'gpu_call_not_cancelled'")


def test_a_dead_workers_call_on_a_job_cancelled_meanwhile_is_cancelled_too(
    db: Conn, settings: Settings
) -> None:
    storage = FakeStorage()
    user = new_user(db)
    job = new_job(db, storage, user, "transcribe-audio", AUDIO, {})
    dead_worker_call(db, job, seconds_ago=40)
    # Its owner cancels it while its worker is dead: no worker will settle the call.
    db.execute("update jobs set status = 'cancelled', finished_at = now() where id = %s", (job,))
    gpu = FakeGpu(storage, writes(b"unused"))
    Scheduler(
        settings, Outbox(settings).notifier, connect=lambda _s: connect_url(URL), gpu=gpu
    ).maintain(db)
    assert "fc-orphan" in gpu.cancelled
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["gpu_call_at"], row["gpu_call_id"]) == ("cancelled", None, None)
    assert float(row["gpu_cost_usd"]) == pytest.approx((40 + MAX_IDLE_TAIL_SEC) * RATE, abs=1e-3)


def test_a_call_left_in_flight_is_settled_and_cancelled_before_the_next_attempt(
    db: Conn,
) -> None:
    storage = FakeStorage()
    user = new_user(db)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    stale_key = dead_worker_call(db, job, seconds_ago=50)
    # Requeued without being settled (as an admin's retry would): the next attempt does it.
    db.execute(
        "update jobs set status = 'queued', worker_id = null, heartbeat_at = null where id = %s",
        (job,),
    )
    gpu = FakeGpu(storage, writes(b"PNG"))
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))
    assert gpu.cancelled == ["fc-orphan"]
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded"
    # 50 s of the old call (plus an idle window) and the new call's 22 billed seconds.
    expected = (50 + MAX_IDLE_TAIL_SEC + 22) * RATE
    assert float(row["gpu_cost_usd"]) == pytest.approx(expected, abs=1e-3)
    assert row["gpu_output_keys"] == [stale_key, row["output_key"]]


class Swept:
    """FakeStorage as the sweeper sees it (nothing to list)."""

    def __init__(self, store: FakeStorage) -> None:
        self.store = store

    def delete(self, key: str) -> None:
        self.store.delete(key)

    def abort_upload(self, key: str, upload_id: str) -> None:
        return None

    def open_uploads(self) -> list[Any]:
        return []

    def objects(self) -> list[Any]:
        return []


def test_nothing_a_runaway_call_writes_outlives_the_sweeper(db: Conn, settings: Settings) -> None:
    """Finding: a dead worker's call wrote its output after the key was forgotten."""
    storage = FakeStorage()
    swept = cast(Storage, Swept(storage))
    user = new_user(db)
    job = new_job(db, storage, user, "upscale-image", IMAGE, {})
    orphan_key = dead_worker_call(db, job, seconds_ago=30)
    # The reaper hands the job back; the call couldn't be cancelled (Modal didn't answer).
    scheduler = Scheduler(
        settings,
        Outbox(settings).notifier,
        connect=lambda _s: connect_url(URL),
        gpu=FakeGpu(storage, writes(b""), cancels=False),
    )
    scheduler.maintain(db)
    # The next attempt finishes the job.
    run = runner(storage, FakeGpu(storage, writes(b"the result")))
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded"
    live = row["output_key"]
    assert row["gpu_output_keys"] == [orphan_key, live]

    # Later, the runaway call writes its whole result to the key it was given.
    storage.objects[orphan_key] = (b"the person's transcript", "x")
    sweep(db, swept)
    assert orphan_key not in storage.objects
    assert storage.objects[live][0] == b"the result"  # the real output keeps its hour
    # And again, until its URL has expired: each pass deletes it.
    storage.objects[orphan_key] = (b"a retry of the PUT", "x")
    sweep(db, swept)
    assert orphan_key not in storage.objects

    # Once every URL has expired nothing can write any more: the keys are forgotten.
    db.execute(
        "update jobs set gpu_put_expires_at = now() - interval '1 minute' where id = %s", (job,)
    )
    sweep(db, swept)
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["gpu_output_keys"], row["gpu_put_expires_at"]) == ([], None)
    assert storage.objects[live][0] == b"the result"
    db.execute("update jobs set output_key = null where id = %s", (job,))
    db.execute("delete from alerts where rule = 'gpu_call_not_cancelled'")


def test_concurrent_gpu_claims_never_overshoot_the_budget(db: Conn) -> None:
    """Finding: every slot could start a job just under the line. Now claims take turns."""
    before = one(db, "select daily_usd from gpu_budget where id = 1")["daily_usd"]
    storage = FakeStorage()
    user = new_user(db)
    jobs = [new_job(db, storage, user, "upscale-image", IMAGE, {}) for _ in range(6)]
    db.execute("update jobs set priority = 70 where id = any(%s::uuid[])", (jobs,))
    # Room for exactly one more job at its worst case (900 s and an idle window at RATE).
    committed = budget.state(db).committed_usd
    db.execute("update gpu_budget set daily_usd = %s where id = 1", (committed + 0.01,))
    start = threading.Barrier(len(jobs))
    claimed: list[str] = []
    lock = threading.Lock()

    def claimer(n: int) -> None:
        with connect_url(URL) as conn:
            start.wait()
            job = jobqueue.claim_gpu(conn, f"race-{n}")
        if job is not None:
            with lock:
                claimed.append(str(job["id"]))

    threads = [threading.Thread(target=claimer, args=(n,)) for n in range(len(jobs))]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        assert len(claimed) == 1
        assert claimed[0] in jobs
        assert not budget.gpu_open(db)
        # The running job finishing (and its real, small cost) opens the gate again.
        db.execute(
            "update jobs set status = 'succeeded', finished_at = now(), gpu_cost_usd = 0.001"
            " where id = %s",
            (claimed[0],),
        )
        assert budget.gpu_open(db)
    finally:
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (before,))
        db.execute("delete from jobs where id = any(%s::uuid[])", (jobs,))
