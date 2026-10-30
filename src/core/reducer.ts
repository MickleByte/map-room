/**
 * The single entry point for changing the game: applyAction(state, action). It is
 * pure: the input state is never modified and the same inputs always give the same
 * result (ADR-0004).
 */
import { produce } from 'immer';
import { cannotAttack, resolveAttack } from './combat/resolve';
import { isAdjacent, normalize } from './grid';
import { cannotEnter, findPath } from './movement';
import { currentPlayer, typeOf } from './state';
import { endTurn } from './turn';
import type { Action, ApplyResult, GameEvent, GameState, Unit } from './types';
import { advanceOrders, moveUnit } from './units';
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

const notYet = (what: string) => () => `${what} is not available yet`;

const handlers: Handlers = {
  move(state, { unitId, to }, events) {
    const unit = ownUnit(state, unitId);
    if (typeof unit === 'string') return unit;
    const dest = normalize(state.map, to);
    if (!dest) return 'That tile is off the map';
    if (unit.carriedBy !== null) return 'Disembarking is not available yet';
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

  endTurn(state, _action, events) {
    endTurn(state, events);
  },

  bombard: notYet('Bombardment'),
  board: notYet('Boarding'),
  airMission: notYet('Air missions'),
  airSuperiority: notYet('Air superiority'),
  rebase: notYet('Rebasing'),
  paradrop: notYet('Paradropping'),
  setProduction: notYet('Production'),
};

export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.winner) return { ok: false, reason: 'The game is over' };
  const handler = handlers[action.type] as Handler<Action> | undefined;
  if (!handler) return { ok: false, reason: `Unknown action "${(action as { type: string }).type}"` };

  const events: GameEvent[] = [];
  let reason: string | undefined;
  const next = produce(state, (draft) => {
    reason = handler(draft, action, events) ?? undefined;
    if (reason === undefined) updateMemory(draft);
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
