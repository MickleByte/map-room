/**
 * Tile ↔ world-pixel projection for diamond tiles in staggered rows (ADR-0001).
 * World pixels are unscaled; the camera applies zoom and pan on top.
 */
import { doubledColumn } from '../core/grid';
import type { Coord, GameMap } from '../core/types';

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

export interface Point {
  x: number;
  y: number;
}

/** Centre of a tile in world pixels. The map's top-left corner is at (0, 0). */
export function tileCentre(c: Coord): Point {
  return { x: (doubledColumn(c) + 1) * HALF_W, y: (c.y + 1) * HALF_H };
}

/** Width of one copy of the world; wrap copies repeat at this spacing. */
export function worldWidth(map: GameMap): number {
  return map.width * TILE_W;
}

export function worldHeight(map: GameMap): number {
  return (map.height + 1) * HALF_H;
}

/** The diamond's corners, clockwise from the top. */
export function diamond(centre: Point, inset = 0): number[] {
  const w = HALF_W - inset * 2;
  const h = HALF_H - inset;
  const { x, y } = centre;
  return [x, y - h, x + w, y, x, y + h, x - w, y];
}

/** The tile under a world-pixel point, or null if there is none. */
export function tileAtPoint(map: GameMap, p: Point): Coord | null {
  const ww = worldWidth(map);
  const px = map.wrapX ? ((p.x % ww) + ww) % ww : p.x;
  const row = Math.round(p.y / HALF_H) - 1;
  let best: Coord | null = null;
  let bestScore = Infinity;
  for (let y = row - 1; y <= row + 1; y++) {
    if (y < 0 || y >= map.height) continue;
    // Nearest doubled column with this row's parity.
    let d = Math.round(px / HALF_W) - 1;
    if ((d & 1) !== (y & 1)) d += px / HALF_W - 1 > d ? 1 : -1;
    for (const dd of [d - 2, d, d + 2]) {
      let x = (dd - (y & 1)) / 2;
      if (map.wrapX) x = ((x % map.width) + map.width) % map.width;
      else if (x < 0 || x >= map.width) continue;
      const centreX = (dd + 1) * HALF_W;
      const centreY = (y + 1) * HALF_H;
      const score = Math.abs(px - centreX) / HALF_W + Math.abs(p.y - centreY) / HALF_H;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return bestScore <= 1.0001 ? best : null;
}
