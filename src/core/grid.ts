/**
 * Map geometry (ADR-0001). Tiles are diamonds laid out in staggered rows, so the
 * map is a rectangle on screen and wraps left–right. Every distance or adjacency
 * rule must go through these helpers so the wrap is honoured everywhere.
 *
 * Storage coordinates: x = column (0..width-1), y = row (0..height-1). Odd rows sit
 * half a tile to the right. Internally we use "doubled" columns, d = 2x + (y & 1),
 * in which the 8 neighbours are the offsets below and distance is (|Δd| + |Δy|) / 2.
 */
import type { Coord, GameMap, Tile } from './types';

/** The four edges of a diamond tile, named by screen direction. */
export type Edge = 'NE' | 'SE' | 'SW' | 'NW';

export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** Neighbour offsets in doubled coordinates. NE/SE/SW/NW share an edge; N/E/S/W share a corner. */
export const DIRECTION_OFFSETS: Readonly<Record<Direction, Coord>> = {
  N: { x: 0, y: -2 },
  NE: { x: 1, y: -1 },
  E: { x: 2, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 2 },
  SW: { x: -1, y: 1 },
  W: { x: -2, y: 0 },
  NW: { x: -1, y: -1 },
};

export const DIRECTIONS = Object.keys(DIRECTION_OFFSETS) as Direction[];

export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function doubledColumn(c: Coord): number {
  return 2 * c.x + (c.y & 1);
}

/** Bring a coordinate onto the map (wrapping x if allowed), or null if it is off the map. */
export function normalize(map: GameMap, c: Coord): Coord | null {
  if (c.y < 0 || c.y >= map.height) return null;
  if (map.wrapX) return { x: ((c.x % map.width) + map.width) % map.width, y: c.y };
  if (c.x < 0 || c.x >= map.width) return null;
  return c;
}

/** The tile reached by moving a doubled-coordinate offset from c, or null if off the map. */
export function offset(map: GameMap, c: Coord, d: Coord): Coord | null {
  const y = c.y + d.y;
  if (y < 0 || y >= map.height) return null;
  let dc = doubledColumn(c) + d.x;
  const span = 2 * map.width;
  if (map.wrapX) dc = ((dc % span) + span) % span;
  else if (dc < 0 || dc >= span) return null;
  return { x: (dc - (y & 1)) / 2, y };
}

export function step(map: GameMap, c: Coord, dir: Direction): Coord | null {
  return offset(map, c, DIRECTION_OFFSETS[dir]);
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
  for (const dir of DIRECTIONS) {
    const n = step(map, c, dir);
    if (n && !coordsEqual(n, c) && !out.some((o) => coordsEqual(o, n))) out.push(n);
  }
  return out;
}

/** Shortest offset from a to b in doubled coordinates, taking the wrap into account. */
export function delta(map: GameMap, a: Coord, b: Coord): Coord {
  let dd = doubledColumn(b) - doubledColumn(a);
  if (map.wrapX) {
    const span = 2 * map.width;
    dd = ((dd % span) + span) % span;
    if (dd > map.width) dd -= span;
  }
  return { x: dd, y: b.y - a.y };
}

/** Steps between two tiles when every one of the 8 directions costs one step. */
export function distance(map: GameMap, a: Coord, b: Coord): number {
  const d = delta(map, a, b);
  return (Math.abs(d.x) + Math.abs(d.y)) / 2;
}

export function isAdjacent(map: GameMap, a: Coord, b: Coord): boolean {
  return distance(map, a, b) === 1;
}

/** The direction of an adjacent tile b from a. */
export function directionTo(map: GameMap, a: Coord, b: Coord): Direction {
  const d = delta(map, a, b);
  const dir = DIRECTIONS.find((k) => DIRECTION_OFFSETS[k].x === d.x && DIRECTION_OFFSETS[k].y === d.y);
  if (!dir) throw new Error(`(${b.x}, ${b.y}) is not adjacent to (${a.x}, ${a.y})`);
  return dir;
}

/** All on-map coordinates within `radius` of `c` (including c), each listed once. */
export function tilesWithin(map: GameMap, c: Coord, radius: number): Coord[] {
  const seen = new Set<number>();
  const out: Coord[] = [];
  for (let dy = -2 * radius; dy <= 2 * radius; dy++) {
    const reach = 2 * radius - Math.abs(dy);
    for (let dx = -reach; dx <= reach; dx++) {
      if ((dx + dy) % 2 !== 0) continue;
      const n = offset(map, c, { x: dx, y: dy });
      if (!n) continue;
      const i = tileIndex(map, n);
      if (seen.has(i)) continue;
      seen.add(i);
      out.push(n);
    }
  }
  return out;
}

/** Whether a river runs along the given edge of the tile at c. SE/SW are stored on the tile itself. */
export function hasRiver(map: GameMap, c: Coord, edge: Edge): boolean {
  switch (edge) {
    case 'SE':
      return tileAt(map, c).riverSE;
    case 'SW':
      return tileAt(map, c).riverSW;
    case 'NE': {
      const n = step(map, c, 'NE');
      return !!n && tileAt(map, n).riverSW;
    }
    case 'NW': {
      const n = step(map, c, 'NW');
      return !!n && tileAt(map, n).riverSE;
    }
  }
}

/** The defender's edges that face an attacker coming from `dir` (as seen from the defender). */
const FACING_EDGES: Readonly<Record<Direction, Edge[]>> = {
  NE: ['NE'],
  SE: ['SE'],
  SW: ['SW'],
  NW: ['NW'],
  N: ['NW', 'NE'],
  E: ['NE', 'SE'],
  S: ['SE', 'SW'],
  W: ['NW', 'SW'],
};

/**
 * Whether an attack from `from` into the adjacent tile `to` crosses a river.
 * Edge moves cross the shared edge. Corner moves cross the shared corner, which
 * counts if a river lies on either of the defender's two edges at that corner (ADR-0001).
 */
export function isRiverCrossing(map: GameMap, from: Coord, to: Coord): boolean {
  return FACING_EDGES[directionTo(map, to, from)].some((e) => hasRiver(map, to, e));
}
