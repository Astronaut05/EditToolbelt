"""P08 Upscale Image (tools/photo.md -> P08) on a GPU: Real-ESRGAN, 2x or 4x.

The GPU function (modal_app.upscale_image) reads the image from its
presigned URL, runs the network in tiles and writes the result straight to
storage, so the worker only presigns, waits and records. The web has
already checked the output's size (64 MP at most) and priced it per output
megapixel from the probe.
"""

from __future__ import annotations

from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output
from etb_worker.processors.remote import run_on_gpu

#: The output is capped here (tools/photo.md -> P08); the web refuses bigger before charging.
MAX_OUTPUT_PIXELS = 64_000_000
CONTENT_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
#: Denoise levels (the API's names) as Real-ESRGAN's denoise strength: 0 keeps the grain.
DENOISE = {"none": 0.0, "low": 0.3, "medium": 0.5, "high": 1.0}
#: Rough GPU seconds per output megapixel, plus loading and writing; for progress only.
SECONDS_PER_MP = 0.6
OVERHEAD_SEC = 8.0


def _scale(options: dict[str, Any]) -> int:
    return 2 if str(options.get("scale")) == "2" else 4


def output_size(meta: dict[str, Any], options: dict[str, Any]) -> tuple[int, int]:
    video = meta.get("video") or {}
    scale = _scale(options)
    return int(video.get("width") or 0) * scale, int(video.get("height") or 0) * scale


class UpscaleImage:
    tool_id = "upscale-image"
    remote = True

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        width, height = output_size(meta, options)
        return Estimate(seconds=OVERHEAD_SEC + SECONDS_PER_MP * width * height / 1e6)

    def run(self, ctx: JobContext) -> Output:
        width, height = output_size(ctx.meta, ctx.options)
        if width <= 0 or height <= 0:
            raise JobFailed("DECODE_FAILED", "This file isn't an image we can read.")
        if width * height > MAX_OUTPUT_PIXELS:
            raise JobFailed(
                "TOO_LARGE",
                f"The result would be {width} × {height} px; we make up to 64 MP. "  # noqa: RUF001
                "Pick 2×, or a smaller image.",  # noqa: RUF001
            )
        fmt = str(ctx.options.get("format") or "png")
        if fmt not in CONTENT_TYPES:
            fmt = "png"
        options = {
            "scale": _scale(ctx.options),
            "model": "anime" if ctx.options.get("model") == "anime" else "general",
            "denoise": DENOISE.get(str(ctx.options.get("denoise")), DENOISE["medium"]),
            "format": fmt,
        }
        outcome = run_on_gpu(
            ctx,
            function="upscale_image",
            options=options,
            content_type=CONTENT_TYPES[fmt],
            estimate_sec=self.estimate(ctx.meta, ctx.options).seconds,
            stage="upscaling",
        )
        meta = outcome.result.meta
        return Output(
            path=None,
            key=outcome.key,
            bytes=outcome.bytes,
            content_type=CONTENT_TYPES[fmt],
            ext=fmt,
            meta={
                "width": int(meta.get("width") or width),
                "height": int(meta.get("height") or height),
                "model": options["model"],
                "notes": outcome.result.notes,
            },
        )


PROCESSOR: UpscaleImage = UpscaleImage()
