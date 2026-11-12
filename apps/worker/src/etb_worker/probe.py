"""Checking an upload before any job may use it (docs/11 -> File intake).

The file is validated by content, not by its claimed type or name:
ffprobe reads it under the sandbox, and its container must be one the
claimed MIME type allows (a WebM sent as "video/mp4" is refused). Stream
sizes are capped against decompression bombs. The result, container,
streams, duration and size, never a filename, goes into ``uploads.probe``;
a refusal goes into ``uploads.probe_error`` as an API code. The web checks
the tool's own limits against the probe when it quotes a job.

The header is the uploader's word, so what prices and limits a job is checked
against the packets: a length the header doesn't really give is measured
(``packet_span``), and the picture's packets are counted over the whole file,
so a header can't understate the frame rate (``_frame_rate``).
"""

from __future__ import annotations

import itertools
import json
import shutil
import statistics
import threading
from collections.abc import Callable
from fractions import Fraction
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from etb_worker.db import Conn
from etb_worker.logs import get_logger
from etb_worker.processors import CAP_RATIO, CAP_SLACK_SEC
from etb_worker.sandbox import Answer, Limits, ToolError, ffprobe, run
from etb_worker.storage import Storage, StorageError
from etb_worker.workdir import new_dir

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
#: The most of them kept: a minute at 120 fps. They sit in the worker's own memory, outside
#: the sandbox, and a file of tiny frames can list millions in a minute.
MAX_FRAME_TIMES = 7200
MAX_DURATION_MS = 24 * 60 * 60 * 1000
PROBE_LIMITS = Limits(timeout_sec=60, memory_bytes=2 * 1024**3)
#: Reading every packet of a file (to count its picture's, or to measure a length its
#: header doesn't give): a 4 GB upload, I/O bound.
MEASURE_LIMITS = Limits(timeout_sec=300, memory_bytes=2 * 1024**3)
#: Frames a file may hold past its header's rate (``_frame_rate``) and still be taken at it:
#: ``LEAD_IN_SEC`` of them at that rate, ``LEAD_IN_FRAMES`` at least.
#: A cut made without re-encoding starts at the keyframe before it (an MP4's edit list hides
#: those frames, and they are decoded to show the first): a GOP at most. That is 250 frames by
#: x264's default, whatever the rate, and 10 s by HandBrake's (ten times the rate: 600 frames
#: at 60 fps, where 250 read 2 s cut from such a file as 330 fps).
LEAD_IN_SEC = 10.0
LEAD_IN_FRAMES = 250
#: What ffprobe is asked for: the fields ``summarize`` and ``probe_json`` read, no others.
#: Asked for everything, it prints every tag the uploader wrote, megabytes of them, and
#: its answer is held in the worker's own memory.
ENTRIES = (
    "format=format_name,duration,bit_rate"
    ":stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate"
    ",sample_rate,channels,bit_rate"
    ":stream_disposition=attached_pic:stream_tags=rotate:stream_side_data=rotation"
)


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
    video = next((s for s in streams if _picture(s)), None)
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
        header = average or real
        fps = _frame_rate(header, raw.get("picture_packets"), duration_ms)
        # The frames' own clock says for sure; different "real" and average
        # rates in the header are the usual sign when it can't be read.
        vfr = variable_frame_rate(raw.get("frame_times") or [])
        header_hint = bool(real and average and abs(real - average) > 0.01 * real)
        record["video"] = {
            "codec": video.get("codec_name"),
            "width": width,
            "height": height,
            "fps": fps,
            "vfr": vfr,
            "maybe_vfr": header_hint if vfr is None else vfr,
            "pix_fmt": video.get("pix_fmt"),
            "rotation": _rotation(video),
        }
        if fps != header:
            # The GPU function makes its frames at a rate from the header
            # (gpu/video.pick_fps), so its frame cap still counts at this one.
            record["video"]["header_fps"] = header
    if audio is not None:
        record["audio"] = {
            "codec": audio.get("codec_name"),
            "sample_rate": int(audio.get("sample_rate") or 0),
            "channels": int(audio.get("channels") or 0),
            # Not every container says (WebM, MKV); size targets assume 192 kbps then.
            "bit_rate": _int_or_none(audio.get("bit_rate")),
        }
    return record


def _frame_rate(header: float | None, packets: object, duration_ms: int) -> float | None:
    """The picture's rate: the header's, unless the file holds clearly more frames than
    that rate shows in its length; then the frames it holds, over its length.

    The header's rate is the uploader's word (Matroska's DefaultDuration): 3 s at 1000 fps
    that say 60 would be priced, limited and capped by time as 60 fps, and decode 17 times
    the frames. An honest file's count runs over its rate times its length too: a length
    rounded down to the millisecond (240.04 fps is refused where 240 isn't), a last frame
    past it, a cut's lead-in. So the header stands while the file holds no more frames
    than its rate gives over the read a job is capped to (``processors.priced_seconds``:
    a job may decode that much of any file), and a lead-in more (``LEAD_IN_SEC`` at its
    rate, ``LEAD_IN_FRAMES`` at least). What a header can hide that way stays small: 2 % of
    the file's frames and 11 s of them at its own rate, never a multiple of the file.
    ``packets`` is None when they weren't counted.
    """
    if isinstance(packets, bool) or not isinstance(packets, int) or duration_ms <= 0:
        return header
    seconds = duration_ms / 1000
    if header:
        lead_in = max(LEAD_IN_FRAMES, header * LEAD_IN_SEC)
        if packets <= header * (seconds * CAP_RATIO + CAP_SLACK_SEC) + lead_in:
            return header
    return round(packets / seconds, 3) or header


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
            return _degrees(side["rotation"])
    return _degrees((stream.get("tags") or {}).get("rotate", 0))


def _degrees(value: object) -> int:
    """A rotation as 0-359 degrees. The ``rotate`` tag is whatever the uploader wrote, so
    anything that isn't a finite number reads as no rotation."""
    try:
        return int(float(str(value))) % 360
    except (ValueError, OverflowError):
        return 0


def probe_json(path: Path) -> dict[str, Any]:
    """ffprobe's JSON for ``path`` (stdout), under the sandbox: the fields in ``ENTRIES``.

    An answer too long to keep (``Answer``) stops ffprobe and refuses the file: the one
    tag read, ``rotate``, is as long as the uploader likes. One longer than the sandbox
    reads of a line at once comes in pieces, which aren't JSON: refused the same.
    """
    answer = Answer()
    try:
        run(
            ffprobe("-print_format", "json", "-show_entries", ENTRIES, "-i", path.name),
            cwd=path.parent,
            limits=PROBE_LIMITS,
            cancel=answer.too_long,
            on_line=answer,
        )
    except ToolError as error:
        code = "TIMEOUT" if error.code == "TIMEOUT" else "UNSUPPORTED_FORMAT"
        raise ProbeRefused(code, "ffprobe could not read it") from None
    if answer.too_long.is_set():  # ffprobe ended on its own just as it was being stopped
        raise ProbeRefused("UNSUPPORTED_FORMAT", "ffprobe's answer is too long")
    try:
        data = json.loads(answer.text())
    except json.JSONDecodeError:
        raise ProbeRefused("UNSUPPORTED_FORMAT", "ffprobe gave no answer") from None
    if not isinstance(data, dict):
        raise ProbeRefused("UNSUPPORTED_FORMAT", "ffprobe gave no answer")
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    picture = next((stream for stream in streams if _picture(stream)), None)
    counted: int | None = None
    if _timed(fmt, streams) and (not _positive(fmt.get("duration")) or _estimated(fmt)):
        # The length sets the price, the limits and how far a job reads. When the header has
        # none (a browser's MediaRecorder WebM writes none), or one that rounds to nothing, or
        # ffprobe would only guess it from the bitrate (MP3 without a Xing header, raw AAC),
        # it is measured from the packets.
        index = None if picture is None else picture.get("index")
        span, counted = packet_span(path, index if isinstance(index, int) else None)
        if span is None:
            raise ProbeRefused("UNSUPPORTED_FORMAT", "its length can't be read")
        data["format"] = {**fmt, "duration": f"{span:.6f}"}
        data["duration_from_packets"] = True
    if picture is not None:
        if _positive((data.get("format") or {}).get("duration")):
            # A rate is frames over a length: a still image has none. Measuring the length
            # read every packet, so the picture's were counted there; otherwise they are now.
            data["picture_packets"] = picture_packets(path) if counted is None else counted
        data["frame_times"] = frame_times(path)
    return data


def _picture(stream: dict[str, Any]) -> bool:
    """A video stream that is the picture, not a cover image (an MP3's or M4A's artwork).

    ffprobe gives cover art a rate of 90,000 fps, which the jobs API would refuse, and a
    video file's artwork may come before its picture. ffmpeg's ``V`` stream specifier
    picks the same streams, so the processors map ``0:V:0``.
    """
    return stream.get("codec_type") == "video" and not (stream.get("disposition") or {}).get(
        "attached_pic"
    )


def _timed(fmt: dict[str, Any], streams: list[dict[str, Any]]) -> bool:
    """Sound or moving picture, which has a length; not a still image or subtitles."""
    names = set(str(fmt.get("format_name", "")).split(","))
    if any(name.endswith("_pipe") for name in names) or names & {"image2", "gif", "apng"}:
        return False
    return any(stream.get("codec_type") in ("audio", "video") for stream in streams)


def _positive(value: object) -> bool:
    """A length of at least a millisecond: less rounds to 0 ms, which prices and caps nothing."""
    try:
        return float(str(value)) >= 0.001
    except ValueError:
        return False


#: Containers whose length ffprobe estimates from the bitrate when nothing better says:
#: a VBR MP3 without a Xing or VBRI header, ADTS AAC, MP3s joined end to end.
ESTIMATED = frozenset({"mp3", "aac"})


def _estimated(fmt: dict[str, Any]) -> bool:
    return bool(set(str(fmt.get("format_name", "")).split(",")) & ESTIMATED)


def packet_span(path: Path, picture: int | None = None) -> tuple[float | None, int | None]:
    """Seconds from the first packet to the end of the last, in any stream; None if none.

    Every packet is read for that, so the packets of the stream numbered ``picture`` are
    counted on the way (what ``picture_packets`` reads the whole file for): the second
    value, None without a ``picture``.
    """
    first: float | None = None
    end = 0.0
    wanted = None if picture is None else str(picture)
    counted = 0

    def on_line(line: str) -> None:
        nonlocal first, end, counted
        index, _, times = line.strip().rstrip(",").partition(",")
        if index == wanted:
            counted += 1  # with or without a time: a job would decode it
        pts, _, duration = times.partition(",")
        try:
            start = float(pts)
        except ValueError:
            return  # N/A: a packet without a time
        try:
            length = float(duration)
        except ValueError:
            length = 0.0
        first = start if first is None else min(first, start)
        end = max(end, start + length)

    try:
        run(
            ffprobe(
                *("-show_entries", "packet=stream_index,pts_time,duration_time"),
                *("-of", "csv=p=0", "-i", path.name),
            ),
            cwd=path.parent,
            limits=MEASURE_LIMITS,
            on_line=on_line,
        )
    except ToolError as error:
        if error.code == "TIMEOUT":
            raise ProbeRefused("TIMEOUT", "measuring its length took too long") from None
        return None, None
    if first is None or end <= first:
        return None, None
    return end - first, None if wanted is None else counted


def picture_packets(path: Path) -> int:
    """How many packets the picture has in the whole file: the frames a job would decode,
    whatever rate the header gives.

    Demuxed only, nothing decoded, and all of them: the frames can be packed in anywhere,
    past the first minute ``frame_times`` reads. ``V:0`` is the picture, never cover art.
    A file whose frames can't be counted is refused: its rate would be the header's word.
    """
    count: int | None = None

    def on_line(line: str) -> None:
        nonlocal count
        if count is None:
            try:
                count = int(line.strip().rstrip(","))
            except ValueError:
                return  # not the number

    try:
        run(
            ffprobe(
                *("-count_packets", "-select_streams", "V:0"),
                *("-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", "-i", path.name),
            ),
            cwd=path.parent,
            limits=MEASURE_LIMITS,
            on_line=on_line,
        )
    except ToolError as error:
        code = "TIMEOUT" if error.code == "TIMEOUT" else "UNSUPPORTED_FORMAT"
        raise ProbeRefused(code, "its frames couldn't be counted") from None
    if count is None or count < 0:
        raise ProbeRefused("UNSUPPORTED_FORMAT", "its frames couldn't be counted")
    return count


def frame_times(path: Path) -> list[float]:
    """The first minute's video packet times, for the variable-frame-rate check.

    Only the first ``MAX_FRAME_TIMES`` count, so ffprobe is stopped once it has listed
    them: the check reads the same packets as if it had listed them all.
    """
    times: list[float] = []
    enough = threading.Event()

    def on_line(line: str) -> None:
        if len(times) >= MAX_FRAME_TIMES:
            enough.set()
            return
        try:
            times.append(float(line.strip().rstrip(",")))
        except ValueError:
            return  # N/A: a packet without a time

    try:
        run(
            ffprobe(
                *("-select_streams", "V:0", "-read_intervals", FRAME_TIMES_SPAN),
                *("-show_entries", "packet=pts_time", "-of", "csv=p=0", "-i", path.name),
            ),
            cwd=path.parent,
            limits=PROBE_LIMITS,
            cancel=enough,
            on_line=on_line,
        )
    except ToolError:
        if not enough.is_set():
            return []  # the header's hint stands in
        # Stopped once it had listed enough (or it failed after that): those stand.
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
        workdir = new_dir("etb-probe-")
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
        except psycopg.Error:
            raise  # the database: the slot waits and tries again
        except Exception as error:  # noqa: BLE001
            # Anything else is a file the probe can't handle (a bug, or a value nothing
            # expected): refused like a damaged one. Left unprobed, it would take every slot
            # that picks it up. The log names only the type: its message can quote the file.
            conn.execute(
                "update uploads set probe_error = 'UNSUPPORTED_FORMAT', probed_at = now() "
                "where id = %s",
                (row["id"],),
            )
            log.error(  # noqa: TRY400
                "upload.probe_failed",
                upload_id=str(row["id"]),
                error_code="UNSUPPORTED_FORMAT",
                detail=type(error).__name__,
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
    return True
