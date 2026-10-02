"""V02 Compress Video on the server (tools/video.md -> V02): ffmpeg, two-pass.

The plan is the browser tool's (packages/engines/src/video/compress.ts), so
the same settings give the same picture size either way:
- a size target leaves (target x 0.97 x 8 / duration) - audio bits a second
  for the video; when that is too few bits per pixel for the picture, Auto
  resolution steps the size down until it looks right again;
- a quality level is a CRF.
Two passes put a size target within a few percent; if the result still
overshoots, the second pass runs again with the bitrate scaled down.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output, ffmpeg_progress
from etb_worker.sandbox import ffmpeg

MB = 1_000_000
SHORT_SIDES = (2160, 1440, 1080, 720, 540, 480, 360, 240)
#: Below this many video bits a second, no size of picture looks like anything.
MIN_VIDEO_BPS = 50_000
#: Re-encoded audio: AAC in MP4, Opus in WebM.
AUDIO_BPS = {"aac": 128_000, "opus": 96_000}
#: Copied audio whose container didn't say its bitrate.
UNKNOWN_AUDIO_BPS = 192_000

CODECS: dict[str, dict[str, Any]] = {
    "h264": {
        "encoder": "libx264",
        "args": ["-preset", "medium", "-profile:v", "high"],
        "crf": {"high": 20, "medium": 24, "small": 28},
        "container": "mp4",
        "label": "H.264",
    },
    "h265": {
        "encoder": "libx265",
        "args": ["-preset", "fast", "-tag:v", "hvc1"],
        "crf": {"high": 22, "medium": 26, "small": 30},
        "container": "mp4",
        "label": "H.265",
    },
    "av1": {
        "encoder": "libsvtav1",
        "args": ["-preset", "8"],
        "crf": {"high": 30, "medium": 35, "small": 40},
        "container": "mp4",
        "label": "AV1",
    },
    "vp9": {
        "encoder": "libvpx-vp9",
        "args": ["-deadline", "good", "-cpu-used", "4", "-row-mt", "1"],
        "crf": {"high": 30, "medium": 34, "small": 38},
        "container": "webm",
        "label": "VP9",
    },
}


def min_bpp(codec: str) -> float:
    """Bits per pixel per frame below which video turns blocky (H.265 and AV1 manage with less)."""
    return 0.035 if codec in ("h265", "av1") else 0.05


def even(n: float) -> int:
    return max(2, round(n / 2) * 2)


def size_for_short_side(width: int, height: int, short: int) -> tuple[int, int]:
    """A frame size with the given short side, keeping the shape."""
    scale = short / min(width, height)
    if height > width:
        return even(short), even(height * scale)
    return even(width * scale), even(short)


@dataclass
class Plan:
    width: int
    height: int
    codec: str
    container: str
    #: Set when lowering the frame rate.
    fps: float | None = None
    #: Size mode.
    target_bytes: int | None = None
    video_bps: int | None = None
    #: Quality mode.
    crf: int | None = None
    #: "copy", "aac", "opus", or None for no audio.
    audio: str | None = None
    audio_bps: int = 0
    notes: list[str] = field(default_factory=list)


def display_size(video: dict[str, Any]) -> tuple[int, int]:
    """The picture as shown: phones store portrait video sideways with a rotation."""
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if int(video.get("rotation") or 0) in (90, 270):
        return height, width
    return width, height


def _audio_plan(
    meta: dict[str, Any], options: dict[str, Any], container: str
) -> tuple[str | None, int]:
    """Copy audio the container takes as it is; re-encode the rest; or none."""
    source = meta.get("audio")
    if not source or options.get("audio", "keep") == "remove":
        return None, 0
    native = "aac" if container == "mp4" else "opus"
    if source.get("codec") == native:
        return "copy", int(source.get("bit_rate") or UNKNOWN_AUDIO_BPS)
    return native, AUDIO_BPS[native]


def _too_small(target_mb: float, audio_bps: int, duration: float) -> JobFailed:
    audio_mb = audio_bps * duration / 8 / MB
    if audio_bps and audio_mb > target_mb * 0.5:
        return JobFailed(
            "TARGET_TOO_SMALL",
            f"{target_mb:g} MB is too small for this video: the sound alone takes "
            f"{audio_mb:.1f} MB. Remove the audio or pick a bigger size.",
        )
    return JobFailed(
        "TARGET_TOO_SMALL",
        f"{target_mb:g} MB is too small for {round(duration)} s of video. "
        "Pick a bigger size, or trim the video first.",
    )


def plan(meta: dict[str, Any], options: dict[str, Any]) -> Plan:
    """What to encode, from the probe and the checked options (@etb/registry/options)."""
    video = meta.get("video")
    if not video or not video.get("width"):
        raise JobFailed("NO_VIDEO", "This file has no video to compress.")
    duration = float(meta.get("duration_ms") or 0) / 1000
    if duration <= 0:
        raise JobFailed("DECODE_FAILED", "This video's length can't be read, so it can't be sized.")
    codec = str(options.get("codec") or "h264")
    spec = CODECS[codec]
    width, height = display_size(video)
    source_fps = float(video.get("fps") or 30)
    wanted_fps = float(options["fps"]) if options.get("fps", "keep") != "keep" else 0
    fps = wanted_fps if 0 < wanted_fps < source_fps - 0.5 else None

    size = (even(width), even(height))
    resolution = str(options.get("resolution") or "auto")
    if resolution.isdigit() and int(resolution) < min(width, height):
        size = size_for_short_side(width, height, int(resolution))
    audio, audio_bps = _audio_plan(meta, options, str(spec["container"]))
    result = Plan(
        size[0], size[1], codec, str(spec["container"]), fps, audio=audio, audio_bps=audio_bps
    )
    if "10" in str(video.get("pix_fmt") or ""):
        result.notes.append("Saved in 8-bit colour so it plays everywhere")

    if options.get("mode") != "size":
        result.crf = int(spec["crf"][str(options.get("quality") or "medium")])
        return result

    target_mb = float(options["targetMb"])
    video_bps = (target_mb * MB * 0.97 * 8) / duration - audio_bps
    if video_bps < MIN_VIDEO_BPS:
        raise _too_small(target_mb, audio_bps, duration)

    def bpp(w: int, h: int) -> float:
        return video_bps / (w * h * (fps or source_fps))

    if resolution == "auto":
        for side in SHORT_SIDES:
            if bpp(*size) >= min_bpp(codec):
                break
            if side < min(size):
                size = size_for_short_side(width, height, side)
        if size[0] != even(width):
            result.notes.append(
                f"Scaled down to {size[0]} × {size[1]} px, "  # noqa: RUF001
                f"so {target_mb:g} MB still looks clean"
            )
    if bpp(*size) < min_bpp(codec) * 0.6:
        result.notes.append(
            "Very few bits for this length: expect a blocky picture. "
            "A bigger size or a shorter clip helps."
        )
    result.width, result.height = size
    result.target_bytes = round(target_mb * MB)
    result.video_bps = int(video_bps)
    return result


def _filters(p: Plan, source: tuple[int, int]) -> list[str]:
    chain = []
    # Odd sizes are scaled too: 4:2:0 needs even ones.
    if (p.width, p.height) != source:
        chain.append(f"scale={p.width}:{p.height}:flags=lanczos")
    if p.fps:
        chain.append(f"fps={p.fps:g}")
    chain.append("format=yuv420p")
    return ["-vf", ",".join(chain)]


def _video(p: Plan, bitrate: int | None, pass_no: int | None) -> list[str]:
    spec = CODECS[p.codec]
    args = ["-c:v", str(spec["encoder"]), *spec["args"]]
    if bitrate is None:
        args += ["-crf", str(p.crf)]
        if p.codec == "vp9":
            args += ["-b:v", "0"]
        return args
    args += ["-b:v", str(bitrate)]
    if pass_no is None:
        return args
    if p.codec == "h265":
        return [*args, "-x265-params", f"pass={pass_no}:stats=x265.log:log-level=error"]
    return [*args, "-pass", str(pass_no), "-passlogfile", "pass"]


def _audio(p: Plan) -> list[str]:
    if p.audio is None:
        return ["-an"]
    if p.audio == "copy":
        return ["-map", "0:a:0?", "-c:a", "copy"]
    encoder = "aac" if p.audio == "aac" else "libopus"
    return ["-map", "0:a:0?", "-c:a", encoder, "-b:a", str(AUDIO_BPS[p.audio]), "-ac", "2"]


class CompressVideo:
    tool_id = "compress-video"

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        video = meta.get("video") or {}
        pixels = int(video.get("width") or 1920) * int(video.get("height") or 1080)
        frames = float(meta.get("duration_ms") or 0) / 1000 * float(video.get("fps") or 30)
        # About 120 frames a second at 1080p for one medium pass on one worker.
        passes = 2 if options.get("mode") == "size" else 1
        return Estimate(seconds=passes * frames * pixels / (1920 * 1080 * 120))

    def run(self, ctx: JobContext) -> Output:
        p = plan(ctx.meta, ctx.options)
        out = ctx.workdir / f"out.{p.container}"
        source = display_size(ctx.meta["video"])
        duration_ms = int(ctx.meta.get("duration_ms") or 0)
        head = ["-i", ctx.input_path.name, "-map", "0:V:0", *_filters(p, source)]
        tail = ["-map_metadata", "-1", "-map_chapters", "-1"]
        if p.container == "mp4":
            tail += ["-movflags", "+faststart"]

        def encode(bitrate: int | None, start: int, end: int) -> None:
            report = ffmpeg_progress(duration_ms, ctx.progress, "compressing", start, end)
            if bitrate is None or p.codec == "av1":
                # One pass: a quality level, or AV1 (SVT-AV1 aims well at a bitrate alone).
                ctx.run(
                    ffmpeg(*head, *_video(p, bitrate, None), *_audio(p), *tail, out.name),
                    on_line=report,
                )
                return
            half = start + (end - start) * 2 // 5
            first = ffmpeg_progress(duration_ms, ctx.progress, "analysing", start, half)
            ctx.run(ffmpeg(*head, *_video(p, bitrate, 1), "-an", "-f", "null", "-"), on_line=first)
            report = ffmpeg_progress(duration_ms, ctx.progress, "compressing", half, end)
            ctx.run(
                ffmpeg(*head, *_video(p, bitrate, 2), *_audio(p), *tail, out.name),
                on_line=report,
            )

        encode(p.video_bps, 0, 90)
        if p.target_bytes and p.video_bps and out.stat().st_size > p.target_bytes:
            # Overshot: once more, with the bitrate scaled by how far it went over.
            over = out.stat().st_size / p.target_bytes
            encode(int(p.video_bps / over * 0.97), 90, 98)
            if out.stat().st_size > p.target_bytes:
                size_mb = out.stat().st_size / MB
                p.notes.append(f"Came out at {size_mb:.1f} MB, just over the target")
        if not out.exists() or out.stat().st_size == 0:
            raise JobFailed("TOOL_FAILED", "The compressed video came out empty.")
        return Output(
            path=out,
            content_type="video/webm" if p.container == "webm" else "video/mp4",
            ext=p.container,
            meta={
                "width": p.width,
                "height": p.height,
                "codec": CODECS[p.codec]["label"],
                "notes": p.notes,
            },
        )


PROCESSOR: CompressVideo = CompressVideo()
