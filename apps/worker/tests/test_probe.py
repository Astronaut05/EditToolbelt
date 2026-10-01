from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import pytest

from etb_worker.probe import ProbeRefused, probe_json, summarize, variable_frame_rate

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
