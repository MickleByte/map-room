/**
 * Owns the current GameState and wires it to the renderer and panels. Player input
 * becomes core Actions here; applyAction is the only thing that changes the state.
 */
import { Application } from 'pixi.js';
import { coordsEqual, isAdjacent } from '../core/grid';
import { cannotEnter, findPath } from '../core/movement';
import { applyAction } from '../core/reducer';
import { currentPlayer, typeOf, unitsAt } from '../core/state';
import type { Action, Coord, GameState, Unit, UnitId } from '../core/types';
import { Camera } from '../render/camera';
import { tileAtPoint, tileCentre, type Point } from '../render/iso';
import { MapView } from '../render/mapView';
import { Minimap } from '../render/minimap';
import { el } from '../ui/dom';
import { TilePanel } from '../ui/tilePanel';
import { TopBar } from '../ui/topBar';
import { UnitPanel } from '../ui/unitPanel';
import { bindMapInput } from './input';

export class GameController {
  private tile: Coord | null = null;
  private unitId: UnitId | null = null;
  private hovered: { tile: Coord; screen: Point } | null = null;
  private readonly unitPanel: UnitPanel;
  private readonly tilePanel = new TilePanel();
  private readonly topBar: TopBar;
  private readonly pathTip = el('div', { className: 'path-tip', hidden: true });

  private constructor(
    public state: GameState,
    readonly camera: Camera,
    private readonly view: MapView,
    ui: HTMLElement,
    scenarioName: string,
  ) {
    this.unitPanel = new UnitPanel({
      select: (id) => this.selectUnit(id),
      fortify: () => this.fortify(),
      next: () => this.nextUnit(),
      cancelOrders: () =>
        this.unitId !== null && this.dispatch({ type: 'setOrders', unitId: this.unitId, orders: null }),
    });
    this.topBar = new TopBar(scenarioName, () => this.endTurn());
    ui.append(this.topBar.element, this.unitPanel.element, this.tilePanel.element, this.pathTip);
  }

  static async start(
    stage: HTMLElement,
    ui: HTMLElement,
    state: GameState,
    name: string,
  ): Promise<GameController> {
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

    const controller = new GameController(state, camera, view, ui, name);
    ui.append(new Minimap(state, camera).element);

    const toTile = (screen: Point) => tileAtPoint(state.map, camera.screenToWorld(screen));
    bindMapInput(app.canvas, camera, {
      click: (s) => controller.selectTile(toTile(s)),
      rightClick: (s) => {
        const t = toTile(s);
        if (t) controller.orderSelectedTo(t);
      },
      hover: (s) => controller.hover(s && toTile(s) ? { tile: toTile(s)!, screen: s } : null),
      key: (k) => controller.key(k),
    });
    controller.refresh();
    controller.nextUnit();
    return controller;
  }

  // ---- selection ----

  get selectedUnit(): Unit | undefined {
    return this.unitId !== null ? this.state.units[this.unitId] : undefined;
  }

  selectTile(c: Coord | null): void {
    this.tile = c;
    const here = c ? unitsAt(this.state, c).filter((u) => u.carriedBy === null) : [];
    if (!here.some((u) => u.id === this.unitId)) {
      const mine = here.filter((u) => u.owner === currentPlayer(this.state).id);
      const ready = mine.find((u) => u.movesLeft > 0 && !u.fortified);
      this.unitId = (ready ?? mine[0] ?? here[0])?.id ?? null;
    }
    this.refresh();
  }

  selectUnit(id: UnitId): void {
    const unit = this.state.units[id];
    if (!unit) return;
    this.unitId = id;
    this.tile = { ...unit.pos };
    this.refresh();
  }

  /** Select the next unit of the current player that is waiting for orders. */
  nextUnit(): void {
    const me = currentPlayer(this.state).id;
    const waiting = Object.values(this.state.units)
      .filter(
        (u) =>
          u.owner === me &&
          u.carriedBy === null &&
          u.movesLeft > 0 &&
          !u.fortified &&
          !u.orders &&
          typeOf(this.state, u).domain !== 'air',
      )
      .sort((a, b) => a.id - b.id);
    if (!waiting.length) {
      this.topBar.message('No units are waiting for orders. Press Enter to end the turn.');
      return;
    }
    const next = waiting.find((u) => this.unitId === null || u.id > this.unitId) ?? waiting[0]!;
    this.selectUnit(next.id);
    this.camera.centreOn(tileCentre(next.pos));
  }

  // ---- orders ----

  /** Right-click: step to an adjacent tile, or set a go-to order for anywhere further. */
  orderSelectedTo(target: Coord): void {
    const unit = this.selectedUnit;
    if (!unit || unit.owner !== currentPlayer(this.state).id) return;
    if (coordsEqual(unit.pos, target)) return;
    const action: Action =
      isAdjacent(this.state.map, unit.pos, target) &&
      unit.movesLeft > 0 &&
      !cannotEnter(this.state, unit, target)
        ? { type: 'move', unitId: unit.id, to: target }
        : { type: 'setOrders', unitId: unit.id, orders: { kind: 'goto', target } };
    if (this.dispatch(action)) this.selectUnit(unit.id);
  }

  fortify(): void {
    if (this.unitId !== null && this.dispatch({ type: 'fortify', unitId: this.unitId })) this.nextUnit();
  }

  endTurn(): void {
    if (!this.dispatch({ type: 'endTurn' })) return;
    // Until the AI exists (step 11), AI players pass their turn straight away.
    while (!this.state.winner && currentPlayer(this.state).control === 'ai') {
      this.dispatch({ type: 'endTurn' });
    }
    this.unitId = null;
    this.nextUnit();
  }

  dispatch(action: Action): boolean {
    const result = applyAction(this.state, action);
    if (!result.ok) {
      this.topBar.message(result.reason);
      return false;
    }
    this.state = result.state;
    if (this.unitId !== null && !this.state.units[this.unitId]) this.unitId = null;
    this.refresh();
    return true;
  }

  // ---- view ----

  hover(h: { tile: Coord; screen: Point } | null): void {
    this.hovered = h;
    this.updatePath();
  }

  key(key: string): boolean {
    switch (key) {
      case 'n':
      case 'N':
      case ' ':
        this.nextUnit();
        return true;
      case 'f':
      case 'F':
        this.fortify();
        return true;
      case 'Enter':
        this.endTurn();
        return true;
      case 'Escape':
        this.unitId = null;
        this.selectTile(null);
        return true;
      case 'c':
      case 'C':
        if (this.selectedUnit) this.camera.centreOn(tileCentre(this.selectedUnit.pos));
        return true;
    }
    return false;
  }

  centreOnTile(c: Coord): void {
    this.camera.centreOn(tileCentre(c));
  }

  refresh(): void {
    this.view.update(this.state, this.unitId);
    this.view.setSelection(this.tile);
    this.tilePanel.show(this.state, this.tile);
    this.unitPanel.show(this.state, this.tile, this.unitId);
    this.topBar.show(this.state);
    this.updatePath();
  }

  private updatePath(): void {
    const unit = this.selectedUnit;
    const h = this.hovered;
    const canPlan =
      unit && h && unit.owner === currentPlayer(this.state).id && typeOf(this.state, unit).movement > 0;
    if (!canPlan || coordsEqual(unit.pos, h.tile)) {
      this.view.showPath(unit?.pos ?? { x: 0, y: 0 }, null, null);
      this.pathTip.hidden = true;
      return;
    }
    const path = findPath(this.state, unit, h.tile);
    this.view.showPath(unit.pos, path, h.tile);
    const turns = path?.at(-1)?.turn;
    this.pathTip.textContent =
      turns === undefined ? 'No route' : turns === 0 ? 'This turn' : `${turns + 1} turns`;
    this.pathTip.style.left = `${h.screen.x + 14}px`;
    this.pathTip.style.top = `${h.screen.y + 14}px`;
    this.pathTip.hidden = false;
  }
}
