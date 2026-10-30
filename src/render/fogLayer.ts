/**
 * Fog of war over the terrain: unseen tiles are blacked out and remembered tiles are
 * dimmed. Units are not drawn on either (see unitLayer); cities on remembered tiles
 * are drawn as last seen.
 */
import { GraphicsContext } from 'pixi.js';
import type { Vision } from '../core/visibility';
import { diamond, tileCentre, type Point } from './iso';

export const UNSEEN_COLOUR = 0x0d1218;
const REMEMBERED_ALPHA = 0.42;

export function drawFog(ctx: GraphicsContext, vision: Vision): void {
  ctx.clear();
  const { map } = vision.state;
  const unseen: Point[] = [];
  const remembered: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const v = vision.at({ x, y });
      if (v === 'unseen') unseen.push(tileCentre({ x, y }));
      else if (v === 'remembered') remembered.push(tileCentre({ x, y }));
    }
  }
  // A fill consumes every shape added since the last one, so each kind is filled in one go.
  // Unseen tiles are opaque, so enlarge them slightly to leave no hairline seams.
  for (const p of unseen) ctx.poly(diamond(p, -0.5));
  if (unseen.length) ctx.fill(UNSEEN_COLOUR);
  for (const p of remembered) ctx.poly(diamond(p));
  if (remembered.length) ctx.fill({ color: 0x000000, alpha: REMEMBERED_ALPHA });
}
