"""V12 Merge Videos on the server (tools/video.md -> V12): clips joined in order,
for totals over the browser's limit.

The plan is the browser tool's (packages/engines/src/video/merge-videos.ts),
so the same settings give the same result either way:

- Fast join: when every clip has the same video (codec, profile, size,
  pixel format, rotation and parameter sets, byte for byte) and the same
  sound, or none, and the person keeps a cut and the first clip's size and
  rate, every packet is copied with the concat demuxer. Nothing is decoded.
  Each clip lasts to the end of its last frame, so the next one starts
  exactly there. Each clip's sound starts with its picture: a later clip's
  encoder priming (AAC's first 1024 samples, hidden by its edit list) and
  any packet that would run past its picture's end are left out, as in the
  browser, so nothing drifts however many clips are joined.
- Re-encode: otherwise. Every clip is drawn on one constant clock at the
  first clip's size and standard frame rate, or the ones chosen (2160 to
  480p, 24 to 60 fps), fitted on black. Each clip's sound is brought to
  48 kHz stereo and cut or padded to its own picture's length, so A and V
  stay together. A crossfade dissolves the picture (`xfade`) and fades the
  sound equal-power (`acrossfade`, quarter-sine curves) at every join.

The result is in the first clip's format: MP4 or MOV with H.264 and AAC,
WebM or MKV with VP9 and Opus (a copy keeps the codecs, in MKV when the
first clip's format can't hold them).
"""

from __future__ import annotations

import json
import math
from array import array
from dataclasses import dataclass, field
from typing import Any

from etb_worker.processors import Estimate, JobContext, JobFailed, Output, ffmpeg_progress
from etb_worker.sandbox import ToolError, ffmpeg, ffprobe

MAX_CLIPS = 20
SAMPLE_RATE = 48_000
AUDIO_BPS = 192_000
#: How far a copied sound packet may run past its clip's picture and still be
#: kept: Matroska times are whole milliseconds, so a clip's end can be 1 ms out.
SPILL = 0.001
#: The standard rates, as ffmpeg writes them; the first clip's rate is rounded to the nearest.
RATES: dict[float, str] = {
    23.976: "24000/1001",
    24.0: "24",
    25.0: "25",
    29.97: "30000/1001",
    30.0: "30",
    50.0: "50",
    59.94: "60000/1001",
    60.0: "60",
}
#: Output formats by the first clip's type: ffmpeg's muxer, extension, MIME type.
FAMILIES: dict[str, tuple[str, str, str]] = {
    "mp4": ("mp4", "mp4", "video/mp4"),
    "mov": ("mov", "mov", "video/quicktime"),
    "webm": ("webm", "webm", "video/webm"),
    "mkv": ("matroska", "mkv", "video/x-matroska"),
}
FAMILY_BY_MIME = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
}
#: The codecs MP4 and WebM take as they are, for a copy; MOV and MKV take what the clips hold.
TAKES: dict[str, tuple[set[str], set[str]]] = {
    "mp4": (
        {"h264", "hevc", "av1", "vp9", "mpeg4"},
        {"aac", "mp3", "opus", "flac", "alac", "ac3", "eac3"},
    ),
    "webm": ({"vp8", "vp9", "av1"}, {"opus", "vorbis"}),
}
#: Re-encoding, by format: the picture's and the sound's encoder settings, and their names.
ENCODERS: dict[str, tuple[list[str], list[str], str]] = {
    "h264": (
        ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"],
        ["-c:a", "aac", "-b:a", str(AUDIO_BPS)],
        "H.264 with AAC sound",
    ),
    "vp9": (
        [
            *("-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0", "-pix_fmt", "yuv420p"),
            *("-row-mt", "1", "-deadline", "good", "-cpu-used", "4"),
        ],
        ["-c:a", "libopus", "-b:a", str(AUDIO_BPS)],
        "VP9 with Opus sound",
    ),
}


def half_up(x: float) -> int:
    """Rounds halves up, as the browser's ``Math.round`` does (Python's ``round`` goes to even)."""
    return math.floor(x + 0.5)


def even(n: float) -> int:
    """A side rounded to an even number of pixels, at least 2 (4:2:0 halves the colour planes)."""
    return max(2, half_up(n / 2) * 2)


def standard_fps(fps: float) -> float:
    """The nearest standard rate: phones say 29.98, cameras 23.976."""
    best = 30.0
    for rate in RATES:
        if abs(rate - fps) < abs(best - fps):
            best = rate
    return best


def secs(seconds: float) -> str:
    return f"{seconds:.2f} s" if seconds < 10 else f"{seconds:.1f} s"


def _rate(value: object) -> float:
    try:
        top, _, bottom = str(value).partition("/")
        rate = float(top) / float(bottom or 1)
    except (ValueError, ZeroDivisionError):
        return 0.0
    return rate if rate > 0 else 0.0


def _rotation(stream: dict[str, Any]) -> int:
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            return int(side["rotation"]) % 360
    return int((stream.get("tags") or {}).get("rotate", 0)) % 360


@dataclass
class Clip:
    """One clip as the processor reads it, in the job's sandbox."""

    name: str
    #: Its place in the order, from 1, for messages.
    number: int
    video: dict[str, Any]
    audio: dict[str, Any] | None
    #: The container's start (concat places each file from it).
    start: float = 0.0
    #: Where the picture ends: the end of its last frame, in the clip's own time.
    end: float = 0.0
    #: The sound's packets in file order, for a copy: start and length, seconds.
    sound_at: array[float] = field(default_factory=lambda: array("d"))
    sound_for: array[float] = field(default_factory=lambda: array("d"))

    @property
    def fps(self) -> float:
        return _rate(self.video.get("avg_frame_rate")) or _rate(self.video.get("r_frame_rate"))

    @property
    def shown(self) -> tuple[int, int]:
        """The picture as shown: phones store portrait video sideways with a rotation."""
        width, height = int(self.video.get("width") or 0), int(self.video.get("height") or 0)
        return (height, width) if _rotation(self.video) in (90, 270) else (width, height)

    def video_key(self) -> tuple[object, ...]:
        """What must match, byte for byte, for packets to follow each other in one track."""
        v = self.video
        return (
            v.get("index"),
            v.get("codec_name"),
            v.get("codec_tag_string"),
            v.get("profile"),
            v.get("width"),
            v.get("height"),
            v.get("pix_fmt"),
            v.get("sample_aspect_ratio") or "1:1",
            v.get("field_order"),
            v.get("extradata_hash"),
            _rotation(v),
        )

    def audio_key(self) -> tuple[object, ...] | None:
        a = self.audio
        if a is None:
            return None
        return (
            a.get("index"),
            a.get("codec_name"),
            a.get("codec_tag_string"),
            a.get("profile"),
            a.get("sample_rate"),
            a.get("channels"),
            a.get("channel_layout"),
            a.get("extradata_hash"),
        )


def _streams(ctx: JobContext, name: str) -> dict[str, Any]:
    """ffprobe's streams and format, with a hash of each codec's parameter sets."""
    lines: list[str] = []
    ctx.run(
        ffprobe(
            *("-print_format", "json", "-show_format", "-show_streams"),
            *("-show_data_hash", "sha256", "-i", name),
        ),
        on_line=lines.append,
    )
    try:
        data = json.loads("\n".join(lines))
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        raise JobFailed("DECODE_FAILED", "A clip couldn't be read; it may be damaged.")
    return data


def read_clip(ctx: JobContext, name: str, number: int) -> Clip:
    """A clip's streams, where its picture ends, and its sound's packets."""
    data = _streams(ctx, name)
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None:
        raise JobFailed("NO_VIDEO", f"Clip {number} has no picture in it, only sound.")
    clip = Clip(
        name, number, video, audio, start=float((data.get("format") or {}).get("start_time") or 0)
    )
    video_index = int(video.get("index", 0))
    audio_index = int(audio.get("index", -1)) if audio else -1
    last_at, last_for, end = -1e18, 0.0, 0.0

    def on_line(line: str) -> None:
        nonlocal last_at, last_for, end
        parts = line.split(",")
        if len(parts) < 3 or not parts[0].isdigit():
            return
        try:
            at = float(parts[1])
        except ValueError:
            return  # no time on this packet
        try:
            length = float(parts[2])
        except ValueError:
            length = 0.0
        index = int(parts[0])
        if index == video_index:
            end = max(end, at + length)
            if at > last_at:
                last_at, last_for = at, length
        elif index == audio_index:
            clip.sound_at.append(at)
            clip.sound_for.append(length)

    ctx.run(
        ffprobe(
            *("-show_entries", "packet=stream_index,pts_time,duration_time"),
            *("-of", "csv=p=0", "-i", name),
        ),
        on_line=on_line,
    )
    if last_at < -1e17:
        raise JobFailed("DECODE_FAILED", f"Clip {number}'s picture couldn't be read.")
    # Matroska often leaves the last frame's length out: it lasts one frame.
    fps = clip.fps or 30.0
    clip.end = last_at + 1 / fps if last_for < 0.5 / fps else end
    return clip


def copy_drops(clip: Clip, first: bool) -> list[int]:
    """The clip's sound packets left out of a copy, by their place in its track (the browser's
    ``placeCopiedSound``): a later clip's encoder priming, and anything that starts after or
    runs past the end of its picture."""
    drops: list[int] = []
    ended = False
    for k, (at, length) in enumerate(zip(clip.sound_at, clip.sound_for, strict=True)):
        if ended or at >= clip.end - 1e-9:
            ended = True
            drops.append(k)
        elif (not first and at + length <= 1e-9) or at + length > clip.end + SPILL:
            drops.append(k)
    return drops


def drop_expression(clips: list[Clip]) -> str | None:
    """ffmpeg's ``noise`` bitstream filter expression that drops those packets from the joined
    track, by their number in it (commas escaped for the filter list); None for none."""
    ranges: list[list[int]] = []
    before = 0
    for i, clip in enumerate(clips):
        for k in copy_drops(clip, first=i == 0):
            n = before + k
            if ranges and ranges[-1][1] == n - 1:
                ranges[-1][1] = n
            else:
                ranges.append([n, n])
        before += len(clip.sound_at)
    if not ranges:
        return None
    return "+".join(f"between(n\\,{lo}\\,{hi})" for lo, hi in ranges)


def concat_list(clips: list[Clip]) -> str:
    """The concat demuxer's list (ours, never the user's): each clip starts where the last
    one's picture ended, its own start lined up as the browser lines it up."""
    lines = ["ffconcat version 1.0"]
    for i, clip in enumerate(clips):
        lines.append(f"file {clip.name}")
        if i + 1 < len(clips):
            lines.append(f"duration {clip.end + clips[i + 1].start - clip.start:.6f}")
    return "\n".join(lines) + "\n"


def family_of(meta: dict[str, Any]) -> str:
    """The first clip's format, from the type it was uploaded as (its content was checked
    against that type when it was probed)."""
    family = FAMILY_BY_MIME.get(str(meta.get("mime") or ""))
    if family:
        return family
    return "mkv" if meta.get("container") in ("webm", "matroska") else "mp4"


def copy_family(family: str, clip: Clip) -> str:
    """A copy goes in the first clip's format, or in MKV when that can't hold its codecs."""
    takes = TAKES.get(family)
    if takes is None:
        return family
    video_ok = clip.video.get("codec_name") in takes[0]
    audio_ok = clip.audio is None or clip.audio.get("codec_name") in takes[1]
    return family if video_ok and audio_ok else "mkv"


@dataclass(frozen=True)
class Target:
    width: int
    height: int
    fps: float
    rate: str
    #: Frames each clip takes on the new clock, and the crossfade's.
    frames: list[int]
    overlap: int

    @property
    def length(self) -> float:
        return (sum(self.frames) - (len(self.frames) - 1) * self.overlap) / self.fps


def target(clips: list[Clip], options: dict[str, Any]) -> Target:
    """The common spec: the first clip's size and standard rate, or the ones chosen."""
    width, height = clips[0].shown
    size = str(options.get("size") or "first")
    if size.isdigit():
        out_height = even(int(size))
        out_width = even(width * out_height / max(1, height))
    else:
        out_width, out_height = even(width), even(height)
    chosen = str(options.get("fps") or "first")
    fps = float(chosen) if chosen.replace(".", "", 1).isdigit() else standard_fps(clips[0].fps)
    rate = RATES.get(fps, f"{fps:g}")
    frames = [max(1, half_up(clip.end * fps)) for clip in clips]
    crossfade = (
        float(options.get("transitionLength") or 0)
        if options.get("transition") == "crossfade"
        else 0.0
    )
    overlap = half_up(crossfade * fps)
    if overlap * 2 > min(frames):
        raise JobFailed(
            "CROSSFADE_TOO_LONG",
            "A crossfade can be at most half as long as the shortest clip. "
            "Pick a shorter crossfade, or a cut.",
        )
    return Target(out_width, out_height, fps, rate, frames, overlap)


def filter_graph(clips: list[Clip], t: Target, with_sound: bool) -> str:
    """Every clip on one clock, fitted on black, its sound cut or padded to its picture."""
    parts: list[str] = []
    for i, (clip, frames) in enumerate(zip(clips, t.frames, strict=True)):
        parts.append(
            f"[{i}:v:0]scale={t.width}:{t.height}:force_original_aspect_ratio=decrease"
            ":force_divisible_by=2:flags=lanczos,"
            f"pad={t.width}:{t.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,"
            # The last frame holds, so the clock has a frame for every slot to the clip's end.
            f"tpad=stop_mode=clone:stop_duration=1,fps={t.rate}:start_time=0,"
            f"trim=end_frame={frames},setpts=PTS-STARTPTS[v{i}]"
        )
        if not with_sound:
            continue
        samples = half_up(frames / t.fps * SAMPLE_RATE)
        if clip.audio is None:
            parts.append(f"anullsrc=r={SAMPLE_RATE}:cl=stereo,atrim=end_sample={samples}[a{i}]")
            continue
        # Mono on both sides; past stereo, the first two channels (front left and right).
        pan = "c1=c0" if int(clip.audio.get("channels") or 2) == 1 else "c1=c1"
        parts.append(
            f"[{i}:a:0]aresample={SAMPLE_RATE}:async=1:first_pts=0,pan=stereo|c0=c0|{pan},"
            f"aformat=sample_fmts=fltp:sample_rates={SAMPLE_RATE}:channel_layouts=stereo,"
            f"apad,atrim=end_sample={samples}[a{i}]"
        )
    n = len(clips)
    if t.overlap == 0:
        parts.append("".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vout]")
        if with_sound:
            parts.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[aout]")
        return ";".join(parts)
    fade = t.overlap / t.fps
    fade_samples = half_up(fade * SAMPLE_RATE)
    picture, sound, at = "v0", "a0", 0
    for i in range(1, n):
        at += t.frames[i - 1] - t.overlap
        last = i == n - 1
        out_v, out_a = ("vout", "aout") if last else (f"x{i}", f"y{i}")
        parts.append(
            f"[{picture}][v{i}]xfade=transition=fade:duration={fade:.6f}"
            f":offset={at / t.fps:.6f}[{out_v}]"
        )
        if with_sound:
            parts.append(f"[{sound}][a{i}]acrossfade=ns={fade_samples}:c1=qsin:c2=qsin[{out_a}]")
        picture, sound = out_v, out_a
    return ";".join(parts)


def _total_ms(meta: dict[str, Any]) -> float:
    extras = meta.get("extras") or []
    return float(meta.get("duration_ms") or 0) + sum(
        float(extra.get("duration_ms") or 0) for extra in extras
    )


class MergeVideos:
    tool_id = "merge-videos"

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        # Re-encoding, the slower way; a copy takes a few seconds a gigabyte.
        video = meta.get("video") or {}
        pixels = int(video.get("width") or 1920) * int(video.get("height") or 1080)
        frames = _total_ms(meta) / 1000 * float(video.get("fps") or 30)
        return Estimate(seconds=frames * pixels / (1920 * 1080 * 120))

    def run(self, ctx: JobContext) -> Output:
        names = [ctx.input_path.name, *(path.name for path in ctx.extra_paths)]
        if len(names) < 2:
            raise JobFailed("NOT_FOUND", "The other clips are missing. Add them again.")
        if len(names) > MAX_CLIPS:
            raise JobFailed("TOOL_FAILED", f"Merge up to {MAX_CLIPS} clips at once.")
        ctx.progress(0, "analysing")
        clips = []
        for number, name in enumerate(names, start=1):
            clips.append(read_clip(ctx, name, number))
            ctx.progress(round(number / len(names) * 4), "analysing")
        family = family_of(ctx.meta)
        options = ctx.options
        wants_copy = (
            options.get("transition", "none") == "none"
            and options.get("size", "first") == "first"
            and options.get("fps", "first") == "first"
        )
        first = clips[0]
        same = all(
            clip.video_key() == first.video_key() and clip.audio_key() == first.audio_key()
            for clip in clips[1:]
        )
        notes: list[str] = []
        if wants_copy and same:
            try:
                return self._copy(ctx, clips, copy_family(family, first))
            except ToolError as error:
                if error.code != "TOOL_FAILED":
                    raise
                notes.append("The clips couldn't be copied as they are, so they were re-encoded")
        elif wants_copy:
            notes.append(
                "The clips differ in codec, settings or size, so they were re-encoded "
                "to the first clip's"
            )
        return self._encode(ctx, clips, family, notes)

    def _copy(self, ctx: JobContext, clips: list[Clip], family: str) -> Output:
        muxer, ext, content_type = FAMILIES[family]
        (ctx.workdir / "clips.ffconcat").write_text(concat_list(clips))
        drops = drop_expression(clips) if clips[0].audio else None
        length = sum(clip.end for clip in clips)
        out = ctx.workdir / f"out.{ext}"
        sound = ["-map", "0:a:0"] if clips[0].audio else []
        report = ffmpeg_progress(round(length * 1000), ctx.progress, "joining", 5, 98)
        ctx.run(
            ffmpeg(
                # The packets' own times, placed by the list: nothing shifted or re-stamped.
                *("-copyts", "-f", "concat", "-safe", "1", "-auto_convert", "0"),
                *("-i", "clips.ffconcat", "-map", "0:v:0", *sound, "-c", "copy"),
                *(["-bsf:a", f"noise=drop={drops}"] if drops else []),
                *("-map_metadata", "-1", "-map_chapters", "-1"),
                *(["-movflags", "+faststart"] if family in ("mp4", "mov") else []),
                *("-f", muxer, out.name),
            ),
            on_line=report,
        )
        if not out.exists() or out.stat().st_size == 0:
            raise JobFailed("TOOL_FAILED", "The merged video came out empty.")
        width, height = clips[0].shown
        return Output(
            path=out,
            content_type=content_type,
            ext=ext,
            meta={
                "width": width,
                "height": height,
                "codec": str(clips[0].video.get("codec_name") or ""),
                "notes": [
                    f"{len(clips)} clips joined: {secs(length)}",
                    "The clips share their codec and settings, so every packet is copied: "
                    "nothing re-encoded, nothing lost",
                ],
            },
        )

    def _encode(self, ctx: JobContext, clips: list[Clip], family: str, notes: list[str]) -> Output:
        t = target(clips, ctx.options)
        muxer, ext, content_type = FAMILIES[family]
        picture, sound_args, codecs = ENCODERS["vp9" if family in ("webm", "mkv") else "h264"]
        with_sound = any(clip.audio for clip in clips)
        inputs: list[str] = []
        for clip in clips:
            # Every input, not just the first, may open local files only. Every clip's
            # decoder opens at the start: two threads each keep 20 of them, even at 4K,
            # within the sandbox's address space on a machine with many cores.
            inputs += ["-threads", "2", "-protocol_whitelist", "file,pipe", "-i", clip.name]
        out = ctx.workdir / f"out.{ext}"
        report = ffmpeg_progress(round(t.length * 1000), ctx.progress, "encoding", 5, 98)
        ctx.run(
            ffmpeg(
                *inputs,
                *("-filter_complex", filter_graph(clips, t, with_sound), "-map", "[vout]"),
                *(["-map", "[aout]", *sound_args] if with_sound else ["-an"]),
                *picture,
                *("-fps_mode", "cfr", "-r", t.rate),
                *("-map_metadata", "-1", "-map_chapters", "-1"),
                *(["-movflags", "+faststart"] if family in ("mp4", "mov") else []),
                *("-f", muxer, out.name),
            ),
            on_line=report,
        )
        if not out.exists() or out.stat().st_size == 0:
            raise JobFailed("TOOL_FAILED", "The merged video came out empty.")
        crossfade = t.overlap / t.fps
        joined = (
            f"{len(clips)} clips joined with {secs(crossfade)} crossfades: {secs(t.length)}"
            if t.overlap
            else f"{len(clips)} clips joined: {secs(t.length)}"
        )
        notes = [
            joined,
            f"Re-encoded to {t.width} × {t.height} at {t.fps:g} fps, {codecs}; "  # noqa: RUF001
            "clips of another shape are fitted on black",
            *notes,
        ]
        if any("10" in str(clip.video.get("pix_fmt") or "") for clip in clips):
            notes.append("Saved in 8-bit colour so it plays everywhere")
        return Output(
            path=out,
            content_type=content_type,
            ext=ext,
            meta={
                "width": t.width,
                "height": t.height,
                "fps": f"{t.fps:g}",
                "codec": codecs.split(" ", 1)[0],
                "notes": notes,
            },
        )


PROCESSOR: MergeVideos = MergeVideos()
