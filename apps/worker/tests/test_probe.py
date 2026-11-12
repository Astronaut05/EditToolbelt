from __future__ import annotations

import shutil
import struct
import subprocess
import tracemalloc
from pathlib import Path
from typing import Any

import pytest

from etb_worker import probe as probe_module
from etb_worker.probe import (
    MAX_FRAME_TIMES,
    ProbeRefused,
    picture_packets,
    probe_json,
    summarize,
    variable_frame_rate,
)
from etb_worker.processors import upscale_video
from etb_worker.sandbox import MAX_ANSWER, MAX_LINE, ToolError, run

VIDEO = {
    "codec_type": "video",
    "codec_name": "h264",
    "width": 1920,
    "height": 1080,
    "r_frame_rate": "30/1",
    "avg_frame_rate": "30/1",
    "pix_fmt": "yuv420p",
}


def raw(fmt: str = "mov,mp4,m4a,3gp,3g2,mj2", **extra: Any) -> dict[str, Any]:
    return {
        "format": {"format_name": fmt, "duration": "12.5", "bit_rate": "800000"},
        "streams": [
            VIDEO,
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "sample_rate": "48000",
                "channels": 2,
                "bit_rate": "128000",
            },
        ],
        **extra,
    }


def test_summarizes_container_streams_and_duration() -> None:
    record = summarize(raw(), "video/mp4")
    assert record == {
        "container": "mov",
        "duration_ms": 12500,
        "bit_rate": 800000,
        "streams": 2,
        "video": {
            "codec": "h264",
            "width": 1920,
            "height": 1080,
            "fps": 30.0,
            "vfr": None,
            "maybe_vfr": False,
            "pix_fmt": "yuv420p",
            "rotation": 0,
        },
        "audio": {"codec": "aac", "sample_rate": 48000, "channels": 2, "bit_rate": 128000},
    }


def test_flags_a_likely_variable_frame_rate() -> None:
    vfr = {**VIDEO, "r_frame_rate": "30/1", "avg_frame_rate": "2950/100"}
    record = summarize({"format": {"format_name": "mov,mp4"}, "streams": [vfr]}, "video/quicktime")
    assert record["video"]["maybe_vfr"] is True
    assert record["video"]["vfr"] is None


def test_the_frames_own_clock_decides_variable_frame_rate() -> None:
    steady = [n / 30 for n in range(300)]
    assert variable_frame_rate(steady) is False
    # 29.97 fps on a 600 timescale: gaps of 20 and 21 ticks are still constant.
    ticks = [round(n * 600 / 29.97) / 600 for n in range(300)]
    assert variable_frame_rate(ticks) is False
    # A phone's clock: every fifth gap a third longer.
    phone, t = [], 0.0
    for n in range(300):
        phone.append(t)
        t += 0.0444 if n % 5 == 0 else 0.0333
    assert variable_frame_rate(phone) is True
    assert variable_frame_rate([0.0, 0.1]) is None
    # It overrides the header's hint either way.
    record = summarize(
        {
            "format": {"format_name": "mov,mp4"},
            "streams": [{**VIDEO, "r_frame_rate": "30/1", "avg_frame_rate": "2950/100"}],
            "frame_times": steady,
        },
        "video/mp4",
    )
    assert (record["video"]["vfr"], record["video"]["maybe_vfr"]) == (False, False)


def test_refuses_content_that_is_not_the_claimed_type() -> None:
    with pytest.raises(ProbeRefused) as caught:
        summarize(raw("matroska,webm"), "video/mp4")
    assert caught.value.code == "UNSUPPORTED_FORMAT"


def test_refuses_files_without_streams_huge_frames_and_endless_media() -> None:
    with pytest.raises(ProbeRefused):
        summarize({"format": {"format_name": "mov,mp4"}, "streams": []}, "video/mp4")
    huge = {**VIDEO, "width": 20000, "height": 20000}
    with pytest.raises(ProbeRefused) as caught:
        summarize({"format": {"format_name": "mov,mp4"}, "streams": [huge]}, "video/mp4")
    assert caught.value.code == "FILE_TOO_LARGE"
    long = {"format": {"format_name": "mov,mp4", "duration": str(25 * 3600)}, "streams": [VIDEO]}
    with pytest.raises(ProbeRefused):
        summarize(long, "video/mp4")


def test_probes_real_files_and_refuses_broken_ones(media: dict[str, Any]) -> None:
    record = summarize(probe_json(media["mp4"]), "video/mp4")
    assert record["video"]["width"] == 160
    assert record["video"]["vfr"] is False
    assert record["audio"]["codec"] == "aac"
    assert 1900 <= record["duration_ms"] <= 2200
    with pytest.raises(ProbeRefused):
        summarize(probe_json(media["webm"]), "video/mp4")
    for broken in ("garbage", "truncated"):
        with pytest.raises(ProbeRefused) as caught:
            summarize(probe_json(media[broken]), "video/mp4")
        assert caught.value.code == "UNSUPPORTED_FORMAT"


@pytest.mark.parametrize(
    ("name", "mime", "body", "codec"),
    [
        ("a.srt", "application/x-subrip", "1\n00:00:01,000 --> 00:00:02,000\nHello\n", "subrip"),
        ("a.vtt", "text/vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n", "webvtt"),
    ],
)
def test_reads_subtitle_files_and_refuses_impostors(
    tmp_path: Path, name: str, mime: str, body: str, codec: str
) -> None:
    if shutil.which("ffprobe") is None:
        pytest.skip("ffmpeg not installed")
    path = tmp_path / name
    path.write_text(body)
    record = summarize(probe_json(path), mime)
    assert record["subtitle"] == {"codec": codec}
    assert record["video"] is None
    # A video sent as subtitles, or subtitles as a video, is refused.
    with pytest.raises(ProbeRefused):
        summarize(probe_json(path), "video/mp4")


def test_reads_still_images_for_upscaling_and_audio_for_transcription(
    media: dict[str, Any], tmp_path: Path
) -> None:
    from etb_worker.gpu.check import tiny_png, tiny_wav  # noqa: PLC0415 - test inputs

    png = tmp_path / "input"
    png.write_bytes(tiny_png(40, 30))
    record = summarize(probe_json(png), "image/png")
    assert (record["video"]["width"], record["video"]["height"]) == (40, 30)
    assert record["audio"] is None
    # A PNG claimed as a JPEG, or as a video, is refused.
    for mime in ("image/jpeg", "video/mp4"):
        with pytest.raises(ProbeRefused):
            summarize(probe_json(png), mime)
    wav = tmp_path / "sound"
    wav.write_bytes(tiny_wav(1.5))
    record = summarize(probe_json(wav), "audio/wav")
    assert record["video"] is None
    assert record["audio"]["sample_rate"] == 16000
    assert 1400 <= record["duration_ms"] <= 1600
    with pytest.raises(ProbeRefused):
        summarize(probe_json(wav), "image/png")


def recording(path: Path, seconds: int) -> Path:
    """A WebM written as it is recorded, like a browser's MediaRecorder: no length in its header."""
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    made = subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-hide_banner", "-loglevel", "error"),
            *("-f", "lavfi", "-i", f"testsrc2=size=160x120:rate=25:duration={seconds}"),
            *("-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"),
            *("-c:v", "libvpx", "-b:v", "200k", "-c:a", "libopus", "-shortest"),
            *("-f", "webm", "pipe:1"),
        ],
        check=True,
        capture_output=True,
    )
    path.write_bytes(made.stdout)
    return path


def test_a_recording_without_a_length_is_measured_from_its_packets(tmp_path: Path) -> None:
    path = recording(tmp_path / "rec.webm", 7)
    data = probe_json(path)
    assert data["duration_from_packets"] is True
    # Priced, limited and capped by its real length, not as a file of no length.
    assert 6950 <= summarize(data, "video/webm")["duration_ms"] <= 7100


def test_media_whose_length_cant_be_read_is_refused(tmp_path: Path) -> None:
    whole = recording(tmp_path / "rec.webm", 2).read_bytes()
    headers_only = tmp_path / "headers.webm"
    headers_only.write_bytes(whole[: whole.index(b"\x1f\x43\xb6\x75")])  # up to the first Cluster
    with pytest.raises(ProbeRefused) as refused:
        probe_json(headers_only)
    assert refused.value.code == "UNSUPPORTED_FORMAT"


def encoded(path: Path, *args: str) -> Path:
    """10 s of loud noise, then 50 s of near silence: a bitrate guess from the start is wrong."""
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-hide_banner", "-loglevel", "error", "-y"),
            *("-f", "lavfi", "-i", "anoisesrc=d=10:a=0.8,aformat=channel_layouts=stereo"),
            *("-f", "lavfi", "-i", "anoisesrc=d=50:a=0.0005,aformat=channel_layouts=stereo"),
            *("-filter_complex", "[0][1]concat=n=2:v=0:a=1", *args, str(path)),
        ],
        check=True,
    )
    return path


@pytest.mark.parametrize(
    ("name", "mime", "args"),
    [
        ("vbr.mp3", "audio/mpeg", ("-c:a", "libmp3lame", "-q:a", "0", "-write_xing", "0")),
        ("raw.aac", "audio/aac", ("-c:a", "aac", "-q:a", "2", "-f", "adts")),
    ],
)
def test_lengths_ffprobe_would_guess_from_the_bitrate_are_measured(
    tmp_path: Path, name: str, mime: str, args: tuple[str, ...]
) -> None:
    data = probe_json(encoded(tmp_path / name, *args))
    assert data["duration_from_packets"] is True
    # The whole minute, not ffprobe's guess from the bitrate (57 s for this MP3, 74 s for this AAC).
    assert 59_800 <= summarize(data, mime)["duration_ms"] <= 60_200


def test_a_header_length_that_rounds_to_nothing_is_measured(tmp_path: Path) -> None:
    """A Matroska header that says 0.1 ms would price and cap 0 ms: it is measured instead."""
    seekable = tmp_path / "clip.mkv"
    subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-hide_banner", "-loglevel", "error", "-y"),
            *("-i", str(recording(tmp_path / "rec.webm", 3)), "-c", "copy", str(seekable)),
        ],
        check=True,
    )
    body = bytearray(seekable.read_bytes())
    at = body.find(b"\x44\x89\x88")  # Segment Duration, an 8-byte float in ms
    assert at > 0
    body[at + 3 : at + 11] = struct.pack(">d", 0.0001)
    seekable.write_bytes(bytes(body))
    data = probe_json(seekable)
    assert data["duration_from_packets"] is True
    assert 2900 <= summarize(data, "video/x-matroska")["duration_ms"] <= 3100


def test_a_length_that_takes_too_long_to_measure_says_so(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = recording(tmp_path / "rec.webm", 2)

    def slow(args: list[str], **kwargs: Any) -> str:
        if "packet=stream_index,pts_time,duration_time" in args:
            raise ToolError("TIMEOUT", "stopped after 300 s")
        return run(args, **kwargs)

    monkeypatch.setattr(probe_module, "run", slow)
    with pytest.raises(ProbeRefused) as refused:
        probe_json(path)
    assert refused.value.code == "TIMEOUT"


def ffmpeg(*args: str) -> None:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    subprocess.run(  # noqa: S603
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],  # noqa: S607
        check=True,
    )


def with_cover(path: Path, source: str, encode: list[str], cover: int) -> Path:
    """``source`` with a 300 x 300 JPEG as its cover art, as music players and phones save
    it; ``cover`` is the artwork's place among the output's video streams."""
    jpeg = path.with_suffix(".jpg")
    ffmpeg("-f", "lavfi", "-i", "color=red:size=300x300", "-frames:v", "1", str(jpeg))
    ffmpeg(
        *("-f", "lavfi", "-i", source, "-i", str(jpeg), "-map", "0", "-map", "1", *encode),
        *(f"-c:v:{cover}", "mjpeg", f"-disposition:v:{cover}", "attached_pic", str(path)),
    )
    return path


@pytest.mark.parametrize(
    ("name", "mime", "codec"),
    [("song.mp3", "audio/mpeg", "libmp3lame"), ("song.m4a", "audio/mp4", "aac")],
)
def test_a_songs_cover_art_is_not_a_picture(
    tmp_path: Path, name: str, mime: str, codec: str
) -> None:
    # ffprobe gives the artwork 90,000 fps, which the jobs API would refuse as video.
    song = with_cover(tmp_path / name, "sine=frequency=440:duration=5", ["-c:a", codec], 0)
    data = probe_json(song)
    assert "frame_times" not in data
    assert "picture_packets" not in data
    record = summarize(data, mime)
    assert record["video"] is None
    assert record["audio"]["channels"] == 1
    assert 4_900 <= record["duration_ms"] <= 5_200


def test_a_videos_cover_art_is_not_its_picture(tmp_path: Path) -> None:
    clip = with_cover(
        tmp_path / "clip.mp4",
        "testsrc2=size=160x120:rate=25:duration=3",
        ["-c:v:0", "libx264", "-preset", "ultrafast", "-pix_fmt:v:0", "yuv420p"],
        1,
    )
    data = probe_json(clip)
    record = summarize(data, "video/mp4")
    video = record["video"]
    assert (video["codec"], video["width"], video["height"], video["fps"]) == ("h264", 160, 120, 25)
    assert len(data["frame_times"]) == 75
    # The frames counted are the picture's: the artwork's one packet isn't among them.
    assert data["picture_packets"] == 75


@pytest.mark.parametrize(
    ("stream", "expected"),
    [
        ({"tags": {"rotate": "90"}}, 90),
        ({"tags": {"rotate": "-90"}}, 270),
        ({"tags": {"rotate": "180.0"}}, 180),
        ({"side_data_list": [{"rotation": -90}]}, 270),
        # The tag is whatever the uploader wrote.
        ({"tags": {"rotate": "abc"}}, 0),
        ({"tags": {"rotate": ""}}, 0),
        ({"tags": {"rotate": "nan"}}, 0),
        ({"tags": {"rotate": "1e400"}}, 0),
        ({"side_data_list": [{"rotation": "abc"}]}, 0),
    ],
)
def test_a_rotation_that_isnt_a_number_is_no_rotation(
    stream: dict[str, Any], expected: int
) -> None:
    record = summarize(
        {"format": {"format_name": "matroska,webm"}, "streams": [{**VIDEO, **stream}]},
        "video/x-matroska",
    )
    assert record["video"]["rotation"] == expected


def test_a_file_tagged_rotate_abc_is_probed_as_unrotated(tmp_path: Path) -> None:
    # ffmpeg won't write a "rotate" tag in Matroska, so the file gets another of the same
    # length and its name is patched, as a crafted upload would be.
    made = tmp_path / "made.mkv"
    ffmpeg(
        *("-f", "lavfi", "-i", "testsrc=size=64x48:rate=25:duration=1"),
        *("-c:v", "libx264", "-metadata:s:v:0", "XOTATE=abc", str(made)),
    )
    path = tmp_path / "input"
    path.write_bytes(made.read_bytes().replace(b"XOTATE", b"rotate"))
    data = probe_json(path)
    assert data["streams"][0]["tags"]["rotate"] == "abc"
    video = summarize(data, "video/x-matroska")["video"]
    assert (video["width"], video["height"], video["rotation"]) == (64, 48, 0)


def test_the_frame_times_stop_at_the_cap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A file of tiny frames lists more packets in its first minute than the check reads:
    the worker keeps only the first ``MAX_FRAME_TIMES`` and stops ffprobe there."""
    path = tmp_path / "input"
    ffmpeg(
        *("-f", "lavfi", "-i", "color=black:size=16x16:rate=1000:duration=10"),
        *("-c:v", "rawvideo", "-pix_fmt", "gray", "-f", "mov", str(path)),
    )
    listed: list[int] = []
    stopped: list[bool] = []

    def counting(args: list[str], **kwargs: Any) -> str:
        on_line, lines = kwargs["on_line"], 0

        def count(line: str) -> None:
            nonlocal lines
            lines += 1
            on_line(line)

        try:
            return run(args, **{**kwargs, "on_line": count})
        finally:
            listed.append(lines)
            stopped.append(kwargs.get("cancel") is not None and kwargs["cancel"].is_set())

    monkeypatch.setattr(probe_module, "run", counting)
    data = probe_json(path)
    times = data["frame_times"]
    # 10,000 packets; the first 7,200 kept, the same ones the check read before.
    assert len(times) == MAX_FRAME_TIMES
    assert times[:3] == pytest.approx([0.0, 0.001, 0.002])
    assert times[-1] == pytest.approx(7.199)
    assert listed[-1] > MAX_FRAME_TIMES
    assert stopped[-1]
    assert summarize(data, "video/quicktime")["video"]["vfr"] is False


# --- The frame rate: the header's word against the packets --------------------------------


def grey_clip(path: Path, rate: int, seconds: float, *args: str) -> Path:
    """Tiny grey frames in Matroska: thousands of packets, made in a second."""
    ffmpeg(
        *("-f", "lavfi", "-i", f"color=black:size=16x16:rate={rate}:duration={seconds}", *args),
        *("-c:v", "rawvideo", "-pix_fmt", "gray", "-f", "matroska", str(path)),
    )
    return path


def say_frame_length(path: Path, nanoseconds: int) -> None:
    """Rewrites a Matroska track's DefaultDuration (one frame's length in ns, 3 bytes here),
    which ffprobe takes both frame rates from, as a crafted upload would."""
    body = bytearray(path.read_bytes())
    at = body.find(b"\x23\xe3\x83\x83")
    assert at > 0, "no 3-byte DefaultDuration element"
    body[at + 4 : at + 7] = nanoseconds.to_bytes(3, "big")
    path.write_bytes(bytes(body))


def header_rates(data: dict[str, Any]) -> tuple[str, str]:
    picture = data["streams"][0]
    return picture["avg_frame_rate"], picture["r_frame_rate"]


def test_a_header_that_understates_the_frame_rate_is_measured_from_the_packets(
    tmp_path: Path,
) -> None:
    """7 s at 1200 fps under a header that says 60: priced, limited and capped by time as
    60 fps, a job would decode 20 times the frames."""
    path = grey_clip(tmp_path / "input", 1200, 7)
    say_frame_length(path, 16_666_667)
    data = probe_json(path)
    assert header_rates(data) == ("60/1", "60/1")
    # Every packet in the file, not only the 7,200 the variable-frame-rate check lists.
    assert data["picture_packets"] == 8400
    record = summarize(data, "video/x-matroska")
    assert record["duration_ms"] == 7000
    assert record["video"]["fps"] == 1200.0
    # The GPU function reads at a header rate: its frame cap still counts at that one.
    assert record["video"]["header_fps"] == 60.0
    assert upscale_video.reading_fps(record) == 60.0


def test_frames_packed_in_after_the_first_minute_are_counted_too(tmp_path: Path) -> None:
    """61 s at the 60 fps the header says, then 4 s at 1200 fps: the first minute's packet
    times, all the variable-frame-rate check reads, show nothing."""
    path = grey_clip(
        tmp_path / "input",
        1200,
        7.05,
        *("-vf", "setpts='if(lt(N,3660),N/60,61+(N-3660)/1200)/TB'", "-fps_mode", "passthrough"),
    )
    say_frame_length(path, 16_666_667)
    data = probe_json(path)
    assert header_rates(data) == ("60/1", "60/1")
    assert len(data["frame_times"]) == 3600
    assert variable_frame_rate(data["frame_times"]) is False
    assert data["picture_packets"] == 3660 + 4800
    record = summarize(data, "video/x-matroska")
    assert record["duration_ms"] == 65_000
    assert record["video"]["fps"] == pytest.approx(8460 / 65, abs=0.001)


def tool_runs(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """The arguments of each tool the probe runs in the sandbox, in order."""
    seen: list[list[str]] = []

    def noting(args: list[str], **kwargs: Any) -> str:
        seen.append(args)
        return run(args, **kwargs)

    monkeypatch.setattr(probe_module, "run", noting)
    return seen


def test_a_length_measured_from_the_packets_counts_the_picture_on_the_way(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Measuring a length reads every packet of the file: the picture's are counted in
    that pass, and the file isn't read through a second time."""
    path = recording(tmp_path / "rec.webm", 7)
    seen = tool_runs(monkeypatch)
    data = probe_json(path)
    assert data["duration_from_packets"] is True
    assert not [args for args in seen if "-count_packets" in args]
    # The same number the count on its own gives, of the picture and not the sound.
    assert data["picture_packets"] == picture_packets(path) >= 175
    assert summarize(data, "video/webm")["video"]["fps"] == 25.0


def test_a_file_without_a_length_cant_understate_its_frame_rate_either(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """7 s at 1200 fps whose header says 60 fps and a length that rounds to nothing."""
    path = grey_clip(tmp_path / "input", 1200, 7)
    say_frame_length(path, 16_666_667)
    body = bytearray(path.read_bytes())
    at = body.find(b"\x44\x89\x88")  # Segment Duration, an 8-byte float in ms
    assert at > 0
    body[at + 3 : at + 11] = struct.pack(">d", 0.0001)
    path.write_bytes(bytes(body))
    seen = tool_runs(monkeypatch)
    data = probe_json(path)
    assert header_rates(data) == ("60/1", "60/1")
    assert data["duration_from_packets"] is True
    assert data["picture_packets"] == 8400
    assert not [args for args in seen if "-count_packets" in args]
    record = summarize(data, "video/x-matroska")
    # The last frame is as long as the header says one is: 7 s and 16 ms.
    assert 7000 <= record["duration_ms"] <= 7020
    assert record["video"]["fps"] == pytest.approx(1200, rel=0.01)


@pytest.mark.parametrize(
    ("name", "mime", "rate", "fps"),
    [
        ("clip.mp4", "video/mp4", "30", 30.0),
        ("clip.mkv", "video/x-matroska", "30", 30.0),
        ("clip.mp4", "video/mp4", "30000/1001", 29.97),
        ("clip.mkv", "video/x-matroska", "30000/1001", 29.97),
    ],
)
def test_an_honest_files_frame_rate_is_still_its_headers(
    tmp_path: Path, name: str, mime: str, rate: str, fps: float
) -> None:
    path = tmp_path / name
    ffmpeg(
        *("-f", "lavfi", "-i", f"testsrc2=size=64x48:rate={rate}:duration=3"),
        *("-f", "lavfi", "-i", "sine=frequency=440:duration=3"),
        *("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"),
        *("-c:a", "aac", "-shortest", str(path)),
    )
    data = probe_json(path)
    assert data["picture_packets"] in (89, 90)  # 3 s of them
    video = summarize(data, mime)["video"]
    assert video["fps"] == fps
    assert "header_fps" not in video


def test_a_length_rounded_down_doesnt_raise_an_honest_rate(tmp_path: Path) -> None:
    """Matroska keeps whole milliseconds: 241 frames at 240 fps are written as 1.004 s, which
    is 240.04 fps by the count. The header's 240 stands, or the jobs API would refuse a
    phone's slow motion as over its 240 fps."""
    path = tmp_path / "slow-motion.mkv"
    ffmpeg(
        *("-f", "lavfi", "-i", "testsrc2=size=64x48:rate=240", "-frames:v", "241"),
        *("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)),
    )
    data = probe_json(path)
    assert data["picture_packets"] / float(data["format"]["duration"]) > 240
    assert summarize(data, "video/x-matroska")["video"]["fps"] == 240.0


def test_a_cut_made_without_re_encoding_keeps_its_rate(tmp_path: Path) -> None:
    """3 s copied out of a clip start at the keyframe 5.5 s before: the MP4's edit list hides
    those 165 frames, which are still packets, decoded to show the first frame."""
    whole = tmp_path / "whole.mp4"
    ffmpeg(
        *("-f", "lavfi", "-i", "testsrc2=size=64x48:rate=30:duration=10"),
        *("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(whole)),
    )
    path = tmp_path / "cut.mp4"
    ffmpeg("-ss", "5.5", "-i", str(whole), "-t", "3", "-c", "copy", str(path))
    data = probe_json(path)
    assert data["picture_packets"] == 165 + 90
    record = summarize(data, "video/mp4")
    assert (record["duration_ms"], record["video"]["fps"]) == (3000, 30.0)


def test_a_cut_from_a_long_gop_keeps_its_rate(tmp_path: Path) -> None:
    """60 fps with a keyframe every 10 s (HandBrake's default: ten times the rate). 2 s copied
    out at 19 s bring the 9 s since the keyframe along: 540 hidden frames to 120 shown, which
    read as 330 fps, over what the jobs API takes, when the lead-in was 250 frames at any rate."""
    whole = tmp_path / "whole.mp4"
    ffmpeg(
        *("-f", "lavfi", "-i", "testsrc2=size=64x48:rate=60:duration=21"),
        *("-c:v", "libx264", "-preset", "ultrafast", "-g", "600", "-pix_fmt", "yuv420p"),
        str(whole),
    )
    path = tmp_path / "cut.mp4"
    ffmpeg("-ss", "19", "-i", str(whole), "-t", "2", "-c", "copy", str(path))
    data = probe_json(path)
    assert data["picture_packets"] == 540 + 120
    record = summarize(data, "video/mp4")
    assert (record["duration_ms"], record["video"]["fps"]) == (2000, 60.0)
    assert "header_fps" not in record["video"]


def test_a_variable_frame_rate_still_reads_as_variable(tmp_path: Path) -> None:
    # A wandering clock, like a phone's.
    path = tmp_path / "phone.mp4"
    ffmpeg(
        *("-f", "lavfi", "-i", "testsrc2=size=64x48:rate=30:duration=4"),
        *("-vf", "setpts='(N/30+0.009*sin(N*1.7))/TB'", "-fps_mode", "passthrough"),
        *("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)),
    )
    data = probe_json(path)
    assert data["picture_packets"] == 120
    video = summarize(data, "video/mp4")["video"]
    assert (video["vfr"], video["maybe_vfr"]) == (True, True)
    assert video["fps"] == pytest.approx(30, rel=0.01)


def test_the_packets_say_the_rate_only_when_the_header_says_too_little() -> None:
    def video(packets: object, rate: str = "30/1", seconds: str = "10") -> dict[str, Any]:
        stream = {**VIDEO, "avg_frame_rate": rate, "r_frame_rate": rate}
        data = {
            "format": {"format_name": "mov,mp4", "duration": seconds},
            "streams": [stream],
            "picture_packets": packets,
        }
        found: dict[str, Any] = summarize(data, "video/mp4")["video"]
        return found

    assert video(300)["fps"] == 30.0
    # As many frames as 30 fps shows in the 11.2 s a job may read of it (10 s x 1.02 + 1 s),
    # and a cut's lead-in of 10 s more, 300: what an honest file can hold.
    assert video(636)["fps"] == 30.0
    assert "header_fps" not in video(636)
    # More than that: the frames it holds, over its length.
    assert (video(637)["fps"], video(637)["header_fps"]) == (63.7, 30.0)
    assert video(3000)["fps"] == 300.0
    # The lead-in is so much time, not a share: an hour holds 2 % and 11 s of frames more.
    assert video(110_490, seconds="3600")["fps"] == 30.0
    assert video(110_491, seconds="3600")["fps"] == 30.692
    # It goes by the header's rate (a GOP of 10 s is 600 frames at 60 fps: 2 s cut from one
    # hold 782 at most), and is 250 frames at least (x264's GOP, 20 s of them at 12 fps).
    assert video(782, "60/1", "2")["fps"] == 60.0
    assert video(783, "60/1", "2")["fps"] == 391.5
    assert video(384, "12/1")["fps"] == 12.0
    assert video(385, "12/1")["fps"] == 38.5
    # At the fastest the jobs API takes, 240 fps, that is 2,654 frames hidden in 3 s (2 % and
    # 11 s of them): a fixed stretch, not the multiple a header could hide before.
    assert video(240 * 3 + 2654, "240/1", "3")["fps"] == 240.0
    assert video(240 * 3 + 2655, "240/1", "3")["fps"] == 1125.0
    # Fewer (its picture ends before its sound), or not counted: the header's rate.
    assert video(120)["fps"] == 30.0
    assert video(None)["fps"] == 30.0
    assert video("3000")["fps"] == 30.0
    # A header with no rate.
    assert (video(300, "0/0")["fps"], video(300, "0/0")["header_fps"]) == (30.0, None)
    assert video(0, "0/0")["fps"] is None
    # No length (a still image): nothing to divide by.
    assert video(1, "25/1", "0")["fps"] == 25.0
    # The GPU function reads the header whatever the packets say, so its frame cap counts
    # at the rate it picks from that: 120 at most for half a frame a second, 30 for none.
    slow, unsaid = video(1000, "1/2"), video(100, "0/0")
    assert (slow["fps"], upscale_video.reading_fps({"video": slow})) == (100.0, 120.0)
    assert (unsaid["fps"], upscale_video.reading_fps({"video": unsaid})) == (10.0, 30.0)


@pytest.mark.parametrize(
    ("failure", "code"), [("TIMEOUT", "TIMEOUT"), ("TOOL_FAILED", "UNSUPPORTED_FORMAT")]
)
def test_a_picture_whose_frames_cant_be_counted_is_refused(
    media: dict[str, Any], monkeypatch: pytest.MonkeyPatch, failure: str, code: str
) -> None:
    """Its frame rate would be the uploader's word: the count fails closed."""

    def failing(args: list[str], **kwargs: Any) -> str:
        if "-count_packets" in args:
            raise ToolError(failure, "stopped")
        return run(args, **kwargs)

    monkeypatch.setattr(probe_module, "run", failing)
    with pytest.raises(ProbeRefused) as refused:
        probe_json(media["mp4"])
    assert refused.value.code == code


def test_a_still_image_isnt_counted(tmp_path: Path) -> None:
    from etb_worker.gpu.check import tiny_png  # noqa: PLC0415 - a test input

    png = tmp_path / "input"
    png.write_bytes(tiny_png(40, 30))
    assert "picture_packets" not in probe_json(png)


# --- ffprobe's answer, kept in the worker's own memory ------------------------------------

MIB = 1024 * 1024


def tagged(path: Path, tags: str, *maps: str) -> Path:
    """A 1 s Matroska clip with an ffmetadata file's tags (too long for a command line)."""
    notes = path.with_suffix(".txt")
    notes.write_text(";FFMETADATA1\n" + tags)
    ffmpeg(
        *("-f", "lavfi", "-i", "testsrc=size=64x48:rate=25:duration=1", "-i", str(notes)),
        *("-map", "0", *maps, "-c:v", "libx264", "-preset", "ultrafast", "-f", "matroska"),
        str(path),
    )
    return path


def stdout_read(monkeypatch: pytest.MonkeyPatch) -> list[list[int]]:
    """Each sandboxed tool's stdout as the worker got it: the length of every piece."""
    read: list[list[int]] = []

    def watching(args: list[str], **kwargs: Any) -> str:
        on_line = kwargs["on_line"]
        pieces: list[int] = []
        read.append(pieces)

        def watch(line: str) -> None:
            pieces.append(len(line))
            on_line(line)

        return run(args, **{**kwargs, "on_line": watch})

    monkeypatch.setattr(probe_module, "run", watching)
    return read


def test_tags_the_probe_doesnt_read_never_reach_the_worker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Asked for everything, ffprobe prints every tag the uploader wrote: megabytes of them
    were held in the worker's own memory, outside the sandbox's limits."""
    path = tagged(tmp_path / "input", f"comment={'x' * 4 * MIB}\n", "-map_metadata", "1")
    assert path.stat().st_size > 4 * MIB
    read = stdout_read(monkeypatch)
    record = summarize(probe_json(path), "video/x-matroska")
    assert (record["video"]["width"], record["video"]["fps"], record["duration_ms"]) == (
        *(64, 25.0, 1000),
    )
    assert max(sum(pieces) for pieces in read) < 4096


def rotate_tagged(tmp_path: Path, length: int) -> Path:
    """A clip whose ``rotate`` tag is ``length`` digits. ffmpeg won't write that name in
    Matroska, so another of the same length is patched, as a crafted upload would be."""
    made = tagged(
        tmp_path / "made.mkv",
        f"[STREAM]\nXOTATE={'9' * length}\n",
        *("-map_metadata:s:v:0", "1:s:0"),
    )
    path = tmp_path / "input"
    path.write_bytes(made.read_bytes().replace(b"XOTATE", b"rotate"))
    return path


def test_an_answer_too_long_to_keep_refuses_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The one tag the probe reads (``rotate``) is as long as the uploader likes: 8 MiB here."""
    path = rotate_tagged(tmp_path, 8 * MIB)
    read = stdout_read(monkeypatch)
    tracemalloc.start()
    try:
        with pytest.raises(ProbeRefused) as refused:
            probe_json(path)
        _now, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert refused.value.code == "UNSUPPORTED_FORMAT"
    # Read a piece at a time, kept up to the limit, and ffprobe stopped there: the worker
    # never held the tag, and nothing ran after the refusal.
    assert max(read[0]) <= MAX_LINE
    assert peak < 2 * MAX_ANSWER
    assert len(read) == 1


def test_a_line_too_long_to_read_whole_refuses_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A ``rotate`` tag of 100 KiB fits in what is kept of an answer, but not in what is read
    of a line at once: in pieces it isn't ffprobe's JSON any more, so the file is refused."""
    path = rotate_tagged(tmp_path, 100 * 1024)
    read = stdout_read(monkeypatch)
    with pytest.raises(ProbeRefused) as refused:
        probe_json(path)
    assert refused.value.code == "UNSUPPORTED_FORMAT"
    assert MAX_LINE < sum(read[0]) < MAX_ANSWER
    assert max(read[0]) == MAX_LINE
    assert len(read) == 1
