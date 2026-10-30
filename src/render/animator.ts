/**
 * Plays effects (see effects.ts) on a layer above the units, one after another, at a
 * chosen speed. Skipping cuts the current effect short and makes later ones finish at
 * once until reset, so the rest of a turn can be applied without waiting.
 */
import type { GraphicsContext } from 'pixi.js';
import type { Effect } from './effects';
import { diamond, TILE_W, tileCentre, type Point } from './iso';

export type AnimationSpeed = 'slow' | 'normal' | 'fast';

/** How long a strike or blast takes, in ms; a step of a move takes half as long. */
const DURATION: Record<AnimationSpeed, number> = { slow: 900, normal: 450, fast: 150 };

export class Animator {
  speed: AnimationSpeed = 'normal';
  private skipping = false;
  private finish: (() => void) | null = null;

  constructor(private readonly ctx: GraphicsContext) {}

  get skipped(): boolean {
    return this.skipping;
  }

  /** Play effects in order; resolves at once while skipping. */
  async play(effects: Effect[]): Promise<void> {
    for (const effect of effects) {
      if (this.skipping) break;
      await this.animate(effect);
    }
    this.ctx.clear();
  }

  /** Cut the current effect short and skip the rest until reset(). */
  skip(): void {
    this.skipping = true;
    this.finish?.();
  }

  reset(): void {
    this.skipping = false;
  }

  private animate(effect: Effect): Promise<void> {
    const duration = DURATION[this.speed] * (effect.kind === 'move' ? 0.5 : 1);
    return new Promise((resolve) => {
      const start = performance.now();
      let frame = 0;
      const done = () => {
        cancelAnimationFrame(frame);
        this.finish = null;
        this.ctx.clear();
        resolve();
      };
      this.finish = done;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        this.ctx.clear();
        draw(this.ctx, effect, t);
        if (t >= 1) done();
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
  }
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const hex = (colour: string) => parseInt(colour.slice(1), 16);

/** One frame of an effect, t running from 0 to 1. */
function draw(ctx: GraphicsContext, effect: Effect, t: number): void {
  switch (effect.kind) {
    case 'move': {
      const a = tileCentre(effect.from);
      const b = tileCentre(effect.to);
      // A step across the wrap seam would sweep across the whole map: just show the arrival.
      const p = Math.abs(b.x - a.x) > TILE_W ? b : lerp(a, b, t);
      if (p !== b) ctx.moveTo(a.x, a.y).lineTo(p.x, p.y).stroke({ width: 3, color: 0x000000, alpha: 0.35 });
      ctx
        .circle(p.x, p.y - 8, 7)
        .fill({ color: hex(effect.colour) })
        .stroke({ width: 1.5, color: 0x111111 });
      break;
    }
    case 'strike': {
      const a = tileCentre(effect.from);
      const b = tileCentre(effect.to);
      const seam = Math.abs(b.x - a.x) > TILE_W * 4;
      // Mark the shooter in its colour and the target in red throughout.
      ctx.poly(diamond(a, 2)).stroke({ width: 2.5, color: hex(effect.colour) });
      ctx.poly(diamond(b, 2)).stroke({ width: 3, color: 0xe0533f });
      // The shot flies for the first half, then bursts on the target.
      if (!seam && t < 0.5) {
        const p = lerp(a, b, t * 2);
        ctx
          .moveTo(a.x, a.y - 10)
          .lineTo(p.x, p.y - 10)
          .stroke({ width: 4, color: 0xfff2b0, alpha: 0.9 });
        ctx
          .circle(p.x, p.y - 10, 6)
          .fill({ color: 0xffd166 })
          .stroke({ width: 1.5, color: 0x111111 });
      } else {
        const burst = seam ? t : (t - 0.5) * 2;
        ctx.circle(b.x, b.y - 10, 10 + burst * 18).fill({ color: 0xff8c42, alpha: 0.85 * (1 - burst) });
        ctx.circle(b.x, b.y - 10, 6 + burst * 10).fill({ color: 0xfff2b0, alpha: 1 - burst });
      }
      break;
    }
    case 'blast': {
      const p = tileCentre(effect.at);
      ctx.circle(p.x, p.y - 10, 8 + t * 18).stroke({ width: 3, color: 0xe0533f, alpha: 1 - t });
      ctx.circle(p.x, p.y - 10, 6 * (1 - t) + 2).fill({ color: 0x2b2b2b, alpha: 0.8 * (1 - t) });
      break;
    }
  }
}
