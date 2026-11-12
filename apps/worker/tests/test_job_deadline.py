"""A job's time limit is the job's, not each run's (finding W5).

The runner sets one deadline as the job starts, and ``JobContext.run`` gives
every run of the tool what is left of it. Without a deadline (outside a job)
every run has the whole limit, as before.
"""

from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from etb_worker import processors
from etb_worker.probe import probe_json, summarize
from etb_worker.processors import PROCESSORS, JobContext, remove_noise
from etb_worker.sandbox import Limits, ToolError, run


class Clock:
    """Stands in for the ``time`` module where the context reads it."""

    def __init__(self) -> None:
        self.now = 5000.0

    def monotonic(self) -> float:
        return self.now


def context(workdir: Path, limit: float, deadline: float | None) -> JobContext:
    return JobContext(
        job_id="job",
        tool_id="test",
        input_path=workdir / "input",
        workdir=workdir,
        options={},
        meta={},
        limits=Limits(timeout_sec=limit),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
        deadline=deadline,
    )


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(processors, "time", clock)
    return clock


@pytest.fixture
def given(monkeypatch: pytest.MonkeyPatch, clock: Clock) -> list[float]:
    """The time limit each sandbox run was given; a run takes as long as its ``sleep`` says."""
    seen: list[float] = []

    def fake(args: list[str], *, limits: Limits, **_rest: Any) -> str:
        seen.append(limits.timeout_sec)
        clock.now += float(args[1])
        return ""

    monkeypatch.setattr(processors, "run", fake)
    return seen


def test_each_run_gets_what_the_runs_before_it_left(
    tmp_path: Path, clock: Clock, given: list[float]
) -> None:
    ctx = context(tmp_path, 100, clock.now + 100)
    ctx.run(["sleep", "70"])
    ctx.run(["sleep", "20"])
    ctx.run(["sleep", "10"])
    assert given == [100, 30, 10]
    # Nothing is left: no fourth run starts, and the job fails as timed out.
    with pytest.raises(ToolError) as caught:
        ctx.run(["sleep", "1"])
    assert caught.value.code == "TIMEOUT"
    assert len(given) == 3


def test_time_spent_before_the_first_run_counts(
    tmp_path: Path, clock: Clock, given: list[float]
) -> None:
    ctx = context(tmp_path, 100, clock.now + 100)
    clock.now += 40  # the download
    ctx.run(["sleep", "1"])
    assert given == [60]


def test_outside_a_job_every_run_has_the_whole_limit(
    tmp_path: Path, clock: Clock, given: list[float]
) -> None:
    ctx = context(tmp_path, 100, None)
    ctx.run(["sleep", "70"])
    ctx.run(["sleep", "70"])
    assert given == [100, 100]
    assert ctx.time_left() == 100


def test_the_other_limits_stay_as_they_are(
    tmp_path: Path, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[Limits] = []

    def fake(_args: list[str], *, limits: Limits, **_rest: Any) -> str:
        seen.append(limits)
        return ""

    monkeypatch.setattr(processors, "run", fake)
    ctx = context(tmp_path, 100, clock.now + 25)
    ctx.limits = Limits(timeout_sec=100, memory_bytes=123, file_bytes=456, open_files=7)
    ctx.run(["true"])
    assert seen == [Limits(timeout_sec=25, memory_bytes=123, file_bytes=456, open_files=7)]


def test_a_run_is_stopped_when_the_jobs_time_is_up(tmp_path: Path) -> None:
    """The real sandbox: a second run that needs more than the first left is killed."""
    ctx = context(tmp_path, 60, time.monotonic() + 2)
    ctx.run(["sleep", "0.3"])
    started = time.monotonic()
    with pytest.raises(ToolError) as caught:
        ctx.run(["sleep", "30"])
    assert caught.value.code == "TIMEOUT"
    assert time.monotonic() - started < 5
    # The report names the job's limit, not the share its last run had.
    assert str(caught.value) == "stopped after 60 s"
    # And nothing more starts.
    marker = tmp_path / "ran"
    with pytest.raises(ToolError) as caught:
        ctx.run(["touch", marker.name])
    assert (caught.value.code, str(caught.value)) == ("TIMEOUT", "stopped after 60 s")
    assert not marker.exists()


def test_compress_videos_second_pass_gets_what_the_first_left(
    media: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A real tool with two runs (size mode: analyse, then compress), on the real clock."""
    given: list[float] = []

    def spy(args: list[str], *, limits: Limits, **rest: Any) -> str:
        given.append(limits.timeout_sec)
        return run(args, limits=limits, **rest)

    monkeypatch.setattr(processors, "run", spy)
    shutil.copy(media["mp4"], tmp_path / "input")
    started = time.monotonic()
    ctx = context(tmp_path, 120, started + 120)
    ctx.tool_id = "compress-video"
    ctx.options = {"mode": "size", "targetMb": 1, "resolution": "keep"}
    ctx.meta = summarize(probe_json(media["mp4"]), "video/mp4")
    PROCESSORS["compress-video"].run(ctx)
    spent = time.monotonic() - started
    first, second = given[:2]
    assert first <= 120
    # The first pass took a tenth of a second at least (the sandbox's poll), and that is
    # gone from the second's limit; nothing but the time spent is.
    assert 120 - spent <= second <= first - 0.09


# --- Compress Video's second try at a size target, inside one limit -----------------------

#: 2 min of small video for a 2 MB target: two passes, and both again if it comes out over.
SIZED: dict[str, Any] = {
    "duration_ms": 120_000,
    "video": {"codec": "h264", "width": 320, "height": 240, "fps": 30, "pix_fmt": "yuv420p"},
    "audio": None,
}
TARGET = 2_000_000


def compress(
    ctx: JobContext, clock: Clock, monkeypatch: pytest.MonkeyPatch, seconds: float, sizes: list[int]
) -> tuple[Any, list[float]]:
    """Compress Video to 2 MB with the sandbox stood in for: every pass takes ``seconds`` on
    the clock, and each encode leaves an output of the next of ``sizes`` bytes. With the
    output, the time limit each pass was given."""
    given: list[float] = []
    made = iter(sizes)

    def fake(args: list[str], *, cwd: Path, limits: Limits, **_rest: Any) -> str:
        given.append(limits.timeout_sec)
        clock.now += seconds
        if args[-1] == "out.mp4":  # the second pass; the first writes nothing
            (cwd / "out.mp4").write_bytes(bytes(next(made)))
        return ""

    monkeypatch.setattr(processors, "run", fake)
    ctx.tool_id = "compress-video"
    ctx.options = {"mode": "size", "targetMb": 2, "resolution": "keep"}
    ctx.meta = SIZED
    return PROCESSORS["compress-video"].run(ctx), given


def test_an_overshoot_with_too_little_time_left_keeps_the_first_result(
    tmp_path: Path, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """40 min a pass under a 2 h limit: the first result, 3 % over the target, is there after
    80 min. Both passes again don't fit in the 40 left: started, they were stopped at the
    limit, and the job ended as TIMEOUT with that result in its folder."""
    ctx = context(tmp_path, 7200, clock.now + 7200)
    output, given = compress(ctx, clock, monkeypatch, 2400, [round(TARGET * 1.03)])
    assert given == [7200, 4800]
    assert output.path.stat().st_size == round(TARGET * 1.03)
    assert output.meta["notes"] == ["Came out at 2.1 MB, just over the target"]
    # In time for the runner's own check before it uploads.
    assert ctx.time_left() == 2400


def test_an_overshoot_with_time_left_is_encoded_again(
    tmp_path: Path, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = context(tmp_path, 7200, clock.now + 7200)
    sizes = [round(TARGET * 1.03), round(TARGET * 0.98)]
    output, given = compress(ctx, clock, monkeypatch, 600, sizes)
    assert given == [7200, 6600, 6000, 5400]
    assert output.path.stat().st_size == round(TARGET * 0.98)
    assert output.meta["notes"] == []


def test_the_second_try_needs_a_little_more_than_the_first_took(
    tmp_path: Path, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Exactly the first encode's time is too close: the same work on a shared machine can
    take longer, and stopped at the limit it leaves nothing."""
    sizes = [round(TARGET * 1.03), round(TARGET * 0.98)]
    ctx = context(tmp_path / "a", 7200, clock.now + 7200)
    ctx.workdir.mkdir()
    assert compress(ctx, clock, monkeypatch, 1800, sizes)[1] == [7200, 5400]
    ctx = context(tmp_path / "b", 7200, clock.now + 7200)
    ctx.workdir.mkdir()
    assert compress(ctx, clock, monkeypatch, 1500, sizes)[1] == [7200, 5700, 4200, 2700]


def test_outside_a_job_an_overshoot_is_always_encoded_again(
    tmp_path: Path, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = context(tmp_path, 7200, None)
    sizes = [round(TARGET * 1.03), round(TARGET * 0.98)]
    output, given = compress(ctx, clock, monkeypatch, 4000, sizes)
    assert given == [7200, 7200, 7200, 7200]
    assert output.meta["notes"] == []


def test_the_time_left_can_be_read_without_failing_the_job(tmp_path: Path, clock: Clock) -> None:
    ctx = context(tmp_path, 100, clock.now + 100)
    clock.now += 30
    assert ctx.seconds_left() == 70
    clock.now += 80
    assert ctx.seconds_left() == -10
    with pytest.raises(ToolError):
        ctx.time_left()
    # Outside a job there is no one limit to run down.
    assert context(tmp_path, 100, None).seconds_left() is None


@pytest.fixture
def measured(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """The time limit Noise Reduction's delay check was given (its own sandbox run)."""
    seen: list[float] = []

    def measure(_rate: int, _workdir: Path, timeout: float) -> int:
        seen.append(timeout)
        return 1200

    monkeypatch.setattr(remove_noise, "_DELAYS", {})
    monkeypatch.setattr(remove_noise, "_measure_delay", measure)
    return seen


@pytest.mark.parametrize(("left", "expected"), [(900.0, 60.0), (12.0, 12.0)])
def test_the_delay_check_runs_in_what_the_job_has_left(
    tmp_path: Path, clock: Clock, measured: list[float], left: float, expected: float
) -> None:
    ctx = context(tmp_path, 900, clock.now + left)
    assert remove_noise.denoise_delay(ctx, 48_000) == 1200
    assert measured == [expected]


def test_the_delay_check_doesnt_start_when_the_jobs_time_is_up(
    tmp_path: Path, clock: Clock, measured: list[float]
) -> None:
    ctx = context(tmp_path, 900, clock.now - 1)
    with pytest.raises(ToolError) as caught:
        remove_noise.denoise_delay(ctx, 48_000)
    assert caught.value.code == "TIMEOUT"
    assert measured == []
