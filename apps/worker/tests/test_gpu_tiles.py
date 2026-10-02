"""Tiles for the upscaler: full coverage, and no seams where tiles meet."""

from __future__ import annotations

import random

import pytest

from etb_worker.gpu.tiles import Tile, plan

Image = list[list[int]]


def blur_then_double(image: Image) -> Image:
    """A stand-in network: a 3 x 3 mean (edges clamped), then 2x nearest neighbour."""
    height, width = len(image), len(image[0])

    def at(y: int, x: int) -> int:
        return image[min(max(y, 0), height - 1)][min(max(x, 0), width - 1)]

    blurred = [
        [sum(at(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)) for x in range(width)]
        for y in range(height)
    ]
    return [[blurred[y // 2][x // 2] for x in range(width * 2)] for y in range(height * 2)]


def tiled(image: Image, tiles: list[Tile]) -> Image:
    height, width = len(image), len(image[0])
    out = [[-1] * (width * 2) for _ in range(height * 2)]
    for tile in tiles:
        left, top, right, bottom = tile.padded
        result = blur_then_double([row[left:right] for row in image[top:bottom]])
        c_left, c_top, c_right, c_bottom = tile.crop
        o_left, o_top, _o_right, _o_bottom = tile.out
        for y in range(c_top, c_bottom):
            for x in range(c_left, c_right):
                out[o_top + y - c_top][o_left + x - c_left] = result[y][x]
    return out


def test_tiles_cover_every_pixel_once() -> None:
    tiles = plan(70, 45, 16, 4, 4)
    seen: dict[tuple[int, int], int] = {}
    for tile in tiles:
        left, top, right, bottom = tile.core
        p_left, p_top, p_right, p_bottom = tile.padded
        assert 0 <= p_left <= left < right <= p_right <= 70
        assert 0 <= p_top <= top < bottom <= p_bottom <= 45
        c_left, c_top, c_right, c_bottom = tile.crop
        assert (c_right - c_left, c_bottom - c_top) == ((right - left) * 4, (bottom - top) * 4)
        assert tile.out == (left * 4, top * 4, right * 4, bottom * 4)
        for y in range(top, bottom):
            for x in range(left, right):
                seen[(x, y)] = seen.get((x, y), 0) + 1
    assert len(seen) == 70 * 45
    assert set(seen.values()) == {1}


def test_tiled_output_has_no_seams() -> None:
    rng = random.Random(7)  # noqa: S311 - test pixels
    image = [[rng.randrange(256) for _ in range(37)] for _ in range(29)]
    whole = blur_then_double(image)
    assert tiled(image, plan(37, 29, 8, 2, 2)) == whole
    # Without enough margin the tiles disagree with the whole image at their edges.
    assert tiled(image, plan(37, 29, 8, 0, 2)) != whole


def test_one_tile_when_the_image_is_small() -> None:
    assert plan(10, 10, 512, 24, 4) == [
        Tile(core=(0, 0, 10, 10), padded=(0, 0, 10, 10), crop=(0, 0, 40, 40), out=(0, 0, 40, 40))
    ]
    with pytest.raises(ValueError, match="positive"):
        plan(0, 10, 512, 24, 4)
