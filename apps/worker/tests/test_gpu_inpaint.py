"""Object Eraser's fill plan (gpu/inpaint.py): regions apart are filled apart, at full detail."""

from __future__ import annotations

from etb_worker.gpu import inpaint
from etb_worker.gpu.inpaint import Region, plan


def test_the_grid_scales_with_the_picture() -> None:
    assert inpaint.cell_size(640, 480) == inpaint.MIN_CELL
    assert inpaint.cell_size(8000, 6000) == 16
    assert inpaint.dilation(1000, 800) == 3
    assert inpaint.dilation(8000, 6000) == 20


def test_nothing_marked_plans_nothing() -> None:
    assert plan([], 8, 100, 100) == []


def test_one_stroke_is_one_region_with_context_around_it() -> None:
    # Cells (10..12, 20) of an 8 px grid: px 80..104 x 160..168.
    regions = plan([(10, 20), (11, 20), (12, 20)], 8, 1000, 1000)
    assert regions == [Region(core=(80, 160, 104, 168), crop=(16, 96, 168, 232))]


def test_strokes_far_apart_are_filled_apart() -> None:
    regions = plan([(1, 1), (100, 100)], 8, 1000, 1000)
    assert [region.core for region in regions] == [(8, 8, 16, 16), (800, 800, 808, 808)]
    for region in regions:
        left, _, right, _ = region.crop
        assert right - left <= 2 * inpaint.MIN_MARGIN + 8


def test_touching_and_nearby_strokes_merge_so_no_crop_holds_another_hole() -> None:
    # Diagonal neighbours touch (8-connected); a stroke 5 cells away is inside the margin.
    regions = plan([(10, 10), (11, 11), (16, 11)], 8, 1000, 1000)
    assert len(regions) == 1
    assert regions[0].core == (80, 80, 136, 96)
    crops = [r.crop for r in plan([(1, 1), (40, 1), (80, 1)], 8, 1000, 1000)]
    for i, a in enumerate(crops):
        for b in crops[i + 1 :]:
            assert not (a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3])


def test_crops_stay_inside_the_picture_and_cores_on_its_pixels() -> None:
    [region] = plan([(0, 0), (12, 9)], 8, 100, 75)
    assert region.core == (0, 0, 100, 75)
    assert region.crop == (0, 0, 100, 75)


def test_a_speckled_mask_is_filled_as_one() -> None:
    cells = [(x * 40, 0) for x in range(inpaint.MAX_REGIONS + 1)]
    [region] = plan(cells, 8, 30_000, 100)
    assert region.core == (0, 0, inpaint.MAX_REGIONS * 40 * 8 + 8, 8)


def test_a_mask_may_be_the_photo_scaled_but_not_another_shape() -> None:
    assert inpaint.mask_fits(4000, 3000, 4000, 3000)
    # A browser draws a 50 MP mask at 16 MP: 4619 x 3464 for 8000 x 6000.
    assert inpaint.mask_fits(4619, 3464, 8000, 6000)
    assert inpaint.mask_fits(1001, 750, 4000, 3000)
    assert not inpaint.mask_fits(3000, 4000, 4000, 3000)  # turned the other way
    assert not inpaint.mask_fits(4000, 2250, 4000, 3000)
    assert not inpaint.mask_fits(0, 10, 4000, 3000)
