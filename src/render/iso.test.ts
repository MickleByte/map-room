import { describe, expect, it } from 'vitest';
import { blankMap } from '../../tests/fixtures/mini';
import { HALF_H, HALF_W, tileAtPoint, tileCentre, tileCentreFrom, worldWidth } from './iso';

describe('iso projection', () => {
  const map = blankMap(10, 12, false);

  it('round-trips every tile centre', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(tileAtPoint(map, tileCentre({ x, y }))).toEqual({ x, y });
      }
    }
  });

  it('picks the right tile just inside each corner of a diamond', () => {
    const c = { x: 4, y: 5 };
    const { x, y } = tileCentre(c);
    const e = 0.9;
    expect(tileAtPoint(map, { x, y: y - HALF_H * e })).toEqual(c);
    expect(tileAtPoint(map, { x: x + HALF_W * e, y })).toEqual(c);
    expect(tileAtPoint(map, { x, y: y + HALF_H * e })).toEqual(c);
    expect(tileAtPoint(map, { x: x - HALF_W * e, y })).toEqual(c);
  });

  it('wraps points beyond the right edge onto the left on a wrapping map', () => {
    const wrap = blankMap(10, 12, true);
    const p = tileCentre({ x: 1, y: 4 });
    expect(tileAtPoint(wrap, { x: p.x + worldWidth(wrap), y: p.y })).toEqual({ x: 1, y: 4 });
    expect(tileAtPoint(wrap, { x: p.x - worldWidth(wrap), y: p.y })).toEqual({ x: 1, y: 4 });
  });

  it('returns null off a flat map', () => {
    expect(tileAtPoint(map, { x: -50, y: 40 })).toBeNull();
    expect(tileAtPoint(map, { x: 40, y: -50 })).toBeNull();
  });
});

describe('one tile as seen from another', () => {
  const wrapping = blankMap(10, 12, true);
  const flat = blankMap(10, 12, false);

  it('is just where the tile is when the short way does not cross the seam', () => {
    expect(tileCentreFrom(wrapping, { x: 2, y: 3 }, { x: 4, y: 5 })).toEqual(tileCentre({ x: 4, y: 5 }));
    expect(tileCentreFrom(flat, { x: 0, y: 4 }, { x: 9, y: 4 })).toEqual(tileCentre({ x: 9, y: 4 }));
  });

  it('lies beyond the edge, one world width over, when the short way crosses the seam', () => {
    const east = { x: 9, y: 4 };
    const west = { x: 0, y: 4 };
    expect(tileCentreFrom(wrapping, east, west)).toEqual({
      x: tileCentre(west).x + worldWidth(wrapping),
      y: tileCentre(west).y,
    });
    expect(tileCentreFrom(wrapping, west, east)).toEqual({
      x: tileCentre(east).x - worldWidth(wrapping),
      y: tileCentre(east).y,
    });
  });
});
