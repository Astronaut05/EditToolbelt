"""The Wave 3 GPU tools end to end against real Postgres, with stand-ins for storage and the GPU.

Runs when TEST_DATABASE_URL is set (migrated). Object Eraser's mask goes to
the GPU beside the photo and both are deleted when the job ends; a video
job's GPU time lands on the job; a refusal before the GPU, or a failure on
it, gives the credits back. And the M5 review's fixes hold for these tools
too: each call is on its job while it runs (its id, its output key, swept
until its URL expires), a dead worker's call is cancelled by its id and
counted, and the budget gate counts a running job at its worst case, which
for a video job is more than the default budget.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from psycopg.types.json import Jsonb

from etb_worker import jobqueue
from etb_worker.db import Conn, connect_url
from etb_worker.gpu import MAX_IDLE_TAIL_SEC, budget, modal_app
from etb_worker.gpu.backend import GpuCall, GpuError, GpuResult
from etb_worker.processors.remote import PRESIGN_MARGIN_SEC
from etb_worker.scheduler import Scheduler
from etb_worker.settings import Settings
from tests.test_gpu_consistency import ROOT, TOOLS, _rate
from tests.test_gpu_jobs_db import (
    RATE,
    URL,
    FakeGpu,
    FakeStorage,
    Outbox,
    claim_this,
    dead_worker_call,
    key_of,
    ledger,
    new_job,
    new_user,
    one,
    result,
    roomy_budget,  # noqa: F401 - autouse: earlier spend mustn't close the gate here either
    runner,
    writes,
)

pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture
def db() -> Iterator[Conn]:
    with connect_url(URL) as conn:
        yield conn


PHOTO = {"video": {"width": 1200, "height": 800, "codec": "mjpeg"}, "duration_ms": 0}
MASK = {"video": {"width": 1200, "height": 800, "codec": "png"}, "duration_ms": 0}
CLIP: dict[str, Any] = {
    "duration_ms": 20_000,
    "video": {"width": 1280, "height": 720, "fps": 30, "rotation": 0},
    "audio": {"codec": "aac"},
}


def with_mask(db: Conn, storage: FakeStorage, job: str) -> str:
    key = f"in/{uuid.uuid4()}"
    storage.objects[key] = (b"mask png", "image/png")
    db.execute(
        "update jobs set extra_input_keys = %s, input_meta = input_meta || %s where id = %s",
        ([key], Jsonb({"extras": [MASK]}), job),
    )
    return key


def test_the_eraser_gets_the_photo_and_the_mask_and_both_go_after(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(b"PNG" * 50, width=1200, height=800, regions=1))
    user = new_user(db, credits=10)
    job = new_job(db, storage, user, "object-eraser", PHOTO, {"format": "png"}, quote=3)
    mask = with_mask(db, storage, job)
    photo = one(db, "select input_key from jobs where id = %s", job)["input_key"]
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded", row["error_detail"]
    call = gpu.calls[0]
    assert call.function == "erase_object"
    assert key_of(call.kwargs["input_url"]) == photo
    assert [key_of(url) for url in call.kwargs["extra_urls"]] == [mask]
    assert row["output_meta"]["content_type"] == "image/png"
    assert (row["output_meta"]["width"], row["output_meta"]["height"]) == (1200, 800)
    # The photo and the mask went the moment the job ended; only the result is left.
    assert list(storage.objects) == [row["output_key"]]
    assert row["extra_input_keys"] == []
    assert ledger(db, job) == ["reserve", "capture"]
    assert float(row["gpu_cost_usd"]) == pytest.approx(22.0 * RATE)


def test_an_empty_mask_fails_on_the_gpu_and_the_credits_come_back(db: Conn) -> None:
    storage = FakeStorage()

    def empty(call: GpuCall, store: FakeStorage) -> GpuResult:
        raise GpuError("EMPTY_MASK", "The mask marks nothing to erase.", gpu_seconds=3.0)

    user = new_user(db, credits=5)
    job = new_job(db, storage, user, "object-eraser", PHOTO, {}, quote=3)
    with_mask(db, storage, job)
    run = runner(storage, FakeGpu(storage, empty))
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "EMPTY_MASK")
    assert row["error_detail"] == "The mask marks nothing to erase."
    assert ledger(db, job) == ["reserve", "release"]
    assert storage.objects == {}


def test_a_video_upscale_records_its_gpu_time(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(b"MP4" * 100, width=2560, height=1440, frames=600))
    user = new_user(db, credits=20)
    job = new_job(db, storage, user, "upscale-video", CLIP, {"scale": "2"}, quote=10)
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded", row["error_detail"]
    assert gpu.calls[0].kwargs["options"] == {"scale": 2, "model": "general", "denoise": 0.5}
    assert row["output_meta"]["ext"] == "mp4"
    assert float(row["gpu_seconds"]) == 12.0
    assert ledger(db, job) == ["reserve", "capture"]


def test_prores_too_big_for_one_upload_is_refused_before_the_gpu(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(b"never"))
    user = new_user(db, credits=50)
    long = {
        **CLIP,
        "duration_ms": 240_000,
        "video": {**CLIP["video"], "width": 1920, "height": 1080},
    }
    job = new_job(
        db, storage, user, "video-background-remover", long, {"output": "prores"}, quote=32
    )
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "TOO_LARGE")
    assert "Pick WebM or a green screen" in row["error_detail"]
    assert gpu.calls == []
    assert row["gpu_seconds"] is None
    assert ledger(db, job) == ["reserve", "release"]


def test_a_background_removal_on_green_is_an_mp4(db: Conn) -> None:
    storage = FakeStorage()
    gpu = FakeGpu(storage, writes(b"MP4", width=1280, height=720, frames=600))
    user = new_user(db, credits=20)
    job = new_job(db, storage, user, "video-background-remover", CLIP, {"output": "green"}, quote=8)
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded", row["error_detail"]
    assert row["output_meta"]["content_type"] == "video/mp4"
    assert storage.objects[row["output_key"]][0] == b"MP4"


# --- The M5 review's fixes, for the Wave 3 tools ---------------------------------------

#: Each tool with an input it takes.
WAVE3: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {
    "object-eraser": (PHOTO, {"format": "png"}),
    "upscale-video": (CLIP, {"scale": "2"}),
    "video-background-remover": (CLIP, {"output": "webm"}),
}


def limit_of(tool: str) -> int:
    """The tool's job time limit in seconds (registry limits.server.timeoutSec)."""
    category, _function = TOOLS[tool]
    source = (ROOT / f"packages/registry/src/tools/{category}/{tool}.ts").read_text("utf-8")
    found = re.search(r"timeoutSec: (\d+) \* 60", source)
    assert found, tool
    return int(found.group(1)) * 60


def rate_of(tool: str) -> float:
    """What the web writes on the tool's jobs (config/business.ts -> gpuRateUsd)."""
    business = (ROOT / "config/business.ts").read_text("utf-8")
    return _rate(business, modal_app.SPECS[TOOLS[tool][1]].gpu)


def wave3_job(db: Conn, storage: FakeStorage, tool: str, *, quote: int = 0) -> str:
    """A queued job of the tool as the web makes it: its own time limit and GPU rate."""
    meta, options = WAVE3[tool]
    job = new_job(db, storage, new_user(db, credits=quote), tool, meta, options, quote=quote)
    db.execute(
        "update jobs set timeout_sec = %s, gpu_rate_usd = %s where id = %s",
        (limit_of(tool), rate_of(tool), job),
    )
    if tool == "object-eraser":
        with_mask(db, storage, job)
    return job


@pytest.mark.parametrize("tool", sorted(WAVE3))
def test_each_wave3_call_is_on_its_job_while_it_runs(db: Conn, tool: str) -> None:
    storage = FakeStorage()
    job = wave3_job(db, storage, tool, quote=10)
    seen: dict[str, Any] = {}

    def look(call: GpuCall, store: FakeStorage) -> GpuResult:
        # What a reaper or the sweeper would find if this worker died now.
        with connect_url(URL) as other:
            seen.update(
                one(
                    other,
                    "select output_key, gpu_output_keys, gpu_call_id, gpu_call_at,"
                    " extract(epoch from gpu_put_expires_at - now())::float8 as expires_in"
                    " from jobs where id = %s",
                    job,
                )
            )
        store.objects[key_of(call.kwargs["output_url"])] = (b"result", "set by the PUT")
        return result()

    gpu = FakeGpu(storage, look)
    run = runner(storage, gpu)
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded", row["error_detail"]
    put_key = key_of(gpu.calls[0].kwargs["output_url"])
    assert seen["gpu_call_id"] == "fc-fake-1"
    assert seen["gpu_call_at"] is not None
    assert (seen["output_key"], seen["gpu_output_keys"]) == (put_key, [put_key])
    # The URL lives for the job's limit plus the margin; the sweeper deletes the key till then.
    assert seen["expires_in"] == pytest.approx(limit_of(tool) + PRESIGN_MARGIN_SEC, abs=30)
    # Once the call is billed it's no longer in flight; its key stays known to the sweeper.
    assert (row["gpu_call_at"], row["gpu_call_id"]) == (None, None)
    assert (row["output_key"], row["gpu_output_keys"]) == (put_key, [put_key])
    assert float(row["gpu_seconds"]) == 12.0
    assert float(row["gpu_cost_usd"]) == pytest.approx(22.0 * rate_of(tool), abs=1e-6)


@pytest.mark.parametrize("tool", sorted(WAVE3))
def test_a_dead_workers_wave3_call_is_cancelled_by_its_id_and_counted(
    db: Conn, settings: Settings, tool: str
) -> None:
    storage = FakeStorage()
    job = wave3_job(db, storage, tool)
    dead_worker_call(db, job, seconds_ago=100)
    gpu = FakeGpu(storage, writes(b"unused"))
    Scheduler(
        settings, Outbox(settings).notifier, connect=lambda _s: connect_url(URL), gpu=gpu
    ).maintain(db)
    assert gpu.cancelled == ["fc-orphan"]
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["gpu_call_at"], row["gpu_call_id"]) == ("queued", None, None)
    assert float(row["gpu_cost_usd"]) == pytest.approx(
        (100 + MAX_IDLE_TAIL_SEC) * rate_of(tool), abs=1e-3
    )
    db.execute("update jobs set status = 'cancelled' where id = %s", (job,))


def test_a_running_video_job_counts_its_whole_limit_and_starts_nothing_else(db: Conn) -> None:
    """At the default $1 a day a video job's worst case (95 min on an L4) is the whole budget.

    It starts like any GPU job, while today's committed spend is under the
    budget; while it runs no other GPU job starts. The eraser's worst case is
    small enough that several fit (docs/05 -> GPU costs and the daily budget).
    """
    before = one(db, "select daily_usd from gpu_budget where id = 1")["daily_usd"]
    storage = FakeStorage()
    video = wave3_job(db, storage, "upscale-video")
    eraser = wave3_job(db, storage, "object-eraser")
    other = wave3_job(db, storage, "object-eraser")
    jobs = [video, eraser, other]
    db.execute("update jobs set priority = 60 where id = any(%s::uuid[])", (jobs,))
    db.execute("update jobs set priority = 61 where id = %s", (video,))
    committed = budget.state(db).committed_usd
    # $1 of room today, as on a fresh day with the default budget.
    db.execute("update gpu_budget set daily_usd = %s where id = 1", (committed + 1,))
    try:
        claimed = jobqueue.claim_gpu(db, "test-worst-case")
        assert claimed is not None
        assert str(claimed["id"]) == video
        worst = (limit_of("upscale-video") + MAX_IDLE_TAIL_SEC) * rate_of("upscale-video")
        assert worst == pytest.approx(1.52, abs=0.01)
        assert budget.state(db).committed_usd == pytest.approx(committed + worst, abs=1e-3)
        assert jobqueue.claim_gpu(db, "test-worst-case") is None

        # It ends (its real cost is small): the erasers start, two of them at their worst case.
        db.execute(
            "update jobs set status = 'succeeded', finished_at = now(), gpu_cost_usd = 0.01"
            " where id = %s",
            (video,),
        )
        erasers = [jobqueue.claim_gpu(db, "test-worst-case") for _ in range(2)]
        assert {str(job["id"]) for job in erasers if job is not None} == {eraser, other}
        eraser_worst = (limit_of("object-eraser") + MAX_IDLE_TAIL_SEC) * rate_of("object-eraser")
        assert eraser_worst == pytest.approx(0.13, abs=0.01)
        assert budget.state(db).committed_usd == pytest.approx(
            committed + 0.01 + 2 * eraser_worst, abs=1e-3
        )
    finally:
        db.execute("update gpu_budget set daily_usd = %s where id = 1", (before,))
        db.execute("delete from jobs where id = any(%s::uuid[])", (jobs,))
