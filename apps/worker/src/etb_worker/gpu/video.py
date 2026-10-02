"""Video in and out for the GPU video functions (V20 Upscale Video, V21 Video Background Remover).

Standard library only, like remote.py: the GPU images have ffmpeg and
Python, and the worker's tests run this against the worker's own ffmpeg.

- ``probe``: what the function needs to know about the input (ffprobe):
  the picture as it is shown (rotation applied), a constant frame rate to
  make, the frame count that gives, the colour matrix to read it with,
  whether it is HDR or deeper than 8 bits, and the first sound's codec.
- ``decode_args`` / ``encode_args``: ffmpeg command lines. The decoder
  writes raw RGB frames at that constant rate (a variable-rate phone video
  comes out evenly spaced, so the sound stays in sync); the encoder reads
  raw RGB or RGBA frames and the input's sound, and writes H.264 MP4,
  ProRes 4444 MOV or VP9 WebM with alpha.
- ``FramePipe``: runs both, each fed by its own thread through a short
  queue, so a model in the middle works on one batch while the next is
  decoded and the last is encoded. Memory stays at a few frames whatever
  the length, and nothing is written to disk but the input and the output.

Both read only as much as the job was priced for: the input's first
``max_seconds`` (sound included), and ``max_frames`` frames at most, which
the worker works out from its probe. A file whose header says less than it
holds is cut there and the result says so (``cut_note``), instead of the
model running on every frame until the function's timeout.

ffmpeg's messages are never read back: they can name what's in a file.
"""

from __future__ import annotations

import contextlib
import json
import queue
import subprocess
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from types import TracebackType
from typing import IO, Any, Literal

from etb_worker.gpu.remote import CallFailed, length_label

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
#: Frames a second we make at most; anything faster is read at this rate.
MAX_FPS = Fraction(120)
#: Without a usable rate in the file, this one.
FALLBACK_FPS = Fraction(30)
#: The largest picture the video functions make: 4K UHD, either way round.
MAX_LONG_SIDE = 3840
MAX_SHORT_SIDE = 2160
_PROBE_TIMEOUT_SEC = 120
_FINISH_TIMEOUT_SEC = 600
#: Transfer curves of HDR video (PQ, HLG): made SDR here, which the result says.
_HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}
#: ffmpeg's names for the colour matrices it can read RGB with.
_MATRICES = {
    "bt709": "bt709",
    "smpte170m": "bt601",
    "bt470bg": "bt601",
    "bt2020nc": "bt2020",
    "bt2020c": "bt2020",
    "fcc": "fcc",
    "smpte240m": "smpte240m",
}

Encoding = Literal["h264", "prores4444", "vp9alpha"]


@dataclass(frozen=True)
class VideoInfo:
    #: The picture as shown: rotation applied.
    width: int
    height: int
    #: The constant frame rate the output gets.
    fps: Fraction
    duration_sec: float
    #: Frames at ``fps`` over the duration: what the model will see.
    frames: int
    #: The frames came on an irregular clock (the header's rates disagree).
    variable: bool
    #: HDR (PQ or HLG) or more than 8 bits a sample: made 8-bit SDR here.
    hdr: bool
    deep: bool
    #: The colour matrix to read the frames with (ffmpeg's name).
    matrix: str
    #: The frames are stored full range (JPEG-style), not TV range.
    full_range: bool
    #: ffmpeg's filter that shows the frames upright ("" when they are).
    turn: str
    #: Pixel shape, when the pixels aren't square (anamorphic DV): "32/27".
    sar: str
    #: The first sound's codec, or None without sound.
    audio: str | None
    #: The picture's stream in the file (not a cover image that may come first).
    stream: int = 0


def _fraction(value: object) -> Fraction | None:
    try:
        rate = Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        return None
    return rate if rate > 0 else None


def pick_fps(average: object, real: object) -> Fraction:
    """The rate to make: the average one when it's sane, else the header's, else 30."""
    for candidate in (_fraction(average), _fraction(real)):
        if candidate is not None and Fraction(1) <= candidate <= MAX_FPS:
            return candidate.limit_denominator(1001)
    real_rate = _fraction(real)
    if real_rate is not None and real_rate > MAX_FPS:
        return MAX_FPS
    return FALLBACK_FPS


def _rotation(stream: dict[str, Any]) -> int:
    """Degrees clockwise to turn the stored frames to show them (0, 90, 180 or 270)."""
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            # A display matrix's angle is counter-clockwise; ffmpeg turns by its negative.
            return _degrees(side["rotation"], -1)
    # The tag is whatever the uploader wrote: anything that isn't a number is no rotation.
    return _degrees((stream.get("tags") or {}).get("rotate", 0), 1)


def _degrees(value: object, sign: int) -> int:
    try:
        return round(sign * float(str(value))) % 360
    except (ValueError, OverflowError):
        return 0


_TURNS = {90: "transpose=clock", 180: "hflip,vflip", 270: "transpose=cclock"}


def _bits(pix_fmt: str) -> int:
    """Bits a sample of an ffmpeg pixel format ("yuv420p10le": 10, "rgb48le": 16)."""
    if "48" in pix_fmt or "64" in pix_fmt:
        return 16
    for depth in (16, 14, 12, 10, 9):
        if f"p{depth}" in pix_fmt or pix_fmt.endswith((f"{depth}le", f"{depth}be")):
            return depth
    return 8


def parse_probe(raw: dict[str, Any]) -> VideoInfo:
    """ffprobe's JSON as VideoInfo; DECODE_FAILED without a picture to read."""
    streams = raw.get("streams") or []
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video"
            and not (s.get("disposition") or {}).get("attached_pic")
        ),
        None,
    )
    if video is None:
        raise CallFailed("NO_VIDEO", "This file has no video in it.")
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if width <= 0 or height <= 0:
        raise CallFailed("DECODE_FAILED", "The video couldn't be decoded; it may be damaged.")
    degrees = _rotation(video)
    if degrees in (90, 270):
        width, height = height, width
    fps = pick_fps(video.get("avg_frame_rate"), video.get("r_frame_rate"))
    real, average = _fraction(video.get("r_frame_rate")), _fraction(video.get("avg_frame_rate"))
    variable = bool(real and average and abs(real - average) > real / 100)
    fmt = raw.get("format") or {}
    duration = float(video.get("duration") or fmt.get("duration") or 0)
    pix_fmt = str(video.get("pix_fmt") or "")
    space = str(video.get("color_space") or "")
    matrix = _MATRICES.get(space) or ("bt709" if height >= 720 or width >= 1280 else "bt601")
    sar = _fraction(str(video.get("sample_aspect_ratio") or "1:1").replace(":", "/"))
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    return VideoInfo(
        width=width,
        height=height,
        fps=fps,
        duration_sec=duration,
        frames=max(1, round(duration * fps)),
        variable=variable,
        hdr=str(video.get("color_transfer") or "") in _HDR_TRANSFERS,
        deep=_bits(pix_fmt) > 8,
        matrix=matrix,
        full_range=str(video.get("color_range") or "") == "pc" or pix_fmt.startswith("yuvj"),
        turn=_TURNS.get(degrees, ""),
        sar=f"{sar.numerator}/{sar.denominator}" if sar and sar != 1 else "",
        audio=str(audio.get("codec_name") or "unknown") if audio else None,
        stream=int(video.get("index") or 0),
    )


def probe(path: Path) -> VideoInfo:
    """Runs ffprobe on the input; DECODE_FAILED when it can't be read."""
    try:
        out = subprocess.run(  # noqa: S603 - fixed arguments, our own temp path
            [
                FFPROBE,
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            check=True,
            timeout=_PROBE_TIMEOUT_SEC,
        )
        raw = json.loads(out.stdout or b"{}")
    except (subprocess.SubprocessError, OSError, ValueError):
        raise CallFailed(
            "DECODE_FAILED", "The video couldn't be decoded; it may be damaged."
        ) from None
    return parse_probe(raw)


def fps_label(fps: Fraction) -> str:
    """29.97, 30, 59.94: a rate as people write it."""
    return f"{float(fps):.2f}".rstrip("0").rstrip(".")


def notes_for(info: VideoInfo) -> list[str]:
    """What the result changed about the picture, in plain words."""
    notes = []
    if info.variable:
        notes.append(f"Variable frame rate made constant at {fps_label(info.fps)} fps")
    if info.hdr:
        notes.append("HDR video was made SDR, so colors may look flatter")
    elif info.deep:
        notes.append("10-bit video was made 8-bit")
    return notes


def too_many_frames(info: VideoInfo, most: int) -> str:
    """Why a clip is too long to take, in plain words."""
    minutes = most / float(info.fps) / 60
    return (
        f"This clip is {info.frames:,} frames ({info.duration_sec / 60:.1f} min at "
        f"{fps_label(info.fps)} fps); we take up to {most:,}, which is {minutes:.1f} min "
        "at this frame rate. Trim it first."
    )


def fits_4k(width: int, height: int) -> bool:
    """At most 3840 x 2160, either way round."""
    return max(width, height) <= MAX_LONG_SIDE and min(width, height) <= MAX_SHORT_SIDE


def rate(fps: Fraction) -> str:
    return f"{fps.numerator}/{fps.denominator}"


def seconds_arg(seconds: float) -> str:
    """A length as ffmpeg's ``-t`` takes it."""
    return f"{seconds:.3f}"


def decode_args(
    source: Path,
    info: VideoInfo,
    pix_fmt: str = "rgb24",
    *,
    max_seconds: float,
    max_frames: int,
) -> list[str]:
    """Raw frames of the first picture, upright, at ``info.fps``, read with the right matrix.

    Only the input's first ``max_seconds`` are read, and one frame past
    ``max_frames`` at most: ``FramePipe`` reads that one only to tell that the
    file goes on, and hands on ``max_frames``.
    """
    if max_seconds <= 0 or max_frames <= 0:
        raise ValueError("the caps must be positive")
    filters = [info.turn] if info.turn else []
    filters.append(
        f"scale=in_color_matrix={info.matrix}:in_range={'pc' if info.full_range else 'tv'}"
        f":flags=bicubic+accurate_rnd+full_chroma_int,format={pix_fmt}"
    )
    return [
        FFMPEG,
        "-nostdin",
        "-v",
        "error",
        "-noautorotate",
        "-t",
        seconds_arg(max_seconds),
        "-i",
        str(source),
        "-map",
        f"0:{info.stream}",
        "-an",
        "-sn",
        "-dn",
        "-vf",
        ",".join(filters),
        "-fps_mode",
        "cfr",
        "-r",
        rate(info.fps),
        "-frames:v",
        str(max_frames + 1),
        "-f",
        "rawvideo",
        "-pix_fmt",
        pix_fmt,
        "pipe:1",
    ]


def cut_note(frames: int, fps: Fraction) -> str:
    """What the result says when the file ran past what was priced."""
    seconds = frames / float(fps)
    return (
        f"The file runs longer than its header says, so only its first "
        f"{length_label(seconds)} ({frames:,} frames) were made: the length it was priced for"
    )


#: Sound a container can carry as it is; anything else is re-encoded.
_KEEPS = {
    "mp4": {"aac", "mp3", "ac3", "eac3", "alac"},
    "mov": {"aac", "alac", "pcm_s16le", "pcm_s24le", "pcm_s16be", "pcm_s24be"},
    "webm": {"opus", "vorbis"},
}
_REENCODE = {
    "mp4": ["-c:a", "aac", "-b:a", "192k"],
    "mov": ["-c:a", "aac", "-b:a", "256k"],
    "webm": ["-c:a", "libopus", "-b:a", "160k"],
}


def audio_args(container: str, codec: str | None) -> tuple[list[str], str | None]:
    """ffmpeg's sound arguments for ``container``, and a note when the sound was re-encoded."""
    if codec is None:
        return ["-an"], None
    mapping = ["-map", "1:a:0?"]
    if codec in _KEEPS[container]:
        return [*mapping, "-c:a", "copy"], None
    target = "Opus" if container == "webm" else "AAC"
    return [*mapping, *_REENCODE[container]], f"The sound was re-encoded to {target}"


_TAGS = [
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
]


def h264_rate_cap(width: int, height: int) -> int:
    """Kilobits a second H.264 may peak at: 50 Mbps for 4K, in step with the picture, 8 at least.

    Ten minutes of 4K stay under 4 GB, so a result always fits one upload.
    """
    return max(8000, round(50_000 * width * height / (MAX_LONG_SIDE * MAX_SHORT_SIDE)))


def encode_args(  # noqa: PLR0913 - one command line, keyword-only settings
    target: Path,
    *,
    encoding: Encoding,
    width: int,
    height: int,
    fps: Fraction,
    source: Path,
    audio: str | None,
    max_seconds: float,
    sar: str = "",
    nvenc: bool = False,
) -> tuple[list[str], list[str]]:
    """The encoder's command line for raw frames on stdin, and its notes.

    H.264 reads RGB, ProRes 4444 and VP9 read RGBA (their alpha is the matte).
    The sound comes from ``source``, copied when the container takes it, and
    only its first ``max_seconds``, as the frames.
    """
    if max_seconds <= 0:
        raise ValueError("max_seconds must be positive")
    alpha = encoding != "h264"
    container = {"h264": "mp4", "prores4444": "mov", "vp9alpha": "webm"}[encoding]
    out_fmt = {"h264": "yuv420p", "prores4444": "yuva444p10le", "vp9alpha": "yuva420p"}[encoding]
    filters = []
    if encoding == "h264" and (width % 2 or height % 2):
        filters.append("crop=trunc(iw/2)*2:trunc(ih/2)*2")  # 4:2:0 needs even sides
    filters.append(f"scale=out_color_matrix=bt709:out_range=tv,format={out_fmt}")
    if sar:
        filters.append(f"setsar={sar}")
    sound, note = audio_args(container, audio)
    head = [
        FFMPEG,
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba" if alpha else "rgb24",
        "-s",
        f"{width}x{height}",
        "-framerate",
        rate(fps),
        "-i",
        "pipe:0",
        "-t",
        seconds_arg(max_seconds),
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-vf",
        ",".join(filters),
    ]
    if encoding == "h264":
        cap = h264_rate_cap(width, height)
        bounds = ["-maxrate", f"{cap}k", "-bufsize", f"{cap * 2}k"]
        if nvenc:
            video = ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr"]
            video += ["-cq", "19", "-b:v", "0", *bounds, "-profile:v", "high"]
        else:
            preset = "faster" if width * height > 2_100_000 else "medium"
            video = ["-c:v", "libx264", "-preset", preset, "-crf", "18", *bounds]
            video += ["-profile:v", "high"]
        tail = ["-movflags", "+faststart", "-f", "mp4"]
    elif encoding == "prores4444":
        video = ["-c:v", "prores_ks", "-profile:v", "4444", "-alpha_bits", "16"]
        video += ["-vendor", "apl0"]
        tail = ["-f", "mov"]
    else:
        video = ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-deadline", "good"]
        video += ["-cpu-used", "4", "-row-mt", "1", "-auto-alt-ref", "0"]
        tail = ["-f", "webm"]
    command = [*head, *video, *_TAGS, *sound, *tail, str(target)]
    return command, [note] if note else []


def nvenc_works() -> bool:
    """Whether this GPU's H.264 encoder answers (a one-frame test); libx264 otherwise."""
    try:
        done = subprocess.run(  # noqa: S603 - fixed arguments
            [
                FFMPEG,
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=black:s=256x256:d=0.1",
                "-frames:v",
                "1",
                "-c:v",
                "h264_nvenc",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            timeout=60,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    return done.returncode == 0


_END = None


class FramePipe:
    """A decoder's raw frames in, an encoder's raw frames out, each through a short queue.

    Use it as a context manager: an exception inside stops both processes.
    ``frames()`` yields each decoded frame (``frame_bytes`` long), and
    ``max_frames`` at most: a frame past them stops the decoder and sets
    ``cut`` (the file went on past what was priced); ``write()`` hands one to
    the encoder; ``finish()`` waits for the output and checks both ends,
    returning how many frames were written.
    """

    def __init__(
        self,
        decode: list[str],
        frame_bytes: int,
        encode: list[str],
        *,
        max_frames: int,
        depth: int = 6,
    ) -> None:
        if frame_bytes <= 0:
            raise ValueError("frame_bytes must be positive")
        if max_frames <= 0:
            raise ValueError("max_frames must be positive")
        self._frame_bytes = frame_bytes
        self._max_frames = max_frames
        self._stop = threading.Event()
        self._in: queue.Queue[bytes | None] = queue.Queue(depth)
        self._out: queue.Queue[bytes | None] = queue.Queue(depth)
        self._broken = False
        self.read = 0
        self.written = 0
        #: The decoder had a frame past ``max_frames``: it was stopped there.
        self.cut = False
        self._decoder = subprocess.Popen(  # noqa: S603 - our own command lines
            decode, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        try:
            self._encoder = subprocess.Popen(  # noqa: S603
                encode, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except OSError:
            self._decoder.kill()
            raise
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._writer = threading.Thread(target=self._write, daemon=True)
        self._reader.start()
        self._writer.start()

    def __enter__(self) -> FramePipe:
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        trace: TracebackType | None,
    ) -> None:
        if kind is not None:
            self.kill()

    def _put(self, box: queue.Queue[bytes | None], item: bytes | None) -> bool:
        while not self._stop.is_set():
            try:
                box.put(item, timeout=0.2)
            except queue.Full:
                continue
            return True
        return False

    def _get(self, box: queue.Queue[bytes | None]) -> bytes | None:
        while not self._stop.is_set():
            try:
                return box.get(timeout=0.2)
            except queue.Empty:
                continue
        return _END

    def _read(self) -> None:
        stream = self._decoder.stdout
        try:
            while stream is not None and not self._stop.is_set():
                frame = _read_exactly(stream, self._frame_bytes)
                if frame is None:
                    break  # the end (a partial last frame is dropped)
                if self.read >= self._max_frames:
                    # The file goes on past what was priced: nothing more is decoded.
                    self.cut = True
                    with contextlib.suppress(OSError):
                        self._decoder.kill()
                    break
                self.read += 1
                if not self._put(self._in, frame):
                    break
        finally:
            self._put(self._in, _END)

    def _write(self) -> None:
        stdin = self._encoder.stdin
        try:
            while stdin is not None:
                frame = self._get(self._out)
                if frame is _END:
                    break
                stdin.write(frame)
                self.written += 1
        except OSError:  # the encoder stopped taking frames
            self._broken = True
        finally:
            if stdin is not None:
                with contextlib.suppress(OSError):
                    stdin.close()

    def frames(self) -> Iterator[bytes]:
        """Decoded frames, in order, until the input ends."""
        while True:
            frame = self._get(self._in)
            if frame is _END:
                return
            yield frame

    def write(self, frame: bytes) -> None:
        """One frame to the encoder; GPU_FAILED when it stopped taking them."""
        if len(frame) == 0:
            raise ValueError("empty frame")
        if self._broken or not self._writer.is_alive() or not self._put(self._out, frame):
            raise CallFailed("GPU_FAILED", "The video couldn't be written.")

    def finish(self) -> int:
        """Ends the output and checks both processes; the number of frames written."""
        self._put(self._out, _END)
        self._writer.join(_FINISH_TIMEOUT_SEC)
        try:
            encoded = self._encoder.wait(_FINISH_TIMEOUT_SEC)
            self._reader.join(_FINISH_TIMEOUT_SEC)
            decoded = self._decoder.wait(_FINISH_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            self.kill()
            raise CallFailed("GPU_FAILED", "The video couldn't be written.") from None
        # A decoder stopped at the cap ends however it ends; it had given every frame we take.
        if (decoded != 0 and not self.cut) or self.read == 0:
            raise CallFailed("DECODE_FAILED", "The video couldn't be decoded; it may be damaged.")
        if encoded != 0 or self._broken or self.written == 0:
            raise CallFailed("GPU_FAILED", "The video couldn't be written.")
        return self.written

    def kill(self) -> None:
        """Stops both processes and their threads at once."""
        self._stop.set()
        for process in (self._decoder, self._encoder):
            with contextlib.suppress(OSError):
                process.kill()
        for process in (self._decoder, self._encoder):
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(10)
        for thread in (self._reader, self._writer):
            thread.join(5)


def _read_exactly(stream: IO[bytes], size: int) -> bytes | None:
    """``size`` bytes, or None at the end of the stream."""
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return chunks[0] if len(chunks) == 1 else b"".join(chunks)
