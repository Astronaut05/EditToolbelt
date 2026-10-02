"""The Modal app, the registry and config/business.ts agree about each GPU function.

The registry names each tool's GPU and business.ts prices a function's
container (its GPU, CPU and memory) from what modal_app.py asks Modal for;
the web writes that price on each job. If they drift, costs and the daily
budget go wrong, so they're held together here.
"""

from __future__ import annotations

import re
from pathlib import Path

from etb_worker.gpu import MAX_IDLE_TAIL_SEC, modal_app

ROOT = Path(__file__).resolve().parents[3]
TOOLS = {
    "upscale-image": ("photo", "upscale_image"),
    "transcribe-audio": ("audio", "transcribe"),
    "auto-subtitles": ("video", "transcribe"),
    "object-eraser": ("photo", "erase_object"),
    "upscale-video": ("video", "upscale_video"),
    "video-background-remover": ("video", "remove_video_background"),
}


def test_each_tool_names_the_gpu_its_function_runs_on() -> None:
    for tool, (category, function) in TOOLS.items():
        source = (ROOT / f"packages/registry/src/tools/{category}/{tool}.ts").read_text("utf-8")
        found = re.search(r"\bgpu: '(\w+)'", source)
        assert found, f"{tool} names no GPU"
        assert found.group(1) == modal_app.SPECS[function].gpu, tool


def test_business_prices_the_shape_every_function_asks_for() -> None:
    business = (ROOT / "config/business.ts").read_text("utf-8")
    cores = re.search(r"functionCpuCores: (\d+(?:\.\d+)?)", business)
    memory = re.search(r"functionMemoryGib: (\d+(?:\.\d+)?)", business)
    assert cores
    assert memory
    assert float(cores.group(1)) == modal_app.CPU_CORES
    assert float(memory.group(1)) * 1024 == modal_app.MEMORY_MIB
    for spec in modal_app.SPECS.values():
        assert f"{spec.gpu}: 0." in business, f"no price for {spec.gpu}"


def test_jobs_outlive_their_gpu_call() -> None:
    """The job's limit (registry timeoutSec) leaves room past the function's own timeout."""
    for tool, (category, function) in TOOLS.items():
        source = (ROOT / f"packages/registry/src/tools/{category}/{tool}.ts").read_text("utf-8")
        found = re.search(r"timeoutSec: (\d+) \* 60", source)
        assert found, tool
        assert int(found.group(1)) * 60 > modal_app.SPECS[function].timeout, tool


def test_every_gpu_function_has_a_tool_or_is_shared() -> None:
    assert {function for _category, function in TOOLS.values()} == set(modal_app.SPECS)


def test_the_video_limits_agree() -> None:
    """The frame cap is the same in the function, the worker and the web."""
    from etb_worker.processors import upscale_video, video_background  # noqa: PLC0415

    rules = (ROOT / "apps/web/src/lib/gpu-limits.ts").read_text("utf-8")
    assert f"MAX_VIDEO_FRAMES = {modal_app.MAX_VIDEO_FRAMES:_}" in rules
    assert upscale_video.MAX_FRAMES == modal_app.MAX_VIDEO_FRAMES
    assert f"MAX_PRORES_BYTES = {video_background.MAX_PRORES_BYTES:_}" in rules
    assert f"PRORES_BITS_PER_PIXEL = {video_background.PRORES_BITS_PER_PIXEL}" in rules
    assert f"MAX_LONG_SIDE = {upscale_video.MAX_LONG_SIDE}" in rules
    assert f"MAX_SHORT_SIDE = {upscale_video.MAX_SHORT_SIDE}" in rules


def test_no_call_of_ours_queues_on_modal() -> None:
    """A function has a container for every job its tools may run at once (maxConcurrent).

    The worker's clock for a call starts at the spawn: time spent queueing on
    Modal behind our own calls would count against the job's limit.
    """
    for function, spec in modal_app.SPECS.items():
        concurrent = 0
        for tool, (category, uses) in TOOLS.items():
            if uses != function:
                continue
            source = (ROOT / f"packages/registry/src/tools/{category}/{tool}.ts").read_text("utf-8")
            found = re.search(r"maxConcurrent: (\d+)", source)
            assert found, f"{tool} has no maxConcurrent"
            concurrent += int(found.group(1))
        assert spec.max_containers >= concurrent, function


def test_the_worst_case_idle_window_covers_every_function() -> None:
    """Calls that didn't say, and the budget's worst case, bill this idle window (gpu/__init__)."""
    for function, spec in modal_app.SPECS.items():
        assert spec.scaledown <= MAX_IDLE_TAIL_SEC, function
    business = (ROOT / "config/business.ts").read_text("utf-8")
    found = re.search(r"worstCaseIdleSec: (\d+)", business)
    assert found
    assert int(found.group(1)) == MAX_IDLE_TAIL_SEC
