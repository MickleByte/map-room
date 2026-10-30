/**
 * Owns the current GameState and wires it to the renderer and panels. Player input
 * becomes core Actions here; applyAction is the only thing that changes the state.
 */
import { Application } from 'pixi.js';
import { shipFor } from '../core/cargo';
import {
  cannotDrop,
  cannotFlyMission,
  cannotParadrop,
  cannotRebase,
  missionRange,
  paradropRange,
  previewMission,
  type AirBase,
} from '../core/combat/air';
import { bombardRange, hasBombard, previewBombard } from '../core/combat/bombard';
import { cannotAttack, previewAttack } from '../core/combat/resolve';
import { coordsEqual, distance, isAdjacent } from '../core/grid';
import { cannotEnter, findPath } from '../core/movement';
import { applyAction } from '../core/reducer';
import { cityAt, currentPlayer, typeOf, unitsAt } from '../core/state';
import type { Action, City, Coord, GameEvent, GameState, Unit, UnitId } from '../core/types';
import { fogViewer, Vision } from '../core/visibility';
import { Camera } from '../render/camera';
import { tileAtPoint, tileCentre, type Point } from '../render/iso';
import { effectsOf } from '../render/effects';
import type { AnimationSpeed } from '../render/animator';
import { MapView } from '../render/mapView';
import { Minimap } from '../render/minimap';
import { CityPanel } from '../ui/cityPanel';
import { CombatLog, describeBuilt, describeEvents } from '../ui/combatLog';
import { el } from '../ui/dom';
import { EndScreen } from '../ui/endScreen';
import { OddsTooltip } from '../ui/oddsTooltip';
import { TilePanel } from '../ui/tilePanel';
import { TopBar } from '../ui/topBar';
import { UnitPanel } from '../ui/unitPanel';
import { AiClient } from './aiClient';
import { bindMapInput } from './input';

export class GameController {
  private tile: Coord | null = null;
  private unitId: UnitId | null = null;
  private hovered: { tile: Coord; screen: Point } | null = null;
  /** The selected unit is choosing where to paradrop: right-click drops it. */
  private dropping = false;
  private readonly unitPanel: UnitPanel;
  private readonly tilePanel = new TilePanel();
  private readonly topBar: TopBar;
  private readonly pathTip = el('div', { className: 'path-tip', hidden: true });
  private readonly oddsTip = new OddsTooltip();
  private readonly combatLog = new CombatLog();
  private readonly cityPanel = new CityPanel((cityId, queue, repeat) =>
    this.dispatch({ type: 'setProduction', cityId, queue, repeat }),
  );
  private readonly endScreen = new EndScreen(() => window.location.reload());
  private readonly minimap: Minimap;
  /** What the human player can see of the current state. */
  vision: Vision;
  private readonly ai = new AiClient();
  /** An AI turn is being planned or played back; the human's orders wait. */
  private aiPlaying = false;

  private constructor(
    public state: GameState,
    readonly camera: Camera,
    private readonly view: MapView,
    ui: HTMLElement,
    scenarioName: string,
  ) {
    this.vision = new Vision(state, fogViewer(state));
    this.minimap = new Minimap(state, camera);
    this.unitPanel = new UnitPanel({
      select: (id) => this.selectUnit(id),
      fortify: () => this.fortify(),
      board: () => this.board(),
      goAshore: () => this.goAshore(),
      airSuperiority: () => this.airSuperiority(),
      paradrop: () => this.toggleParadrop(),
      next: () => this.nextUnit(),
      cancelOrders: () =>
        this.unitId !== null && this.dispatch({ type: 'setOrders', unitId: this.unitId, orders: null }),
    });
    view.animator.speed = loadSpeed();
    this.topBar = new TopBar(
      scenarioName,
      {
        endTurn: () => void this.endTurn(),
        skip: () => this.view.animator.skip(),
        speed: (speed) => {
          this.view.animator.speed = speed;
          saveSpeed(speed);
        },
      },
      view.animator.speed,
    );
    ui.append(
      this.topBar.element,
      this.unitPanel.element,
      this.tilePanel.element,
      this.cityPanel.element,
      this.pathTip,
      this.oddsTip.element,
      this.combatLog.element,
      this.minimap.element,
      this.endScreen.element,
    );
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
    const here = c ? this.vision.unitsAt(c).filter((u) => u.carriedBy === null) : [];
    if (!here.some((u) => u.id === this.unitId)) {
      const mine = here.filter((u) => u.owner === currentPlayer(this.state).id);
      const ready = mine.find((u) => u.movesLeft > 0 && !u.fortified);
      this.unitId = (ready ?? mine[0] ?? here[0])?.id ?? null;
      this.dropping = false;
    }
    this.refresh();
  }

  selectUnit(id: UnitId): void {
    const unit = this.state.units[id];
    if (!unit) return;
    if (id !== this.unitId) this.dropping = false;
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

  /**
   * Right-click: attack an adjacent enemy or bombard one in range, step to an adjacent
   * tile, or set a go-to order for anywhere further.
   */
  orderSelectedTo(target: Coord): void {
    if (this.aiPlaying) return;
    const unit = this.selectedUnit;
    if (!unit || unit.owner !== currentPlayer(this.state).id) return;
    if (coordsEqual(unit.pos, target)) return;
    if (this.dropping) {
      if (!this.dispatch({ type: 'paradrop', unitId: unit.id, to: target })) return;
      this.dropping = false;
      this.selectUnit(unit.id);
      return;
    }
    if (typeOf(this.state, unit).domain === 'air') {
      if (this.dispatch(this.airOrder(unit, target)) && this.state.units[unit.id]) this.selectUnit(unit.id);
      return;
    }
    const adjacent = isAdjacent(this.state.map, unit.pos, target);
    const strike = this.strikeAt(unit, target);
    let action: Action;
    if (strike) action = { type: strike, unitId: unit.id, target };
    else if (adjacent && unit.movesLeft > 0 && !cannotEnter(this.state, unit, target))
      action = { type: 'move', unitId: unit.id, to: target };
    else action = { type: 'setOrders', unitId: unit.id, orders: { kind: 'goto', target } };
    if (this.dispatch(action) && this.state.units[unit.id]) this.selectUnit(unit.id);
  }

  /**
   * How the unit would strike visible enemies on a tile: attack when it legally can,
   * otherwise bombard if the tile is in range, otherwise attack an adjacent tile (to
   * report why not). Null when there is no visible enemy to strike.
   */
  private strikeAt(unit: Unit, target: Coord): 'attack' | 'bombard' | null {
    if (!this.enemyVisibleAt(target)) return null;
    const adjacent = isAdjacent(this.state.map, unit.pos, target);
    if (adjacent && !cannotAttack(this.state, unit, target)) return 'attack';
    const def = typeOf(this.state, unit);
    if (hasBombard(def) && distance(this.state.map, unit.pos, target) <= def.bombardRange) return 'bombard';
    return adjacent ? 'attack' : null;
  }

  /**
   * What right-clicking a tile asks of an aircraft: rebase to a friendly city or carrier
   * there, bomb a visible enemy, or otherwise fly recon.
   */
  private airOrder(unit: Unit, target: Coord): Action {
    const base = this.baseAt(unit, target);
    if (base) return { type: 'rebase', unitId: unit.id, to: base };
    if (this.enemyVisibleAt(target) && typeOf(this.state, unit).bombardStrength > 0)
      return { type: 'airMission', unitId: unit.id, mission: 'bomb', target };
    return { type: 'airMission', unitId: unit.id, mission: 'recon', target };
  }

  /** A friendly city, or a carrier of the unit's owner, on a tile. */
  private baseAt(unit: Unit, c: Coord): AirBase | null {
    const city = cityAt(this.state, c);
    if (city && city.owner === unit.owner) return { kind: 'city', id: city.id };
    const carrier = unitsAt(this.state, c).find(
      (u) => u.owner === unit.owner && typeOf(this.state, u).cargo?.domain === 'air',
    );
    return carrier ? { kind: 'carrier', id: carrier.id } : null;
  }

  /** Whether the human can see enemy units on a tile; only those can be targeted. */
  private enemyVisibleAt(c: Coord): boolean {
    const me = currentPlayer(this.state).id;
    return this.vision.unitsAt(c).some((u) => u.owner !== me);
  }

  fortify(): void {
    if (this.unitId !== null && this.dispatch({ type: 'fortify', unitId: this.unitId })) this.nextUnit();
  }

  /** Put the selected unit aboard a friendly ship with room in the same city. */
  board(): void {
    const unit = this.selectedUnit;
    const ship = unit && shipFor(this.state, unit, unit.pos);
    if (!unit || !ship) return;
    if (this.dispatch({ type: 'board', unitId: unit.id, carrierId: ship.id })) this.selectUnit(unit.id);
  }

  /** Put the selected fighter on air superiority. */
  airSuperiority(): void {
    if (this.unitId !== null) this.dispatch({ type: 'airSuperiority', unitId: this.unitId });
  }

  /** Start or stop choosing where the selected unit should paradrop. */
  toggleParadrop(): void {
    const unit = this.selectedUnit;
    if (!unit) return;
    const why = cannotDrop(this.state, unit);
    if (why && !this.dropping) {
      this.topBar.message(why);
      return;
    }
    this.dropping = !this.dropping;
    this.refresh();
  }

  /** Take the selected unit off its ship in port. */
  goAshore(): void {
    const unit = this.selectedUnit;
    if (!unit) return;
    if (this.dispatch({ type: 'move', unitId: unit.id, to: unit.pos })) this.selectUnit(unit.id);
  }

  /** Whether an AI turn is being planned or played back. */
  get busy(): boolean {
    return this.aiPlaying;
  }

  /** End the human's turn, then play every AI turn that follows. */
  async endTurn(): Promise<void> {
    if (this.aiPlaying) return;
    const events: GameEvent[] = [];
    if (!this.dispatch({ type: 'endTurn' }, events)) return;
    await this.playAiTurns(events);
    this.unitId = null;
    this.nextUnit();
    const built = describeBuilt(this.state, events, this.vision.player);
    if (built.length) this.topBar.message(built.join(' '));
  }

  /**
   * Play AI turns until it is a human's turn or the game is over. Each turn is planned
   * in the worker, then applied action by action through the reducer, animating what
   * the human can see.
   */
  private async playAiTurns(events: GameEvent[]): Promise<void> {
    if (this.state.winner || currentPlayer(this.state).control !== 'ai') return;
    this.aiPlaying = true;
    this.view.animator.reset();
    this.topBar.setAiPlaying(true);
    this.dropping = false;
    this.refresh();
    try {
      while (!this.state.winner && currentPlayer(this.state).control === 'ai') {
        const player = currentPlayer(this.state).id;
        const turn = this.state.turn;
        for (const action of await this.ai.decide(this.state, player)) {
          if (this.state.winner) break;
          await this.playAction(action, events);
        }
        // A plan should end its own turn; make sure play moves on if it didn't.
        const stuck = currentPlayer(this.state).id === player && this.state.turn === turn;
        if (stuck && !this.state.winner) await this.playAction({ type: 'endTurn' }, events);
      }
    } finally {
      this.aiPlaying = false;
      this.topBar.setAiPlaying(false);
      this.refresh();
    }
  }

  /** Apply one AI action, then show and log whatever of it the human can see. */
  private async playAction(action: Action, events: GameEvent[]): Promise<void> {
    const before = this.state;
    const result = applyAction(before, action);
    if (!result.ok) {
      console.warn('The AI chose an action the rules refused:', action, result.reason);
      return;
    }
    events.push(...result.events);
    this.state = result.state;
    const seenBefore = this.vision;
    const seenAfter = new Vision(this.state, seenBefore.player);
    const canSee = (c: Coord) => seenBefore.at(c) === 'visible' || seenAfter.at(c) === 'visible';
    const effects = effectsOf(before, result.events, canSee);
    const won = result.events.some((e) => e.type === 'gameWon');
    if (effects.length || won) this.combatLog.add(describeEvents(before, result.events));
    if (!effects.length || this.view.animator.skipped) {
      // Nothing to see: update the view only now and then, so long turns stay quick.
      this.vision = seenAfter;
      if (won) this.refresh();
      return;
    }
    if (this.unitId !== null && !this.state.units[this.unitId]) this.unitId = null;
    this.refresh();
    const focus = effects.find((e) => e.kind !== 'move') ?? effects[0]!;
    const at = tileCentre(focus.kind === 'blast' ? focus.at : focus.to);
    if (!this.camera.shows(at, 64)) this.camera.centreOn(at);
    await this.view.animator.play(effects);
  }

  /** Apply an action for the human, reporting why not if it is refused. Events are appended to `events`. */
  dispatch(action: Action, events: GameEvent[] = []): boolean {
    if (this.aiPlaying) return false;
    const result = applyAction(this.state, action);
    if (!result.ok) {
      this.topBar.message(result.reason);
      return false;
    }
    events.push(...result.events);
    this.combatLog.add(describeEvents(this.state, result.events));
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
    if (this.aiPlaying) {
      if (key === 'Escape') this.view.animator.skip();
      return key === 'Escape';
    }
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
      case 'b':
      case 'B':
        this.board();
        return true;
      case 'a':
      case 'A':
        this.airSuperiority();
        return true;
      case 'p':
      case 'P':
        this.toggleParadrop();
        return true;
      case 'Enter':
        void this.endTurn();
        return true;
      case 'Escape':
        if (this.dropping) {
          this.toggleParadrop();
          return true;
        }
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
    this.vision = new Vision(this.state, fogViewer(this.state));
    // Drop the selection if the selected unit has gone out of sight.
    const unit = this.selectedUnit;
    if (unit && this.vision.at(unit.pos) !== 'visible') this.unitId = null;
    this.view.update(this.vision, this.unitId);
    this.minimap.update(this.vision);
    this.view.setSelection(this.tile);
    this.showRange();
    this.tilePanel.show(this.vision, this.tile);
    this.cityPanel.show(this.state, this.ownCity());
    this.unitPanel.show(this.vision, this.tile, this.unitId, this.dropping);
    this.topBar.show(this.state);
    this.endScreen.show(this.state, this.vision.player);
    this.updatePath();
  }

  /** The current player's city on the selected tile, whose production they can edit. */
  private ownCity(): City | null {
    const city = this.tile && this.vision.cityAt(this.tile);
    return city && city.owner === currentPlayer(this.state).id ? city : null;
  }

  /** Tint where the selected unit can reach: its paradrop zone, mission range or bombard range. */
  private showRange(): void {
    const unit = this.selectedUnit;
    const own = unit && unit.owner === currentPlayer(this.state).id;
    if (this.dropping && (!own || cannotDrop(this.state, unit))) this.dropping = false;
    if (!own) this.view.showRange([]);
    else if (this.dropping) this.view.showRange(paradropRange(this.state, unit), 'drop');
    else if (typeOf(this.state, unit).domain === 'air')
      this.view.showRange(missionRange(this.state, unit), 'air');
    else this.view.showRange(unit.movesLeft > 0 ? bombardRange(this.state, unit) : []);
  }

  /** Hovering a tile with an aircraft selected, or while choosing a drop: what would happen. */
  private previewSortie(unit: Unit, h: { tile: Coord; screen: Point }): void {
    this.view.showPath(unit.pos, null, null);
    if (this.dropping) {
      this.showTip(cannotParadrop(this.state, unit, h.tile) ?? 'Paradrop here', h.screen);
      return;
    }
    const action = this.airOrder(unit, h.tile);
    if (action.type === 'rebase') {
      const to = action.to;
      const name =
        to.kind === 'city'
          ? this.state.cities[to.id]!.name
          : `the ${typeOf(this.state, this.state.units[to.id]!).name}`;
      this.showTip(cannotRebase(this.state, unit, to) ?? `Rebase to ${name}`, h.screen);
    } else if (action.type === 'airMission' && action.mission === 'bomb') {
      this.pathTip.hidden = true;
      const preview = previewMission(this.state, unit, h.tile);
      if (typeof preview === 'string') this.oddsTip.showReason(preview, h.screen);
      else
        this.oddsTip.showBombard(
          this.state,
          unit,
          preview,
          h.screen,
          'A round trip: fighters may intercept.',
        );
    } else {
      const why = cannotFlyMission(this.state, unit, 'recon', h.tile);
      const radius = this.state.ruleset.air.reconRadius;
      this.showTip(why ?? `Recon: shows ${radius} tiles around until the turn ends`, h.screen);
    }
  }

  private showTip(text: string, at: Point): void {
    this.pathTip.textContent = text;
    this.pathTip.style.left = `${at.x + 14}px`;
    this.pathTip.style.top = `${at.y + 14}px`;
    this.pathTip.hidden = false;
  }

  private updatePath(): void {
    const unit = this.selectedUnit;
    const h = this.hovered;
    const sortie = unit && h && unit.owner === currentPlayer(this.state).id && !coordsEqual(unit.pos, h.tile);
    if (sortie && (this.dropping || typeOf(this.state, unit).domain === 'air')) {
      this.oddsTip.hide();
      this.previewSortie(unit, h);
      return;
    }
    const canPlan =
      unit && h && unit.owner === currentPlayer(this.state).id && typeOf(this.state, unit).movement > 0;
    this.oddsTip.hide();
    if (!canPlan || coordsEqual(unit.pos, h.tile)) {
      this.view.showPath(unit?.pos ?? { x: 0, y: 0 }, null, null);
      this.pathTip.hidden = true;
      return;
    }
    const strike = this.strikeAt(unit, h.tile);
    if (strike) {
      this.view.showPath(unit.pos, null, null);
      this.pathTip.hidden = true;
      const preview =
        strike === 'attack'
          ? previewAttack(this.state, unit, h.tile)
          : previewBombard(this.state, unit, h.tile);
      if (typeof preview === 'string') this.oddsTip.showReason(preview, h.screen);
      else if ('odds' in preview) this.oddsTip.show(this.state, unit, preview, h.screen);
      else this.oddsTip.showBombard(this.state, unit, preview, h.screen);
      return;
    }
    const path = findPath(this.state, unit, h.tile);
    this.view.showPath(unit.pos, path, h.tile);
    const turns = path?.at(-1)?.turn;
    this.showTip(
      turns === undefined ? 'No route' : turns === 0 ? 'This turn' : `${turns + 1} turns`,
      h.screen,
    );
  }
}

const SPEED_KEY = 'mapRoom.aiSpeed';

/** The AI playback speed this browser last chose (a per-viewer convenience). */
function loadSpeed(): AnimationSpeed {
  try {
    const saved = localStorage.getItem(SPEED_KEY);
    if (saved === 'slow' || saved === 'normal' || saved === 'fast') return saved;
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
  }
  return 'normal';
}

function saveSpeed(speed: AnimationSpeed): void {
  try {
    localStorage.setItem(SPEED_KEY, speed);
  } catch {
    // Not remembered; it still applies for this session.
  }
}
