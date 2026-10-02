"""The Wave 3 GPU tools end to end against real Postgres, with stand-ins for storage and the GPU.

Runs when TEST_DATABASE_URL is set (migrated). Object Eraser's mask goes to
the GPU beside the photo and both are deleted when the job ends; a video
job's GPU time lands on the job; a refusal before the GPU, or a failure on
it, gives the credits back.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from psycopg.types.json import Jsonb

from etb_worker.db import Conn, connect_url
from etb_worker.gpu.backend import GpuCall, GpuError, GpuResult
from tests.test_gpu_jobs_db import (
    RATE,
    URL,
    FakeGpu,
    FakeStorage,
    claim_this,
    key_of,
    ledger,
    new_job,
    new_user,
    one,
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
