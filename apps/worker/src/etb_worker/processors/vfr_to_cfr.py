"""V15 VFR to CFR (tools/video.md -> V15): phone and screen recordings on a
steady clock, so they stay in sync in Premiere and Resolve.

ffmpeg's fps filter places every frame on the new clock by its timestamp,
repeating or dropping one where the phone's clock wandered, so the picture
keeps its timing to within a frame. The audio is resampled against its own
timestamps (gaps filled, drift absorbed) and re-encoded, so it lines up
with the new frames from start to end. The picture is encoded visually
lossless by default with a keyframe every second, which editors scrub well.
A 10-bit source stays 10-bit (H.265) with its colour; 8-bit becomes H.264.

The web refuses a file the probe found already constant before any job is
made: nothing to fix, nothing to pay.
"""

from __future__ import annotations

from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output, ffmpeg_progress
from etb_worker.processors.compress_video import display_size
from etb_worker.sandbox import ffmpeg

#: The rates editors use, as ffmpeg writes them, and as people say them.
RATES: dict[str, tuple[str, float]] = {
    "23.976": ("24000/1001", 24000 / 1001),
    "24": ("24", 24.0),
    "25": ("25", 25.0),
    "29.97": ("30000/1001", 30000 / 1001),
    "30": ("30", 30.0),
    "50": ("50", 50.0),
    "59.94": ("60000/1001", 60000 / 1001),
    "60": ("60", 60.0),
}
#: CRF by quality: "best" is visually lossless.
CRF = {
    "h264": {"best": 16, "high": 20, "small": 24},
    "h265": {"best": 18, "high": 22, "small": 26},
}
AUDIO_BPS = 256_000


def target_rate(meta: dict[str, Any], option: str) -> tuple[str, str, float]:
    """The rate to put the frames on: (label, ffmpeg's rate, frames a second)."""
    if option in RATES:
        rate, fps = RATES[option]
        return option, rate, fps
    average = float((meta.get("video") or {}).get("fps") or 30)
    label = min(RATES, key=lambda name: abs(RATES[name][1] - average))
    rate, fps = RATES[label]
    return label, rate, fps


class VfrToCfr:
    tool_id = "vfr-to-cfr"

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        video = meta.get("video") or {}
        pixels = int(video.get("width") or 1920) * int(video.get("height") or 1080)
        frames = float(meta.get("duration_ms") or 0) / 1000 * float(video.get("fps") or 30)
        return Estimate(seconds=frames * pixels / (1920 * 1080 * 90))

    def run(self, ctx: JobContext) -> Output:
        video = ctx.meta.get("video")
        if not video:
            raise JobFailed("NO_VIDEO", "This file has no video to convert.")
        label, rate, _fps = target_rate(ctx.meta, str(ctx.options.get("fps") or "auto"))
        quality = str(ctx.options.get("quality") or "best")
        ten_bit = "10" in str(video.get("pix_fmt") or "")
        codec = "h265" if ten_bit else "h264"
        gop = str(round(RATES[label][1]))
        if codec == "h265":
            picture = [
                *("-c:v", "libx265", "-preset", "medium", "-crf", str(CRF[codec][quality])),
                *("-pix_fmt", "yuv420p10le", "-tag:v", "hvc1"),
                *("-x265-params", f"keyint={gop}:log-level=error"),
            ]
        else:
            picture = [
                *("-c:v", "libx264", "-preset", "medium", "-crf", str(CRF[codec][quality])),
                *("-pix_fmt", "yuv420p", "-g", gop),
            ]
        keep_audio = ctx.meta.get("audio") and ctx.options.get("audio", "keep") != "remove"
        sound = (
            [
                *("-map", "0:a:0", "-c:a", "aac", "-b:a", str(AUDIO_BPS), "-ar", "48000"),
                *("-af", "aresample=async=1000"),
            ]
            if keep_audio
            else ["-an"]
        )
        out = ctx.workdir / "out.mp4"
        report = ffmpeg_progress(
            int(ctx.meta.get("duration_ms") or 0), ctx.progress, "converting", 0, 98
        )
        ctx.run(
            ffmpeg(
                *("-i", ctx.input_path.name, "-map", "0:v:0"),
                *("-vf", f"fps={rate}", "-fps_mode", "cfr", "-r", rate),
                *picture,
                *sound,
                *("-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart"),
                out.name,
            ),
            on_line=report,
        )
        if not out.exists() or out.stat().st_size == 0:
            raise JobFailed("TOOL_FAILED", "The converted video came out empty.")
        source = float(video.get("fps") or 0)
        width, height = display_size(video)
        notes = [
            f"Constant {label} fps"
            + (f", the nearest standard rate to its average of {source:.2f} fps" if source else "")
            + (" (picked for you)" if ctx.options.get("fps", "auto") == "auto" else ""),
        ]
        if keep_audio:
            notes.append("The sound was re-timed to the new frames, so it stays in sync")
        if ten_bit:
            notes.append("Kept in 10-bit, as H.265, so its colour is unchanged")
        return Output(
            path=out,
            content_type="video/mp4",
            ext="mp4",
            meta={
                "width": width,
                "height": height,
                "fps": label,
                "codec": "H.265" if ten_bit else "H.264",
                "notes": notes,
            },
        )


PROCESSOR: VfrToCfr = VfrToCfr()
