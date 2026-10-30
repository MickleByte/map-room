/**
 * The single entry point for changing the game: applyAction(state, action). It is
 * pure: the input state is never modified and the same inputs always give the same
 * result (ADR-0004).
 */
import { produce } from 'immer';
import {
  cannotFlyMission,
  cannotParadrop,
  cannotPatrol,
  cannotRebase,
  resolveMission,
  resolveParadrop,
  resolveRebase,
  startPatrol,
} from './combat/air';
import { cannotBombard, resolveBombard } from './combat/bombard';
import { cannotAttack, resolveAttack } from './combat/resolve';
import { cannotCarry } from './cargo';
import { cannotBuild } from './cities';
import { coordsEqual, isAdjacent, normalize } from './grid';
import { cannotEnter, findPath } from './movement';
import { cityAt, currentPlayer, typeOf } from './state';
import { endTurn } from './turn';
import type { Action, ApplyResult, GameEvent, GameState, Unit } from './types';
import { advanceOrders, moveUnit } from './units';
import { checkVictory } from './victory';
import { updateMemory } from './visibility';

type Handler<A extends Action> = (state: GameState, action: A, events: GameEvent[]) => string | void;
type Handlers = { [T in Action['type']]: Handler<Extract<Action, { type: T }>> };

/** The acting player's unit, or the reason it can't be used. */
function ownUnit(state: GameState, id: number): Unit | string {
  const unit = state.units[id];
  if (!unit) return `No unit with id ${id}`;
  if (unit.owner !== currentPlayer(state).id) return 'That unit belongs to another player';
  return unit;
}

const handlers: Handlers = {
  move(state, { unitId, to }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const dest = normalize(state.map, to);
    if (!dest) return 'That tile is off the map';
    if (unit.carriedBy !== null && coordsEqual(unit.pos, dest)) {
      // Going ashore in port, without moving.
      if (typeOf(state, unit).domain !== 'land' || !cityAt(state, dest))
        return 'This unit is already aboard; it can go ashore in a city or onto adjacent land';
      unit.carriedBy = null;
      unit.orders = null;
      return;
    }
    if (!isAdjacent(state.map, unit.pos, dest)) return 'Units move one tile at a time';
    if (unit.movesLeft <= 0) return 'This unit has no movement left';
    const why = cannotEnter(state, unit, dest);
    if (why) return why;
    unit.orders = null;
    moveUnit(state, unit, dest, events);
  },

  fortify(state, { unitId }) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    if (typeOf(state, unit).domain !== 'land') return 'Only land units can fortify';
    if (unit.carriedBy !== null) return 'Units cannot fortify aboard a ship';
    if (unit.fortified) return 'This unit is already fortified';
    unit.fortified = true;
    unit.movesLeft = 0;
    unit.orders = null;
  },

  setOrders(state, { unitId, orders }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    if (!orders) {
      unit.orders = null;
      return;
    }
    const target = normalize(state.map, orders.target);
    if (!target) return 'That tile is off the map';
    if (!findPath(state, unit, target)) return 'There is no route there';
    unit.orders = { kind: 'goto', target };
    advanceOrders(state, unit, events);
  },

  attack(state, { unitId, target }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const why = cannotAttack(state, unit, target);
    if (why) return why;
    resolveAttack(state, unit, normalize(state.map, target)!, events);
  },

  bombard(state, { unitId, target }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const why = cannotBombard(state, unit, target);
    if (why) return why;
    resolveBombard(state, unit, normalize(state.map, target)!, events);
  },

  endTurn(state, _action, events) {
    endTurn(state, events);
  },

  board(state, { unitId, carrierId }) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const ship = state.units[carrierId];
    if (!ship) return `No unit with id ${carrierId}`;
    if (!coordsEqual(unit.pos, ship.pos)) return 'The unit and the ship must be on the same tile';
    if (!cityAt(state, unit.pos)) return 'Units board in a city; at sea, move onto the ship';
    if (unit.carriedBy !== null) return 'This unit is already aboard a ship';
    const why = cannotCarry(state, ship, unit);
    if (why) return why;
    unit.carriedBy = ship.id;
    unit.fortified = false;
    unit.orders = null;
    if (typeOf(state, unit).domain === 'air') unit.base = { kind: 'carrier', id: ship.id };
  },
  airMission(state, { unitId, mission, target }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const why = cannotFlyMission(state, unit, mission, target);
    if (why) return why;
    resolveMission(state, unit, mission, normalize(state.map, target)!, events);
  },
  airSuperiority(state, { unitId }) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const why = cannotPatrol(state, unit);
    if (why) return why;
    startPatrol(unit);
  },
  rebase(state, { unitId, to }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const why = cannotRebase(state, unit, to);
    if (why) return why;
    resolveRebase(state, unit, to, events);
  },
  paradrop(state, { unitId, to }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const why = cannotParadrop(state, unit, to);
    if (why) return why;
    resolveParadrop(state, unit, normalize(state.map, to)!, events);
  },
  setProduction(state, { cityId, queue, repeat }) {
    const city = state.cities[cityId];
    if (!city) return `No city with id ${cityId}`;
    if (city.owner !== currentPlayer(state).id) return 'That city belongs to another player';
    for (const type of queue) {
      const why = cannotBuild(state, city, type);
      if (why) return why;
    }
    city.queue = [...queue];
    city.repeat = repeat;
  },
};

export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.winner) return { ok: false, reason: 'The game is over' };
  const handler = handlers[action.type] as Handler<Action> | undefined;
  if (!handler) return { ok: false, reason: `Unknown action "${(action as { type: string }).type}"` };

  const events: GameEvent[] = [];
  let reason: string | undefined;
  const next = produce(state, (draft) => {
    reason = handler(draft, action, events) ?? undefined;
    if (reason !== undefined) return;
    updateMemory(draft);
    checkVictory(draft, events);
  });
  return reason !== undefined ? { ok: false, reason } : { ok: true, state: next, events };
}

/** Apply several actions in order, stopping at the first that fails. */
export function applyActions(state: GameState, actions: Action[]): ApplyResult {
  let current = state;
  const events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) return result;
    current = result.state;
    events.push(...result.events);
  }
  return { ok: true, state: current, events };
}
