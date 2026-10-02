"""P17 Object Eraser (tools/photo.md -> P17) on a GPU: MI-GAN fills what the mask marks.

The job's second input is the mask: a PNG the page draws from the person's
brush strokes, white where to erase. It is the photo's size, or the same
shape scaled down (a browser draws a big photo's mask smaller). The GPU
function (modal_app.erase_object) reads both through presigned URLs, fills
each marked region and writes the photo at its full size straight to
storage; every pixel the mask leaves alone stays as it was (PNG keeps them
exactly). The web has already checked the mask's shape against the photo's
from the two probes; this checks it again before any GPU time is spent.
"""

from __future__ import annotations

from typing import Any

from etb_worker.gpu.inpaint import mask_fits
from etb_worker.processors import Estimate, JobContext, JobFailed, Output
from etb_worker.processors.remote import run_on_gpu

CONTENT_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
#: Loading MI-GAN, reading and writing the photo; a fill is milliseconds. For progress only.
OVERHEAD_SEC = 8.0
SECONDS_PER_MP = 0.4


def _size(probe: dict[str, Any] | None) -> tuple[int, int]:
    picture = (probe or {}).get("video") or {}
    return int(picture.get("width") or 0), int(picture.get("height") or 0)


class ObjectEraser:
    tool_id = "object-eraser"
    remote = True

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        width, height = _size(meta)
        return Estimate(seconds=OVERHEAD_SEC + SECONDS_PER_MP * width * height / 1e6)

    def run(self, ctx: JobContext) -> Output:
        width, height = _size(ctx.meta)
        if width <= 0 or height <= 0:
            raise JobFailed("DECODE_FAILED", "This file isn't an image we can read.")
        if not ctx.extra_input_keys:
            raise JobFailed("BAD_MASK", "No mask came with the image.")
        extras = ctx.meta.get("extras") or []
        mask_width, mask_height = _size(extras[0] if extras else None)
        # A JPEG's probe gives its stored size; the mask is drawn on it upright.
        if mask_width and not (
            mask_fits(mask_width, mask_height, width, height)
            or mask_fits(mask_width, mask_height, height, width)
        ):
            raise JobFailed(
                "BAD_MASK",
                f"The mask is {mask_width} × {mask_height} px, not the shape of the image "  # noqa: RUF001
                f"({width} × {height} px).",  # noqa: RUF001
            )
        fmt = str(ctx.options.get("format") or "png")
        if fmt not in CONTENT_TYPES:
            fmt = "png"
        outcome = run_on_gpu(
            ctx,
            function="erase_object",
            options={"format": fmt},
            content_type=CONTENT_TYPES[fmt],
            estimate_sec=self.estimate(ctx.meta, ctx.options).seconds,
            stage="erasing",
            extra_inputs=True,
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
                "notes": outcome.result.notes,
            },
        )


PROCESSOR: ObjectEraser = ObjectEraser()
