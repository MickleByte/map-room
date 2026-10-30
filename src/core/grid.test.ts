import { describe, expect, it } from 'vitest';
import { blankMap } from '../../tests/fixtures/mini';
import { delta, distance, isRiverCrossing, neighbours, normalize, tileAt, tilesWithin } from './grid';

describe('normalize', () => {
  it('wraps x on a wrapping map and rejects y off the map', () => {
    const map = blankMap(10, 5, true);
    expect(normalize(map, { x: -1, y: 2 })).toEqual({ x: 9, y: 2 });
    expect(normalize(map, { x: 10, y: 2 })).toEqual({ x: 0, y: 2 });
    expect(normalize(map, { x: 3, y: -1 })).toBeNull();
    expect(normalize(map, { x: 3, y: 5 })).toBeNull();
  });

  it('rejects x off the map when the map does not wrap', () => {
    const map = blankMap(10, 5, false);
    expect(normalize(map, { x: -1, y: 2 })).toBeNull();
    expect(normalize(map, { x: 10, y: 2 })).toBeNull();
  });
});

describe('distance', () => {
  it('is Chebyshev: diagonals cost the same as straight steps', () => {
    const map = blankMap(20, 20, false);
    expect(distance(map, { x: 2, y: 2 }, { x: 5, y: 4 })).toBe(3);
    expect(distance(map, { x: 2, y: 2 }, { x: 4, y: 4 })).toBe(2);
  });

  it('takes the short way round across the wrap seam', () => {
    const wrap = blankMap(10, 5, true);
    expect(distance(wrap, { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(1);
    expect(distance(wrap, { x: 1, y: 0 }, { x: 8, y: 2 })).toBe(3);
    expect(delta(wrap, { x: 0, y: 0 }, { x: 9, y: 0 })).toEqual({ x: -1, y: 0 });
    expect(delta(wrap, { x: 9, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });

    const flat = blankMap(10, 5, false);
    expect(distance(flat, { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(9);
  });
});

describe('neighbours', () => {
  it('has 8 in the interior', () => {
    expect(neighbours(blankMap(5, 5, false), { x: 2, y: 2 })).toHaveLength(8);
  });

  it('loses off-map tiles at a corner of a flat map', () => {
    expect(neighbours(blankMap(5, 5, false), { x: 0, y: 0 })).toHaveLength(3);
  });

  it('wraps east–west but not north–south', () => {
    const ns = neighbours(blankMap(5, 5, true), { x: 0, y: 0 });
    expect(ns).toHaveLength(5);
    expect(ns).toContainEqual({ x: 4, y: 0 });
    expect(ns).toContainEqual({ x: 4, y: 1 });
  });
});

describe('tilesWithin', () => {
  it('lists each tile in range once, even when the range wraps right round', () => {
    expect(tilesWithin(blankMap(10, 10, false), { x: 5, y: 5 }, 1)).toHaveLength(9);
    expect(tilesWithin(blankMap(4, 10, true), { x: 0, y: 5 }, 3)).toHaveLength(4 * 7);
  });
});

describe('isRiverCrossing', () => {
  // River on the east edge of (2,2), i.e. between (2,2) and (3,2).
  const map = blankMap(10, 10, false);
  tileAt(map, { x: 2, y: 2 }).riverEast = true;

  it('counts a straight move across the river edge, in either direction', () => {
    expect(isRiverCrossing(map, { x: 2, y: 2 }, { x: 3, y: 2 })).toBe(true);
    expect(isRiverCrossing(map, { x: 3, y: 2 }, { x: 2, y: 2 })).toBe(true);
  });

  it('ignores straight moves along the river', () => {
    expect(isRiverCrossing(map, { x: 2, y: 1 }, { x: 2, y: 2 })).toBe(false);
    expect(isRiverCrossing(map, { x: 3, y: 1 }, { x: 3, y: 2 })).toBe(false);
  });

  it("counts a diagonal attack when the river lies on the defender's edge at the shared corner", () => {
    // Defender (3,2): its west edge touches the corner shared with (2,3) and (2,1).
    expect(isRiverCrossing(map, { x: 2, y: 3 }, { x: 3, y: 2 })).toBe(true);
    expect(isRiverCrossing(map, { x: 2, y: 1 }, { x: 3, y: 2 })).toBe(true);
    // Defender (2,2): its east edge touches the corners shared with (3,1) and (3,3).
    expect(isRiverCrossing(map, { x: 3, y: 1 }, { x: 2, y: 2 })).toBe(true);
  });

  it("does not count a diagonal attack when the river only touches the attacker's edges", () => {
    // Defender (2,3) has no river on its north or east edge.
    expect(isRiverCrossing(map, { x: 3, y: 2 }, { x: 2, y: 3 })).toBe(false);
  });

  it('works across the wrap seam', () => {
    const wrap = blankMap(10, 5, true);
    tileAt(wrap, { x: 9, y: 2 }).riverEast = true;
    expect(isRiverCrossing(wrap, { x: 9, y: 2 }, { x: 0, y: 2 })).toBe(true);
    expect(isRiverCrossing(wrap, { x: 0, y: 2 }, { x: 9, y: 2 })).toBe(true);
  });

  it('rejects tiles that are not adjacent', () => {
    expect(() => isRiverCrossing(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toThrow();
  });
});
