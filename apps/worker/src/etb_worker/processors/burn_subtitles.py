"""V16 Burn Subtitles into Video (tools/video.md -> V16): SRT, VTT or ASS
drawn into the picture with libass.

SRT and VTT take the person's style: font (bundled Noto, which covers Latin,
Cyrillic and Greek), size, color, outline or a background box, top or
bottom, and how wide the lines may run. ASS files keep their own styles,
as written. Sizes are in libass's script units (288 lines high), so they
scale with the video. The subtitle file is read as UTF-8; a file that isn't
is taken as Windows-1251 when that gives Cyrillic, else Windows-1252.
"""

from __future__ import annotations

from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output, ffmpeg_progress
from etb_worker.processors.compress_video import display_size
from etb_worker.sandbox import ffmpeg

#: Bundled fonts (fonts-noto-core in the worker image, OFL).
FONTS = {"sans": "Noto Sans", "serif": "Noto Serif", "mono": "Noto Sans Mono"}
#: In script units: 288 lines high.
SIZES = {"small": 16, "medium": 20, "large": 26}
OUTLINES = {"none": 0.0, "thin": 1.5, "thick": 3.0}
#: libass reads force_style alignment the legacy way: 2 bottom centre, 6 top centre.
POSITIONS = {"bottom": 2, "top": 6}
#: Side margins out of 384 script units across.
WIDTHS = {"full": 20, "narrow": 64}
#: The subtitle file's kind, from its probe, as libass names it.
EXTENSIONS = {"srt": "srt", "webvtt": "vtt", "ass": "ass"}
AUDIO_BPS = 192_000


def ass_color(hex_color: str, alpha: int = 0) -> str:
    """'#rrggbb' as ASS's &HAABBGGRR."""
    red, green, blue = hex_color[1:3], hex_color[3:5], hex_color[5:7]
    return f"&H{alpha:02X}{blue}{green}{red}".upper()


def force_style(options: dict[str, Any]) -> str:
    """The person's style, for SRT and VTT."""
    outline = OUTLINES[str(options.get("outline") or "thin")]
    style = {
        "FontName": FONTS[str(options.get("font") or "sans")],
        "FontSize": SIZES[str(options.get("size") or "medium")],
        "PrimaryColour": ass_color(str(options.get("color") or "#ffffff")),
        "Alignment": POSITIONS[str(options.get("position") or "bottom")],
        "MarginV": 18,
        "MarginL": WIDTHS[str(options.get("width") or "full")],
        "MarginR": WIDTHS[str(options.get("width") or "full")],
        "Shadow": 0,
    }
    if options.get("box"):
        # An opaque box: libass draws it in the outline colour, here half-clear black.
        style |= {"BorderStyle": 3, "Outline": 1, "OutlineColour": "&H80000000"}
    else:
        style |= {"BorderStyle": 1, "Outline": outline, "OutlineColour": "&H00000000"}
    return ",".join(f"{key}={value}" for key, value in style.items())


def utf8_text(raw: bytes) -> str:
    """The subtitle file as text, whatever it was saved in."""
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    cyrillic = raw.decode("cp1251", errors="replace")
    letters = [char for char in cyrillic if char.isalpha()]
    if letters and sum("Ѐ" <= char <= "ӿ" for char in letters) > len(letters) / 2:
        return cyrillic
    return raw.decode("cp1252", errors="replace")


class BurnSubtitles:
    tool_id = "burn-subtitles"

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        video = meta.get("video") or {}
        pixels = int(video.get("width") or 1920) * int(video.get("height") or 1080)
        frames = float(meta.get("duration_ms") or 0) / 1000 * float(video.get("fps") or 30)
        return Estimate(seconds=frames * pixels / (1920 * 1080 * 120))

    def run(self, ctx: JobContext) -> Output:
        video = ctx.meta.get("video")
        if not video:
            raise JobFailed("NO_VIDEO", "This file has no video to put subtitles on.")
        if not ctx.extra_paths:
            raise JobFailed("NOT_FOUND", "The subtitle file is missing. Add it again.")
        extras = ctx.meta.get("extras") or [{}]
        kind = EXTENSIONS.get(str(extras[0].get("container") or ""), "srt")
        subtitles = ctx.workdir / f"subtitles.{kind}"
        subtitles.write_text(utf8_text(ctx.extra_paths[0].read_bytes()), encoding="utf-8")

        keeps_style = kind == "ass"
        burn = f"subtitles=filename={subtitles.name}"
        if not keeps_style:
            burn += f":force_style='{force_style(ctx.options)}'"
        audio = ctx.meta.get("audio")
        sound = (
            []
            if not audio
            else ["-map", "0:a:0", "-c:a", "copy"]
            if audio.get("codec") == "aac"
            else ["-map", "0:a:0", "-c:a", "aac", "-b:a", str(AUDIO_BPS)]
        )
        out = ctx.workdir / "out.mp4"
        report = ffmpeg_progress(
            int(ctx.meta.get("duration_ms") or 0), ctx.progress, "burning", 0, 98
        )
        ctx.run(
            ffmpeg(
                *("-i", ctx.input_path.name, "-map", "0:V:0", "-vf", burn),
                *("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"),
                *sound,
                *("-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart"),
                out.name,
            ),
            on_line=report,
        )
        if not out.exists() or out.stat().st_size == 0:
            raise JobFailed("TOOL_FAILED", "The video came out empty.")
        font = FONTS[str(ctx.options.get("font") or "sans")]
        size = str(ctx.options.get("size") or "medium")
        notes = ["The ASS file's own styles were kept"] if keeps_style else [f"{font}, {size}"]
        if "10" in str(video.get("pix_fmt") or ""):
            notes.append("Saved in 8-bit colour so it plays everywhere")
        width, height = display_size(video)
        return Output(
            path=out,
            content_type="video/mp4",
            ext="mp4",
            meta={"width": width, "height": height, "codec": "H.264", "notes": notes},
        )


PROCESSOR: BurnSubtitles = BurnSubtitles()
