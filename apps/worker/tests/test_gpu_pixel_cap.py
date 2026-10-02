"""Upscale Image and Object Eraser decode no bigger picture than was priced (P08, P17).

The worker prices an image from its probe (ffprobe). A crafted file can show
Pillow, in the GPU function, a bigger picture than ffprobe saw: the job would
then cost more GPU time than was paid for. The worker sends the priced size
(``max_pixels``) and the function refuses a bigger picture from its header,
before decoding a pixel. Pillow and NumPy live only in the GPU images, so the
function's reader runs here against stand-ins that record what was decoded.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
import sys
import types
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from etb_worker.gpu import modal_app
from etb_worker.gpu.remote import Call, CallFailed, check_pixels
from etb_worker.probe import probe_json, summarize
from etb_worker.processors.upscale_image import priced_pixels

TINY = "data:image/png;base64," + base64.b64encode(b"stand-in").decode()


def test_a_picture_up_to_its_priced_size_passes_and_a_bigger_one_is_refused() -> None:
    check_pixels(4000, 3000, 12_000_000)
    check_pixels(3000, 4000, 12_000_000)  # the same photo turned
    check_pixels(10, 10, 12_000_000)
    with pytest.raises(CallFailed) as refused:
        check_pixels(4001, 3000, 12_000_000)
    assert refused.value.code == "TOO_LARGE"
    assert str(refused.value) == (
        "This image is 4001 × 3000 px, bigger than its file said when it was priced. "  # noqa: RUF001
        "Save it again from an image editor and try again."
    )


class Decoded(Exception):
    """Raised by the stand-in Pillow as soon as anything would decode pixels."""


@pytest.fixture
def pillow(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Stand-ins for Pillow and NumPy: an image of ``size`` whose decoding is recorded."""
    seen: dict[str, Any] = {"size": (4000, 3000), "decoded": False}

    class Opened:
        def __init__(self) -> None:
            self.width, self.height = seen["size"]

        def __enter__(self) -> Opened:
            return self

        def __exit__(self, *_exc: object) -> None:
            return None

    def exif_transpose(_image: Opened) -> Any:
        seen["decoded"] = True
        raise Decoded

    image = types.ModuleType("PIL.Image")
    image.open = lambda _path: Opened()  # type: ignore[attr-defined]
    image.DecompressionBombError = type("DecompressionBombError", (Exception,), {})  # type: ignore[attr-defined]
    image.MAX_IMAGE_PIXELS = None  # type: ignore[attr-defined]
    ops = types.ModuleType("PIL.ImageOps")
    ops.exif_transpose = exif_transpose  # type: ignore[attr-defined]
    package = types.ModuleType("PIL")
    package.Image = image  # type: ignore[attr-defined]
    package.ImageOps = ops  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "PIL", package)
    monkeypatch.setitem(sys.modules, "PIL.Image", image)
    monkeypatch.setitem(sys.modules, "PIL.ImageOps", ops)
    monkeypatch.setitem(sys.modules, "numpy", types.ModuleType("numpy"))
    seen["image"] = image
    return seen


def test_the_reader_refuses_from_the_header_before_decoding(
    pillow: dict[str, Any], tmp_path: Path
) -> None:
    with pytest.raises(CallFailed) as refused:
        modal_app._read_image(tmp_path / "input", [], 4000 * 3000 - 1)
    assert refused.value.code == "TOO_LARGE"
    assert pillow["decoded"] is False
    # Pillow's own decompression-bomb guard is set as before.
    assert pillow["image"].MAX_IMAGE_PIXELS == modal_app.MAX_IMAGE_PIXELS


def test_the_reader_decodes_a_picture_of_its_priced_size(
    pillow: dict[str, Any], tmp_path: Path
) -> None:
    with pytest.raises(Decoded):
        modal_app._read_image(tmp_path / "input", [], 4000 * 3000)
    assert pillow["decoded"] is True


@pytest.mark.parametrize(
    ("call", "extra"),
    [
        (modal_app.upscale_image, {"scale": 2, "model": "general", "denoise": 0.5}),
        (modal_app.erase_object, None),
    ],
)
def test_each_image_function_answers_too_large_with_its_sentence(
    pillow: dict[str, Any], call: Any, extra: dict[str, Any] | None
) -> None:
    """Run as Modal would (``.local()``), the refusal is the answer, not an exception."""
    options = {**(extra or {}), "format": "png", "max_pixels": 1000}
    if extra is None:
        answer = call.local(TINY, None, options, [TINY])
    else:
        answer = call.local(TINY, None, options)
    assert answer["ok"] is False
    assert answer["code"] == "TOO_LARGE"
    assert "4000 × 3000 px, bigger than its file said" in answer["detail"]  # noqa: RUF001
    assert pillow["decoded"] is False


def test_without_a_cap_a_function_takes_its_hard_one(
    pillow: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A worker from before the cap sends none: the function's 100 MP, never "no limit"."""
    caps: list[int] = []

    def read(_source: Path, _notes: list[str], cap: int) -> Any:
        caps.append(cap)
        raise Decoded

    monkeypatch.setattr(modal_app, "_read_image", read)
    call = Call(gpu="T4", idle_tail_seconds=10)
    runs: list[Callable[[], object]] = [
        lambda: modal_app._upscale(tmp_path / "in", tmp_path / "out.png", {}, call),
        lambda: modal_app._erase(tmp_path / "in", tmp_path / "mask", tmp_path / "o.png", {}, call),
    ]
    for run in runs:
        with pytest.raises(Decoded):
            run()
    assert caps == [modal_app.MAX_IMAGE_PIXELS] * 2


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
@pytest.mark.parametrize(
    ("name", "codec", "pix_fmt", "mime"),
    [
        ("png", "png", "rgba", "image/png"),
        ("jpg", "mjpeg", "yuvj420p", "image/jpeg"),
        ("webp", "libwebp", "yuva420p", "image/webp"),
    ],
)
def test_an_honest_image_is_priced_at_its_own_size(
    tmp_path: Path, name: str, codec: str, pix_fmt: str, mime: str
) -> None:
    """The cap the worker sends from its own probe is every pixel of a real file."""
    made = tmp_path / f"honest.{name}"
    subprocess.run(  # noqa: S603
        [
            *(shutil.which("ffmpeg") or "ffmpeg", "-v", "error", "-y", "-f", "lavfi"),
            *("-i", "testsrc=size=97x61:rate=1:duration=1", "-frames:v", "1"),
            *("-c:v", codec, "-pix_fmt", pix_fmt, str(made)),
        ],
        check=True,
        timeout=60,
    )
    # Stored as uploads are, with no name to go by: ffprobe reads the content.
    source = made.rename(tmp_path / "input")
    meta = summarize(probe_json(source), mime)
    assert priced_pixels(meta) == 97 * 61
