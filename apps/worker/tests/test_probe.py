from __future__ import annotations

import shutil
import struct
import subprocess
from pathlib import Path
from typing import Any

import pytest

from etb_worker import probe as probe_module
from etb_worker.probe import ProbeRefused, probe_json, summarize, variable_frame_rate
from etb_worker.sandbox import ToolError, run

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
        if "packet=pts_time,duration_time" in args:
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
