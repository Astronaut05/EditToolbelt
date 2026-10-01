"""V16 Burn Subtitles (tools/video.md -> V16 tests): the subtitles are in the
picture at the right times and places, checked by pixels, without OCR."""

from __future__ import annotations

import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

import pytest

from etb_worker.probe import probe_json, summarize
from etb_worker.processors import PROCESSORS, JobContext
from etb_worker.processors.burn_subtitles import ass_color, force_style, utf8_text
from etb_worker.sandbox import Limits

W, H = 320, 240
SRT = "1\n00:00:01,000 --> 00:00:02,000\nHELLO WORLD\n\n"
ASS = (
    "[Script Info]\nScriptType: v4.00+\nPlayResX: 384\nPlayResY: 288\n\n"
    "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
    "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, "
    "Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
    "Style: Default,Noto Sans,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,"
    "0,0,1,1,0,8,10,10,10,1\n\n"
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,HELLO\n"
)


def test_styles_become_libass_settings() -> None:
    assert ass_color("#ffcc00") == "&H0000CCFF"
    assert ass_color("#000000", alpha=0x80) == "&H80000000"
    style = force_style({"font": "serif", "size": "large", "color": "#ffff00", "position": "top"})
    assert "FontName=Noto Serif" in style
    assert "FontSize=26" in style
    assert "PrimaryColour=&H0000FFFF" in style
    assert "Alignment=6" in style
    assert "BorderStyle=1" in style
    boxed = force_style({"box": True, "width": "narrow"})
    assert "BorderStyle=3" in boxed
    assert "MarginL=64" in boxed


def test_reads_subtitles_saved_in_other_encodings() -> None:
    assert utf8_text("Привет".encode()) == "Привет"
    assert utf8_text("Привет, мир".encode("cp1251")) == "Привет, мир"
    assert utf8_text("Café crème".encode("cp1252")) == "Café crème"
    assert utf8_text("Hola".encode("utf-16")) == "Hola"


@pytest.fixture(scope="module")
def grey_clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    path = tmp_path_factory.mktemp("burn") / "grey.mp4"
    subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-hide_banner", "-loglevel", "error", "-y"),
            *("-f", "lavfi", "-i", f"color=c=gray:s={W}x{H}:r=25:d=3"),
            *("-f", "lavfi", "-i", "sine=frequency=440:duration=3"),
            *("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path)),
        ],
        check=True,
    )
    return path


def burn(clip: Path, tmp_path: Path, text: str, kind: str, options: dict[str, Any]) -> Any:
    work = tmp_path / "work"
    work.mkdir()
    shutil.copy(clip, work / "input")
    (work / "extra-0").write_text(text)
    meta = summarize(probe_json(clip), "video/mp4")
    meta["extras"] = [{"container": kind}]
    ctx = JobContext(
        job_id="test",
        tool_id="burn-subtitles",
        input_path=work / "input",
        workdir=work,
        options=options,
        meta=meta,
        limits=Limits(timeout_sec=120),
        cancel=threading.Event(),
        progress=lambda _pct, _stage: None,
        extra_paths=[work / "extra-0"],
    )
    return PROCESSORS["burn-subtitles"].run(ctx)


def frame(path: Path, at: float) -> bytes:
    return subprocess.run(  # noqa: S603
        [
            *("ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(at), "-i", str(path)),
            *("-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"),
        ],
        check=True,
        capture_output=True,
    ).stdout


def rows_with(pixels: bytes, test: Any, least: int = 1) -> list[int]:
    """Rows where at least `least` pixels pass `test`."""
    return [y for y in range(H) if sum(1 for x in range(W) if test(pixels[y * W + x])) >= least]


def test_white_text_shows_at_its_time_at_the_bottom(grey_clip: Path, tmp_path: Path) -> None:
    output = burn(grey_clip, tmp_path, SRT, "srt", {"color": "#ffffff", "position": "bottom"})
    before, during, after = (frame(output.path, at) for at in (0.5, 1.5, 2.5))

    def white(value: int) -> bool:
        return value > 200

    assert rows_with(before, white) == []
    assert rows_with(after, white) == []
    lit = rows_with(during, white)
    assert lit
    assert min(lit) > H * 2 / 3  # the bottom third
    assert output.meta["notes"] == ["Noto Sans, medium"]
    streams = subprocess.run(  # noqa: S603
        [
            *("ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0"),
            str(output.path),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    assert streams == ["h264", "aac"]


def test_top_position_and_the_background_box(grey_clip: Path, tmp_path: Path) -> None:
    output = burn(grey_clip, tmp_path, SRT, "srt", {"position": "top", "box": True})
    during = frame(output.path, 1.5)
    lit = rows_with(during, lambda value: value > 200)
    assert lit
    assert max(lit) < H / 3  # the top third
    # The box darkens a band around the text, wider than an outline would.
    dark = rows_with(during, lambda value: value < 90, least=20)
    assert len(dark) > len(lit) + 6


def test_an_ass_file_keeps_its_own_style(grey_clip: Path, tmp_path: Path) -> None:
    # The file says top centre; the options say bottom: the file wins.
    output = burn(grey_clip, tmp_path, ASS, "ass", {"position": "bottom"})
    lit = rows_with(frame(output.path, 1.5), lambda value: value > 200)
    assert lit
    assert max(lit) < H / 3
    assert output.meta["notes"] == ["The ASS file's own styles were kept"]
