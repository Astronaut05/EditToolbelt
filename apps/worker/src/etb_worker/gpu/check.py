"""Checks the GPU app: ``python -m etb_worker.gpu.check [--gpu] [--smoke] [--pins]``.

- no flag: calls ``ping`` (no GPU): the app is deployed and the token works.
- ``--gpu``: also ``gpu_check``, a few seconds on a T4.
- ``--smoke``: also each tool function once on a tiny input it makes itself
  (a 32 x 24 PNG, a 64 x 48 one with a mask, two seconds of tone, a
  one-second 64 x 48 Y4M clip), sent as ``data:`` URLs with no output URL, so nothing
  is stored anywhere. A few GPU-seconds each, plus the cold start
  (Whisper's is the longest, about half a minute).
- ``--pins``: downloads every pinned weights file and checks its SHA-256,
  without Modal (CI runs it when pins.json changes).

CI runs it after each deploy (.github/workflows/modal.yml). It prints
outcomes only; the token comes from MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.
Exits 1 when anything failed.
"""

from __future__ import annotations

import base64
import io
import math
import struct
import sys
import tempfile
import time
import wave
import zlib
from pathlib import Path
from typing import Any

from etb_worker.gpu import APP_NAME
from etb_worker.gpu.weights import PinError, fetch, load_pins


def _png(width: int, height: int, colour: int, rows: bytes) -> bytes:
    """A PNG of 8-bit ``rows`` (each starting with its filter byte); colour type 0 or 2."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, colour, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def tiny_png(width: int = 32, height: int = 24) -> bytes:
    """A gradient PNG, made with the standard library."""
    rows = b"".join(
        b"\x00" + bytes(v for x in range(width) for v in (x * 8 % 256, y * 10 % 256, 128))
        for y in range(height)
    )
    return _png(width, height, 2, rows)


def tiny_mask(width: int = 32, height: int = 24) -> bytes:
    """A grayscale PNG mask: white (erase) in the middle quarter, black around it."""
    rows = b"".join(
        b"\x00"
        + bytes(
            255 if width // 4 <= x < width * 3 // 4 and height // 4 <= y < height * 3 // 4 else 0
            for x in range(width)
        )
        for y in range(height)
    )
    return _png(width, height, 0, rows)


def tiny_y4m(width: int = 64, height: int = 48, frames: int = 12, fps: int = 12) -> bytes:
    """A raw YUV 4:2:0 clip (Y4M, which ffmpeg reads): a square moving over a gradient."""
    out = [f"YUV4MPEG2 W{width} H{height} F{fps}:1 Ip A1:1 C420jpeg\n".encode()]
    side = height // 2
    for n in range(frames):
        left = n * (width - side) // max(1, frames - 1)
        luma = bytes(
            235 if left <= x < left + side and side // 2 <= y < side // 2 + side else 40 + x * 2
            for y in range(height)
            for x in range(width)
        )
        chroma = bytes([128]) * (width // 2) * (height // 2)
        out.append(b"FRAME\n" + luma + chroma + chroma)
    return b"".join(out)


def tiny_wav(seconds: float = 2.0, rate: int = 16_000) -> bytes:
    """A 440 Hz tone, mono 16-bit."""
    frames = b"".join(
        struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * n / rate)))
        for n in range(int(seconds * rate))
    )
    out = io.BytesIO()
    with wave.open(out, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(frames)
    return out.getvalue()


def data_url(content: bytes, content_type: str) -> str:
    return f"data:{content_type};base64,{base64.b64encode(content).decode()}"


#: Each tool function, with its tiny inputs and options, and what its answer must say.
SMOKE: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {
    "upscale_image": (
        {
            "input_url": data_url(tiny_png(), "image/png"),
            "options": {"scale": 2, "model": "general", "denoise": 0.5, "format": "png"},
        },
        {"width": 64, "height": 48},
    ),
    "transcribe": (
        {
            "input_url": data_url(tiny_wav(), "audio/wav"),
            "options": {"language": "en", "task": "transcribe"},
        },
        {},
    ),
    "erase_object": (
        {
            "input_url": data_url(tiny_png(64, 48), "image/png"),
            "options": {"format": "png"},
            "extra_urls": [data_url(tiny_mask(64, 48), "image/png")],
        },
        {"width": 64, "height": 48, "regions": 1},
    ),
    "upscale_video": (
        {
            "input_url": data_url(tiny_y4m(), "video/x-yuv4mpeg"),
            "options": {"scale": 2, "model": "general", "denoise": 0.5},
        },
        {"width": 128, "height": 96, "frames": 12},
    ),
    "remove_video_background": (
        {
            "input_url": data_url(tiny_y4m(), "video/x-yuv4mpeg"),
            "options": {"output": "webm"},
        },
        {"width": 64, "height": 48, "frames": 12},
    ),
}


def smoke(call: Any) -> bool:
    """Runs every function in SMOKE through ``call(name, **kwargs)``; True if all answered ok."""
    good = True
    for name, (inputs, expect) in SMOKE.items():
        started = time.monotonic()
        try:
            answer = call(name, output_url=None, **inputs)
        except Exception as error:  # noqa: BLE001 - report it and carry on with the others
            print(f"{name}: FAILED, {type(error).__name__}")
            good = False
            continue
        wall = time.monotonic() - started
        meta = (answer.get("meta") or {}) if isinstance(answer, dict) else {}
        ok = (
            isinstance(answer, dict)
            and bool(answer.get("ok"))
            and all(meta.get(key) == value for key, value in expect.items())
        )
        good = good and ok
        summary = {key: answer.get(key) for key in ("gpu", "gpu_seconds", "cold", "code")}
        print(f"{name}: {'ok' if ok else 'FAILED'} {summary} ({wall:.1f} s with any cold start)")
    return good


def check_pins() -> bool:
    good = True
    try:
        pins = load_pins()
    except PinError as error:
        print(f"pins.json: {error}")
        return False
    with tempfile.TemporaryDirectory(prefix="etb-pins-") as folder:
        for pin in pins.values():
            try:
                path = fetch(pin, Path(folder))
            except (PinError, OSError) as error:
                print(f"{pin.name}: FAILED, {error}")
                good = False
                continue
            print(f"{pin.name}: ok ({path.stat().st_size} bytes)")
            path.unlink()
    return good


def main(argv: list[str]) -> int:
    if "--pins" in argv:
        return 0 if check_pins() else 1
    import modal  # noqa: PLC0415 - --pins runs without the Modal token

    def call(name: str, **kwargs: Any) -> Any:
        return modal.Function.from_name(APP_NAME, name).remote(**kwargs)

    started = time.monotonic()
    print(f"ping: {call('ping')} ({time.monotonic() - started:.1f} s)")
    good = True
    if "--gpu" in argv:
        started = time.monotonic()
        answer = call("gpu_check")
        print(f"gpu_check: {answer} ({time.monotonic() - started:.1f} s, cold start included)")
    if "--smoke" in argv:
        good = smoke(call)
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
