/** Planning overlays: the path preview for the selected unit. */
import type { GraphicsContext } from 'pixi.js';
import type { PathStep } from '../core/movement';
import type { Coord } from '../core/types';
import { diamond, TILE_W, tileCentre } from './iso';

const TURN_COLOURS = [0xffffff, 0xffd166, 0xf4a259, 0xe76f51];

/** Draw a route as dots, coloured by turn, with a ring where each turn's movement ends. */
export function drawPath(
  ctx: GraphicsContext,
  from: Coord,
  path: PathStep[] | null,
  target: Coord | null,
): void {
  ctx.clear();
  if (!target) return;
  if (!path) {
    const p = tileCentre(target);
    ctx
      .moveTo(p.x - 6, p.y - 6)
      .lineTo(p.x + 6, p.y + 6)
      .moveTo(p.x + 6, p.y - 6)
      .lineTo(p.x - 6, p.y + 6);
    ctx.stroke({ width: 3, color: 0xe0533f });
    return;
  }
  let prev = tileCentre(from);
  for (const step of path) {
    const p = tileCentre(step.pos);
    // A step across the wrap seam jumps the whole map width; skip its connecting line.
    if (Math.abs(p.x - prev.x) <= TILE_W) {
      ctx.moveTo(prev.x, prev.y).lineTo(p.x, p.y).stroke({ width: 2, color: 0x000000, alpha: 0.35 });
    }
    prev = p;
  }
  path.forEach((step, i) => {
    const p = tileCentre(step.pos);
    const colour = TURN_COLOURS[Math.min(step.turn, TURN_COLOURS.length - 1)]!;
    const endsTurn = i === path.length - 1 || path[i + 1]!.turn !== step.turn;
    ctx
      .circle(p.x, p.y, endsTurn ? 5 : 3)
      .fill(colour)
      .stroke({ width: 1, color: 0x111111 });
  });
  const last = path.at(-1);
  if (last) ctx.poly(diamond(tileCentre(last.pos), 1)).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
}
