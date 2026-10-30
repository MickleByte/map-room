/**
 * The game world on screen. Wrapping maps are drawn as three side-by-side copies
 * that share their drawing data; the camera keeps its centre inside the middle copy
 * and never shows more than one world width, so three copies always cover the screen.
 */
import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { PathStep } from '../core/movement';
import type { Coord, GameState, UnitId } from '../core/types';
import type { Vision } from '../core/visibility';
import { drawCities, drawMap, drawSelection } from './art';
import type { Camera } from './camera';
import { drawFog } from './fogLayer';
import { worldWidth } from './iso';
import { drawPath, drawRange, type RangeKind } from './overlays';
import { drawUnits } from './unitLayer';

interface Copy {
  cities: Container;
  units: Graphics;
  labels: Container;
}

export class MapView {
  readonly root = new Container();
  private readonly copies: Copy[] = [];
  private readonly fog = new GraphicsContext();
  private readonly selection = new GraphicsContext();
  private readonly path = new GraphicsContext();
  private readonly range = new GraphicsContext();
  private unitShapes = new GraphicsContext();

  constructor(
    state: GameState,
    private readonly camera: Camera,
  ) {
    const terrain = drawMap(state);
    const offsets = state.map.wrapX ? [-1, 0, 1] : [0];
    for (const k of offsets) {
      const layer = new Container();
      layer.x = k * worldWidth(state.map);
      const copy: Copy = { cities: new Container(), units: new Graphics(), labels: new Container() };
      layer.addChild(
        new Graphics(terrain),
        copy.cities,
        new Graphics(this.fog),
        new Graphics(this.range),
        new Graphics(this.selection),
        new Graphics(this.path),
        copy.units,
        copy.labels,
      );
      this.copies.push(copy);
      this.root.addChild(layer);
    }
    camera.onChange(() => this.applyCamera());
    this.applyCamera();
  }

  /** Redraw everything that depends on the game state, as the viewer sees it. */
  update(vision: Vision, selectedUnit: UnitId | null): void {
    drawFog(this.fog, vision);
    const old = this.unitShapes;
    const drawing = drawUnits(vision, selectedUnit);
    this.unitShapes = drawing.shapes;
    for (const copy of this.copies) {
      copy.units.context = drawing.shapes;
      copy.cities.removeChildren().forEach((c) => c.destroy({ children: true }));
      copy.cities.addChild(drawCities(vision));
      copy.labels.removeChildren().forEach((c) => c.destroy({ children: true }));
      copy.labels.addChild(drawing.labels());
    }
    old.destroy();
  }

  setSelection(c: Coord | null): void {
    drawSelection(this.selection, c);
  }

  showPath(from: Coord, path: PathStep[] | null, target: Coord | null): void {
    drawPath(this.path, from, path, target);
  }

  /** Tint the tiles in the selected unit's bombard, mission or paradrop range (none to clear it). */
  showRange(tiles: Coord[], kind?: RangeKind): void {
    drawRange(this.range, tiles, kind);
  }

  private applyCamera(): void {
    const t = this.camera.transform();
    this.root.scale.set(t.scale);
    this.root.position.set(t.x, t.y);
  }
}
