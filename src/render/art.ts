/** Placeholder art, drawn in code. Colours and shapes only; no external assets. */
import { Container, GraphicsContext, Graphics, Text } from 'pixi.js';
import { DIRECTION_OFFSETS, DIRECTIONS, step, tileAt } from '../core/grid';
import type { City, Coord, GameState } from '../core/types';
import { diamond, HALF_H, HALF_W, tileCentre, type Point } from './iso';

export const TERRAIN_COLOURS: Record<string, number> = {
  grassland: 0x6aa84f,
  plains: 0xb3a857,
  desert: 0xddc68a,
  tundra: 0xaab5a8,
  forest: 0x3f7a3a,
  jungle: 0x2c6640,
  marsh: 0x5f8572,
  hills: 0x9a9258,
  mountains: 0x8d847b,
  coast: 0x4a8fc0,
  ocean: 0x245a8e,
};

const RIVER = 0x3a8ee0;
const ROAD = 0x8b6a3e;
const RAIL = 0x2a2a2a;

/** A small, stable per-tile variation so large areas of one terrain don't look flat. */
function jitter(colour: number, c: Coord): number {
  const h = ((c.x * 73856093) ^ (c.y * 19349663)) >>> 0;
  const f = 1 + (((h % 1000) / 1000) * 0.1 - 0.05);
  const r = Math.min(255, ((colour >> 16) & 0xff) * f);
  const g = Math.min(255, ((colour >> 8) & 0xff) * f);
  const b = Math.min(255, (colour & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Terrain, rivers, roads, rails and fortresses for one copy of the world. */
export function drawMap(state: GameState): GraphicsContext {
  const { map } = state;
  const ctx = new GraphicsContext();

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const c = { x, y };
      const tile = tileAt(map, c);
      const p = tileCentre(c);
      ctx.poly(diamond(p)).fill(jitter(TERRAIN_COLOURS[tile.terrain] ?? 0xff00ff, c));
      ctx.poly(diamond(p)).stroke({ width: 1, color: 0x000000, alpha: 0.1 });
      drawTerrainDetail(ctx, tile.terrain, p, c);
    }
  }

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const c = { x, y };
      const tile = tileAt(map, c);
      const [, e, s, w] = pairs(diamond(tileCentre(c))) as [Point, Point, Point, Point];
      if (tile.riverSE) ctx.moveTo(e.x, e.y).lineTo(s.x, s.y);
      if (tile.riverSW) ctx.moveTo(s.x, s.y).lineTo(w.x, w.y);
    }
  }
  ctx.stroke({ width: 3.5, color: RIVER, cap: 'round' });

  drawLinks(ctx, state, (c) => tileAt(map, c).road, { width: 2.5, color: ROAD });
  drawLinks(ctx, state, (c) => tileAt(map, c).rail, { width: 2, color: RAIL });

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!tileAt(map, { x, y }).fortress) continue;
      const p = tileCentre({ x, y });
      ctx.roundRect(p.x - 9, p.y - 6, 18, 12, 2).fill({ color: 0x6b5a45, alpha: 0.55 });
      ctx.roundRect(p.x - 9, p.y - 6, 18, 12, 2).stroke({ width: 2, color: 0x3b3025 });
    }
  }
  return ctx;
}

function pairs(points: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 2) out.push({ x: points[i]!, y: points[i + 1]! });
  return out;
}

/** Lines from each tile's centre halfway toward every neighbour that also has the feature. */
function drawLinks(
  ctx: GraphicsContext,
  state: GameState,
  has: (c: Coord) => boolean,
  style: { width: number; color: number },
): void {
  const { map } = state;
  const isolated: Point[] = [];
  let any = false;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const c = { x, y };
      if (!has(c)) continue;
      const p = tileCentre(c);
      let linked = false;
      for (const dir of DIRECTIONS) {
        const n = step(map, c, dir);
        if (!n || !has(n)) continue;
        const o = DIRECTION_OFFSETS[dir];
        ctx.moveTo(p.x, p.y).lineTo(p.x + (o.x * HALF_W) / 2, p.y + (o.y * HALF_H) / 2);
        linked = true;
        any = true;
      }
      if (!linked) isolated.push(p);
    }
  }
  // Stroke the path before filling anything else, or the fill would consume it.
  if (any) ctx.stroke({ ...style, cap: 'round' });
  for (const p of isolated) ctx.circle(p.x, p.y, style.width).fill(style.color);
}

function drawTerrainDetail(ctx: GraphicsContext, terrain: string, p: Point, c: Coord): void {
  const { x, y } = p;
  const seed = (c.x * 7 + c.y * 13) % 5;
  switch (terrain) {
    case 'hills':
      ctx
        .moveTo(x - 16, y + 5)
        .quadraticCurveTo(x - 8, y - 9, x, y + 5)
        .moveTo(x - 2, y + 3)
        .quadraticCurveTo(x + 7, y - 7, x + 15, y + 4)
        .stroke({ width: 2, color: 0x6e6838 });
      break;
    case 'mountains':
      ctx.poly([x - 16, y + 7, x - 4, y - 11, x + 8, y + 7]).fill(0x6f655d);
      ctx.poly([x - 8, y - 5, x - 4, y - 11, x, y - 5]).fill(0xeeeeee);
      ctx.poly([x - 1, y + 7, x + 8, y - 5, x + 17, y + 7]).fill(0x7c736a);
      break;
    case 'forest':
    case 'jungle': {
      const colour = terrain === 'forest' ? 0x24552a : 0x1b4a2c;
      for (const [dx, dy] of [
        [-10, 1],
        [0, -4],
        [9, 2],
      ] as const) {
        if (terrain === 'forest')
          ctx.poly([x + dx - 5, y + dy + 5, x + dx, y + dy - 7, x + dx + 5, y + dy + 5]).fill(colour);
        else ctx.circle(x + dx, y + dy, 4.5).fill(colour);
      }
      break;
    }
    case 'marsh':
      for (const [dx, dy] of [
        [-10, -2],
        [2, 3],
        [8, -4],
      ] as const)
        ctx.moveTo(x + dx - 4, y + dy).lineTo(x + dx + 4, y + dy);
      ctx.stroke({ width: 1.5, color: 0x3d6f8a });
      break;
    case 'desert':
      for (let i = 0; i < 3; i++)
        ctx.circle(x - 10 + i * 9 + seed, y - 3 + ((i * 5 + seed) % 7), 1.2).fill(0xb79b5c);
      break;
    case 'tundra':
      for (let i = 0; i < 3; i++)
        ctx.circle(x - 9 + i * 8 + seed, y - 2 + ((i * 3 + seed) % 6), 1.6).fill(0xf2f4f2);
      break;
    case 'ocean':
      if (seed === 0)
        ctx
          .moveTo(x - 6, y)
          .quadraticCurveTo(x - 3, y - 3, x, y)
          .stroke({ width: 1, color: 0x3c75a8 });
      break;
  }
}

/** City markers and labels for one copy of the world. */
export function drawCities(state: GameState): Container {
  const layer = new Container();
  for (const city of Object.values(state.cities)) layer.addChild(cityMarker(state, city));
  return layer;
}

function cityMarker(state: GameState, city: City): Container {
  const owner = state.players.find((p) => p.id === city.owner);
  const colour = owner ? parseInt(owner.colour.slice(1), 16) : 0x888888;
  const p = tileCentre(city.pos);
  const marker = new Container();

  const g = new Graphics();
  if (city.walls) g.roundRect(p.x - 17, p.y - 13, 34, 22, 5).stroke({ width: 3, color: 0xe2dac2 });
  g.roundRect(p.x - 14, p.y - 10, 28, 16, 4)
    .fill(colour)
    .stroke({ width: 1.5, color: 0x111111 });
  marker.addChild(g);

  const size = new Text({
    text: String(city.size),
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xffffff },
    resolution: 3,
  });
  size.anchor.set(0.5);
  size.position.set(p.x, p.y - 2);
  marker.addChild(size);

  const name = new Text({
    text: city.name,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 11,
      fontWeight: '600',
      fill: 0xffffff,
      stroke: { color: 0x101418, width: 3 },
    },
    resolution: 3,
  });
  name.anchor.set(0.5, 0);
  name.position.set(p.x, p.y + 9);
  marker.addChild(name);
  return marker;
}

/** The selected-tile highlight. */
export function drawSelection(ctx: GraphicsContext, c: Coord | null): void {
  ctx.clear();
  if (!c) return;
  const p = tileCentre(c);
  ctx.poly(diamond(p)).fill({ color: 0xffe08a, alpha: 0.18 });
  ctx.poly(diamond(p, 1)).stroke({ width: 2, color: 0xffe08a });
}
