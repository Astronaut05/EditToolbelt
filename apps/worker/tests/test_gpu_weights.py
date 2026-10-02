"""The weights pins: every GPU image checks its files against pins.json while it builds."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import pytest

from etb_worker.gpu import weights
from etb_worker.gpu.weights import Pin, PinError, fetch, load_pins, sha256_of, verify


def pin_for(content: bytes, url: str = "https://example.test/model.pth", **extra: object) -> Pin:
    values: dict[str, object] = {
        "name": "model.pth",
        "group": "test",
        "url": url,
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
        "license": "MIT",
    }
    values.update(extra)
    return Pin(**values)  # type: ignore[arg-type]


def test_the_repository_pins_are_well_formed_and_grouped_by_function() -> None:
    pins = load_pins()
    groups = {pin.group for pin in pins.values()}
    assert groups == {"upscale", "whisper", "inpaint", "matte"}
    for pin in pins.values():
        assert pin.url.startswith("https://")
        assert len(pin.sha256) == 64
        assert pin.license in weights.LICENSES
    # OpenAI publishes Whisper under a path that is the file's own SHA-256.
    whisper = pins["large-v3.pt"]
    assert whisper.url.split("/")[-2] == whisper.sha256
    # Only approved models are pinned: no Demucs, LaMa or RobustVideoMatting until
    # their weights licences are clear (docs/13 -> Models).
    for banned in ("demucs", "lama", "rvm_", "robustvideomatting"):
        assert not any(banned in name.lower() for name in pins), banned
    # Every file a new Wave 3 function needs is pinned with its exact size.
    for name in (
        "migan_pipeline_v2.onnx",
        "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
        "realesr-animevideov3.pth",
    ):
        assert pins[name].bytes, name


def test_a_file_that_matches_its_pin_lands_in_place(tmp_path: Path) -> None:
    content = b"weights" * 1000
    source = tmp_path / "source.pth"
    source.write_bytes(content)
    pin = pin_for(content, url=source.as_uri())
    target = fetch(pin, tmp_path / "models")
    assert target == tmp_path / "models" / "model.pth"
    assert sha256_of(target) == pin.sha256
    assert sorted(p.name for p in target.parent.iterdir()) == ["model.pth"]


def test_a_changed_file_fails_and_leaves_nothing_behind(tmp_path: Path) -> None:
    pin = pin_for(b"the file we approved")
    with pytest.raises(PinError, match="SHA-256"):
        fetch(pin, tmp_path, opener=lambda _url: io.BytesIO(b"the file we approveD"))
    assert list(tmp_path.iterdir()) == []
    with pytest.raises(PinError, match="bytes"):
        fetch(pin, tmp_path, opener=lambda _url: io.BytesIO(b"short"))
    assert list(tmp_path.iterdir()) == []


def test_a_pin_without_a_size_still_checks_the_hash(tmp_path: Path) -> None:
    content = b"abc"
    path = tmp_path / "x"
    path.write_bytes(content)
    verify(path, pin_for(content, bytes=None))
    with pytest.raises(PinError):
        verify(path, pin_for(b"abd", bytes=None))


def write_pins(path: Path, files: dict[str, object]) -> Path:
    path.write_text(json.dumps({"files": files}))
    return path


GOOD = {
    "group": "g",
    "url": "https://example.test/a.pth",
    "sha256": "0" * 64,
    "bytes": None,
    "license": "Apache-2.0",
}


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"sha256": "ABC"}, "sha256"),
        ({"sha256": "0" * 63}, "sha256"),
        ({"url": "http://example.test/a.pth"}, "https"),
        ({"license": "CC-BY-NC-4.0"}, "licence"),
        ({"bytes": -1}, "bytes"),
        ({"group": ""}, "group"),
    ],
)
def test_malformed_pins_are_refused(
    tmp_path: Path, change: dict[str, object], message: str
) -> None:
    path = write_pins(tmp_path / "pins.json", {"a.pth": {**GOOD, **change}})
    with pytest.raises(PinError, match=message):
        load_pins(path)


def test_the_build_script_exits_non_zero_on_a_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    content = b"model bytes"
    pins = write_pins(
        tmp_path / "pins.json",
        {"a.pth": {**GOOD, "sha256": hashlib.sha256(content).hexdigest()}},
    )
    monkeypatch.setattr(weights, "_open", lambda _url: io.BytesIO(content))
    assert weights.main([str(pins), "g", str(tmp_path / "out")]) == 0
    assert (tmp_path / "out" / "a.pth").read_bytes() == content
    monkeypatch.setattr(weights, "_open", lambda _url: io.BytesIO(b"tampered"))
    assert weights.main([str(pins), "g", str(tmp_path / "again")]) == 1
    assert "SHA-256" in capsys.readouterr().err
    assert weights.main([str(pins), "nope", str(tmp_path / "x")]) == 1
    assert weights.main([]) == 2
