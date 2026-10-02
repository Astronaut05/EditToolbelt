"""Checking an upload before any job may use it (docs/11 -> File intake).

The file is validated by content, not by its claimed type or name:
ffprobe reads it under the sandbox, and its container must be one the
claimed MIME type allows (a WebM sent as "video/mp4" is refused). Stream
sizes are capped against decompression bombs. The result, container,
streams, duration and size, never a filename, goes into ``uploads.probe``;
a refusal goes into ``uploads.probe_error`` as an API code. The web checks
the tool's own limits against the probe when it quotes a job.
"""

from __future__ import annotations

import itertools
import json
import shutil
import statistics
import tempfile
from collections.abc import Callable
from fractions import Fraction
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from etb_worker.db import Conn
from etb_worker.logs import get_logger
from etb_worker.sandbox import Limits, ToolError, ffprobe, run
from etb_worker.storage import Storage, StorageError

# ffprobe's format_name lists every name of its demuxer ("mov,mp4,m4a,3gp,3g2,mj2").
CONTAINERS: dict[str, set[str]] = {
    "video/mp4": {"mp4", "mov"},
    "video/quicktime": {"mov", "mp4"},
    "video/webm": {"webm", "matroska"},
    "video/x-matroska": {"matroska", "webm"},
    "video/x-msvideo": {"avi"},
    "image/gif": {"gif"},
    "audio/mpeg": {"mp3"},
    "audio/mp4": {"mp4", "mov", "m4a"},
    "audio/aac": {"aac"},
    "audio/wav": {"wav"},
    "audio/x-wav": {"wav"},
    "audio/flac": {"flac"},
    "audio/ogg": {"ogg"},
    "audio/webm": {"webm", "matroska"},
    # Still images (Upscale Image): ffprobe reads them as one frame of "video".
    "image/png": {"png_pipe"},
    "image/jpeg": {"jpeg_pipe"},
    "image/webp": {"webp_pipe"},
}
#: Subtitle files a tool takes beside a video (Burn Subtitles). ffprobe reads them as one stream.
SUBTITLES: dict[str, set[str]] = {
    "application/x-subrip": {"srt"},
    "text/vtt": {"webvtt"},
    "text/x-ssa": {"ass"},
}
CONTAINERS.update(SUBTITLES)

MAX_PIXELS = 100_000_000  # a decoded frame, docs/11 -> decompression bombs
#: Frame times read for the variable-frame-rate check: the first minute is enough.
FRAME_TIMES_SPAN = "%+60"
MAX_FRAME_TIMES = 7200
MAX_DURATION_MS = 24 * 60 * 60 * 1000
PROBE_LIMITS = Limits(timeout_sec=60, memory_bytes=2 * 1024**3)


class ProbeRefused(Exception):
    """The file can't be used. ``code`` is the API code the user sees."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def _rate(value: object) -> float | None:
    try:
        rate = Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        return None
    return round(float(rate), 3) if rate > 0 else None


def summarize(raw: dict[str, Any], mime: str) -> dict[str, Any]:
    """Turns ffprobe's JSON into the probe record, or raises ProbeRefused."""
    fmt = raw.get("format") or {}
    names = set(str(fmt.get("format_name", "")).split(","))
    allowed = CONTAINERS.get(mime, set())
    if not names & allowed:
        raise ProbeRefused(
            "UNSUPPORTED_FORMAT", f"content is {fmt.get('format_name')!s}, not {mime}"
        )
    streams = raw.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if mime in SUBTITLES:
        subtitle = next((s for s in streams if s.get("codec_type") == "subtitle"), None)
        if subtitle is None or video is not None or audio is not None:
            raise ProbeRefused("UNSUPPORTED_FORMAT", "not a subtitle file")
        return {
            "container": sorted(names & allowed)[0],
            "streams": len(streams),
            "subtitle": {"codec": subtitle.get("codec_name")},
            "video": None,
            "audio": None,
        }
    if video is None and audio is None:
        raise ProbeRefused("UNSUPPORTED_FORMAT", "no audio or video streams")
    duration_ms = round(float(fmt.get("duration") or 0) * 1000)
    if duration_ms > MAX_DURATION_MS:
        raise ProbeRefused("FILE_TOO_LARGE", "longer than 24 hours")
    record: dict[str, Any] = {
        "container": sorted(names & allowed)[0],
        "duration_ms": duration_ms,
        "bit_rate": _int_or_none(fmt.get("bit_rate")),
        "streams": len(streams),
        "video": None,
        "audio": None,
    }
    if video is not None:
        width, height = int(video.get("width") or 0), int(video.get("height") or 0)
        if width * height > MAX_PIXELS:
            raise ProbeRefused("FILE_TOO_LARGE", f"{width}x{height} is over 100 MP")
        real = _rate(video.get("r_frame_rate"))
        average = _rate(video.get("avg_frame_rate"))
        # The frames' own clock says for sure; different "real" and average
        # rates in the header are the usual sign when it can't be read.
        vfr = variable_frame_rate(raw.get("frame_times") or [])
        header_hint = bool(real and average and abs(real - average) > 0.01 * real)
        record["video"] = {
            "codec": video.get("codec_name"),
            "width": width,
            "height": height,
            "fps": average or real,
            "vfr": vfr,
            "maybe_vfr": header_hint if vfr is None else vfr,
            "pix_fmt": video.get("pix_fmt"),
            "rotation": _rotation(video),
        }
    if audio is not None:
        record["audio"] = {
            "codec": audio.get("codec_name"),
            "sample_rate": int(audio.get("sample_rate") or 0),
            "channels": int(audio.get("channels") or 0),
            # Not every container says (WebM, MKV); size targets assume 192 kbps then.
            "bit_rate": _int_or_none(audio.get("bit_rate")),
        }
    return record


def variable_frame_rate(times: list[float]) -> bool | None:
    """Whether the frames come on an irregular clock; None with too few to tell.

    A frame gap more than 25 % off the usual one is irregular (timebase
    rounding stays far under that); a few of them in a hundred is a
    variable frame rate, as phones and screen recorders make.
    """
    ordered = sorted(times)
    gaps = [later - earlier for earlier, later in itertools.pairwise(ordered)]
    gaps = [gap for gap in gaps if gap > 0]
    if len(gaps) < 10:
        return None
    usual = statistics.median(gaps)
    irregular = sum(1 for gap in gaps if abs(gap - usual) > 0.25 * usual)
    return irregular >= max(2, len(gaps) // 100)


def _int_or_none(value: object) -> int | None:
    return int(str(value)) if str(value or "").isdigit() else None


def _rotation(stream: dict[str, Any]) -> int:
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            return int(side["rotation"]) % 360
    return int((stream.get("tags") or {}).get("rotate", 0)) % 360


def probe_json(path: Path) -> dict[str, Any]:
    """ffprobe's JSON for ``path`` (stdout), under the sandbox."""
    lines: list[str] = []
    try:
        run(
            ffprobe("-print_format", "json", "-show_format", "-show_streams", "-i", path.name),
            cwd=path.parent,
            limits=PROBE_LIMITS,
            on_line=lines.append,
        )
    except ToolError as error:
        code = "TIMEOUT" if error.code == "TIMEOUT" else "UNSUPPORTED_FORMAT"
        raise ProbeRefused(code, "ffprobe could not read it") from None
    try:
        data = json.loads("\n".join(lines))
    except json.JSONDecodeError:
        raise ProbeRefused("UNSUPPORTED_FORMAT", "ffprobe gave no answer") from None
    if not isinstance(data, dict):
        raise ProbeRefused("UNSUPPORTED_FORMAT", "ffprobe gave no answer")
    streams = data.get("streams") or []
    if any(stream.get("codec_type") == "video" for stream in streams):
        data["frame_times"] = frame_times(path)
    return data


def frame_times(path: Path) -> list[float]:
    """The first minute's video packet times, for the variable-frame-rate check."""
    lines: list[str] = []
    try:
        run(
            ffprobe(
                *("-select_streams", "v:0", "-read_intervals", FRAME_TIMES_SPAN),
                *("-show_entries", "packet=pts_time", "-of", "csv=p=0", "-i", path.name),
            ),
            cwd=path.parent,
            limits=PROBE_LIMITS,
            on_line=lines.append,
        )
    except ToolError:
        return []  # the header's hint stands in
    times: list[float] = []
    for line in lines[:MAX_FRAME_TIMES]:
        try:
            times.append(float(line.strip().rstrip(",")))
        except ValueError:
            continue
    return times


# What storage answers for an object that isn't there.
MISSING = frozenset({"404", "NoSuchKey"})


def probe_next(
    conn: Conn,
    storage: Storage,
    *,
    probe: Callable[[Path], dict[str, Any]] = probe_json,
) -> bool:
    """Probes the oldest completed, unprobed upload; returns False when there is none."""
    log = get_logger()
    with conn.transaction():
        row = conn.execute(
            """
            select id, storage_key, mime_claimed from uploads
            where completed_at is not null and probed_at is null and deleted_at is null
            order by completed_at
            limit 1
            for update skip locked
            """
        ).fetchone()
        if row is None:
            return False
        workdir = Path(tempfile.mkdtemp(prefix="etb-probe-"))
        try:
            path = workdir / "input"
            storage.download(row["storage_key"], path)
            record = summarize(probe(path), row["mime_claimed"])
            conn.execute(
                "update uploads set probe = %s, probed_at = now() where id = %s",
                (Jsonb(record), row["id"]),
            )
            log.info("upload.probed", upload_id=str(row["id"]), container=record["container"])
        except ProbeRefused as refused:
            conn.execute(
                "update uploads set probe_error = %s, probed_at = now() where id = %s",
                (refused.code, row["id"]),
            )
            log.info("upload.refused", upload_id=str(row["id"]), error_code=refused.code)
        except StorageError as error:
            if error.code not in MISSING:
                # Storage is down: leave it unprobed, and let the slot wait before trying again.
                raise
            # The file is gone (the upload was cancelled, or swept): it can never be probed,
            # and left unprobed it would hold up every upload behind it.
            conn.execute(
                "update uploads set probe_error = 'MISSING', probed_at = now() where id = %s",
                (row["id"],),
            )
            log.warning("upload.missing", upload_id=str(row["id"]))
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
    return True
