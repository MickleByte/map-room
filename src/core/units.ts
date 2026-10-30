/** Unit state changes shared by several actions. All functions mutate a draft state. */
import { findPath, stepUses } from './movement';
import { normalize } from './grid';
import { cargoOf } from './state';
import type { Coord, GameEvent, GameState, Unit } from './types';
import { lookAround } from './visibility';

/** Step a unit (and anything it carries) into an adjacent tile it is allowed to enter. */
export function moveUnit(state: GameState, unit: Unit, to: Coord, events: GameEvent[]): void {
  // Copy coordinates: events outlive the draft, so they must not hold draft objects.
  const from = { ...unit.pos };
  const dest = { ...normalize(state.map, to)! };
  unit.movesLeft -= stepUses(state, unit, from, dest);
  unit.pos = { ...dest };
  unit.fortified = false;
  unit.actedThisTurn = true;
  for (const passenger of cargoOf(state, unit.id)) passenger.pos = { ...dest };
  lookAround(state, unit);
  events.push({ type: 'unitMoved', unitId: unit.id, from, to: dest });
}

/**
 * Follow a unit's go-to order as far as its movement allows this turn. The order is
 * cleared on arrival or when the route is blocked.
 */
export function advanceOrders(state: GameState, unit: Unit, events: GameEvent[]): void {
  const order = unit.orders;
  if (!order) return;
  const path = findPath(state, unit, order.target);
  if (!path) {
    unit.orders = null;
    return;
  }
  for (const step of path) {
    if (step.turn > 0 || unit.movesLeft <= 0) return;
    moveUnit(state, unit, step.pos, events);
  }
  unit.orders = null;
}
