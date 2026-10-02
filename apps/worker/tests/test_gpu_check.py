"""The GPU smoke run's inputs (gpu/check.py): tiny, valid, and one for every tool function."""

from __future__ import annotations

import base64
import shutil
import struct
import zlib
from fractions import Fraction
from pathlib import Path
from typing import Any

import pytest

from etb_worker.gpu import check, inpaint, modal_app, video


def test_every_tool_function_has_a_smoke_input() -> None:
    assert set(check.SMOKE) == set(modal_app.SPECS)
    for inputs, _expect in check.SMOKE.values():
        assert inputs["input_url"].startswith("data:")
        assert len(inputs["input_url"]) < 128_000  # tiny: a few GPU-seconds each
        assert "output_url" not in inputs  # nothing is stored anywhere


def png_pixels(data: bytes) -> tuple[int, int, int, bytes]:
    """Width, height, colour type and the filtered rows of an uncompressed-filter PNG."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height, _depth, colour = struct.unpack(">IIBB", data[16:26])
    start = data.index(b"IDAT") + 4
    length = struct.unpack(">I", data[start - 8 : start - 4])[0]
    return width, height, colour, zlib.decompress(data[start : start + length])


def test_the_mask_marks_the_middle_of_the_picture() -> None:
    width, height, colour, rows = png_pixels(check.tiny_mask())
    assert (width, height, colour) == (32, 24, 0)
    assert inpaint.mask_fits(width, height, 32, 24)
    marked = [
        (x, y) for y in range(height) for x in range(width) if rows[y * (width + 1) + 1 + x] == 255
    ]
    assert len(marked) == 16 * 12
    assert min(marked) == (8, 6)
    cell = inpaint.cell_size(width, height)
    cells = {(x // cell, y // cell) for x, y in marked}
    assert len(inpaint.plan(cells, cell, width, height)) == 1


@pytest.mark.skipif(shutil.which("ffprobe") is None, reason="ffmpeg not installed")
def test_the_clip_is_one_second_that_ffmpeg_reads(tmp_path: Path) -> None:
    clip = tmp_path / "input"
    clip.write_bytes(check.tiny_y4m())
    info = video.probe(clip)
    assert (info.width, info.height, info.fps, info.frames) == (64, 48, Fraction(12), 12)
    assert info.audio is None
    url = check.SMOKE["upscale_video"][0]["input_url"]
    assert base64.b64decode(url.split(",", 1)[1]) == check.tiny_y4m()


def test_the_smoke_run_checks_each_answer(capsys: pytest.CaptureFixture[str]) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    def call(name: str, **kwargs: Any) -> dict[str, Any]:
        calls.append((name, kwargs))
        expect = check.SMOKE[name][1]
        return {"ok": True, "gpu": "T4", "gpu_seconds": 1.0, "cold": True, "meta": dict(expect)}

    assert check.smoke(call)
    assert [name for name, _ in calls] == list(check.SMOKE)
    erase = dict(calls)["erase_object"]
    assert erase["output_url"] is None
    assert erase["extra_urls"][0].startswith("data:image/png;base64,")

    def wrong(name: str, **_kwargs: Any) -> dict[str, Any]:
        return {"ok": True, "meta": {"width": 1}} if name == "upscale_video" else call(name)

    assert not check.smoke(wrong)
    assert "upscale_video: FAILED" in capsys.readouterr().out
