/**
 * Pan and zoom over the world. The camera tracks the world point at the centre
 * of the screen; on wrapping maps that point's x is kept within one world width.
 */
import type { GameMap } from '../core/types';
import { worldHeight, worldWidth, type Point } from './iso';

const MAX_ZOOM = 2.5;
const FLAT_MIN_ZOOM = 0.3;

export class Camera {
  centre: Point;
  zoom = 1;
  private listeners: (() => void)[] = [];

  constructor(
    private readonly map: GameMap,
    private viewport: { width: number; height: number },
  ) {
    this.centre = { x: worldWidth(map) / 2, y: worldHeight(map) / 2 };
    this.clamp();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  resize(viewport: { width: number; height: number }): void {
    this.viewport = viewport;
    this.update();
  }

  /** Smallest zoom allowed. On a wrapping map the screen may never show more than one world width. */
  get minZoom(): number {
    if (!this.map.wrapX) return FLAT_MIN_ZOOM;
    return Math.min(MAX_ZOOM, Math.max(FLAT_MIN_ZOOM, this.viewport.width / worldWidth(this.map)));
  }

  screenToWorld(s: Point): Point {
    return {
      x: this.centre.x + (s.x - this.viewport.width / 2) / this.zoom,
      y: this.centre.y + (s.y - this.viewport.height / 2) / this.zoom,
    };
  }

  /** The visible world rectangle (x may extend past the world edges on wrapping maps). */
  visibleWorld(): { x: number; y: number; width: number; height: number } {
    const width = this.viewport.width / this.zoom;
    const height = this.viewport.height / this.zoom;
    return { x: this.centre.x - width / 2, y: this.centre.y - height / 2, width, height };
  }

  /** Whether a world point is on screen, with a margin in world pixels (any wrap copy counts). */
  shows(p: Point, margin = 0): boolean {
    const v = this.visibleWorld();
    const inY = p.y >= v.y + margin && p.y <= v.y + v.height - margin;
    const copies = this.map.wrapX ? [-1, 0, 1] : [0];
    return (
      inY &&
      copies.some((k) => {
        const x = p.x + k * worldWidth(this.map);
        return x >= v.x + margin && x <= v.x + v.width - margin;
      })
    );
  }

  /** The world offset to draw at, given the screen centre. */
  transform(): { scale: number; x: number; y: number } {
    return {
      scale: this.zoom,
      x: this.viewport.width / 2 - this.centre.x * this.zoom,
      y: this.viewport.height / 2 - this.centre.y * this.zoom,
    };
  }

  panByScreen(dx: number, dy: number): void {
    this.centre = { x: this.centre.x - dx / this.zoom, y: this.centre.y - dy / this.zoom };
    this.update();
  }

  centreOn(p: Point): void {
    this.centre = { ...p };
    this.update();
  }

  /** Zoom by a factor, keeping the world point under the given screen point fixed. */
  zoomAt(s: Point, factor: number): void {
    const before = this.screenToWorld(s);
    this.zoom = Math.min(MAX_ZOOM, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(s);
    this.centre = { x: this.centre.x + before.x - after.x, y: this.centre.y + before.y - after.y };
    this.update();
  }

  private update(): void {
    this.clamp();
    for (const fn of this.listeners) fn();
  }

  private clamp(): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(this.minZoom, this.zoom));
    const ww = worldWidth(this.map);
    const wh = worldHeight(this.map);
    const halfW = this.viewport.width / 2 / this.zoom;
    const halfH = this.viewport.height / 2 / this.zoom;
    const clampAxis = (v: number, half: number, size: number) =>
      half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, v));
    this.centre.y = clampAxis(this.centre.y, halfH, wh);
    if (this.map.wrapX) this.centre.x = ((this.centre.x % ww) + ww) % ww;
    else this.centre.x = clampAxis(this.centre.x, halfW, ww);
  }
}
