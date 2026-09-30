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

import json
import shutil
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
}

MAX_PIXELS = 100_000_000  # a decoded frame, docs/11 -> decompression bombs
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
    if video is None and audio is None:
        raise ProbeRefused("UNSUPPORTED_FORMAT", "no audio or video streams")
    duration_ms = round(float(fmt.get("duration") or 0) * 1000)
    if duration_ms > MAX_DURATION_MS:
        raise ProbeRefused("FILE_TOO_LARGE", "longer than 24 hours")
    record: dict[str, Any] = {
        "container": sorted(names & allowed)[0],
        "duration_ms": duration_ms,
        "bit_rate": int(fmt["bit_rate"]) if str(fmt.get("bit_rate", "")).isdigit() else None,
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
        record["video"] = {
            "codec": video.get("codec_name"),
            "width": width,
            "height": height,
            "fps": average or real,
            # Different "real" and average rates are the usual sign of variable frame rate.
            "maybe_vfr": bool(real and average and abs(real - average) > 0.01 * real),
            "pix_fmt": video.get("pix_fmt"),
            "rotation": _rotation(video),
        }
    if audio is not None:
        record["audio"] = {
            "codec": audio.get("codec_name"),
            "sample_rate": int(audio.get("sample_rate") or 0),
            "channels": int(audio.get("channels") or 0),
        }
    return record


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
    return data


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
            # Leave it unprobed; the next pass tries again.
            log.warning("upload.probe_failed", upload_id=str(row["id"]), error_code=error.code)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
    return True
