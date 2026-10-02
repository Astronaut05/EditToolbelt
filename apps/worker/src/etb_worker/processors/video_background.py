"""V21 Video Background Remover (tools/video.md -> V21) on a GPU: BiRefNet_lite on every frame.

The GPU function (modal_app.remove_video_background) reads the video from
its presigned URL, mattes each frame (with a flicker filter where the
picture holds still) and writes the subject with the sound straight to
storage: on transparency as ProRes 4444 MOV or VP9 WebM with alpha, or on
chroma-key green or a colour as H.264 MP4. Clips are 18,000 frames at most,
up to 4K; ProRes 4444 is big (about 3 GB a minute at 1080p30), so it is
refused before charging when it would pass 4.5 GB, the most one upload
holds with room to spare.
"""

from __future__ import annotations

import re
from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output
from etb_worker.processors.remote import run_on_gpu
from etb_worker.processors.upscale_video import fits_4k, frame_count, picture, too_long

#: Each output's MIME type and extension.
OUTPUTS = {
    "prores": ("video/quicktime", "mov"),
    "webm": ("video/webm", "webm"),
    "green": ("video/mp4", "mp4"),
    "color": ("video/mp4", "mp4"),
}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
#: ProRes 4444 with alpha, bits a pixel: Apple's 330 Mbps for 1080p30, plus about 20 % for alpha.
PRORES_BITS_PER_PIXEL = 6.5
MAX_PRORES_BYTES = 4_500_000_000
#: An L4's seconds for a frame (BiRefNet_lite at 1024 px in fp32, and the compositing); progress.
SECONDS_PER_FRAME = 0.2
OVERHEAD_SEC = 30.0


def prores_bytes(meta: dict[str, Any]) -> int:
    """About how big the ProRes 4444 result of this clip would be."""
    width, height = picture(meta)
    return round(width * height * frame_count(meta) * PRORES_BITS_PER_PIXEL / 8)


class VideoBackground:
    tool_id = "video-background-remover"
    remote = True

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        return Estimate(seconds=OVERHEAD_SEC + frame_count(meta) * SECONDS_PER_FRAME)

    def run(self, ctx: JobContext) -> Output:
        width, height = picture(ctx.meta)
        if width <= 0 or height <= 0:
            raise JobFailed("NO_VIDEO", "This file has no video in it.")
        if not fits_4k(width, height):
            raise JobFailed("TOO_LARGE", "We take video up to 4K (3840 × 2160).")  # noqa: RUF001
        reason = too_long(ctx.meta)
        if reason:
            raise JobFailed("TOO_LARGE", reason)
        output = str(ctx.options.get("output") or "prores")
        if output not in OUTPUTS:
            output = "prores"
        if output == "prores" and prores_bytes(ctx.meta) > MAX_PRORES_BYTES:
            raise JobFailed(
                "TOO_LARGE",
                f"As ProRes 4444 this would be about {prores_bytes(ctx.meta) / 1e9:.1f} GB; we "
                "make up to 4.5 GB. Pick WebM or a green screen, or trim it.",
            )
        options: dict[str, Any] = {"output": output}
        if output == "color":
            colour = str(ctx.options.get("color") or "")
            options["color"] = colour.lower() if HEX.match(colour) else "#00b140"
        content_type, ext = OUTPUTS[output]
        outcome = run_on_gpu(
            ctx,
            function="remove_video_background",
            options=options,
            content_type=content_type,
            estimate_sec=self.estimate(ctx.meta, ctx.options).seconds,
            stage="removing the background",
        )
        meta = outcome.result.meta
        return Output(
            path=None,
            key=outcome.key,
            bytes=outcome.bytes,
            content_type=content_type,
            ext=ext,
            meta={
                "width": int(meta.get("width") or width),
                "height": int(meta.get("height") or height),
                "notes": outcome.result.notes,
            },
        )


PROCESSOR: VideoBackground = VideoBackground()
