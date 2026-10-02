"""Tiles for upscaling big images on a GPU with bounded memory (tools/photo.md -> P08).

The image is cut into tiles; each tile goes through the network with a
margin of real neighbouring pixels around it, and only the tile's own part
of the result is kept. As long as the margin covers the network's reach,
every output pixel sees exactly the input it would have seen untiled, so
the tiles meet without seams. Pure Python: the GPU function does the
arithmetic on tensors with these boxes.
"""

from __future__ import annotations

from dataclasses import dataclass

Box = tuple[int, int, int, int]  # left, top, right, bottom (right and bottom exclusive)


@dataclass(frozen=True)
class Tile:
    #: The part of the input this tile is responsible for.
    core: Box
    #: What goes through the network: the core plus its margin, clipped to the image.
    padded: Box
    #: Where the core's result sits inside the padded tile's result, at the output scale.
    crop: Box
    #: Where that result goes in the output image.
    out: Box


def plan(width: int, height: int, tile: int, pad: int, scale: int) -> list[Tile]:
    """Tiles covering a ``width`` x ``height`` image, row by row."""
    if width <= 0 or height <= 0 or tile <= 0 or pad < 0 or scale <= 0:
        raise ValueError("sizes must be positive")
    tiles: list[Tile] = []
    for top in range(0, height, tile):
        for left in range(0, width, tile):
            right, bottom = min(left + tile, width), min(top + tile, height)
            p_left, p_top = max(left - pad, 0), max(top - pad, 0)
            p_right, p_bottom = min(right + pad, width), min(bottom + pad, height)
            crop = (
                (left - p_left) * scale,
                (top - p_top) * scale,
                (right - p_left) * scale,
                (bottom - p_top) * scale,
            )
            out = (left * scale, top * scale, right * scale, bottom * scale)
            tiles.append(
                Tile(
                    core=(left, top, right, bottom),
                    padded=(p_left, p_top, p_right, p_bottom),
                    crop=crop,
                    out=out,
                )
            )
    return tiles
