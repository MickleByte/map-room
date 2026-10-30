/**
 * Square-grid geometry (ADR-0001). Every distance or adjacency rule must go through
 * these helpers so east–west wrap is honoured everywhere.
 */
import type { Coord, GameMap, Tile } from './types';

export type Side = 'N' | 'E' | 'S' | 'W';

/** The 8 neighbour offsets, clockwise from north. */
export const DIRECTIONS: readonly Coord[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Bring a coordinate onto the map (wrapping x if allowed), or null if it is off the map. */
export function normalize(map: GameMap, c: Coord): Coord | null {
  if (c.y < 0 || c.y >= map.height) return null;
  if (map.wrapX) return { x: ((c.x % map.width) + map.width) % map.width, y: c.y };
  if (c.x < 0 || c.x >= map.width) return null;
  return c;
}

export function tileIndex(map: GameMap, c: Coord): number {
  return c.y * map.width + c.x;
}

export function indexToCoord(map: GameMap, i: number): Coord {
  return { x: i % map.width, y: Math.floor(i / map.width) };
}

export function inBounds(map: GameMap, c: Coord): boolean {
  return c.y >= 0 && c.y < map.height && c.x >= 0 && c.x < map.width;
}

/** The tile at an on-map coordinate. Wrapped coordinates are normalised first. */
export function tileAt(map: GameMap, c: Coord): Tile {
  const n = normalize(map, c);
  const tile = n && map.tiles[tileIndex(map, n)];
  if (!tile) throw new Error(`No tile at (${c.x}, ${c.y})`);
  return tile;
}

export function neighbours(map: GameMap, c: Coord): Coord[] {
  const out: Coord[] = [];
  for (const d of DIRECTIONS) {
    const n = normalize(map, { x: c.x + d.x, y: c.y + d.y });
    if (n && !coordsEqual(n, c)) out.push(n);
  }
  return out;
}

/** Shortest signed offset from a to b, taking the wrap into account. */
export function delta(map: GameMap, a: Coord, b: Coord): Coord {
  let dx = b.x - a.x;
  if (map.wrapX) {
    const w = map.width;
    dx = ((dx % w) + w) % w;
    if (dx > w / 2) dx -= w;
  }
  return { x: dx, y: b.y - a.y };
}

/** Chebyshev distance: diagonal steps cost the same as straight ones. */
export function distance(map: GameMap, a: Coord, b: Coord): number {
  const d = delta(map, a, b);
  return Math.max(Math.abs(d.x), Math.abs(d.y));
}

export function isAdjacent(map: GameMap, a: Coord, b: Coord): boolean {
  return distance(map, a, b) === 1;
}

/** All on-map coordinates within `radius` of `c` (including c), each listed once. */
export function tilesWithin(map: GameMap, c: Coord, radius: number): Coord[] {
  const seen = new Set<number>();
  const out: Coord[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const n = normalize(map, { x: c.x + dx, y: c.y + dy });
      if (!n) continue;
      const i = tileIndex(map, n);
      if (seen.has(i)) continue;
      seen.add(i);
      out.push(n);
    }
  }
  return out;
}

/** Whether a river runs along the given side of the tile at c. */
export function hasRiver(map: GameMap, c: Coord, side: Side): boolean {
  switch (side) {
    case 'E':
      return tileAt(map, c).riverEast;
    case 'S':
      return tileAt(map, c).riverSouth;
    case 'W': {
      const w = normalize(map, { x: c.x - 1, y: c.y });
      return !!w && tileAt(map, w).riverEast;
    }
    case 'N': {
      const n = normalize(map, { x: c.x, y: c.y - 1 });
      return !!n && tileAt(map, n).riverSouth;
    }
  }
}

/**
 * Whether an attack from `from` into the adjacent tile `to` crosses a river.
 * Straight moves cross the shared edge. Diagonal moves cross the shared corner,
 * which counts if a river lies on either of the defender's two edges touching that
 * corner (ADR-0001).
 */
export function isRiverCrossing(map: GameMap, from: Coord, to: Coord): boolean {
  const d = delta(map, from, to);
  if (Math.max(Math.abs(d.x), Math.abs(d.y)) !== 1) throw new Error('isRiverCrossing needs adjacent tiles');
  // The defender's edge facing back toward the attacker along each axis.
  const xSide: Side | null = d.x === 1 ? 'W' : d.x === -1 ? 'E' : null;
  const ySide: Side | null = d.y === 1 ? 'N' : d.y === -1 ? 'S' : null;
  return (!!xSide && hasRiver(map, to, xSide)) || (!!ySide && hasRiver(map, to, ySide));
}
