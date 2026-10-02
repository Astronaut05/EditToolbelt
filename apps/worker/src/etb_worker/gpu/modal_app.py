"""The GPU functions on Modal (docs/01-architecture.md -> GPU backend: ServerlessGpu).

CI deploys this as the app `edittoolbelt-gpu` on every merge to main
(.github/workflows/modal.yml). The worker spawns its functions by name and
polls them (gpu/backend.py); Modal never calls us. Inputs and outputs move
only through R2 presigned URLs in the call's arguments, and nothing is kept
on Modal: each call works in a temp dir that is always removed, writes its
result to storage itself, and returns only numbers and notes. Containers
scale to zero after a short idle window.

One function per tool, on the cheapest GPU that does the job:

- ``upscale_image`` (P08), **T4**: Real-ESRGAN's networks are small (5 to
  17 MB) and run in 512 px tiles, so 16 GB is plenty; for a typical photo
  the call is mostly reading, tiling and writing PNG, where a faster GPU
  saves little and the T4's lower price per second wins.
- ``transcribe`` (A12, V17), **L4**: Whisper large-v3 is a 1.5 B parameter
  model that decodes token by token; the L4 runs it in fp16 about twice as
  fast as a T4 for about 1.35x the price, so it's cheaper per minute of
  audio, and faster.
- ``erase_object`` (P17), **T4**: MI-GAN's ONNX pipeline is 28 MB and fills
  each region in one 512 px pass, a few milliseconds on any GPU; the call is
  mostly decoding and encoding the photo, so the cheapest GPU it is.
- ``upscale_video`` (V20), **L4**: Real-ESRGAN on every frame. A 1080p frame
  made 4K is about 2.5 TMAC through the network, which the L4's fp16 tensor
  cores do about 2.2x faster than a T4 for 1.35x the price: cheaper per
  frame. Frames are decoded and encoded by ffmpeg beside it (gpu/video.py).
- ``remove_video_background`` (V21), **L4**: BiRefNet_lite on every frame
  through ONNX Runtime in fp32, which the L4 runs on TF32 tensor cores; a T4
  has none, so it would be several times slower for 0.74x the price.

The images are pinned (docs/11 -> Supply chain): the base image by digest,
every Python package by version and hash (requirements-*.txt, compiled from
the .in files beside them), and the weights by the SHA-256 in pins.json,
checked while Modal builds each image (weights.py); a mismatch fails the
build. Every function asks for the same CPU and memory, which
config/business.ts prices together with the GPU.

A function never lets an exception out: Modal would log its traceback, and
urllib's errors can quote the presigned URL. Anything unexpected comes back
as ``GPU_FAILED`` with a fixed sentence and only the exception's type.

The functions that decode sound or video read only what the job was priced
for: the worker sends ``max_seconds`` (all three) and ``max_frames`` (the
video ones), worked out from the probe it priced the job on, and the
decoders stop there (gpu/video.py, gpu/audio.py). A file whose header says
less than it holds is cut at that point and the result says so. Without
them (a worker from before the caps) a function takes its own hard caps
below, never "no limit".
"""

from __future__ import annotations

import contextlib
import json
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import modal

from etb_worker.gpu import APP_NAME, audio, inpaint, video
from etb_worker.gpu.remote import (
    Call,
    CallFailed,
    clear,
    fetch_input,
    float_cap,
    int_cap,
    put_output,
)

HERE = Path(__file__).resolve().parent
WEIGHTS = "/models"
#: Every tool function's CPU cores and memory (MiB): config/business.ts prices this shape.
CPU_CORES = 2.0
MEMORY_MIB = 8192


@dataclass(frozen=True)
class Spec:
    gpu: str
    #: Seconds before Modal stops a call (the job's own limit is a little longer).
    timeout: int
    #: Seconds a container idles, billed, waiting for another call before it stops.
    scaledown: int
    max_containers: int
    #: The largest input the function reads.
    max_input_bytes: int


SPECS: dict[str, Spec] = {
    # Loading the networks takes about a second, so idling longer buys little.
    "upscale_image": Spec("T4", 15 * 60, 10, 2, 100 * 1024**2),
    # Loading large-v3 takes 15 to 25 s: a 30 s window catches the next file of a batch.
    # A12 and V17 share it: as many containers as both tools' maxConcurrent, so no call of
    # ours ever queues on Modal behind another (the worker's clock would count the wait).
    "transcribe": Spec("L4", 65 * 60, 30, 4, 2 * 1024**3),
    # MI-GAN loads in about a second; a 50 MP photo decodes and encodes in well under a minute.
    "erase_object": Spec("T4", 5 * 60, 10, 2, 100 * 1024**2),
    # Up to 18,000 frames (10 min at 30 fps) at up to 4K: the slowest case is about an hour.
    "upscale_video": Spec("L4", 90 * 60, 10, 2, 2 * 1024**3),
    "remove_video_background": Spec("L4", 90 * 60, 10, 2, 2 * 1024**3),
}
#: Object Eraser's mask: a PNG, mostly one colour, so small.
MAX_MASK_BYTES = 50 * 1024**2
#: The video tools take this many frames at most (10 min at 30 fps, 5 at 60).
MAX_VIDEO_FRAMES = 18_000
#: The most a function decodes, whatever the worker sends: the tools' longest paid length
#: (registry: 10 min of video, 4 h of speech) with room for the worker's margin (2 % + 1 s).
MAX_VIDEO_SECONDS = 11 * 60
MAX_AUDIO_SECONDS = 4 * 60 * 60 + 10 * 60

app = modal.App(APP_NAME)

#: What Modal's debian_slim builds on (the official Python image), pinned by digest as the
#: worker's Dockerfile pins its own: Docker Hub's index digest, read 2026-10-02 (amd64 inside).
BASE_IMAGE = (
    "python:3.12.14-slim-bookworm"
    "@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e"
)
image = modal.Image.from_registry(BASE_IMAGE)


def _requirements(base: modal.Image, name: str) -> modal.Image:
    """Installs requirements-<name>.txt: every package at its version, checked by hash."""
    return base.pip_install_from_requirements(
        str(HERE / f"requirements-{name}.txt"), extra_options="--require-hashes"
    )


def _with_weights(base: modal.Image, group: str) -> modal.Image:
    """Downloads and checks the group's pinned weights into /models at build time."""
    return (
        base.add_local_file(HERE / "weights.py", "/opt/etb/weights.py", copy=True)
        .add_local_file(HERE / "pins.json", "/opt/etb/pins.json", copy=True)
        .run_commands(f"python /opt/etb/weights.py /opt/etb/pins.json {group} {WEIGHTS}")
    )


# Modal adds this module's package (etb_worker) to every container by itself.
# PyTorch 2.10 is the last whose PyPI wheels use CUDA 12.8 (docs/13 -> GPU images).
upscale_env = _with_weights(_requirements(image, "upscale"), "upscale")
# ffmpeg decodes the audio; gcc builds Triton's launcher for Whisper's word-timing kernels
# (debian_slim had it). Both from Debian bookworm, verified by apt's signatures (docs/13).
whisper_env = _with_weights(
    _requirements(image.apt_install("ffmpeg", "gcc", "libc6-dev"), "whisper"), "whisper"
)
# V20 reuses P08's image and weights (hashed packages included), with ffmpeg for the frames.
upscale_video_env = upscale_env.apt_install("ffmpeg")
# ONNX Runtime 1.26.0, the last built for CUDA 12, with the CUDA 12.8 and cuDNN wheels
# PyTorch 2.10 pins, named in requirements-onnx.in (its `cuda` extra leaves out cuBLAS).
inpaint_env = _with_weights(_requirements(image, "onnx"), "inpaint")
# ffmpeg decodes and encodes V21's frames (Debian bookworm, verified by apt's signatures).
matte_env = _with_weights(_requirements(image.apt_install("ffmpeg"), "onnx"), "matte")

#: Models stay loaded for the container's life; a call that loads one reports itself cold.
_LOADED: dict[str, Any] = {}


def _unexpected(call: Call, error: Exception) -> dict[str, Any]:
    """A failure nobody worded: a fixed sentence and the exception's type, never its text."""
    return call.failed(
        CallFailed("GPU_FAILED", f"The GPU function failed ({type(error).__name__}).")
    )


def _options(spec: Spec) -> dict[str, Any]:
    return {
        "gpu": spec.gpu,
        "cpu": CPU_CORES,
        "memory": MEMORY_MIB,
        "timeout": spec.timeout,
        "scaledown_window": spec.scaledown,
        "max_containers": spec.max_containers,
    }


@app.function(image=image, timeout=60)
def ping() -> dict[str, str]:
    """Answers without a GPU: the app is deployed and the caller's token works."""
    return {"status": "ok", "app": APP_NAME}


@app.function(image=image, gpu="T4", timeout=120, max_containers=1)
def gpu_check() -> dict[str, str]:
    """The GPU the function got, as nvidia-smi names it (a few GPU-seconds)."""
    out = subprocess.run(
        ["/usr/bin/nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    return {"gpu": out.stdout.strip()}


# --- P08 Upscale Image -------------------------------------------------------

UPSCALE_TILE = 512
UPSCALE_PAD = 24
MAX_OUTPUT_PIXELS = 64_000_000
UPSCALE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
#: The Real-ESRGAN weights each model loads; "general" blends two by the denoise strength.
UPSCALERS = {
    "general": "realesr-general-x4v3.pth",
    "anime": "RealESRGAN_x4plus_anime_6B.pth",
    # V20: the authors' anime model for video, small and steady from frame to frame.
    "anime-video": "realesr-animevideov3.pth",
}


def _upscaler(model: str, denoise: float, call: Call) -> Any:
    """The network for ``model``; General blends two weights by ``denoise`` (Real-ESRGAN's DNI)."""
    import torch  # noqa: PLC0415 - only inside the GPU image
    from spandrel import ImageModelDescriptor, ModelLoader  # noqa: PLC0415

    model = model if model in UPSCALERS else "general"
    key = f"{model}:{denoise:.2f}"
    if key in _LOADED:
        return _LOADED[key]
    call.cold = True

    def state(name: str) -> dict[str, Any]:
        raw = torch.load(f"{WEIGHTS}/{name}", map_location="cpu", weights_only=True)
        for wrapper in ("params_ema", "params"):
            if isinstance(raw, dict) and wrapper in raw:
                return dict(raw[wrapper])
        return dict(raw)

    weights = state(UPSCALERS[model])
    if model == "general" and denoise < 1:
        weak = state("realesr-general-wdn-x4v3.pth")
        weights = {k: denoise * v + (1 - denoise) * weak[k] for k, v in weights.items()}
    loaded = ModelLoader().load_from_state_dict(weights)
    if not isinstance(loaded, ImageModelDescriptor):
        raise CallFailed("GPU_FAILED", "The upscaling model didn't load.")
    loaded = loaded.to("cuda").eval()
    if loaded.supports_half:
        loaded = loaded.half()
    _LOADED.clear()  # one network at a time is enough memory
    _LOADED[key] = loaded
    return loaded


def _run_tiles(network: Any, pixels: Any) -> Any:
    """``pixels`` (H, W, 3 uint8) through the network in tiles: (4H, 4W, 3 uint8), no seams."""
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415

    from etb_worker.gpu.tiles import plan  # noqa: PLC0415

    height, width = pixels.shape[:2]
    scale = int(network.scale)
    out = np.empty((height * scale, width * scale, 3), dtype=np.uint8)
    source = torch.from_numpy(pixels).permute(2, 0, 1).unsqueeze(0)
    dtype = torch.float16 if network.supports_half else torch.float32
    with torch.inference_mode():
        for tile in plan(width, height, UPSCALE_TILE, UPSCALE_PAD, scale):
            left, top, right, bottom = tile.padded
            piece = source[:, :, top:bottom, left:right].to("cuda", dtype) / 255
            result = network(piece).clamp(0, 1)
            c_left, c_top, c_right, c_bottom = tile.crop
            result = result[0, :, c_top:c_bottom, c_left:c_right]
            o_left, o_top, o_right, o_bottom = tile.out
            out[o_top:o_bottom, o_left:o_right] = (
                (result * 255).round().byte().permute(1, 2, 0).cpu().numpy()
            )
    return out


def _read_image(source: Path, notes: list[str]) -> tuple[Any, Any, bytes | None]:
    """The photo upright, as (H, W, 3 uint8), its alpha (or None) and its ICC profile."""
    import numpy as np  # noqa: PLC0415
    from PIL import Image, ImageOps  # noqa: PLC0415

    Image.MAX_IMAGE_PIXELS = 100_000_000  # decompression bombs (docs/11)
    try:
        with Image.open(source) as opened:
            picture = ImageOps.exif_transpose(opened)
            icc = picture.info.get("icc_profile")
            alpha_modes = ("RGBA", "LA", "PA")
            has_alpha = picture.mode in alpha_modes or (
                picture.mode == "P" and "transparency" in picture.info
            )
            if picture.mode in ("I;16", "I;16B", "I", "F"):
                notes.append("16-bit input was reduced to 8-bit")
            alpha = picture.convert("RGBA").getchannel("A") if has_alpha else None
            rgb = np.array(picture.convert("RGB"))
    except (OSError, Image.DecompressionBombError, ValueError):
        raise CallFailed(
            "DECODE_FAILED", "The image couldn't be decoded; it may be damaged."
        ) from None
    return rgb, alpha, icc


def _save_image(  # noqa: PLR0913 - one picture and how to write it
    result: Any,
    target: Path,
    fmt: str,
    *,
    alpha: Any,
    icc: bytes | None,
    notes: list[str],
    quality: int = 92,
) -> None:
    """Writes ``result`` (RGB) as PNG, JPG or WebP, with its alpha and colour profile."""
    from PIL import Image  # noqa: PLC0415

    if alpha is not None:
        if fmt == "jpg":
            notes.append("JPG has no transparency, so it sits on white")
            backdrop = Image.new("RGB", result.size, (255, 255, 255))
            backdrop.paste(result, mask=alpha)
            result = backdrop
        else:
            result.putalpha(alpha)
    extra = {"icc_profile": icc} if icc else {}
    if fmt == "jpg":
        result.convert("RGB").save(target, "JPEG", quality=quality, subsampling=0, **extra)
    elif fmt == "webp":
        result.save(target, "WEBP", quality=quality, method=4, **extra)
    else:
        result.save(target, "PNG", compress_level=6, **extra)


def _upscale(source: Path, target: Path, options: dict[str, Any], call: Call) -> dict[str, Any]:
    from PIL import Image  # noqa: PLC0415

    scale = 2 if int(options.get("scale", 4)) == 2 else 4
    fmt = str(options.get("format", "png"))
    notes: list[str] = []
    rgb, alpha, icc = _read_image(source, notes)
    height, width = rgb.shape[:2]
    if width * height * scale * scale > MAX_OUTPUT_PIXELS:
        too_big = "The result would be over 64 MP. Pick 2×, or a smaller image."  # noqa: RUF001
        raise CallFailed("TOO_LARGE", too_big)
    denoise = float(options.get("denoise", 0.5))
    model = "anime" if options.get("model") == "anime" else "general"
    network = _upscaler(model, denoise, call)
    result = Image.fromarray(_run_tiles(network, rgb))
    size = (width * scale, height * scale)
    if result.size != size:
        result = result.resize(size, Image.Resampling.LANCZOS)
    if alpha is not None:
        alpha = alpha.resize(size, Image.Resampling.LANCZOS)
    _save_image(result, target, fmt, alpha=alpha, icc=icc, notes=notes)
    return {"width": size[0], "height": size[1], "notes": notes}


@app.function(image=upscale_env, **_options(SPECS["upscale_image"]))
def upscale_image(
    input_url: str, output_url: str | None, options: dict[str, Any]
) -> dict[str, Any]:
    """P08: the image at ``input_url``, 2x or 4x, written to ``output_url``."""
    spec = SPECS["upscale_image"]
    call = Call(gpu=spec.gpu, idle_tail_seconds=spec.scaledown)
    work = Path(tempfile.mkdtemp(prefix="etb-"))
    try:
        source = work / "input"
        fmt = str(options.get("format", "png"))
        fmt = fmt if fmt in UPSCALE_TYPES else "png"
        fetch_input(input_url, source, spec.max_input_bytes)
        target = work / f"output.{fmt}"
        meta = _upscale(source, target, options, call)
        notes = meta.pop("notes")
        meta["bytes"] = put_output(output_url, target, UPSCALE_TYPES[fmt])
        return call.ok(meta, notes)
    except CallFailed as error:
        return call.failed(error)
    except Exception as error:  # noqa: BLE001 - see the module's docstring
        return _unexpected(call, error)
    finally:
        clear(work)


# --- A12 Transcribe Audio, V17 Auto Subtitles ----------------------------------


def _whisper(call: Call) -> Any:
    import whisper  # noqa: PLC0415 - only inside the GPU image

    if "whisper" in _LOADED:
        return _LOADED["whisper"]
    call.cold = True
    model = whisper.load_model(f"{WEIGHTS}/large-v3.pt", device="cuda")
    # Loaded from a file, Whisper doesn't know which heads time the words: tell it.
    heads = getattr(whisper, "_ALIGNMENT_HEADS", {}).get("large-v3")
    if heads:
        model.set_alignment_heads(heads)
    _LOADED["whisper"] = model
    return model


def _transcript(result: dict[str, Any]) -> dict[str, Any]:
    """Whisper's result, reduced to what captions.py reads."""
    return {
        "language": result.get("language") or "",
        "segments": [
            {
                "start": float(segment["start"]),
                "end": float(segment["end"]),
                "text": segment.get("text") or "",
                "words": [
                    {"start": float(w["start"]), "end": float(w["end"]), "word": w["word"]}
                    for w in segment.get("words") or []
                ],
            }
            for segment in result.get("segments") or []
        ],
    }


def _samples(pcm: bytes) -> Any:
    """16-bit samples as the float32 array Whisper takes (as whisper.audio.load_audio makes it)."""
    import numpy as np  # noqa: PLC0415 - only inside the GPU image

    return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0


@app.function(image=whisper_env, **_options(SPECS["transcribe"]))
def transcribe(input_url: str, output_url: str | None, options: dict[str, Any]) -> dict[str, Any]:
    """A12 and V17: Whisper large-v3's transcript of the audio, as JSON, to ``output_url``.

    Only the input's first ``options["max_seconds"]`` are decoded (what was priced).
    """
    spec = SPECS["transcribe"]
    call = Call(gpu=spec.gpu, idle_tail_seconds=spec.scaledown)
    work = Path(tempfile.mkdtemp(prefix="etb-"))
    try:
        max_seconds = float_cap(options, "max_seconds", MAX_AUDIO_SECONDS)
        source = work / "input"
        fetch_input(input_url, source, spec.max_input_bytes)
        language = str(options.get("language") or "auto")
        task = "translate" if options.get("task") == "translate" else "transcribe"
        # Decoded here, not by Whisper (which reads to the end of the file), and only so far.
        pcm = audio.decode(source, max_seconds)
        notes = [audio.cut_note(pcm)] if audio.reached_cap(pcm, max_seconds) else []
        samples = _samples(pcm)
        del pcm
        model = _whisper(call)
        result = model.transcribe(
            samples,
            language=None if language == "auto" else language,
            task=task,
            word_timestamps=True,
            verbose=None,  # never print the words
            condition_on_previous_text=False,
            hallucination_silence_threshold=2.0,
            fp16=True,
        )
        document = _transcript(result)
        target = work / "transcript.json"
        target.write_text(json.dumps(document, ensure_ascii=False), "utf-8")
        size = put_output(output_url, target, "application/json")
        return call.ok(
            {
                "language": document["language"],
                "segments": len(document["segments"]),
                "bytes": size,
            },
            notes,
        )
    except CallFailed as error:
        return call.failed(error)
    except Exception as error:  # noqa: BLE001 - see the module's docstring
        return _unexpected(call, error)
    finally:
        clear(work)


# --- P17 Object Eraser -----------------------------------------------------------

MIGAN = "migan_pipeline_v2.onnx"


def _session(name: str, call: Call, *, search: str) -> Any:
    """An ONNX Runtime session for the pinned model ``name`` on the GPU, kept while warm.

    ``search`` is cuDNN's convolution search: EXHAUSTIVE pays off for a model
    that sees one input size thousands of times (BiRefNet), HEURISTIC for one
    whose input size changes every call (MI-GAN's crops).
    """
    import onnxruntime as ort  # noqa: PLC0415 - only inside the GPU image

    if name in _LOADED:
        return _LOADED[name]
    call.cold = True
    # Loads the CUDA 12 and cuDNN libraries pip installed beside it (ONNX Runtime 1.21+).
    with contextlib.suppress(AttributeError, OSError):
        ort.preload_dlls()
    options = ort.SessionOptions()
    options.log_severity_level = 3
    providers = [("CUDAExecutionProvider", {"cudnn_conv_algo_search": search})]
    try:
        session = ort.InferenceSession(f"{WEIGHTS}/{name}", options, providers=providers)
    except Exception:  # noqa: BLE001 - ONNX Runtime raises its own types
        raise CallFailed("GPU_FAILED", "The model didn't start on the GPU.") from None
    if "CUDAExecutionProvider" not in session.get_providers():
        raise CallFailed("GPU_FAILED", "The model didn't start on the GPU.")
    _LOADED[name] = session
    return session


def _grow(hole: Any, steps: int) -> Any:
    """``hole`` (bool) grown by ``steps`` px each way: object edges and halos are filled too."""
    grown = hole.copy()
    for _ in range(steps):
        step = grown.copy()
        step[1:, :] |= grown[:-1, :]
        step[:-1, :] |= grown[1:, :]
        step[:, 1:] |= grown[:, :-1]
        step[:, :-1] |= grown[:, 1:]
        grown = step
    return grown


def _read_mask(path: Path, width: int, height: int) -> Any:
    """The mask as a bool array the photo's size: True where to erase (white)."""
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    try:
        with Image.open(path) as opened:
            mask = opened.convert("L")
    except (OSError, Image.DecompressionBombError, ValueError):
        raise CallFailed("BAD_MASK", "The mask couldn't be read; send it as a PNG.") from None
    if not inpaint.mask_fits(mask.width, mask.height, width, height):
        raise CallFailed(
            "BAD_MASK",
            f"The mask is {mask.width} × {mask.height} px, not the shape of the image "  # noqa: RUF001
            f"({width} × {height} px).",  # noqa: RUF001
        )
    if mask.size != (width, height):
        mask = mask.resize((width, height), Image.Resampling.BILINEAR)
    return np.asarray(mask) >= 128


def _erase(
    source: Path, mask_path: Path, target: Path, options: dict[str, Any], call: Call
) -> dict[str, Any]:
    """MI-GAN fills each marked region on a crop around it; every other pixel stays as it was."""
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    fmt = str(options.get("format", "png"))
    notes: list[str] = []
    rgb, alpha, icc = _read_image(source, notes)
    height, width = rgb.shape[:2]
    hole = _read_mask(mask_path, width, height)
    if not hole.any():
        raise CallFailed("EMPTY_MASK", "The mask marks nothing to erase.")
    # Any marked pixel marks its cell of a coarse grid; regions come from the cells.
    cell = inpaint.cell_size(width, height)
    rows, cols = -(-height // cell), -(-width // cell)
    padded = np.zeros((rows * cell, cols * cell), dtype=bool)
    padded[:height, :width] = hole
    ys, xs = np.nonzero(padded.reshape(rows, cell, cols, cell).any(axis=(1, 3)))
    regions = inpaint.plan(zip(xs.tolist(), ys.tolist(), strict=True), cell, width, height)
    session = _session(MIGAN, call, search="HEURISTIC")
    image_in, mask_in = (item.name for item in session.get_inputs()[:2])
    grow = inpaint.dilation(width, height)
    for region in regions:
        left, top, right, bottom = region.crop
        area = _grow(hole[top:bottom, left:right], grow)
        crop = rgb[top:bottom, left:right]
        feed = {
            image_in: np.ascontiguousarray(crop.transpose(2, 0, 1)[None]),
            # MI-GAN's mask: 255 where the photo is kept, 0 where it fills.
            mask_in: np.where(area, 0, 255).astype(np.uint8)[None, None],
        }
        filled = session.run(None, feed)[0][0].transpose(1, 2, 0)
        crop[area] = filled[area]
    _save_image(Image.fromarray(rgb), target, fmt, alpha=alpha, icc=icc, notes=notes, quality=95)
    if len(regions) > 1:
        notes.append(f"{len(regions)} areas filled, each on its own")
    return {"width": width, "height": height, "regions": len(regions), "notes": notes}


def _mask_url(extra_urls: list[str] | None) -> str:
    if not extra_urls:
        raise CallFailed("BAD_MASK", "No mask came with the image.")
    return extra_urls[0]


@app.function(image=inpaint_env, **_options(SPECS["erase_object"]))
def erase_object(
    input_url: str,
    output_url: str | None,
    options: dict[str, Any],
    extra_urls: list[str] | None = None,
) -> dict[str, Any]:
    """P17: the image at ``input_url`` with what the mask (``extra_urls[0]``) marks filled in."""
    spec = SPECS["erase_object"]
    call = Call(gpu=spec.gpu, idle_tail_seconds=spec.scaledown)
    work = Path(tempfile.mkdtemp(prefix="etb-"))
    try:
        mask_url = _mask_url(extra_urls)
        source, mask = work / "input", work / "mask"
        fmt = str(options.get("format", "png"))
        fmt = fmt if fmt in UPSCALE_TYPES else "png"
        fetch_input(input_url, source, spec.max_input_bytes)
        fetch_input(mask_url, mask, MAX_MASK_BYTES)
        target = work / f"output.{fmt}"
        meta = _erase(source, mask, target, {**options, "format": fmt}, call)
        notes = meta.pop("notes")
        meta["bytes"] = put_output(output_url, target, UPSCALE_TYPES[fmt])
        return call.ok(meta, notes)
    except CallFailed as error:
        return call.failed(error)
    except Exception as error:  # noqa: BLE001 - see the module's docstring
        return _unexpected(call, error)
    finally:
        clear(work)


# --- Video (V20, V21) --------------------------------------------------------------


def _nvenc() -> bool:
    """Whether this container's GPU encodes H.264 (NVENC), asked once."""
    if "nvenc" not in _LOADED:
        _LOADED["nvenc"] = video.nvenc_works()
    return bool(_LOADED["nvenc"])


def _check_video(info: video.VideoInfo) -> None:
    if info.frames > MAX_VIDEO_FRAMES:
        raise CallFailed("TOO_LARGE", video.too_many_frames(info, MAX_VIDEO_FRAMES))


@dataclass(frozen=True)
class VideoCaps:
    """The most a video call decodes: what the worker priced, within the hard caps."""

    frames: int
    seconds: float


def _video_caps(options: dict[str, Any]) -> VideoCaps:
    return VideoCaps(
        frames=int_cap(options, "max_frames", MAX_VIDEO_FRAMES),
        seconds=float_cap(options, "max_seconds", MAX_VIDEO_SECONDS),
    )


def _frame_pipe(
    source: Path, info: video.VideoInfo, encode: list[str], caps: VideoCaps
) -> video.FramePipe:
    """The input's frames (RGB, as shown), at most ``caps``, into ``encode``."""
    return video.FramePipe(
        video.decode_args(source, info, max_seconds=caps.seconds, max_frames=caps.frames),
        info.width * info.height * 3,
        encode,
        max_frames=caps.frames,
    )


def _video_notes(info: video.VideoInfo, pipe: video.FramePipe, notes: list[str]) -> list[str]:
    cut = [video.cut_note(pipe.read, info.fps)] if pipe.cut else []
    return [*cut, *video.notes_for(info), *notes]


# --- V20 Upscale Video ---------------------------------------------------------------

#: Input pixels a batch holds at most: four 540p frames, or one 1080p frame.
VIDEO_BATCH_PIXELS = 2_100_000


def _upscale_frames(
    network: Any, frames: list[bytes], width: int, height: int, scale: int
) -> list[bytes]:
    """A batch of RGB frames through the x4 network, made ``scale`` times their size."""
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415
    import torch.nn.functional as func  # noqa: PLC0415

    batch = np.stack([np.frombuffer(frame, np.uint8).reshape(height, width, 3) for frame in frames])
    dtype = torch.float16 if network.supports_half else torch.float32
    with torch.inference_mode():
        pixels = torch.from_numpy(batch).to("cuda").permute(0, 3, 1, 2).contiguous()
        pixels = pixels.to(dtype) / 255
        result = network(pixels)
        if result.shape[-2:] != (height * scale, width * scale):
            # 2x: the x4 result made half its size, smoothly (as Real-ESRGAN's own outscale).
            result = func.interpolate(
                result.float(),
                size=(height * scale, width * scale),
                mode="bicubic",
                antialias=True,
                align_corners=False,
            )
        out = (result.clamp(0, 1) * 255).round().to(torch.uint8).permute(0, 2, 3, 1)
        array = out.contiguous().cpu().numpy()
    return [frame.tobytes() for frame in array]


def _upscale_video(
    source: Path, target: Path, options: dict[str, Any], call: Call
) -> dict[str, Any]:
    caps = _video_caps(options)
    info = video.probe(source)
    _check_video(info)
    scale = 2 if int(options.get("scale", 4)) == 2 else 4
    width, height = info.width * scale, info.height * scale
    if not video.fits_4k(width, height):
        raise CallFailed(
            "TOO_LARGE",
            f"At {scale}× this would be {width} × {height} px; we make up to 4K "  # noqa: RUF001
            "(3840 × 2160). Pick 2×, or a smaller video.",  # noqa: RUF001
        )
    model = "anime-video" if options.get("model") == "anime" else "general"
    network = _upscaler(model, float(options.get("denoise", 0.5)), call)
    nvenc = _nvenc()
    encode, notes = video.encode_args(
        target,
        encoding="h264",
        width=width,
        height=height,
        fps=info.fps,
        source=source,
        audio=info.audio,
        max_seconds=caps.seconds,
        sar=info.sar,
        nvenc=nvenc,
    )
    batch = max(1, min(8, VIDEO_BATCH_PIXELS // (info.width * info.height)))
    with _frame_pipe(source, info, encode, caps) as pipe:
        pending: list[bytes] = []
        for frame in pipe.frames():
            pending.append(frame)
            if len(pending) == batch:
                for out in _upscale_frames(network, pending, info.width, info.height, scale):
                    pipe.write(out)
                pending = []
        if pending:
            for out in _upscale_frames(network, pending, info.width, info.height, scale):
                pipe.write(out)
        frames = pipe.finish()
    return {
        "width": width,
        "height": height,
        "frames": frames,
        "fps": round(float(info.fps), 3),
        "encoder": "nvenc" if nvenc else "x264",
        "notes": _video_notes(info, pipe, notes),
    }


@app.function(image=upscale_video_env, **_options(SPECS["upscale_video"]))
def upscale_video(
    input_url: str, output_url: str | None, options: dict[str, Any]
) -> dict[str, Any]:
    """V20: the video at ``input_url``, 2x or 4x (4K at most), as H.264 MP4 to ``output_url``."""
    spec = SPECS["upscale_video"]
    call = Call(gpu=spec.gpu, idle_tail_seconds=spec.scaledown)
    work = Path(tempfile.mkdtemp(prefix="etb-"))
    try:
        source = work / "input"
        fetch_input(input_url, source, spec.max_input_bytes)
        target = work / "output.mp4"
        meta = _upscale_video(source, target, options, call)
        notes = meta.pop("notes")
        meta["bytes"] = put_output(output_url, target, "video/mp4")
        return call.ok(meta, notes)
    except CallFailed as error:
        return call.failed(error)
    except Exception as error:  # noqa: BLE001 - see the module's docstring
        return _unexpected(call, error)
    finally:
        clear(work)


# --- V21 Video Background Remover ------------------------------------------------------

BIREFNET = "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx"
#: BiRefNet's input side, and the grid the flicker filter compares frames on.
MATTE_SIDE = 1024
MOTION_SIDE = 256
#: What each output is encoded as, its file type and its MIME type.
MATTE_OUTPUTS: dict[str, tuple[video.Encoding, str, str]] = {
    "prores": ("prores4444", "mov", "video/quicktime"),
    "webm": ("vp9alpha", "webm", "video/webm"),
    "green": ("h264", "mp4", "video/mp4"),
    "color": ("h264", "mp4", "video/mp4"),
}
#: Chroma-key green (#00B140), what editors' keyers expect.
GREEN = (0, 177, 64)
#: A still pixel keeps this much of the last frame's matte (damps flicker).
CARRY = 0.6
#: A luminance change (0-1) at which a pixel counts as moving and follows the model at once.
MOTION = 0.06
#: A mean luminance change that marks a new shot: nothing carries over a cut.
SHOT_CHANGE = 0.12


class _Smoother:
    """Damps the matte's frame-to-frame flicker where the picture holds still.

    BiRefNet sees each frame alone, so an edge can shimmer between frames
    that barely differ. Where the picture stands still, a share of the last
    matte carries over; where it moves, or after a cut, the model's own
    matte is used as it is, so nothing lags behind a moving subject.
    """

    def __init__(self) -> None:
        self.alpha: Any = None
        self.gray: Any = None

    def step(self, alpha: Any, gray: Any) -> Any:
        import numpy as np  # noqa: PLC0415

        if self.alpha is None or float(np.abs(gray - self.gray).mean()) > SHOT_CHANGE:
            out = alpha
        else:
            still = np.clip(1 - np.abs(gray - self.gray) / MOTION, 0, 1) * CARRY
            factor = MATTE_SIDE // MOTION_SIDE
            still = still.repeat(factor, axis=0).repeat(factor, axis=1)
            out = still * self.alpha + (1 - still) * alpha
        self.alpha, self.gray = out, gray
        return out


def _colour(options: dict[str, Any]) -> tuple[int, int, int]:
    if options.get("output") != "color":
        return GREEN
    value = str(options.get("color") or "")
    if len(value) == 7 and value.startswith("#"):
        with contextlib.suppress(ValueError):
            return (int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16))
    return GREEN


def _matte_frame(session: Any, name: str, rgb: Any) -> tuple[Any, Any]:
    """BiRefNet's matte of one frame at 1024 x 1024 (0-1), and the frame's coarse luminance."""
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    small = np.asarray(
        Image.fromarray(rgb).resize((MATTE_SIDE, MATTE_SIDE), Image.Resampling.BILINEAR),
        dtype=np.float32,
    ) / np.float32(255)
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    feed = np.ascontiguousarray(((small - mean) / std).transpose(2, 0, 1)[None])
    logits = session.run(None, {name: feed})[0][0, 0]
    alpha = 1 / (1 + np.exp(-np.clip(logits, -30, 30)))
    factor = MATTE_SIDE // MOTION_SIDE
    gray = (
        (small @ np.array([0.299, 0.587, 0.114], dtype=np.float32))
        .reshape(MOTION_SIDE, factor, MOTION_SIDE, factor)
        .mean(axis=(1, 3))
    )
    return alpha.astype(np.float32), gray


def _matter(
    options: dict[str, Any], call: Call, width: int, height: int, *, keyed: bool
) -> Callable[[bytes], bytes]:
    """One frame's work: an RGB frame in; RGBA with the matte as alpha (``keyed``), or RGB on
    the background colour, out. The flicker filter carries from each frame to the next."""
    import numpy as np  # noqa: PLC0415 - only inside the GPU image
    from PIL import Image  # noqa: PLC0415

    background = np.array(_colour(options), dtype=np.uint16)
    session = _session(BIREFNET, call, search="EXHAUSTIVE")
    name = session.get_inputs()[0].name
    smoother = _Smoother()

    def matte(frame: bytes) -> bytes:
        rgb = np.frombuffer(frame, np.uint8).reshape(height, width, 3)
        small, gray = _matte_frame(session, name, rgb)
        smooth = smoother.step(small, gray)
        alpha = np.asarray(
            Image.fromarray((smooth * 255 + 0.5).astype(np.uint8)).resize(
                (width, height), Image.Resampling.BILINEAR
            )
        )
        if keyed:
            pixels = np.dstack((rgb, alpha))
        else:
            weight = alpha.astype(np.uint16)[..., None]
            mixed = (rgb.astype(np.uint16) * weight + background * (255 - weight) + 127) // 255
            pixels = mixed.astype(np.uint8)
        out: bytes = pixels.tobytes()
        return out

    return matte


def _matte_video(source: Path, target: Path, options: dict[str, Any], call: Call) -> dict[str, Any]:
    caps = _video_caps(options)
    info = video.probe(source)
    _check_video(info)
    if not video.fits_4k(info.width, info.height):
        raise CallFailed("TOO_LARGE", "We take video up to 4K (3840 × 2160).")  # noqa: RUF001
    output = str(options.get("output") or "prores")
    encoding = MATTE_OUTPUTS.get(output, MATTE_OUTPUTS["prores"])[0]
    keyed = encoding != "h264"
    width, height = info.width, info.height
    matte = _matter(options, call, width, height, keyed=keyed)
    nvenc = not keyed and _nvenc()
    encode, notes = video.encode_args(
        target,
        encoding=encoding,
        width=width,
        height=height,
        fps=info.fps,
        source=source,
        audio=info.audio,
        max_seconds=caps.seconds,
        sar=info.sar,
        nvenc=nvenc,
    )
    with _frame_pipe(source, info, encode, caps) as pipe:
        for frame in pipe.frames():
            pipe.write(matte(frame))
        frames = pipe.finish()
    return {
        "width": width,
        "height": height,
        "frames": frames,
        "fps": round(float(info.fps), 3),
        "output": output if output in MATTE_OUTPUTS else "prores",
        "notes": _video_notes(info, pipe, notes),
    }


@app.function(image=matte_env, **_options(SPECS["remove_video_background"]))
def remove_video_background(
    input_url: str, output_url: str | None, options: dict[str, Any]
) -> dict[str, Any]:
    """V21: the video's subject on transparency (ProRes 4444, WebM) or a colour (MP4)."""
    spec = SPECS["remove_video_background"]
    call = Call(gpu=spec.gpu, idle_tail_seconds=spec.scaledown)
    work = Path(tempfile.mkdtemp(prefix="etb-"))
    try:
        output = str(options.get("output") or "prores")
        _encoding, ext, content_type = MATTE_OUTPUTS.get(output, MATTE_OUTPUTS["prores"])
        source = work / "input"
        fetch_input(input_url, source, spec.max_input_bytes)
        target = work / f"output.{ext}"
        meta = _matte_video(source, target, options, call)
        notes = meta.pop("notes")
        meta["bytes"] = put_output(output_url, target, content_type)
        return call.ok(meta, notes)
    except CallFailed as error:
        return call.failed(error)
    except Exception as error:  # noqa: BLE001 - see the module's docstring
        return _unexpected(call, error)
    finally:
        clear(work)
