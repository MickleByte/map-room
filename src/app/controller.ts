/**
 * Owns the current GameState and wires it to the renderer and panels. Player input
 * becomes core Actions here (from step 4 onward); nothing else changes the state.
 */
import { Application } from 'pixi.js';
import type { Coord, GameState } from '../core/types';
import { Camera } from '../render/camera';
import { tileAtPoint, tileCentre } from '../render/iso';
import { MapView } from '../render/mapView';
import { Minimap } from '../render/minimap';
import { TilePanel } from '../ui/tilePanel';
import { bindMapInput } from './input';

export class GameController {
  private selected: Coord | null = null;

  private constructor(
    readonly state: GameState,
    readonly camera: Camera,
    private readonly view: MapView,
    private readonly tilePanel: TilePanel,
  ) {}

  static async start(stage: HTMLElement, ui: HTMLElement, state: GameState): Promise<GameController> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      background: '#0d1218',
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    stage.appendChild(app.canvas);

    const camera = new Camera(state.map, { width: app.screen.width, height: app.screen.height });
    app.renderer.on('resize', (width: number, height: number) => camera.resize({ width, height }));

    const view = new MapView(state, camera);
    app.stage.addChild(view.root);

    const tilePanel = new TilePanel();
    const minimap = new Minimap(state, camera);
    ui.append(tilePanel.element, minimap.element);

    const controller = new GameController(state, camera, view, tilePanel);
    bindMapInput(app.canvas, camera, (screen) =>
      controller.select(tileAtPoint(state.map, camera.screenToWorld(screen))),
    );
    controller.select(null);
    return controller;
  }

  select(c: Coord | null): void {
    this.selected = c;
    this.view.setSelection(c);
    this.tilePanel.show(this.state, c);
  }

  get selection(): Coord | null {
    return this.selected;
  }

  centreOnTile(c: Coord): void {
    this.camera.centreOn(tileCentre(c));
  }
}
