"""V20 Upscale Video (tools/video.md -> V20) on a GPU: Real-ESRGAN on every frame, 2x or 4x.

The GPU function (modal_app.upscale_video) reads the video from its
presigned URL, decodes it frame by frame, upscales each frame (General with
its noise setting, or the authors' anime video model) and writes H.264 MP4
with the sound straight to storage. The result is 4K at most (3840 x 2160
either way round), and a clip is 18,000 frames at most (10 minutes at
30 fps, 5 at 60): the web refuses bigger before charging, and so does this.
"""

from __future__ import annotations

from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output
from etb_worker.processors.remote import run_on_gpu
from etb_worker.processors.upscale_image import DENOISE

#: tools/video.md -> V20: 4K output, 10 minutes (at 30 fps).
MAX_LONG_SIDE = 3840
MAX_SHORT_SIDE = 2160
MAX_FRAMES = 18_000
#: An L4's seconds for a frame per input megapixel made x4, plus each frame's own; for progress.
SECONDS_PER_FRAME_MP = 0.05
SECONDS_PER_FRAME = 0.01
OVERHEAD_SEC = 20.0


def _scale(options: dict[str, Any]) -> int:
    return 2 if str(options.get("scale")) == "2" else 4


def picture(meta: dict[str, Any]) -> tuple[int, int]:
    """The frames as shown (a phone's rotation applied)."""
    video = meta.get("video") or {}
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if int(video.get("rotation") or 0) % 180 == 90:
        width, height = height, width
    return width, height


def frame_count(meta: dict[str, Any]) -> int:
    """Frames the GPU will see: the length at the clip's rate (30 when it doesn't say)."""
    fps = float((meta.get("video") or {}).get("fps") or 30)
    return round(float(meta.get("duration_ms") or 0) / 1000 * min(fps, 120))


def too_long(meta: dict[str, Any]) -> str | None:
    """Why a clip has more frames than the video tools take, or None."""
    frames = frame_count(meta)
    if frames <= MAX_FRAMES:
        return None
    fps = float((meta.get("video") or {}).get("fps") or 30)
    label = f"{fps:.2f}".rstrip("0").rstrip(".")
    return (
        f"This clip is {frames:,} frames; we take up to {MAX_FRAMES:,}, which is "
        f"{MAX_FRAMES / fps / 60:.1f} min at its {label} fps. Trim it first."
    )


def fits_4k(width: int, height: int) -> bool:
    return max(width, height) <= MAX_LONG_SIDE and min(width, height) <= MAX_SHORT_SIDE


class UpscaleVideo:
    tool_id = "upscale-video"
    remote = True

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        width, height = picture(meta)
        per_frame = SECONDS_PER_FRAME + SECONDS_PER_FRAME_MP * width * height / 1e6
        return Estimate(seconds=OVERHEAD_SEC + frame_count(meta) * per_frame)

    def run(self, ctx: JobContext) -> Output:
        width, height = picture(ctx.meta)
        if width <= 0 or height <= 0:
            raise JobFailed("NO_VIDEO", "This file has no video in it.")
        scale = _scale(ctx.options)
        out_width, out_height = width * scale, height * scale
        if not fits_4k(out_width, out_height):
            raise JobFailed(
                "TOO_LARGE",
                f"At {scale}× this would be {out_width} × {out_height} px; we make up to 4K "  # noqa: RUF001
                "(3840 × 2160). Pick 2×, or a smaller video.",  # noqa: RUF001
            )
        reason = too_long(ctx.meta)
        if reason:
            raise JobFailed("TOO_LARGE", reason)
        options = {
            "scale": scale,
            "model": "anime" if ctx.options.get("model") == "anime" else "general",
            "denoise": DENOISE.get(str(ctx.options.get("denoise")), DENOISE["medium"]),
        }
        outcome = run_on_gpu(
            ctx,
            function="upscale_video",
            options=options,
            content_type="video/mp4",
            estimate_sec=self.estimate(ctx.meta, ctx.options).seconds,
            stage="upscaling",
        )
        meta = outcome.result.meta
        return Output(
            path=None,
            key=outcome.key,
            bytes=outcome.bytes,
            content_type="video/mp4",
            ext="mp4",
            meta={
                "width": int(meta.get("width") or out_width),
                "height": int(meta.get("height") or out_height),
                "model": options["model"],
                "notes": outcome.result.notes,
            },
        )


PROCESSOR: UpscaleVideo = UpscaleVideo()
