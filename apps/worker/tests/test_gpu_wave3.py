"""The Wave 3 GPU processors (P17, V20, V21) with a stand-in GPU and storage, no database.

Each one: refuses what it can't do before any GPU time, sends the function
the options it reads (and Object Eraser its mask), and finishes with the
output the GPU stored. A failing or cancelled call deletes what it wrote.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

import pytest

from etb_worker.gpu import MAX_IDLE_TAIL_SEC
from etb_worker.gpu.backend import GpuCall, GpuCancelled, GpuError, GpuResult
from etb_worker.processors import (
    PROCESSORS,
    GpuUsage,
    JobContext,
    JobFailed,
    Output,
    object_eraser,
    upscale_video,
    video_background,
)
from etb_worker.processors.remote import PRESIGN_MARGIN_SEC
from etb_worker.sandbox import Limits, ToolError
from etb_worker.storage import Storage


class Bucket:
    """Storage as a dict; presigned URLs name their key."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.signed: list[tuple[str, str, str]] = []

    def presign_get(self, key: str, expires_sec: int) -> str:
        self.signed.append(("GET", key, ""))
        return f"https://storage.test/{key}?get"

    def presign_put(self, key: str, content_type: str, expires_sec: int) -> str:
        self.signed.append(("PUT", key, content_type))
        return f"https://storage.test/{key}?put"

    def size(self, key: str) -> int | None:
        return len(self.objects[key]) if key in self.objects else None

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


def key_of(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


class Gpu:
    """Writes ``content`` to the output URL and answers ``meta``, or fails as told."""

    name = "fake"

    def __init__(
        self, bucket: Bucket, content: bytes = b"out", fail: Exception | None = None, **meta: Any
    ) -> None:
        self.bucket, self.content, self.fail, self.meta = bucket, content, fail, meta
        self.calls: list[GpuCall] = []

    def run(self, call: GpuCall) -> GpuResult:
        self.calls.append(call)
        call.on_spawn(f"fc-{len(self.calls)}")
        call.on_wait(1.0)
        self.bucket.objects[key_of(call.kwargs["output_url"])] = self.content
        if self.fail:
            raise self.fail
        return GpuResult(
            meta=self.meta,
            notes=["a note"],
            gpu="L4",
            gpu_seconds=5.0,
            billed_seconds=15.0,
            wall_seconds=6.0,
        )

    def cancel(self, call_id: str) -> bool:
        return True


def context(
    tool: str,
    meta: dict[str, Any],
    options: dict[str, Any],
    gpu: Gpu,
    *,
    extras: list[str] | None = None,
) -> tuple[JobContext, list[GpuUsage]]:
    used: list[GpuUsage] = []
    ctx = JobContext(
        job_id="job",
        tool_id=tool,
        input_path=Path("/nonexistent/input"),
        workdir=Path("/nonexistent"),
        options=options,
        meta=meta,
        limits=Limits(timeout_sec=60),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
        input_key="in/photo",
        storage=cast(Storage, gpu.bucket),
        gpu=gpu,
        record_gpu=used.append,
        extra_input_keys=extras or [],
    )
    return ctx, used


PHOTO = {"video": {"width": 4000, "height": 3000, "codec": "mjpeg"}, "duration_ms": 0}
MASK = {"video": {"width": 2000, "height": 1500, "codec": "png"}, "duration_ms": 0}


def clip(
    width: int, height: int, seconds: float, fps: float = 30.0, **video: Any
) -> dict[str, Any]:
    return {
        "duration_ms": round(seconds * 1000),
        "video": {"width": width, "height": height, "fps": fps, **video},
        "audio": {"codec": "aac"},
    }


def test_the_three_tools_are_remote_processors() -> None:
    for tool in ("object-eraser", "upscale-video", "video-background-remover"):
        assert getattr(PROCESSORS[tool], "remote", False), tool


#: Each Wave 3 tool with an input it takes, and the GPU function it calls.
RUNS: list[tuple[str, dict[str, Any], dict[str, Any], list[str], str]] = [
    ("object-eraser", {**PHOTO, "extras": [MASK]}, {}, ["in/mask"], "erase_object"),
    ("upscale-video", clip(1280, 720, 20), {"scale": "2"}, [], "upscale_video"),
    (
        "video-background-remover",
        clip(1280, 720, 20),
        {"output": "webm"},
        [],
        "remove_video_background",
    ),
]


@pytest.mark.parametrize(("tool", "meta", "options", "extras", "function"), RUNS)
def test_each_call_is_on_its_job_before_it_starts_and_billed_after(
    tool: str, meta: dict[str, Any], options: dict[str, Any], extras: list[str], function: str
) -> None:
    """As for P08, A12 and V17 (remote.run_on_gpu): the review fixes of #66 cover these too.

    Before the URLs leave the worker, the call and the key it may write to go
    on the job (start_call: the job's output and its GPU keys, swept until
    the URL expires); the backend's id as soon as the call exists
    (call_spawned: a dead worker's call is cancelled by it); and the call's
    billed time once it ends (record_gpu).
    """
    gpu = Gpu(Bucket(), width=1280, height=720)
    ctx, _ = context(tool, meta, options, gpu, extras=extras)
    events: list[tuple[Any, ...]] = []

    def start_call(key: str, expires: int) -> bool:
        events.append(("start", key, expires, len(gpu.calls)))
        return True

    ctx.start_call = start_call
    ctx.call_spawned = lambda call_id: events.append(("spawned", call_id))
    ctx.record_gpu = lambda usage: events.append(("used", usage))
    out = PROCESSORS[tool].run(ctx)
    assert gpu.calls[0].function == function
    assert events == [
        ("start", out.key, 60 + PRESIGN_MARGIN_SEC, 0),
        ("spawned", "fc-1"),
        ("used", GpuUsage(5.0, 15.0)),
    ]
    assert key_of(gpu.calls[0].kwargs["output_url"]) == out.key


@pytest.mark.parametrize(("tool", "meta", "options", "extras", "function"), RUNS)
def test_a_job_no_longer_ours_starts_no_call(
    tool: str, meta: dict[str, Any], options: dict[str, Any], extras: list[str], function: str
) -> None:
    """Cancelled, or taken by the reaper, between the claim and the call: nothing runs."""
    gpu = Gpu(Bucket())
    ctx, used = context(tool, meta, options, gpu, extras=extras)
    ctx.start_call = lambda _key, _expires: False
    with pytest.raises(ToolError) as caught:
        PROCESSORS[tool].run(ctx)
    assert caught.value.code == "CANCELLED"
    assert gpu.calls == []
    assert used == []


# --- P17 Object Eraser -----------------------------------------------------------


def test_the_eraser_sends_the_photo_and_its_mask() -> None:
    bucket = Bucket()
    gpu = Gpu(bucket, b"PNG" * 10, width=4000, height=3000)
    ctx, used = context(
        "object-eraser", {**PHOTO, "extras": [MASK]}, {"format": "png"}, gpu, extras=["in/mask"]
    )
    out = object_eraser.PROCESSOR.run(ctx)
    call = gpu.calls[0]
    assert call.function == "erase_object"
    # The photo's pixels as probed and priced: the function decodes no bigger picture.
    assert call.kwargs["options"] == {"format": "png", "max_pixels": 4000 * 3000}
    assert key_of(call.kwargs["input_url"]) == "in/photo"
    assert [key_of(url) for url in call.kwargs["extra_urls"]] == ["in/mask"]
    assert out == Output(
        path=None,
        key=out.key,
        bytes=30,
        content_type="image/png",
        ext="png",
        meta={"width": 4000, "height": 3000, "notes": ["a note"]},
    )
    assert used == [GpuUsage(5.0, 15.0)]


def test_a_jpeg_keeps_its_format_and_a_strange_one_becomes_png() -> None:
    bucket = Bucket()
    ctx, _ = context("object-eraser", PHOTO, {"format": "jpg"}, Gpu(bucket), extras=["in/mask"])
    assert object_eraser.PROCESSOR.run(ctx).content_type == "image/jpeg"
    ctx, _ = context("object-eraser", PHOTO, {"format": "tiff"}, Gpu(bucket), extras=["in/mask"])
    assert object_eraser.PROCESSOR.run(ctx).ext == "png"


@pytest.mark.parametrize(
    ("extras", "mask", "code"),
    [
        ([], None, "BAD_MASK"),
        (["in/mask"], {"video": {"width": 1000, "height": 1000}}, "BAD_MASK"),
    ],
)
def test_the_eraser_refuses_a_missing_or_misshapen_mask_before_the_gpu(
    extras: list[str], mask: dict[str, Any] | None, code: str
) -> None:
    gpu = Gpu(Bucket())
    meta = {**PHOTO, "extras": [mask]} if mask else PHOTO
    ctx, _ = context("object-eraser", meta, {}, gpu, extras=extras)
    with pytest.raises(JobFailed) as caught:
        object_eraser.PROCESSOR.run(ctx)
    assert caught.value.code == code
    assert gpu.calls == []


def test_a_mask_drawn_on_the_upright_photo_fits_a_turned_jpeg() -> None:
    # The probe reads a portrait JPEG's stored (landscape) size; the page draws it upright.
    upright = {"video": {"width": 1500, "height": 2000}}
    ctx, _ = context(
        "object-eraser", {**PHOTO, "extras": [upright]}, {}, Gpu(Bucket()), extras=["in/mask"]
    )
    assert object_eraser.PROCESSOR.run(ctx).ext == "png"


def test_a_gpu_failure_leaves_nothing_behind() -> None:
    bucket = Bucket()
    gpu = Gpu(
        bucket, fail=GpuError("EMPTY_MASK", "The mask marks nothing to erase.", gpu_seconds=2)
    )
    ctx, used = context("object-eraser", PHOTO, {}, gpu, extras=["in/mask"])
    with pytest.raises(JobFailed) as caught:
        object_eraser.PROCESSOR.run(ctx)
    assert (caught.value.code, str(caught.value)) == (
        "EMPTY_MASK",
        "The mask marks nothing to erase.",
    )
    assert bucket.objects == {}
    # A failure the function reported is billed with an idle window (gpu/backend.py).
    assert used == [GpuUsage(2, 2 + MAX_IDLE_TAIL_SEC)]


# --- V20 Upscale Video ------------------------------------------------------------


def test_upscale_video_sends_the_model_and_noise_setting() -> None:
    bucket = Bucket()
    gpu = Gpu(bucket, b"MP4", width=3840, height=2160, frames=1800)
    ctx, _ = context(
        "upscale-video",
        clip(1920, 1080, 60),
        {"scale": "2", "model": "anime", "denoise": "high"},
        gpu,
    )
    out = upscale_video.PROCESSOR.run(ctx)
    assert gpu.calls[0].function == "upscale_video"
    # A minute at 30 fps: 1,800 frames and a second's more; 60 s and 2 % and a second.
    assert gpu.calls[0].kwargs["options"] == {
        "scale": 2,
        "model": "anime",
        "denoise": 1.0,
        "max_frames": 1830,
        "max_seconds": 62.2,
    }
    assert "extra_urls" not in gpu.calls[0].kwargs
    assert (out.content_type, out.ext) == ("video/mp4", "mp4")
    assert out.meta == {"width": 3840, "height": 2160, "model": "anime", "notes": ["a note"]}


@pytest.mark.parametrize(
    ("meta", "options", "words"),
    [
        (clip(1920, 1080, 10), {"scale": "4"}, "7680 × 4320 px"),  # noqa: RUF001
        (clip(1280, 720, 10), {"scale": "4"}, "Pick 2×"),  # noqa: RUF001
        (clip(640, 360, 601), {"scale": "4"}, "18,030 frames"),
        (clip(640, 360, 301, fps=60), {"scale": "2"}, "5.0 min at its 60 fps"),
    ],
)
def test_upscale_video_refuses_past_4k_or_too_many_frames(
    meta: dict[str, Any], options: dict[str, Any], words: str
) -> None:
    gpu = Gpu(Bucket())
    ctx, _ = context("upscale-video", meta, options, gpu)
    with pytest.raises(JobFailed) as caught:
        upscale_video.PROCESSOR.run(ctx)
    assert caught.value.code == "TOO_LARGE"
    assert words in str(caught.value)
    assert gpu.calls == []


def test_a_portrait_phone_clip_is_measured_upright() -> None:
    # Stored 1920 x 1080, shown 1080 x 1920: 2x is 2160 x 3840, which is 4K turned.
    meta = clip(1920, 1080, 5, rotation=270)
    assert upscale_video.picture(meta) == (1080, 1920)
    ctx, _ = context("upscale-video", meta, {"scale": "2"}, Gpu(Bucket()))
    assert upscale_video.PROCESSOR.run(ctx).meta["width"] == 2160


def test_a_file_without_pictures_is_refused() -> None:
    ctx, _ = context("upscale-video", {"duration_ms": 1000, "video": None}, {}, Gpu(Bucket()))
    with pytest.raises(JobFailed) as caught:
        upscale_video.PROCESSOR.run(ctx)
    assert caught.value.code == "NO_VIDEO"


def test_the_estimate_grows_with_frames_and_pixels() -> None:
    small = upscale_video.PROCESSOR.estimate(clip(640, 360, 60), {}).seconds
    big = upscale_video.PROCESSOR.estimate(clip(1920, 1080, 60), {}).seconds
    assert upscale_video.OVERHEAD_SEC < small < big


# --- V21 Video Background Remover --------------------------------------------------


@pytest.mark.parametrize(
    ("options", "sent", "content_type", "ext"),
    [
        ({}, {"output": "prores"}, "video/quicktime", "mov"),
        ({"output": "webm"}, {"output": "webm"}, "video/webm", "webm"),
        ({"output": "green"}, {"output": "green"}, "video/mp4", "mp4"),
        (
            {"output": "color", "color": "#FF8800"},
            {"output": "color", "color": "#ff8800"},
            "video/mp4",
            "mp4",
        ),
        (
            {"output": "color", "color": "red"},
            {"output": "color", "color": "#00b140"},
            "video/mp4",
            "mp4",
        ),
    ],
)
def test_each_output_is_its_own_file_type(
    options: dict[str, Any], sent: dict[str, Any], content_type: str, ext: str
) -> None:
    gpu = Gpu(Bucket(), width=1280, height=720)
    ctx, _ = context("video-background-remover", clip(1280, 720, 20), options, gpu)
    out = video_background.PROCESSOR.run(ctx)
    assert gpu.calls[0].function == "remove_video_background"
    assert gpu.calls[0].kwargs["options"] == {**sent, "max_frames": 630, "max_seconds": 21.4}
    assert ("PUT", out.key, content_type) in cast(Bucket, ctx.storage).signed
    assert (out.content_type, out.ext) == (content_type, ext)


def test_prores_that_would_pass_one_upload_is_refused_but_webm_is_not() -> None:
    long = clip(1920, 1080, 120)  # two minutes at 1080p30: about 6 GB of ProRes 4444
    assert video_background.prores_bytes(long) > video_background.MAX_PRORES_BYTES
    gpu = Gpu(Bucket())
    ctx, _ = context("video-background-remover", long, {"output": "prores"}, gpu)
    with pytest.raises(JobFailed) as caught:
        video_background.PROCESSOR.run(ctx)
    assert caught.value.code == "TOO_LARGE"
    assert "Pick WebM or a green screen" in str(caught.value)
    ctx, _ = context("video-background-remover", long, {"output": "webm"}, gpu)
    assert video_background.PROCESSOR.run(ctx).ext == "webm"


def test_cancelling_cancels_the_call_and_deletes_its_output() -> None:
    bucket = Bucket()
    gpu = Gpu(bucket, fail=GpuCancelled(3.0))
    ctx, used = context("video-background-remover", clip(640, 360, 5), {}, gpu)
    with pytest.raises(ToolError) as caught:
        video_background.PROCESSOR.run(ctx)
    assert caught.value.code == "CANCELLED"
    assert bucket.objects == {}
    assert used == [GpuUsage(3.0, 3.0 + MAX_IDLE_TAIL_SEC)]


def test_bigger_than_4k_in_is_refused() -> None:
    ctx, _ = context(
        "video-background-remover", clip(4096, 2160, 5), {"output": "webm"}, Gpu(Bucket())
    )
    with pytest.raises(JobFailed) as caught:
        video_background.PROCESSOR.run(ctx)
    assert caught.value.code == "TOO_LARGE"
