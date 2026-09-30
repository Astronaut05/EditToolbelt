import { describe, expect, it } from 'vitest';

import { centreBox, dragHandle, fitBox, moveBox, NO_EDIT, setBoxSize, turnEdit } from './crop';

const photo = { width: 4000, height: 3000 };

describe('crop box', () => {
  it('starts as the whole image, or the largest box of a ratio', () => {
    expect(fitBox(photo, null)).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(fitBox(photo, 1)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });

  it('keeps near the current box when the ratio changes', () => {
    const box = fitBox(photo, 16 / 9, { x: 0, y: 0, width: 1000, height: 1000 });
    expect(box).toEqual({ x: 0, y: 0, width: 4000, height: 2250 });
    const square = fitBox(photo, 1, { x: 3000, y: 0, width: 1000, height: 3000 });
    expect(square.x).toBe(1000);
  });

  it('moves inside the image', () => {
    const box = { x: 100, y: 100, width: 1000, height: 1000 };
    expect(moveBox(box, -500, 5000, photo)).toEqual({ x: 0, y: 2000, width: 1000, height: 1000 });
    expect(centreBox(box, photo)).toEqual({ x: 1500, y: 1000, width: 1000, height: 1000 });
  });

  it('drags free handles, keeping the opposite side', () => {
    const box = { x: 1000, y: 1000, width: 1000, height: 1000 };
    expect(dragHandle(box, 'se', 200, -300, photo, null)).toEqual({
      x: 1000,
      y: 1000,
      width: 1200,
      height: 700,
    });
    expect(dragHandle(box, 'w', -5000, 0, photo, null)).toEqual({
      x: 0,
      y: 1000,
      width: 2000,
      height: 1000,
    });
    // Can't turn inside out.
    expect(dragHandle(box, 'n', 0, 5000, photo, null, 10).height).toBe(10);
  });

  it('keeps a locked ratio from corners and edges, inside the image', () => {
    const box = { x: 1000, y: 1000, width: 800, height: 1000 };
    const corner = dragHandle(box, 'se', 400, 0, photo, 0.8);
    expect(corner).toEqual({ x: 1000, y: 1000, width: 1200, height: 1500 });
    const capped = dragHandle(box, 'se', 9000, 9000, photo, 0.8);
    expect(capped).toEqual({ x: 1000, y: 1000, width: 1600, height: 2000 });
    const edge = dragHandle(box, 'e', 200, 0, photo, 0.8);
    expect(edge).toEqual({ x: 1000, y: 875, width: 1000, height: 1250 });
    const up = dragHandle(box, 'nw', -100, -100, photo, 0.8);
    expect(up.x + up.width).toBe(1800);
    expect(up.y + up.height).toBe(2000);
  });

  it('takes typed sizes, following a locked ratio and shrinking to fit', () => {
    const box = { x: 3000, y: 2000, width: 500, height: 500 };
    expect(setBoxSize(box, 'width', 1080, photo, null)).toEqual({
      x: 2920,
      y: 2000,
      width: 1080,
      height: 500,
    });
    expect(setBoxSize(box, 'width', 1080, photo, 1080 / 1350)).toEqual({
      x: 2920,
      y: 1650,
      width: 1080,
      height: 1350,
    });
    expect(setBoxSize(box, 'height', 6000, photo, 1)).toEqual({
      x: 1000,
      y: 0,
      width: 3000,
      height: 3000,
    });
    expect(setBoxSize(box, 'width', 0, photo, null)).toBe(box);
  });

  it('turns the box with the image', () => {
    const edit = { ...NO_EDIT, crop: { x: 0, y: 0, width: 1000, height: 500 } };
    const turned = turnEdit(edit, photo, null);
    expect(turned.turns).toBe(1);
    expect(turned.crop).toEqual({ x: 2500, y: 0, width: 500, height: 1000 });
    const locked = turnEdit(edit, photo, 2);
    expect(locked.crop).toMatchObject({ width: 3000, height: 1500 });
  });
});
