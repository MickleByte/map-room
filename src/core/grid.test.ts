import { describe, expect, it } from 'vitest';
import { blankMap } from '../../tests/fixtures/mini';
import {
  delta,
  directionTo,
  distance,
  indexToCoord,
  isRiverCrossing,
  neighbours,
  normalize,
  step,
  tileAt,
  tileIndex,
  tilesWithin,
} from './grid';
import type { Coord, GameMap } from './types';

/** Reference distance: breadth-first search over neighbours(). */
function bfsDistance(map: GameMap, from: Coord, to: Coord): number {
  const dist = new Map([[tileIndex(map, from), 0]]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift()!;
    const d = dist.get(tileIndex(map, c))!;
    if (c.x === to.x && c.y === to.y) return d;
    for (const n of neighbours(map, c)) {
      if (!dist.has(tileIndex(map, n))) {
        dist.set(tileIndex(map, n), d + 1);
        queue.push(n);
      }
    }
  }
  return Infinity;
}

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

describe('step', () => {
  const map = blankMap(10, 10, false);

  it('moves between staggered rows from an even row', () => {
    const c = { x: 2, y: 2 };
    expect(step(map, c, 'N')).toEqual({ x: 2, y: 0 });
    expect(step(map, c, 'NE')).toEqual({ x: 2, y: 1 });
    expect(step(map, c, 'E')).toEqual({ x: 3, y: 2 });
    expect(step(map, c, 'SE')).toEqual({ x: 2, y: 3 });
    expect(step(map, c, 'S')).toEqual({ x: 2, y: 4 });
    expect(step(map, c, 'SW')).toEqual({ x: 1, y: 3 });
    expect(step(map, c, 'W')).toEqual({ x: 1, y: 2 });
    expect(step(map, c, 'NW')).toEqual({ x: 1, y: 1 });
  });

  it('moves between staggered rows from an odd row', () => {
    const c = { x: 2, y: 3 };
    expect(step(map, c, 'NE')).toEqual({ x: 3, y: 2 });
    expect(step(map, c, 'NW')).toEqual({ x: 2, y: 2 });
    expect(step(map, c, 'SE')).toEqual({ x: 3, y: 4 });
    expect(step(map, c, 'SW')).toEqual({ x: 2, y: 4 });
  });

  it('is undone by the opposite direction', () => {
    const c = { x: 4, y: 5 };
    expect(directionTo(map, c, step(map, c, 'SW')!)).toBe('SW');
    expect(step(map, step(map, c, 'SW')!, 'NE')).toEqual(c);
  });
});

describe('distance', () => {
  it('counts every one of the 8 directions as one step', () => {
    const map = blankMap(20, 20, false);
    expect(distance(map, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
    expect(distance(map, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(distance(map, { x: 0, y: 0 }, { x: 0, y: 2 })).toBe(1);
    expect(distance(map, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    expect(distance(map, { x: 2, y: 2 }, { x: 5, y: 6 })).toBe(5);
  });

  it('takes the short way round across the wrap seam', () => {
    const wrap = blankMap(10, 6, true);
    expect(distance(wrap, { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(1);
    expect(distance(wrap, { x: 0, y: 1 }, { x: 9, y: 0 })).toBe(2);
    expect(delta(wrap, { x: 0, y: 0 }, { x: 9, y: 0 })).toEqual({ x: -2, y: 0 });
    expect(delta(wrap, { x: 9, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 2, y: 0 });

    const flat = blankMap(10, 6, false);
    expect(distance(flat, { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(9);
  });

  it.each([
    ['flat', false],
    ['wrapping', true],
  ])('matches breadth-first search on a %s map', (_, wrapX) => {
    const map = blankMap(7, 9, wrapX);
    for (let i = 0; i < map.tiles.length; i += 5) {
      for (let j = 0; j < map.tiles.length; j += 3) {
        const a = indexToCoord(map, i);
        const b = indexToCoord(map, j);
        expect(distance(map, a, b), `(${a.x},${a.y}) → (${b.x},${b.y})`).toBe(bfsDistance(map, a, b));
      }
    }
  });
});

describe('neighbours', () => {
  it('has 8 in the interior', () => {
    expect(neighbours(blankMap(6, 6, false), { x: 2, y: 2 })).toHaveLength(8);
  });

  it('loses off-map tiles at a corner of a flat map', () => {
    expect(neighbours(blankMap(6, 6, false), { x: 0, y: 0 })).toHaveLength(3);
  });

  it('wraps left–right but not top–bottom', () => {
    const ns = neighbours(blankMap(6, 6, true), { x: 0, y: 0 });
    expect(ns).toHaveLength(5);
    expect(ns).toContainEqual({ x: 5, y: 0 });
    expect(ns).toContainEqual({ x: 5, y: 1 });
  });
});

describe('tilesWithin', () => {
  it('covers a 5×5 lattice block at radius 2', () => {
    expect(tilesWithin(blankMap(20, 20, false), { x: 8, y: 8 }, 1)).toHaveLength(9);
    expect(tilesWithin(blankMap(20, 20, false), { x: 8, y: 8 }, 2)).toHaveLength(25);
  });

  it.each([
    ['flat', false],
    ['wrapping', true],
  ])('lists exactly the tiles within range, once each, on a narrow %s map', (_, wrapX) => {
    const map = blankMap(3, 20, wrapX);
    const centre = { x: 1, y: 9 };
    const got = tilesWithin(map, centre, 3).map((c) => tileIndex(map, c));
    const want = map.tiles.map((_, i) => i).filter((i) => distance(map, centre, indexToCoord(map, i)) <= 3);
    expect(new Set(got).size).toBe(got.length);
    expect(got.sort((a, b) => a - b)).toEqual(want);
  });
});

describe('isRiverCrossing', () => {
  // River on the SE edge of (3,4), between (3,4) and its SE neighbour (3,5).
  const map = blankMap(10, 10, false);
  tileAt(map, { x: 3, y: 4 }).riverSE = true;

  it('counts an edge move across the river, in either direction', () => {
    expect(isRiverCrossing(map, { x: 3, y: 4 }, { x: 3, y: 5 })).toBe(true);
    expect(isRiverCrossing(map, { x: 3, y: 5 }, { x: 3, y: 4 })).toBe(true);
  });

  it('ignores edge moves that do not cross it', () => {
    expect(isRiverCrossing(map, { x: 3, y: 4 }, { x: 3, y: 3 })).toBe(false);
  });

  it("counts a corner move when the river lies on the defender's edge at that corner", () => {
    // Attacking (3,4) from its east: its SE edge touches the east corner.
    expect(isRiverCrossing(map, { x: 4, y: 4 }, { x: 3, y: 4 })).toBe(true);
    // Attacking (3,5) from its north: its NW edge touches the north corner.
    expect(isRiverCrossing(map, { x: 3, y: 3 }, { x: 3, y: 5 })).toBe(true);
  });

  it("does not count a corner move when the river only lies on the attacker's edges", () => {
    // Attacking (4,4) from its west: the river is on (3,4)'s edge, not (4,4)'s.
    expect(isRiverCrossing(map, { x: 3, y: 4 }, { x: 4, y: 4 })).toBe(false);
  });

  it('works across the wrap seam', () => {
    const wrap = blankMap(10, 6, true);
    tileAt(wrap, { x: 9, y: 3 }).riverSE = true;
    expect(step(wrap, { x: 9, y: 3 }, 'SE')).toEqual({ x: 0, y: 4 });
    expect(isRiverCrossing(wrap, { x: 9, y: 3 }, { x: 0, y: 4 })).toBe(true);
    expect(isRiverCrossing(wrap, { x: 0, y: 4 }, { x: 9, y: 3 })).toBe(true);
  });

  it('rejects tiles that are not adjacent', () => {
    expect(() => isRiverCrossing(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toThrow();
  });
});
