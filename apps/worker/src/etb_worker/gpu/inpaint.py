"""Where Object Eraser (P17) fills, planned before the model runs. Standard library only.

MI-GAN fills an area by cropping around it and working at 512 px, so one
crop around two strokes at opposite corners of a photo would be filled at
a fraction of its resolution. Instead the marked area is split into
regions that lie apart, and each is filled on its own crop: the region plus
a margin of the photo around it for context. Regions whose crops would
overlap are merged, so no crop holds another region's hole, and each fill
sees only real pixels around it.

The GPU function marks a coarse grid of cells (any marked pixel marks its
cell); this plans the crops from those cells.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

Box = tuple[int, int, int, int]  # left, top, right, bottom (right and bottom exclusive)

#: Cells per side of the grid at most; a cell is at least this many px.
GRID_SIDE = 512
MIN_CELL = 8
#: Context around a region: its own size, at least this many px, each side.
MIN_MARGIN = 64
#: More regions than this (a speckled mask) are filled as one.
MAX_REGIONS = 64


@dataclass(frozen=True)
class Region:
    #: The marked area's bounding box, in px.
    core: Box
    #: What the model sees: the core and the photo around it, clipped to the image.
    crop: Box


def cell_size(width: int, height: int) -> int:
    """The grid's cell side in px: a grid of at most GRID_SIDE cells a side."""
    return max(MIN_CELL, math.ceil(max(width, height) / GRID_SIDE))


def dilation(width: int, height: int) -> int:
    """How far past the strokes to fill, px: object edges and halos go too."""
    return max(3, round(max(width, height) / 400))


def mask_fits(mask_width: int, mask_height: int, width: int, height: int) -> bool:
    """A mask of the photo's shape: its size, or scaled (a browser draws big masks smaller).

    Rounding a scaled side moves the ratio by up to half a pixel each way,
    so that much is allowed, and 1 % more.
    """
    if min(mask_width, mask_height, width, height) <= 0:
        return False
    skew = abs(mask_width * height - mask_height * width)
    return skew <= (width + height) / 2 + 0.01 * mask_width * height


def _components(cells: set[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    """Groups of touching cells (8-connected)."""
    left = set(cells)
    groups: list[list[tuple[int, int]]] = []
    while left:
        start = left.pop()
        group, todo = [start], [start]
        while todo:
            x, y = todo.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    near = (x + dx, y + dy)
                    if near in left:
                        left.remove(near)
                        group.append(near)
                        todo.append(near)
        groups.append(group)
    return groups


def _union(a: Box, b: Box) -> Box:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def _overlap(a: Box, b: Box) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def crop_around(core: Box, width: int, height: int) -> Box:
    """The core grown by its own size (at least MIN_MARGIN) on each side, clipped."""
    margin = max(MIN_MARGIN, core[2] - core[0], core[3] - core[1])
    return (
        max(0, core[0] - margin),
        max(0, core[1] - margin),
        min(width, core[2] + margin),
        min(height, core[3] + margin),
    )


def plan(cells: Iterable[tuple[int, int]], cell: int, width: int, height: int) -> list[Region]:
    """Regions to fill, top to bottom, from the marked cells (x, y) of a ``cell`` px grid."""
    marked = set(cells)
    if not marked:
        return []
    cores: list[Box] = []
    for group in _components(marked):
        xs = [x for x, _ in group]
        ys = [y for _, y in group]
        cores.append(
            (
                min(xs) * cell,
                min(ys) * cell,
                min(width, (max(xs) + 1) * cell),
                min(height, (max(ys) + 1) * cell),
            )
        )
    if len(cores) > MAX_REGIONS:
        whole = cores[0]
        for core in cores[1:]:
            whole = _union(whole, core)
        cores = [whole]
    merged = True
    while merged:
        merged = False
        for i in range(len(cores)):
            for j in range(i + 1, len(cores)):
                a, b = crop_around(cores[i], width, height), crop_around(cores[j], width, height)
                if _overlap(a, b):
                    cores[i] = _union(cores[i], cores[j])
                    del cores[j]
                    merged = True
                    break
            if merged:
                break
    regions = [Region(core=core, crop=crop_around(core, width, height)) for core in cores]
    return sorted(regions, key=lambda region: (region.core[1], region.core[0]))
