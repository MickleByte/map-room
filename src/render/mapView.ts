/**
 * The game world on screen. Wrapping maps are drawn as three side-by-side copies
 * that share their drawing data; the camera keeps its centre inside the middle copy
 * and never shows more than one world width, so three copies always cover the screen.
 */
import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { Coord, GameState } from '../core/types';
import { drawCities, drawMap, drawSelection } from './art';
import type { Camera } from './camera';
import { worldWidth } from './iso';

export class MapView {
  readonly root = new Container();
  private readonly copies: Container[] = [];
  private readonly terrain: GraphicsContext;
  private readonly selection = new GraphicsContext();

  constructor(
    private readonly state: GameState,
    private readonly camera: Camera,
  ) {
    this.terrain = drawMap(state);
    const offsets = state.map.wrapX ? [-1, 0, 1] : [0];
    for (const k of offsets) {
      const copy = new Container();
      copy.x = k * worldWidth(state.map);
      copy.addChild(new Graphics(this.terrain));
      copy.addChild(drawCities(state));
      copy.addChild(new Graphics(this.selection));
      this.copies.push(copy);
      this.root.addChild(copy);
    }
    camera.onChange(() => this.applyCamera());
    this.applyCamera();
  }

  setSelection(c: Coord | null): void {
    drawSelection(this.selection, c);
  }

  private applyCamera(): void {
    const t = this.camera.transform();
    this.root.scale.set(t.scale);
    this.root.position.set(t.x, t.y);
  }
}
