"""V12 Merge Videos on the server (tools/video.md -> V12 tests): identical clips
join without re-encoding and the total is exact; mixed 30/25 fps clips come
out on one constant clock without drift; a crossfade shortens the result by
its length at every join."""

from __future__ import annotations

import array
import json
import math
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

import pytest

from etb_worker.processors import PROCESSORS, JobContext, JobFailed, Output
from etb_worker.processors.merge_videos import (
    Clip,
    concat_list,
    copy_drops,
    copy_family,
    drop_expression,
    family_of,
    standard_fps,
    target,
)
from etb_worker.sandbox import Limits, ToolError

# --- The plan, without ffmpeg ------------------------------------------------------------


def clip(
    end: float,
    sound: list[tuple[float, float]] | None = None,
    *,
    start: float = 0.0,
    video: dict[str, Any] | None = None,
) -> Clip:
    """A clip as ffprobe would describe it: 1080p at 30 fps unless ``video`` says otherwise."""
    stream = {
        "index": 0,
        "codec_name": "h264",
        "width": 1920,
        "height": 1080,
        "avg_frame_rate": "30/1",
        **(video or {}),
    }
    made = Clip("input", 1, stream, {"codec_name": "aac"} if sound is not None else None)
    made.start, made.end = start, end
    for at, length in sound or []:
        made.sound_at.append(at)
        made.sound_for.append(length)
    return made


AAC = 1024 / 48000


def aac(seconds: float, priming: bool = True) -> list[tuple[float, float]]:
    """AAC packets as ffmpeg reads them from an MP4: the priming first, before 0."""
    count = math.ceil(seconds / AAC)
    packets = [(-AAC, AAC)] if priming else []
    return packets + [(k * AAC, AAC) for k in range(count)]


def test_standard_rates_and_sizes() -> None:
    assert standard_fps(29.98) == 29.97
    assert standard_fps(23.95) == 23.976
    assert standard_fps(26) == 25
    assert standard_fps(0) == 23.976
    first = clip(2.0, video={"width": 1437, "height": 899})
    assert (target([first], {}).width, target([first], {}).height) == (1438, 900)
    # A height chosen keeps the first clip's shape; a portrait phone clip stays portrait.
    assert (target([first], {"size": "720"}).width, target([first], {"size": "720"}).height) == (
        1150,
        720,
    )
    phone = clip(2.0, video={"side_data_list": [{"rotation": 90}]})
    assert (target([phone], {}).width, target([phone], {}).height) == (1080, 1920)
    assert target([clip(2.0, video={"avg_frame_rate": "30000/1001"})], {}).rate == "30000/1001"
    assert target([clip(2.0, video={"avg_frame_rate": "30000/1001"})], {"fps": "25"}).rate == "25"


def test_each_clip_takes_its_frames_and_a_crossfade_overlaps_them() -> None:
    clips = [clip(2.0), clip(1.52, video={"avg_frame_rate": "25/1"}), clip(3.0)]
    cut = target(clips, {"fps": "first"})
    assert cut.frames == [60, 46, 90]
    assert cut.length == pytest.approx(196 / 30)
    faded = target(clips, {"transition": "crossfade", "transitionLength": "0.5"})
    assert faded.overlap == 15
    assert faded.length == pytest.approx((196 - 30) / 30)
    with pytest.raises(JobFailed) as caught:
        target(clips, {"transition": "crossfade", "transitionLength": "1"})
    assert caught.value.code == "CROSSFADE_TOO_LONG"


def test_a_copy_leaves_out_later_priming_and_sound_past_the_picture() -> None:
    # The first clip keeps its priming (the edit list hides it). Its sound runs 0.3 s long:
    # packet 93 (after the priming, so number 94) would end 5 ms past the picture.
    first = clip(2.0, aac(2.3))
    assert copy_drops(first, first=True) == list(range(94, len(first.sound_at)))
    # A later clip loses its priming; 1.0 s is 46.875 packets, so its last runs 2.7 ms over.
    later = clip(1.0, aac(1.0))
    assert copy_drops(later, first=False) == [0, 47]
    # Matroska times are whole milliseconds: 1 ms over is kept.
    assert copy_drops(clip(1.0, [(0.0, 0.5), (0.5, 0.501)]), first=False) == []


def test_the_drop_expression_numbers_packets_across_the_clips() -> None:
    clips = [clip(2.0, aac(2.0)), clip(1.0, aac(1.0)), clip(1.0, aac(1.0))]
    # 95, 48 and 48 packets; the drops are 94 | 0, 47 | 0, 47, numbered on from each clip.
    assert [len(c.sound_at) for c in clips] == [95, 48, 48]
    assert drop_expression(clips) == (
        "between(n\\,94\\,95)+between(n\\,142\\,143)+between(n\\,190\\,190)"
    )
    assert drop_expression([clip(1.0, [(0.0, 0.5)]), clip(1.0, [(0.0, 0.5)])]) is None


def test_the_concat_list_starts_each_clip_where_the_last_picture_ended() -> None:
    # WebM with Opus starts 7 ms before 0 (the codec delay); every clip alike.
    clips = [clip(2.0, start=-0.007), clip(3.0, start=-0.007), clip(1.0, start=-0.007)]
    clips[1].name, clips[2].name = "extra-0", "extra-1"
    assert concat_list(clips) == (
        "ffconcat version 1.0\nfile input\nduration 2.000000\n"
        "file extra-0\nduration 3.000000\nfile extra-1\n"
    )


def test_the_result_is_in_the_first_clips_format() -> None:
    assert family_of({"mime": "video/quicktime"}) == "mov"
    assert family_of({"mime": "video/webm"}) == "webm"
    assert family_of({"container": "matroska"}) == "mkv"
    assert family_of({"container": "mov"}) == "mp4"
    h264 = clip(1.0, [])
    assert copy_family("webm", h264) == "mkv"  # WebM can't hold H.264
    assert copy_family("mp4", h264) == "mp4"
    assert copy_family("mov", h264) == "mov"


# --- The real thing, with ffmpeg ---------------------------------------------------------


def make(path: Path, *args: str) -> Path:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    subprocess.run(  # noqa: S603
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args, str(path)],  # noqa: S607
        check=True,
    )
    return path


def h264_clip(path: Path, seconds: float, sound_seconds: float | None = None) -> Path:
    """The same encoder settings each time, as one camera's clips: only the length differs."""
    return make(
        path,
        *("-f", "lavfi", "-i", f"testsrc=size=160x120:rate=25:duration={seconds}"),
        *(
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate=44100:duration={sound_seconds or seconds}",
        ),
        *("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "25"),
        *("-c:a", "aac", "-b:a", "64k", "-ac", "2"),
    )


def merge(tmp_path: Path, clips: list[Path], options: dict[str, Any], mime: str) -> Output:
    work = tmp_path / "work"
    work.mkdir(parents=True)
    shutil.copy(clips[0], work / "input")
    extras = []
    for i, source in enumerate(clips[1:]):
        extras.append(work / f"extra-{i}")
        shutil.copy(source, extras[-1])
    ctx = JobContext(
        job_id="test",
        tool_id="merge-videos",
        input_path=work / "input",
        workdir=work,
        options=options,
        meta={"mime": mime},
        limits=Limits(timeout_sec=300),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
        extra_paths=extras,
    )
    return PROCESSORS["merge-videos"].run(ctx)


def probe(path: Path, *args: str) -> list[str]:
    return subprocess.run(  # noqa: S603
        ["ffprobe", "-v", "error", *args, "-of", "csv=p=0", str(path)],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()


def hashes(path: Path, stream: str) -> list[str]:
    """Each packet's bytes, hashed: the same list means the same packets."""
    return probe(
        path,
        "-select_streams",
        stream,
        "-show_data_hash",
        "sha256",
        "-show_entries",
        "packet=data_hash",
    )


def times(path: Path, stream: str) -> list[tuple[float, float]]:
    rows = probe(path, "-select_streams", stream, "-show_entries", "packet=pts_time,duration_time")
    return sorted((float(a), float(b)) for a, b, *_ in (row.split(",") for row in rows))


def streams(path: Path) -> list[dict[str, Any]]:
    out = subprocess.run(  # noqa: S603
        ["ffprobe", "-v", "error", "-show_streams", "-count_frames", "-of", "json", str(path)],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    found: list[dict[str, Any]] = json.loads(out)["streams"]
    return found


def test_identical_clips_are_copied_packet_for_packet(tmp_path: Path) -> None:
    clips = [
        h264_clip(tmp_path / "a.mp4", 2),
        h264_clip(tmp_path / "b.mp4", 3),
        h264_clip(tmp_path / "c.mp4", 1.5),
    ]
    output = merge(
        tmp_path, clips, {"transition": "none", "size": "first", "fps": "first"}, "video/mp4"
    )
    assert output.ext == "mp4"
    assert output.meta["notes"][1].startswith("The clips share their codec and settings")
    # Lossless: every picture packet, byte for byte, in order.
    assert hashes(output.path, "v:0") == [h for c in clips for h in hashes(c, "v:0")]
    # The sound too, but for the later clips' encoder priming (their first packet).
    sound = hashes(output.path, "a:0")
    assert sound == hashes(clips[0], "a:0") + [h for c in clips[1:] for h in hashes(c, "a:0")[1:]]
    # Each clip starts where the last one's picture ended: 2 s, 3 s and 1.52 s (38 frames).
    starts = [at for at, _ in times(output.path, "v:0")]
    assert starts[50] == pytest.approx(2.0, abs=1e-3)
    assert starts[125] == pytest.approx(5.0, abs=1e-3)
    end = max(at + length for at, length in times(output.path, "v:0"))
    assert end == pytest.approx(6.52, abs=1e-3)
    audio = times(output.path, "a:0")
    # Each clip's sound starts with its picture, so nothing drifts.
    assert min(at for at, _ in audio if at > 1.999) == pytest.approx(2.0, abs=1e-3)
    assert min(at for at, _ in audio if at > 4.999) == pytest.approx(5.0, abs=1e-3)


def test_sound_that_runs_past_its_picture_is_left_out_of_a_copy(tmp_path: Path) -> None:
    clips = [h264_clip(tmp_path / "a.mp4", 2, sound_seconds=2.4), h264_clip(tmp_path / "b.mp4", 2)]
    output = merge(tmp_path, clips, {}, "video/mp4")
    assert output.meta["notes"][1].startswith("The clips share")
    audio = times(output.path, "a:0")
    first = [(at, length) for at, length in audio if at < 2.0 - 1e-6]
    assert max(at + length for at, length in first) <= 2.0 + 0.001
    assert min(at for at, _ in audio if at >= 2.0 - 1e-6) == pytest.approx(2.0, abs=1e-3)


def test_webm_clips_are_copied_too(tmp_path: Path) -> None:
    def webm(name: str, seconds: float) -> Path:
        return make(
            tmp_path / name,
            *("-f", "lavfi", "-i", f"testsrc=size=160x120:rate=30:duration={seconds}"),
            *("-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={seconds}"),
            *("-c:v", "libvpx-vp9", "-b:v", "200k", "-g", "30", "-c:a", "libopus", "-ac", "2"),
        )

    clips = [webm("a.webm", 2), webm("b.webm", 1)]
    output = merge(tmp_path, clips, {}, "video/webm")
    assert (output.ext, output.content_type) == ("webm", "video/webm")
    assert hashes(output.path, "v:0") == [h for c in clips for h in hashes(c, "v:0")]
    video = times(output.path, "v:0")
    # The picture is seamless: the second clip's first frame follows the first clip's last.
    assert video[60][0] - video[59][0] == pytest.approx(1 / 30, abs=2e-3)
    assert video[-1][0] - video[0][0] == pytest.approx(3.0 - 1 / 30, abs=2e-3)


def colour_clip(path: Path, picture: str, sound: tuple[int, float, int] | None) -> Path:
    """A plain picture (lavfi ``color``: colour, size, rate, length), and a steady tone
    (sample rate, length, channels) or no sound at all."""
    args = ["-f", "lavfi", "-i", f"color=c={picture}"]
    if sound:
        rate, length, channels = sound
        tone = f"sine=frequency=1000:sample_rate={rate}:duration={length}"
        args += ["-f", "lavfi", "-i", tone, "-ac", str(channels), "-c:a", "aac"]
    return make(path, *args, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p")


def brightness(path: Path) -> list[int]:
    """Each frame's mean brightness, 0-255."""
    raw = subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-v", "error", "-i", str(path), "-vf", "scale=8:8,format=gray"),
            *("-f", "rawvideo", "-"),
        ],
        check=True,
        capture_output=True,
    ).stdout
    return [sum(raw[i : i + 64]) // 64 for i in range(0, len(raw), 64)]


def loudness(path: Path, window: float = 0.01) -> list[float]:
    """The sound's RMS in 10 ms windows, mixed to mono at 48 kHz."""
    raw = subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "48000"),
            *("-f", "s16le", "-"),
        ],
        check=True,
        capture_output=True,
    ).stdout
    samples = array.array("h", raw)
    size = round(48000 * window)
    return [
        math.sqrt(sum(s * s for s in samples[i : i + size]) / size)
        for i in range(0, len(samples) - size + 1, size)
    ]


def edges(values: list[float], threshold: float, step: float) -> list[float]:
    """When the values cross the threshold, in seconds."""
    return [
        i * step
        for i in range(1, len(values))
        if (values[i - 1] > threshold) != (values[i] > threshold)
    ]


def test_mixed_clips_meet_on_one_clock_with_the_sound_in_sync(tmp_path: Path) -> None:
    clips = [
        # 30 fps, 16:9, with sound 0.3 s longer than its picture.
        colour_clip(tmp_path / "a.mp4", "white:s=320x180:r=30:d=2.0", (44100, 2.3, 1)),
        # 25 fps, 4:3, no sound at all.
        colour_clip(tmp_path / "b.mp4", "black:s=160x120:r=25:d=1.2", None),
        # 24 fps, sound 0.5 s shorter than its picture.
        colour_clip(tmp_path / "c.mp4", "white:s=160x120:r=24:d=2.0", (48000, 1.5, 2)),
    ]
    output = merge(tmp_path, clips, {}, "video/mp4")
    assert output.meta["notes"][2].startswith("The clips differ")
    video, audio = streams(output.path)
    assert (video["codec_name"], video["width"], video["height"]) == ("h264", 320, 180)
    assert video["r_frame_rate"] == "30/1"
    # 60 + 36 + 60 frames: each clip's own length on the new clock, no drift.
    assert int(video["nb_read_frames"]) == 156
    assert (audio["codec_name"], audio["sample_rate"], audio["channels"]) == ("aac", "48000", 2)
    assert float(audio["duration"]) == pytest.approx(5.2, abs=0.03)

    # White to black at 2.0 s and back at 3.2 s; the tone stops and starts with them.
    frames = brightness(output.path)
    picture = edges([float(b) for b in frames], 128, 1 / 30)
    assert picture == pytest.approx([2.0, 3.2], abs=0.001)
    sound = edges(loudness(output.path), 1000, 0.01)
    # The third clip's sound ends 0.5 s before its picture: silence, not the next sound early.
    assert sound[:2] == pytest.approx(picture, abs=1 / 30)
    assert sound[2] == pytest.approx(4.7, abs=1 / 30)
    # The 4:3 clip sits on black in the 16:9 frame, as large as fits.
    assert len(sound) == 3


def test_a_crossfade_shortens_the_result_by_its_length_at_every_join(tmp_path: Path) -> None:
    clips = [
        colour_clip(tmp_path / f"{name}.mp4", f"{colour}:s=160x120:r=30:d=2.0", (48000, 2.0, 2))
        for name, colour in (("a", "white"), ("b", "black"), ("c", "white"))
    ]
    output = merge(
        tmp_path, clips, {"transition": "crossfade", "transitionLength": "1"}, "video/mp4"
    )
    video, audio = streams(output.path)
    assert int(video["nb_read_frames"]) == 120  # 3 x 60 frames, less 2 x 30 overlapping
    assert float(audio["duration"]) == pytest.approx(4.0, abs=0.03)
    assert output.meta["notes"][0] == "3 clips joined with 1.00 s crossfades: 4.00 s"
    # Mid-dissolve the picture is half way between white and black.
    frames = brightness(output.path)
    assert 100 < frames[45] < 160
    # Equal-power: the level holds through the join (two copies of one tone, in phase, add up
    # to √2 at the middle, never dip).
    levels = loudness(output.path)
    assert min(levels[20:380]) > 0.9 * levels[10]


def test_webm_clips_that_differ_come_out_as_vp9_and_opus(tmp_path: Path) -> None:
    clips = [
        colour_clip(tmp_path / "a.mp4", "white:s=320x240:r=25:d=1.0", (48000, 1.0, 2)),
        colour_clip(tmp_path / "b.mp4", "black:s=160x120:r=30:d=1.0", (44100, 1.0, 1)),
    ]
    output = merge(tmp_path, clips, {"size": "480", "fps": "25"}, "video/webm")
    video, audio = streams(output.path)
    assert (output.ext, video["codec_name"], audio["codec_name"]) == ("webm", "vp9", "opus")
    assert (video["width"], video["height"]) == (640, 480)
    assert int(video["nb_read_frames"]) == 50


def test_limits_and_broken_clips_are_refused(tmp_path: Path, media: dict[str, Any]) -> None:
    two = [h264_clip(tmp_path / "a.mp4", 1), h264_clip(tmp_path / "b.mp4", 1)]
    with pytest.raises(JobFailed) as long_fade:
        merge(
            tmp_path / "1", two, {"transition": "crossfade", "transitionLength": "1"}, "video/mp4"
        )
    assert long_fade.value.code == "CROSSFADE_TOO_LONG"
    with pytest.raises(JobFailed) as one:
        merge(tmp_path / "2", two[:1], {}, "video/mp4")
    assert one.value.code == "NOT_FOUND"
    with pytest.raises(JobFailed) as many:
        merge(tmp_path / "3", two * 11, {}, "video/mp4")
    assert many.value.code == "TOOL_FAILED"
    sound_only = make(tmp_path / "tone.mp4", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac")
    with pytest.raises(JobFailed) as no_video:
        merge(tmp_path / "4", [two[0], sound_only], {}, "video/mp4")
    assert no_video.value.code == "NO_VIDEO"
    assert str(no_video.value) == "Clip 2 has no picture in it, only sound."
    with pytest.raises((JobFailed, ToolError)):
        merge(tmp_path / "5", [two[0], media["garbage"]], {}, "video/mp4")
