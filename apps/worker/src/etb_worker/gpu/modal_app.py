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

The weights are downloaded while Modal builds each image and checked
against the SHA-256 in pins.json (weights.py); a mismatch fails the build.
Every function asks for the same CPU and memory, which config/business.ts
prices together with the GPU.

A function never lets an exception out: Modal would log its traceback, and
urllib's errors can quote the presigned URL. Anything unexpected comes back
as ``GPU_FAILED`` with a fixed sentence and only the exception's type.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import modal

from etb_worker.gpu import APP_NAME
from etb_worker.gpu.remote import Call, CallFailed, clear, fetch_input, put_output

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
}

app = modal.App(APP_NAME)

image = modal.Image.debian_slim(python_version="3.12")

# The last PyTorch whose PyPI wheels use CUDA 12.8 (docs/13 -> GPU images).
_TORCH = ("torch==2.10.0", "torchvision==0.25.0", "numpy==2.3.5")


def _with_weights(base: modal.Image, group: str) -> modal.Image:
    """Downloads and checks the group's pinned weights into /models at build time."""
    return (
        base.add_local_file(HERE / "weights.py", "/opt/etb/weights.py", copy=True)
        .add_local_file(HERE / "pins.json", "/opt/etb/pins.json", copy=True)
        .run_commands(f"python /opt/etb/weights.py /opt/etb/pins.json {group} {WEIGHTS}")
    )


# Modal adds this module's package (etb_worker) to every container by itself.
upscale_env = _with_weights(
    image.pip_install(*_TORCH, "spandrel==0.4.2", "pillow==12.3.0"), "upscale"
)
whisper_env = _with_weights(
    image.apt_install("ffmpeg").pip_install(*_TORCH, "openai-whisper==20250625", "numba==0.68.0"),
    "whisper",
)

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


def _upscaler(model: str, denoise: float, call: Call) -> Any:
    """The network for ``model``; General blends two weights by ``denoise`` (Real-ESRGAN's DNI)."""
    import torch  # noqa: PLC0415 - only inside the GPU image
    from spandrel import ImageModelDescriptor, ModelLoader  # noqa: PLC0415

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

    if model == "anime":
        weights = state("RealESRGAN_x4plus_anime_6B.pth")
    else:
        weights = state("realesr-general-x4v3.pth")
        if denoise < 1:
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


def _upscale(source: Path, target: Path, options: dict[str, Any], call: Call) -> dict[str, Any]:
    import numpy as np  # noqa: PLC0415
    from PIL import Image, ImageOps  # noqa: PLC0415

    Image.MAX_IMAGE_PIXELS = 100_000_000  # decompression bombs (docs/11)
    scale = 2 if int(options.get("scale", 4)) == 2 else 4
    fmt = str(options.get("format", "png"))
    notes: list[str] = []
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
            rgb = np.asarray(picture.convert("RGB"))
    except (OSError, Image.DecompressionBombError, ValueError):
        raise CallFailed(
            "DECODE_FAILED", "The image couldn't be decoded; it may be damaged."
        ) from None
    height, width = rgb.shape[:2]
    if width * height * scale * scale > MAX_OUTPUT_PIXELS:
        too_big = "The result would be over 64 MP. Pick 2×, or a smaller image."  # noqa: RUF001
        raise CallFailed("TOO_LARGE", too_big)
    denoise = float(options.get("denoise", 0.5))
    network = _upscaler(str(options.get("model", "general")), denoise, call)
    result = Image.fromarray(_run_tiles(network, rgb))
    size = (width * scale, height * scale)
    if result.size != size:
        result = result.resize(size, Image.Resampling.LANCZOS)
    if alpha is not None:
        if fmt == "jpg":
            notes.append("JPG has no transparency, so it sits on white")
            backdrop = Image.new("RGB", size, (255, 255, 255))
            backdrop.paste(result, mask=alpha.resize(size, Image.Resampling.LANCZOS))
            result = backdrop
        else:
            result.putalpha(alpha.resize(size, Image.Resampling.LANCZOS))
    extra = {"icc_profile": icc} if icc else {}
    if fmt == "jpg":
        result.convert("RGB").save(target, "JPEG", quality=92, subsampling=0, **extra)
    elif fmt == "webp":
        result.save(target, "WEBP", quality=92, method=4, **extra)
    else:
        result.save(target, "PNG", compress_level=6, **extra)
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


@app.function(image=whisper_env, **_options(SPECS["transcribe"]))
def transcribe(input_url: str, output_url: str | None, options: dict[str, Any]) -> dict[str, Any]:
    """A12 and V17: Whisper large-v3's transcript of the audio, as JSON, to ``output_url``."""
    spec = SPECS["transcribe"]
    call = Call(gpu=spec.gpu, idle_tail_seconds=spec.scaledown)
    work = Path(tempfile.mkdtemp(prefix="etb-"))
    try:
        source = work / "input"
        fetch_input(input_url, source, spec.max_input_bytes)
        language = str(options.get("language") or "auto")
        task = "translate" if options.get("task") == "translate" else "transcribe"
        model = _whisper(call)
        try:
            result = model.transcribe(
                str(source),
                language=None if language == "auto" else language,
                task=task,
                word_timestamps=True,
                verbose=None,  # never print the words
                condition_on_previous_text=False,
                hallucination_silence_threshold=2.0,
                fp16=True,
            )
        except RuntimeError:
            raise CallFailed(
                "DECODE_FAILED", "The audio couldn't be decoded; it may be damaged."
            ) from None
        document = _transcript(result)
        target = work / "transcript.json"
        target.write_text(json.dumps(document, ensure_ascii=False), "utf-8")
        size = put_output(output_url, target, "application/json")
        return call.ok(
            {"language": document["language"], "segments": len(document["segments"]), "bytes": size}
        )
    except CallFailed as error:
        return call.failed(error)
    except Exception as error:  # noqa: BLE001 - see the module's docstring
        return _unexpected(call, error)
    finally:
        clear(work)
